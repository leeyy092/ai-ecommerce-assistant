import pg from 'pg';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from './src/generated/prisma/client';
import {createUtcPool} from './src/database/prisma';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const base=new URL(process.env.DATABASE_URL!);base.pathname='/postgres';
async function run(){
 const admin=new pg.Client({connectionString:base.toString()});await admin.connect();
 await admin.query('CREATE DATABASE aiea_r5_schema_sim');
 await admin.query("ALTER DATABASE aiea_r5_schema_sim SET timezone='UTC'");await admin.end();
 base.pathname='/aiea_r5_schema_sim';const url=base.toString();
 const migration=execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{encoding:'utf8',env:{...process.env,DATABASE_URL:url}});
 const raw=new pg.Client({connectionString:url});await raw.connect();const pool=createUtcPool(url),db=new PrismaClient({adapter:new PrismaPg(pool)});
 const tag=randomUUID();await db.authUser.create({data:{id:tag,name:'schema',email:tag+'@example.test'}});
 const user=await db.user.create({data:{authUserId:tag,email:tag+'@example.test',displayName:'schema'}});
 const org=await db.organization.create({data:{name:'schema',ownerUserId:user.id}});
 const inv=await db.invitation.create({data:{orgId:org.id,email:'clock@example.test',role:'operator',tokenHash:randomUUID(),invitedBy:user.id,expiresAt:new Date('2026-01-01T00:00:00.123Z')}});
 const saved=(await raw.query('SELECT extract(epoch from expires_at)*1000 AS epoch_ms,current_setting(\'TimeZone\') AS timezone FROM invitation WHERE id=$1',[inv.id])).rows[0];
 const out:any={utc_default_db:{raw_timezone:saved.timezone,orm_db_delta_ms:inv.expiresAt.getTime()-Number(saved.epoch_ms)}};
 async function fixture(){const s=await db.store.create({data:{orgId:org.id,name:'S',externalStoreId:randomUUID(),platform:'manual',currency:'CNY',timezone:'Asia/Shanghai'}});const a=await db.auditLog.create({data:{orgId:org.id,storeId:s.id,action:'review',entityType:'review',entityId:randomUUID(),requestId:randomUUID()}});return {s,a};}
 const one=await fixture();await db.store.delete({where:{id:one.s.id}});const record=await db.auditLog.findUniqueOrThrow({where:{id:one.a.id}});
 out.current_migration_delete={store_null:record.storeId===null,org_preserved:record.orgId===org.id};
 const two=await fixture();
 const diff=readFileSync(process.env.REVIEW_DIFF!,'utf8').slice(readFileSync(process.env.REVIEW_DIFF!,'utf8').indexOf('-- DropForeignKey'));
 await raw.query(diff);
 const bad=await raw.query('DELETE FROM store WHERE id=$1',[two.s.id]).then(()=>({deleted:true}),e=>({deleted:false,code:e.code,column:e.column}));
 out.generated_sql_simulation={isolated_disposable_db_only:true,sql:diff,delete_result:bad,original_review_db_unchanged:true};
 await db.$disconnect();await pool.end();await raw.end();writeFileSync(process.env.REVIEW_OUT!,JSON.stringify(out,null,2));console.log(JSON.stringify(out));
}
run().catch(e=>{console.error(e.message);process.exit(1)});
