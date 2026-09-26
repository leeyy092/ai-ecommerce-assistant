import {Readable} from 'node:stream';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {spoolUpload,readSpooledTextStrict,deleteObjectSafe} from './src/services/imports';
import {setOssClientForTests} from './src/storage/oss';
import {putObject,getObjectText,moveObject,setStorageRoot} from './src/storage';
const T='/tmp/aiea-g2r2-9hnwja_c';process.env.STORAGE_DRIVER='oss';setStorageRoot(T+'/oss-local-spool');
const objects=new Map<string,Buffer>(),calls:any[]=[];const read=(k:string)=>{if(!objects.has(k))throw Object.assign(new Error('NoSuchKey'),{code:'NoSuchKey'});return objects.get(k)!};
setOssClientForTests({async put(k,b){calls.push(['put',k]);objects.set(k,b)},async get(k){calls.push(['get',k]);return{content:read(k)}},async getStream(k){calls.push(['getStream',k]);return{stream:Readable.from([read(k)])}},async head(k){read(k)},async copy(t,f){calls.push(['copy',t,f]);objects.set(t,read(f))},async delete(k){calls.push(['delete',k]);objects.delete(k)}});
const results:any[]=[];
async function check(name:string,expected:any,fn:()=>Promise<any>){let actual;try{actual=await fn();assert.deepEqual(actual,expected);results.push({name,expected,actual,status:'PASS'})}catch(e:any){results.push({name,expected,actual,status:'FAIL',error:e.message})}}
async function main(){
await check('M04 isolated object adapter put/get/move works',true,async()=>{await putObject('test/a',Readable.from(['a,b\n1,2']));await moveObject('test/a','test/b');return await getObjectText('test/b')==='a,b\n1,2'});
let spool:any;
await check('M04 actual spool then strict read works with OSS',true,async()=>{spool=await spoolUpload(Readable.from(['a,b\n1,2']));return await readSpooledTextStrict(spool.tempKey)==='a,b\n1,2'});
await check('M04 failed upload cleanup removes local temporary object',true,async()=>{await deleteObjectSafe(spool.tempKey);return !existsSync(T+'/oss-local-spool/'+spool.tempKey)});
writeFileSync(T+'/evidence/oss-assertions.json',JSON.stringify({results,calls,localSpoolExists:existsSync(T+'/oss-local-spool/'+spool.tempKey),note:'Injected client is a memory-backed object store; no cloud credentials or cloud requests used.'},null,2));console.log(results);process.exit(results.some(r=>r.status==='FAIL')?1:0);

}
main().catch(e=>{console.error(e);process.exit(2)});
