/**
 * TASK-017｜组织 AI 预算原子预留/结算（06 §24.2；T017R1 H03/H04/H05 修复版）。
 *
 * 合同：预算以组织 budget_timezone 自然日/月窗口计量（本地边界换算 UTC 瞬间，不近似）；
 * 每次真实 attempt 独立原子预留（预计输入+最大允许输出费用），有 usage 即按实际结算并
 * 释放差额；超时且 usage 未知保留该次预留；已释放但有实际消耗（付费失败）仍计入预算；
 * 超额不得继续调用。预留/结算统计 = Σ(actual_cost) + Σ(未结算 reserved_cost)。
 * 尝试计数持久化于 ai_run.attempt_count，跨 Worker 共享总上限。
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { PRICE_INPUT_PER_MTOK, PRICE_OUTPUT_PER_MTOK, MAX_OUTPUT_TOKENS } from "@/ai/schemas/validators";
import { localInstantOf } from "@/services/snapshot";

type Tx = Prisma.TransactionClient;

export class BudgetExceededError extends Error {
  readonly window: "daily" | "monthly";
  constructor(window: "daily" | "monthly") {
    super(`AI_${window === "daily" ? "DAILY" : "MONTHLY"}_BUDGET_EXCEEDED`);
    this.window = window;
  }
}

function localDateOf(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** H05：按组织时区求本地日/月起始的 UTC 瞬间（两遍逼近消除 DST 偏差，复用快照口径） */
export function localDayStartUtc(tz: string, at: Date): Date {
  return localInstantOf(tz, localDateOf(tz, at), 0, 0);
}
export function localMonthStartUtc(tz: string, at: Date): Date {
  return localInstantOf(tz, `${localDateOf(tz, at).slice(0, 7)}-01`, 0, 0);
}

/** 组织级预算锁键 */
export function budgetLockKey(orgId: string): string {
  return `ai-budget:${orgId}`;
}
/** 组织级执行锁键（H03：跨进程单组织并发 1） */
export function orgExecutionLockKey(orgId: string): string {
  return `ai-org-exec:${orgId}`;
}

async function spentSince(tx: Tx, orgId: string, since: Date): Promise<Prisma.Decimal> {
  // H04/R3-L03：费用/预留按每次 attempt 的 claim 时刻归属预算窗口（逐attempt账本为主）；
  // 无账本行的历史/合成 ai_run 行回退整行口径（按 run.created_at），不双重计算。
  // 归属口径（L03）：已结算/已释放按 attempt 发生时刻（l.created_at）归属；
  // usage 未知的未决预留（超时/崩溃）挂任务原始预算日（run.created_at），
  // 跨日恢复不把昨日未决预留搬入今日，也不把今日实际费用挂到昨日。
  const ledgerRows = await tx.$queryRaw<Array<{ spent: Prisma.Decimal | string | null }>>`
    SELECT COALESCE(SUM(
      CASE WHEN l.status = 'released' THEN COALESCE(l.actual_cost, 0)
           ELSE COALESCE(l.actual_cost, l.reserve_cost) END
    ), 0) AS spent
    FROM ai_attempt_ledger l
    JOIN ai_run r ON r.id = l.run_id
    WHERE l.org_id = ${orgId}
      AND (CASE WHEN l.status = 'reserved' THEN r.created_at ELSE l.created_at END) >= ${since}::timestamptz`;
  const legacyRows = await tx.$queryRaw<Array<{ spent: Prisma.Decimal | string | null }>>`
    SELECT COALESCE(SUM(COALESCE(r.actual_cost, 0) + r.reserved_cost), 0) AS spent
    FROM ai_run r
    WHERE r.org_id = ${orgId} AND r.created_at >= ${since}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM ai_attempt_ledger l WHERE l.run_id = r.id)`;
  const a = ledgerRows[0]?.spent;
  const b = legacyRows[0]?.spent;
  return new Prisma.Decimal((a ?? 0).toString()).add(new Prisma.Decimal((b ?? 0).toString()));
}

/** 原子预留检查：advisory lock 内统计当日/当月已耗（实际+未决），不足抛 BudgetExceededError */
export async function assertBudgetAvailable(
  tx: Tx,
  args: { orgId: string; reserveCost: Prisma.Decimal; now?: Date },
): Promise<{ dailyUsed: Prisma.Decimal; monthlyUsed: Prisma.Decimal }> {
  const now = args.now ?? new Date();
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: args.orgId },
    select: { aiDailyBudget: true, aiMonthlyBudget: true, budgetTimezone: true, aiEnabled: true },
  });
  if (!org.aiEnabled) throw new BudgetExceededError("daily");
  const dayStart = localDayStartUtc(org.budgetTimezone, now);
  const monthStart = localMonthStartUtc(org.budgetTimezone, now);
  const dailyUsed = await spentSince(tx, args.orgId, dayStart);
  const monthlyUsed = await spentSince(tx, args.orgId, monthStart);
  if (dailyUsed.add(args.reserveCost).gt(org.aiDailyBudget)) throw new BudgetExceededError("daily");
  if (monthlyUsed.add(args.reserveCost).gt(org.aiMonthlyBudget)) throw new BudgetExceededError("monthly");
  return { dailyUsed, monthlyUsed };
}

/** 预估单次 attempt 成本：预计输入 tokens + 最大允许输出 tokens（06 §24 核价） */
export function estimateReserveCost(inputTokens: number, maxOutputTokens = MAX_OUTPUT_TOKENS): Prisma.Decimal {
  const cost = (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK + (maxOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  return new Prisma.Decimal(cost.toFixed(6));
}

/** 单次 usage 实际成本 */
export function usageCost(usage: { input_tokens: number; output_tokens: number }): Prisma.Decimal {
  const cost = (usage.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK + (usage.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  return new Prisma.Decimal(cost.toFixed(6));
}

/** H03：持久化尝试 claim——原子递增 attempt_count，超上限拒绝；同时做本 attempt 的独立预算预留。
 *  预算口径：reserved_cost 列 = 未决预留总额（claim 加、settle/释放减）。 */
export interface AttemptClaim {
  attemptNo: number;
  reserveCost: Prisma.Decimal;
}

export async function claimAttempt(
  tx: Tx,
  args: { runId: string; orgId: string; inputTokens: number; now?: Date },
): Promise<{ status: "claimed"; claim: AttemptClaim } | { status: "attempts-exhausted" } | { status: "budget-exceeded"; window: "daily" | "monthly" }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${budgetLockKey(args.orgId)}))`;
  const run = await tx.aIRun.findUniqueOrThrow({ where: { id: args.runId }, select: { attemptCount: true, status: true } });
  if (run.status === "succeeded" || run.status === "skipped" || run.status === "superseded") return { status: "attempts-exhausted" };
  if (run.attemptCount >= 3) return { status: "attempts-exhausted" };
  const reserveCost = estimateReserveCost(args.inputTokens);
  try {
    await assertBudgetAvailable(tx, { orgId: args.orgId, reserveCost, now: args.now });
  } catch (error) {
    if (error instanceof BudgetExceededError) return { status: "budget-exceeded", window: error.window };
    throw error;
  }
  const updated = await tx.aIRun.update({
    where: { id: args.runId },
    data: { attemptCount: { increment: 1 }, status: "running", reservedCost: { increment: reserveCost } },
    select: { attemptCount: true },
  });
  // L03：账本行按本次 claim 时刻归属预算窗口
  await tx.aiAttemptLedger.create({
    data: { orgId: args.orgId, runId: args.runId, attemptNo: updated.attemptCount, reserveCost, createdAt: args.now ?? new Date() },
  });
  return { status: "claimed", claim: { attemptNo: updated.attemptCount, reserveCost } };
}

/** H04：单次 attempt 结算——有 usage 即按实际计（reserved 减、actual 加、token 累计）；
 *  usage 未知（超时）保留未决预留。返回该次累计后快照。 */
export async function settleAttempt(
  tx: Tx,
  args: { runId: string; usage: { input_tokens: number; output_tokens: number } | null; reserveCost: Prisma.Decimal; attemptNo: number },
): Promise<void> {
  if (!args.usage) return; // 未知 usage：保留预留（06 §24.2）
  const cost = usageCost(args.usage);
  // 可空列初始为 NULL：Prisma increment 对 NULL 得 NULL，用 COALESCE 原生累加
  await tx.$executeRaw`
    UPDATE ai_run SET
      input_tokens = COALESCE(input_tokens, 0) + ${args.usage.input_tokens}::bigint,
      output_tokens = COALESCE(output_tokens, 0) + ${args.usage.output_tokens}::bigint,
      actual_cost = COALESCE(actual_cost, 0) + ${cost.toString()}::numeric,
      reserved_cost = reserved_cost - ${args.reserveCost.toString()}::numeric
    WHERE id = ${args.runId}`;
  // L03：账本行同步结算（该 attempt 归属其 claim 时刻的窗口）
  await tx.aiAttemptLedger.updateMany({
    where: { runId: args.runId, attemptNo: args.attemptNo },
    data: { actualCost: cost, status: "settled" },
  });
}

/** H04：放弃未决预留（无消耗的终态失败，如鉴权前错误） */
export async function releaseOutstanding(tx: Tx, args: { runId: string; reserveCost: Prisma.Decimal; attemptNo: number }): Promise<void> {
  await tx.aIRun.update({
    where: { id: args.runId },
    data: { reservedCost: { decrement: args.reserveCost } },
  });
  await tx.aiAttemptLedger.updateMany({
    where: { runId: args.runId, attemptNo: args.attemptNo },
    data: { status: "released" },
  });
}

/** 预算预留+建行入口：组织锁内复用（同派生键）或新建 AIRun（status=queued） */
export async function createReservedRun(
  db: PrismaClient | Tx,
  args: {
    orgId: string; storeId: string; kind: "voc_classification" | "insight" | "daily_report";
    idempotencyKey: string; datasetVersion: bigint; rulesetVersion: string;
    visibilityScope: "business" | "customer_service";
    modelId: string; promptVersion: string; schemaVersion: string;
    inputHash: string; requestContext: Record<string, unknown>;
    now?: Date;
  },
): Promise<{ id: string; reused: boolean }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${budgetLockKey(args.orgId)}))`;
    const existing = await tx.aIRun.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
    if (existing) return { id: existing.id, reused: true };
    const run = await tx.aIRun.create({
      data: {
        orgId: args.orgId, storeId: args.storeId, kind: args.kind,
        idempotencyKey: args.idempotencyKey, datasetVersion: args.datasetVersion,
        rulesetVersion: args.rulesetVersion, visibilityScope: args.visibilityScope,
        modelId: args.modelId, promptVersion: args.promptVersion, schemaVersion: args.schemaVersion,
        inputHash: args.inputHash, reservedCost: new Prisma.Decimal(0),
        requestContext: args.requestContext as Prisma.InputJsonValue,
      },
    });
    return { id: run.id, reused: false };
  });
}
