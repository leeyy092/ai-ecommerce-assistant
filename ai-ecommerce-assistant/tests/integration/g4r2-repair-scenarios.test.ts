/**
 * G4R2-20260928-02 修复场景验证（真实 PostgreSQL；docs/reviews/gate-04-review-2-evidence
 * 冻结探针之外的维护副本，覆盖本轮新增能力）：
 * - H07：GET/PATCH /api/v1/alert-rules（读取/CAS/阈值白名单/P1不可启用/保守延续/
 *   ruleset+rule版本递增/触发重建并发布后禁用规则保留suppressed理由）。
 * - M02：metrics API metrics+series+baseline 结构、比例按分子分母范围重汇总、
 *   不同广告归因组实体不合并、grain 校验。
 * - R08：投诉子通道 is_complaint 标记覆盖不足 → suppressed。
 * - R09：不同分类版本不共用基准（隔离评估）。
 * - R05/R12：逐 ads:{model}:{window} 归因组评估（配置后不再配置性 suppressed）。
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
import { resetSnapshotBuildersForTests, runRebuildJob } from "@/services/snapshot";
import { registerBasicMetricsBuilder } from "@/services/metrics/basic";
import { registerCohortMetricsBuilder } from "@/services/metrics/cohort";
import { registerRulesBuilder } from "@/services/alerts/engine";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));
setStorageRoot(mkdtempSync(join(tmpdir(), "aiea-storage-")));

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
process.env.UPLOAD_RATE_LIMIT_PER_MIN = "10000";

let db: PrismaClient;
type Auth = ReturnType<(typeof import("@/lib/auth"))["getAuth"]>;
let auth: Auth;
const PASSWORD = "g4r2-scene-123";
let owner: { cookie: string };
let orgId: string;

function req(path: string, init: RequestInit = {}, cookie?: string): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://127.0.0.1:3000${path}`, { ...init, headers } as ConstructorParameters<typeof NextRequest>[1]);
}

beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
  auth = (await import("@/lib/auth")).getAuth();
  const t = randomUUID().slice(0, 8);
  const { initOwner } = await import("@/services/ownerInit");
  const ownerEmail = `owner-g4r2scene-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `场景组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
    async (email, password, name) => {
      const result = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: false });
      return { authUserId: result.user.id };
    },
  );
  orgId = r.orgId;
  const rr = await auth.api.signInEmail({ body: { email: ownerEmail, password: PASSWORD }, asResponse: true });
  owner = { cookie: rr.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
}, 420_000);

afterEach(() => resetSnapshotBuildersForTests());

afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

const ts = "2026-09-11T01:00:00Z";

interface Scope { storeId: string; dataSourceId: string; sid: string }
async function newScope(): Promise<Scope> {
  const t = randomUUID().slice(0, 8);
  const sid = `SC-${t}`;
  const storeId = (await db.store.create({ data: { orgId, name: `场景店${t}`, externalStoreId: sid, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } })).id;
  const dataSourceId = (await db.dataSource.create({ data: { orgId, storeId, sourceNamespace: `ns-sc-${t}`, name: `源${t}`, adapterKind: "csv" } })).id;
  return { storeId, dataSourceId, sid };
}

async function good(s: Scope, kind: keyof typeof FILE_HEADERS, rows: string[], coverage?: unknown[]): Promise<string> {
  const { POST } = await import("@/app/api/v1/imports/route");
  const form = new FormData();
  form.set("store_id", s.storeId);
  form.set("data_source_id", s.dataSourceId);
  form.set("entity_type", kind);
  form.set("file", new File([`${FILE_HEADERS[kind].join(",")}\n${rows.join("\n")}`], `${kind}.csv`, { type: "text/csv" }));
  const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
  expect([200, 201]).toContain(res.status);
  const id = ((await res.json()) as { data: { id: string } }).data.id;
  if (coverage) {
    const { PUT } = await import("@/app/api/v1/imports/[id]/mapping/route");
    const put = await PUT(
      req(`/api/v1/imports/${id}/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: "Asia/Shanghai", coverage_declaration: coverage, expected_preview_version: 0 }) }, owner.cookie),
      { params: Promise.resolve({ id }) },
    );
    expect(put.status).toBe(202);
  }
  await (await import("@/jobs/handlers/imports")).handleValidateTask({ taskId: id });
  const task = await db.importTask.findUniqueOrThrow({ where: { id } });
  expect(task.status).toBe("preview_ready");
  const { POST: commitPost } = await import("@/app/api/v1/imports/[id]/commit/route");
  const c = await commitPost(
    req(`/api/v1/imports/${id}/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview_version: task.previewVersion, confirmation: true }) }, owner.cookie),
    { params: Promise.resolve({ id }) },
  );
  expect([200, 202]).toContain(c.status);
  return id;
}

const pRow = (sid: string, id: string) => `${sid},${ts},P-${id},杯,杯具,active,S-${id},CODE-${id},杯,,active`;
const cov = (kind: string, from: string, to: string, explicit: string[] = []) => [{ source_kind: kind, channel: "default", from, to, status: "complete", explicit_zero_dates: explicit }];
const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

async function dayOfSales(s: Scope, day: string, orders: number, qty: number, amount: string): Promise<void> {
  const orows: string[] = [];
  const irows: string[] = [];
  for (let i = 0; i < orders; i++) {
    const oid = `O-${day.replace(/-/g, "")}-${i}`;
    orows.push(`${s.sid},${ts},${oid},paid,${day}T01:55:00Z,${day}T02:00:00Z,CNY,1`);
    irows.push(`${s.sid},${ts},${oid},L1,S-1,${qty},${amount},CNY`);
  }
  await good(s, "orders", orows, cov("orders", day, addDay(day)));
  await good(s, "order_items", irows, cov("order_items", day, addDay(day)));
}

async function publish(storeId: string): Promise<string> {
  const run = await db.jobRun.findFirstOrThrow({ where: { storeId, jobKind: "recompute_snapshot" }, orderBy: { createdAt: "desc" } });
  const out = await runRebuildJob(run.id, db);
  expect(out.status).toBe("succeeded");
  return run.id;
}

function realBuilders() {
  registerBasicMetricsBuilder();
  registerCohortMetricsBuilder();
  registerRulesBuilder();
}

/** 直接造一条 CustomerMessage（真实导入链之外的最小落库；含必需 FK 字段） */
async function message(s: Scope, at: string, opts: { sentiment?: "positive" | "neutral" | "negative" | "unknown"; isComplaint?: boolean | null; channel?: string; classificationVersion?: string; importTaskId: string }): Promise<void> {
  const t = randomUUID().slice(0, 8);
  await db.customerMessage.create({
    data: {
      orgId, storeId: s.storeId, sourceNamespace: `ns-sc-${t}`, sourceUpdatedAt: new Date(at),
      importTaskId: opts.importTaskId, rowHash: randomUUID(), externalMessageId: `M-${t}`, externalConversationId: `C-${t}`,
      messageAt: new Date(at), channel: opts.channel ?? "chat", redactedText: "（脱敏）消息内容", language: "zh",
      isComplaint: opts.isComplaint ?? null,
      sentiment: opts.sentiment ?? "unknown",
      classificationVersion: opts.classificationVersion ?? null,
    },
  });
}

describe("G4R2 修复场景", () => {
  it("H07 alert-rules：读取/CAS/白名单/P1不可启用/保守延续/版本递增/重建后禁用保留理由", async () => {
    realBuilders();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    await dayOfSales(s, "2026-09-25", 2, 1, "10.000000");
    await publish(s.storeId);

    const { GET } = await import("@/app/api/v1/alert-rules/route");
    const g = await GET(req(`/api/v1/alert-rules?store_id=${s.storeId}`, {}, owner.cookie));
    expect(g.status).toBe(200);
    const body = (await g.json()) as { data: { items: Array<{ rule_id: string; enabled: boolean; config_version: number; p1_not_enableable: boolean; thresholds: Record<string, unknown> }> } };
    expect(body.data.items).toHaveLength(12);
    const r03 = body.data.items.find((x) => x.rule_id === "R03")!;
    const r05 = body.data.items.find((x) => x.rule_id === "R05")!;
    expect(r05.enabled).toBe(true); // 默认启用但金额未配置 → 构建时 suppressed
    expect(body.data.items.find((x) => x.rule_id === "R04")!.p1_not_enableable).toBe(true);

    const { PATCH } = await import("@/app/api/v1/alert-rules/[rule_id]/route");
    const patch = (ruleId: string, payload: Record<string, unknown>) =>
      PATCH(req(`/api/v1/alert-rules/${ruleId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ store_id: s.storeId, ...payload }) }, owner.cookie), { params: Promise.resolve({ rule_id: ruleId }) });

    // 阈值白名单：未知键 422
    const badKey = await patch("R03", { thresholds: { not_a_threshold: 1 }, expected_version: r03.config_version });
    expect(badKey.status).toBe(422);
    // P1 不可启用：R04 enabled=true → 422
    const p1 = await patch("R04", { enabled: true, expected_version: 0 });
    expect(p1.status).toBe(422);
    // CAS：错误 expected_version → 409
    const stale = await patch("R03", { enabled: false, expected_version: r03.config_version + 999 });
    expect(stale.status).toBe(409);

    // 正常修改：禁用 R03 并调整阈值 → 新 ruleset/rule 版本 + 重建任务
    const okRes = await patch("R03", { enabled: false, thresholds: { min_orders: 40 }, expected_version: r03.config_version });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { data: { rule_id: string; rule_version: number; ruleset_version: string; enabled: boolean; thresholds: Record<string, unknown>; rebuild_job_id: string } };
    expect(okBody.data.rule_version).toBe(2); // 已物化 v1 → 本次修改 v2
    expect(okBody.data.enabled).toBe(false);
    expect(okBody.data.thresholds.min_orders).toBe(40);
    expect(okBody.data.ruleset_version).not.toBe("rules-v1-init");
    const store = await db.store.findUniqueOrThrow({ where: { id: s.storeId } });
    expect(store.rulesetVersion).toBe(okBody.data.ruleset_version);

    // 保守延续：R05 在新 ruleset 下保留默认启用与参数（未被重置）
    const g2 = await GET(req(`/api/v1/alert-rules?store_id=${s.storeId}`, {}, owner.cookie));
    const items2 = ((await g2.json()) as { data: { items: Array<{ rule_id: string; enabled: boolean; thresholds: Record<string, unknown>; config_version: number }> } }).data.items;
    const r05b = items2.find((x) => x.rule_id === "R05")!;
    expect(r05b.enabled).toBe(true);
    expect(r05b.thresholds).toBeDefined();

    // 重建任务发布后：禁用的 R03 保留 suppressed 评估行与理由（C11 同链验证）
    await publish(s.storeId);
    const evalRow = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R03" }, orderBy: { updatedAt: "desc" } });
    expect(evalRow?.status).toBe("suppressed");
    expect(evalRow?.reasonCode).toBe("disabled_by_config");
  });

  it("M02 metrics：metrics+series+baseline 结构、比例重汇总分子分母、归因组不合并、grain 校验", async () => {
    realBuilders();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    // 两天销售金额不同：客单价范围值必须按 Σgmv/Σ单数 重算，而不是日比率平均
    await dayOfSales(s, "2026-09-24", 1, 1, "30.000000");
    await dayOfSales(s, "2026-09-25", 3, 1, "10.000000");
    // 两个归因组的广告
    await good(s, "ads", [
      `${s.sid},${ts},CAMP-1,活动A,2026-09-25,m7,7,100.000000,180.000000,CNY`,
      `${s.sid},${ts},CAMP-2,活动B,2026-09-25,m14,14,50.000000,90.000000,CNY`,
    ], cov("ads", "2026-09-25", "2026-09-26"));
    await publish(s.storeId);

    const { GET } = await import("@/app/api/v1/metrics/route");
    const res = await GET(req(`/api/v1/metrics?store_id=${s.storeId}&from=2026-09-25&to=2026-09-26&metric_ids=gmv,average_order_value,ad_spend&grain=day`, {}, owner.cookie));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        metrics: Array<{ metric_id: string; entity_key: string; value: string | number | null; numerator: string | null; denominator: string | null; baseline: { value: string | number | null; change_ratio: number | null; status: string } | null; unit: string }>;
        series: Array<{ metric_id: string; entity_key: string; period_start: string; value: string | number | null }>;
      };
    };
    const gmv = body.data.metrics.find((m) => m.metric_id === "gmv" && m.entity_key === "store")!;
    expect(gmv.value).toBe("30"); // Decimal求和去掉尾零，数值一致
    expect(gmv.unit).toBe("currency");
    // 09-24 有销售 → 前等长窗口基线可比
    expect(gmv.baseline?.status).toBe("comparable");
    expect(gmv.baseline?.value).toBe("30");
    const aov = body.data.metrics.find((m) => m.metric_id === "average_order_value")!;
    expect(aov.numerator).toBe("30");
    expect(aov.denominator).toBe("3");
    expect(Number(aov.value)).toBeCloseTo(10, 5); // 单日窗口：当日 3 单共 30 元 → Σ分子/Σ分母
    // 归因组实体分离：两组各自成行，不合并
    const spends = body.data.metrics.filter((m) => m.metric_id === "ad_spend");
    expect(spends.map((m) => m.entity_key).sort()).toEqual(["ads:m14:14", "ads:m7:7"]);
    expect(body.data.series.length).toBeGreaterThan(0);
    expect(body.data.series.some((r) => r.metric_id === "ad_spend" && r.entity_key === "ads:m7:7")).toBe(true);

    // grain 校验
    const badGrain = await GET(req(`/api/v1/metrics?store_id=${s.storeId}&from=2026-09-25&to=2026-09-26&grain=week`, {}, owner.cookie));
    expect(badGrain.status).toBe(422);
  });

  it("R08 投诉子通道：is_complaint 标记覆盖不足 → suppressed", async () => {
    realBuilders();
    const s = await newScope();
    const taskId = await good(s, "products", [pRow(s.sid, "1")]);
    await dayOfSales(s, "2026-09-25", 1, 1, "10.000000");
    // 三天投诉计数构成基准；最新一天存在未标记消息 → marking coverage < 100%
    for (const d of ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]) {
      for (let i = 0; i < 3; i++) await message(s, `${d}T05:00:00Z`, { isComplaint: d === "2026-09-25" && i === 0 ? null : i === 0, importTaskId: taskId });
    }
    await publish(s.storeId);
    const row = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R08", subchannel: "complaint_message" }, orderBy: { updatedAt: "desc" } });
    expect(row?.status).toBe("suppressed");
    expect(row?.reasonCode).toBe("complaint_marking_incomplete");
  });

  it("R09 分类版本隔离：v1 有历史触发，v2 仅当日 → 独立 suppressed 不共用基准", async () => {
    realBuilders();
    const s = await newScope();
    const taskId = await good(s, "products", [pRow(s.sid, "1")]);
    await dayOfSales(s, "2026-09-25", 1, 1, "10.000000");
    // v1：三个同星期一（08-31/09-07/09-14）构成同星期基准，当日负面率升高 → triggered(warning)
    for (const d of ["2026-08-31", "2026-09-07", "2026-09-14"]) {
      for (let i = 0; i < 31; i++) await message(s, `${d}T05:00:00Z`, { sentiment: i < 2 ? "negative" : "neutral", classificationVersion: "v1", importTaskId: taskId });
    }
    for (let i = 0; i < 31; i++) await message(s, `2026-09-21T05:00:00Z`, { sentiment: i < 16 ? "negative" : "neutral", classificationVersion: "v1", importTaskId: taskId });
    // v2：只有当日，无历史 → 独立 suppressed insufficient_history
    for (let i = 0; i < 31; i++) await message(s, `2026-09-21T06:00:00Z`, { sentiment: i < 16 ? "negative" : "neutral", classificationVersion: "v2", importTaskId: taskId });
    await publish(s.storeId);
    const rows = await db.ruleEvaluation.findMany({ where: { storeId: s.storeId, ruleId: "R09" } });
    const evidenceOf = (r: typeof rows[number]) => (r.evidence as { classification_version?: string | null });
    const v1 = rows.find((r) => evidenceOf(r)?.classification_version === "v1");
    const v2 = rows.find((r) => evidenceOf(r)?.classification_version === "v2");
    expect(v1?.status).toBe("triggered");
    expect(v2?.status).toBe("suppressed");
    expect(v2?.reasonCode).toBe("insufficient_history");
  });

  it("R05/R12 逐归因组：配置金额/目标后评估该组实体", async () => {
    realBuilders();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    await dayOfSales(s, "2026-09-25", 1, 1, "10.000000");
    await good(s, "ads", [`${s.sid},${ts},CAMP-1,活动A,2026-09-20,m7,7,100.000000,150.000000,CNY`], cov("ads", "2026-09-20", "2026-09-21"));
    await publish(s.storeId);
    // 配置金额与目标（R12 目标 2.0，当前 roas 1.5 → 该组 triggered；R05 单日无基准 → suppressed insufficient_history）
    const { PATCH } = await import("@/app/api/v1/alert-rules/[rule_id]/route");
    const patch = (ruleId: string, payload: Record<string, unknown>) =>
      PATCH(req(`/api/v1/alert-rules/${ruleId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ store_id: s.storeId, ...payload }) }, owner.cookie), { params: Promise.resolve({ rule_id: ruleId }) });
    const p12 = await patch("R12", { thresholds: { roas_target: 2.0, default_cny: 100 }, expected_version: 1 });
    expect(p12.status).toBe(200);
    const p5 = await patch("R05", { thresholds: { default_cny: 100 }, expected_version: 1 });
    expect(p5.status).toBe(200);
    await publish(s.storeId);
    const r12 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R12" }, orderBy: { updatedAt: "desc" } });
    expect(r12?.entityKey).toBe("ads:m7:7");
    expect(r12?.status).toBe("triggered");
    const r05 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R05" }, orderBy: { updatedAt: "desc" } });
    expect(r05?.entityKey).toBe("ads:m7:7");
    expect(r05?.status).toBe("suppressed");
    expect(r05?.reasonCode).toBe("insufficient_history");
  });
});
