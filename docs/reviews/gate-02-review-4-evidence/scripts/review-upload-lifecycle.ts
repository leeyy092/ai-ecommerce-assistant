import http from 'node:http';
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {getPrismaClient,resetClientPool} from './src/database/prisma';
import {FILE_HEADERS} from './src/adapters/contracts';
const T='/tmp/gate02-review4-20260926-t6xh05db',a=JSON.parse(readFileSync(T+'/actors-private.json','utf8')),B=process.env.BETTER_AUTH_URL!,db=getPrismaClient(),rs:any[]=[];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const tmp=()=>existsSync(T+'/private/tmp')?readdirSync(T+'/private/tmp'):[];
async function test(mode:string){
 await db.authRateLimit.deleteMany();const before=tmp(),tasks=await db.importTask.count(),boundary='review4-after-file-'+mode;
 const csv=FILE_HEADERS.products.join(',')+'\n'+['G2-STORE','2026-09-11T00:00:00Z','late-'+mode,'Product','','active','late-'+mode,'SKU-'+mode,'Name','','active'].join(',');
 const first=[['store_id',a.storeId],['data_source_id',a.sourceId],['entity_type','products']].map(([k,v])=>`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
 const actual:any=await new Promise(resolve=>{
  let done=false,hadSpool=false; const finish=(r:any)=>{if(done)return;done=true;clearTimeout(timer);resolve({...r,hadSpoolBeforeTermination:hadSpool});req.destroy();};
  const req=http.request(B+'/api/v1/imports',{method:'POST',headers:{cookie:a.owner.cookie,origin:B,'content-type':'multipart/form-data; boundary='+boundary}},res=>{let t='';res.on('data',c=>t+=c);res.on('end',()=>{let b:any;try{b=JSON.parse(t)}catch{}finish({status:res.statusCode,code:b?.error?.code});});});
  req.on('error',e=>finish({clientError:e.message}));const timer=setTimeout(()=>finish({timeout:true}),4000);
  // File part is fully terminated. A later text part remains open. File spool may already resolve.
  req.write(first+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="complete.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nincomplete-tail`);
  setTimeout(()=>{hadSpool=tmp().some(x=>!before.includes(x));if(mode==='valid-tail'){req.end(`\r\n--${boundary}--\r\n`)}else if(mode==='socket-abort'){req.destroy();finish({aborted:true})}else req.end()},350);
 });
 await delay(500);actual.newTemporaryFiles=tmp().filter(x=>!before.includes(x)).length;actual.newTasks=(await db.importTask.count())-tasks;actual.health=(await fetch(B+'/api/health',{signal:AbortSignal.timeout(2000)})).status;
 const expected={controlledResponse:true,newTemporaryFiles:0,newTasks:mode==='valid-tail'?1:0,health:200};let status='PASS',error;
 try{assert.equal(mode==='valid-tail'?actual.status===201:mode==='socket-abort'?actual.aborted===true:actual.status>=400&&actual.status<500,true);assert.equal(actual.newTemporaryFiles,0);assert.equal(actual.newTasks,expected.newTasks);assert.equal(actual.health,200)}catch(e:any){status='FAIL';error=e.message}
 rs.push({name:'Completed file before later multipart '+mode,expected,actual,status,error});writeFileSync(T+'/evidence/upload-lifecycle-assertions.json',JSON.stringify(rs,null,2));console.log(mode,status,actual);
}
async function main(){await test('valid-tail');await test('truncated-tail');await test('socket-abort');await db.$disconnect();await resetClientPool();process.exit(rs.some(x=>x.status==='FAIL')?1:0)}main().catch(e=>{console.error(e);process.exit(2)});
