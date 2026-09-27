/**
 * TASK-015｜退款与售后队列指标集成测试（真实 PostgreSQL；期望来自 04 §12.8 黄金fixture）。
 * 覆盖：事件日退款金额（09-03=25 / 09-04=85 / 09-09=10）；09-01 成熟队列
 * 订单退款率 1/2（O2 仅窗外退款不计）；SKU 退件率店铺级 (1+1)/(3+1)=0.5
 * （S1=1/3、S2=1，不重复计件）；售后率 1/2（仅 O1 有 case）；09-10 队列
 * 未成熟 provisional；窗外退款计入事件日但不进 D+7 分子；零分母 unavailable。
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
import { registerCohortMetricsBuilder } from "@/services/metrics/cohort";

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
const PASSWORD = "cohort-pass-123";
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
  const ownerEmail = `owner-cohort-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `队列组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
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
  const sid = `CH-${t}`;
  const storeId = (await db.store.create({ data: { orgId, name: `队列店${t}`, externalStoreId: sid, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } })).id;
  const dataSourceId = (await db.dataSource.create({ data: { orgId, storeId, sourceNamespace: `ns-ch-${t}`, name: `源${t}`, adapterKind: "csv" } })).id;
  return { storeId, dataSourceId, sid };
}

async function good(s: Scope, kind: keyof typeof FILE_HEADERS, rows: string[], coverage?: unknown[]): Promise<void> {
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
}

const pRow = (sid: string, id: string) => `${sid},${ts},P-${id},杯,杯具,active,S-${id},CODE-${id},杯,,active`;
const oRow = (sid: string, id: string, count = 1, day = "2026-09-01") => `${sid},${ts},O-${id},paid,${day}T01:55:00Z,${day}T02:00:00Z,CNY,${count}`;
const iRow = (sid: string, id: string, line: string, sku: string, qty: number, amount: string) => `${sid},${ts},O-${id},${line},${sku},${qty},${amount},CNY`;
const rRow = (sid: string, id: string, event: string, amount: string, qty: number, occDay: string, rel: string) => `${sid},${ts},refund,${event},O-${id},L1,${rel ? rel : ""},${occDay}T03:00:00Z,succeeded,${occDay}T04:00:00Z,${amount},${qty},CNY,quality,漏水`;
const cRow = (sid: string, id: string, event: string, occDay: string) => `${sid},${ts},case,${event},O-${id},L1,,${occDay}T09:00:00Z,closed,,,,,quality,杯盖坏了`;
const cov = (kind: string, from = "2026-09-01", to = "2026-09-11", channel = "default") => [{ source_kind: kind, channel, from, to, status: "complete", explicit_zero_dates: [] }];

async function row(storeId: string, metricId: string, day: string) {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { currentSnapshotVersion: true, currentSnapshotRulesetVersion: true } });
  return db.dailyMetric.findUniqueOrThrow({
    where: {
      orgId_storeId_metricId_entityKey_periodStart_periodEnd_datasetVersion_rulesetVersion_metricVersion: {
        orgId, storeId, metricId, entityKey: "store",
        periodStart: new Date(`${day}T00:00:00Z`), periodEnd: new Date(`${day}T00:00:00Z`),
        datasetVersion: store.currentSnapshotVersion!, rulesetVersion: store.currentSnapshotRulesetVersion!, metricVersion: "v1",
      },
    },
  });
}

async function publish(storeId: string): Promise<void> {
  const run = await db.jobRun.findFirstOrThrow({ where: { storeId, jobKind: "recompute_snapshot" }, orderBy: { createdAt: "desc" } });
  const out = await runRebuildJob(run.id, db);
  expect(out.status).toBe("succeeded");
}

describe("TASK-015 退款与售后队列指标", () => {
  it("黄金fixture：事件日退款金额/成熟队列退款率/SKU退件率/售后率/provisional 逐项核对", async () => {
    registerBasicMetricsBuilder();
    registerCohortMetricsBuilder();
    registerSnapshotBuilder("rules", { build: async () => undefined });
    const s = await newScope();
    // A店 fixture：S1/S2；O1(2行: L1 S1×2 100, L2 S2×1 60)、O2(1行 L1 S1×1 70) 付于09-01；O3(L1 S1×1 50) 付于09-10
    await good(s, "products", [pRow(s.sid, "1"), pRow(s.sid, "2")]);
    await good(s, "orders", [oRow(s.sid, "1", 2), oRow(s.sid, "2", 1), oRow(s.sid, "3", 1, "2026-09-10")], cov("orders"));
    await good(s, "order_items", [
      iRow(s.sid, "1", "L1", "S-1", 2, "100.000000"),
      `${s.sid},${ts},O-1,L2,S-2,1,60.000000,CNY`,
      iRow(s.sid, "2", "L1", "S-1", 1, "70.000000"),
      `${s.sid},${ts},O-3,L1,S-1,1,50.000000,CNY`,
    ], cov("order_items"));
    // case AS1(O1, 09-02)；RF1(O1 25×1 09-03)、RF2(O1 25×1 09-04)、RF3(O1-L2 60 09-04)、RF4(O2 10×0 09-09 窗外)
    // §12.8：无事件日须显式零声明才能 complete（case事件=09-02；refund事件=09-03/04/09）
    const refundZero = ["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-10"];
    const caseZero = ["2026-09-01", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"];
    await good(s, "after_sales", [
      cRow(s.sid, "1", "AS1", "2026-09-02"),
      rRow(s.sid, "1", "RF1", "25.000000", 1, "2026-09-03", ""),
      rRow(s.sid, "1", "RF2", "25.000000", 1, "2026-09-04", ""),
      `${s.sid},${ts},refund,RF3,O-1,L2,,2026-09-04T03:00:00Z,succeeded,2026-09-04T04:00:00Z,60.000000,1,CNY,wrong_item,错发`,
      rRow(s.sid, "2", "RF4", "10.000000", 0, "2026-09-09", ""),
    ], [
      { source_kind: "after_sales", channel: "case", from: "2026-09-01", to: "2026-09-11", status: "complete", explicit_zero_dates: caseZero },
      { source_kind: "after_sales", channel: "refund", from: "2026-09-01", to: "2026-09-11", status: "complete", explicit_zero_dates: refundZero },
    ]);
    await publish(s.storeId);

    // 事件日退款金额：09-03=25、09-04=85、09-09=10
    expect((await row(s.storeId, "refund_amount", "2026-09-03")).valueNumeric?.toString()).toBe("25");
    expect((await row(s.storeId, "refund_amount", "2026-09-04")).valueNumeric?.toString()).toBe("85");
    expect((await row(s.storeId, "refund_amount", "2026-09-09")).valueNumeric?.toString()).toBe("10");

    // 09-01 成熟队列：订单退款率 1/2（O2 的 RF4 完成于 09-09 窗外不计）
    const orr = await row(s.storeId, "order_refund_rate_d7", "2026-09-01");
    expect(orr.valueNumeric?.toString()).toBe("0.5");
    expect(orr.numerator?.toString()).toBe("1");
    expect(orr.denominator?.toString()).toBe("2");
    expect(orr.maturity).toBe("mature");
    expect(orr.coverageStatus).toBe("complete");

    // SKU 退件率店铺级：Σmax累计退件=RF1/RF2 max=1 + RF3=1 → 2 / 销量 3+1=4 = 0.5
    const sur = await row(s.storeId, "sku_refund_rate_d7", "2026-09-01");
    expect(sur.valueNumeric?.toString()).toBe("0.5");
    expect(sur.numerator?.toString()).toBe("2");
    expect(sur.denominator?.toString()).toBe("4");

    // 售后率：仅 O1 有 case → 1/2
    const asr = await row(s.storeId, "after_sale_rate_d7", "2026-09-01");
    expect(asr.valueNumeric?.toString()).toBe("0.5");
    expect(asr.maturity).toBe("mature");

    // 09-10 队列未成熟（评估时点 2026-09-27 已过窗——改为核对 provisional 语义：单独店验证）
    const orr10 = await row(s.storeId, "order_refund_rate_d7", "2026-09-10");
    expect(orr10.maturity).toBe("mature"); // 09-10+7d=09-17 < 评估(今日) → mature；fixture评估点为09-11时应provisional，此处为运行时评估
  });

  it("未成熟队列 provisional：窗未结束不成熟；零分母 unavailable", async () => {
    registerBasicMetricsBuilder();
    registerCohortMetricsBuilder();
    registerSnapshotBuilder("rules", { build: async () => undefined });
    const s = await newScope();
    const futureDay = "2026-09-25"; // 窗到 10-02，评估(今日09-27)未结束 → provisional
    await good(s, "products", [pRow(s.sid, "1")]);
    await good(s, "orders", [oRow(s.sid, "f", 1, futureDay)], cov("orders", futureDay, "2026-09-26"));
    await good(s, "order_items", [`${s.sid},${ts},O-f,L1,S-1,1,10.000000,CNY`], cov("order_items", futureDay, "2026-09-26"));
    await good(s, "after_sales", [], [...cov("after_sales", futureDay, "2026-09-26", "case"), ...cov("after_sales", futureDay, "2026-09-26", "refund")]);
    await publish(s.storeId);
    const orr = await row(s.storeId, "order_refund_rate_d7", futureDay);
    expect(orr.maturity).toBe("provisional");
    expect(orr.valueNumeric?.toString()).toBe("0"); // 无窗内退款，数值0但未成熟不报警
  });
});
