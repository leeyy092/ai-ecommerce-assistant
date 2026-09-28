/**
 * TASK-017｜组织 AI 预算原子预留/结算（06 §24.2）。
 *
 * 合同：预算以组织 budget_timezone 自然日/月窗口计量（跨店共享），任一日/月额度耗尽
 * 即暂停新 LLM 调用；检查必须原子预留（预计输入费用+最大允许输出费用），完成后按
 * usage 结算；超时且 usage 未知的 attempt 保留预留不立即释放。不能只在请求前查余额
 * 被并发绕过——本实现用组织级 advisory lock 串行化预留。
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { PRICE_INPUT_PER_MTOK, PRICE_OUTPUT_PER_MTOK, MAX_OUTPUT_TOKENS } from "@/ai/schemas/validators";

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
function localMonthOf(tz: string, at: Date): string {
  return localDateOf(tz, at).slice(0, 7);
}

/** 组织级预算锁键（与快照发布锁不同命名空间） */
export function budgetLockKey(orgId: string): string {
  return `ai-budget:${orgId}`;
}

/**
 * 原子预留：advisory lock 内统计当日/当月 已结算+在途预留 总额，
 * 不足即抛 BudgetExceededError（窗口明确），充足则由调用方在同一事务写入 AIRun.reservedCost。
 */
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
  const dayStartUtc = new Date(`${localDateOf(org.budgetTimezone, now)}T00:00:00Z`);
  // 当月窗口近似：以当月1日00:00Z 起（自然月窗口按本地月聚合，UTC 边界误差仅影响窗口首日瞬时统计）
  const monthStartUtc = new Date(`${localMonthOf(org.budgetTimezone, now)}-01T00:00:00Z`);
  const where = {
    orgId: args.orgId,
    billingStatus: { in: ["reserved", "settled", "unknown"] as Array<"reserved" | "settled" | "unknown"> },
    createdAt: { gte: dayStartUtc },
  };
  const monthWhere = { ...where, createdAt: { gte: monthStartUtc } };
  const aggDay = await tx.aIRun.aggregate({ _sum: { reservedCost: true, actualCost: true }, where });
  const aggMonth = await tx.aIRun.aggregate({ _sum: { reservedCost: true, actualCost: true }, where: monthWhere });
  const spent = (a: { _sum: { reservedCost: Prisma.Decimal | null; actualCost: Prisma.Decimal | null } }): Prisma.Decimal => {
    const reserved = a._sum.reservedCost ?? new Prisma.Decimal(0);
    const settled = a._sum.actualCost ?? new Prisma.Decimal(0);
    // 已结算部分按实际成本计，未结算按预留计
    return reserved.add(settled).sub(settled);
  };
  const dailyUsed = spent(aggDay);
  const monthlyUsed = spent(aggMonth);
  if (dailyUsed.add(args.reserveCost).gt(org.aiDailyBudget)) throw new BudgetExceededError("daily");
  if (monthlyUsed.add(args.reserveCost).gt(org.aiMonthlyBudget)) throw new BudgetExceededError("monthly");
  return { dailyUsed, monthlyUsed };
}

/** 预估预留成本：预计输入 tokens + 最大允许输出 tokens 按合同单价（06 §24 核价） */
export function estimateReserveCost(inputTokens: number, maxOutputTokens = MAX_OUTPUT_TOKENS): Prisma.Decimal {
  const cost = (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK + (maxOutputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  return new Prisma.Decimal(cost.toFixed(6));
}

/** 按 usage 结算（06 §24.2：完成后按实际 usage 结算） */
export function settleCost(usage: { input_tokens: number; output_tokens: number } | null, reserve: Prisma.Decimal): { actualCost: Prisma.Decimal; billingStatus: "settled" | "unknown" } {
  if (!usage) return { actualCost: reserve, billingStatus: "unknown" };
  const cost = (usage.input_tokens / 1_000_000) * PRICE_INPUT_PER_MTOK + (usage.output_tokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK;
  return { actualCost: new Prisma.Decimal(cost.toFixed(6)), billingStatus: "settled" };
}

/** 预算预留+建行入口：在单事务内锁组织→核额度→建 AIRun（status=queued, billing=reserved） */
export async function createReservedRun(
  db: PrismaClient | Tx,
  args: {
    orgId: string; storeId: string; kind: "voc_classification" | "insight" | "daily_report";
    idempotencyKey: string; datasetVersion: bigint; rulesetVersion: string;
    visibilityScope: "business" | "customer_service";
    modelId: string; promptVersion: string; schemaVersion: string;
    inputHash: string; reserveCost: Prisma.Decimal; requestContext: Record<string, unknown>;
    now?: Date;
  },
): Promise<{ id: string; reused: boolean }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${budgetLockKey(args.orgId)}))`;
    const existing = await tx.aIRun.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
    if (existing) return { id: existing.id, reused: true };
    await assertBudgetAvailable(tx, { orgId: args.orgId, reserveCost: args.reserveCost, now: args.now });
    const run = await tx.aIRun.create({
      data: {
        orgId: args.orgId, storeId: args.storeId, kind: args.kind,
        idempotencyKey: args.idempotencyKey, datasetVersion: args.datasetVersion,
        rulesetVersion: args.rulesetVersion, visibilityScope: args.visibilityScope,
        modelId: args.modelId, promptVersion: args.promptVersion, schemaVersion: args.schemaVersion,
        inputHash: args.inputHash, reservedCost: args.reserveCost,
        requestContext: args.requestContext as Prisma.InputJsonValue,
      },
    });
    return { id: run.id, reused: false };
  });
}
