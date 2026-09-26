import http from 'node:http';import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';import assert from 'node:assert/strict';import {getPrismaClient,resetClientPool} from './src/database/prisma';
const T='/tmp/gate02-review4-20260926-t6xh05db',a=JSON.parse(readFileSync(T+'/actors-private.json','utf8')),B=process.env.BETTER_AUTH_URL!,rs:any[]=[],db=getPrismaClient();
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms)),tmp=()=>existsSync(T+'/private/tmp')?readdirSync(T+'/private/tmp'):[];
async function test(mode:string){await db.authRateLimit.deleteMany();const before=tmp(),tasks=await db.importTask.count();const boundary='review-interrupt-3';
 const result:any=await new Promise(resolve=>{let done=false;const finish=(data:any)=>{if(done)return;done=true;clearTimeout(timer);resolve(data);req.destroy()};const req=http.request(B+'/api/v1/imports',{method:'POST',headers:{cookie:a.owner.cookie,origin:B,'content-type':'multipart/form-data; boundary='+boundary}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let body:any;try{body=JSON.parse(text)}catch{}finish({status:res.statusCode,code:body?.error?.code})})});req.on('error',e=>finish({clientError:e.message}));const timer=setTimeout(()=>finish({timeout:true}),3000);
 const fields=[['store_id',a.storeId],['data_source_id',a.sourceId],['entity_type','products']].map(([k,v])=>`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
 req.write(fields+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cut.csv"\r\n\r\na,b\n1,2\n`);
 setTimeout(()=>{if(mode==='socket-abort'){req.destroy();finish({aborted:true})}else req.end()},150);
 });
 await delay(400);let health=0;try{health=(await fetch(B+'/api/health',{signal:AbortSignal.timeout(2000)})).status}catch{}
 const actual={...result,newTemporaryFiles:tmp().filter(x=>!before.includes(x)).length,newTasks:(await db.importTask.count())-tasks,health};
 const expected={controlledRejectionOrClientAbort:true,newTemporaryFiles:0,newTasks:0,health:200};let status='PASS',error;
 try{assert.equal(mode==='socket-abort'?result.aborted===true:result.status>=400&&result.status<500,true);assert.equal(actual.newTemporaryFiles,0);assert.equal(actual.newTasks,0);assert.equal(health,200)}catch(e:any){status='FAIL';error=e.message}
 rs.push({name:'H06 H08 real HTTP '+mode+' cleanup',expected,actual,status,error});writeFileSync(T+'/evidence/http-interruption-assertions.json',JSON.stringify(rs,null,2));console.log(mode,status,actual);
}
async function main(){await test('truncated-form');await test('socket-abort');await db.$disconnect();await resetClientPool();process.exit(rs.some(x=>x.status==='FAIL')?1:0)}main().catch(e=>{console.error(e);process.exit(2)});
