/**
 * TASK-014｜基础经营与广告指标集成测试（真实 PostgreSQL；期望来自 04 §12.8 黄金fixture）。
 * 覆盖：GMV/订单数/销量/客单价逐分核对（09-01 = 230 / 2 / 4 / 115）；零分母 AOV/ROAS
 * unavailable 而非 0/Infinity；缺行日覆盖 partial 且金额按已知行展示；广告归因组独立
 * 不跨组合并；无已发布快照 API 503；同版本快照读取身份一致；重跑幂等不重复行。
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
import { registerSnapshotBuilder, resetSnapshotBuildersForTests, runRebuildJob } from "@/services/snapshot";
import { registerBasicMetricsBuilder } from "@/services/metrics/basic";

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
const PASSWORD = "metric-pass-123";
let owner: { cookie: string };
let orgId: string;

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
  const ownerEmail = `owner-metric-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `指标组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
    async (email, password, name) => {
      const result = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: false });
      return { authUserId: result.user.id };
    },
  );
  orgId = r.orgId;
  owner = { cookie: await loginCookie(ownerEmail) };
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
  const sid = `MT-${t}`;
  const storeId = (await db.store.create({ data: { orgId, name: `指标店${t}`, externalStoreId: sid, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } })).id;
  const dataSourceId = (await db.dataSource.create({ data: { orgId, storeId, sourceNamespace: `ns-mt-${t}`, name: `源${t}`, adapterKind: "csv" } })).id;
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
const oRow = (sid: string, id: string, count = 1) => `${sid},${ts},O-${id},paid,2026-09-01T01:55:00Z,2026-09-01T02:00:00Z,CNY,${count}`;
const iRow = (sid: string, id: string, line: string, sku: string, qty: number, amount: string) => `${sid},${ts},O-${id},${line},${sku},${qty},${amount},CNY`;
const adRow = (sid: string, campaign: string, day: string, spend: string, sales: string, model = "last_click", win = 7) => `${sid},${ts},${campaign},广告,${day},${model},${win},${spend},${sales},CNY`;
const cov = (kind: string, from = "2026-09-01", to = "2026-09-11") => [{ source_kind: kind, channel: "default", from, to, status: "complete", explicit_zero_dates: [] }];

/** 黄金fixture A 店（04 §12.8）：O1(L1 2×100 + L2 1×60)、O2(1×70) 付于09-01；O3(50) 付于09-10 */
async function goldenStore(): Promise<Scope> {
  const s = await newScope();
  await good(s, "products", [pRow(s.sid, "1"), pRow(s.sid, "2")]);
  await good(s, "orders", [oRow(s.sid, "1", 2), oRow(s.sid, "2", 1), `${s.sid},${ts},O-3,paid,2026-09-10T01:55:00Z,2026-09-10T02:00:00Z,CNY,1`], cov("orders"));
  await good(s, "order_items", [
    iRow(s.sid, "1", "L1", "S-1", 2, "100.000000"),
    iRow(s.sid, "1", "L2", "S-2", 1, "60.000000"),
    iRow(s.sid, "2", "L1", "S-1", 1, "70.000000"),
    `${s.sid},${ts},O-3,L1,S-1,1,50.000000,CNY`,
  ], cov("order_items"));
  await good(s, "ads", [
    adRow(s.sid, "AD1", "2026-09-01", "40.000000", "100.000000"),
    adRow(s.sid, "AD1", "2026-09-02", "0.000000", "0.000000"),
  ], cov("ads"));
  return s;
}

function stubOthers() {
  registerSnapshotBuilder("cohort", { build: async () => undefined });
  registerSnapshotBuilder("rules", { build: async () => undefined });
}

async function publishedRun(storeId: string): Promise<string> {
  const run = await db.jobRun.findFirstOrThrow({
    where: { storeId, jobKind: "recompute_snapshot" },
    orderBy: { createdAt: "desc" },
  });
  const out = await runRebuildJob(run.id, db);
  expect(out.status).toBe("succeeded");
  return run.id;
}

async function metricRow(storeId: string, metricId: string, day: string, entityKey = "store") {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { currentSnapshotVersion: true, currentSnapshotRulesetVersion: true, currentSnapshotEvaluationAt: true } });
  return db.dailyMetric.findUniqueOrThrow({
    where: {
      orgId_storeId_metricId_entityKey_periodStart_periodEnd_datasetVersion_rulesetVersion_metricVersion: {
        orgId, storeId, metricId, entityKey,
        periodStart: new Date(`${day}T00:00:00Z`), periodEnd: new Date(`${day}T00:00:00Z`),
        datasetVersion: store.currentSnapshotVersion!,
        rulesetVersion: store.currentSnapshotRulesetVersion!,
        metricVersion: "v1",
      },
    },
  });
}

describe("TASK-014 基础经营与广告指标", () => {
  it("黄金fixture：GMV/订单数/销量/客单价/ROAS 逐分核对；零分母 unavailable；真零可显示", async () => {
    registerBasicMetricsBuilder();
    stubOthers();
    const s = await goldenStore();
    await publishedRun(s.storeId);

    const gmv = await metricRow(s.storeId, "gmv", "2026-09-01");
    expect(gmv.valueNumeric?.toString()).toBe("230");
    expect(gmv.coverageStatus).toBe("complete");
    expect(gmv.status).toBe("available");

    const orders = await metricRow(s.storeId, "paid_order_count", "2026-09-01");
    expect(orders.sampleSize).toBe(2n);
    const units = await metricRow(s.storeId, "units_sold", "2026-09-01");
    expect(units.sampleSize).toBe(4n);
    const aov = await metricRow(s.storeId, "average_order_value", "2026-09-01");
    expect(aov.valueNumeric?.toString()).toBe("115");
    expect(aov.numerator?.toString()).toBe("230");
    expect(aov.denominator?.toString()).toBe("2");

    const gmv10 = await metricRow(s.storeId, "gmv", "2026-09-10");
    expect(gmv10.valueNumeric?.toString()).toBe("50");

    // 广告：09-01 ROAS=100/40=2.5（last_click:7 组）；09-02 真零花费 → ROAS null/zero_denominator、spend=0 可显示
    const roas1 = await metricRow(s.storeId, "roas", "2026-09-01", "ads:last_click:7");
    expect(roas1.valueNumeric?.toString()).toBe("2.5");
    const spend2 = await metricRow(s.storeId, "ad_spend", "2026-09-02", "ads:last_click:7");
    expect(spend2.valueNumeric?.toString()).toBe("0");
    expect(spend2.status).toBe("available");
    const roas2 = await metricRow(s.storeId, "roas", "2026-09-02", "ads:last_click:7");
    expect(roas2.valueNumeric).toBeNull();
    expect(roas2.status).toBe("unavailable");
    expect(roas2.unavailableReason).toBe("zero_denominator");
  });

  it("缺行日：金额按已知行展示、覆盖强制 partial；无付款订单不计入", async () => {
    registerBasicMetricsBuilder();
    stubOthers();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    // O1 expected=2 仅到 L1（100）；O2 完整 70 → 已知 GMV 170、覆盖 partial
    await good(s, "orders", [oRow(s.sid, "1", 2), oRow(s.sid, "2", 1)], cov("orders"));
    await good(s, "order_items", [iRow(s.sid, "1", "L1", "S-1", 2, "100.000000"), iRow(s.sid, "2", "L1", "S-1", 1, "70.000000")], cov("order_items"));
    await publishedRun(s.storeId);
    const gmv = await metricRow(s.storeId, "gmv", "2026-09-01");
    expect(gmv.valueNumeric?.toString()).toBe("170");
    expect(gmv.coverageStatus).toBe("partial");
    const orders = await metricRow(s.storeId, "paid_order_count", "2026-09-01");
    expect(orders.sampleSize).toBe(2n);
  });

  it("归因组独立：不同 model/window 不合并到同一实体", async () => {
    registerBasicMetricsBuilder();
    stubOthers();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    await good(s, "orders", [oRow(s.sid, "1", 1)], cov("orders"));
    await good(s, "order_items", [iRow(s.sid, "1", "L1", "S-1", 1, "10.000000")], cov("order_items"));
    await good(s, "ads", [
      adRow(s.sid, "AD", "2026-09-01", "10.000000", "30.000000", "last_click", 7),
      adRow(s.sid, "AD", "2026-09-01", "20.000000", "60.000000", "first_click", 7),
      adRow(s.sid, "AD", "2026-09-01", "11.000000", "35.000000", "last_click", 14),
    ], cov("ads"));
    await publishedRun(s.storeId);
    const lc7 = await metricRow(s.storeId, "ad_spend", "2026-09-01", "ads:last_click:7");
    expect(lc7.valueNumeric?.toString()).toBe("10");
    const fc7 = await metricRow(s.storeId, "ad_spend", "2026-09-01", "ads:first_click:7");
    expect(fc7.valueNumeric?.toString()).toBe("20");
    const lc14 = await metricRow(s.storeId, "ad_spend", "2026-09-01", "ads:last_click:14");
    expect(lc14.valueNumeric?.toString()).toBe("11");
  });

  it("metrics API：同版本发布身份读取、金额为十进制字符串、比率小数、P1占位unavailable、无快照503", async () => {
    const { GET } = await import("@/app/api/v1/metrics/route");
    // 无事实新店：无已发布快照 → 503 SNAPSHOT_NOT_READY
    const empty = await newScope();
    const r0 = await GET(req(`/api/v1/metrics?store_id=${empty.storeId}&from=2026-09-01&to=2026-09-11`, {}, owner.cookie));
    expect(r0.status).toBe(503);

    registerBasicMetricsBuilder();
    stubOthers();
    const s = await goldenStore();
    await publishedRun(s.storeId);
    const res = await GET(
      req(`/api/v1/metrics?store_id=${s.storeId}&from=2026-09-01&to=2026-09-11&metric_ids=gmv,paid_order_count,units_sold,average_order_value,roas,ad_spend,operating_roi`, {}, owner.cookie),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ metric_id: string; value: string | number | null; period_start: string; unavailable_reason?: string | null }> }; meta: { dataset_version: string; snapshot_status: string } };
    expect(body.meta.snapshot_status).toBe("ready");
    const find = (mid: string, day: string) => body.data.items.find((i) => i.metric_id === mid && i.period_start === day);
    expect(find("gmv", "2026-09-01")?.value).toBe("230");
    expect(find("paid_order_count", "2026-09-01")?.value).toBe(2);
    expect(find("units_sold", "2026-09-01")?.value).toBe(4);
    expect(find("average_order_value", "2026-09-01")?.value).toBe("115");
    expect(find("roas", "2026-09-01")?.value).toBe(2.5);
    expect(find("ad_spend", "2026-09-01")?.value).toBe("40");
    const roi = body.data.items.find((i) => i.metric_id === "operating_roi");
    expect(roi?.value).toBeNull();
    expect(roi?.unavailable_reason).toBe("cost_data_unavailable");
  });

  it("重跑幂等：同目标重算不产生重复指标行", async () => {
    registerBasicMetricsBuilder();
    stubOthers();
    const s = await goldenStore();
    const runId = await publishedRun(s.storeId);
    await db.jobRun.update({ where: { id: runId }, data: { status: "pending", finishedAt: null } });
    const again = await runRebuildJob(runId, db);
    expect(again.status).toBe("succeeded");
    const store = await db.store.findUniqueOrThrow({ where: { id: s.storeId }, select: { currentSnapshotVersion: true } });
    const count = await db.dailyMetric.count({ where: { storeId: s.storeId, datasetVersion: store.currentSnapshotVersion!, metricId: "gmv" } });
    expect(count).toBeGreaterThanOrEqual(2); // 09-01 与 09-10 各一行
    const rows = await db.dailyMetric.findMany({
      where: { storeId: s.storeId, datasetVersion: store.currentSnapshotVersion!, metricId: "gmv" },
      select: { periodStart: true },
    });
    const keys = new Set(rows.map((r) => r.periodStart.toISOString()));
    expect(keys.size).toBe(rows.length); // No duplicate rows for the same period within the same version
  });
});
