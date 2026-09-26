import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {getPrismaClient,resetClientPool} from './src/database/prisma';
const T='/tmp/aiea-g2-review-h99ruviq',B='http://127.0.0.1:3322',a=JSON.parse(readFileSync(T+'/actors-private.json','utf8')),db=getPrismaClient();
async function req(path:string,method:string,body:any,origin=B){const r=await fetch(B+path,{method,headers:{cookie:a.owner.cookie,origin,...(body instanceof FormData?{}:{'content-type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
function form(store=a.storeId,source=a.sourceId,content:any='bad\nvalue',filename='test.csv'){const f=new FormData();f.set('store_id',store);f.set('data_source_id',source);f.set('source_kind','products');f.set('file',new File([content],filename,{type:'text/csv'}));return f;}
async function main(){const tag=randomUUID(),out:any={};const name='Parallel '+tag;
 const c=await Promise.all(Array.from({length:3},(_,i)=>req('/api/v1/stores','POST',{name,external_store_id:'G2-X-'+tag+'-'+i,platform:'manual',currency:'CNY',timezone:'UTC'})));
 out.same_name_parallel={responses:c.map(r=>r.status),rows:await db.store.count({where:{orgId:a.owner.orgId,name}})};
 out.origin_foreign=await req('/api/v1/imports','POST',form(),'https://outside.example.test');
 out.invalid_utf8=await req('/api/v1/imports','POST',form(a.storeId,a.sourceId,Buffer.from([0x61,0x0a,0x80,0x0a])));
 const store=await db.store.create({data:{orgId:a.owner.orgId,name:'Demo '+tag,externalStoreId:tag,platform:'manual',currency:'CNY',timezone:'UTC',demoMode:true}});
 const src=await db.dataSource.create({data:{orgId:a.owner.orgId,storeId:store.id,sourceNamespace:'demo',name:'demo',adapterKind:'mock'}});
 out.mock_upload=await req('/api/v1/imports','POST',form(store.id,src.id));
 await db.store.update({where:{id:store.id},data:{status:'archived'}});
 out.archived_upload=await req('/api/v1/imports','POST',form(store.id,src.id));
 const normal=await db.importTask.findFirstOrThrow({where:{storeId:a.storeId,rawObjectKey:{not:''}}});
 const content=readFileSync(process.env.STORAGE_PRIVATE_ROOT+'/'+normal.rawObjectKey);
 const changedContent=Buffer.concat([content,Buffer.from('\n')]);
 const key='header-'+tag;
 async function headerUpload(bytes:Buffer){const r=await fetch(B+'/api/v1/imports',{method:'POST',headers:{cookie:a.owner.cookie,origin:B,'Idempotency-Key':key},body:form(a.storeId,a.sourceId,bytes)});return{status:r.status,body:await r.json()};}
 out.header_idempotency={first:await headerUpload(Buffer.concat([changedContent,Buffer.from('x')])),changed:await headerUpload(Buffer.concat([changedContent,Buffer.from('y')]))};
 writeFileSync(T+'/evidence/extra-probes.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));await db.$disconnect();await resetClientPool();}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
