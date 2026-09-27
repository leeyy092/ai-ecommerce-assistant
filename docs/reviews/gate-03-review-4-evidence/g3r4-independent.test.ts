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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const newer = "2026-09-12T01:00:00Z";
const newest = "2026-09-13T01:00:00Z";
const orderAt = (id:string,count=1,day="01",stamp=ts) => oRow(id,count).replaceAll("2026-09-01T",`2026-09-${day}T`).replace(ts,stamp);
async function coveredOne(id:string) {
  await good("products",[pRow(id)]); await good("orders",[oRow(id,1)]);
  const t=await prepare("order_items",[iRow(id)],coverage("order_items"));
  expect((await commit(t)).status).toBe(202);
  expect((await latestCoverage("order_items"))?.status).toBe("complete");
}
async function dayCoverage(day:string) {
  return db.dataCoverage.findFirst({where:{orgId,storeId,dataSourceId,sourceKind:"order_items",coverageDate:new Date(`2026-09-${day}T00:00:00Z`)},orderBy:{datasetVersion:"desc"}});
}

describe("R4 repair lifecycle and changed-path controls",()=>{
  for(const [label,payload] of [["array","[]"],["string","\"text\""],["number","42"],["empty-object","{}"]]) {
    it(`R4-H03 structural ${label} rejects without effects`,async()=>{
      const t=await prepare("products",[pRow(`shape-${label}`)]);const before=await facts();
      const {putObject}=await import("@/storage"); const {Readable}=await import("node:stream");
      await putObject(t.stagingObjectKey!,Readable.from([payload]));const c=await commit(t);
      log(`R4-H03-${label}`,{commit:c,before,after:await facts()});
      expect(c.status).toBe(409);expect(await facts()).toEqual(before);
    });
  }
  it("R4-H03 transient storage read remains retryable and successful retry works",async()=>{
    const t=await prepare("products",[pRow("storage-retry")]);const before=await facts();
    const storage=await import("@/storage");const spy=vi.spyOn(storage,"getObjectText").mockRejectedValueOnce(Object.assign(new Error("synthetic storage I/O outage"),{code:"EIO"}));
    let c;try{c=await commit(t);}finally{spy.mockRestore();}
    const after=await facts();const retry=await commit(t);log("R4-H03-storage",{commit:c,before,after,retry});
    expect(c.status).toBe(503);expect(c.body.error.retryable).toBe(true);expect(after).toEqual(before);expect(retry.status).toBe(202);
  });
  it("R4-H04 expected correction then fill restores complete with history and one version bump",async()=>{
    await coveredOne("restore");const original=await latestCoverage("order_items");const before=await facts();
    const t=await prepare("orders",[orderAt("restore",2,"01",newer)],coverage("orders"));const c=await commit(t);const partial=await latestCoverage("order_items");const after=await facts();
    expect(c.status).toBe(202);expect(partial?.status).toBe("partial");expect(BigInt(after.version)).toBe(BigInt(before.version)+1n);expect(after.pending).toBe(before.pending+1);
    expect(await db.dataCoverage.findUnique({where:{id:original!.id}})).toEqual(original);
    const fill=await prepare("order_items",[iRow("restore","L2")],coverage("order_items"));const fc=await commit(fill);const complete=await latestCoverage("order_items");
    log("R4-H04-restore",{commit:c,original,partial,before,after,fill:fc,complete});
    expect(fc.status).toBe(202);expect(complete?.status).toBe("complete");expect(complete?.recordCount).toBe(2n);expect(await db.dataCoverage.findUnique({where:{id:partial!.id}})).toEqual(partial);
  });
  it("R4-H04 count reduction preserves existing partial until user confirmation",async()=>{
    await coveredOne("no-upgrade");
    const inc=await prepare("orders",[orderAt("no-upgrade",2,"01",newer)],coverage("orders"));expect((await commit(inc)).status).toBe(202);
    const partial=await latestCoverage("order_items");const dec=await prepare("orders",[orderAt("no-upgrade",1,"01",newest)],coverage("orders"));expect((await commit(dec)).status).toBe(202);
    const after=await latestCoverage("order_items");log("R4-H04-no-upgrade",{partial,after});expect(after?.status).toBe("partial");
  });
  it("R4-H04 parent date migration updates both dates and counts all source facts",async()=>{
    await good("products",[pRow("move-a"),pRow("move-b")]);await good("orders",[orderAt("move-a"),orderAt("move-b",1,"02")]);
    const items=await prepare("order_items",[iRow("move-a"),iRow("move-b")],coverage("order_items","2026-09-01","2026-09-03"));expect((await commit(items)).status).toBe(202);
    const oldBefore=await dayCoverage("01"),newBefore=await dayCoverage("02");expect(oldBefore?.recordCount).toBe(1n);expect(newBefore?.recordCount).toBe(1n);
    const t=await prepare("orders",[orderAt("move-a",2,"02",newer)],coverage("orders","2026-09-02","2026-09-03"));const c=await commit(t);
    const oldAfter=await dayCoverage("01"),newAfter=await dayCoverage("02");const v=(await facts()).version;
    log("R4-H04-date",{commit:c,oldBefore,newBefore,oldAfter,newAfter,version:v});
    expect(c.status).toBe(202);expect(oldAfter?.recordCount).toBe(0n);expect(newAfter?.recordCount).toBe(2n);expect(newAfter?.status).toBe("partial");
    expect(oldAfter?.datasetVersion.toString()).toBe(v);expect(newAfter?.datasetVersion.toString()).toBe(v);
    expect(await db.dataCoverage.findUnique({where:{id:oldBefore!.id}})).toEqual(oldBefore);expect(await db.dataCoverage.findUnique({where:{id:newBefore!.id}})).toEqual(newBefore);
  });
  it("R4-H04 parent moving to undeclared day does not manufacture item coverage",async()=>{
    await coveredOne("undeclared");const t=await prepare("orders",[orderAt("undeclared",1,"03",newer)],coverage("orders","2026-09-03","2026-09-04"));const c=await commit(t);
    const old=await dayCoverage("01"),next=await dayCoverage("03");log("R4-H04-undeclared",{commit:c,old,next});expect(c.status).toBe(202);expect(old?.recordCount).toBe(0n);expect(next).toBeNull();
  });
  it("R4-H04 derived coverage failure rolls parent facts version and outbox back",async()=>{
    await coveredOne("atomic");const t=await prepare("orders",[orderAt("atomic",2,"01",newer)],coverage("orders"));const before=await facts();const original=await latestCoverage("order_items");
    await db.$executeRawUnsafe(`CREATE FUNCTION r4_fail_coverage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.store_id = '${storeId}' AND NEW.source_kind = 'order_items' AND NEW.status = 'partial' THEN RAISE EXCEPTION 'R4 synthetic coverage failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER r4_fail_coverage BEFORE INSERT ON data_coverage FOR EACH ROW EXECUTE FUNCTION r4_fail_coverage()');
    let c;try{c=await commit(t);}finally{await db.$executeRawUnsafe('DROP TRIGGER r4_fail_coverage ON data_coverage');await db.$executeRawUnsafe('DROP FUNCTION r4_fail_coverage()');}
    const after=await facts();const order=await db.order.findFirstOrThrow({where:{storeId,externalOrderId:"O-atomic"}});const cov=await latestCoverage("order_items");const task=await db.importTask.findUniqueOrThrow({where:{id:t.id}});
    log("R4-H04-atomic",{commit:c,before,after,expected:order.expectedItemCount,cov,status:task.status});expect(c.status).toBe(503);expect(after).toEqual(before);expect(order.expectedItemCount).toBe(1);expect(cov).toEqual(original);expect(task.status).toBe("preview_ready");
    expect((await commit(t)).status).toBe(202);expect((await latestCoverage("order_items"))?.status).toBe("partial");
  });
});

