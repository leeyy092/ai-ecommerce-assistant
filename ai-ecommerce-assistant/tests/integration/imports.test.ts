/**
 * TASK-007｜文件上传、私有存储与 ImportTask 集成测试（真实 PostgreSQL + 真实会话）。
 * 验收：超限即停止（真实流式接收：字节/逻辑行）；客户消息不进 public；
 *       C 不能上传/查看/下载订单文件（H05）；重复请求返回同任务（含并发，H07）；
 *       Idempotency-Key 头隔离与冲突 409（H07）；失败窗口可恢复/有终态（H08）；
 *       validate 队列边界与权限重查；签名下载 5 分钟默认（L02）。
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
import { setStorageRoot, storageRoot } from "@/storage";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));
const privateRoot = mkdtempSync(join(tmpdir(), "aiea-storage-"));
setStorageRoot(privateRoot);

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
// 限流阈值放宽仅用于测试（F10 阈值本身由常量默认值 20 在生产生效）
process.env.UPLOAD_RATE_LIMIT_PER_MIN = "10000";

let db: PrismaClient;
type Auth = ReturnType<(typeof import("@/lib/auth"))["getAuth"]>;
let auth: Auth;
const PASSWORD = "imports-pass-123";

let owner: { userId: string; email: string; cookie: string };
let cs: { cookie: string };
let operator: { userId: string; email: string; cookie: string };
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

async function seedUser(t: string, role: "owner" | "customer_service" | "operator", org: string): Promise<{ userId: string; email: string; cookie: string }> {
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
  operator = await seedUser(`${t}op`, "operator", orgId);

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

async function upload(cookie: string, opts: {
  storeId?: string; dataSourceId?: string; kind?: string; kindField?: string;
  filename?: string; content: string; idempotencyField?: string;
}): Promise<Response> {
  const { POST } = await import("@/app/api/v1/imports/route");
  const form = new FormData();
  form.set("store_id", opts.storeId ?? storeId);
  form.set("data_source_id", opts.dataSourceId ?? dataSourceId);
  form.set(opts.kindField ?? "entity_type", opts.kind ?? "products");
  if (opts.idempotencyField) form.set("idempotency_key", opts.idempotencyField);
  form.set("file", csvFile(opts.filename ?? "products.csv", opts.content));
  return POST(req("/api/v1/imports", { method: "POST", body: form }, cookie));
}

async function makeTask(cookie: string, kind: string, content: string): Promise<{ id: string; sha: string }> {
  const res = await upload(cookie, { kind, content });
  // 内容此前可能已上传（复用返回 200）；两者均产出同一任务
  expect([200, 201]).toContain(res.status);
  const body = (await res.json()) as { data: { id: string; file_sha256: string } };
  return { id: body.data.id, sha: body.data.file_sha256 };
}

describe("TASK-007｜上传、幂等与任务查询", () => {
  it("O 上传 csv（entity_type 合同字段）→ 201 任务（sha256/行数/filename/bytes）；重复上传返回同任务", async () => {
    const res = await upload(owner.cookie, { kind: "products", content: PRODUCTS_CSV });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; file_sha256: string; row_count: number; status: string; filename: string; bytes: number } };
    expect(body.data.status).toBe("uploaded");
    expect(body.data.row_count).toBe(2);
    expect(body.data.file_sha256).toBe(createHash("sha256").update(PRODUCTS_CSV).digest("hex"));
    expect(body.data.filename).toBe("products.csv"); // M01：响应含 filename/bytes
    expect(body.data.bytes).toBe(Buffer.byteLength(PRODUCTS_CSV));

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
    expect(task.rawObjectKey.length).toBeGreaterThan(0); // H08：建账即带文件键

    // 重复请求 → 同任务（reused）
    const again = await upload(owner.cookie, { kind: "products", content: PRODUCTS_CSV });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { data: { id: string; reused: boolean } };
    expect(againBody.data.id).toBe(body.data.id);
    expect(againBody.data.reused).toBe(true);
  });

  it("G2-H07：并发同内容上传恰产生一个任务（部分唯一索引原子认领）", async () => {
    const content = `${PRODUCTS_CSV}\nIMP-1,2026-09-11T01:00:00Z,PX,并发杯,杯具,active,SX,CUP-X,杯,,active`;
    const results = await Promise.all([
      upload(owner.cookie, { kind: "products", content }),
      upload(owner.cookie, { kind: "products", content }),
      upload(owner.cookie, { kind: "products", content }),
      upload(owner.cookie, { kind: "products", content }),
    ]);
    const ids = new Set<string>();
    for (const r of results) {
      expect([200, 201]).toContain(r.status);
      const body = (await r.json()) as { data: { id: string } };
      ids.add(body.data.id);
    }
    expect(ids.size).toBe(1);
    const rows = await db.importTask.count({ where: { orgId, fileSha256: createHash("sha256").update(content).digest("hex") } });
    expect(rows).toBe(1);
  });

  it("G2-H07：Idempotency-Key 头——同 key 同 body 复用；同 key 异 body 409；multipart 字段不冒充请求幂等", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const key = `idem-${randomUUID().slice(0, 12)}`;
    // 独立内容（此前用例未上传过），确保首次为全新任务
    const base = PRODUCTS_CSV.replace("CUP-RED", "CUP-IDEM-A");
    const changed = PRODUCTS_CSV.replace("CUP-RED", "CUP-IDEM-B");
    const first = await uploadOnce(key, base);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data: { id: string } };
    const second = await uploadOnce(key, base);
    expect(second.status).toBe(201); // 重放首次响应
    const secondBody = (await second.json()) as { data: { id: string } };
    expect(secondBody.data.id).toBe(firstBody.data.id);

    // 同 key 异 body → 409
    const conflict = await uploadOnce(key, changed);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");

    // multipart 字段 idempotency_key 不再冒充 HTTP 幂等：不同内容两次均成功且任务不同
    const a = await upload(owner.cookie, { kind: "products", content: PRODUCTS_CSV.replace("CUP-RED", "CUP-FA"), idempotencyField: "same-field-key" });
    const b = await upload(owner.cookie, { kind: "products", content: PRODUCTS_CSV.replace("CUP-RED", "CUP-FB"), idempotencyField: "same-field-key" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const aId = ((await a.json()) as { data: { id: string } }).data.id;
    const bId = ((await b.json()) as { data: { id: string } }).data.id;
    expect(aId).not.toBe(bId);

    async function uploadOnce(k: string, content: string): Promise<Response> {
      const form = new FormData();
      form.set("store_id", storeId);
      form.set("data_source_id", dataSourceId);
      form.set("entity_type", "products");
      form.set("file", csvFile("p.csv", content));
      return POST(req("/api/v1/imports", { method: "POST", body: form, headers: { "idempotency-key": k } }, owner.cookie));
    }
  });

  it("审计：import_upload 同事务写入", async () => {
    const count = await db.auditLog.count({ where: { action: "import_upload", orgId } });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe("TASK-007｜类型权限（G2-H05）", () => {
  it("C 不能上传订单文件（403）；C 可上传客户消息（201）且不入 public", async () => {
    const orderRes = await upload(cs.cookie, { kind: "orders", content: "store_external_id,source_updated_at,external_order_id,payment_status,ordered_at,paid_at,currency,expected_item_count\nIMP-1,2026-09-11T01:00:00Z,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1" });
    expect(orderRes.status).toBe(403);
    expect(((await orderRes.json()) as { error: { code: string } }).error.code).toBe("FILE_KIND_FORBIDDEN");

    const msgRes = await upload(cs.cookie, { kind: "customer_messages", content: "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language\nIMP-1,2026-09-11T01:00:00Z,MX1,CX1,2026-09-01T11:00:00Z,S1,你好,,platform_chat,zh-CN" });
    expect(msgRes.status).toBe(201);
    const task = await db.importTask.findUniqueOrThrow({
      where: { id: ((await msgRes.json()) as { data: { id: string } }).data.id },
    });
    expect(task.rawObjectKey.startsWith("raw/")).toBe(true);
    expect(task.rawObjectKey).not.toContain("public");
  });

  it("C 可查询/签名下载自己的消息任务；P 可查询自己的订单任务；C 查询订单任务 403", async () => {
    const { GET } = await import("@/app/api/v1/imports/[id]/route");
    const { GET: fileGet } = await import("@/app/api/v1/imports/[id]/file/route");
    const { signDownload } = await import("@/storage");

    const csTask = await makeTask(cs.cookie, "customer_messages", "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language\nIMP-1,2026-09-11T01:00:00Z,MC1,CC1,2026-09-01T11:00:00Z,,查询测试,,platform_chat,zh-CN");
    const csQuery = await GET(req(`/api/v1/imports/${csTask.id}`, {}, cs.cookie), { params: Promise.resolve({ id: csTask.id }) });
    expect(csQuery.status).toBe(200);

    const signed = signDownload((await db.importTask.findUniqueOrThrow({ where: { id: csTask.id } })).rawObjectKey);
    const dl = await fileGet(
      req(`/api/v1/imports/${csTask.id}/file?expires=${signed.expiresAt}&signature=${signed.signature}`, {}, cs.cookie),
      { params: Promise.resolve({ id: csTask.id }) },
    );
    expect(dl.status).toBe(200);
    expect((await dl.text()).length).toBeGreaterThan(0);

    const opTask = await makeTask(operator.cookie, "orders", "store_external_id,source_updated_at,external_order_id,payment_status,ordered_at,paid_at,currency,expected_item_count\nIMP-1,2026-09-11T01:00:00Z,OP1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1");
    const opQuery = await GET(req(`/api/v1/imports/${opTask.id}`, {}, operator.cookie), { params: Promise.resolve({ id: opTask.id }) });
    expect(opQuery.status).toBe(200);

    const csOnOrder = await GET(req(`/api/v1/imports/${opTask.id}`, {}, cs.cookie), { params: Promise.resolve({ id: opTask.id }) });
    expect(csOnOrder.status).toBe(403);
    expect(((await csOnOrder.json()) as { error: { code: string } }).error.code).toBe("FILE_KIND_FORBIDDEN");
  });

  it("降权后旧任务与链接拒绝：C 消息任务在成员禁用后查询 403、下载 403", async () => {
    const { GET } = await import("@/app/api/v1/imports/[id]/route");
    const { GET: fileGet } = await import("@/app/api/v1/imports/[id]/file/route");
    const { signDownload } = await import("@/storage");

    const member = await seedUser(`down-${randomUUID().slice(0, 6)}`, "customer_service", orgId);
    const task = await makeTask(member.cookie, "customer_messages", "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language\nIMP-1,2026-09-11T01:00:00Z,MD1,CD1,2026-09-01T11:00:00Z,,降权测试,,platform_chat,zh-CN");
    const signed = signDownload((await db.importTask.findUniqueOrThrow({ where: { id: task.id } })).rawObjectKey);

    // 禁用该成员当前组织 Membership（D01 方案 A）
    await db.membership.updateMany({ where: { orgId, userId: member.userId }, data: { status: "disabled" } });

    const q = await GET(req(`/api/v1/imports/${task.id}`, {}, member.cookie), { params: Promise.resolve({ id: task.id }) });
    expect(q.status).toBe(403);
    const d = await fileGet(
      req(`/api/v1/imports/${task.id}/file?expires=${signed.expiresAt}&signature=${signed.signature}`, {}, member.cookie),
      { params: Promise.resolve({ id: task.id }) },
    );
    expect(d.status).toBe(403);
  });
});

describe("TASK-007｜限制与拒绝", () => {
  it("mock 数据源不接受上传（422）；归档店拒绝（409）", async () => {
    const mockSource = await db.dataSource.create({
      data: { orgId, storeId: mockStoreId, sourceNamespace: "ns-demo-import", name: "演示源", adapterKind: "mock" },
    });
    const res = await upload(owner.cookie, { storeId: mockStoreId, dataSourceId: mockSource.id, kind: "products", content: PRODUCTS_CSV });
    expect(res.status).toBe(422);

    await db.store.update({ where: { id: storeId }, data: { status: "archived" } });
    const archived = await upload(owner.cookie, { kind: "customer_messages", content: PRODUCTS_CSV });
    expect(archived.status).toBe(409);
    await db.store.update({ where: { id: storeId }, data: { status: "active" } });
  });

  it("超过 10 万逻辑行即停止解析（422 TOO_MANY_ROWS）", async () => {
    const header = "store_external_id,source_updated_at,external_order_id,external_order_item_id,external_sku_id,quantity,item_paid_amount,currency";
    const rows: string[] = [header];
    for (let i = 0; i < 100_002; i++) {
      rows.push(`IMP-1,2026-09-11T01:00:00Z,O${i},L1,S1,1,10.000000,CNY`);
    }
    const res = await upload(operator.cookie, { kind: "order_items", filename: "huge.csv", content: rows.join("\n") });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_ROWS");
  }, 120_000);

  it("G2-H06：quoted 换行按单条逻辑记录计数（50,001 条不误拒）", async () => {
    const header = "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language";
    const rows: string[] = [header];
    for (let i = 0; i < 50_001; i++) {
      rows.push(`IMP-1,2026-09-11T01:00:00Z,M${i},C1,2026-09-01T11:00:00Z,,"多行消息第一行\n第二行",,platform_chat,zh-CN`);
    }
    const res = await upload(operator.cookie, { kind: "customer_messages", filename: "quoted.csv", content: rows.join("\n") });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { data: { row_count: number } }).data.row_count).toBe(50_001);
  }, 120_000);

  it("超过 20MB 真实分块流在接收链路立即中止（422 FILE_TOO_LARGE，不等 multipart 结束）", async () => {
    const { POST } = await import("@/app/api/v1/imports/route");
    const CHUNK = 1024 * 1024;
    const chunkBuf = Buffer.alloc(CHUNK, 0x61);
    let sent = 0;
    // 请求体：multipart 头 + 文件内容块；超过 21MiB 后不再产出且永不结束——
    // 若服务端整体缓冲（等 multipart 结束才响应），本用例将超时挂死
    const boundary = `----vitest${randomUUID().slice(0, 8)}`;
    const head = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="store_id"',
      "",
      storeId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="data_source_id"',
      "",
      dataSourceId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="entity_type"',
      "",
      "customer_messages",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="big.csv"',
      "Content-Type: text/csv",
      "",
      "",
    ].join("\r\n");
    const headBytes = Buffer.from(head, "utf8");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(headBytes));
      },
      async pull(controller) {
        if (sent > 21 * CHUNK) {
          await new Promise(() => undefined); // 永不结束（模拟未闭合 multipart 后继续传输）
          return;
        }
        controller.enqueue(new Uint8Array(chunkBuf));
        sent += CHUNK;
      },
    });
    const res = await POST(
      req("/api/v1/imports", {
        method: "POST",
        body,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        duplex: "half",
      } as RequestInit, operator.cookie),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FILE_TOO_LARGE");
    // 请求体永不结束：响应能返回本身即证明未等待 multipart 结束；
    // 消费量应落在限额附近（20MiB 上限，而非无限缓冲）
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toBeGreaterThanOrEqual(20 * 1024 * 1024);
    expect(sent).toBeLessThan(26 * 1024 * 1024);
  }, 120_000);

  it("M03：非 .csv 扩展名 415；非法 UTF-8 422 INVALID_ENCODING", async () => {
    const xlsx = await upload(owner.cookie, { kind: "products", filename: "data.xlsx", content: PRODUCTS_CSV });
    expect(xlsx.status).toBe(415);
    expect(((await xlsx.json()) as { error: { code: string } }).error.code).toBe("UNSUPPORTED_FILE_TYPE");

    const { POST } = await import("@/app/api/v1/imports/route");
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("entity_type", "customer_messages");
    form.set("file", new File([Buffer.from([0x49, 0x6d, 0x50, 0x2d, 0x31, 0x80, 0xff, 0x0a])], "bad.csv", { type: "text/csv" }));
    const bad = await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie));
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_ENCODING");
  });

  it("G2-H08 窗口1：落盘失败不产生任务，重试创建全新任务（无空键复用）", async () => {
    const brokenRoot = join(tmpdir(), `aiea-broken-${randomUUID().slice(0, 6)}`);
    // 以"文件"占用目录路径，使 mkdir 失败
    const { writeFileSync } = await import("node:fs");
    writeFileSync(brokenRoot, "not-a-dir");
    setStorageRoot(brokenRoot);
    try {
      const failed = await upload(owner.cookie, { kind: "order_items", filename: "w.csv", content: `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-11T01:00:00Z,OW,LW,S1,1,10.000000,CNY` });
      expect([500, 503]).toContain(failed.status);
      // 关键：没有产生 rawObjectKey 为空的任务（旧行为会 reused 空 key 任务）
      expect(await db.importTask.count({ where: { orgId, rawObjectKey: "" } })).toBe(0);
    } finally {
      setStorageRoot(privateRoot);
    }
    const ok = await upload(owner.cookie, { kind: "order_items", filename: "w.csv", content: `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-11T01:00:00Z,OW,LW,S1,1,10.000000,CNY` });
    expect(ok.status).toBe(201);
    const okBody = (await ok.json()) as { data: { id: string; reused: boolean } };
    expect(okBody.data.reused).toBe(false);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: okBody.data.id } });
    expect(task.rawObjectKey.startsWith("raw/")).toBe(true);
  }, 120_000);
});

describe("TASK-007｜签名下载与 validate/恢复边界", () => {
  let taskId: string;

  beforeAll(async () => {
    const t = await makeTask(owner.cookie, "products", PRODUCTS_CSV);
    taskId = t.id;
  });

  it("未签名下载 403；正确签名 200 且内容一致；默认有效期 300 秒（G2-L02）", async () => {
    const { GET: fileGet } = await import("@/app/api/v1/imports/[id]/file/route");
    const unsigned = await fileGet(req(`/api/v1/imports/${taskId}/file`, {}, owner.cookie), { params: Promise.resolve({ id: taskId }) });
    expect(unsigned.status).toBe(403);

    const { signDownload } = await import("@/storage");
    const task = await db.importTask.findUniqueOrThrow({ where: { id: taskId } });
    const sig = signDownload(task.rawObjectKey);
    expect(Math.abs((sig.expiresAt - Date.now()) / 1000 - 300)).toBeLessThan(5);
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

  it("validate handler：解析统计入库；错误行写私有对象；组装 CanonicalBatch（G2-H04 消费点）", async () => {
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    const result = await handleValidateTask({ taskId });
    expect(result.status).toBe("preview_ready");
    expect(result.valid).toBe(2);
    expect(result.errors).toBe(0);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("preview_ready");
    expect(task.validCount).toBe(2);

    // 错误路径：独立上传含错行文件 → validate → 错误计数 + 私有错误对象
    const badTask = await makeTask(owner.cookie, "order_items", `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-11T01:00:00Z,O9,L9,S1,0,10.000000,CNY`);
    const badResult = await handleValidateTask({ taskId: badTask.id });
    expect(badResult.status).toBe("preview_ready");
    expect(badResult.errors).toBe(1);
    const badTaskRow = await db.importTask.findUniqueOrThrow({ where: { id: badTask.id } });
    expect(badTaskRow.errorCount).toBe(1);
    expect(badTaskRow.errorObjectKey).toBe(`errors/${badTask.id}/errors.csv`);
  });

  it("G2-H05：执行前撤权 → 任务终态 failed UPLOAD_PERMISSION_REVOKED，不解析", async () => {
    const member = await seedUser(`revoke-${randomUUID().slice(0, 6)}`, "customer_service", orgId);
    const t = await makeTask(member.cookie, "customer_messages", "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language\nIMP-1,2026-09-11T01:00:00Z,MR1,CR1,2026-09-01T11:00:00Z,,撤权重查,,platform_chat,zh-CN");
    await db.membership.updateMany({ where: { orgId, userId: member.userId }, data: { status: "disabled" } });

    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    const result = await handleValidateTask({ taskId: t.id });
    expect(result.status).toBe("failed");
    const row = await db.importTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("UPLOAD_PERMISSION_REVOKED");
  });

  it("G2-H08 窗口2/3：投递丢失由 dispatcher 补投；悬挂 validating 落失败终态", async () => {
    // 窗口2：任务已建账但从未投递（模拟 enqueue 失败后遗留）→ sweep 补投并标 dispatched
    const lost = await db.importTask.create({
      data: {
        orgId, storeId, dataSourceId, sourceKind: "products", status: "uploaded",
        originalFilename: "lost.csv", rawObjectKey: `raw/${randomUUID()}/source.csv`,
        fileSha256: randomUUID(), uploadRequestKey: randomUUID().replace(/-/g, ""),
        baseDatasetVersion: 0n, rowCount: 2, outboxStatus: "pending",
        createdBy: owner.userId,
        updatedAt: new Date(Date.now() - 120_000),
      },
    });
    // 为补投任务准备真实对象（validate 需要读取）
    const { putObject } = await import("@/storage");
    const { Readable } = await import("node:stream");
    await putObject(lost.rawObjectKey, Readable.from([PRODUCTS_CSV]));
    void lost;

    const { sweepDispatches } = await import("@/jobs/dispatcher");
    const sweep = await sweepDispatches();
    expect(sweep.dispatched).toBeGreaterThanOrEqual(1);
    const after = await db.importTask.findUniqueOrThrow({ where: { id: lost.id } });
    expect(after.outboxStatus).toBe("dispatched");
    // 补投后 handler 正常执行到终态
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    const run = await handleValidateTask({ taskId: lost.id });
    expect(run.status).toBe("preview_ready");

    // 窗口3：悬挂 validating（进程中断未落终态）→ sweep 落 failed+VALIDATE_INTERRUPTED
    const stuck = await db.importTask.create({
      data: {
        orgId, storeId, dataSourceId, sourceKind: "orders", status: "validating",
        originalFilename: "stuck.csv", rawObjectKey: `raw/${randomUUID()}/source.csv`,
        fileSha256: randomUUID(), uploadRequestKey: randomUUID().replace(/-/g, ""),
        baseDatasetVersion: 0n, rowCount: 1, outboxStatus: "dispatched",
        createdBy: owner.userId,
        updatedAt: new Date(Date.now() - 11 * 60_000),
      },
    });
    const sweep2 = await sweepDispatches();
    expect(sweep2.failedStale).toBeGreaterThanOrEqual(1);
    const stuckRow = await db.importTask.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(stuckRow.status).toBe("failed");
    expect(stuckRow.errorCode).toBe("VALIDATE_INTERRUPTED");
  });

  it("G2-H08：文件缺失为明确失败终态（SOURCE_FILE_MISSING），重投幂等跳过", async () => {
    const ghost = await db.importTask.create({
      data: {
        orgId, storeId, dataSourceId, sourceKind: "products", status: "uploaded",
        originalFilename: "ghost.csv", rawObjectKey: `raw/${randomUUID()}/source.csv`,
        fileSha256: randomUUID(), uploadRequestKey: randomUUID().replace(/-/g, ""),
        baseDatasetVersion: 0n, rowCount: 1, outboxStatus: "dispatched",
        createdBy: owner.userId,
      },
    });
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    const first = await handleValidateTask({ taskId: ghost.id });
    expect(first.status).toBe("failed");
    const row = await db.importTask.findUniqueOrThrow({ where: { id: ghost.id } });
    expect(row.errorCode).toBe("SOURCE_FILE_MISSING");
    // 重投到终态：幂等跳过，不再变更
    const again = await handleValidateTask({ taskId: ghost.id });
    expect(again.status).toBe("failed");
    expect(again.valid).toBe(0);
  });

  it("commit 边界：显式拒绝（TASK-008 实现），不冒充已提交", async () => {
    const { handleCommitTask } = await import("@/jobs/handlers/imports");
    await expect(handleCommitTask({ taskId })).rejects.toThrow(/TASK-008/);
  });
});

// ---------------------------------------------------------------------------
// GATE_02 REVIEW 2 修复回归（docs/reviews/CODEX_REVIEW_GATE_02_REVIEW_2_2026-09-16.md §4/§5/§13）
// ---------------------------------------------------------------------------

describe("GATE_02 REVIEW 2 回归｜H05/H06/H07/H08/M04", () => {
  async function uploadHeader(cookie: string, k: string, c: string): Promise<Response> {
    const { POST } = await import("@/app/api/v1/imports/route");
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("entity_type", "products");
    form.set("file", csvFile("p.csv", c));
    return POST(req("/api/v1/imports", { method: "POST", body: form, headers: { "idempotency-key": k } }, cookie));
  }

  function privateTmpFileCount(): number {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    try {
      return readdirSync(join(storageRoot(), "tmp")).length;
    } catch {
      return 0;
    }
  }

  it("G2-R2-H05：领域全局 User 禁用（Membership 仍 active）→ 未终态任务终态拒绝", async () => {
    const member = await seedUser(`udis-${randomUUID().slice(0, 6)}`, "customer_service", orgId);
    const t = await makeTask(member.cookie, "customer_messages", "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language\nIMP-1,2026-09-11T01:00:00Z,MU1,CU1,2026-09-01T11:00:00Z,,全局禁用,,platform_chat,zh-CN");
    // 平台运维级禁用（对照 src/lib/session.ts 的 HTTP 侧同款规则）：全局 User.status=disabled
    await db.user.update({ where: { id: member.userId }, data: { status: "disabled" } });

    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    const result = await handleValidateTask({ taskId: t.id });
    expect(result.status).toBe("failed");
    const row = await db.importTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("UPLOAD_PERMISSION_REVOKED");
    expect(row.validCount).toBe(0);
  });

  it("G2-R2-H06：空行前缀+100001 条数据仍拒绝（422 TOO_MANY_ROWS），计数不因空行停摆", async () => {
    const header = "store_external_id,source_updated_at,external_order_id,external_order_item_id,external_sku_id,quantity,item_paid_amount,currency";
    const rows: string[] = [header, ""];
    for (let i = 0; i < 100_001; i++) {
      rows.push(`IMP-1,2026-09-11T01:00:00Z,O${i},L1,S1,1,10.000000,CNY`);
    }
    const res = await upload(operator.cookie, { kind: "order_items", filename: "blank.csv", content: rows.join("\n") });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_ROWS");
    expect(privateTmpFileCount()).toBe(0);
  }, 120_000);

  it("G2-R2-H06：字段缺失/类型不支持/角色拒绝/扩展名拒绝不留临时文件", async () => {
    const before = privateTmpFileCount();
    const forbidden = await upload(cs.cookie, { kind: "orders", content: PRODUCTS_CSV });
    expect(forbidden.status).toBe(403);
    const badExt = await upload(owner.cookie, { kind: "products", filename: "data.xlsx", content: PRODUCTS_CSV });
    expect(badExt.status).toBe(415);
    const badKind = await upload(owner.cookie, { kind: "not_a_kind", content: PRODUCTS_CSV });
    expect(badKind.status).toBe(422);
    expect(privateTmpFileCount()).toBe(before);
  });

  it("G2-R2-H07：已有内容+新 key 复用并绑定存档——同 key 同 body 200、异 body 409", async () => {
    const key = `idem2-${randomUUID().slice(0, 12)}`;
    const content = PRODUCTS_CSV.replace("CUP-RED", "CUP-R2A");
    // 前置：无 Idempotency-Key 的首次上传，使内容已存在
    const seed = await upload(owner.cookie, { kind: "products", content });
    expect(seed.status).toBe(201);
    const first = await uploadHeader(owner.cookie, key, content);
    expect(first.status).toBe(200); // 已有内容 → 复用（200），同时绑定本 key 的存档
    const firstId = ((await first.json()) as { data: { id: string } }).data.id;
    const second = await uploadHeader(owner.cookie, key, content);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { data: { id: string } }).data.id).toBe(firstId);
    const conflict = await uploadHeader(owner.cookie, key, content.replace("CUP-R2A", "CUP-R2B"));
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("G2-R2-H07：Key 按用户隔离；并发同 key 异 body 恰一 201 一 409，且无无文件任务", async () => {
    const sharedKey = `shared-${randomUUID().slice(0, 10)}`;
    const contentA = PRODUCTS_CSV.replace("CUP-RED", "CUP-UA");
    const contentB = PRODUCTS_CSV.replace("CUP-RED", "CUP-UB");
    // 跨用户同 key 各自独立成功
    const ua = await uploadHeader(owner.cookie, sharedKey, contentA);
    const ub = await uploadHeader(operator.cookie, sharedKey, contentB);
    expect(ua.status).toBe(201);
    expect(ub.status).toBe(201);

    // 并发同 key 异 body：恰一 201 一 409；落库任务恰 1 个且其文件真实存在
    const raceKey = `race-${randomUUID().slice(0, 10)}`;
    const c1 = PRODUCTS_CSV.replace("CUP-RED", "CUP-RC1");
    const c2 = PRODUCTS_CSV.replace("CUP-RED", "CUP-RC2");
    const [r1, r2] = await Promise.all([
      uploadHeader(operator.cookie, raceKey, c1),
      uploadHeader(operator.cookie, raceKey, c2),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const okBody = r1.status === 201 ? r1 : r2;
    const loserContent = r1.status === 201 ? c2 : c1;
    const okId = ((await okBody.json()) as { data: { id: string } }).data.id;
    const okTask = await db.importTask.findUniqueOrThrow({ where: { id: okId } });
    const { objectExists } = await import("@/storage");
    expect(await objectExists(okTask.rawObjectKey)).toBe(true);
    // 败者不得留下任何任务（尤其无文件任务）
    expect(await db.importTask.count({ where: { orgId, fileSha256: createHash("sha256").update(loserContent).digest("hex") } })).toBe(0);
  });

  it("G2-R2-H07：存档写入失败 → 上传不无保护成功（503），无任务残留", async () => {
    await db.$executeRaw`ALTER TABLE http_idempotency RENAME COLUMN request_hash TO request_hash_broken`;
    let status = 0;
    try {
      const { POST } = await import("@/app/api/v1/imports/route");
      const form = new FormData();
      form.set("store_id", storeId);
      form.set("data_source_id", dataSourceId);
      form.set("entity_type", "products");
      form.set("file", csvFile("p.csv", PRODUCTS_CSV.replace("CUP-RED", "CUP-BROKEN")));
      status = (await POST(req("/api/v1/imports", { method: "POST", body: form, headers: { "idempotency-key": `broken-${randomUUID().slice(0, 10)}` } }, owner.cookie))).status;
    } finally {
      await db.$executeRaw`ALTER TABLE http_idempotency RENAME COLUMN request_hash_broken TO request_hash`;
    }
    expect(status).toBe(503);
    expect(await db.importTask.count({ where: { orgId, fileSha256: createHash("sha256").update(PRODUCTS_CSV.replace("CUP-RED", "CUP-BROKEN")).digest("hex") } })).toBe(0);
  });

  it("G2-R2-H08：tmp 目录不可写（写流 EACCES）→ 503 可控返回，无任务、不崩溃", { timeout: 120_000 }, async () => {
    const { chmodSync, mkdirSync, existsSync } = await import("node:fs");
    const { storageRoot } = await import("@/storage");
    const tmpDir = join(storageRoot(), "tmp");
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    chmodSync(tmpDir, 0o555);
    let status = 0;
    try {
      const { POST } = await import("@/app/api/v1/imports/route");
      const form = new FormData();
      form.set("store_id", storeId);
      form.set("data_source_id", dataSourceId);
      form.set("entity_type", "products");
      form.set("file", csvFile("p.csv", PRODUCTS_CSV.replace("CUP-RED", "CUP-EACCES")));
      status = (await POST(req("/api/v1/imports", { method: "POST", body: form }, owner.cookie))).status;
    } finally {
      chmodSync(tmpDir, 0o755);
    }
    expect([500, 503]).toContain(status);
    expect(await db.importTask.count({ where: { orgId, fileSha256: createHash("sha256").update(PRODUCTS_CSV.replace("CUP-RED", "CUP-EACCES")).digest("hex") } })).toBe(0);
  });

  it("G2-R2-M04：OSS 驱动调用链——本地 spool 直读、落位走远端 put、本地临时清理", async () => {
    // 注入内存对象服务；STORAGE_DRIVER=oss 下完整走真实 route→spool→读取→建账→落位
    const objects = new Map<string, Buffer>();
    const putKeys: string[] = [];
    const fake = {
      put: async (key: string, buffer: Buffer) => {
        putKeys.push(key);
        objects.set(key, buffer);
        return {};
      },
      get: async (key: string) => {
        const content = objects.get(key);
        if (!content) throw Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" });
        return { content };
      },
      getStream: async (key: string) => {
        const { content } = await (fake as { get(key: string): Promise<{ content: Buffer }> }).get(key);
        const { PassThrough } = await import("node:stream");
        const pt = new PassThrough();
        pt.end(content);
        return { stream: pt };
      },
      head: async (key: string) => {
        if (!objects.has(key)) throw new Error("NoSuchKey");
        return {};
      },
      delete: async (key: string) => {
        objects.delete(key);
        return {};
      },
      copy: async (toKey: string, fromKey: string) => {
        const content = objects.get(fromKey);
        if (!content) throw new Error("NoSuchKey");
        objects.set(toKey, content);
        return {};
      },
    };
    const { setOssClientForTests } = await import("@/storage/oss");
    setOssClientForTests(fake as never);
    const savedDriver = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = "oss";
    try {
      const res = await upload(owner.cookie, { kind: "products", content: PRODUCTS_CSV.replace("CUP-RED", "CUP-OSS") });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { id: string; file_sha256: string } };
      const task = await db.importTask.findUniqueOrThrow({ where: { id: body.data.id } });
      // 原文件已落位到注入的远端对象服务
      expect(objects.has(task.rawObjectKey)).toBe(true);
      expect(putKeys).toContain(task.rawObjectKey);
      expect(objects.get(task.rawObjectKey)!.toString()).toBe(PRODUCTS_CSV.replace("CUP-RED", "CUP-OSS"));
      // 本地 tmp 已清理
      expect(privateTmpFileCount()).toBe(0);
      // 签名下载在 OSS 驱动下读取远端对象
      const { GET: fileGet } = await import("@/app/api/v1/imports/[id]/file/route");
      const { signDownload } = await import("@/storage");
      const sig = signDownload(task.rawObjectKey);
      const dl = await fileGet(
        req(`/api/v1/imports/${task.id}/file?expires=${sig.expiresAt}&signature=${sig.signature}`, {}, owner.cookie),
        { params: Promise.resolve({ id: task.id }) },
      );
      expect(dl.status).toBe(200);
      expect(await dl.text()).toBe(PRODUCTS_CSV.replace("CUP-RED", "CUP-OSS"));
    } finally {
      if (savedDriver === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = savedDriver;
      setOssClientForTests(undefined);
    }
  });
});

describe("GATE_02 REVIEW 3 回归｜H06/H08 中断清理、TOO_MANY_ROWS 竞态与 M06 并发重放", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const tmpFileCount = (): number => {
    try {
      return readdirSync(join(storageRoot(), "tmp")).length;
    } catch {
      return 0;
    }
  };

  const R3_ROW = "IMP-1,2026-09-11T01:00:00Z,R3O,L1,S1,1,10.000000,CNY";

  /** 原生 multipart 请求（不经 FormData）：head + chunks + 可调结束行为 */
  async function postRaw(cookie: string, chunks: Buffer[], after: "close" | "error" | "never"): Promise<Response> {
    const boundary = `----r3-${randomUUID().slice(0, 8)}`;
    const head = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="store_id"',
      "",
      storeId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="data_source_id"',
      "",
      dataSourceId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="entity_type"',
      "",
      "order_items",
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="r3.csv"',
      "Content-Type: text/csv",
      "",
      "",
    ].join("\r\n");
    let sent = 0;
    let errored = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from(head, "utf8")));
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        if (after === "close") controller.close(); // multipart 未携带收尾边界即结束
      },
      pull(controller) {
        if (sent < chunks.length) {
          sent = chunks.length;
          return;
        }
        if (after === "error" && !errored) {
          errored = true;
          controller.error(new Error("client disconnected"));
          return;
        }
        if (after === "never") {
          return new Promise(() => undefined); // 请求永不结束（multipart 未闭合仍持续传输）
        }
      },
    });
    const { POST } = await import("@/app/api/v1/imports/route");
    return POST(
      req("/api/v1/imports", {
        method: "POST",
        body,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        duplex: "half",
      } as RequestInit,
      cookie),
    );
  }

  async function uploadHeaderKey(cookie: string, key: string, content: string): Promise<Response> {
    const { POST } = await import("@/app/api/v1/imports/route");
    const form = new FormData();
    form.set("store_id", storeId);
    form.set("data_source_id", dataSourceId);
    form.set("entity_type", "products");
    form.set("file", csvFile("p.csv", content));
    return POST(req("/api/v1/imports", { method: "POST", body: form, headers: { "idempotency-key": key } }, cookie));
  }

  it("G2-R3-H06/H08：multipart 提前截断（未闭合即关闭）→ 400 UPLOAD_INTERRUPTED，不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const body = `store_external_id,source_updated_at,external_order_id,external_order_item_id,external_sku_id,quantity,item_paid_amount,currency\n${R3_ROW}\n`;
    const sha = createHash("sha256").update(body).digest("hex");
    const before = tmpFileCount();
    const res = await postRaw(operator.cookie, [Buffer.from(body, "utf8")], "close");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UPLOAD_INTERRUPTED");
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });

  it("G2-R3-H06：请求未结束但行数超限 → 稳定 422 TOO_MANY_ROWS（不降级为通用 multipart 错误）", { timeout: 120_000 }, async () => {
    const before = tmpFileCount();
    const chunks: Buffer[] = [];
    for (let c = 0; c < 11; c++) {
      chunks.push(Buffer.from(`${R3_ROW}\n`.repeat(10_000), "utf8")); // 共 110,000 数据行
    }
    const res = await postRaw(operator.cookie, chunks, "never");
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOO_MANY_ROWS");
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
  });

  it("G2-R3-H06/H08：请求源中途 error（客户端断开）→ 400 UPLOAD_INTERRUPTED，不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const body = `store_external_id,source_updated_at,external_order_id,external_order_item_id,external_sku_id,quantity,item_paid_amount,currency\n${R3_ROW}\n`;
    const sha = createHash("sha256").update(body).digest("hex");
    const before = tmpFileCount();
    const res = await postRaw(operator.cookie, [Buffer.from(body, "utf8")], "error");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UPLOAD_INTERRUPTED");
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });

  it("G2-R3-M06：同 key 同 body 并发 → 败者按存档首次 201 重放（非 200），恰一个任务且文件可读", { timeout: 120_000 }, async () => {
    const key = `idem3-${randomUUID().slice(0, 12)}`;
    const content = PRODUCTS_CSV.replace("CUP-RED", "CUP-R3M6");
    const sha = createHash("sha256").update(content).digest("hex");
    // 同一用户（key 按 org/user/endpoint 隔离，跨用户是独立存档，由既有用例覆盖）
    const responses = await Promise.all([
      uploadHeaderKey(owner.cookie, key, content),
      uploadHeaderKey(owner.cookie, key, content),
      uploadHeaderKey(owner.cookie, key, content),
      uploadHeaderKey(owner.cookie, key, content),
    ]);
    const ids = new Set<string>();
    for (const r of responses) {
      expect(r.status).toBe(201);
      ids.add(((await r.json()) as { data: { id: string } }).data.id);
    }
    expect(ids.size).toBe(1);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(1);
    const task = await db.importTask.findFirstOrThrow({ where: { orgId, fileSha256: sha } });
    const { objectExists } = await import("@/storage");
    expect(await objectExists(task.rawObjectKey)).toBe(true);
  });

  it("G2-R3-M06：Key 长度边界 7/129 → 422（8/128 合法路径由既有用例覆盖）", async () => {
    const short = await uploadHeaderKey(owner.cookie, "a".repeat(7), PRODUCTS_CSV);
    expect(short.status).toBe(422);
    const long = await uploadHeaderKey(owner.cookie, "b".repeat(129), PRODUCTS_CSV);
    expect(long.status).toBe(422);
  });
});

describe("GATE_02 REVIEW 4 回归｜文件部分完成后请求尾部失败的请求级收尾", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const tmpFileCount = (): number => {
    try {
      return readdirSync(join(storageRoot(), "tmp")).length;
    } catch {
      return 0;
    }
  };

  const MESSAGE_HEADER = "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language";

  /**
   * 原生 multipart：文件部分【完整终止】后跟随一个后续文本字段；
   * tail=complete 送最终边界；truncate 只缺最终边界即结束；cancel 直接断开。
   * tailDelayMs 模拟延迟截断（等待 spool 已成功落定的变体）。
   */
  async function postTail(cookie: string, opts: {
    kind: string; filename: string; content: string;
    tail: "complete" | "truncate" | "cancel"; tailDelayMs?: number;
  }): Promise<Response> {
    const boundary = `----r4-${randomUUID().slice(0, 8)}`;
    const head = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="store_id"',
      "",
      storeId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="data_source_id"',
      "",
      dataSourceId,
      `--${boundary}`,
      'Content-Disposition: form-data; name="entity_type"',
      "",
      opts.kind,
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${opts.filename}"`,
      "Content-Type: text/csv",
      "",
      "",
    ].join("\r\n");
    // 文件部分完整终止（携带其结束边界），随后一个未完成的文本字段
    const bodyText =
      `${head}${opts.content}\r\n--${boundary}\r\n` +
      'Content-Disposition: form-data; name="note"\r\n\r\nincomplete-tail';
    let terminated = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from(bodyText, "utf8")));
        const terminate = () => {
          if (terminated) return;
          terminated = true;
          if (opts.tail === "complete") {
            controller.enqueue(new Uint8Array(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")));
            controller.close();
          } else if (opts.tail === "truncate") {
            controller.close();
          } else {
            controller.error(new Error("client disconnected"));
          }
        };
        if ((opts.tailDelayMs ?? 0) > 0) setTimeout(terminate, opts.tailDelayMs);
        else terminate();
      },
    });
    const { POST } = await import("@/app/api/v1/imports/route");
    return POST(
      req("/api/v1/imports", {
        method: "POST",
        body,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        duplex: "half",
      } as RequestInit,
      cookie),
    );
  }

  it("R4 对照：完整合法尾部（products）→ 201、恰 1 任务、tmp=0", { timeout: 120_000 }, async () => {
    const content = `${FILE_HEADERS.products.join(",")}\nR4-1,2026-09-11T01:00:00Z,R4P,杯,杯具,active,R4S,CUP-R4,杯,,active`;
    const sha = createHash("sha256").update(content).digest("hex");
    const before = tmpFileCount();
    const res = await postTail(operator.cookie, { kind: "products", filename: "r4.csv", content, tail: "complete" });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(1);
  });

  it("R4 H06/H08：文件部分完成后尾部截断（products）→ 4xx，不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const content = `${FILE_HEADERS.products.join(",")}\nR4-1,2026-09-11T01:00:00Z,R4T,杯,杯具,active,R4S,CUP-R4T,杯,,active`;
    const sha = createHash("sha256").update(content).digest("hex");
    const before = tmpFileCount();
    const res = await postTail(operator.cookie, { kind: "products", filename: "r4t.csv", content, tail: "truncate" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });

  it("R4 H06/H08：文件部分完成后 socket 取消（products）→ 不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const content = `${FILE_HEADERS.products.join(",")}\nR4-1,2026-09-11T01:00:00Z,R4C,杯,杯具,active,R4S,CUP-R4C,杯,,active`;
    const sha = createHash("sha256").update(content).digest("hex");
    const before = tmpFileCount();
    const res = await postTail(operator.cookie, { kind: "products", filename: "r4c.csv", content, tail: "cancel" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });

  it("R4 对照：CustomerService 合成消息完整尾部 → 201、tmp=0", { timeout: 120_000 }, async () => {
    const content = `${MESSAGE_HEADER}\nR4-1,2026-09-11T01:00:00Z,R4M1,R4C1,2026-09-01T11:00:00Z,,你好，请问发货了吗,,platform_chat,zh-CN`;
    const before = tmpFileCount();
    const res = await postTail(cs.cookie, { kind: "customer_messages", filename: "msg.csv", content, tail: "complete" });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
  });

  it("R4 H06/H08：CS 消息 0ms 快速截断 → 不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const content = `${MESSAGE_HEADER}\nR4-1,2026-09-11T01:00:00Z,R4M2,R4C2,2026-09-01T11:00:00Z,,快速截断消息,,platform_chat,zh-CN`;
    const sha = createHash("sha256").update(content).digest("hex");
    const before = tmpFileCount();
    const res = await postTail(cs.cookie, { kind: "customer_messages", filename: "msg.csv", content, tail: "truncate", tailDelayMs: 0 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });

  it("R4 H06/H08：CS 消息 350ms 延迟截断（spool 已成功落定）→ 不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const content = `${MESSAGE_HEADER}\nR4-1,2026-09-11T01:00:00Z,R4M3,R4C3,2026-09-01T11:00:00Z,,延迟截断消息,,platform_chat,zh-CN`;
    const sha = createHash("sha256").update(content).digest("hex");
    const before = tmpFileCount();
    const res = await postTail(cs.cookie, { kind: "customer_messages", filename: "msg.csv", content, tail: "truncate", tailDelayMs: 350 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });

  it("R4 H06/H08：CS 消息 350ms 后取消（spool 已成功落定）→ 不留 tmp、无新任务", { timeout: 120_000 }, async () => {
    const content = `${MESSAGE_HEADER}\nR4-1,2026-09-11T01:00:00Z,R4M4,R4C4,2026-09-01T11:00:00Z,,延迟取消消息,,platform_chat,zh-CN`;
    const sha = createHash("sha256").update(content).digest("hex");
    const before = tmpFileCount();
    const res = await postTail(cs.cookie, { kind: "customer_messages", filename: "msg.csv", content, tail: "cancel", tailDelayMs: 350 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await new Promise((r) => setTimeout(r, 200));
    expect(tmpFileCount()).toBe(before);
    expect(await db.importTask.count({ where: { orgId, fileSha256: sha } })).toBe(0);
  });
});

describe("TASK-008｜字段映射、全量校验、预览与错误下载", () => {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const t8TmpCount = (): number => {
    try {
      return readdirSync(join(storageRoot(), "tmp")).length;
    } catch {
      return 0;
    }
  };

  async function putMapping(taskId: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
    const { PUT } = await import("@/app/api/v1/imports/[id]/mapping/route");
    return PUT(
      req(`/api/v1/imports/${taskId}/mapping`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
  }

  async function getPreview(taskId: string, cookie: string): Promise<Response> {
    const { GET } = await import("@/app/api/v1/imports/[id]/preview/route");
    return GET(req(`/api/v1/imports/${taskId}/preview`, {}, cookie), { params: Promise.resolve({ id: taskId }) });
  }

  async function getErrorFile(taskId: string, cookie: string, suffix = ""): Promise<Response> {
    const { GET } = await import("@/app/api/v1/imports/[id]/error-file/route");
    return GET(req(`/api/v1/imports/${taskId}/error-file${suffix}`, {}, cookie), { params: Promise.resolve({ id: taskId }) });
  }

  async function runValidate(taskId: string): Promise<void> {
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    await handleValidateTask({ taskId });
  }

  const PRODUCTS_R4 = (sku: string, name: string, ts: string): string =>
    `${FILE_HEADERS.products.join(",")}\nIMP-1,${ts},R8P,杯,杯具,active,${sku},${sku}-CODE,${name},,active`;

  it("PUT mapping：CAS 版本 409、时区不一致 422、C 角色 403；正常 202 后校验产生 preview_version=1", async () => {
    const task = await makeTask(operator.cookie, "products", PRODUCTS_R4("S8A", "杯A", "2026-09-11T01:00:00Z"));
    const wrongV = await putMapping(task.id, operator.cookie, {
      timezone: "Asia/Shanghai", coverage_declaration: [], expected_preview_version: 99,
    });
    expect(wrongV.status).toBe(409);
    expect(((await wrongV.json()) as { error: { code: string } }).error.code).toBe("VERSION_CONFLICT");

    const wrongTz = await putMapping(task.id, operator.cookie, {
      timezone: "UTC", coverage_declaration: [], expected_preview_version: 0,
    });
    expect(wrongTz.status).toBe(422);

    const forbidden = await putMapping(task.id, cs.cookie, {
      timezone: "Asia/Shanghai", coverage_declaration: [], expected_preview_version: 0,
    });
    expect(forbidden.status).toBe(403);

    const okRes = await putMapping(task.id, operator.cookie, {
      timezone: "Asia/Shanghai",
      coverage_declaration: [{ source_kind: "products", channel: "default", from: "2026-09-01", to: "2026-09-11", status: "complete", explicit_zero_dates: [] }],
      expected_preview_version: 0,
    });
    expect(okRes.status).toBe(202);
    expect(((await okRes.json()) as { data: { status: string } }).data.status).toBe("validating");

    await runValidate(task.id);
    const preview = await getPreview(task.id, operator.cookie);
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { data: { preview_version: number; counts: { insert: number }; coverage: { declaration: unknown[]; gaps: string[] } } };
    expect(body.data.preview_version).toBe(1);
    expect(body.data.counts.insert).toBe(1);
    expect(body.data.coverage.declaration).toHaveLength(1);
  });

  it("缺列（映射无法覆盖必填字段）→ failed+MISSING_COLUMN；错误文件可签名下载且无错误文件时 404", async () => {
    // 文件列名非标准：sku_name 列缺失（映射不到）
    const content = `${FILE_HEADERS.products.join(",").replace(",sku_name", "")}\nIMP-1,2026-09-11T01:00:00Z,R8Q,杯,杯具,active,S8Q,S8Q-CODE,,active`;
    const made = await makeTask(operator.cookie, "products", content);
    const res = await putMapping(made.id, operator.cookie, {
      timezone: "Asia/Shanghai",
      field_mapping: { sku_name: "不存在的列" },
      coverage_declaration: [],
      expected_preview_version: 0,
    });
    expect(res.status).toBe(202);
    await runValidate(made.id);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: made.id } });
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe("MISSING_COLUMN");

    const missing = await getErrorFile(made.id, operator.cookie);
    expect(missing.status).toBe(200);
    const url = ((await missing.json()) as { data: { url: string } }).data.url;
    const download = await getErrorFile(made.id, operator.cookie, url.replace(`/api/v1/imports/${made.id}/error-file`, ""));
    expect(download.status).toBe(200);
    const csv = await download.text();
    expect(csv).toContain("MISSING_COLUMN");
    expect(csv).toContain("sku_name");
  });

  it("仅表头文件：无声明 → empty_file；显式零事件 → coverage_only 预览且不推断完整", async () => {
    const headerOnly = `${FILE_HEADERS.products.join(",")}\n`;
    const made = await makeTask(operator.cookie, "products", headerOnly);
    await runValidate(made.id);
    let preview = await getPreview(made.id, operator.cookie);
    let body = (await preview.json()) as { data: { preview_version: number; counts: { insert: number }; coverage: { empty_file: boolean; coverage_only: boolean } } };
    expect(body.data.counts.insert).toBe(0);
    expect(body.data.coverage.empty_file).toBe(true);
    expect(body.data.coverage.coverage_only).toBe(false);

    // 同文件重映射并声明显式零事件 → coverage-only 预览
    const remap = await putMapping(made.id, operator.cookie, {
      timezone: "Asia/Shanghai",
      coverage_declaration: [{ source_kind: "products", channel: "default", from: "2026-09-01", to: "2026-09-03", status: "complete", explicit_zero_dates: ["2026-09-01", "2026-09-02"] }],
      expected_preview_version: 1,
    });
    expect(remap.status).toBe(202);
    await runValidate(made.id);
    preview = await getPreview(made.id, operator.cookie);
    body = (await preview.json()) as typeof body;
    expect(body.data.preview_version).toBe(2);
    expect(body.data.coverage.coverage_only).toBe(true);
    expect(body.data.counts.insert).toBe(0);
  });

  it("同自然键同 source_updated_at 不同内容 → DUPLICATE_KEY_CONFLICT 整文件失败，不最后一行胜出", async () => {
    const content = `${PRODUCTS_R4("S8B", "杯B", "2026-09-11T01:00:00Z")}\nIMP-1,2026-09-11T01:00:00Z,R8P,杯,杯具,active,S8B,S8B-CODE,杯B改名,,active`;
    const made = await makeTask(operator.cookie, "products", content);
    await runValidate(made.id);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: made.id } });
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe("DUPLICATE_KEY_CONFLICT");
    const preview = await getPreview(made.id, operator.cookie);
    expect(preview.status).toBe(409);
    expect(((await preview.json()) as { error: { code: string } }).error.code).toBe("PREVIEW_NOT_READY");
  });

  it("未知 SKU 与缺失订单引用 → SKU_NOT_FOUND/MISSING_ORDER_REFERENCE 行级错误（整文件失败）", async () => {
    const content = `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-11T01:00:00Z,R8-O1,L1,不存在的SKU,1,10.000000,CNY`;
    const made = await makeTask(operator.cookie, "order_items", content);
    const order = await db.order.create({
      data: {
        orgId, storeId,
        sourceNamespace: "ns-import", externalOrderId: "R8-O1",
        sourceUpdatedAt: new Date("2026-09-01T02:00:00Z"), importTaskId: made.id, rowHash: "seed-r8-order-hash",
        orderedAt: new Date("2026-09-01T01:55:00Z"), paidAt: new Date("2026-09-01T02:00:00Z"),
        paymentStatus: "paid", currency: "CNY", expectedItemCount: 1,
      },
    });
    await runValidate(made.id);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: made.id } });
    expect(task.status).toBe("failed");
    const preview = await getPreview(made.id, operator.cookie);
    expect(preview.status).toBe(409);
    const ef = await getErrorFile(made.id, operator.cookie);
    const csv = await (await getErrorFile(made.id, operator.cookie, ((await ef.json()) as { data: { url: string } }).data.url.replace(`/api/v1/imports/${made.id}/error-file`, ""))).text();
    expect(csv).toContain("SKU_NOT_FOUND");
    expect(await db.orderItem.count({ where: { orgId, orderId: order.id } })).toBe(0);
  });

  it("insert/update/unchanged 分类：较新更新、相同内容无变化、旧版本不覆盖", async () => {
    const storeRow = await db.store.findFirstOrThrow({ where: { orgId, id: storeId } });
    // 先建三个任务（uploaded），种子 Product/SKU 挂到真实任务外键后依次校验
    const same = await makeTask(operator.cookie, "products", PRODUCTS_R4("S8U", "原名", "2026-09-01T00:00:00Z"));
    const newer = await makeTask(operator.cookie, "products", PRODUCTS_R4("S8U", "新名", "2026-09-02T00:00:00Z"));
    const older = await makeTask(operator.cookie, "products", PRODUCTS_R4("S8U", "更旧名", "2026-08-30T00:00:00Z"));

    // 种子 rowHash 与"同内容"行的规范化哈希一致 → 走 unchanged(identical) 分支
    const { parseStandardFile } = await import("@/adapters/contracts");
    const { recordRowHash } = await import("@/services/importPreview");
    const sameParsed = parseStandardFile("products", PRODUCTS_R4("S8U", "原名", "2026-09-01T00:00:00Z"), { storeExternalId: "IMP-1" });
    const seedHash = recordRowHash(sameParsed.records[0]!);
    const productSeed = await db.product.create({
      data: {
        orgId, storeId: storeRow.id, sourceNamespace: "ns-import",
        externalProductId: "R8P", sourceUpdatedAt: new Date("2026-09-01T00:00:00Z"),
        importTaskId: same.id, rowHash: "seed-r8-product-hash",
        name: "杯", status: "active",
      },
    });
    // 既有 SKU（已提交态：rowHash 已写入，来源时间较旧）
    const existing = await db.sKU.create({
      data: {
        orgId, storeId: storeRow.id, sourceNamespace: "ns-import",
        externalSkuId: "S8U", skuCode: "S8U-CODE", name: "原名", specification: null,
        status: "active", productId: productSeed.id,
        importTaskId: same.id,
        sourceUpdatedAt: new Date("2026-09-01T00:00:00Z"),
        rowHash: seedHash,
      },
    });

    await runValidate(same.id);
    await runValidate(newer.id);
    await runValidate(older.id);

    const pSame = (await (await getPreview(same.id, operator.cookie)).json()) as { data: { counts: { unchanged: number } } };
    expect(pSame.data.counts.unchanged).toBe(1);
    const pNewer = (await (await getPreview(newer.id, operator.cookie)).json()) as { data: { counts: { update: number } } };
    expect(pNewer.data.counts.update).toBe(1);
    const pOlder = (await (await getPreview(older.id, operator.cookie)).json()) as { data: { counts: { unchanged: number; superseded_by_db: number } } };
    expect(pOlder.data.counts.unchanged).toBe(1);
    expect(pOlder.data.counts.superseded_by_db).toBe(1);
    // DB 未被预览修改：提交（TASK-009）前不变
    expect((await db.sKU.findUniqueOrThrow({ where: { id: existing.id } })).name).toBe("原名");
  });

  it("覆盖缺口：声明范围内缺失日期在预览列出（不从行数推断完整）", async () => {
    const content = `${FILE_HEADERS.orders.join(",")}\nIMP-1,2026-09-11T01:00:00Z,R8-O2,paid,2026-09-01T01:55:00Z,2026-09-01T02:00:00Z,CNY,1`;
    const made = await makeTask(operator.cookie, "orders", content);
    const res = await putMapping(made.id, operator.cookie, {
      timezone: "Asia/Shanghai",
      coverage_declaration: [{ source_kind: "orders", channel: "default", from: "2026-09-01", to: "2026-09-04", status: "complete", explicit_zero_dates: [] }],
      expected_preview_version: 0,
    });
    expect(res.status).toBe(202);
    await runValidate(made.id);
    const preview = await getPreview(made.id, operator.cookie);
    const body = (await preview.json()) as { data: { coverage: { gaps: string[] } } };
    expect(body.data.coverage.gaps).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("预览脱敏：customer_messages 预览样本不含原始手机号/邮箱", async () => {
    const content = `${FILE_HEADERS.customer_messages.join(",")}\nIMP-1,2026-09-11T01:00:00Z,R8M1,R8C1,2026-09-01T03:00:00Z,,联系电话13812345678邮箱a@b.com,,platform_chat,zh-CN`;
    const made = await makeTask(cs.cookie, "customer_messages", content);
    await runValidate(made.id);
    const preview = await getPreview(made.id, cs.cookie);
    expect(preview.status).toBe(200);
    const text = JSON.stringify(await preview.json());
    expect(text).not.toContain("13812345678");
    expect(text).not.toContain("a@b.com");
  });

  it("uploaded 未校验任务 → preview 409 PREVIEW_NOT_READY；t8 tmp 无残留", async () => {
    const made = await makeTask(operator.cookie, "products", PRODUCTS_R4("S8Z", "杯Z", "2026-09-11T01:00:00Z"));
    const preview = await getPreview(made.id, operator.cookie);
    expect(preview.status).toBe(409);
    await runValidate(made.id);
    expect(t8TmpCount()).toBe(0);
  });
});

describe("TASK-009｜原子提交内核、商品主数据与 SKU 别名", () => {
  const PRODUCTS_R9 = (sku: string, name: string, ts: string): string =>
    `${FILE_HEADERS.products.join(",")}\nIMP-1,${ts},R8P,杯,杯具,active,${sku},${sku}-CODE,${name},,active`;
  async function runValidate(taskId: string): Promise<void> {
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    await handleValidateTask({ taskId });
  }
  async function getPreview(taskId: string, cookie: string): Promise<Response> {
    const { GET } = await import("@/app/api/v1/imports/[id]/preview/route");
    return GET(req(`/api/v1/imports/${taskId}/preview`, {}, cookie), { params: Promise.resolve({ id: taskId }) });
  }
  async function putMapping(taskId: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
    const { PUT } = await import("@/app/api/v1/imports/[id]/mapping/route");
    return PUT(
      req(`/api/v1/imports/${taskId}/mapping`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
  }
  async function commitTask(taskId: string, cookie: string, previewVersion: number): Promise<Response> {
    const { POST } = await import("@/app/api/v1/imports/[id]/commit/route");
    return POST(
      req(`/api/v1/imports/${taskId}/commit`, {
        method: "POST",
        body: JSON.stringify({ preview_version: previewVersion, confirmation: true }),
        headers: { "content-type": "application/json" },
      }, cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
  }

  async function validatedProductsTask(cookie: string, content: string): Promise<{ id: string; previewVersion: number }> {
    const made = await makeTask(cookie, "products", content);
    await runValidate(made.id);
    const t = await db.importTask.findUniqueOrThrow({ where: { id: made.id }, select: { status: true, previewVersion: true } });
    expect(t.status).toBe("preview_ready");
    return { id: made.id, previewVersion: t.previewVersion };
  }

  it("预览过期/缺确认/C 角色 → 409/422/403；正常提交 → 202、落库、版本+1、覆盖与审计在", async () => {
    const made = await validatedProductsTask(operator.cookie, PRODUCTS_R9("R9A", "杯R9A", "2026-09-11T01:00:00Z"));
    // 重映射并声明显式覆盖（products 目录确认），触发第二次校验 preview_version=2
    const decl = await putMapping(made.id, operator.cookie, {
      timezone: "Asia/Shanghai",
      coverage_declaration: [{ source_kind: "products", channel: "default", from: "2026-09-01", to: "2026-09-11", status: "complete", explicit_zero_dates: [] }],
      expected_preview_version: made.previewVersion,
    });
    expect(decl.status).toBe(202);
    await runValidate(made.id);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: made.id }, select: { status: true, previewVersion: true } });
    expect(task.status).toBe("preview_ready");

    const before = Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion);
    const expired = await commitTask(made.id, operator.cookie, 99);
    expect(expired.status).toBe(409);
    expect(((await expired.json()) as { error: { code: string } }).error.code).toBe("VERSION_CONFLICT");

    const { POST: commitPost } = await import("@/app/api/v1/imports/[id]/commit/route");
    const noConfirm = await commitPost(
      req(`/api/v1/imports/${made.id}/commit`, { method: "POST", body: JSON.stringify({ preview_version: task.previewVersion }), headers: { "content-type": "application/json" } }, operator.cookie),
      { params: Promise.resolve({ id: made.id }) },
    );
    expect(noConfirm.status).toBe(422);
    const csForbidden = await commitTask(made.id, cs.cookie, task.previewVersion);
    expect(csForbidden.status).toBe(403);

    const okRes = await commitTask(made.id, operator.cookie, task.previewVersion);
    expect(okRes.status).toBe(202);
    const body = (await okRes.json()) as { data: { committed_dataset_version: string; insert: number } };
    expect(body.data.insert).toBe(1);
    expect(Number(body.data.committed_dataset_version)).toBe(before + 1);

    const sku = await db.sKU.findFirstOrThrow({ where: { orgId, externalSkuId: "R9A" } });
    expect(sku.rowHash).not.toBe("");
    expect(sku.importTaskId).toBe(made.id);
    expect(await db.product.count({ where: { orgId, externalProductId: "R8P" } })).toBe(1);
    // products 覆盖记录目录确认日（本测试已通过 PUT mapping 声明 complete 覆盖）
    expect(await db.dataCoverage.count({ where: { orgId, importTaskId: made.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId, action: "import_commit", entityId: made.id } })).toBe(1);
  });

  it("重复提交同任务 → 200 复用，dataset_version 不变、行数不变", async () => {
    const made0 = await validatedProductsTask(operator.cookie, PRODUCTS_R9("R9B", "杯R9B", "2026-09-11T01:00:00Z"));
    const first = await commitTask(made0.id, operator.cookie, made0.previewVersion);
    expect(first.status).toBe(202);
    const before = Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion);
    const replay = await commitTask(made0.id, operator.cookie, made0.previewVersion);
    expect(replay.status).toBe(200);
    const body = (await replay.json()) as { data: { reused: boolean; committed_dataset_version: string } };
    expect(body.data.reused).toBe(true);
    expect(Number(body.data.committed_dataset_version)).toBe(before);
    expect(await db.sKU.count({ where: { orgId, externalSkuId: "R9B" } })).toBe(1);
  });

  it("提交失败（注入约束）→ 整文件回滚：任务回 preview_ready、版本与行数不变", async () => {
    const made0 = await validatedProductsTask(operator.cookie, PRODUCTS_R9("R9C", "杯R9C", "2026-09-11T01:00:00Z"));
    const beforeVersion = Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion);
    await db.$executeRaw`ALTER TABLE sku ADD CONSTRAINT ck_t9_inject CHECK (false) NOT VALID`;
    let status = 0;
    try {
      status = (await commitTask(made0.id, operator.cookie, made0.previewVersion)).status;
    } finally {
      await db.$executeRaw`ALTER TABLE sku DROP CONSTRAINT ck_t9_inject`;
    }
    expect([400, 500, 503]).toContain(status);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: made0.id } });
    expect(task.status).toBe("preview_ready");
    expect(Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion)).toBe(beforeVersion);
    expect(await db.sKU.count({ where: { orgId, externalSkuId: "R9C" } })).toBe(0);
    expect(await db.product.count({ where: { orgId, externalProductId: "R8P", importTaskId: made0.id } })).toBe(0);
  });

  it("并发同任务提交 → 恰一次生效，版本只 +1、行数不翻倍；确认后更名重传 → update 且身份不变", async () => {
    const made0 = await validatedProductsTask(operator.cookie, PRODUCTS_R9("R9D", "杯R9D", "2026-09-11T01:00:00Z"));
    const before = Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion);
    const results = await Promise.all([
      commitTask(made0.id, operator.cookie, made0.previewVersion),
      commitTask(made0.id, operator.cookie, made0.previewVersion),
      commitTask(made0.id, operator.cookie, made0.previewVersion),
    ]);
    const codes = results.filter((r): r is Response => r !== null).map((r) => r.status);
    expect(codes.filter((c) => c === 202)).toHaveLength(1);
    expect(Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion)).toBe(before + 1);
    expect(await db.sKU.count({ where: { orgId, externalSkuId: "R9D" } })).toBe(1);

    // 确认后更名重传：同自然键较新来源时间 → update；SKU 身份不变、名称更新
    const updated = await validatedProductsTask(operator.cookie, PRODUCTS_R9("R9D", "杯R9D-新名", "2026-09-12T01:00:00Z"));
    const pNewer = (await (await getPreview(updated.id, operator.cookie)).json()) as { data: { counts: { update: number } } };
    expect(pNewer.data.counts.update).toBe(1);
    const commit2 = await commitTask(updated.id, operator.cookie, updated.previewVersion);
    expect([202, 200]).toContain(commit2.status);
    const sku = await db.sKU.findFirstOrThrow({ where: { orgId, externalSkuId: "R9D" } });
    expect(sku.name).toBe("杯R9D-新名");
    expect(sku.skuCode).toBe("R9D-CODE");
  });

  it("sku-aliases：正常 201；重复 409；跨店 canonical 404", async () => {
    const made0 = await validatedProductsTask(operator.cookie, PRODUCTS_R9("R9E", "杯R9E", "2026-09-11T01:00:00Z"));
    await commitTask(made0.id, operator.cookie, made0.previewVersion);
    const sku = await db.sKU.findFirstOrThrow({ where: { orgId, externalSkuId: "R9E" } });

    const { POST } = await import("@/app/api/v1/sku-aliases/route");
    const call = (body: Record<string, unknown>, cookie = operator.cookie) =>
      POST(req("/api/v1/sku-aliases", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, cookie));

    const okRes = await call({ store_id: storeId, source_namespace: "ns-import", external_sku_id: "ALIAS-R9E", canonical_sku_id: sku.id });
    expect(okRes.status).toBe(201);
    const dup = await call({ store_id: storeId, source_namespace: "ns-import", external_sku_id: "ALIAS-R9E", canonical_sku_id: sku.id });
    expect(dup.status).toBe(409);
    const crossStore = await call({ store_id: mockStoreId, source_namespace: "ns-import", external_sku_id: "ALIAS-R9E-X", canonical_sku_id: sku.id });
    expect(crossStore.status).toBe(404);
    const realSku = await call({ store_id: storeId, source_namespace: "ns-import", external_sku_id: "R9E", canonical_sku_id: sku.id });
    expect(realSku.status).toBe(409);
  });
});

describe("TASK-010｜订单头与订单行导入", () => {
  const PRODUCTS_R9 = (sku: string, name: string, ts: string): string =>
    `${FILE_HEADERS.products.join(",")}\nIMP-1,${ts},R8P,杯,杯具,active,${sku},${sku}-CODE,${name},,active`;
  async function putMapping(taskId: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
    const { PUT } = await import("@/app/api/v1/imports/[id]/mapping/route");
    return PUT(
      req(`/api/v1/imports/${taskId}/mapping`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
  }
  async function runValidate(taskId: string): Promise<void> {
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    await handleValidateTask({ taskId });
  }
  async function getPreview(taskId: string, cookie: string): Promise<Response> {
    const { GET } = await import("@/app/api/v1/imports/[id]/preview/route");
    return GET(req(`/api/v1/imports/${taskId}/preview`, {}, cookie), { params: Promise.resolve({ id: taskId }) });
  }
  async function commitTask(taskId: string, cookie: string, previewVersion: number): Promise<Response> {
    const { POST } = await import("@/app/api/v1/imports/[id]/commit/route");
    return POST(
      req(`/api/v1/imports/${taskId}/commit`, {
        method: "POST",
        body: JSON.stringify({ preview_version: previewVersion, confirmation: true }),
        headers: { "content-type": "application/json" },
      }, cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
  }
  const ORDERS_T10 = (orderId: string, paid: string, count: number): string =>
    `${FILE_HEADERS.orders.join(",")}\nIMP-1,${paid}T02:05:00Z,${orderId},paid,${paid}T01:55:00Z,${paid}T02:00:00Z,CNY,${count}`;
  const ITEMS_T10 = (orderId: string, itemId: string, qty: number, amount: string): string =>
    `${FILE_HEADERS.order_items.join(",")}\nIMP-1,${paid0}T02:05:00Z,${orderId},${itemId},S10,${qty},${amount},CNY`;
  const paid0 = "2026-09-01";

  async function commitChain(products: string, orders: string, items: string): Promise<void> {
    for (const [kind, content] of [["products", products], ["orders", orders], ["order_items", items]] as const) {
      const made = await makeTask(operator.cookie, kind, content);
      await runValidate(made.id);
      const t = await db.importTask.findUniqueOrThrow({ where: { id: made.id }, select: { status: true, previewVersion: true, errorCode: true } });
      expect(t.status).toBe("preview_ready");
      if (kind === "order_items") {
        const decl = await putMapping(made.id, operator.cookie, {
          timezone: "Asia/Shanghai",
          coverage_declaration: [{ source_kind: "order_items", channel: "default", from: paid0, to: "2026-09-11", status: "complete", explicit_zero_dates: [] }],
          expected_preview_version: t.previewVersion,
        });
        expect(decl.status).toBe(202);
        await runValidate(made.id);
        const t2 = await db.importTask.findUniqueOrThrow({ where: { id: made.id }, select: { previewVersion: true } });
        const res2 = await commitTask(made.id, operator.cookie, t2.previewVersion);
        expect([202, 200]).toContain(res2.status);
        continue;
      }
      const res = await commitTask(made.id, operator.cookie, t.previewVersion);
      expect([202, 200]).toContain(res.status);
    }
  }

  it("多行订单只建一单；两行落库；更正订单行替换金额且身份不变", async () => {
    await commitChain(
      PRODUCTS_R9("S10", "杯S10", "2026-09-01T00:00:00Z"),
      ORDERS_T10("T10-O1", paid0, 2),
      `${FILE_HEADERS.order_items.join(",")}\nIMP-1,${paid0}T02:05:00Z,T10-O1,L1,S10,1,50.000000,CNY\nIMP-1,${paid0}T02:05:00Z,T10-O1,L2,S10,1,60.000000,CNY`,
    );
    const order = await db.order.findFirstOrThrow({ where: { orgId, externalOrderId: "T10-O1" } });
    expect(await db.orderItem.count({ where: { orgId, orderId: order.id } })).toBe(2);
    expect(await db.order.count({ where: { orgId, externalOrderId: "T10-O1" } })).toBe(1);

    // 更正行金额（更晚 source_updated_at）：替换不重复
    const fixed = await makeTask(operator.cookie, "order_items",
      `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-02T02:05:00Z,T10-O1,L1,S10,1,55.000000,CNY`);
    await runValidate(fixed.id);
    const p = (await (await getPreview(fixed.id, operator.cookie)).json()) as { data: { counts: { update: number } } };
    expect(p.data.counts.update).toBe(1);
    const res = await commitTask(fixed.id, operator.cookie, 1);
    expect([202, 200]).toContain(res.status);
    const item = await db.orderItem.findFirstOrThrow({ where: { orgId, orderId: order.id, externalOrderItemId: "L1" } });
    expect(Number(item.itemPaidAmount)).toBe(55);
  });

  it("行遗漏：expected=2 只到 1 行 → 允许提交但该日期覆盖强制 partial；补齐后恢复声明状态", async () => {
    await commitChain(
      PRODUCTS_R9("S10P", "杯S10P", "2026-09-01T00:00:00Z"),
      ORDERS_T10("T10-O2", paid0, 2),
      `${FILE_HEADERS.order_items.join(",")}\nIMP-1,${paid0}T02:05:00Z,T10-O2,L1,S10P,1,40.000000,CNY`,
    );
    const order = await db.order.findFirstOrThrow({ where: { orgId, externalOrderId: "T10-O2" } });
    expect(await db.orderItem.count({ where: { orgId, orderId: order.id } })).toBe(1);
    // 订单行覆盖（声明 complete）当日被强制 partial
    const cover = await db.dataCoverage.findFirstOrThrow({
      where: { orgId, sourceKind: "order_items", coverageDate: new Date(`${paid0}T00:00:00Z`) },
      orderBy: { datasetVersion: "desc" },
    });
    expect(cover.status).toBe("partial");

    // 补齐第二行 → 新版本覆盖恢复声明 complete
    const fill = await makeTask(operator.cookie, "order_items",
      `${FILE_HEADERS.order_items.join(",")}\nIMP-1,${paid0}T02:05:00Z,T10-O2,L2,S10P,1,30.000000,CNY`);
    // 用户补齐后重新声明覆盖（覆盖始终来自用户声明，不由行数推断）
    const fillDecl = await putMapping(fill.id, operator.cookie, {
      timezone: "Asia/Shanghai",
      coverage_declaration: [{ source_kind: "order_items", channel: "default", from: paid0, to: "2026-09-11", status: "complete", explicit_zero_dates: [] }],
      expected_preview_version: 0,
    });
    expect(fillDecl.status).toBe(202);
    await runValidate(fill.id);
    const fillTask = await db.importTask.findUniqueOrThrow({ where: { id: fill.id }, select: { previewVersion: true } });
    const res = await commitTask(fill.id, operator.cookie, fillTask.previewVersion);
    console.log("FILL_RES", res.status, JSON.stringify((await res.json()).data ?? {}));
    expect([202, 200]).toContain(res.status);
    const cover2 = await db.dataCoverage.findFirstOrThrow({
      where: { orgId, sourceKind: "order_items", coverageDate: new Date(`${paid0}T00:00:00Z`) },
      orderBy: { datasetVersion: "desc" },
    });
    expect(cover2.status).toBe("complete");
  });

  it("订单行引用跨店/不存在订单 → 409 整文件回滚，无行落库", async () => {
    const before = Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion);
    const made = await makeTask(operator.cookie, "order_items",
      `${FILE_HEADERS.order_items.join(",")}\nIMP-1,${paid0}T02:05:00Z,不存在订单,L9,S10,1,10.000000,CNY`);
    await runValidate(made.id);
    const task = await db.importTask.findUniqueOrThrow({ where: { id: made.id } });
    expect(task.status).toBe("failed");
    expect(task.errorCode).toBe("MISSING_ORDER_REFERENCE");
    expect(Number((await db.store.findUniqueOrThrow({ where: { id: storeId } })).datasetVersion)).toBe(before);
  });

  it("多行同订单不同 SKU 齐全 → 订单数 1（GMV 口径属 TASK-014）", async () => {
    await commitChain(
      `${PRODUCTS_R9("S10X", "杯X", "2026-09-01T00:00:00Z")}\n${PRODUCTS_R9("S10Y", "杯X", "2026-09-01T00:00:00Z").split("\n").slice(1).join("\n")}`,
      ORDERS_T10("T10-O3", paid0, 2),
      `${FILE_HEADERS.order_items.join(",")}\nIMP-1,${paid0}T02:05:00Z,T10-O3,L1,S10X,1,10.000000,CNY\nIMP-1,${paid0}T02:05:00Z,T10-O3,L2,S10Y,1,20.000000,CNY`,
    );
    const order = await db.order.findFirstOrThrow({ where: { orgId, externalOrderId: "T10-O3" } });
    expect(await db.orderItem.count({ where: { orgId, orderId: order.id } })).toBe(2);
    expect(await db.order.count({ where: { orgId, externalOrderId: "T10-O3" } })).toBe(1);
  });
});

describe("TASK-011/012｜广告与客服/售后/退款提交", () => {
  const PRODUCTS_R9b = (sku: string, name: string): string =>
    `${FILE_HEADERS.products.join(",")}\nIMP-1,2026-09-01T00:00:00Z,R8P,杯,杯具,active,${sku},${sku}-CODE,${name},,active`;
  async function runValidate(taskId: string): Promise<void> {
    const { handleValidateTask } = await import("@/jobs/handlers/imports");
    await handleValidateTask({ taskId });
  }
  async function getPreview(taskId: string, cookie: string): Promise<Response> {
    const { GET } = await import("@/app/api/v1/imports/[id]/preview/route");
    return GET(req(`/api/v1/imports/${taskId}/preview`, {}, cookie), { params: Promise.resolve({ id: taskId }) });
  }
  async function commitTask(taskId: string, cookie: string, previewVersion: number): Promise<Response> {
    const { POST } = await import("@/app/api/v1/imports/[id]/commit/route");
    return POST(
      req(`/api/v1/imports/${taskId}/commit`, {
        method: "POST",
        body: JSON.stringify({ preview_version: previewVersion, confirmation: true }),
        headers: { "content-type": "application/json" },
      }, cookie),
      { params: Promise.resolve({ id: taskId }) },
    );
  }
  const MSG_T11 = (mid: string, sku: string | null, text: string): string =>
    `${FILE_HEADERS.customer_messages.join(",")}\nIMP-1,2026-09-11T01:00:00Z,${mid},C11,2026-09-01T03:00:00Z,${sku ?? ""},${text},true,platform_chat,zh-CN`;

  async function chain11_12(steps: Array<[string, string]>): Promise<void> {
    for (const [kind, content] of steps) {
      const made = await makeTask(operator.cookie, kind, content);
      await runValidate(made.id);
      const t = await db.importTask.findUniqueOrThrow({ where: { id: made.id }, select: { status: true, previewVersion: true } });
      expect(t.status).toBe("preview_ready");
      const res = await commitTask(made.id, operator.cookie, t.previewVersion);
      expect([202, 200]).toContain(res.status);
    }
  }

  it("广告日提交：幂等落库、晚到归因替换不累加", async () => {
    await chain11_12([
      ["products", PRODUCTS_R9b("S11", "杯S11")],
      ["ads", `${FILE_HEADERS.ads.join(",")}\nIMP-1,2026-09-01T04:00:00Z,AD11,广告11,2026-09-01,last_click,7,40.000000,100.000000,CNY`],
    ]);
    expect(await db.adMetric.count({ where: { orgId, campaignId: "AD11" } })).toBe(1);
    const ad = await db.adMetric.findFirstOrThrow({ where: { orgId, campaignId: "AD11" } });
    expect(Number(ad.spend)).toBe(40);

    // 晚到归因更新：替换 spend/attributed_sales，不新增行
    const later = await makeTask(operator.cookie, "ads",
      `${FILE_HEADERS.ads.join(",")}\nIMP-1,2026-09-02T04:00:00Z,AD11,广告11,2026-09-01,last_click,7,45.000000,110.000000,CNY`);
    await runValidate(later.id);
    const p = (await (await getPreview(later.id, operator.cookie)).json()) as { data: { counts: { update: number } } };
    expect(p.data.counts.update).toBe(1);
    await commitTask(later.id, operator.cookie, 1);
    const ads = await db.adMetric.findMany({ where: { orgId, campaignId: "AD11" } });
    expect(ads).toHaveLength(1);
    expect(Number(ads[0]!.spend)).toBe(45);
  });

  it("客服消息提交：脱敏落库、SKU 关联", async () => {
    await chain11_12([
      ["products", PRODUCTS_R9b("S12", "杯S12")],
      ["customer_messages", MSG_T11("M12", "S12", "电话13812345678想退款")],
    ]);
    const msg = await db.customerMessage.findFirstOrThrow({ where: { orgId, externalMessageId: "M12" } });
    expect(msg.redactedText).not.toContain("13812345678");
    expect(msg.skuId).not.toBeNull();
  });

  it("售后 case+refund 原子提交：金额/累计件数越界在预览拒绝；正常两行落库", async () => {
    await chain11_12([
      ["products", PRODUCTS_R9b("S12R", "杯S12R")],
      ["orders", `${FILE_HEADERS.orders.join(",")}\nIMP-1,2026-09-01T02:05:00Z,O-R12,paid,2026-09-01T01:55:00Z,2026-09-01T02:00:00Z,CNY,1`],
      ["order_items", `${FILE_HEADERS.order_items.join(",")}\nIMP-1,2026-09-01T02:05:00Z,O-R12,L1,S12R,2,100.000000,CNY`],
    ]);
    // 越界：refund 金额 200 > 实付 100 → 整文件失败
    const bad = await makeTask(operator.cookie, "after_sales",
      `${FILE_HEADERS.after_sales.join(",")}\nIMP-1,2026-09-02T03:00:00Z,refund,R12-BAD,O-R12,L1,,2026-09-02T03:00:00Z,succeeded,2026-09-02T03:00:00Z,200.000000,1,CNY,quality,`);
    await runValidate(bad.id);
    const badTask = await db.importTask.findUniqueOrThrow({ where: { id: bad.id } });
    expect(badTask.status).toBe("failed");
    expect(badTask.errorCode).toBe("REFUND_AMOUNT_EXCEEDS_PAID");

    // 正常：case + refund（合计 100 = 实付）
    await chain11_12([
      ["after_sales", `${FILE_HEADERS.after_sales.join(",")}\nIMP-1,2026-09-02T03:00:00Z,case,AS-R12,O-R12,L1,,2026-09-02T01:00:00Z,closed,,,,,quality,杯盖坏了\nIMP-1,2026-09-02T03:00:00Z,refund,RF-R12,O-R12,L1,AS-R12,2026-09-02T03:00:00Z,succeeded,2026-09-02T03:00:00Z,100.000000,2,CNY,quality,`],
    ]);
    const order = await db.order.findFirstOrThrow({ where: { orgId, externalOrderId: "O-R12" } });
    expect(await db.afterSaleRecord.count({ where: { orgId, orderId: order.id } })).toBe(1);
    const refunds = await db.refundEvent.findMany({ where: { orgId, orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0]!.refundAmount)).toBe(100);
    expect(refunds[0]!.afterSaleRecordId).not.toBeNull();
  });
});
