import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {Readable} from 'node:stream';
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {getPrismaClient,resetClientPool} from './src/database/prisma';
import {getAuth} from './src/lib/auth';
import {initOwner} from './src/services/ownerInit';
import {FILE_HEADERS,parseCsv} from './src/adapters/contracts';
import {signDownload,setStorageRoot} from './src/storage';
import {createImportTaskFromBuffer,MAX_UPLOAD_BYTES} from './src/services/imports';
const T='/tmp/aiea-g2-review-h99ruviq',B='http://127.0.0.1:3322';
const out:any={checks:{}};const db=getPrismaClient();const auth=getAuth();
const pg=new Client({connectionString:process.env.DATABASE_URL});
const password='G2-'+randomBytes(16).toString('hex');
async function request(path:string,cookie:string,method='GET',body?:any){
 const headers:any={cookie,origin:B};let payload:any;
 if(body instanceof FormData)payload=body;else if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body);}
 const r=await fetch(B+path,{method,headers,body:payload});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={nonJSON:text.slice(0,200)}}
 return {status:r.status,body:data};
}
async function actor(role:string,orgId?:string){
 const email=`g2-${role}-${randomUUID()}@example.test`;
 let userId:string;
 if(!orgId){const r=await initOwner(db,{orgName:email,email,displayName:role,demoMode:false,password},async(email,password,name)=>({authUserId:(await auth.api.signUpEmail({body:{email,password,name}})).user.id}));orgId=r.orgId;userId=r.userId;}
 else {const u=await auth.api.signUpEmail({body:{email,password,name:role}});const d=await db.user.create({data:{authUserId:u.user.id,email,displayName:role}});userId=d.id;await db.membership.create({data:{orgId,userId,role:role as any}});}
 const r=await auth.api.signInEmail({body:{email,password},asResponse:true});assert.equal(r.status,200);const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return {orgId:orgId!,userId,cookie,email};
}
function csv(kind:string,id:string,store='G2-STORE'){
 const rows:any={products:[store,'2026-09-11T00:00:00Z',id,'Product','','active',id,'SKU-'+id,'Name','','active'],orders:[store,'2026-09-11T00:00:00Z',id,'paid','2026-09-01T00:00:00Z','2026-09-01T01:00:00Z','CNY','1'],customer_messages:[store,'2026-09-11T00:00:00Z',id,id,'2026-09-01T01:00:00Z','','Synthetic message','','platform_chat','en']};
 return FILE_HEADERS[kind as keyof typeof FILE_HEADERS].join(',')+'\n'+rows[kind].join(',');
}
function form(storeId:string,sourceId:string,kind:string,text:string,field='source_kind',filename='test.csv',mime='text/csv',key?:string){const f=new FormData();f.set('store_id',storeId);f.set('data_source_id',sourceId);f.set(field,kind);f.set('file',new File([text],filename,{type:mime}));if(key)f.set('idempotency_key',key);return f;}
async function main(){
 await pg.connect();
 const owner=await actor('owner'),cs=await actor('customer_service',owner.orgId),op=await actor('operator',owner.orgId),admin=await actor('admin',owner.orgId),other=await actor('owner');
 const s=await request('/api/v1/stores',owner.cookie,'POST',{name:'G2 Store',external_store_id:'G2-STORE',platform:'amazon',currency:'CNY',timezone:'Asia/Shanghai'});assert.equal(s.status,201);const storeId=s.body.data.id;
 const ds=await request('/api/v1/data-sources',owner.cookie,'POST',{store_id:storeId,name:'G2 source',adapter_kind:'csv',source_namespace:'g2_source'});assert.equal(ds.status,201);const sourceId=ds.body.data.id;
 const store=await db.store.findUniqueOrThrow({where:{id:storeId}});out.checks.store_create={status:s.status,demo_inherited:!store.demoMode,audit:await db.auditLog.count({where:{entityId:storeId,action:'store_create'}})};
 const data={owner,cs,op,admin,other,storeId,sourceId};writeFileSync(T+'/actors-private.json',JSON.stringify(data),{mode:0o600});
 const upload=(actor:any,kind:string,text:string,field='source_kind',filename='test.csv',mime='text/csv',key?:string)=>request('/api/v1/imports',actor.cookie,'POST',form(storeId,sourceId,kind,text,field,filename,mime,key));
 out.checks.contract_entity_type=await upload(owner,'products',csv('products','contract'),'entity_type');
 const content=csv('products','normal');const good=await upload(owner,'products',content);assert.equal(good.status,201);const taskId=good.body.data.id;
 out.checks.normal_upload=good;
 out.checks.repeat_upload=await upload(owner,'products',content);
 out.checks.cs_order_forbidden=await upload(cs,'orders',csv('orders','forbidden'));
 const cm=await upload(cs,'customer_messages',csv('customer_messages','cs-own'));assert.equal(cm.status,201);
 const pm=await upload(op,'orders',csv('orders','op-own'));assert.equal(pm.status,201);
 out.checks.read_own_task={cs:{upload:cm.status,query:await request('/api/v1/imports/'+cm.body.data.id,cs.cookie)},operator:{upload:pm.status,query:await request('/api/v1/imports/'+pm.body.data.id,op.cookie)},admin_query:await request('/api/v1/imports/'+taskId,admin.cookie)};
 const t=await db.importTask.findUniqueOrThrow({where:{id:taskId}});const sig=signDownload(t.rawObjectKey,600);const filePath=`/api/v1/imports/${taskId}/file`;
 out.checks.unsigned=await request(filePath,owner.cookie);out.checks.expired=await request(filePath+`?expires=1&signature=${sig.signature}`,owner.cookie);
 const signed=await fetch(B+filePath+`?expires=${sig.expiresAt}&signature=${sig.signature}`,{headers:{cookie:owner.cookie}});out.checks.signed={status:signed.status,content_equal:(await signed.text())===content};
 const csTask=await db.importTask.findUniqueOrThrow({where:{id:cm.body.data.id}}),csSig=signDownload(csTask.rawObjectKey);
 out.checks.cs_signed_file=await request(`/api/v1/imports/${csTask.id}/file?expires=${csSig.expiresAt}&signature=${csSig.signature}`,cs.cookie);
 out.checks.cross_org={query:await request('/api/v1/imports/'+taskId,other.cookie),file:await request(filePath+`?expires=${sig.expiresAt}&signature=${sig.signature}`,other.cookie),sources:await request('/api/v1/data-sources?store_id='+storeId,other.cookie)};
 out.checks.public_file=await request('/.data/private/'+t.rawObjectKey,owner.cookie);
 out.checks.store_write_cs=await request('/api/v1/stores/'+storeId,cs.cookie,'PATCH',{name:'forbidden',expected_version:1});
 // Multiple historical versions and channels: latest values should not be added together.
 for(const v of [1n,2n])for(const [kind,count] of [['orders',v===1n?100n:120n],['customer_messages',v===1n?3n:4n]] as const){await db.dataCoverage.create({data:{orgId:owner.orgId,storeId,dataSourceId:sourceId,sourceKind:kind,channel:'default_channel',coverageDate:new Date('2026-09-01T00:00:00Z'),status:'complete',explicitZero:false,recordCount:count,datasetVersion:v,importTaskId:taskId}});}
 await db.store.update({where:{id:storeId},data:{datasetVersion:2n}});
 out.checks.coverage_cs=await request('/api/v1/data-sources?store_id='+storeId,cs.cookie);
 out.checks.coverage_owner=await request('/api/v1/data-sources?store_id='+storeId,owner.cookie);
 out.checks.coverage_to_exclusive=await request('/api/v1/data-sources?store_id='+storeId+'&from=2026-08-31&to=2026-09-01',owner.cookie);
 out.checks.invalid_date=await request('/api/v1/data-sources?store_id='+storeId+'&from=garbage',owner.cookie);
 // Freeze both UPDATE statements behind a real row lock to test expected_version atomically.
 const lock=new Client({connectionString:process.env.DATABASE_URL});await lock.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM store WHERE id=$1 FOR UPDATE',[storeId]);
 const patch1=request('/api/v1/stores/'+storeId,owner.cookie,'PATCH',{name:'CAS-1',expected_version:1});
 const patch2=request('/api/v1/stores/'+storeId,admin.cookie,'PATCH',{name:'CAS-2',expected_version:1});
 let waits=0;for(let i=0;i<80;i++){waits=Number((await pg.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE%store%' ")).rows[0].n);if(waits>=2)break;await new Promise(r=>setTimeout(r,25));}
 await lock.query('COMMIT');await lock.end();out.checks.concurrent_store_cas={observed_lock_waits:waits,results:await Promise.all([patch1,patch2]),row_version:(await db.store.findUniqueOrThrow({where:{id:storeId}})).rowVersion};
 const dup=await request('/api/v1/stores',owner.cookie,'POST',{name:'Other Name',external_store_id:'G2-OTHER',platform:'manual',currency:'CNY',timezone:'UTC'});
 out.checks.rename_duplicate=await request('/api/v1/stores/'+dup.body.data.id,owner.cookie,'PATCH',{name:(await db.store.findUniqueOrThrow({where:{id:storeId}})).name,expected_version:1});
 // Same upload stream released after both independent requests have passed lookups.
 const same=csv('products','parallel');const concurrency=await Promise.all(Array.from({length:4},()=>upload(owner,'products',same)));out.checks.concurrent_upload={responses:concurrency.map(r=>({status:r.status,id:r.body.data?.id,code:r.body.error?.code})),rows:await db.importTask.count({where:{storeId,fileSha256:createHash('sha256').update(same).digest('hex')}})};
 const key='g2-same-http-key';const first=await upload(owner,'products',csv('products','key1'),'source_kind','test.csv','text/csv',key);const changed=await upload(owner,'products',csv('products','key2'),'source_kind','test.csv','text/csv',key);out.checks.http_key_conflict={first,changed};
 out.checks.xlsx=await upload(owner,'products',csv('products','xlsx'),'source_kind','data.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 out.checks.invalid_header=await upload(owner,'products','bad_header\nvalue');
 // Validate size limits on genuinely chunked service streams; then wire protocol in separate probe.
 const ctx={db,orgId:owner.orgId,userId:owner.userId,role:'owner'};const input={storeId,dataSourceId:sourceId,sourceKind:'products' as const,filename:'stream.csv'};
 let chunksRead=0;async function* bytes(){for(let i=0;i<24;i++){chunksRead++;yield Buffer.alloc(1024*1024,97);}}
 try{await createImportTaskFromBuffer(ctx,input,Readable.from(bytes()));}catch(e:any){out.checks.service_byte_limit={code:e.code,chunks_read:chunksRead,total_chunks:24};}
 let rowsRead=0;async function* lines(){for(const chunk of ['a\n'+'x\n'.repeat(100001),'tail1\n','tail2\n']){rowsRead++;yield chunk;}}
 try{await createImportTaskFromBuffer(ctx,input,Readable.from(lines()));}catch(e:any){out.checks.service_row_limit={code:e.code,chunks_read:rowsRead,total_chunks:3};}
 // 50,001 legal quoted records span 100,002 physical lines, below 20 MB.
 const quotedHeader=FILE_HEADERS.customer_messages.join(',');const qr='G2-STORE,2026-09-11T00:00:00Z,M,C,2026-09-01T00:00:00Z,,"first\nsecond",,chat,en';
 const quoted=await upload(owner,'customer_messages',quotedHeader+'\n'+Array(50001).fill(qr).join('\n'));out.checks.quoted_logical_rows={logical_rows:50001,physical_lines:100003,response:quoted};
 // File failure after committed task: retry must not reuse an objectless task.
 const blocked=T+'/blocked-storage';writeFileSync(blocked,'regular file blocks mkdir');setStorageRoot(blocked);const failText=csv('products','disk-failure');let failure;
 try{await createImportTaskFromBuffer(ctx,input,Readable.from([failText]));}catch(e:any){failure=e.code;}
 setStorageRoot(process.env.STORAGE_PRIVATE_ROOT!);const retry=await createImportTaskFromBuffer(ctx,input,Readable.from([failText]));const failTask=await db.importTask.findUniqueOrThrow({where:{id:retry.id}});out.checks.disk_failure_retry={initial_error:failure,retry,status:failTask.status,raw_object_key:failTask.rawObjectKey};
 // Audit transaction rollback remains required.
 await pg.query("ALTER TABLE audit_log ADD CONSTRAINT g2_block_audit CHECK(action NOT IN ('store_create','store_update','data_source_create')) NOT VALID");
 try{out.checks.audit_failure={create:await request('/api/v1/stores',owner.cookie,'POST',{name:'Should Rollback',external_store_id:'G2-AUDIT-FAIL',platform:'manual',currency:'CNY',timezone:'UTC'}),update:await request('/api/v1/stores/'+storeId,owner.cookie,'PATCH',{name:'Should Rollback',expected_version:3}),source:await request('/api/v1/data-sources',owner.cookie,'POST',{store_id:storeId,name:'Should Rollback',adapter_kind:'csv',source_namespace:'g2_audit_fail'}),store_leaks:await db.store.count({where:{externalStoreId:'G2-AUDIT-FAIL'}}),source_leaks:await db.dataSource.count({where:{storeId,sourceNamespace:'g2_audit_fail'}})};}finally{await pg.query('ALTER TABLE audit_log DROP CONSTRAINT g2_block_audit');}
 // Empty queue capture for testing lost enqueue without changing executable code.
 await pg.query("ALTER TABLE pgboss.job ADD CONSTRAINT g2_block_queue CHECK(name <> 'import-validate') NOT VALID");
 let lost;try{lost=await upload(owner,'products',csv('products','queue-failure'));}finally{await pg.query('ALTER TABLE pgboss.job DROP CONSTRAINT g2_block_queue');}
 const lostAgain=await upload(owner,'products',csv('products','queue-failure'));
 out.checks.enqueue_failure={initial:lost,retry:lostAgain,jobs:Number((await pg.query("SELECT count(*) n FROM pgboss.job WHERE data->>'taskId'=$1",[lost.body.data.id])).rows[0].n),task_status:(await db.importTask.findUniqueOrThrow({where:{id:lost.body.data.id}})).status};
 // F10 assigns upload throttling to TASK-007; record a burst without inventing a numeric contract threshold.
 const start=Date.now();const rate=[];for(let i=0;i<11;i++)rate.push((await upload(admin,'products',csv('products','rate-'+i))).status);out.checks.upload_rate={requests:11,statuses:rate,elapsed_ms:Date.now()-start};
 writeFileSync(T+'/evidence/http-probes.json',JSON.stringify(out,null,2));console.log(JSON.stringify(Object.fromEntries(Object.entries(out.checks).map(([k,v]:any)=>[k,v?.status??'recorded']))));
 await db.$disconnect();await resetClientPool();await pg.end();
}
main().then(()=>process.exit(0)).catch(e=>{writeFileSync(T+'/evidence/http-probes-partial.json',JSON.stringify(out,null,2));console.error(e);process.exit(1)});
