import {getPrismaClient,resetClientPool} from './src/database/prisma';
import {handleValidateTask} from './src/jobs/handlers/imports';
import {Client} from 'pg';
import {Readable} from 'node:stream';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {spoolUpload,readSpooledTextStrict,deleteObjectSafe,createImportTaskFromSpool} from './src/services/imports';
import {setOssClientForTests} from './src/storage/oss';
import {putObject,getObjectText,moveObject,setStorageRoot,deleteObject,getObjectStream} from './src/storage';
const T='/tmp/gate02-review5-20260926-siq330x3';process.env.STORAGE_DRIVER='oss'; Object.assign(process.env,{OSS_BUCKET:'review-injected-bucket',OSS_REGION:'oss-cn-test',OSS_ACCESS_KEY_ID:'review-not-a-real-key',OSS_ACCESS_KEY_SECRET:'review-not-a-real-secret'});setStorageRoot(T+'/oss-local-spool');
const objects=new Map<string,Buffer>(),calls:any[]=[];const read=(k:string)=>{if(!objects.has(k))throw Object.assign(new Error('NoSuchKey'),{code:'NoSuchKey'});return objects.get(k)!};
setOssClientForTests({async put(k,b){calls.push(['put',k]);objects.set(k,b)},async get(k){calls.push(['get',k]);return{content:read(k)}},async getStream(k){calls.push(['getStream',k]);return{stream:Readable.from([read(k)])}},async head(k){read(k)},async copy(t,f){calls.push(['copy',t,f]);objects.set(t,read(f))},async delete(k){calls.push(['delete',k]);objects.delete(k)}});
const results:any[]=[];
async function check(name:string,expected:any,fn:()=>Promise<any>){let actual;try{actual=await fn();assert.deepEqual(actual,expected);results.push({name,expected,actual,status:'PASS'})}catch(e:any){results.push({name,expected,actual,status:'FAIL',error:e.message})}}
async function main(){
await check('M04 isolated object adapter put/get/move works',true,async()=>{await putObject('test/a',Readable.from(['a,b\n1,2']));await moveObject('test/a','test/b');return await getObjectText('test/b')==='a,b\n1,2'});
let spool:any;
await check('M04 actual spool then strict read works with OSS',true,async()=>{spool=await spoolUpload(Readable.from(['a,b\n1,2']));return await readSpooledTextStrict(spool.tempKey)==='a,b\n1,2'});
await check('M04 failed upload cleanup removes local temporary object',true,async()=>{await deleteObjectSafe(spool.tempKey);return !existsSync(T+'/oss-local-spool/'+spool.tempKey)});

const a=JSON.parse(readFileSync(T+'/actors-private.json','utf8')),db=getPrismaClient();
const text=readFileSync('tests/fixtures/golden/store-a/products.csv','utf8').replaceAll('XM-DEMO-A','G2-STORE').replaceAll('P1','OSS-REVIEW-3');
const ctx={db,orgId:a.owner.orgId,userId:a.owner.userId,role:'owner' as const};
await check('M04 real service spool strictread promote ledger worker stream download chain',{status:'preview_ready',valid:2,localTemp:false,bodyMatches:true,remote:true},async()=>{
 const s=await spoolUpload(Readable.from([text]));await readSpooledTextStrict(s.tempKey);
 const r=await createImportTaskFromSpool(ctx,{storeId:a.storeId,dataSourceId:a.sourceId,sourceKind:'products',filename:'oss.csv',bytes:s.bytes,sha256:s.sha256,dataRows:s.dataRows,endpoint:'/api/v1/imports',httpKey:'oss-review-three'},s.tempKey);
 const parsed=await handleValidateTask({taskId:r.id});const task=await db.importTask.findUniqueOrThrow({where:{id:r.id}});
 let got='';for await(const c of getObjectStream(task.rawObjectKey) as any)got+=c.toString();
 return{status:parsed.status,valid:parsed.valid,localTemp:existsSync(T+'/oss-local-spool/'+s.tempKey),bodyMatches:got===text,remote:objects.has(task.rawObjectKey)};
});
await check('M04 H08 OSS task transaction failure removes unowned remote file',{threw:true,localTemp:false,newRemote:0,newTask:0},async()=>{
 const pg=new Client({connectionString:process.env.DATABASE_URL});await pg.connect();const before=[...objects.keys()];let threw=false;
 const s=await spoolUpload(Readable.from([text.replaceAll('OSS-REVIEW-3','OSS-FAULT-3')]));
 await pg.query('ALTER TABLE http_idempotency ADD CONSTRAINT reviewer_oss_fail CHECK(false) NOT VALID');
 try{await createImportTaskFromSpool(ctx,{storeId:a.storeId,dataSourceId:a.sourceId,sourceKind:'products',filename:'oss-fail.csv',bytes:s.bytes,sha256:s.sha256,dataRows:s.dataRows,endpoint:'/api/v1/imports',httpKey:'oss-fault-three'},s.tempKey)}catch{threw=true}finally{await pg.query('ALTER TABLE http_idempotency DROP CONSTRAINT reviewer_oss_fail');await pg.end()}
 return{threw,localTemp:existsSync(T+'/oss-local-spool/'+s.tempKey),newRemote:[...objects.keys()].filter(k=>!before.includes(k)).length,newTask:await db.importTask.count({where:{storeId:a.storeId,fileSha256:s.sha256}})};
});
await db.$disconnect();await resetClientPool();
writeFileSync(T+'/evidence/oss-assertions.json',JSON.stringify({results,calls,localSpoolExists:existsSync(T+'/oss-local-spool/'+spool.tempKey),note:'Injected client is a memory-backed object store; no cloud credentials or cloud requests used.'},null,2));console.log(results);process.exit(results.some(r=>r.status==='FAIL')?1:0);

}
main().catch(e=>{console.error(e);process.exit(2)});
