import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getPrismaClient} from './src/database/prisma';
import {applyMigrations,applyMigrationsUpTo} from './tests/helpers/pgMigrate';
const url=process.env.DATABASE_URL!,db=getPrismaClient(),out:any={};
const observer=new pg.Client({connectionString:url});
async function fixture(){
 const mk=async()=>{const tag=randomUUID();const au=await db.authUser.create({data:{id:'auth-'+tag,name:tag,email:tag+'@example.test'}});const u=await db.user.create({data:{authUserId:au.id,email:au.email,displayName:tag}});return db.organization.create({data:{name:tag,ownerUserId:u.id}})};
 const a=await mk(),b=await mk();const s=await db.store.create({data:{orgId:a.id,name:'Review',externalStoreId:randomUUID(),platform:'manual',currency:'CNY',timezone:'Asia/Shanghai'}});return {a,b,s};
}
async function lockWait(pid:number){for(let n=0;n<40;n++){const row=(await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];if(row?.wait_event_type==='Lock')return true;await new Promise(r=>setTimeout(r,25));}return false;}
async function race(direction:string){const {a,b,s}=await fixture();const c1=new pg.Client({connectionString:url}),c2=new pg.Client({connectionString:url});await c1.connect();await c2.connect();await c1.query("SET statement_timeout='5s'");await c2.query("SET statement_timeout='5s'");await c1.query('BEGIN');await c2.query('BEGIN');const audit=randomUUID();
 const insert=()=>c2.query("INSERT INTO audit_log(id,org_id,store_id,action,entity_type,entity_id,request_id,updated_at) VALUES($1::text,$2,$3,'race','probe',$1::text,$1::text,now())",[audit,a.id,s.id]);
 const update=()=>c1.query('UPDATE store SET org_id=$1 WHERE id=$2',[b.id,s.id]);
 let pending:Promise<any>,pid:number;
 if(direction==='A'){await update();pid=(await c2.query('SELECT pg_backend_pid() pid')).rows[0].pid;pending=insert().then(()=>({ok:true}),e=>({ok:false,code:e.code,constraint:e.constraint}));}
 else{await insert();pid=(await c1.query('SELECT pg_backend_pid() pid')).rows[0].pid;pending=update().then(()=>({ok:true}),e=>({ok:false,code:e.code,constraint:e.constraint}));}
 const observed_lock_wait=await lockWait(pid);await (direction==='A'?c1:c2).query('COMMIT');const result=await pending;await(direction==='A'?c2:c1).query(result.ok?'COMMIT':'ROLLBACK');
 const cross=(await observer.query('SELECT count(*)::int n FROM audit_log a JOIN store s ON s.id=a.store_id WHERE a.org_id<>s.org_id')).rows[0].n;
 await c1.end();await c2.end();return {observed_lock_wait,result,cross_org_count:cross};}
async function run(){await observer.connect();out.H08_A=await race('A');out.H08_B=await race('B');const {a,s}=await fixture();const audit=await db.auditLog.create({data:{orgId:a.id,storeId:s.id,action:'review',entityType:'review',entityId:randomUUID(),requestId:randomUUID()}});await db.store.delete({where:{id:s.id}});const after=await db.auditLog.findUniqueOrThrow({where:{id:audit.id}});out.H08_delete={store_null:after.storeId===null,org_preserved:after.orgId===a.id};
 out.M04_coverage=(await observer.query(`SELECT c.table_name,EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=(quote_ident(c.table_schema)||'.'||quote_ident(c.table_name))::regclass AND k.conname LIKE 'ck_domain_uuid_%' AND k.convalidated) AS constrained FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_name='id' AND c.table_name NOT IN ('user','session','account','verification','_prisma_migrations') ORDER BY c.table_name`)).rows;
 const f=await fixture();const job=await db.jobRun.create({data:{id:'not-a-uuid-review',orgId:f.a.id,storeId:f.s.id,jobKind:'recompute_snapshot',idempotencyKey:randomUUID(),context:{},datasetVersion:0n,rulesetVersion:'p0-v1'}}).then(x=>({inserted:true,id:x.id}),e=>({inserted:false,code:e.code,message:e.message}));out.M04_non_uuid_job=job;
 out.H09=(await observer.query("SELECT data_type,count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND data_type LIKE 'timestamp%' AND table_name NOT IN ('user','session','account','verification','_prisma_migrations') GROUP BY data_type")).rows;
 const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new pg.Client({connectionString:adminUrl.toString()});await admin.connect();for(const name of ['aiea_r4_helper','aiea_r4_upto'])await admin.query('CREATE DATABASE '+name);const u=new URL(url);u.pathname='/aiea_r4_helper';out.M06_helper_applied=await applyMigrations(u.toString());u.pathname='/aiea_r4_upto';const target='20260913044218_p0_audit_tenant_fk';out.M06_upto_first=await applyMigrationsUpTo(u.toString(),target);out.M06_upto_repeat=await applyMigrationsUpTo(u.toString(),target);await admin.end();
 writeFileSync(process.env.REVIEW_OUT!,JSON.stringify(out,null,2));await observer.end();await db.$disconnect();console.log(JSON.stringify(out,null,2));}
run().catch(e=>{console.error(e.message);writeFileSync(process.env.REVIEW_OUT!,JSON.stringify({partial:out,error:e.message},null,2));process.exit(1)});
