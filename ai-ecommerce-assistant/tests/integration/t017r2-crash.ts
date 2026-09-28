import { readFileSync,writeFileSync } from 'node:fs';
import { getPrismaClient } from '@/database/prisma';
import { runAiTask } from '@/ai/gateway';
async function main(){const [file,idx]=process.argv.slice(2);const c=JSON.parse(readFileSync(file,'utf8'));const db=getPrismaClient();await runAiTask({db,...c.s,kind:'insight',idempotencyKey:c.key,datasetVersion:1n,rulesetVersion:'rules-v1-init',visibilityScope:'business',systemPrompt:'只输出JSON',userPrompt:'核对证据',semantic:{whitelist:{evidenceIds:new Set(['EV-1']),skuIds:new Set(),metricIds:new Set(['units_sold'])}},transport:{call:async()=>{writeFileSync(c.dir+'/called-'+idx,'network call started');await new Promise(()=>{});return {content:JSON.stringify(c.payload),usage:null}}},timeoutMs:20000});await db.$disconnect()}
main().catch(e=>{console.error(e);process.exitCode=1});
