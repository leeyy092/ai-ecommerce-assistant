import {getPrismaClient} from './src/database/prisma';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const db=getPrismaClient(),raw=new pg.Client({connectionString:process.env.DATABASE_URL}),base=process.env.REVIEW_BASE??'http://127.0.0.1:3000';
async function run(){await raw.connect();const owner=await db.membership.findFirstOrThrow({where:{role:'owner',organization:{name:'A'}},include:{user:true}});const password=process.env.E2E_OWNER_PASSWORD!;
 async function call(path:string,body?:any,cookie=''){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:base,...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};}
 const login=await call('/api/auth/sign-in/email',{email:owner.user.email,password});const created=await call('/api/v1/invitations',{email:randomUUID()+'@example.test',role:'operator'},login.cookie);const id=created.data.data.id,token=created.data.data.url.split('/').pop();
 const original=(await raw.query('SELECT expires_at,extract(epoch from expires_at)*1000 AS epoch_ms,current_setting(\'TimeZone\') AS timezone FROM invitation WHERE id=$1',[id])).rows[0];
 await raw.query("UPDATE invitation SET created_at=now()-interval '49 hours',expires_at=now()-interval '1 hour' WHERE id=$1",[id]);
 const sql=(await raw.query('SELECT expires_at,extract(epoch from expires_at)*1000 AS epoch_ms,expires_at<now() AS expired FROM invitation WHERE id=$1',[id])).rows[0];const orm=await db.invitation.findUniqueOrThrow({where:{id}});
 await db.authRateLimit.deleteMany({where:{key:{startsWith:'invite-'}}});const preview=await call('/api/v1/invitations/'+token);const accept=await call('/api/v1/invitations/'+token+'/accept',{name:'Expired timezone probe',password});
 const result={postgres_timezone:original.timezone,original_created_http_expires:created.data.data.expires_at,original_db_epoch_ms:Number(original.epoch_ms),original_http_epoch_ms:Date.parse(created.data.data.expires_at),expired_db_timestamp:sql.expires_at,expired_db_epoch_ms:Number(sql.epoch_ms),db_says_expired:sql.expired,orm_expires_at:orm.expiresAt.toISOString(),orm_vs_db_delta_ms:orm.expiresAt.getTime()-Number(sql.epoch_ms),preview_status:preview.status,accept_status:accept.status,fixture_age_hours:49,fixture_ttl_hours:48,accepted_cookie_issued:!!accept.cookie,accepted_session_me_status:accept.cookie?(await call('/api/v1/me',undefined,accept.cookie)).status:null};
 writeFileSync(process.env.REVIEW_OUT!,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await raw.end();await db.$disconnect();}
run().catch(e=>{console.error(e.message);process.exit(1)});
