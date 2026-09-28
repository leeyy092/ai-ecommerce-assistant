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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

import { Prisma } from '@/generated/prisma/client';
import { medianBaseline, buildRulesSnapshot } from '@/services/alerts/engine';
import { requestRebuild, evaluationTick } from '@/services/snapshot';
const at1 = new Date('2026-09-27T00:00:00Z');
const at2 = new Date('2026-09-28T00:00:00Z');
const day = (d: string) => new Date(d+'T00:00:00Z');
const dec = (n: number) => new Prisma.Decimal(n);
async function evaluated(s: Scope, ruleId: string) {
  return db.ruleEvaluation.findFirst({where:{storeId:s.storeId,ruleId},orderBy:{periodStart:'desc'}});
}
async function metric(s: Scope, date: string, mid: string, value: number, sample: number, extra: Record<string,unknown>={}) {
  return db.dailyMetric.create({data:{orgId,storeId:s.storeId,metricId:mid,entityKey:'store',periodStart:day(date),periodEnd:day(date),datasetVersion:1n,rulesetVersion:'rules-v1-init',metricVersion:'v1',evaluationAt:at1,valueNumeric:dec(value),sampleSize:BigInt(sample),status:'available',coverageStatus:'complete',maturity:'mature',...extra} as never});
}
async function rules(s: Scope, rulesetVersion='rules-v1-init', evaluationAt=at1) {
 await db.$transaction(tx=>buildRulesSnapshot({orgId,storeId:s.storeId,datasetVersion:1n,rulesetVersion,evaluationAt,tx}));
}
async function salesFixture() {
  const s=await newScope();
  await good(s,'products',[pRow(s.sid,'1')]);
  for(const d of ['2026-09-05','2026-09-12','2026-09-19']) await dayOfSales(s,d,1,80,'800');
  await dayOfSales(s,'2026-09-26',1,20,'200');
  return s;
}


async function patchRule(s: Scope, rid: string, version: number, changes: Record<string, unknown>) {
 const {PATCH}=await import('@/app/api/v1/alert-rules/[rule_id]/route');
 return PATCH(req('/api/v1/alert-rules/'+rid,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({store_id:s.storeId,expected_version:version,...changes})},owner.cookie),{params:Promise.resolve({rule_id:rid})});
}
async function readRule(s:Scope,rid:string){
 const {GET}=await import('@/app/api/v1/alert-rules/route');const r=await GET(req(`/api/v1/alert-rules?store_id=${s.storeId}`,{},owner.cookie));expect(r.status).toBe(200);return (await r.json()).data.items.find((v:any)=>v.rule_id===rid);
}
afterEach(()=>vi.useRealTimers());

describe('G4R4 targeted positive controls',()=>{
 it('K03 Fiji target evaluation itself is triggered, not an older matching row',async()=>{
  const s=await salesFixture();await rules(s);await db.store.update({where:{id:s.storeId},data:{timezone:'Pacific/Fiji'}});
  const targetAt=new Date('2026-09-26T20:00:00Z');await rules(s,'rules-v1-init',targetAt);
  const r=await db.ruleEvaluation.findFirstOrThrow({where:{storeId:s.storeId,ruleId:'R07',evaluationAt:targetAt}});
  console.log('K03',JSON.stringify({status:r.status,at:r.evaluationAt}));expect(r.status).toBe('triggered');
 });
 it('K04 concurrent edits using one config_version permit exactly one winner',async()=>{
  realBuilders();const s=await salesFixture();await publish(s.storeId);const old=await readRule(s,'R03');
  const results=await Promise.all([patchRule(s,'R03',old.config_version,{thresholds:{min_orders:40}}),patchRule(s,'R03',old.config_version,{thresholds:{min_orders:50}})]);
  const status=results.map(r=>r.status).sort();console.log('K04',JSON.stringify(status));expect(status).toEqual([200,409]);
 });
 it('K05 R07 parameter change resets the prior ignored state',async()=>{
  realBuilders();const s=await salesFixture();await publish(s.storeId);const old=await db.alert.findFirstOrThrow({where:{storeId:s.storeId,ruleId:'R07'}});await db.alert.update({where:{id:old.id},data:{status:'ignored'}});
  expect((await patchRule(s,'R07',(await readRule(s,'R07')).config_version,{thresholds:{units_drop_abs:6}})).status).toBe(200);await publish(s.storeId);
  const st=await db.store.findUniqueOrThrow({where:{id:s.storeId}});const fresh=await db.alert.findFirstOrThrow({where:{storeId:s.storeId,ruleId:'R07',rulesetVersion:st.currentSnapshotRulesetVersion!}});
  console.log('K05',JSON.stringify({status:fresh.status,carried:fresh.carriedFromAlertId,oldRule:old.ruleVersion,newRule:fresh.ruleVersion}));expect(fresh.status).toBe('open');expect(fresh.carriedFromAlertId).toBeNull();
 });
});
