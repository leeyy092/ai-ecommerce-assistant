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

// Independent Gate 03 contract probes. App implementation remains frozen.
const ts = "2026-09-11T01:00:00Z";
const csv = (kind: keyof typeof FILE_HEADERS, rows: string[]) => `${FILE_HEADERS[kind].join(",")}\n${rows.join("\n")}`;
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
    const res=await PUT(req(`/api/v1/imports/${id}/mapping`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({timezone:"Asia/Shanghai",coverage_declaration:coverage,expected_preview_version:0})},cookie),{params:Promise.resolve({id})});
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

describe("G3 independent contract",()=>{
 it("C01 positive control: valid six-file chain, exact replay and same-ID replacement",async()=>{
   await chain("control");await good("ads",[`IMP-1,${ts},AC,广告,2026-09-01,last_click,7,10.000000,30.000000,CNY`]);
   await good("customer_messages",[mRow("control","杯子漏水")]);const t=await good("after_sales",[rRow("control","RC","25.000000")]);
   const v=(await db.store.findUniqueOrThrow({where:{id:storeId}})).datasetVersion;expect((await commit(t)).status).toBe(200);
   expect((await db.store.findUniqueOrThrow({where:{id:storeId}})).datasetVersion).toBe(v);
   await good("after_sales",[rRow("control","RC","20.000000").replace(ts,"2026-09-12T01:00:00Z")]);
   const r=await db.refundEvent.findMany({where:{externalRecordId:"RC",storeId}});expect(r).toHaveLength(1);expect(r[0].refundAmount?.toString()).toBe("20");log("C01",{replayVersion:v,refundCount:r.length,refundAmount:r[0].refundAmount});
 });
 it("H01 invalid row rejects whole file instead of committing the valid subset",async()=>{
   const t=await prepare("products",[pRow("bad-good"),pRow("bad-invalid").replace(ts,"not-a-time")]);
   const c=await commit(t);const n=await db.sKU.count({where:{storeId,externalSkuId:"S-bad-good"}});log("H01",{status:t.status,errorCount:t.errorCount,commit:c,inserted:n});
   expect(t.status).toBe("failed");expect(n).toBe(0);
 });
 it("H02a refund total includes successful events from earlier files",async()=>{
   await chain("refund-history");await good("after_sales",[rRow("refund-history","RH1")]);const t=await prepare("after_sales",[rRow("refund-history","RH2","60.000000",1,"04")]);const c=await commit(t);
   const rows=await db.refundEvent.findMany({where:{storeId,externalRecordId:{in:["RH1","RH2"]}}});log("H02a",{status:t.status,commit:c,total:rows.reduce((s,r)=>s+Number(r.refundAmount),0),paid:100});expect(t.status).toBe("failed");
 });
 it("H02b refund bounds include all rows of the current file",async()=>{
   await chain("refund-batch");const t=await prepare("after_sales",[rRow("refund-batch","RB1"),rRow("refund-batch","RB2","60.000000",1,"04")]);const c=await commit(t);log("H02b",{status:t.status,commit:c});expect(t.status).toBe("failed");
 });
 it("H02c order-item correction must respect existing successful refund bounds",async()=>{
   await chain("refund-correction");await good("after_sales",[rRow("refund-correction","RCR","60.000000",2)]);
   const t=await prepare("order_items",[iRow("refund-correction","L1","10.000000",1,"2026-09-12T01:00:00Z")]);const c=await commit(t);const item=await db.orderItem.findFirstOrThrow({where:{storeId,externalOrderItemId:"L1",order:{externalOrderId:"O-refund-correction"}}});log("H02c",{status:t.status,commit:c,amount:item.itemPaidAmount,quantity:item.quantity});expect(t.status).toBe("failed");
 });
 it("H03a preview race cannot overwrite a newer customer message",async()=>{
   const older=await prepare("customer_messages",[mRow("race","旧问题",ts)]);const newer=await prepare("customer_messages",[mRow("race","新问题","2026-09-12T01:00:00Z")]);expect((await commit(newer)).status).toBe(202);const c=await commit(older);
   const m=await db.customerMessage.findFirstOrThrow({where:{storeId,externalMessageId:"M-race"}});log("H03a",{commit:c,text:m.redactedText,sourceUpdatedAt:m.sourceUpdatedAt});expect(m.redactedText).toBe("新问题");
 });
 it("H03b preview older than 24h must reject confirmation",async()=>{
   const t=await prepare("products",[pRow("expired")]);const {getObjectText,putObject}=await import("@/storage");const {Readable}=await import("node:stream");const manifest=JSON.parse(await getObjectText(t.stagingObjectKey!));manifest.generated_at=new Date(Date.now()-25*3600e3).toISOString();await putObject(t.stagingObjectKey!,Readable.from([JSON.stringify(manifest)]));
   const c=await commit(t);log("H03b",{generatedAt:manifest.generated_at,commit:c});expect(c.status).toBe(409);
 });
 it("H03c committing another user's preview must recheck the uploader permission",async()=>{
   const t=await prepare("products",[pRow("revoked")],undefined,operator.cookie);await db.membership.updateMany({where:{orgId,userId:operator.userId},data:{status:"disabled"}});
   try {const c=await commit(t,owner.cookie);log("H03c",c);expect(c.status).not.toBe(202);}finally{await db.membership.updateMany({where:{orgId,userId:operator.userId},data:{status:"active"}});}
 });
 it("H04a absent undeclared-zero date cannot become complete",async()=>{
   const t=await prepare("orders",[oRow("coverage")],coverage("orders","2026-09-01","2026-09-03"));const c=await commit(t);const rows=await db.dataCoverage.findMany({where:{importTaskId:t.id},orderBy:{coverageDate:"asc"}});log("H04a",{status:t.status,commit:c,rows});expect(rows.some(r=>r.coverageDate.toISOString().startsWith("2026-09-02")&&r.status==="complete"&&!r.explicitZero&&r.recordCount===0n)).toBe(false);
 });
 it("H04b same facts and declarations from different CSV bytes are a version no-op",async()=>{
   const row=oRow("noop");const a=await prepare("orders",[row],coverage("orders"));expect((await commit(a)).status).toBe(202);const before=(await db.store.findUniqueOrThrow({where:{id:storeId}})).datasetVersion;
   const b=await prepare("orders",[row,row],coverage("orders"));const c=await commit(b);const after=(await db.store.findUniqueOrThrow({where:{id:storeId}})).datasetVersion;log("H04b",{before,after,commit:c});expect(after).toBe(before);
 });
 it("H05 explicit SKU mapping is consumed by a subsequent order-item validation",async()=>{
   await good("products",[pRow("alias")]);await good("orders",[oRow("alias")]);const sku=await db.sKU.findFirstOrThrow({where:{storeId,externalSkuId:"S-alias"}});const {POST}=await import("@/app/api/v1/sku-aliases/route");const res=await POST(req("/api/v1/sku-aliases",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({store_id:storeId,source_namespace:"ns-import",external_sku_id:"EXPLICIT-ALIAS",canonical_sku_id:sku.id})},owner.cookie));expect(res.status).toBe(201);
   const t=await prepare("order_items",[iRow("alias","L1","100.000000",2,ts,"EXPLICIT-ALIAS")]);log("H05",{aliasStatus:res.status,status:t.status,errorCode:t.errorCode});expect(t.status).toBe("preview_ready");
 });
 it("H06 same campaign on a different report date has a distinct natural key",async()=>{
   await good("ads",[`IMP-1,${ts},ADDATE,广告,2026-09-01,last_click,7,10.000000,30.000000,CNY`]);const t=await prepare("ads",[`IMP-1,${ts},ADDATE,广告,2026-09-02,last_click,7,12.000000,35.000000,CNY`]);log("H06",{status:t.status,errorCode:t.errorCode});expect(t.status).toBe("preview_ready");
 });
 it("M01 full non-PII complaint is retained beyond the preview excerpt",async()=>{
   const text="包装完好".repeat(60)+"但连续使用后杯盖严重漏水";await good("customer_messages",[mRow("long",text)]);const m=await db.customerMessage.findFirstOrThrow({where:{storeId,externalMessageId:"M-long"}});log("M01",{inputLength:text.length,storedLength:m.redactedText.length,hasIssue:m.redactedText.includes("严重漏水")});expect(m.redactedText).toBe(text);
 });
 it("H07 different content with same natural key inside a file is rejected even at different timestamps",async()=>{
   const t=await prepare("orders",[oRow("duplicate",1),oRow("duplicate",2).replace(ts,"2026-09-12T01:00:00Z")]);log("H07",{status:t.status,errorCode:t.errorCode});expect(t.status).toBe("failed");
 });
 it("H04c first confirmed source is authoritative for the channel",async()=>{
   await good("orders",[oRow("authority")]);const second=await db.dataSource.create({data:{orgId,storeId,sourceNamespace:"second-source",name:"第二来源",adapterKind:"csv"}});const t=await prepare("orders",[oRow("authority")],coverage("orders"),owner.cookie,second.id);const c=await commit(t);const n=await db.order.count({where:{storeId,externalOrderId:"O-authority"}});const s=await db.store.findUniqueOrThrow({where:{id:storeId}});log("H04c",{commit:c,duplicateOrders:n,settings:s.settings});expect(c.status).toBe(409);expect(n).toBe(1);
 });
});

 it("H04d final complete order-item batch must not retain transient partial state",async()=>{
   await good("products",[pRow("all-items")]);await good("orders",[oRow("all-items",2)]);const t=await prepare("order_items",[iRow("all-items","L1"),iRow("all-items","L2")],coverage("order_items"));const c=await commit(t);const rows=await db.dataCoverage.findMany({where:{importTaskId:t.id}});log("H04d",{commit:c,rows});expect(rows[0].status).toBe("complete");expect(rows[0].recordCount).toBe(2n);
 });
 it("H01b business currency must equal the selected store currency",async()=>{
   const t=await prepare("ads",[`IMP-1,${ts},WRONG-CURRENCY,广告,2026-09-01,last_click,7,10.000000,30.000000,USD`]);const c=await commit(t);const row=await db.adMetric.findFirst({where:{storeId,campaignId:"WRONG-CURRENCY"}});log("H01b",{status:t.status,commit:c,storedCurrency:row?.currency,storeCurrency:"CNY"});expect(t.status).toBe("failed");expect(row).toBeNull();
 });
 it("M01b synthetic street address is redacted before the customer-message fact is stored",async()=>{
   const address="测试省测试市测试区测试路88号2栋301室";await good("customer_messages",[mRow("address",`收货地址：${address}；杯盖漏水`)]);const m=await db.customerMessage.findFirstOrThrow({where:{storeId,externalMessageId:"M-address"}});log("M01b",{redactedText:m.redactedText,syntheticAddressPreserved:m.redactedText.includes(address)});expect(m.redactedText).not.toContain(address);expect(m.redactedText).toContain("杯盖漏水");
 });
