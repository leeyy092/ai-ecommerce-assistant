import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {getPrismaClient} from './src/database/prisma';
import {auth} from './src/lib/auth';
import {initOwner} from './src/services/ownerInit';
import {createInvitation,acceptInvitation} from './src/services/invitations';
const db=getPrismaClient(),tag=crypto.randomUUID().slice(0,8),password=process.env.E2E_OWNER_PASSWORD!,out:any={};
const signup=async(email:string,password:string,name:string)=>{const x=await auth.api.signUpEmail({body:{email,password,name}});return {authUserId:x.user.id}};
async function main(){
 const email=`supp-${tag}@example.test`;const o=await initOwner(db,{orgName:'supplement',email,displayName:'Supplement',demoMode:true,password},signup);
 const signed=await fetch('http://127.0.0.1:3000/api/auth/sign-in/email',{method:'POST',headers:{origin:'http://127.0.0.1:3000','content-type':'application/json','x-forwarded-for':'192.0.2.222'},body:JSON.stringify({email,password})});
 const cookie=signed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');await signed.text();
 const ctx={db,orgId:o.orgId,userId:o.userId,role:'owner' as const};
 const inv=await createInvitation(ctx,{email:`revoke-${tag}@example.test`,role:'operator',baseUrl:'http://127.0.0.1:3000'});
 await db.$executeRawUnsafe("ALTER TABLE audit_log ADD CONSTRAINT review_revoke_fail CHECK(action<>'invite_revoke') NOT VALID");
 let resp:Response;try{resp=await fetch(`http://127.0.0.1:3000/api/v1/invitations/${inv.id}?expected_version=1`,{method:'DELETE',headers:{cookie,origin:'http://127.0.0.1:3000'}});await resp.text()}finally{await db.$executeRawUnsafe('ALTER TABLE audit_log DROP CONSTRAINT review_revoke_fail')}
 const persisted=await db.invitation.findUniqueOrThrow({where:{id:inv.id}});out.H07revoke={http:resp!.status,status:persisted.status,rowVersion:persisted.rowVersion,auditCount:await db.auditLog.count({where:{entityId:inv.id,action:'invite_revoke'}})};
 const crashEmail=`crash-${tag}@example.test`;const crash=await createInvitation(ctx,{email:crashEmail,role:'operator',baseUrl:'http://127.0.0.1:3000'});const token=crash.url.split('/').pop()!;
 let exit=0;try{execFileSync('pnpm',['exec','tsx','review-crash-child.ts'],{env:{...process.env,REVIEW_INVITE_TOKEN:token},stdio:'pipe',timeout:15000})}catch(e:any){exit=e.status}
 out.H06processExit={exit,authBeforeRetry:await db.authUser.count({where:{email:crashEmail}}),domainBeforeRetry:await db.user.count({where:{email:crashEmail}}),invitationBeforeRetry:(await db.invitation.findUniqueOrThrow({where:{id:crash.id}})).status};
 await acceptInvitation(db,{token,displayName:'Recovered',password,signUpNewUser:signup});
 out.H06processExit.authAfterRetry=await db.authUser.count({where:{email:crashEmail}});out.H06processExit.domainAfterRetry=await db.user.count({where:{email:crashEmail}});out.H06processExit.invitationAfterRetry=(await db.invitation.findUniqueOrThrow({where:{id:crash.id}})).status;
 // Same logged-in identity accepting the same invitation concurrently.
 const target=await createInvitation(ctx,{email:'owner-e2e@aiea.local',role:'operator',baseUrl:'http://127.0.0.1:3000'});const u=await db.user.findUniqueOrThrow({where:{email:'owner-e2e@aiea.local'}});
 const existingInput={token:target.url.split('/').pop()!,sessionUser:{id:u.id,email:u.email}};
 const results=await Promise.allSettled([acceptInvitation(db,existingInput),acceptInvitation(db,existingInput)]);
 out.H06existingConcurrency={results:results.map(r=>r.status==='fulfilled'?200:(r.reason.status??500)),memberships:await db.membership.count({where:{orgId:o.orgId,userId:u.id}})};
 const ormTime=new Date('2026-01-01T20:00:00+08:00');const user=await db.user.create({data:{authUserId:'supp-tz-'+tag,email:`supp-tz-${tag}@example.test`,displayName:'tz',createdAt:ormTime}});out.H09ormTimestamp={actual:user.createdAt.toISOString(),expected:'2026-01-01T12:00:00.000Z',equal:user.createdAt.getTime()===ormTime.getTime()};
 writeFileSync(process.env.REVIEW_OUT!.replace('http-probes','supplement'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
