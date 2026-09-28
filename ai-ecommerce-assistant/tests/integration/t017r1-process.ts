import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getPrismaClient, resetClientPool } from '@/database/prisma';
import { runAiTask } from '@/ai/gateway';
async function main(){
const [cfgPath,idx]=process.argv.slice(2);
const c=JSON.parse(readFileSync(cfgPath,'utf8'));
const db=getPrismaClient();
writeFileSync(`${c.dir}/ready-${idx}`,'ready');
const deadline=Date.now()+10000;
while(!existsSync(`${c.dir}/go`)){if(Date.now()>deadline)throw Error('test barrier timeout');await new Promise(r=>setTimeout(r,10))}
try{
const r=await runAiTask({db,...c.stores[Number(idx)],kind:'insight',idempotencyKey:randomUUID(),datasetVersion:1n,rulesetVersion:'rules-v1-init',visibilityScope:'business',systemPrompt:'只输出JSON',userPrompt:'核对证据',semantic:{whitelist:{evidenceIds:new Set(['EV-1']),skuIds:new Set(),metricIds:new Set(['units_sold'])}},transport:{call:async()=>{
 appendFileSync(`${c.dir}/events.jsonl`,JSON.stringify({idx,event:'start',at:Date.now()})+'\n');await new Promise(r=>setTimeout(r,500));appendFileSync(`${c.dir}/events.jsonl`,JSON.stringify({idx,event:'end',at:Date.now()})+'\n');return {content:JSON.stringify(c.payload),usage:{input_tokens:100,output_tokens:50}};
}},timeoutMs:5000});console.log(JSON.stringify(r));
} finally {await db.$disconnect();await resetClientPool()}

}
main().catch(e=>{console.error(e);process.exitCode=1});
