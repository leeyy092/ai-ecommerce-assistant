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
afterAll(()=>writeFileSync(process.env.PROBE_OUTPUT!.replace('observations.json','r3-observations.json'),JSON.stringify(observations,(_k,v)=>typeof v==='bigint'?v.toString():v,2)));
const key=()=>randomUUID();
const argsWith=(s:{orgId:string;storeId:string},p:unknown)=>baseArgs(s,key(),stubTransport([()=>ok(p)]));
const vocArgs=(s:{orgId:string;storeId:string},span:unknown[],sentiment='neutral')=>{
 const p={taxonomy_version:'voc-v1',results:[{message_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',label:'refund_process',secondary_labels:[],sentiment,evidence_spans:span}]};
 expect(validateVocBatch(p)).toBe(true);
 return {...argsWith(s,p),kind:'voc_classification' as const,semantic:{voc:{batchMessageIds:new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),normalizedTexts:new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','退货']]),taxonomyVersion:'voc-v1'}}};
};

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

it('L01 failed schema is terminal for the same generation key',async()=>{
 const s=await newOrgStore();let calls=0;const a=baseArgs(s,key(),{call:async()=>{calls++;return badJson()}});
 const first=await runAiTask(a);expect(first.errorCode).toBe('SCHEMA_INVALID');const row1=await db.aIRun.findUniqueOrThrow({where:{id:first.runId}});
 const second=await runAiTask(a);const row2=await db.aIRun.findUniqueOrThrow({where:{id:first.runId}});
 note('L01',{calls,first,second,auditBefore:row1.attempts,auditAfter:row2.attempts});expect(calls).toBe(2);
});
async function crashRun(s:{orgId:string;storeId:string},callerKey:string,mode:string){
 const dir=mkdtempSync(join(tmpdir(),'t017r3-crash-'));const cfg=join(dir,'cfg.json');writeFileSync(cfg,JSON.stringify({dir,s,key:callerKey,mode}));
 const proc=spawn(process.execPath,['--import','tsx','tests/integration/t017r3-crash.ts',cfg],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:testUrl},stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout.on('data',b=>output+=b.toString());proc.stderr.on('data',b=>output+=b.toString());const done=new Promise(resolve=>proc.on('close',(code,signal)=>resolve({code,signal,output})));
 try {const limit=Date.now()+10000;while(!existsSync(join(dir,'called'))){if(Date.now()>limit)throw Error('child did not reach marker '+output);await new Promise(r=>setTimeout(r,10));}}
 finally {proc.kill('SIGKILL');await done;}
 return db.aIRun.findFirstOrThrow({where:{orgId:s.orgId}});
}
it('L02 recovery preserves prior attempt audit and consumed format repair',async()=>{
 const s=await newOrgStore();const k=key();const before=await crashRun(s,k,'repair');expect(before.attemptCount).toBe(2);expect(JSON.stringify(before.attempts)).toContain('format_repair');
 let calls=2;const out=await runAiTask(baseArgs(s,k,{call:async()=>{calls++;return badJson()}}));const after=await db.aIRun.findUniqueOrThrow({where:{id:before.id}});
 note('L02',{calls,out,before:{attemptCount:before.attemptCount,attempts:before.attempts},after:{attemptCount:after.attemptCount,attempts:after.attempts}});
 expect((after.attempts as any[]).some(x=>x.attempt===1&&x.type==='format_repair')).toBe(true);
 expect((after.attempts as any[]).filter(x=>x.type==='format_repair')).toHaveLength(1);
},20000);
it('L03 recovered prior-day run charges the current attempt to current daily window',async()=>{
 const s=await newOrgStore({daily:'0.012',monthly:'100'});const k=key();const before=await crashRun(s,k,'first');
 // Represents a queued task claimed before Shanghai midnight, then recovered today.
 const yesterday=new Date(Date.now()-86400000);await db.aIRun.update({where:{id:before.id},data:{createdAt:yesterday}});
 let calls=1;const out=await runAiTask(baseArgs(s,k,{call:async()=>{calls++;return {content:JSON.stringify(validLlmPayload()),usage:{input_tokens:100,output_tokens:5000}}}}));
 const after=await db.aIRun.findUniqueOrThrow({where:{id:before.id}});const next=await runAiTask(argsWith(s,validLlmPayload()));
 note('L03',{calls,out,next,createdAt:after.createdAt,actual:after.actualCost,reserved:after.reservedCost});expect(out.status).toBe('succeeded');expect(next.status).toBe('skipped');
},20000);
it('K02 three real processes preserve global concurrency two',async()=>{
 const stores=await Promise.all([newOrgStore(),newOrgStore(),newOrgStore()]);const dir=mkdtempSync(join(tmpdir(),'t017r3-parallel-'));const cfg=join(dir,'cfg.json');writeFileSync(cfg,JSON.stringify({dir,stores,payload:validLlmPayload()}));
 const procs=stores.map((_,i)=>spawn(process.execPath,['--import','tsx','tests/integration/t017r1-process.ts',cfg,String(i)],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:testUrl},stdio:['ignore','pipe','pipe']}));
 const dones=procs.map(proc=>new Promise<{code:number|null;output:string}>(resolve=>{let output='';proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);proc.on('close',code=>resolve({code,output}))}));
 try{const limit=Date.now()+10000;while(!stores.every((_,i)=>existsSync(join(dir,'ready-'+i)))){if(Date.now()>limit)throw Error('barrier timeout');await new Promise(r=>setTimeout(r,10));}writeFileSync(join(dir,'go'),'go');const exits=await Promise.all(dones);const events=readFileSync(join(dir,'events.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));let active=0,max=0;for(const e of events){active+=e.event==='start'?1:-1;max=Math.max(max,active)}note('K02',{exits,events,max});expect(exits.every(x=>x.code===0)).toBe(true);expect(max).toBeLessThanOrEqual(2);expect(events).toHaveLength(6)}finally{for(const proc of procs)if(proc.exitCode===null)proc.kill('SIGKILL');await Promise.all(dones)}
},20000);
