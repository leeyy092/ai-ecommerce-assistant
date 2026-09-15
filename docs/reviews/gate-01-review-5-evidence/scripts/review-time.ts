import {getPrismaClient,resetClientPool,createUtcPool} from './src/database/prisma';
import {createDbPool} from './src/lib/db';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const db=getPrismaClient(),url=process.env.DATABASE_URL!,base='http://127.0.0.1:3000';
const raw=new pg.Client({connectionString:url}),out:any={};
const password=process.env.E2E_OWNER_PASSWORD!;
async function call(path:string,body?:any,cookie=''){
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:base,...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
}
async function run(){
 await raw.connect();out.raw_database_timezone=(await raw.query('SHOW timezone')).rows[0].TimeZone;
 await db.authRateLimit.deleteMany();
 const login=await call('/api/auth/sign-in/email',{email:'owner-e2e@aiea.local',password});
 if(login.status!==200)throw new Error('review login failed');
 out.invites=[];
 for(const scenario of ['expired_preview','expired_direct','at_boundary_direct','valid_direct']){
  const email=randomUUID()+'@example.test';
  const created=await call('/api/v1/invitations',{email,role:'operator'},login.cookie);
  if(created.status!==201)throw new Error('review invite create failed');
  const id=created.data.data.id,token=created.data.data.url.split('/').pop();
  const original=(await raw.query('SELECT extract(epoch from expires_at)*1000 AS epoch_ms FROM invitation WHERE id=$1',[id])).rows[0];
  const delta=Date.parse(created.data.data.expires_at)-Number(original.epoch_ms);
  const sql=scenario==='valid_direct'?"created_at=now()-interval '47 hours',expires_at=now()+interval '1 hour'":scenario==='at_boundary_direct'?"created_at=now()-interval '48 hours',expires_at=now()":"created_at=now()-interval '49 hours',expires_at=now()-interval '1 hour'";
  await raw.query('UPDATE invitation SET '+sql+' WHERE id=$1',[id]);
  const stored=(await raw.query('SELECT extract(epoch from expires_at)*1000 AS epoch_ms,expires_at<=now() AS expired FROM invitation WHERE id=$1',[id])).rows[0];
  const orm=await db.invitation.findUniqueOrThrow({where:{id}});
  let preview:number|undefined;
  if(scenario==='expired_preview')preview=(await call('/api/v1/invitations/'+token)).status;
  const accepted=await call('/api/v1/invitations/'+token+'/accept',{name:'Time review',password});
  out.invites.push({scenario,api_creation_delta_ms:delta,orm_db_delta_ms:orm.expiresAt.getTime()-Number(stored.epoch_ms),db_expired:stored.expired,preview,accept:accepted.status,cookie_issued:!!accepted.cookie,me:accepted.cookie?(await call('/api/v1/me',undefined,accepted.cookie)).status:null,auth_users:await db.authUser.count({where:{email}})});
 }
 out.pools=[];
 for(const override of ['', '?options=-c%20timezone%3DUTC','?options=-c%20timezone%3DAmerica%2FNew_York']){
  const pool=createUtcPool(url+override);
  const clients=await Promise.all(Array.from({length:6},()=>pool.connect()));
  const rows=await Promise.all(clients.map(async c=>(await c.query("SELECT pg_backend_pid() pid,current_setting('TimeZone') timezone,extract(epoch from '2026-01-01T00:00:00Z'::timestamptz)*1000 AS epoch_ms,'2026-01-01T00:00:00Z'::timestamptz AS at")).rows[0]));
  for(const c of clients)c.release();
  const reuse=(await pool.query("SELECT current_setting('TimeZone') timezone")).rows[0];
  out.pools.push({connection_options:override||'database-default',distinct_connections:new Set(rows.map(x=>x.pid)).size,rows,reuse});await pool.end();
 }
 const health=createDbPool({databaseUrl:url});
 const row=(await health.query("SELECT current_setting('TimeZone') timezone,extract(epoch from '2026-01-01T00:00:00Z'::timestamptz)*1000 AS epoch_ms,'2026-01-01T00:00:00Z'::timestamptz AS at")).rows[0];
 out.worker_health_raw_pg={...row,date_delta_ms:row.at.getTime()-Number(row.epoch_ms),purpose:'existing SELECT 1 health path; not Prisma domain writes'};await health.end();
 const fresh=await call('/api/auth/sign-in/email',{email:'owner-e2e@aiea.local',password});
 const countBefore=(await raw.query('SELECT count(*)::int n FROM invitation')).rows[0].n;
 out.session_failure=[];
 await raw.query('ALTER TABLE session RENAME TO review_session_unavailable');
 try {
  for(const [path,method,body] of [
   ['/api/v1/invitations','POST',{email:randomUUID()+'@example.test',role:'operator'}],
   ['/api/v1/invitations','GET',undefined],
   ['/api/v1/invitations/invalid-token/accept','POST',{}],
   ['/api/v1/invitations/invalid-id?expected_version=1','DELETE',undefined],
  ] as const){
   const r=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',cookie:fresh.cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const b=await r.json().catch(()=>null);
   out.session_failure.push({path,method,status:r.status,json:!!b,request_id:!!b?.error?.request_id});
  }
 } finally {await raw.query('ALTER TABLE review_session_unavailable RENAME TO session')}
 out.session_failure_invitation_count_unchanged=(await raw.query('SELECT count(*)::int n FROM invitation')).rows[0].n===countBefore;
 const au=await db.authUser.findUniqueOrThrow({where:{email:'owner-e2e@aiea.local'}});
 const sessions=await db.authSession.findMany({where:{userId:au.id}});
 const before=(await call('/api/v1/me',undefined,fresh.cookie)).status;
 await raw.query('UPDATE session SET "expiresAt"=(now() AT TIME ZONE \'UTC\')-interval \'1 second\' WHERE "userId"=$1',[au.id]);
 out.auth_expiry={valid_before:before,expired_after:(await call('/api/v1/me',undefined,fresh.cookie)).status,session_count:sessions.length};
 const u=new URL(url);u.pathname='/aiea_r5_upgrade_good';const old=new pg.Client({connectionString:u.toString()});await old.connect();
 out.upgraded_epoch=(await old.query("SELECT extract(epoch from created_at)*1000 AS epoch_ms FROM job_run WHERE id='10000000-0000-4000-8000-000000000004'")).rows[0];await old.end();
 await raw.end();await db.$disconnect();await resetClientPool();writeFileSync(process.env.REVIEW_OUT!,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
run().catch(e=>{writeFileSync(process.env.REVIEW_OUT!,JSON.stringify({partial:out,error:e.message},null,2));console.error(e.message);process.exit(1)});
