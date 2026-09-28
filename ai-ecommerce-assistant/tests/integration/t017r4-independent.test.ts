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
afterAll(()=>writeFileSync(process.env.PROBE_OUTPUT!.replace('observations.json','r4-observations.json'),JSON.stringify(observations,(_k,v)=>typeof v==='bigint'?v.toString():v,2)));
const key=()=>randomUUID();
const argsWith=(s:{orgId:string;storeId:string},p:unknown)=>baseArgs(s,key(),stubTransport([()=>ok(p)]));
const vocArgs=(s:{orgId:string;storeId:string},span:unknown[],sentiment='neutral')=>{
 const p={taxonomy_version:'voc-v1',results:[{message_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',label:'refund_process',secondary_labels:[],sentiment,evidence_spans:span}]};
 expect(validateVocBatch(p)).toBe(true);
 return {...argsWith(s,p),kind:'voc_classification' as const,semantic:{voc:{batchMessageIds:new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),normalizedTexts:new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','退货']]),taxonomyVersion:'voc-v1'}}};
};

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

async function crashRun(s:{orgId:string;storeId:string},callerKey:string,mode:string){
 const dir=mkdtempSync(join(tmpdir(),'t017r3-crash-'));const cfg=join(dir,'cfg.json');writeFileSync(cfg,JSON.stringify({dir,s,key:callerKey,mode}));
 const proc=spawn(process.execPath,['--import','tsx','tests/integration/t017r3-crash.ts',cfg],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:testUrl},stdio:['ignore','pipe','pipe']});
 let output='';proc.stdout.on('data',b=>output+=b.toString());proc.stderr.on('data',b=>output+=b.toString());const done=new Promise(resolve=>proc.on('close',(code,signal)=>resolve({code,signal,output})));
 try {const limit=Date.now()+10000;while(!existsSync(join(dir,'called'))){if(Date.now()>limit)throw Error('child did not reach marker '+output);await new Promise(r=>setTimeout(r,10));}}
 finally {proc.kill('SIGKILL');await done;}
 return db.aIRun.findFirstOrThrow({where:{orgId:s.orgId}});
}

// Legal prior-window crash state: move BOTH run and original claim timestamps.
async function pendingInPriorWindow(monthly: boolean) {
 const s=await newOrgStore(monthly?{daily:'20',monthly:'0.012'}:{daily:'0.012',monthly:'100'});
 const k=key();const before=await crashRun(s,k,'first');
 const prior=new Date(Date.now()-(monthly?40:1)*86400000);
 await db.aIRun.update({where:{id:before.id},data:{createdAt:prior}});
 await db.aiAttemptLedger.updateMany({where:{runId:before.id},data:{createdAt:prior}});
 let recoverCalls=0;
 const recovered=await runAiTask(baseArgs(s,k,{call:async()=>{recoverCalls++;return {content:JSON.stringify(validLlmPayload()),usage:null}}}));
 const ledger=await db.aiAttemptLedger.findMany({where:{runId:before.id},orderBy:{attemptNo:'asc'}});
 let nextCalls=0;
 const next=await runAiTask(baseArgs(s,key(),{call:async()=>{nextCalls++;return ok(validLlmPayload())}}));
 const id=monthly?'N02':'N01';note(id,{recovered,recoverCalls,ledger,next,nextCalls});
 expect(recovered.status).toBe('succeeded');expect(recoverCalls).toBe(1);
 expect(next.status).toBe('skipped');expect(nextCalls).toBe(0);
}
it('N01 current-day unknown usage on recovered old run must retain current-day reservation',()=>pendingInPriorWindow(false),20000);
it('N02 current-month unknown usage on recovered old run must retain current-month reservation',()=>pendingInPriorWindow(true),20000);
it('N03 first post-upgrade ledger claim must not erase pre-ledger actual and unresolved costs',async()=>{
 const s=await newOrgStore({daily:'0.022',monthly:'100'});const k=key();const before=await crashRun(s,k,'repair');
 // Persisted pre-ledger R3 state: paid malformed attempt plus a crashed repair reserve.
 // Removing only this test run ledger represents applying the new empty-table migration to an old row.
 expect(before.attemptCount).toBe(2);expect(before.actualCost!.gt(0)).toBe(true);expect(before.reservedCost.gt(0)).toBe(true);
 await db.aiAttemptLedger.deleteMany({where:{runId:before.id}});
 const recovered=await runAiTask(baseArgs(s,k,{call:async()=>({content:JSON.stringify(validLlmPayload()),usage:{input_tokens:100,output_tokens:5000}})}));
 const after=await db.aIRun.findUniqueOrThrow({where:{id:before.id}});const ledger=await db.aiAttemptLedger.findMany({where:{runId:before.id}});
 let nextCalls=0;const next=await runAiTask(baseArgs(s,key(),{call:async()=>{nextCalls++;return ok(validLlmPayload())}}));
 note('N03',{before:{actual:before.actualCost,reserved:before.reservedCost,attemptCount:before.attemptCount},recovered,after:{actual:after.actualCost,reserved:after.reservedCost},ledger,next,nextCalls});
 expect(recovered.status).toBe('succeeded');expect(after.actualCost!.add(after.reservedCost).gt('0.012996')).toBe(true);expect(next.status).toBe('skipped');expect(nextCalls).toBe(0);
},20000);
it('K03 old settled actual remains in its original window without blocking current day',async()=>{
 const s=await newOrgStore({daily:'0.012',monthly:'100'});const first=await runAiTask(baseArgs(s,key(),{call:async()=>({content:JSON.stringify(validLlmPayload()),usage:{input_tokens:100,output_tokens:5000}})}));
 const prior=new Date(Date.now()-86400000);await db.aIRun.update({where:{id:first.runId},data:{createdAt:prior}});await db.aiAttemptLedger.updateMany({where:{runId:first.runId},data:{createdAt:prior}});
 const next=await runAiTask(argsWith(s,validLlmPayload()));note('K03',{first,next});expect(next.status).toBe('succeeded');
});
it('K04 current same-window null usage remains reserved and blocks new calls',async()=>{
 const s=await newOrgStore({daily:'0.012',monthly:'100'});const first=await runAiTask(baseArgs(s,key(),{call:async()=>({content:JSON.stringify(validLlmPayload()),usage:null})}));
 const next=await runAiTask(argsWith(s,validLlmPayload()));note('K04',{first,next});expect(next.status).toBe('skipped');
});
