/**
 * TASK-013｜持久任务与快照发布骨架。
 *
 * 用户功能：商家确认导入后，即使进程在提交/入队/计算/发布任意位置中断或重启，
 * 计算链都能从持久状态安全续跑；发布的快照永远包含指标+队列+规则的完成标记，
 * 不出现半份快照；每日店铺本地 08:00 的输入评估照常推进（F01，不被 AI 开关阻断）。
 *
 * 合同：09_TASKS TASK-013；04 §10.5 JobRun、§11.1 步骤 7–10、§11.3；
 * F01（input_evaluation_at/last_evaluation_date）、F08（先构建后独立短事务 CAS 发布、
 * 序列化失败有限重试）；11_DEVELOPMENT_RULES §14.2（dispatcher 兜底）。
 * TASK-014/015/016 通过 registerSnapshotBuilder 注册真正构建器；注册表不齐时
 * 本骨架一律拒绝发布（SNAPSHOT_BUILDERS_INCOMPLETE），不提前声称完整可用。
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** 快照必须齐备的完成标记（014/015/016 各自注册） */
export type SnapshotBuilderKind = "metrics" | "cohort" | "rules";
export const REQUIRED_SNAPSHOT_KINDS: readonly SnapshotBuilderKind[] = ["metrics", "cohort", "rules"];

export interface SnapshotBuildInput {
  orgId: string;
  storeId: string;
  datasetVersion: bigint;
  rulesetVersion: string;
  evaluationAt: Date;
  tx: Tx;
}

export interface SnapshotBuilder {
  /** 在同一构建事务内写出该类别的版本化结果；抛错即整轮回滚 */
  build(input: SnapshotBuildInput): Promise<void>;
}

const builders = new Map<SnapshotBuilderKind, SnapshotBuilder>();

export function registerSnapshotBuilder(kind: SnapshotBuilderKind, builder: SnapshotBuilder): void {
  builders.set(kind, builder);
}

/** 仅供测试复位注册表，生产代码不得调用 */
export function resetSnapshotBuildersForTests(): void {
  builders.clear();
}

export function registeredSnapshotKinds(): SnapshotBuilderKind[] {
  return [...builders.keys()];
}

// ---------- 本地时区工具（与 commitTask 的 IANA 口径一致） ----------

function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** 店铺本地某日某时刻（默认 00:00）对应的 UTC 瞬间（两遍逼近消除 DST 偏差） */
export function localInstantOf(tz: string, date: string, hour = 0, minute = 0): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const naive = Date.parse(`${date}T${hh}:${mm}:00Z`);
  let at = new Date(naive - tzOffsetMs(tz, new Date(naive)));
  at = new Date(naive - tzOffsetMs(tz, at));
  return at;
}

export function localDateOf(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

function addDayStr(date: string, days = 1): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** 规范评估瞬间：最近一个已到期的本地 08:00（F01 评估身份口径，与提交时间无关） */
export function canonicalEvaluationAt(tz: string, now: Date): Date {
  const today = localDateOf(tz, now);
  const todayDue = localInstantOf(tz, today, 8);
  if (now.getTime() >= todayDue.getTime()) return todayDue;
  return localInstantOf(tz, addDayStr(today, -1), 8);
}

/** F01：给定 now，返回该店铺“最近一个已到期的本地 08:00”（只补最近一次，不逐日补偿） */
export function latestDueEvaluation(tz: string, now: Date, lastLocalDate: string | null): { date: string; at: Date } | null {
  const today = localDateOf(tz, now);
  const todayDue = localInstantOf(tz, today, 8);
  let candidateDate: string;
  if (now.getTime() >= todayDue.getTime()) {
    candidateDate = today;
  } else {
    candidateDate = addDayStr(today, -1); // 尚未到今日08:00 → 最近已到期是昨日08:00
  }
  if (lastLocalDate && candidateDate <= lastLocalDate) return null; // 已推进过该到期日
  return { date: candidateDate, at: localInstantOf(tz, candidateDate, 8) };
}

// ---------- 重建任务请求（事务内落账，dispatcher 负责真正入队） ----------

export interface RequestRebuildArgs {
  orgId: string;
  storeId: string;
  datasetVersion: bigint;
  rulesetVersion: string;
  evaluationAt: Date;
  sourceTaskId?: string | null;
  requestedBy?: string | null;
  db: PrismaClient | Tx;
}

export async function requestRebuild(args: RequestRebuildArgs): Promise<{ id: string; reused: boolean }> {
  // 与库上部分唯一索引 uq_job_run_recompute_target（org,store,dataset_version,ruleset_version
  // WHERE job_kind='recompute_snapshot'）同语义：同一目标至多一行，重算/重评估复用该行
  const idempotencyKey = createHash("sha256")
    .update(JSON.stringify([
      args.orgId, args.storeId, "recompute_snapshot",
      args.datasetVersion.toString(), args.rulesetVersion,
    ]))
    .digest("hex");
  const target = { orgId: args.orgId, storeId: args.storeId, datasetVersion: args.datasetVersion, rulesetVersion: args.rulesetVersion, jobKind: "recompute_snapshot" as const };
  const existing = await args.db.jobRun.findFirst({ where: target });
  if (existing) {
    const ctx = existing.context as { evaluation_at?: string; source_task_id?: string | null };
    const staleEval = !ctx.evaluation_at || new Date(ctx.evaluation_at).getTime() < args.evaluationAt.getTime();
    if (existing.status === "failed") {
      // 失败可重试：回到待派发（保留 attemptCount 供耗尽判定）
      await args.db.jobRun.update({
        where: { id: existing.id },
        data: { status: "pending", outboxStatus: "pending", errorCode: null, updatedAt: new Date() },
      });
    } else if (staleEval) {
      // F01：同事实版本推进到更晚评估身份 → 复用同一行重跑（发布只推进 currentSnapshotEvaluationAt）
      await args.db.jobRun.update({
        where: { id: existing.id },
        data: {
          status: existing.status === "superseded" ? "superseded" : "pending",
          outboxStatus: existing.status === "superseded" ? existing.outboxStatus : "pending",
          context: { ...ctx, evaluation_at: args.evaluationAt.toISOString(), source_task_id: ctx.source_task_id ?? args.sourceTaskId ?? null },
          finishedAt: existing.status === "superseded" ? existing.finishedAt : null,
          updatedAt: new Date(),
        },
      });
    }
    return { id: existing.id, reused: true };
  }
  try {
    const created = await args.db.jobRun.create({
      data: {
        orgId: args.orgId,
        storeId: args.storeId,
        jobKind: "recompute_snapshot",
        idempotencyKey,
        context: {
          scope: "full",
          evaluation_at: args.evaluationAt.toISOString(),
          source_task_id: args.sourceTaskId ?? null,
        },
        datasetVersion: args.datasetVersion,
        rulesetVersion: args.rulesetVersion,
        actorType: args.requestedBy ? "user" : "system",
        requestedBy: args.requestedBy ?? null,
      },
    });
    return { id: created.id, reused: false };
  } catch (error) {
    // 并发同目标创建撞部分唯一索引：回读复用既有行
    const raced = await args.db.jobRun.findFirst({ where: target });
    if (raced) return { id: raced.id, reused: true };
    throw error;
  }
}

// ---------- 重建执行：构建（单事务）→ 发布（独立短事务 CAS） ----------

const SERIALIZATION_CODES = new Set(["40001", "40P01", "P2034"]);
const PUBLISH_RETRY_LIMIT = 3;

function isSerializationError(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code
    ?? (error as { cause?: { code?: string } })?.cause?.code;
  return typeof code === "string" && SERIALIZATION_CODES.has(code);
}

export interface RebuildOutcome {
  status: "succeeded" | "superseded" | "failed" | "skipped";
  errorCode?: string;
}

export async function runRebuildJob(jobRunId: string, db: PrismaClient): Promise<RebuildOutcome> {
  const run = await db.jobRun.findUnique({ where: { id: jobRunId } });
  if (!run) return { status: "skipped" };
  if (run.status === "succeeded" || run.status === "superseded") return { status: run.status }; // 幂等重投直接跳过

  const store = await db.store.findUnique({
    where: { id: run.storeId },
    select: { timezone: true, datasetVersion: true, rulesetVersion: true },
  });
  if (!store) return { status: "skipped" };

  // 更新版本/规则集已前进：旧任务被取代，不发布旧结果
  if (store.datasetVersion > run.datasetVersion || store.rulesetVersion !== run.rulesetVersion) {
    await db.jobRun.update({
      where: { id: run.id },
      data: { status: "superseded", finishedAt: new Date(), updatedAt: new Date() },
    });
    return { status: "superseded" };
  }

  // 完成标记合同：metrics/cohort/rules 全部注册才允许构建与发布（014/015/016 前骨架不发布）
  const missing = REQUIRED_SNAPSHOT_KINDS.filter((k) => !builders.has(k));
  if (missing.length > 0) {
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        errorCode: "SNAPSHOT_BUILDERS_INCOMPLETE",
        finishedAt: new Date(),
        updatedAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
    return { status: "failed", errorCode: "SNAPSHOT_BUILDERS_INCOMPLETE" };
  }

  await db.jobRun.update({
    where: { id: run.id },
    data: { status: "running", startedAt: new Date(), updatedAt: new Date(), attemptCount: { increment: 1 } },
  });

  const evaluationAt = new Date((run.context as { evaluation_at?: string }).evaluation_at ?? Date.now());

  // F08：同一事务核对输入元组并构建全部类别；序列化冲突整轮回滚、有限重试
  for (let attempt = 1; attempt <= PUBLISH_RETRY_LIMIT; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const tuple = await tx.store.findUniqueOrThrow({
          where: { id: run.storeId },
          select: { datasetVersion: true, rulesetVersion: true },
        });
        if (tuple.datasetVersion !== run.datasetVersion || tuple.rulesetVersion !== run.rulesetVersion) {
          throw new SupersededSignal();
        }
        for (const kind of REQUIRED_SNAPSHOT_KINDS) {
          const builder = builders.get(kind);
          if (builder) {
            await builder.build({
              orgId: run.orgId, storeId: run.storeId,
              datasetVersion: run.datasetVersion, rulesetVersion: run.rulesetVersion,
              evaluationAt, tx,
            });
          }
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      const published = await publishSnapshot(db, {
        runId: run.id,
        orgId: run.orgId, storeId: run.storeId,
        datasetVersion: run.datasetVersion, rulesetVersion: run.rulesetVersion,
        evaluationAt,
      });
      return published;
    } catch (error) {
      if (error instanceof SupersededSignal) {
        await db.jobRun.update({
          where: { id: run.id },
          data: { status: "superseded", finishedAt: new Date(), updatedAt: new Date() },
        });
        return { status: "superseded" } as RebuildOutcome;
      }
      if (attempt >= PUBLISH_RETRY_LIMIT || !isSerializationError(error)) {
        await db.jobRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            errorCode: isSerializationError(error) ? "SNAPSHOT_CONTENTION" : "SNAPSHOT_BUILD_FAILED",
            finishedAt: new Date(), updatedAt: new Date(),
          },
        });
        return { status: "failed", errorCode: isSerializationError(error) ? "SNAPSHOT_CONTENTION" : "SNAPSHOT_BUILD_FAILED" } as RebuildOutcome;
      }
      await new Promise((r) => setTimeout(r, 50 * attempt)); // 有限退避后整轮重试
    }
  }
  return { status: "failed", errorCode: "SNAPSHOT_CONTENTION" };
}

class SupersededSignal extends Error {
  constructor() { super("superseded"); }
}

/** 发布阶段：独立短事务锁店铺行 → CAS 校验版本/规则集 → 指针翻转（F08/04 §11.1 步骤9） */
async function publishSnapshot(db: PrismaClient, args: {
  runId: string; orgId: string; storeId: string;
  datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date;
}): Promise<RebuildOutcome> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`snapshot:${args.orgId}:${args.storeId}`}))`;
    const store = await tx.store.findUniqueOrThrow({
      where: { id: args.storeId },
      select: {
        datasetVersion: true, rulesetVersion: true,
        currentSnapshotVersion: true, currentSnapshotRulesetVersion: true, currentSnapshotEvaluationAt: true,
        snapshotStatus: true,
      },
    });
    if (store.datasetVersion !== args.datasetVersion || store.rulesetVersion !== args.rulesetVersion) {
      await tx.jobRun.update({
        where: { id: args.runId },
        data: { status: "superseded", finishedAt: new Date(), updatedAt: new Date() },
      });
      return { status: "superseded" } as RebuildOutcome;
    }
    const alreadyAtVersion = store.currentSnapshotVersion === args.datasetVersion
      && store.currentSnapshotRulesetVersion === args.rulesetVersion;
    if (alreadyAtVersion && store.currentSnapshotEvaluationAt && store.currentSnapshotEvaluationAt >= args.evaluationAt) {
      // 同版本重评估已发布过：幂等收口
      await tx.jobRun.update({
        where: { id: args.runId },
        data: { status: "succeeded", finishedAt: new Date(), updatedAt: new Date() },
      });
      return { status: "succeeded" } as RebuildOutcome;
    }
    if (alreadyAtVersion) {
      // 同事实版本的更新评估（F01 每日推进）：只推进评估时点，不翻转历史指针
      await tx.store.update({
        where: { id: args.storeId },
        data: { currentSnapshotEvaluationAt: args.evaluationAt, snapshotStatus: "ready" },
      });
    } else {
      await tx.store.update({
        where: { id: args.storeId },
        data: {
          previousSnapshotVersion: store.currentSnapshotVersion,
          previousSnapshotRulesetVersion: store.currentSnapshotRulesetVersion,
          previousSnapshotEvaluationAt: store.currentSnapshotEvaluationAt,
          currentSnapshotVersion: args.datasetVersion,
          currentSnapshotRulesetVersion: args.rulesetVersion,
          currentSnapshotEvaluationAt: args.evaluationAt,
          snapshotStatus: "ready",
        },
      });
    }
    await tx.jobRun.update({
      where: { id: args.runId },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        updatedAt: new Date(),
        resultManifest: {
          dataset_version: args.datasetVersion.toString(),
          ruleset_version: args.rulesetVersion,
          evaluation_at: args.evaluationAt.toISOString(),
          builders: [...REQUIRED_SNAPSHOT_KINDS],
        },
      },
    });
    return { status: "succeeded" } as RebuildOutcome;
  });
}

// ---------- F01：每日输入评估推进（不被 AI 开关阻断；重启只补最近到期日） ----------

export interface EvaluationTickResult {
  advanced: number;
  scheduled: number;
}

export async function evaluationTick(db: PrismaClient, now: Date, limit = 50, cursor?: { orgId: string; id: string } | null): Promise<EvaluationTickResult & { nextCursor: { orgId: string; id: string } | null }> {
  // M01-C15：游标分批（按orgId+id排序、排除本轮已推进店），不全量固定前50
  const stores = await db.store.findMany({
    where: { status: "active" },
    select: { orgId: true, id: true, timezone: true, datasetVersion: true, rulesetVersion: true, lastEvaluationDate: true },
    take: limit,
    orderBy: [{ orgId: "asc" }, { id: "asc" }],
    ...(cursor ? { cursor: { orgId_id: { orgId: cursor.orgId, id: cursor.id } }, skip: 1 } : {}),
  });
  let advanced = 0;
  let scheduled = 0;
  for (const store of stores) {
    const lastLocal = store.lastEvaluationDate
      ? store.lastEvaluationDate.toISOString().slice(0, 10)
      : null;
    const due = latestDueEvaluation(store.timezone, now, lastLocal);
    if (!due) continue;
    try {
      const result = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`snapshot:${store.orgId}:${store.id}`}))`;
        const fresh = await tx.store.findUniqueOrThrow({
          where: { id: store.id },
          select: { lastEvaluationDate: true, datasetVersion: true, rulesetVersion: true },
        });
        const freshLast = fresh.lastEvaluationDate ? fresh.lastEvaluationDate.toISOString().slice(0, 10) : null;
        if (freshLast && due.date <= freshLast) return false;
        await tx.store.update({
          where: { id: store.id },
          data: {
            lastEvaluationDate: new Date(`${due.date}T00:00:00Z`),
            inputEvaluationAt: due.at,
          },
        });
        if (fresh.datasetVersion > 0n) {
          await requestRebuild({
            db: tx, orgId: store.orgId, storeId: store.id,
            datasetVersion: fresh.datasetVersion, rulesetVersion: fresh.rulesetVersion,
            evaluationAt: due.at, sourceTaskId: null,
          });
        }
        return true;
      });
      if (result) {
        advanced += 1;
        scheduled += 1;
      }
    } catch {
      // 单店失败不阻断其余店铺；下一轮 tick 重试
    }
  }
  const lastStore = stores[stores.length - 1];
  const nextCursor = stores.length === limit && lastStore ? { orgId: lastStore.orgId, id: lastStore.id } : null;
  return { advanced, scheduled, nextCursor };
}
