import fs from 'node:fs';
import { PassThrough, Readable } from 'node:stream';
import { existsSync, readdirSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import assert from 'node:assert/strict';
import { spoolUpload, deleteObjectSafe } from './src/services/imports';
import { setStorageRoot } from './src/storage';
const T='/tmp/gate02-review3-20260925-8_hqanp6',root=T+'/stream-faults-expanded',results:any[]=[];
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const files=()=>existsSync(root+'/tmp')?readdirSync(root+'/tmp'):[];
async function check(name:string,expected:any,fn:()=>Promise<any>){let actual;try{actual=await fn();assert.deepEqual(actual,expected);results.push({name,expected,actual,status:'PASS'})}catch(e:any){results.push({name,expected,actual,status:'FAIL',error:e.message})}writeFileSync(T+'/evidence/stream-faults-assertions.json',JSON.stringify(results,null,2));console.log(name,results.at(-1).status)}
async function main(){setStorageRoot(root);
 await check('H06 normal spool cleanup control',{rows:1,files:0},async()=>{const s=await spoolUpload(Readable.from(['a,b\n1,2\n']));await deleteObjectSafe(s.tempKey);return{rows:s.dataRows,files:files().length}});
 await check('H06 H08 input error cleans partial spool and invokes abort',{code:'UPLOAD_INTERRUPTED',newFiles:0,abortCalls:1},async()=>{
  const before=files();let abortCalls=0;const stream=new PassThrough();const p=spoolUpload(stream,()=>abortCalls++).then(()=>({code:'UNEXPECTED_SUCCESS'}),(e:any)=>({code:e.code}));
  stream.write('a,b\n1,2\n');for(let i=0;i<100&&!files().some(x=>!before.includes(x));i++)await delay(10);await delay(40);
  stream.destroy(new Error('review injected client disconnect'));
  const r=await Promise.race([p,delay(2000).then(()=>({code:'UNSETTLED'}))]);await delay(80);
  return {...r,newFiles:files().filter(x=>!before.includes(x)).length,abortCalls};
 });
 await check('H06 early invalid CSV closes input and cleans file',{code:'INVALID_CSV',newFiles:0,abortCalls:1},async()=>{
  const before=files();let abortCalls=0;const stream=new PassThrough();const p=spoolUpload(stream,()=>abortCalls++).then(()=>({code:'UNEXPECTED_SUCCESS'}),(e:any)=>({code:e.code}));
  stream.write('a,b\n"bad"invalid,x\n');
  const r=await Promise.race([p,delay(2000).then(()=>({code:'UNSETTLED'}))]);await delay(100);stream.destroy();
  return {...r,newFiles:files().filter(x=>!before.includes(x)).length,abortCalls};
 });
 await check('H08 open input EACCES controlled failure',{code:'STORAGE_WRITE_FAILED',abortCalls:1},async()=>{
  const blocked=T+'/unwritable';mkdirSync(blocked+'/tmp',{recursive:true});chmodSync(blocked+'/tmp',0o500);setStorageRoot(blocked);let abortCalls=0;
  const stream=new Readable({read(){this.push('a,b\n1,2');this._read=()=>{};}});
  try{return await Promise.race([spoolUpload(stream,()=>abortCalls++).then(()=>({code:'UNEXPECTED_SUCCESS',abortCalls}),(e:any)=>({code:e.code,abortCalls})),delay(2000).then(()=>({code:'UNSETTLED',abortCalls}))])}finally{stream.destroy();chmodSync(blocked+'/tmp',0o700);setStorageRoot(root)}
 });

 await check('H08 injected ENOSPC on open input is handled and cleans file',{code:'STORAGE_WRITE_FAILED',newFiles:0,abortCalls:1},async()=>{
  const before=files();let abortCalls=0;const stream=new PassThrough();const original=fs.write;
  (fs as any).write=(...args:any[])=>{const cb=args.at(-1);queueMicrotask(()=>cb(Object.assign(new Error('review injected disk full'),{code:'ENOSPC'})))};
  try{const p=spoolUpload(stream,()=>abortCalls++).then(()=>({code:'UNEXPECTED_SUCCESS'}),(e:any)=>({code:e.code}));stream.write('a,b\n1,2\n');const r=await Promise.race([p,delay(2000).then(()=>({code:'UNSETTLED'}))]);await delay(80);return{...r,newFiles:files().filter(x=>!before.includes(x)).length,abortCalls}}finally{fs.write=original;stream.destroy()}
 });
 process.exit(results.some(x=>x.status==='FAIL')?1:0);
}
main().catch(e=>{console.error(e);process.exit(2)});
