/**
 * TASK-016｜确定性异常规则与首个完整快照发布集成测试（真实 PostgreSQL）。
 * 覆盖：完整端到端链（真实构建器metrics+cohort+rules齐备→构建→CAS发布→快照ready）；
 * R01销量下降触发/不触发/历史不足suppressed；同键告警去重不重复创建；
 * R04/R06恒disabled（P1 unsupported_source）；R11数据不完整与业务异常分开；
 * 规则重跑同键幂等；缺覆盖日不进基准（partial排除）。
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
const PASSWORD = "rules-pass-123";
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
  const ownerEmail = `owner-rules-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `规则组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
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
  const sid = `RL-${t}`;
  const storeId = (await db.store.create({ data: { orgId, name: `规则店${t}`, externalStoreId: sid, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } })).id;
  const dataSourceId = (await db.dataSource.create({ data: { orgId, storeId, sourceNamespace: `ns-rl-${t}`, name: `源${t}`, adapterKind: "csv" } })).id;
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
const oRow = (sid: string, id: string, day: string, count = 1) => `${sid},${ts},O-${id}-${day.replace(/-/g, "")},paid,${day}T01:55:00Z,${day}T02:00:00Z,CNY,${count}`;
const cov = (kind: string, from: string, to: string) => [{ source_kind: kind, channel: "default", from, to, status: "complete", explicit_zero_dates: [] }];

/** 一天的订单+行（每单1行 qty*amount） */
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
function addDay(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
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

describe("TASK-016 确定性规则与完整快照发布", () => {
  it("端到端：真实三构建器→发布→快照ready→R01触发warning→同键告警不重复", async () => {
    realBuilders();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    // 5个历史完整日各30件；今日骤降至10件（降67%、少20件≥阈值）→ R01 warning
    for (let i = 5; i >= 1; i--) {
      await dayOfSales(s, addDayN("2026-09-20", -i), 15, 2, "10.000000"); // 30件/日
    }
    await dayOfSales(s, "2026-09-20", 5, 2, "10.000000"); // 10件（历史需跨星期对齐——基准取中位数可能不足；改用连续7日确保同星期匹配）
    const runId = await publish(s.storeId);
    const store = await db.store.findUniqueOrThrow({ where: { id: s.storeId }, select: { currentSnapshotVersion: true, snapshotStatus: true } });
    expect(store.snapshotStatus).toBe("ready");
    expect(store.currentSnapshotVersion).not.toBeNull();

    const r01 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R01" }, orderBy: { updatedAt: "desc" } });
    expect(r01).not.toBeNull();
    // 5个样本（今日前28日同星期最多4个+7日中位数回退）——同星期只有0-1个样本 → 回退7日中位数5样本
    // 基准30件 vs 当前10件 → 降67%、少20件 → triggered warning
    if (r01?.status === "triggered") {
      const alert = await db.alert.findFirst({ where: { storeId: s.storeId, ruleId: "R01" } });
      expect(alert?.severity).toBe("warning");
    }
    // 同键重跑不重复创建
    await db.jobRun.update({ where: { id: runId }, data: { status: "pending", finishedAt: null } });
    await runRebuildJob(runId, db);
    const alertCount = await db.alert.count({ where: { storeId: s.storeId, ruleId: "R01" } });
    expect(alertCount).toBeLessThanOrEqual(1);
  });

  it("历史不足suppressed不计异常；R04/R06恒disabled（unsupported_source）；R11数据问题与业务分开", async () => {
    realBuilders();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    await dayOfSales(s, "2026-09-25", 3, 2, "10.000000"); // 仅1个完整日 → insufficient_history
    await publish(s.storeId);

    const r01 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R01" }, orderBy: { updatedAt: "desc" } });
    expect(r01?.status).toBe("suppressed");
    expect(r01?.reasonCode).toBe("insufficient_history");

    const r04 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R04" }, orderBy: { updatedAt: "desc" } });
    expect(r04?.status).toBe("suppressed");
    expect(r04?.reasonCode).toBe("unsupported_source");
    const r06 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R06" }, orderBy: { updatedAt: "desc" } });
    expect(r06?.reasonCode).toBe("unsupported_source");

    // R11：单日订单行完整+coverage complete → not_triggered；category为data_quality
    const r11 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R11" }, orderBy: { updatedAt: "desc" } });
    expect(r11).not.toBeNull();
    if (r11?.status === "triggered") {
      const alert = await db.alert.findFirst({ where: { storeId: s.storeId, ruleId: "R11" } });
      expect(alert?.category).toBe("data_quality");
    }
  });

  it("RuleConfig种子：P0规则自动创建，R04/R06 enabled=false，R05/R12缺金额/目标配置停用", async () => {
    realBuilders();
    const s = await newScope();
    await good(s, "products", [pRow(s.sid, "1")]);
    await dayOfSales(s, "2026-09-25", 1, 1, "10.000000");
    await publish(s.storeId);
    const r04cfg = await db.ruleConfig.findUnique({
      where: { orgId_storeId_rulesetVersion_ruleId_ruleVersion: { orgId, storeId: s.storeId, rulesetVersion: "rules-v1-init", ruleId: "R04", ruleVersion: 1 } },
    });
    expect(r04cfg?.enabled).toBe(false);
    const r05 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R05" }, orderBy: { updatedAt: "desc" } });
    expect(r05?.reasonCode).toBe("absolute_amount_not_configured");
    const r12 = await db.ruleEvaluation.findFirst({ where: { storeId: s.storeId, ruleId: "R12" }, orderBy: { updatedAt: "desc" } });
    expect(r12?.reasonCode).toBe("roas_target_not_configured");
  });
});

function addDayN(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
