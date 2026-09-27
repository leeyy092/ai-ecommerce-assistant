/**
 * G3R1-20260927-02-H04C01｜record_count 合同口径合法对照（Z02 补充，Reviewer 澄清后新增）。
 *
 * 合同：04_DATA_MODEL §10.5 DataCoverage.record_count = “当前该来源日已接收行数”；
 * R1 报告 §4 H04 关闭标准 = “整批提交后的最终事实…record_count 是已接收事实数，不只本文件”。
 * 口径：租户/店铺/来源 namespace/类型/channel/业务日，整批提交后的最终事实计数——
 * 不只数当前文件，也不全店跨来源混算。
 *
 * 场景（每个场景独立 store+dataSource，避免共享环境串数）：
 *  1. 隔离对照：一次导齐 L1/L2 → 该来源日计数=2、complete；
 *  2. 累计对照：同源同日已有 O1-L1 事实，再接收 O2 的 L1/L2 → 计数含历史最终事实=3；
 *  3. 显式零与该范围既有事实冲突 → 整文件拒绝；
 *  4. 无接收事实且未显式声明零的空缺日 → partial（0 不能自动升级 complete）。
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";
import { FILE_HEADERS } from "@/adapters/contracts";
import { setStorageRoot } from "@/storage";

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
const PASSWORD = "h04c01-pass-123";

let owner: { cookie: string };
let orgId: string;

function req(path: string, init: RequestInit = {}, cookie?: string): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://127.0.0.1:3000${path}`, { ...init, headers } as ConstructorParameters<typeof NextRequest>[1]);
}

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

async function loginCookie(email: string): Promise<string> {
  const r = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

/** 每个场景独立租户内新 store + 新来源（隔离计数，不共享命名空间） */
interface Scope { storeId: string; dataSourceId: string; externalStoreId: string; ns: string }
async function newScope(): Promise<Scope> {
  const t = randomUUID().slice(0, 8);
  const externalStoreId = `H04-${t}`;
  const ns = `ns-h04-${t}`;
  const storeId = (
    await db.store.create({
      data: { orgId, name: `覆盖店${t}`, externalStoreId, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    })
  ).id;
  const dataSourceId = (
    await db.dataSource.create({
      data: { orgId, storeId, sourceNamespace: ns, name: `来源${t}`, adapterKind: "csv" },
    })
  ).id;
  return { storeId, dataSourceId, externalStoreId, ns };
}

async function upload(cookie: string, scope: { storeId: string; dataSourceId: string }, kind: keyof typeof FILE_HEADERS, content: string): Promise<Response> {
  const { POST } = await import("@/app/api/v1/imports/route");
  const form = new FormData();
  form.set("store_id", scope.storeId);
  form.set("data_source_id", scope.dataSourceId);
  form.set("entity_type", kind);
  form.set("file", csvFile(`${kind}.csv`, content));
  return POST(req("/api/v1/imports", { method: "POST", body: form }, cookie));
}

async function good(scope: Scope, kind: keyof typeof FILE_HEADERS, rows: string[], coverage?: unknown[]): Promise<string> {
  const headers = FILE_HEADERS[kind].join(",");
  const res = await upload(owner.cookie, scope, kind, `${headers}\n${rows.join("\n")}`);
  expect([200, 201]).toContain(res.status);
  const id = (await res.json()).data.id as string;
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
  const { POST } = await import("@/app/api/v1/imports/[id]/commit/route");
  const c = await POST(
    req(`/api/v1/imports/${id}/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview_version: task.previewVersion, confirmation: true }) }, owner.cookie),
    { params: Promise.resolve({ id }) },
  );
  expect([200, 202]).toContain(c.status);
  return id;
}

const ts = "2026-09-11T01:00:00Z";
const pRow = (sid: string, id: string) => `${sid},${ts},P-${id},杯,杯具,active,S-${id},CODE-${id},杯,,active`;
const oRow = (sid: string, id: string, count = 1) => `${sid},${ts},O-${id},paid,2026-09-01T01:55:00Z,2026-09-01T02:00:00Z,CNY,${count}`;
const iRow = (sid: string, id: string, line = "L1", amount = "100.000000", quantity = 2) => `${sid},${ts},O-${id},${line},S-${id},${quantity},${amount},CNY`;
const coverage = (kind: string, from = "2026-09-01", to = "2026-09-03") => [{ source_kind: kind, channel: "default", from, to, status: "complete", explicit_zero_dates: [] }];

beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
  auth = (await import("@/lib/auth")).getAuth();

  const t = randomUUID().slice(0, 8);
  const { initOwner } = await import("@/services/ownerInit");
  const ownerEmail = `owner-h04c01-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `H04C01组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
    async (email, password, name) => {
      const result = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: false });
      return { authUserId: result.user.id };
    },
  );
  orgId = r.orgId;
  owner = { cookie: await loginCookie(ownerEmail) };
}, 420_000);

afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

describe("G3R1-H04C01 record_count 合同口径（来源级、整批后最终事实）", () => {
  it("对照1｜隔离环境一次导齐 L1/L2：该来源日 record_count=2 且 complete", async () => {
    const scope = await newScope();
    await good(scope, "products", [pRow(scope.externalStoreId, "iso")]);
    await good(scope, "orders", [oRow(scope.externalStoreId, "iso", 2)]);
    const taskId = await good(scope, "order_items", [iRow(scope.externalStoreId, "iso", "L1"), iRow(scope.externalStoreId, "iso", "L2")], coverage("order_items"));
    const rows = await db.dataCoverage.findMany({ where: { importTaskId: taskId }, orderBy: { coverageDate: "asc" } });
    expect(rows).toHaveLength(2); // 09-01、09-02
    const d1 = rows.find((r) => r.coverageDate.toISOString().startsWith("2026-09-01"));
    expect(d1?.status).toBe("complete");
    expect(d1?.recordCount).toBe(2n);
    expect(d1?.explicitZero).toBe(false);
  });

  it("对照2｜同源同日已有 O1-L1 事实，再接收 O2 的 L1/L2：计数含历史最终事实=3", async () => {
    const scope = await newScope();
    const sid = scope.externalStoreId;
    await good(scope, "products", [pRow(sid, "cum1"), pRow(sid, "cum2")]);
    // 先接收同源同日历史事实：O1 的 L1（不带覆盖声明提交）
    await good(scope, "orders", [oRow(sid, "cum1")]);
    await good(scope, "order_items", [iRow(sid, "cum1")]);
    // 再接收 O2 的 L1/L2（带覆盖声明）：整批提交后该来源日最终事实 = O1.L1 + O2.L1 + O2.L2
    await good(scope, "orders", [oRow(sid, "cum2", 2)]);
    const taskId = await good(scope, "order_items", [iRow(sid, "cum2", "L1"), iRow(sid, "cum2", "L2")], coverage("order_items"));
    const d1 = await db.dataCoverage.findFirstOrThrow({
      where: { importTaskId: taskId, coverageDate: new Date("2026-09-01T00:00:00Z") },
    });
    expect(d1.status).toBe("complete");
    expect(d1.recordCount).toBe(3n);
  });

  it("对照3｜显式零声明与该来源既有事实冲突：整文件拒绝、不写覆盖", async () => {
    const scope = await newScope();
    const sid = scope.externalStoreId;
    await good(scope, "products", [pRow(sid, "zero")]);
    await good(scope, "orders", [oRow(sid, "zero")]); // 09-01 已有订单事实
    const headers = FILE_HEADERS.orders.join(",");
    const res = await upload(owner.cookie, scope, "orders", `${headers}\n${oRow(sid, "zero2")}`);
    const id = (await res.json()).data.id as string;
    const { PUT } = await import("@/app/api/v1/imports/[id]/mapping/route");
    const put = await PUT(
      req(`/api/v1/imports/${id}/mapping`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: "Asia/Shanghai", coverage_declaration: [{ source_kind: "orders", channel: "default", from: "2026-09-01", to: "2026-09-02", status: "complete", explicit_zero_dates: ["2026-09-01"] }], expected_preview_version: 0 }) }, owner.cookie),
      { params: Promise.resolve({ id }) },
    );
    expect(put.status).toBe(202);
    await (await import("@/jobs/handlers/imports")).handleValidateTask({ taskId: id });
    const task = await db.importTask.findUniqueOrThrow({ where: { id } });
    expect(task.status).toBe("preview_ready");
    const { POST } = await import("@/app/api/v1/imports/[id]/commit/route");
    const c = await POST(
      req(`/api/v1/imports/${id}/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preview_version: task.previewVersion, confirmation: true }) }, owner.cookie),
      { params: Promise.resolve({ id }) },
    );
    expect(c.status).toBe(409);
    const body = (await c.json()) as { error: { code: string } };
    expect(body.error.code).toBe("EXPLICIT_ZERO_CONFLICT");
  });

  it("对照4｜无接收事实且未显式声明零的空缺日保持 partial、record_count=0", async () => {
    const scope = await newScope();
    const sid = scope.externalStoreId;
    await good(scope, "products", [pRow(sid, "gap")]);
    const taskId = await good(scope, "orders", [oRow(sid, "gap")], coverage("orders"));
    const d2 = await db.dataCoverage.findFirstOrThrow({
      where: { importTaskId: taskId, coverageDate: new Date("2026-09-02T00:00:00Z") },
    });
    expect(d2.status).toBe("partial");
    expect(d2.recordCount).toBe(0n);
    expect(d2.explicitZero).toBe(false);
  });
});
