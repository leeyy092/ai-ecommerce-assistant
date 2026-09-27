/**
 * TASK-013｜持久任务与快照发布骨架集成测试（真实 PostgreSQL + 真实会话）。
 * 验收（09_TASKS）：提交成功但入队前终止可恢复（dispatcher 兜底）；重投幂等；
 * 并发导入旧任务被 superseded 不顶替新版；缺完成标记不得发布半份快照；
 * F01 每日评估推进不被 AI 开关阻断、重启只补最近到期日；发布 CAS 单调。
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";
import { FILE_HEADERS } from "@/adapters/contracts";
import { setStorageRoot } from "@/storage";
import {
  evaluationTick,
  latestDueEvaluation,
  registerSnapshotBuilder,
  requestRebuild,
  resetSnapshotBuildersForTests,
  runRebuildJob,
} from "@/services/snapshot";
import { sweepJobRuns } from "@/jobs/dispatcher";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));
const privateRoot = mkdtempSync(join(tmpdir(), "aiea-storage-"));
setStorageRoot(privateRoot);

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
process.env.UPLOAD_RATE_LIMIT_PER_MIN = "10000";

let db: PrismaClient;
type Auth = ReturnType<(typeof import("@/lib/auth"))["getAuth"]>;
let auth: Auth;
const PASSWORD = "snap-pass-123";

let owner: { userId: string; cookie: string };
let orgId: string;
let storeId: string;
let dataSourceId: string;

function req(path: string, init: RequestInit = {}, cookie?: string): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://127.0.0.1:3000${path}`, { ...init, headers } as ConstructorParameters<typeof NextRequest>[1]);
}

async function loginCookie(email: string): Promise<string> {
  const r = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
  auth = (await import("@/lib/auth")).getAuth();
  const t = randomUUID().slice(0, 8);
  const { initOwner } = await import("@/services/ownerInit");
  const ownerEmail = `owner-snap-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `快照组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
    async (email, password, name) => {
      const result = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: false });
      return { authUserId: result.user.id };
    },
  );
  orgId = r.orgId;
  owner = { userId: r.userId, cookie: await loginCookie(ownerEmail) };
  storeId = (
    await db.store.create({
      data: { orgId, name: "快照店", externalStoreId: "SNAP-1", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    })
  ).id;
  dataSourceId = (
    await db.dataSource.create({
      data: { orgId, storeId, sourceNamespace: "ns-snap", name: "快照源", adapterKind: "csv" },
    })
  ).id;
}, 420_000);

afterEach(() => {
  resetSnapshotBuildersForTests();
});

afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

const ts = "2026-09-11T01:00:00Z";

/** 走真实上传→校验→提交链制造一次 versionBump，返回 (runId, task) */
async function committedBump(label: string): Promise<{ run: { id: string; status: string; outboxStatus: string; context: unknown }; task: { id: string }; version: bigint }> {
  const csv = [
    FILE_HEADERS.products.join(","),
    `SNAP-1,${ts},P-${label},杯,杯具,active,S-${label},CODE-${label},杯,,active`,
  ].join("\n");
  const { POST } = await import("@/app/api/v1/imports/route");
  const form = new FormData();
  form.set("store_id", storeId);
  form.set("data_source_id", dataSourceId);
  form.set("entity_type", "products");
  form.set("file", new File([csv], "products.csv", { type: "text/csv" }));
  const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
  expect([200, 201]).toContain(res.status);
  const taskId = ((await res.json()) as { data: { id: string } }).data.id;
  await (await import("@/jobs/handlers/imports")).handleValidateTask({ taskId });
  const task = await db.importTask.findUniqueOrThrow({ where: { id: taskId } });
  expect(task.status).toBe("preview_ready");
  const { POST: commitPost } = await import("@/app/api/v1/imports/[id]/commit/route");
  const c = await commitPost(
    req(`/api/v1/imports/${taskId}/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview_version: task.previewVersion, confirmation: true }) }, owner.cookie),
    { params: Promise.resolve({ id: taskId }) },
  );
  expect([200, 202]).toContain(c.status);
  const run = await db.jobRun.findFirstOrThrow({
    where: { orgId, storeId, jobKind: "recompute_snapshot" },
    orderBy: { createdAt: "desc" },
  });
  const version = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion;
  return { run, task, version };
}

function stubBuilders() {
  for (const kind of ["metrics", "cohort", "rules"] as const) {
    registerSnapshotBuilder(kind, { build: async () => undefined });
  }
}

describe("TASK-013 持久任务与快照发布骨架", () => {
  it("F01 pure: latestDueEvaluation 推进/不重复/未到点不推进（Asia/Shanghai）", () => {
    // 2026-09-27T20:00+08:00（已过当日08:00）→ 当日为最近到期
    const now = new Date("2026-09-27T12:00:00Z");
    const due = latestDueEvaluation("Asia/Shanghai", now, null);
    expect(due?.date).toBe("2026-09-27");
    expect(due?.at.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    // 已推进过当日 → 无到期
    expect(latestDueEvaluation("Asia/Shanghai", now, "2026-09-27")).toBeNull();
    // 昨日已推进 → 今日已到期 → 今日
    expect(latestDueEvaluation("Asia/Shanghai", now, "2026-09-26")?.date).toBe("2026-09-27");
    // 早于当日08:00 → 最近已到期是昨日；昨日已推进 → 无新到期
    const beforeEight = new Date("2026-09-27T22:30:00Z"); // 本地 09-28 06:30，未到28日08:00
    expect(latestDueEvaluation("Asia/Shanghai", beforeEight, "2026-09-27")).toBeNull();
    expect(latestDueEvaluation("Asia/Shanghai", beforeEight, "2026-09-26")?.date).toBe("2026-09-27");
  });

  it("提交成功但入队前崩溃：JobRun 落账 pending，sweepJobRuns 兜底派发并推进 ImportTask outbox", async () => {
    const { run, task } = await committedBump("crash");
    expect(run.status).toBe("pending");
    expect(run.outboxStatus).toBe("pending");
    expect((run.context as { source_task_id?: string }).source_task_id).toBe(task.id);
    const taskRow = await db.importTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(taskRow.outboxStatus).toBe("pending"); // G2 合同：提交事务写 pending

    const swept = await sweepJobRuns(Date.now() + 60_000); // 模拟 stale 窗口已过
    expect(swept.dispatched).toBeGreaterThanOrEqual(1);
    const runAfter = await db.jobRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(runAfter.outboxStatus).toBe("dispatched");
    const taskAfter = await db.importTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(taskAfter.outboxStatus).toBe("dispatched");
  });

  it("缺完成标记：未注册齐 metrics/cohort/rules 时不发布半份快照", async () => {
    const { run } = await committedBump("half");
    registerSnapshotBuilder("metrics", { build: async () => undefined }); // 只注册一类
    const outcome = await runRebuildJob(run.id, db);
    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("SNAPSHOT_BUILDERS_INCOMPLETE");
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.currentSnapshotVersion).toBeNull(); // 从未发布
  });

  it("齐备构建器：构建→CAS发布指针翻转→快照ready；重投幂等", async () => {
    const { run, version } = await committedBump("full");
    stubBuilders();
    const first = await runRebuildJob(run.id, db);
    expect(first.status).toBe("succeeded");
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.currentSnapshotVersion).toBe(version);
    expect(store.currentSnapshotRulesetVersion).toBe(store.rulesetVersion);
    expect(store.snapshotStatus).toBe("ready");
    // 幂等重投：再次执行直接成功且不重复副作用
    const second = await runRebuildJob(run.id, db);
    expect(second.status).toBe("succeeded");
    const store2 = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store2.currentSnapshotVersion).toBe(version);
  });

  it("并发导入：旧版本任务被 superseded，不顶替新版发布", async () => {
    const first = await committedBump("v1");
    stubBuilders();
    // 先执行 v1：发布
    expect((await runRebuildJob(first.run.id, db)).status).toBe("succeeded");
    const second = await committedBump("v2");
    // 再执行 v2：发布并保留历史
    expect((await runRebuildJob(second.run.id, db)).status).toBe("succeeded");
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.currentSnapshotVersion).toBe(second.version);
    expect(store.previousSnapshotVersion).toBe(first.version); // 历史保留
    // 模拟“旧任务在更高版本发布后才执行”（如迟到重投）：已被取代
    const third = await committedBump("v3");
    expect((await runRebuildJob(third.run.id, db)).status).toBe("succeeded");
    // 手工把 first（旧输入）置回 pending 再跑 → superseded，不回退指针
    await db.jobRun.update({ where: { id: first.run.id }, data: { status: "pending", finishedAt: null } });
    const stale = await runRebuildJob(first.run.id, db);
    expect(stale.status).toBe("superseded");
    const storeAfter = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(storeAfter.currentSnapshotVersion).toBe(third.version);
  });

  it("悬挂 running 恢复：sweep 回 pending 重试，超限落 failed", async () => {
    const { run } = await committedBump("stuck");
    stubBuilders();
    await db.jobRun.update({
      where: { id: run.id },
      data: { status: "running", attemptCount: 1, updatedAt: new Date(Date.now() - 20 * 60_000) },
    });
    const swept = await sweepJobRuns(Date.now());
    expect(swept.retried).toBeGreaterThanOrEqual(1);
    const retried = await db.jobRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(retried.status).toBe("pending");
    // 超限：attempt≥3 的悬挂 running → failed JOB_RETRY_EXHAUSTED
    const { run: run2 } = await committedBump("exhaust");
    await db.jobRun.update({
      where: { id: run2.id },
      data: { status: "running", attemptCount: 3, updatedAt: new Date(Date.now() - 20 * 60_000) },
    });
    await sweepJobRuns(Date.now());
    const exhausted = await db.jobRun.findUniqueOrThrow({ where: { id: run2.id } });
    expect(exhausted.status).toBe("failed");
    expect(exhausted.errorCode).toBe("JOB_RETRY_EXHAUSTED");
  });

  it("F01 evaluationTick：推进最近到期评估、无事实不调度、重复 tick 不重复推进", async () => {
    // 独立空店（无事实）：只推进评估字段，不建 JobRun
    const emptyStore = (
      await db.store.create({
        data: { orgId, name: "空评估店", externalStoreId: `SNAP-E-${randomUUID().slice(0, 6)}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
      })
    ).id;
    const now = new Date("2026-09-27T12:00:00Z"); // 本地20:00，当日08:00已过
    const before = await db.jobRun.count({ where: { storeId: emptyStore } });
    const tick1 = await evaluationTick(db, now);
    expect(tick1.advanced).toBeGreaterThanOrEqual(1);
    const empty = await db.store.findUniqueOrThrow({ where: { id: emptyStore } });
    expect(empty.lastEvaluationDate?.toISOString().slice(0, 10)).toBe("2026-09-27");
    expect(empty.inputEvaluationAt?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(await db.jobRun.count({ where: { storeId: emptyStore } })).toBe(before); // datasetVersion=0 不调度

    // 有事实的店：同目标复用（uq_job_run_recompute_target），不新增行；
    // 评估身份为规范08:00（提交时间无关），当前最新 run 即承载该评估
    const runsBefore = await db.jobRun.count({ where: { storeId, jobKind: "recompute_snapshot" } });
    const tick2 = await evaluationTick(db, now);
    expect(tick2.advanced).toBe(0); // 同一时刻重复 tick：无新到期
    expect(await db.jobRun.count({ where: { storeId, jobKind: "recompute_snapshot" } })).toBe(runsBefore);
    const latest = await db.jobRun.findFirstOrThrow({
      where: { storeId, jobKind: "recompute_snapshot" },
      orderBy: { createdAt: "desc" },
    });
    expect((latest.context as { evaluation_at?: string }).evaluation_at).toBe("2026-09-27T00:00:00.000Z");
    // 同评估重跑：幂等成功，不翻转版本指针
    stubBuilders();
    const out = await runRebuildJob(latest.id, db);
    expect(out.status).toBe("succeeded");
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(store.currentSnapshotEvaluationAt?.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    const versionNow = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion;
    expect(store.currentSnapshotVersion).toBe(versionNow);
  });

  it("requestRebuild 幂等：同目标复用既有运行（库上唯一索引同语义），failed 可重试、更晚评估复用同行重跑", async () => {
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    const a = await requestRebuild({ db, orgId, storeId, datasetVersion: store.datasetVersion, rulesetVersion: store.rulesetVersion, evaluationAt: new Date("2026-09-27T00:00:00Z"), sourceTaskId: null });
    const b = await requestRebuild({ db, orgId, storeId, datasetVersion: store.datasetVersion, rulesetVersion: store.rulesetVersion, evaluationAt: new Date("2026-09-27T00:00:00Z"), sourceTaskId: null });
    expect(b.reused).toBe(true);
    expect(b.id).toBe(a.id);
    await db.jobRun.update({ where: { id: a.id }, data: { status: "failed" } });
    const c = await requestRebuild({ db, orgId, storeId, datasetVersion: store.datasetVersion, rulesetVersion: store.rulesetVersion, evaluationAt: new Date("2026-09-27T00:00:00Z"), sourceTaskId: null });
    expect(c.id).toBe(a.id);
    expect((await db.jobRun.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("pending");
    // 更晚评估身份：同目标复用该行并回到待跑
    const d = await requestRebuild({ db, orgId, storeId, datasetVersion: store.datasetVersion, rulesetVersion: store.rulesetVersion, evaluationAt: new Date("2026-09-28T00:00:00Z"), sourceTaskId: null });
    expect(d.id).toBe(a.id);
    const row = await db.jobRun.findUniqueOrThrow({ where: { id: a.id } });
    expect((row.context as { evaluation_at?: string }).evaluation_at).toBe("2026-09-28T00:00:00.000Z");
    expect(row.status).toBe("pending");
  });
});
