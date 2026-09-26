import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {Client} from 'pg';
import {getPrismaClient,resetClientPool} from './src/database/prisma';
import {createImportTaskFromBuffer} from './src/services/imports';
import {enqueueValidate,getBoss,QUEUE_COMMIT} from './src/jobs/queue';
import {getObjectText} from './src/storage';
const T='/tmp/aiea-g2-review-h99ruviq';
const actors=JSON.parse(readFileSync(T+'/actors-private.json','utf8'));
const db=getPrismaClient(),pg=new Client({connectionString:process.env.DATABASE_URL});
const ctx={db,orgId:actors.owner.orgId,userId:actors.owner.userId,role:'owner'};
const input={storeId:actors.storeId,dataSourceId:actors.sourceId,sourceKind:'products' as const,filename:'review-worker.csv'};
const source=readFileSync('tests/fixtures/golden/store-a/products.csv','utf8').replaceAll('XM-DEMO-A','G2-STORE');
const out:any={}; const runTag=Date.now().toString();
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function task(label:string,text:string){return createImportTaskFromBuffer(ctx,input,Readable.from([text.replaceAll('P1','P-'+label+runTag).replace('bad_header','bad_header'+runTag)]));}
async function row(id:string){const r=await db.importTask.findUniqueOrThrow({where:{id}});const q=(await pg.query("SELECT state,retry_count,output FROM pgboss.job WHERE data->>'taskId'=$1 ORDER BY created_on DESC",[id])).rows;return {id,status:r.status,valid:r.validCount,errors:r.errorCount,error_code:r.errorCode,error_key:r.errorObjectKey,queue:q};}
async function start(label:string,env:any){const fd=openSync(T+'/evidence/'+label+'.log','w');const p=spawn(process.execPath,['dist/jobs/worker.js'],{env,stdio:['ignore',fd,fd]});closeSync(fd);return p;}
async function stop(p:any){p.kill('SIGTERM');await new Promise<void>(r=>{p.once('exit',()=>r());setTimeout(()=>{p.kill('SIGKILL');r();},2000).unref()});}
async function main(){
 await pg.connect();
 await pg.query("UPDATE pgboss.job SET state='cancelled' WHERE state IN ('created','retry')");
 const good=await task('good',source),bad=await task('bad','bad_header\nvalue'),missing=await task('missing',source),revoked=await task('revoked',source);
 await db.importTask.update({where:{id:missing.id},data:{rawObjectKey:'raw/review-missing/source.csv'}});
 await db.importTask.update({where:{id:revoked.id},data:{createdBy:actors.op.userId}});
 await db.membership.updateMany({where:{orgId:actors.owner.orgId,userId:actors.op.userId},data:{status:'disabled'}});
 for(const t of [good,bad,missing,revoked])await enqueueValidate(t.id);
 const boss=await getBoss();const commitId=await boss.send(QUEUE_COMMIT,{taskId:good.id},{retryLimit:0});
 const w=await start('worker-built',{...process.env});
 try {for(let i=0;i<60;i++){await wait(500);const r=await row(missing.id);if(r.queue[0]?.state==='completed'&&(await row(revoked.id)).queue[0]?.state==='completed')break;}
 out.normal=await row(good.id);out.invalid_header=await row(bad.id);out.transient_file_failure=await row(missing.id);out.revoked_before_execute=await row(revoked.id);
 if(out.invalid_header.error_key)out.invalid_header.private_error_csv=await getObjectText(out.invalid_header.error_key);
 out.commit_boundary=(await pg.query('SELECT state,output FROM pgboss.job WHERE id=$1',[commitId])).rows;
 }finally{await stop(w);}
 const composeTask=await task('compose',source);await enqueueValidate(composeTask.id);
 const noAuth:any={...process.env};delete noAuth.BETTER_AUTH_SECRET;delete noAuth.BETTER_AUTH_URL;noAuth.STORAGE_PRIVATE_ROOT=T+'/worker-separate-private';
 const cw=await start('worker-compose-environment',noAuth);
 try{for(let i=0;i<40;i++){await wait(500);if((await row(composeTask.id)).queue[0]?.state==='completed')break;}out.compose_environment=await row(composeTask.id);}finally{await stop(cw);}
 await db.membership.updateMany({where:{orgId:actors.owner.orgId,userId:actors.op.userId},data:{status:'active'}});
 writeFileSync(T+'/evidence/worker-probes.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
 await boss.stop();await pg.end();await db.$disconnect();await resetClientPool();
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
