/**
 * TASK-007｜文件上传、私有存储与 ImportTask 集成测试。
 * 验收：超限即停止解析（20MB/10 万行）；客户消息不进 public；
 *       C 不能上传订单文件；重复请求返回同任务；
 *       上传任务可查询；私有文件需签名下载；validate 队列边界可执行。
 */
import { createHash } from "node:crypto";
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

let db: PrismaClient;
type Auth = ReturnType<(typeof import("@/lib/auth"))["getAuth"]>;
let auth: Auth;
const PASSWORD = "imports-pass-123";

let owner: { userId: string; email: string; cookie: string };
let cs: { cookie: string };
let orgId: string;
let storeId: string;
let dataSourceId: string;
let mockStoreId: string;

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

async function seedUser(t: string, role: "owner" | "customer_service", org: string): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `${role}-${t}@example.com`;
  const created = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: role }, asResponse: false });
  const user = await db.user.create({ data: { id: randomUUID(), authUserId: created.user.id, email, displayName: role } });
  await db.membership.create({ data: { orgId: org, userId: user.id, role } });
  return { userId: user.id, email, cookie: await loginCookie(email) };
}

beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
  auth = (await import("@/lib/auth")).getAuth();

  const t = randomUUID().slice(0, 8);
  const { initOwner } = await import("@/services/ownerInit");
  const ownerEmail = `owner-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `I组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
    async (email, password, name) => {
      const result = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: false });
      return { authUserId: result.user.id };
    },
  );
  orgId = r.orgId;
  owner = { userId: r.userId, email: ownerEmail, cookie: await loginCookie(ownerEmail) };
  cs = await seedUser(`${t}cs`, "customer_service", orgId);

  storeId = (
    await db.store.create({
      data: { orgId, name: "导入店", externalStoreId: "IMP-1", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    })
  ).id;
  dataSourceId = (
    await db.dataSource.create({
      data: { orgId, storeId, sourceNamespace: "ns-import", name: "导入源", adapterKind: "csv" },
    })
  ).id;
  mockStoreId = (
    await db.store.create({
      data: { orgId, name: "演示导入店", externalStoreId: "IMP-DEMO", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai", demoMode: true },
    })
  ).id;
}, 420_000);

afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

const PRODUCTS_CSV = [
  "store_external_id,source_updated_at,external_product_id,product_name,category,product_status,external_sku_id,sku_code,sku_name,specification,sku_status",
  "IMP-1,2026-09-11T01:00:00Z,P1,保温杯,杯具,active,S1,CUP-RED,红杯,,active",
  "IMP-1,2026-09-11T01:00:00Z,P1,保温杯,杯具,active,S2,CUP-BLUE,蓝杯,,active",
].join("\n");

describe("TASK-007｜上传、幂等与任务查询", () => {
  it("O 上传 csv → 201 任务（sha256/行数/uploaded）；重复上传返回同任务", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("source_kind", "products");
    form.set("file", csvFile("products.csv", PRODUCTS_CSV));
    const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; file_sha256: string; row_count: number; status: string } };
    expect(body.data.status).toBe("uploaded");
    expect(body.data.row_count).toBe(2);
    expect(body.data.file_sha256).toBe(createHash("sha256").update(PRODUCTS_CSV).digest("hex"));

    // 任务可查询
    const { GET } = await import("@/app/api/v1/imports/[id]/route");
    const query = await GET(req(`/api/v1/imports/${body.data.id}`, {}, owner.cookie), { params: Promise.resolve({ id: body.data.id }) });
    expect(query.status).toBe(200);
    const queryBody = (await query.json()) as { data: { original_filename: string; source_kind: string } };
    expect(queryBody.data.original_filename).toBe("products.csv");
    expect(queryBody.data.source_kind).toBe("products");

    // 私有存储：原始对象在私有根 raw/ 下，绝不含 public 段
    const task = await db.importTask.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(task.rawObjectKey.startsWith("raw/")).toBe(true);
    expect(task.rawObjectKey).not.toContain("public");

    // 重复请求 → 同任务（reused）
    const again = await POST(
      req("/api/v1/imports", { method: "POST", body: (() => { const f = new FormData(); f.set("store_id", storeId); f.set("data_source_id", dataSourceId); f.set("source_kind", "products"); f.set("file", csvFile("products.csv", PRODUCTS_CSV)); return f; })() }, owner.cookie),
    );
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { data: { id: string; reused: boolean } };
    expect(againBody.data.id).toBe(body.data.id);
    expect(againBody.data.reused).toBe(true);
  });

  it("审计：import_upload 同事务写入", async () => {
    const count = await db.auditLog.count({ where: { action: "import_upload", orgId } });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe("TASK-007｜限制与拒绝", () => {
  it("C 不能上传订单文件（403）；C 可上传客户消息（201）且不入 public", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const orderForm = new FormData();
    orderForm.set("store_id", storeId);
    orderForm.set("data_source_id", dataSourceId);
    orderForm.set("source_kind", "orders");
    orderForm.set("file", csvFile("orders.csv", "store_external_id,external_order_id\nIMP-1,O1"));
    const forbidden = await POST(req("/api/v1/imports", { method: "POST", body: orderForm }, cs.cookie));
    expect(forbidden.status).toBe(403);
    expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe("FILE_KIND_FORBIDDEN");

    const msgForm = new FormData();
    msgForm.set("store_id", storeId);
    msgForm.set("data_source_id", dataSourceId);
    msgForm.set("source_kind", "customer_messages");
    msgForm.set("file", csvFile("messages.csv", "store_external_id,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language\nIMP-1,MX1,CX1,2026-09-01T11:00:00Z,S1,你好,,platform_chat,zh-CN"));
    const allowed = await POST(req("/api/v1/imports", { method: "POST", body: msgForm }, cs.cookie));
    expect(allowed.status).toBe(201);
    const task = await db.importTask.findUniqueOrThrow({
      where: { id: ((await allowed.json()) as { data: { id: string } }).data.id },
    });
    expect(task.rawObjectKey.startsWith("raw/")).toBe(true);
    expect(task.rawObjectKey).not.toContain("public");
  });

  it("mock 数据源不接受上传（422）；归档店拒绝（409）", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const mockSource = await db.dataSource.create({
      data: { orgId, storeId: mockStoreId, sourceNamespace: "ns-demo-import", name: "演示源", adapterKind: "mock" },
    });
    const form = new FormData();
    form.set("store_id", mockStoreId);
    form.set("data_source_id", mockSource.id);
    form.set("source_kind", "products");
    form.set("file", csvFile("p.csv", PRODUCTS_CSV));
    const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
    expect(res.status).toBe(422);

    await db.store.update({ where: { id: storeId }, data: { status: "archived" } });
    const archForm = new FormData();
    archForm.set("store_id", storeId);
    archForm.set("data_source_id", dataSourceId);
    archForm.set("source_kind", "customer_messages");
    archForm.set("file", csvFile("m.csv", PRODUCTS_CSV));
    const archived = await POST(req("/api/v1/imports", { method: "POST", body: archForm }, owner.cookie));
    expect(archived.status).toBe(409);
    await db.store.update({ where: { id: storeId }, data: { status: "active" } });
  });

  it("超过 10 万行即停止解析（422 TOO_MANY_ROWS）", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const header = "store_external_id,source_updated_at,external_order_id,external_order_item_id,external_sku_id,quantity,item_paid_amount,currency";
    const rows: string[] = [header];
    for (let i = 0; i < 100_002; i++) {
      rows.push(`IMP-1,2026-09-11T01:00:00Z,O${i},L1,S1,1,10.000000,CNY`);
    }
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("source_kind", "order_items");
    form.set("file", csvFile("huge.csv", rows.join("\n")));
    const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_ROWS");
  }, 120_000);

  it("超过 20MB 即停止接收（422 FILE_TOO_LARGE）", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const big = Buffer.alloc(21 * 1024 * 1024, 0x61);
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("source_kind", "customer_messages");
    form.set("file", new File([big], "big.csv", { type: "text/csv" }));
    const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FILE_TOO_LARGE");
  }, 120_000);
});

describe("TASK-007｜签名下载与 validate 边界", () => {
  let taskId: string;

  beforeAll(async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("source_kind", "products");
    form.set("file", csvFile("sig.csv", PRODUCTS_CSV));
    const res = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
    taskId = ((await res.json()) as { data: { id: string } }).data.id;
  });

  it("未签名下载 403；正确签名 200 且内容一致", async () => {
    const { GET: fileGet } = await import("@/app/api/v1/imports/[id]/file/route");
    const unsigned = await fileGet(req(`/api/v1/imports/${taskId}/file`, {}, owner.cookie), { params: Promise.resolve({ id: taskId }) });
    expect(unsigned.status).toBe(403);

    const { signDownload } = await import("@/storage");
    const task = await db.importTask.findUniqueOrThrow({ where: { id: taskId } });
    const sig = signDownload(task.rawObjectKey, 600);
    const signed = await fileGet(
      req(`/api/v1/imports/${taskId}/file?expires=${sig.expiresAt}&signature=${sig.signature}`, {}, owner.cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(signed.status).toBe(200);
    const text = await signed.text();
    expect(text).toBe(PRODUCTS_CSV);

    // 过期签名 → 403
    const expired = signDownload(task.rawObjectKey, -1);
    const expiredRes = await fileGet(
      req(`/api/v1/imports/${taskId}/file?expires=${expired.expiresAt}&signature=${expired.signature}`, {}, owner.cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(expiredRes.status).toBe(403);
  });

  it("validate handler：解析统计入库（validated；valid=2）；错误行写私有对象", async () => {
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    const result = await handleValidateTask({ taskId });
    expect(result.status).toBe("preview_ready");
    expect(result.valid).toBe(2);
    expect(result.errors).toBe(0);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("preview_ready");
    expect(task.validCount).toBe(2);

    // 错误路径：独立上传含错行文件 → validate → failed + 私有 errors 对象
    const badForm = new FormData();
    badForm.set("store_id", storeId);
    badForm.set("data_source_id", dataSourceId);
    badForm.set("source_kind", "order_items");
    badForm.set("file", csvFile("bad.csv", `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-11T01:00:00Z,O9,L9,S1,0,10.000000,CNY`));
    const badUpload = await (async () => {
      const { POST } = await import("@/app/api/v1/imports/route");
      return POST(req("/api/v1/imports", { method: "POST", body: badForm }, owner.cookie));
    })();
    const badTaskId = ((await badUpload.json()) as { data: { id: string } }).data.id;
    // 行级错误（数量 0）→ preview_ready + 错误计数 + 私有错误对象；不冒充整文件失败
    const badResult = await handleValidateTask({ taskId: badTaskId });
    expect(badResult.status).toBe("preview_ready");
    expect(badResult.errors).toBe(1);
    const badTask = await db.importTask.findUniqueOrThrow({ where: { id: badTaskId } });
    expect(badTask.status).toBe("preview_ready");
    expect(badTask.errorCount).toBe(1);
    expect(badTask.errorObjectKey).toBe(`errors/${badTaskId}/errors.csv`);
  });

  it("commit 边界：显式拒绝（TASK-008 实现），不冒充已提交", async () => {
    const { handleCommitTask } = await import("@/jobs/handlers/imports");
    await expect(handleCommitTask({ taskId })).rejects.toThrow(/TASK-008/);
  });
});
