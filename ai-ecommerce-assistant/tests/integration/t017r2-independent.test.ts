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
afterAll(()=>writeFileSync(process.env.PROBE_OUTPUT!.replace('observations.json','r2-observations.json'),JSON.stringify(observations,(_k,v)=>typeof v==='bigint'?v.toString():v,2)));
const key=()=>randomUUID();
const argsWith=(s:{orgId:string;storeId:string},p:unknown)=>baseArgs(s,key(),stubTransport([()=>ok(p)]));
const vocArgs=(s:{orgId:string;storeId:string},span:unknown[],sentiment='neutral')=>{
 const p={taxonomy_version:'voc-v1',results:[{message_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',label:'refund_process',secondary_labels:[],sentiment,evidence_spans:span}]};
 expect(validateVocBatch(p)).toBe(true);
 return {...argsWith(s,p),kind:'voc_classification' as const,semantic:{voc:{batchMessageIds:new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),normalizedTexts:new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','退货']]),taxonomyVersion:'voc-v1'}}};
};

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
it('J01 global concurrency stays at most two across organizations',async()=>{
 const stores=await Promise.all([newOrgStore(),newOrgStore(),newOrgStore()]);let active=0,max=0;const events:any[]=[];
 const transport={call:async()=>{active++;max=Math.max(max,active);events.push({event:'start',active,at:Date.now()});await new Promise(r=>setTimeout(r,200));active--;events.push({event:'end',active,at:Date.now()});return ok(validLlmPayload())}};
 const out=await Promise.all(stores.map(s=>runAiTask(baseArgs(s,key(),transport))));note('J01',{max,events,out});expect(max).toBeLessThanOrEqual(2);
});
it('J02 crash recovery preserves attempt claims before network side effects',async()=>{
 const s=await newOrgStore();const dir=mkdtempSync(join(tmpdir(),'t017r2-crash-'));const cfg=join(dir,'cfg.json');const callerKey=key();
 writeFileSync(cfg,JSON.stringify({dir,s,key:callerKey,payload:validLlmPayload()}));const rows:any[]=[];const exits:any[]=[];
 for(let i=0;i<3;i++){
  const proc=spawn(process.execPath,['--import','tsx','tests/integration/t017r2-crash.ts',cfg,String(i)],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:testUrl},stdio:['ignore','pipe','pipe']});
  let output='';proc.stdout.on('data',b=>output+=b.toString());proc.stderr.on('data',b=>output+=b.toString());const done=new Promise(resolve=>proc.on('close',(code,signal)=>resolve({code,signal,output})));
  try {const limit=Date.now()+8000;while(!existsSync(join(dir,'called-'+i))){if(Date.now()>limit)throw Error('child failed before network marker: '+output);await new Promise(r=>setTimeout(r,10));}
   const row=await db.aIRun.findFirstOrThrow({where:{orgId:s.orgId}});rows.push({status:row.status,attemptCount:row.attemptCount,reserved:row.reservedCost});
  } finally {proc.kill('SIGKILL');exits.push(await done)}
 }
 let calls=3;const a=baseArgs(s,callerKey,{call:async()=>{calls++;return ok(validLlmPayload())}});a.systemPrompt='只输出JSON';a.userPrompt='核对证据';
 const out=await runAiTask(a);const stored=await db.aIRun.findFirstOrThrow({where:{orgId:s.orgId}});note('J02',{calls,rows,exits,out,stored:{attemptCount:stored.attemptCount,reserved:stored.reservedCost,actual:stored.actualCost}});expect(calls).toBeLessThanOrEqual(3);
},30000);
it('J03 paid invalid first response must count before repair reservation',async()=>{
 const s=await newOrgStore({daily:'0.012',monthly:'100'});let calls=0;
 const out=await runAiTask(baseArgs(s,key(),{call:async()=>{calls++;return {content:'{"bad":true}',usage:{input_tokens:100,output_tokens:5000}}}}));
 const row=await db.aIRun.findUniqueOrThrow({where:{id:out.runId}});note('J03',{calls,out,actual:row.actualCost,reserved:row.reservedCost,billing:row.billingStatus});expect(calls).toBe(1);
});
it('J04 success after timeout must retain unknown reservation in spent sum',async()=>{
 const s=await newOrgStore({daily:'0.022',monthly:'100'});let calls=0;
 const out=await runAiTask(baseArgs(s,key(),{call:async()=>{calls++;if(calls===1)throw new ModelTransportError('TIMEOUT',true);return {content:JSON.stringify(validLlmPayload()),usage:{input_tokens:100,output_tokens:5000}}}}));
 const row=await db.aIRun.findUniqueOrThrow({where:{id:out.runId}});const next=await runAiTask(argsWith(s,validLlmPayload()));note('J04',{calls,out,next,actual:row.actualCost,reserved:row.reservedCost,billing:row.billingStatus});expect(next.status).toBe('skipped');
});
it('J05 missing usage on success must not erase reservation from budget',async()=>{
 const s=await newOrgStore({daily:'0.012',monthly:'100'});const out=await runAiTask(baseArgs(s,key(),{call:async()=>({content:JSON.stringify(validLlmPayload()),usage:null})}));
 const row=await db.aIRun.findUniqueOrThrow({where:{id:out.runId}});const next=await runAiTask(argsWith(s,validLlmPayload()));note('J05',{out,next,actual:row.actualCost,reserved:row.reservedCost,billing:row.billingStatus});expect(next.status).toBe('skipped');
});
it('J06 nonretryable terminal auth failure remains terminal on redelivery',async()=>{
 const s=await newOrgStore();let calls=0;const a=baseArgs(s,key(),{call:async()=>{calls++;throw new ModelTransportError('AUTH_ERROR',false,401)}});
 const x=await runAiTask(a),y=await runAiTask(a);note('J06',{calls,x,y});expect(calls).toBe(1);
});
it('J07 semantic error summary cannot persist or resend synthetic private text',async()=>{
 const s=await newOrgStore();const marker='synthetic-r2@example.com';const p=validLlmPayload({evidence_ids:[marker]});expect(validateLlmPayload(p)).toBe(true);const prompts:string[]=[];
 const out=await runAiTask(baseArgs(s,key(),{call:async req=>{prompts.push(req.userPrompt);return ok(p)}}));const row=await db.aIRun.findUniqueOrThrow({where:{id:out.runId}});
 note('J07',{out,prompts,attempts:row.attempts});expect(JSON.stringify(row.attempts)).not.toContain(marker);expect(prompts.slice(1).join('')).not.toContain(marker);
});
it('K01 current allowed insight refs remain valid',async()=>{const s=await newOrgStore();const out=await runAiTask(argsWith(s,validLlmPayload()));note('K01',out);expect(out.status).toBe('succeeded')});
