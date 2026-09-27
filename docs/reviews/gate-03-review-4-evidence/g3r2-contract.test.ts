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

describe("R2 original closure boundaries",()=>{
  it("R2-H01 invalid mixed file is atomic across facts coverage version and outbox",async()=>{
    const before=await facts();const t=await prepare("products",[pRow("valid"),pRow("bad","not-a-time")]);const c=await commit(t);const after=await facts();log("R2-H01",{taskStatus:t.status,commit:c,before,after});
    expect(t.status).toBe("failed");expect(c.status).toBe(409);expect(after).toEqual(before);
  });
  it("R2-H02 Decimal legal partial refunds and replacement retain exact totals",async()=>{
    await good("products",[pRow("decimal")]);await good("orders",[oRow("decimal")]);await good("order_items",[iRow("decimal","L1","0.300000",2)]);
    await good("after_sales",[rRow("decimal","R1","0.100000",1,"03"),rRow("decimal","R2","0.200000",1,"04")]);
    const before=await facts();const bad=await prepare("after_sales",[rRow("decimal","R3","0.000001",1,"05")]);expect(bad.status).toBe("failed");expect(await facts()).toEqual(before);
    await good("after_sales",[rRow("decimal","R1","0.050000",1,"03").replace(ts,"2026-09-12T01:00:00Z")]);
    const rows=await db.refundEvent.findMany({where:{storeId},orderBy:{externalRecordId:"asc"}});log("R2-H02-decimal",rows.map(r=>({id:r.externalRecordId,amount:r.refundAmount?.toString(),qty:r.refundedQuantityCumulative})));expect(rows.map(r=>r.refundAmount?.toString())).toEqual(["0.05","0.2"]);
  });
  it("R2-H02 cumulative quantity chronology and same-time consistency reject atomically",async()=>{
    await chain("qty");await good("after_sales",[rRow("qty","R1","20",2,"03")]);const before=await facts();
    for(const day of ["03","04"]){const t=await prepare("after_sales",[rRow("qty",`R-${day}`,"20",1,day)]);expect(t.status).toBe("failed");expect(await facts()).toEqual(before);}
  });
  it("R2-H02 stale refund must use retained newer fact in final ledger",async()=>{
    await chain("stale");await good("after_sales",[rRow("stale","R1","20",1,"03").replace(ts,"2026-09-12T01:00:00Z"),rRow("stale","R2","60",1,"04")]);
    const before=await facts();const t=await prepare("after_sales",[rRow("stale","R1","60",1,"03")]);const c=await commit(t);const after=await facts();log("R2-H02-stale",{taskStatus:t.status,error:t.errorCode,commit:c,before,after});
    expect(t.status).toBe("preview_ready");expect(c.status).toBe(202);expect(after).toEqual(before);
  });
  it("R2-H02 concurrent reference change rejects old refund preview without writes",async()=>{
    await chain("race");const pending=await prepare("after_sales",[rRow("race","R2","60")]);await good("after_sales",[rRow("race","R1","60")]);const before=await facts();const c=await commit(pending);const after=await facts();log("R2-H02-race",{commit:c,before,after});expect(c.status).toBe(409);expect(after).toEqual(before);
  });
  it("R2-H03 wrong task staging identity cannot commit another preview",async()=>{
    const a=await prepare("products",[pRow("confirmed")]);const b=await prepare("products",[pRow("unconfirmed")]);
    const {getObjectText,putObject}=await import("@/storage");const {Readable}=await import("node:stream");
    await putObject(a.stagingObjectKey!,Readable.from([await getObjectText(b.stagingObjectKey!)]));
    const before=await facts();const c=await commit(a);const after=await facts();const saved=await db.sKU.findMany({where:{storeId},select:{externalSkuId:true}});log("R2-H03-identity",{commit:c,before,after,saved});expect(c.status).toBe(409);expect(after).toEqual(before);
  });
  it("R2-H03 same-time different content after preview must reject",async()=>{
    const old=await prepare("customer_messages",[mRow("conflict","old issue")]);await good("customer_messages",[mRow("conflict","new issue")]);const before=await facts();const c=await commit(old);log("R2-H03-conflict",c);expect(c.status).toBe(409);expect(await facts()).toEqual(before);
  });
  it("R2-H04 another existing incomplete order keeps source day partial",async()=>{
    await chain("missing",2);await good("products",[pRow("complete")]);await good("orders",[oRow("complete")]);
    const t=await prepare("order_items",[iRow("complete")],coverage("order_items"));expect((await commit(t)).status).toBe(202);
    const cov=await latestCoverage("order_items");log("R2-H04-history-missing",cov);expect(cov?.recordCount).toBe(2n);expect(cov?.status).toBe("partial");
  });
  it("R2-H04 unchanged partial order cannot become complete on duplicate-row upload",async()=>{
    await good("products",[pRow("repeat")]);await good("orders",[oRow("repeat",2)]);
    const a=await prepare("order_items",[iRow("repeat")],coverage("order_items"));expect((await commit(a)).status).toBe(202);expect((await latestCoverage("order_items"))?.status).toBe("partial");const before=await facts();
    const b=await prepare("order_items",[iRow("repeat"),iRow("repeat")],coverage("order_items"));const c=await commit(b);const after=await facts();const cov=await latestCoverage("order_items");log("R2-H04-unchanged",{commit:c,before,after,coverage:cov});expect(c.status).toBe(202);expect(cov?.status).toBe("partial");expect(after).toEqual(before);
  });
  it("R2-H05 zero confirmation binds the entire trading source group",async()=>{
    const t=await prepare("orders",[],coverage("orders","2026-09-01","2026-09-02","default",["2026-09-01"]));expect((await commit(t)).status).toBe(202);
    const settings=(await db.store.findUniqueOrThrow({where:{id:storeId}})).settings as any;expect(Object.values(settings.authoritative_source_ids)).toEqual([dataSourceId,dataSourceId,dataSourceId,dataSourceId]);
    const other=await db.dataSource.create({data:{orgId,storeId,sourceNamespace:"other",name:"other",adapterKind:"csv"}});const u=await prepare("orders",[oRow("other")],undefined,owner.cookie,other.id);const before=await facts();const c=await commit(u);log("R2-H05-zero",{settings,commit:c});expect(c.status).toBe(409);expect(await facts()).toEqual(before);
  });
  it("R2-H05 concurrent first source confirmations bind one group atomically",async()=>{
    const other=await db.dataSource.create({data:{orgId,storeId,sourceNamespace:"other",name:"other",adapterKind:"csv"}});
    const a=await prepare("orders",[oRow("a")]);const b=await prepare("orders",[oRow("b")],undefined,owner.cookie,other.id);
    const results=await Promise.all([commit(a),commit(b)]);const settings=(await db.store.findUniqueOrThrow({where:{id:storeId}})).settings as any;log("R2-H05-concurrent",{results,settings});expect(results.map(r=>r.status).sort()).toEqual([202,409]);expect(new Set(Object.values(settings.authoritative_source_ids)).size).toBe(1);expect(await db.order.count({where:{storeId}})).toBe(1);
  });
  it("R2-H06 original same-source alias contract resolves canonical SKU",async()=>{
    await good("products",[pRow("alias")]);const sku=await db.sKU.findFirstOrThrow({where:{storeId}});
    const {POST}=await import("@/app/api/v1/sku-aliases/route");const res=await POST(req("/api/v1/sku-aliases",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({store_id:storeId,source_namespace:"ns-import",external_sku_id:"ALIAS",canonical_sku_id:sku.id})},owner.cookie));expect(res.status).toBe(201);
    await good("orders",[oRow("alias")]);await good("order_items",[iRow("alias","L1","100",2,ts,"ALIAS")]);expect((await db.orderItem.findFirstOrThrow({where:{storeId}})).skuId).toBe(sku.id);
  });
  it("R2-H07 attribution model and window remain independent natural keys",async()=>{
    const row=(model:string,window:number,spend:string,stamp=ts)=>`IMP-1,${stamp},AD,ad,2026-09-01,${model},${window},${spend},30.000000,CNY`;
    await good("ads",[row("last_click",7,"10"),row("last_click",14,"20"),row("first_click",7,"30")]);await good("ads",[row("last_click",7,"11","2026-09-12T01:00:00Z")]);
    const rows=await db.adMetric.findMany({where:{storeId},orderBy:[{attributionModel:"asc"},{attributionWindowDays:"asc"}]});log("R2-H07",rows.map(r=>({model:r.attributionModel,window:r.attributionWindowDays,spend:r.spend.toString()})));expect(rows.map(r=>r.spend.toString())).toEqual(["30","11","20"]);
    const bad=await prepare("ads",[row("last_click",14,"21")]);expect(bad.status).toBe("failed");
  });
  it("R2-H08 preview has no raw record and full masked business body is preserved",async()=>{
    const text="business ".repeat(30)+" tail issue phone 13800138000 email demo@example.com";const t=await prepare("customer_messages",[mRow("full",text)]);const p=await preview(t);const encoded=JSON.stringify(p.body);expect(p.status).toBe(200);expect(encoded).not.toContain("13800138000");expect(encoded).not.toContain("demo@example.com");expect(p.body.data.items[0]).not.toHaveProperty("record");
    expect((await commit(t)).status).toBe(202);const m=await db.customerMessage.findFirstOrThrow({where:{storeId}});log("R2-H08-full",{preview:p.body,stored:m.redactedText});expect(m.redactedText).toContain("tail issue");expect(m.redactedText.length).toBeGreaterThan(200);expect(m.redactedText).not.toContain("13800138000");expect(m.redactedText).not.toContain("demo@example.com");
  });
  it("R2-H08 phone-only text must fail after redaction leaves no business content",async()=>{
    const before=await facts();const t=await prepare("customer_messages",[mRow("phone","13800138000")]);const c=await commit(t);const rows=await db.customerMessage.findMany({where:{storeId},select:{redactedText:true}});log("R2-H08-empty-phone",{taskStatus:t.status,commit:c,rows});expect(t.status).toBe("failed");expect(await facts()).toEqual(before);
  });
  it("R2-H08 email-only empty content rejection remains valid",async()=>{const t=await prepare("customer_messages",[mRow("email","demo@example.com")]);expect(t.status).toBe("failed");});
  it("R2-H08 address without province and building-room suffix must be fully masked",async()=>{
    const addr="厦门市思明区测试路88号2栋301室";const t=await prepare("customer_messages",[mRow("address",`收货地址：${addr}；杯盖漏水`)]);const p=await preview(t);expect(p.status).toBe(200);expect((await commit(t)).status).toBe(202);const m=await db.customerMessage.findFirstOrThrow({where:{storeId}});log("R2-H08-address",{stored:m.redactedText,preview:p.body});expect(m.redactedText).not.toContain("测试路88号");expect(m.redactedText).not.toContain("2栋301室");expect(JSON.stringify(p.body)).not.toContain("测试路88号");expect(m.redactedText).toContain("杯盖漏水");
  });
  it("R2-H08 after-sales reason retains long business text and masks full address",async()=>{
    await chain("reason");const reason="问题说明".repeat(60)+"杯盖漏水；收货地址：测试省测试市测试区测试路88号2栋301室";const row=rRow("reason","R1","20").replace(/漏水$/,reason);await good("after_sales",[row]);const r=await db.refundEvent.findFirstOrThrow({where:{storeId}});log("R2-H08-reason",{text:r.reasonText});expect(r.reasonText).toContain("杯盖漏水");expect(r.reasonText).not.toContain("2栋301室");
  });
  it("R2-M01 identical facts and declaration create no coverage version or outbox",async()=>{
    const a=await prepare("orders",[oRow("noop")],coverage("orders"));expect((await commit(a)).status).toBe(202);const before=await facts();const b=await prepare("orders",[oRow("noop"),oRow("noop")],coverage("orders"));const c=await commit(b);log("R2-M01",{commit:c,before,after:await facts()});expect(c.status).toBe(202);expect(c.body.data.no_op).toBe(true);expect(await facts()).toEqual(before);
  });
  it("R2-H04 DST spring day cannot count the next local day's first hour",async()=>{
    storeTimezone="America/New_York";await db.store.update({where:{id:storeId},data:{timezone:storeTimezone}});
    const row=`IMP-1,${ts},O-spring,paid,2026-03-09T04:20:00Z,2026-03-09T04:30:00Z,CNY,1`;
    const t=await prepare("orders",[row],coverage("orders","2026-03-08","2026-03-10","default",["2026-03-08"]));expect(t.status).toBe("preview_ready");const c=await commit(t);log("R2-H04-DST-spring",{taskStatus:t.status,commit:c});expect(c.status).toBe(202);
    const rows=await db.dataCoverage.findMany({where:{importTaskId:t.id},orderBy:{coverageDate:"asc"}});expect(rows.map(r=>r.recordCount)).toEqual([0n,1n]);
  });
  it("R2-H04 DST fall day includes the last local hour",async()=>{
    storeTimezone="America/New_York";await db.store.update({where:{id:storeId},data:{timezone:storeTimezone}});
    const row=`IMP-1,2026-11-03T00:00:00Z,O-fall,paid,2026-11-02T04:20:00Z,2026-11-02T04:30:00Z,CNY,1`;
    const t=await prepare("orders",[row],coverage("orders","2026-11-01","2026-11-02"));expect(t.status).toBe("preview_ready");expect((await commit(t)).status).toBe(202);
    const cov=await db.dataCoverage.findFirstOrThrow({where:{importTaskId:t.id}});log("R2-H04-DST-fall",cov);expect(cov.recordCount).toBe(1n);expect(cov.status).toBe("complete");
  });
});
