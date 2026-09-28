/**
 * TASK-017｜模型网关集成测试（真实 PostgreSQL + stub provider 故障注入）。
 * 覆盖：Schema/Ajv 金样（合法/多余属性/格式）；happy path 预算预留→usage结算→幂等复用；
 * 日/月预算耗尽跳过；并发预留串行；超时终态（保留预留 billing=unknown）；5xx重试后成功；
 * 鉴权立即终止（释放）；格式修复一次（修复后成功/仍失败SCHEMA_INVALID）；
 * 语义 UNKNOWN_REFERENCE 修复无效终态；超大输入 INPUT_TOO_LARGE。
 * 真实模型 contract（需 DASHSCOPE 三配置）另行 ai-real-contract.test.ts，未配置时如实跳过。
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";
import { setStorageRoot } from "@/storage";
import { validateLlmPayload, validateVocBatch, FIXED_MODEL_ID, PROMPT_VERSIONS, SCHEMA_VERSION } from "@/ai/schemas/validators";
import { ModelTransportError, type ModelRequest, type ModelResponse, type ModelTransport } from "@/ai/providers/model-provider";
import { runAiTask } from "@/ai/gateway";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));
setStorageRoot(mkdtempSync(join(tmpdir(), "aiea-storage-")));

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;
beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
}, 420_000);
afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

const UUID = (n: number): string => `0000000${n}-0000-4000-8000-00000000000${n}`;
const validLlmPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "销量下降需复核",
  category: "business",
  severity: "warning",
  summary: "昨日销量较同星期基准下降75%，建议核查漏单与活动结束。",
  evidence_ids: ["EV-1"],
  possible_causes: [
    { hypothesis_id: "H1", kind: "hypothesis", description: "活动结束导致自然回落", evidence_ids: ["EV-1"], verification_step: "对比活动订单占比" },
  ],
  recommended_actions: [
    { action_id: "A1", title: "核查订单完整性", description: "检查导入覆盖与漏单", evidence_ids: ["EV-1"], hypothesis_ids: ["H1"], priority: "P1", expected_impact: { qualitative: "确认下降是否为数据缺口", metric_id: "units_sold", observation_days: 3 } },
  ],
  priority: "P1",
  related_skus: [],
  related_metrics: ["units_sold"],
  ...over,
});

function stubTransport(script: Array<(req: ModelRequest) => ModelResponse | Promise<ModelResponse> | never>): ModelTransport {
  let i = 0;
  return {
    async call(req: ModelRequest): Promise<ModelResponse> {
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      const out = step(req);
      return out as ModelResponse;
    },
  };
}
const ok = (payload: unknown): ModelResponse => ({ content: JSON.stringify(payload), usage: { input_tokens: 100, output_tokens: 50 } });
const badJson = (): ModelResponse => ({ content: "{不是JSON", usage: { input_tokens: 90, output_tokens: 10 } });

async function newOrgStore(budget?: { daily: string; monthly: string }): Promise<{ orgId: string; storeId: string }> {
  const t = randomUUID().slice(0, 8);
  const authUser = await db.authUser.create({ data: { id: randomUUID(), email: `ai-${t}@example.com`, name: "o", emailVerified: true } } as never);
  const user = await db.user.create({ data: { id: randomUUID(), authUserId: authUser.id, email: authUser.email, displayName: "o" } });
  const org = await db.organization.create({
    data: { name: `AI组织${t}`, ownerUserId: user.id, ...(budget ? { aiDailyBudget: budget.daily, aiMonthlyBudget: budget.monthly } : {}) },
  });
  const store = await db.store.create({ data: { orgId: org.id, name: `AI店${t}`, externalStoreId: `AI-${t}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } });
  return { orgId: org.id, storeId: store.id };
}

const baseArgs = (s: { orgId: string; storeId: string }, key: string, transport: ModelTransport) => ({
  db, orgId: s.orgId, storeId: s.storeId, kind: "insight" as const,
  idempotencyKey: key, datasetVersion: 1n, rulesetVersion: "rules-v1-init",
  visibilityScope: "business" as const,
  systemPrompt: "你是电商运营分析师，只输出JSON。",
  userPrompt: "基于证据生成洞察。",
  semantic: { whitelist: { evidenceIds: new Set(["EV-1"]), skuIds: new Set([UUID(1)]), metricIds: new Set(["units_sold", "gmv"]) } },
  transport,
  timeoutMs: 200, backoffMs: [1, 1], sleep: async () => {},
});

describe("TASK-017 Schema 金样（Ajv 唯一真源）", () => {
  it("合法 llmPayload 通过；多余属性拒绝；非法枚举拒绝", () => {
    expect(validateLlmPayload(validLlmPayload())).toBe(true);
    expect(validateLlmPayload(validLlmPayload({ extra_field: 1 }))).toBe(false);
    expect(validateLlmPayload(validLlmPayload({ severity: "super" }))).toBe(false);
    expect(validateLlmPayload(validLlmPayload({ related_metrics: [] }))).toBe(false); // minItems 1
  });
  it("vocBatch 文档示例通过；主标签重复进 secondary 拒绝由语义层处理", () => {
    const doc = { taxonomy_version: "voc-v1", results: [{ message_id: UUID(2), label: "refund_process", secondary_labels: [], sentiment: "neutral", evidence_spans: [{ start: 0, end: 11, text: "如何查看退货的处理进度" }] }] };
    expect(validateVocBatch(doc)).toBe(true);
    expect(validateVocBatch({ taxonomy_version: "voc-v2", results: [] })).toBe(false);
  });
});

describe("TASK-017 网关（stub 故障注入 + 真实预算表）", () => {
  it("happy path：预留→usage结算 settled→幂等复用；固定模型/版本登记", async () => {
    const s = await newOrgStore();
    const r1 = await runAiTask(baseArgs(s, `happy-${randomUUID().slice(0, 8)}`, stubTransport([() => ok(validLlmPayload())])));
    expect(r1.status).toBe("succeeded");
    const row = await db.aIRun.findUniqueOrThrow({ where: { id: r1.runId } });
    expect(row.status).toBe("succeeded");
    expect(row.modelId).toBe(FIXED_MODEL_ID);
    expect(row.promptVersion).toBe(PROMPT_VERSIONS.insight);
    expect(row.schemaVersion).toBe(SCHEMA_VERSION);
    expect(row.billingStatus).toBe("settled");
    expect(row.actualCost?.toFixed(6)).toBe(((100 / 1_000_000) * 0.15 + (50 / 1_000_000) * 1.5).toFixed(6));
    expect(row.inputTokens).toBe(100n);
    // 相同幂等键：直接复用，不再调用模型
    const r2 = await runAiTask(baseArgs(s, row.idempotencyKey, stubTransport([() => { throw new Error("不应再调用"); }])));
    expect(r2.status).toBe("reused");
    expect(r2.runId).toBe(r1.runId);
    expect((await db.aIRun.count({ where: { storeId: s.storeId } }))).toBe(1);
  });

  it("日预算耗尽：跳过并给明确错误码，不建行", async () => {
    const s = await newOrgStore({ daily: "0.000001", monthly: "100" });
    const r = await runAiTask(baseArgs(s, `bud-${randomUUID().slice(0, 8)}`, stubTransport([() => ok(validLlmPayload())])));
    expect(r.status).toBe("skipped");
    expect(r.errorCode).toBe("AI_DAILY_BUDGET_EXCEEDED");
    expect(await db.aIRun.count({ where: { storeId: s.storeId } })).toBe(0);
  });

  it("月预算耗尽同样跳过", async () => {
    const s = await newOrgStore({ daily: "3", monthly: "0.000001" });
    const r = await runAiTask(baseArgs(s, `budm-${randomUUID().slice(0, 8)}`, stubTransport([() => ok(validLlmPayload())])));
    expect(r.errorCode).toBe("AI_MONTHLY_BUDGET_EXCEEDED");
  });

  it("并发预留串行：两笔同时只允许额度内赢家", async () => {
    const s = await newOrgStore({ daily: "0.2", monthly: "100" });
    const key = () => `par-${randomUUID().slice(0, 12)}`;
    const mk = () => runAiTask(baseArgs(s, key(), stubTransport([() => { throw new ModelTransportError("TIMEOUT", true); }])));
    const results = await Promise.all([mk(), mk()]);
    // 预留费用按16k输入+6k输出上限估算 ≈ 0.009+0.009=0.018；0.2 额度两笔都够——
    // 该断言验证锁不互斥成功；额度不足场景由下一断言覆盖
    expect(results.every((r) => r.status === "failed" && r.errorCode === "TIMEOUT")).toBe(true);
    const s2 = await newOrgStore({ daily: "0.018", monthly: "100" });
    const mk2 = () => runAiTask(baseArgs(s2, `par2-${randomUUID().slice(0, 12)}`, stubTransport([() => { throw new ModelTransportError("TIMEOUT", true); }])));
    const r2 = await Promise.all([mk2(), mk2()]);
    const statuses = r2.map((x) => x.status).sort();
    expect(statuses).toContain("skipped"); // 第二笔在第一笔预留后超额
    expect(r2.filter((x) => x.status === "skipped").every((x) => x.errorCode === "AI_DAILY_BUDGET_EXCEEDED")).toBe(true);
  });

  it("超时：有限重试后终态 failed/TIMEOUT，usage 未知保留预留 billing=unknown", async () => {
    const s = await newOrgStore();
    const hang: ModelTransport = { call: (_req, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); }) };
    const r = await runAiTask(baseArgs(s, `to-${randomUUID().slice(0, 8)}`, hang));
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("TIMEOUT");
    const row = await db.aIRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(row.billingStatus).toBe("unknown"); // 保留预留，不立即释放
    expect(row.finishedAt).not.toBeNull();
    expect((row.attempts as Array<{ code?: string }>).some((a) => a.code === "TIMEOUT")).toBe(true);
  });

  it("5xx 一次后退避重试成功", async () => {
    const s = await newOrgStore();
    const t = stubTransport([
      (): never => { throw new ModelTransportError("PROVIDER_5XX", true, 502); },
      () => ok(validLlmPayload()),
    ]);
    const r = await runAiTask(baseArgs(s, `r5-${randomUUID().slice(0, 8)}`, t));
    expect(r.status).toBe("succeeded");
  });

  it("鉴权错误立即终止并释放预留", async () => {
    const s = await newOrgStore();
    const t = stubTransport([(): never => { throw new ModelTransportError("AUTH_ERROR", false, 401); }]);
    const r = await runAiTask(baseArgs(s, `auth-${randomUUID().slice(0, 8)}`, t));
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("AUTH_ERROR");
    const row = await db.aIRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(row.billingStatus).toBe("released");
  });

  it("格式错误一次修复后成功（计入总尝试）", async () => {
    const s = await newOrgStore();
    const t = stubTransport([() => badJson(), () => ok(validLlmPayload())]);
    const r = await runAiTask(baseArgs(s, `fmt-${randomUUID().slice(0, 8)}`, t));
    expect(r.status).toBe("succeeded");
    const row = await db.aIRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect((row.attempts as Array<{ type?: string }>).some((a) => a.type === "format_repair")).toBe(true);
  });

  it("格式持续错误：SCHEMA_INVALID 终态", async () => {
    const s = await newOrgStore();
    const r = await runAiTask(baseArgs(s, `fmtbad-${randomUUID().slice(0, 8)}`, stubTransport([() => badJson()])));
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("SCHEMA_INVALID");
  });

  it("语义 UNKNOWN_REFERENCE：修复无效后 SEMANTIC_INVALID 终态", async () => {
    const s = await newOrgStore();
    const payload = validLlmPayload({ related_skus: [UUID(9)] }); // 不在白名单
    const r = await runAiTask(baseArgs(s, `sem-${randomUUID().slice(0, 8)}`, stubTransport([() => ok(payload), () => ok(payload)])));
    expect(r.status).toBe("failed");
    expect(r.errorCode).toBe("SEMANTIC_INVALID");
    const row = await db.aIRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect((row.attempts as Array<{ type?: string }>).some((a) => a.type === "semantic_repair")).toBe(true);
  });

  it("超大输入：INPUT_TOO_LARGE 跳过不调用模型", async () => {
    const s = await newOrgStore();
    const args = baseArgs(s, `big-${randomUUID().slice(0, 8)}`, stubTransport([() => ok(validLlmPayload())]));
    const r = await runAiTask({ ...args, userPrompt: "字".repeat(20000) });
    expect(r.status).toBe("skipped");
    expect(r.errorCode).toBe("INPUT_TOO_LARGE");
    expect(await db.aIRun.count({ where: { storeId: s.storeId } })).toBe(0);
  });
});
