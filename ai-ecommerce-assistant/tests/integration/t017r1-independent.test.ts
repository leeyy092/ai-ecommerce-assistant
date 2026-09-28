/**
 * TASK-017｜模型网关集成测试（真实 PostgreSQL + stub provider 故障注入）。
 * 覆盖：Schema/Ajv 金样（合法/多余属性/格式）；happy path 预算预留→usage结算→幂等复用；
 * 日/月预算耗尽跳过；并发预留串行；超时终态（保留预留 billing=unknown）；5xx重试后成功；
 * 鉴权立即终止（释放）；格式修复一次（修复后成功/仍失败SCHEMA_INVALID）；
 * 语义 UNKNOWN_REFERENCE 修复无效终态；超大输入 INPUT_TOO_LARGE。
 * 真实模型 contract（需 DASHSCOPE 三配置）另行 ai-real-contract.test.ts，未配置时如实跳过。
 */
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";
import { setStorageRoot } from "@/storage";
import { validateLlmPayload, validateVocBatch, FIXED_MODEL_ID, PROMPT_VERSIONS, SCHEMA_VERSION } from "@/ai/schemas/validators";
import { ModelTransportError, type ModelRequest, type ModelResponse, type ModelTransport } from "@/ai/providers/model-provider";
import { runAiTask } from "@/ai/gateway";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));
setStorageRoot(mkdtempSync(join(tmpdir(), "aiea-storage-")));

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;
beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
}, 420_000);
afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

const UUID = (n: number): string => `0000000${n}-0000-4000-8000-00000000000${n}`;
const validLlmPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: "销量下降需复核",
  category: "business",
  severity: "warning",
  summary: "昨日销量较同星期基准下降75%，建议核查漏单与活动结束。",
  evidence_ids: ["EV-1"],
  possible_causes: [
    { hypothesis_id: "H1", kind: "hypothesis", description: "活动结束导致自然回落", evidence_ids: ["EV-1"], verification_step: "对比活动订单占比" },
  ],
  recommended_actions: [
    { action_id: "A1", title: "核查订单完整性", description: "检查导入覆盖与漏单", evidence_ids: ["EV-1"], hypothesis_ids: ["H1"], priority: "P1", expected_impact: { qualitative: "确认下降是否为数据缺口", metric_id: "units_sold", observation_days: 3 } },
  ],
  priority: "P1",
  related_skus: [],
  related_metrics: ["units_sold"],
  ...over,
});

function stubTransport(script: Array<(req: ModelRequest) => ModelResponse | Promise<ModelResponse> | never>): ModelTransport {
  let i = 0;
  return {
    async call(req: ModelRequest): Promise<ModelResponse> {
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      const out = step(req);
      return out as ModelResponse;
    },
  };
}
const ok = (payload: unknown): ModelResponse => ({ content: JSON.stringify(payload), usage: { input_tokens: 100, output_tokens: 50 } });
const badJson = (): ModelResponse => ({ content: "{不是JSON", usage: { input_tokens: 90, output_tokens: 10 } });

async function newOrgStore(budget?: { daily: string; monthly: string }): Promise<{ orgId: string; storeId: string }> {
  const t = randomUUID().slice(0, 8);
  const authUser = await db.authUser.create({ data: { id: randomUUID(), email: `ai-${t}@example.com`, name: "o", emailVerified: true } } as never);
  const user = await db.user.create({ data: { id: randomUUID(), authUserId: authUser.id, email: authUser.email, displayName: "o" } });
  const org = await db.organization.create({
    data: { name: `AI组织${t}`, ownerUserId: user.id, ...(budget ? { aiDailyBudget: budget.daily, aiMonthlyBudget: budget.monthly } : {}) },
  });
  const store = await db.store.create({ data: { orgId: org.id, name: `AI店${t}`, externalStoreId: `AI-${t}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } });
  return { orgId: org.id, storeId: store.id };
}

const baseArgs = (s: { orgId: string; storeId: string }, key: string, transport: ModelTransport) => ({
  db, orgId: s.orgId, storeId: s.storeId, kind: "insight" as const,
  idempotencyKey: key, datasetVersion: 1n, rulesetVersion: "rules-v1-init",
  visibilityScope: "business" as const,
  systemPrompt: "你是电商运营分析师，只输出JSON。",
  userPrompt: "基于证据生成洞察。",
  semantic: { whitelist: { evidenceIds: new Set(["EV-1"]), skuIds: new Set([UUID(1)]), metricIds: new Set(["units_sold", "gmv"]) } },
  transport,
  timeoutMs: 200, backoffMs: [1, 1], sleep: async () => {},
});


import { validateRoot, validateDailyConclusion } from "@/ai/schemas/validators";
import { assertBudgetAvailable } from "@/ai/budget";
import { Prisma } from "@/generated/prisma/client";
import rootGold from "./t017-root-fixture.json";
const observations: Record<string, unknown> = {};
const note = (id: string, x: unknown) => { observations[id] = x; console.log(id, JSON.stringify(x, (_k,v)=>typeof v==='bigint'?v.toString():v)); };
afterAll(()=>writeFileSync(process.env.PROBE_OUTPUT ?? '/tmp/aiea-t017r1-6u14au3f/evidence/observations.json',JSON.stringify(observations,(_k,v)=>typeof v==='bigint'?v.toString():v,2)));
const key=()=>randomUUID();
const argsWith=(s:{orgId:string;storeId:string},p:unknown)=>baseArgs(s,key(),stubTransport([()=>ok(p)]));
const vocArgs=(s:{orgId:string;storeId:string},span:unknown[],sentiment='neutral')=>{
 const p={taxonomy_version:'voc-v1',results:[{message_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',label:'refund_process',secondary_labels:[],sentiment,evidence_spans:span}]};
 expect(validateVocBatch(p)).toBe(true);
 return {...argsWith(s,p),kind:'voc_classification' as const,semantic:{voc:{batchMessageIds:new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),normalizedTexts:new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','退货']]),taxonomyVersion:'voc-v1'}}};
};
describe('T017R1 original-contract independent boundaries',()=>{
 it('C01 legal insight and same-context cache remain valid',async()=>{
  const s=await newOrgStore();const a=argsWith(s,validLlmPayload());let calls=0;a.transport={call:async()=>{calls++;return ok(validLlmPayload())}};
  const x=await runAiTask(a);const y=await runAiTask(a);note('C01',{x,y,calls});expect(x.status).toBe('succeeded');expect(y.status).toBe('reused');expect(calls).toBe(1);
 });
 it('A01 same key cannot reuse another organization payload',async()=>{
  const s=await newOrgStore(),b=await newOrgStore();const a=argsWith(s,validLlmPayload());const x=await runAiTask(a);let calls=0;
  const y=await runAiTask({...baseArgs(b,a.idempotencyKey,{call:async()=>{calls++;return ok(validLlmPayload())}})});
  note('A01',{sourceOrg:s.orgId,targetOrg:b.orgId,x,y,calls});expect(y.runId).not.toBe(x.runId);
 });
 it('A02 same key cannot reuse business payload in customer-service scope',async()=>{
  const s=await newOrgStore();const a=argsWith(s,validLlmPayload());const x=await runAiTask(a);
  const y=await runAiTask({...a,visibilityScope:'customer_service'});note('A02',{x,y});expect(y.runId).not.toBe(x.runId);
 });
 it('A03 same key cannot reuse stale dataset or different input',async()=>{
  const s=await newOrgStore();const a=argsWith(s,validLlmPayload());const x=await runAiTask(a);
  const y=await runAiTask({...a,datasetVersion:2n,userPrompt:'新的证据包'});note('A03',{x,y});expect(y.runId).not.toBe(x.runId);
 });
 it('A04 concurrent identical in-flight key calls provider only once',async()=>{
  const s=await newOrgStore();let calls=0,unlock!:()=>void,started!:()=>void;
  const signal=new Promise<void>(r=>started=r),barrier=new Promise<void>(r=>unlock=r);
  const a=baseArgs(s,key(),{call:async()=>{calls++;started();await barrier;return ok(validLlmPayload())}});
  const x=runAiTask(a);await signal;const y=runAiTask(a);
  await new Promise(r=>setTimeout(r,40));unlock();const results=await Promise.all([x,y]);note('A04',{calls,results});expect(calls).toBe(1);
 });
 it('B01 evidence whitelist must reject unknown evidence references',async()=>{
  const s=await newOrgStore();const p=validLlmPayload({evidence_ids:['EV-NOT-IN-PACKAGE']});expect(validateLlmPayload(p)).toBe(true);
  const r=await runAiTask(argsWith(s,p));note('B01',r);expect(r.status).toBe('failed');
 });
 it('B02 action hypothesis references must close over declared hypotheses',async()=>{
  const s=await newOrgStore();const p=validLlmPayload();(p.recommended_actions as any[])[0].hypothesis_ids=['H2'];expect(validateLlmPayload(p)).toBe(true);
  const r=await runAiTask(argsWith(s,p));note('B02',r);expect(r.status).toBe('failed');
 });
 it('B03 missing server semantic context must fail closed',async()=>{
  const s=await newOrgStore();const p=validLlmPayload({related_skus:[UUID(3)]});expect(validateLlmPayload(p)).toBe(true);
  const r=await runAiTask({...argsWith(s,p),semantic:undefined});note('B03',r);expect(r.status).toBe('failed');
 });
 it('B04 daily report must reject unknown evidence and synthetic contact text',async()=>{
  const s=await newOrgStore();const item={text:'联系 synthetic-review@example.com',evidence_ids:['EV-OTHER-TENANT'],reason:null};
  const p={overall_state:item,biggest_problem:item,biggest_opportunity:item,top_action:item};expect(validateDailyConclusion(p)).toBe(true);
  const r=await runAiTask({...argsWith(s,p),kind:'daily_report'});note('B04',r);expect(r.status).toBe('failed');
 });
 it('B05 duplicate action identifiers must fail semantics',async()=>{
  const s=await newOrgStore();const p=validLlmPayload();const actions=p.recommended_actions as any[];actions.push({...actions[0],title:'另一个动作'});expect(validateLlmPayload(p)).toBe(true);
  const r=await runAiTask(argsWith(s,p));note('B05',r);expect(r.status).toBe('failed');
 });
 it('B06 VOC span end cannot exceed code point length',async()=>{
  const s=await newOrgStore();const r=await runAiTask(vocArgs(s,[{start:0,end:99,text:'退货'}]));note('B06',r);expect(r.status).toBe('failed');
 });
 it('B07 no VOC evidence must not support concrete label and sentiment',async()=>{
  const s=await newOrgStore();const r=await runAiTask(vocArgs(s,[],'negative'));note('B07',r);expect(r.status).toBe('failed');
 });
 it('C02 valid unicode VOC span is accepted',async()=>{
  const s=await newOrgStore();const r=await runAiTask(vocArgs(s,[{start:0,end:2,text:'退货'}]));note('C02',r);expect(r.status).toBe('succeeded');
 });
 it('D01 transmission plus repair share total attempt limit 3',async()=>{
  const s=await newOrgStore();let calls=0;
  const r=await runAiTask(baseArgs(s,key(),{call:async()=>{calls++;if([1,2,4,5].includes(calls))throw new ModelTransportError('PROVIDER_5XX',true,503);return calls===3?badJson():ok(validLlmPayload())}}));
  const row=await db.aIRun.findUniqueOrThrow({where:{id:r.runId}});note('D01',{calls,result:r,storedAttempts:row.attempts});expect(calls).toBeLessThanOrEqual(3);
 });
 it('D02 failed same-key redelivery cannot reset persisted attempts',async()=>{
  const s=await newOrgStore();let calls=0;const a=baseArgs(s,key(),{call:async()=>{calls++;throw new ModelTransportError('TIMEOUT',true)}});
  const x=await runAiTask(a),y=await runAiTask(a);note('D02',{calls,x,y});expect(calls).toBeLessThanOrEqual(3);
 });
 it('E01 settled actual cost releases unused reservation',async()=>{
  const s=await newOrgStore({daily:'0.0092',monthly:'100'});const x=await runAiTask(argsWith(s,validLlmPayload()));const y=await runAiTask(argsWith(s,validLlmPayload()));
  const row=await db.aIRun.findUniqueOrThrow({where:{id:x.runId}});note('E01',{x,y,reserved:row.reservedCost,actual:row.actualCost});expect(x.status).toBe('succeeded');expect(y.status).toBe('succeeded');
 });
 it('E02 paid invalid outputs still consume budget and all usage',async()=>{
  const s=await newOrgStore({daily:'0.012',monthly:'100'});let calls=0;
  const t={call:async()=>{calls++;return {content:'{"bad":true}',usage:{input_tokens:100,output_tokens:5000}}}};
  const x=await runAiTask(baseArgs(s,key(),t)),y=await runAiTask(baseArgs(s,key(),t));
  const row=await db.aIRun.findUniqueOrThrow({where:{id:x.runId}});note('E02',{calls,x,y,billing:row.billingStatus,reserved:row.reservedCost,actual:row.actualCost});expect(y.status).toBe('skipped');
 });
 it('E03 each unknown-timeout retry needs another budget reservation',async()=>{
  const s=await newOrgStore({daily:'0.012',monthly:'100'});let calls=0;
  const r=await runAiTask(baseArgs(s,key(),{call:async()=>{calls++;throw new ModelTransportError('TIMEOUT',true)}}));
  const row=await db.aIRun.findUniqueOrThrow({where:{id:r.runId}});note('E03',{calls,r,billing:row.billingStatus,reserved:row.reservedCost});expect(calls).toBe(1);
 });
 it('E04 repair-success charges usage from both paid responses',async()=>{
  const s=await newOrgStore();const r=await runAiTask(baseArgs(s,key(),stubTransport([badJson,()=>ok(validLlmPayload())])));
  const row=await db.aIRun.findUniqueOrThrow({where:{id:r.runId}});note('E04',{r,input:row.inputTokens,output:row.outputTokens,actual:row.actualCost});expect(row.inputTokens).toBe(190n);expect(row.outputTokens).toBe(60n);
 });
 for(const window of ['daily','monthly'] as const)it(`E05-${window} Shanghai local midnight keeps today's earlier UTC-day charges`,async()=>{
  const s=await newOrgStore({daily:window==='daily'?'0.02':'3',monthly:window==='monthly'?'0.02':'100'});
  await db.aIRun.create({data:{...s,kind:'insight',idempotencyKey:key(),datasetVersion:1n,rulesetVersion:'rules-v1-init',visibilityScope:'business',modelId:FIXED_MODEL_ID,promptVersion:'insight-v1',schemaVersion:'1.0',inputHash:'0'.repeat(64),reservedCost:'0.02',actualCost:'0.02',billingStatus:'settled',status:'succeeded',requestContext:{},createdAt:new Date('2026-09-30T16:01:00Z')}});
  let error:string|null=null;try{await db.$transaction(tx=>assertBudgetAvailable(tx,{orgId:s.orgId,reserveCost:new Prisma.Decimal('.009'),now:new Date('2026-10-01T00:05:00+08:00')}))}catch(e){error=(e as Error).message}
  note(`E05-${window}`,{error});expect(error).toBe(`AI_${window.toUpperCase()}_BUDGET_EXCEEDED`);
 });
 it('F01 rejected schema output must not persist synthetic contact data',async()=>{
  const s=await newOrgStore();const p=validLlmPayload({untrusted_extra:'synthetic-review@example.com'});expect(validateLlmPayload(p)).toBe(false);
  const r=await runAiTask(argsWith(s,p));const row=await db.aIRun.findUniqueOrThrow({where:{id:r.runId}});note('F01',{r,stored:row.requestContext});expect(JSON.stringify(row.requestContext)).not.toContain('synthetic-review@example.com');
 });
 it('F02 repair request must not resend unsafe raw provider output',async()=>{
  const s=await newOrgStore();let i=0;const requests:string[]=[];
  const r=await runAiTask(baseArgs(s,key(),{call:async(req)=>{requests.push(req.userPrompt);i++;return i===1?ok(validLlmPayload({untrusted_extra:'synthetic-review@example.com'})):ok(validLlmPayload())}}));
  note('F02',{r,repairContainsSyntheticContact:requests[1]?.includes('synthetic-review@example.com')});expect(requests[1]).not.toContain('synthetic-review@example.com');
 });
 it('F03 HTML with attributes must fail text-safety validation',async()=>{
  const s=await newOrgStore();const p=validLlmPayload({summary:'请检查<img src=x onerror=synthetic_test>商品'});expect(validateLlmPayload(p)).toBe(true);
  const r=await runAiTask(argsWith(s,p));note('F03',r);expect(r.status).toBe('failed');
 });
 it('G01 impossible date-time must fail full-root Ajv validation',()=>{
  const valid=structuredClone(rootGold);expect(validateRoot(valid),validateRoot.errorsText()).toBe(true);
  const bad={...valid,generated_at:'2026-99-99T99:99:99+99:99'};const accepted=validateRoot(bad);note('G01',{accepted,errors:validateRoot.errorsText()});expect(accepted).toBe(false);
 });
});
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
it('H01 separate worker processes must enforce one call per organization',async()=>{
 const s=await newOrgStore();const dir=mkdtempSync(join(tmpdir(),'t017-process-'));
 const cfg=join(dir,'cfg.json');writeFileSync(cfg,JSON.stringify({dir,stores:[s,s],payload:validLlmPayload()}));
 const children=[0,1].map(i=>{
  const proc=spawn(process.execPath,['--import','tsx','tests/integration/t017r1-process.ts',cfg,String(i)],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:testUrl},stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',b=>output+=b.toString());proc.stderr.on('data',b=>output+=b.toString());
  return {proc,done:new Promise<{code:number|null;output:string}>(resolve=>proc.on('close',code=>resolve({code,output})))};
 });
 try{
  const deadline=Date.now()+10000;while(![0,1].every(i=>existsSync(join(dir,`ready-${i}`)))){if(Date.now()>deadline)throw Error('child ready timeout');await new Promise(r=>setTimeout(r,10))}
  writeFileSync(join(dir,'go'),'go');const completed=await Promise.all(children.map(x=>x.done));expect(completed.map(x=>x.code),JSON.stringify(completed)).toEqual([0,0]);
  const events=readFileSync(join(dir,'events.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));let active=0,max=0;for(const e of events){active+=e.event==='start'?1:-1;max=Math.max(max,active)}note('H01',{max,events,completed});expect(max).toBe(1);
 }finally{for(const c of children)if(c.proc.exitCode===null)c.proc.kill('SIGTERM')}
},20000);
it('F04 repair must remain inside input character budget',async()=>{
 const s=await newOrgStore();const lengths:number[]=[];let i=0;const a=baseArgs(s,key(),{call:async req=>{i++;lengths.push(`${req.systemPrompt}\n${req.userPrompt}`.length);return i===1?{content:'not-json '.repeat(600),usage:{input_tokens:100,output_tokens:100}}:ok(validLlmPayload())}});
 a.userPrompt='中'.repeat(11900);const r=await runAiTask(a);note('F04',{r,lengths});expect(Math.max(...lengths)).toBeLessThanOrEqual(12000);
});
it('F05 legitimate UUID must not be mistaken for a telephone number',async()=>{
 const s=await newOrgStore();const p={taxonomy_version:'voc-v1',results:[{message_id:UUID(2),label:'refund_process',secondary_labels:[],sentiment:'neutral',evidence_spans:[{start:0,end:2,text:'退货'}]}]};expect(validateVocBatch(p)).toBe(true);
 const a={...argsWith(s,p),kind:'voc_classification' as const,semantic:{voc:{batchMessageIds:new Set([UUID(2)]),normalizedTexts:new Map([[UUID(2),'退货']]),taxonomyVersion:'voc-v1'}}};
 const r=await runAiTask(a);const row=await db.aIRun.findUniqueOrThrow({where:{id:r.runId}});note('F05',{r,errors:row.attempts});expect(r.status).toBe('succeeded');
});
