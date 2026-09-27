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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

// Independent Gate 03 contract probes. App implementation remains frozen.
const ts = "2026-09-11T01:00:00Z";
const csv = (kind: keyof typeof FILE_HEADERS, rows: string[]) => `${FILE_HEADERS[kind].join(",")}\n${rows.join("\n").replaceAll("IMP-1,", `${externalId},`)}`;
const pRow = (id: string, stamp = ts, name = "杯") => `IMP-1,${stamp},P-${id},${name},杯具,active,S-${id},CODE-${id},杯,,active`;
const oRow = (id: string, count=1) => `IMP-1,${ts},O-${id},paid,2026-09-01T01:55:00Z,2026-09-01T02:00:00Z,CNY,${count}`;
const iRow = (id: string, line="L1", amount="100.000000", quantity=2, stamp=ts, sku=`S-${id}`) => `IMP-1,${stamp},O-${id},${line},${sku},${quantity},${amount},CNY`;
const rRow = (id: string, event: string, amount="60.000000", qty=1, day="03") => `IMP-1,${ts},refund,${event},O-${id},L1,,2026-09-${day}T03:00:00Z,succeeded,2026-09-${day}T04:00:00Z,${amount},${qty},CNY,quality,漏水`;
const mRow = (id:string, text:string, stamp=ts) => `IMP-1,${stamp},M-${id},C-${id},2026-09-01T03:00:00Z,,${text},,platform_chat,zh-CN`;
function log(id:string, result:unknown) { console.log("G3_EVIDENCE",JSON.stringify({id,result},(_k,v)=>typeof v==="bigint"?v.toString():v)); }
async function prepare(kind:keyof typeof FILE_HEADERS, rows:string[], coverage?:unknown[], cookie=owner.cookie, source=dataSourceId) {
  const response=await upload(cookie,{kind,content:csv(kind,rows),dataSourceId:source});
  expect([200,201]).toContain(response.status);
  const id=(await response.json()).data.id as string;
  if (coverage) {
    const {PUT}=await import("@/app/api/v1/imports/[id]/mapping/route");
    const res=await PUT(req(`/api/v1/imports/${id}/mapping`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({timezone:storeTimezone,coverage_declaration:coverage,expected_preview_version:0})},cookie),{params:Promise.resolve({id})});
    expect(res.status).toBe(202);
  }
  await (await import("@/jobs/handlers/imports")).handleValidateTask({taskId:id});
  return db.importTask.findUniqueOrThrow({where:{id}});
}
async function commit(t:{id:string;previewVersion:number},cookie=owner.cookie) {
  const {POST}=await import("@/app/api/v1/imports/[id]/commit/route");
  const res=await POST(req(`/api/v1/imports/${t.id}/commit`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preview_version:t.previewVersion,confirmation:true})},cookie),{params:Promise.resolve({id:t.id})});
  return {status:res.status,body:await res.json()};
}
async function good(kind:keyof typeof FILE_HEADERS,rows:string[]) {const t=await prepare(kind,rows);expect(t.status).toBe("preview_ready");const c=await commit(t);expect(c.status).toBe(202);return t;}
async function chain(id:string,count=1) {await good("products",[pRow(id)]);await good("orders",[oRow(id,count)]);await good("order_items",[iRow(id)]);}
const coverage=(kind:string,from="2026-09-01",to="2026-09-02",channel="default",zero:string[]=[])=>[{source_kind:kind,channel,from,to,status:"complete",explicit_zero_dates:zero}];

// R2 supplemental probes: every test gets a fresh store and namespace scope.
let externalId = "IMP-1";
let storeTimezone = "Asia/Shanghai";
beforeEach(async () => {
  storeTimezone = "Asia/Shanghai";
  externalId = `R2-${randomUUID().slice(0,8)}`;
  storeId = (await db.store.create({data:{orgId,name:externalId,externalStoreId:externalId,platform:"manual",currency:"CNY",timezone:"Asia/Shanghai"}})).id;
  dataSourceId = (await db.dataSource.create({data:{orgId,storeId,sourceNamespace:"ns-import",name:externalId,adapterKind:"csv"}})).id;
});
async function facts() {
  const where={orgId,storeId};
  return {
    version:(await db.store.findUniqueOrThrow({where:{id:storeId}})).datasetVersion.toString(),
    products:await db.product.count({where}),skus:await db.sKU.count({where}),orders:await db.order.count({where}),items:await db.orderItem.count({where}),
    refunds:await db.refundEvent.count({where}),cases:await db.afterSaleRecord.count({where}),messages:await db.customerMessage.count({where}),
    coverage:await db.dataCoverage.count({where}),pending:await db.importTask.count({where:{...where,outboxStatus:"pending"}}),
  };
}
async function preview(t:{id:string}, cookie=owner.cookie) {
  const {GET}=await import("@/app/api/v1/imports/[id]/preview/route");
  const res=await GET(req(`/api/v1/imports/${t.id}/preview`,{},cookie),{params:Promise.resolve({id:t.id})});
  return {status:res.status,body:await res.json()};
}
async function latestCoverage(kind:string) {
  return db.dataCoverage.findFirst({where:{orgId,storeId,sourceKind:kind as "order_items",coverageDate:new Date("2026-09-01T00:00:00Z")},orderBy:{datasetVersion:"desc"}});
}


describe("R3 remaining closure checks",()=>{
  for (const [label,payload] of [["truncated","{"],["null","null"]]) {
    it(`R3-H03 malformed staging ${label} returns controlled 409 without writes`,async()=>{
      const t=await prepare("products",[pRow(`corrupt-${label}`)]);const before=await facts();
      const {putObject}=await import("@/storage");const {Readable}=await import("node:stream");
      await putObject(t.stagingObjectKey!,Readable.from([payload]));
      const c=await commit(t);const after=await facts();log(`R3-H03-${label}`,{commit:c,before,after});
      expect(after).toEqual(before);expect(c.status).toBe(409);
    });
  }
  it("R3-H03 structurally intact expired manifest reaches stale guard",async()=>{
    const t=await prepare("products",[pRow("expired-valid")]);const before=await facts();
    const {getObjectText,putObject}=await import("@/storage");const {Readable}=await import("node:stream");
    const full=JSON.parse(await getObjectText(t.stagingObjectKey!));const {checksum,...body}=full;
    body.generated_at=new Date(Date.now()-25*3600e3).toISOString();
    await putObject(t.stagingObjectKey!,Readable.from([JSON.stringify({...body,checksum:createHash("sha256").update(JSON.stringify(body)).digest("hex")})]));
    const c=await commit(t);log("R3-H03-stale",{commit:c,before,after:await facts()});expect(c.status).toBe(409);expect(JSON.stringify(c.body)).toContain("IMPORT_PREVIEW_STALE");expect(await facts()).toEqual(before);
  });
  it("R3-H04 parent expected count correction invalidates prior complete item coverage",async()=>{
    await good("products",[pRow("parent")]);await good("orders",[oRow("parent",1)]);
    const first=await prepare("order_items",[iRow("parent")],coverage("order_items"));expect((await commit(first)).status).toBe(202);
    const before=await latestCoverage("order_items");expect(before?.status).toBe("complete");
    const update=await prepare("orders",[oRow("parent",2).replace(ts,"2026-09-12T01:00:00Z")],coverage("orders"));
    const c=await commit(update);const after=await latestCoverage("order_items");const order=await db.order.findFirstOrThrow({where:{storeId,externalOrderId:"O-parent"}});
    const present=await db.orderItem.count({where:{storeId,orderId:order.id}});
    log("R3-H04-parent",{commit:c,before,after,expected:order.expectedItemCount,present,facts:await facts()});
    expect(c.status).toBe(202);expect(order.expectedItemCount).toBe(2);expect(present).toBe(1);expect(after?.status).toBe("partial");
  });
});
