import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getPrismaClient } from './src/database/prisma';
import { getAuth } from './src/lib/auth';
const auth=getAuth();
import { initOwner } from './src/services/ownerInit';
import { acceptInvitation, createInvitation } from './src/services/invitations';
const db=getPrismaClient(), base='http://127.0.0.1:3000', password=process.env.E2E_OWNER_PASSWORD!;
const out:any={}; const tag=randomUUID().slice(0,8);
const signup=async(email:string,p:string,name:string)=>{const x=await auth.api.signUpEmail({body:{email,password:p,name}});return {authUserId:x.user.id}};
async function api(path:string,method='GET',body?:any,cookie='',extra:any={}) {
 const res=await fetch(base+path,{method,headers:{'content-type':'application/json',origin:base,...(cookie?{cookie}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await res.text(); let data:any; try{data=JSON.parse(text)}catch{data=null}
 return {status:res.status,data,json:data!==null,cookie:res.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
}
async function login(email:string){return api('/api/auth/sign-in/email','POST',{email,password},'',{'x-forwarded-for':'192.0.2.'+(10+Math.floor(Math.random()*180))})}
async function owner(label:string){const email=`r2-${label}-${tag}@example.test`;const x=await initOwner(db,{orgName:label,email,displayName:label,demoMode:true,password},signup);return {...x,email,cookie:(await login(email)).cookie}}
async function run(){
 const a=await owner('A'),b=await owner('B');
 await db.membership.create({data:{orgId:b.orgId,userId:a.userId,role:'customer_service'}});
 const cross=await db.membership.create({data:{orgId:a.orgId,userId:b.userId,role:'operator'}});
 const switched=await api('/api/v1/me/active-organization','PUT',{organization_id:b.orgId},a.cookie);
 const dualCookie=a.cookie+'; '+switched.cookie;
 const me=await api('/api/v1/me','GET',undefined,dualCookie),org=await api('/api/v1/organization','GET',undefined,dualCookie);
 const denied=await api('/api/v1/organization','PATCH',{name:'wrong-org',expected_version:1},dualCookie);
 const forged=await api('/api/v1/me','GET',undefined,a.cookie+'; aiea_active_org='+randomUUID());
 out.H01={switchStatus:switched.status,meB:me.data?.data?.active_org===b.orgId,role:me.data?.data?.role,organizationB:org.data?.data?.id===b.orgId,budgetAbsent:!('ai_daily_budget_cny' in org.data.data),patch:denied.status,orgAUnchanged:(await db.organization.findUniqueOrThrow({where:{id:a.orgId}})).name==='A',forgedFallsBackA:forged.data?.data?.active_org===a.orgId};
 async function inviteActor(label:string,role:string){const email=`r2-${label}-${tag}@example.test`;const inv=await api('/api/v1/invitations','POST',{email,role},a.cookie);const token=inv.data.data.url.split('/').pop();const ac=await api('/api/v1/invitations/'+token+'/accept','POST',{name:label,password});const user=await db.user.findUniqueOrThrow({where:{email}});const m=await db.membership.findFirstOrThrow({where:{orgId:a.orgId,userId:user.id}});return {email,user,m,cookie:ac.cookie,accept:ac.status,token};}
 const admin=await inviteActor('admin','admin'),op=await inviteActor('op','operator');
 out.H05={accept:op.accept,me:(await api('/api/v1/me','GET',undefined,op.cookie)).status,replay:(await api('/api/v1/invitations/'+op.token+'/accept','POST',{name:'op',password})).status};
 const admProm=await api('/api/v1/members/'+op.m.id,'PATCH',{role:'admin',expected_version:1},admin.cookie);
 const unchanged=(await db.membership.findUniqueOrThrow({where:{id:op.m.id}})).role;
 const grantOwner=await api('/api/v1/members/'+op.m.id,'PATCH',{role:'owner',expected_version:1},admin.cookie);
 const pc=await api('/api/v1/members/'+op.m.id,'PATCH',{role:'customer_service',expected_version:1},admin.cookie);
 const cp=await api('/api/v1/members/'+op.m.id,'PATCH',{role:'operator',expected_version:2},admin.cookie);
 const ownerGrant=await api('/api/v1/members/'+op.m.id,'PATCH',{role:'admin',expected_version:3},a.cookie);
 out.H02={adminToAdmin:admProm.status,unchangedRole:unchanged,adminToOwner:grantOwner.status,operatorToCS:pc.status,csToOperator:cp.status,ownerToAdmin:ownerGrant.status};
 // Audit injection: roll back both membership disable and auth-session deletion.
 const beforeSessions=await db.authSession.count({where:{userId:(await db.user.findUniqueOrThrow({where:{id:b.userId}})).authUserId}});
 await db.$executeRawUnsafe("ALTER TABLE audit_log ADD CONSTRAINT review_member_fail CHECK(action<>'member_update') NOT VALID");
 let failed:any;try{failed=await api('/api/v1/members/'+cross.id,'PATCH',{status:'disabled',expected_version:cross.rowVersion},a.cookie)}finally{await db.$executeRawUnsafe('ALTER TABLE audit_log DROP CONSTRAINT review_member_fail')}
 const afterM=await db.membership.findUniqueOrThrow({where:{id:cross.id}});
 out.H07member={http:failed.status,json:failed.json,statusUnchanged:afterM.status===cross.status,versionUnchanged:afterM.rowVersion===cross.rowVersion,oldSessionStillWorks:(await api('/api/v1/me','GET',undefined,b.cookie)).status===200,sessionsBefore:beforeSessions,sessionsAfter:await db.authSession.count({where:{userId:(await db.user.findUniqueOrThrow({where:{id:b.userId}})).authUserId}})};
 const disabled=await api('/api/v1/members/'+cross.id,'PATCH',{status:'disabled',expected_version:cross.rowVersion},a.cookie);
 const old=await api('/api/v1/me','GET',undefined,b.cookie);const relog=await login(b.email);const bme=await api('/api/v1/me','GET',undefined,relog.cookie);
 out.H03_D01={disable:disabled.status,oldCookie:old.status,globalStatus:(await db.user.findUniqueOrThrow({where:{id:b.userId}})).status,otherMembership:(await db.membership.findFirstOrThrow({where:{orgId:b.orgId,userId:b.userId}})).status,relogin:relog.status,me:bme.status,activeB:bme.data?.data?.active_org===b.orgId,role:bme.data?.data?.role};
 const currentOrg=await db.organization.findUniqueOrThrow({where:{id:a.orgId}});
 await db.$executeRawUnsafe("ALTER TABLE audit_log ADD CONSTRAINT review_org_fail CHECK(action<>'org_update') NOT VALID");
 let orgFault:any;try{orgFault=await api('/api/v1/organization','PATCH',{name:'auditfail',expected_version:currentOrg.rowVersion},a.cookie)}finally{await db.$executeRawUnsafe('ALTER TABLE audit_log DROP CONSTRAINT review_org_fail')}
 const orgAfter=await db.organization.findUniqueOrThrow({where:{id:a.orgId}});
 out.H07org={http:orgFault.status,nameUnchanged:orgAfter.name===currentOrg.name,versionUnchanged:orgAfter.rowVersion===currentOrg.rowVersion,auditCount:await db.auditLog.count({where:{orgId:a.orgId,action:'org_update'}})};
 for(const action of ['invite_create','invite_revoke','invite_accept']){
  let inv:any;if(action!=='invite_create')inv=(await api('/api/v1/invitations','POST',{email:`r2-${action}-${tag}@example.test`,role:'operator'},a.cookie)).data.data;
  await db.$executeRawUnsafe(`ALTER TABLE audit_log ADD CONSTRAINT review_inv_fail CHECK(action<>'${action}') NOT VALID`);
  let response:any;try{
   if(action==='invite_create')response=await api('/api/v1/invitations','POST',{email:`r2-${action}-${tag}@example.test`,role:'operator'},a.cookie);
   if(action==='invite_revoke')response=await api('/api/v1/invitations/'+inv.id+'?expected_version=1','DELETE',undefined,a.cookie);
   if(action==='invite_accept')response=await api('/api/v1/invitations/'+inv.url.split('/').pop()+'/accept','POST',{name:'audit failure',password});
  }finally{await db.$executeRawUnsafe('ALTER TABLE audit_log DROP CONSTRAINT review_inv_fail')}
  const record=inv?await db.invitation.findUnique({where:{id:inv.id}}):null;
  out['H07_'+action]={http:response.status,auditCount:await db.auditLog.count({where:{orgId:a.orgId,action,entityId:inv?.id??'nonexistent'}}),...(record?{invitationStatus:record.status,rowVersion:record.rowVersion}:{}),authRows:await db.authUser.count({where:{email:`r2-${action}-${tag}@example.test`}}),domainRows:await db.user.count({where:{email:`r2-${action}-${tag}@example.test`}})};
  if(action==='invite_create')out['H07_'+action].invitationRows=await db.invitation.count({where:{email:`r2-${action}-${tag}@example.test`}});
  if(action==='invite_accept')out['H07_'+action].retry=(await api('/api/v1/invitations/'+inv.url.split('/').pop()+'/accept','POST',{name:'retry',password})).status;
 }
 // Direct external-origin probe: manually supplied Cookie; does not claim browser exploit.
 const csrf=await api('/api/v1/invitations','POST',{email:`r2-csrf-${tag}@example.test`,role:'operator'},a.cookie,{'content-type':'text/plain',origin:'https://untrusted.example.test'});
 out.M01={untrustedOriginStatus:csrf.status,created:!!csrf.data?.data?.id,manualCookie:true};
 const ip='198.51.100.201';const wrong=await api('/api/auth/sign-in/email','POST',{email:a.email,password:'wrong-password'},'',{'x-forwarded-for':ip});
 const countBefore=await db.authRateLimit.findUnique({where:{key:'login-fail:direct'}});
 const bad=await api('/api/auth/sign-in/email','POST',{email:a.email},'',{'x-forwarded-for':ip});
 out.M02={wrong:wrong.status,countBefore:countBefore?.count,bad:bad.status,counterAfter:await db.authRateLimit.findUnique({where:{key:'login-fail:direct'}})};
 const numericName=await api('/api/v1/organization','PATCH',{name:123,expected_version:1},a.cookie);
 const nullBody=await api('/api/v1/organization','PATCH',null,a.cookie);
 const fraction=await api('/api/v1/organization','PATCH',{name:'FractionAccepted',expected_version:1.1},a.cookie);
 out.M03={numericNameStatus:numericName.status,nullBodyStatus:nullBody.status,nullBodyJSON:nullBody.json,fractionalVersionStatus:fraction.status,fractionalVersionJSON:fraction.json,orgNameAfterFraction:(await db.organization.findUniqueOrThrow({where:{id:a.orgId}})).name};
 const anonEmail=`r2-anon-${tag}@example.test`;const s1=await api('/api/auth/sign-up/email','POST',{email:anonEmail,password,name:'anon'});const s2=await api('/api/auth/sign-up/email','POST',{email:anonEmail,password,name:'anon'});
 out.H04={statuses:[s1.status,s2.status],json:[s1.json,s2.json],authRows:await db.authUser.count({where:{email:anonEmail}})};
 // Current H06: hold first auth while second waits on shared advisory lock.
 const email=`r3-race-${tag}@example.test`;let release!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const input={orgName:'Concurrent',email,displayName:'Concurrent',demoMode:true,password};
 const first=initOwner(db,{...input,testHookAfterAuth:async()=>{entered();await gate}},signup);
 await ready;let secondFinished=false;const second=initOwner(db,input,signup).then(x=>{secondFinished=true;return x});
 await new Promise(r=>setTimeout(r,200));const waiting=!secondFinished;release();const pair=await Promise.all([first,second]);
 out.H06_owner_concurrent={secondWaited:waiting,oneOrg:pair[0].orgId===pair[1].orgId,secondIdempotent:pair[1].alreadyInitialized,authRows:await db.authUser.count({where:{email}}),domainRows:await db.user.count({where:{email}}),login:(await login(email)).status};
 const rev=await api('/api/v1/invitations','POST',{email:`r3-revoke-${tag}@example.test`,role:'operator'},a.cookie);
 const revId=rev.data.data.id;
 const revoked=await api('/api/v1/invitations/'+revId+'?expected_version=1.1','DELETE',undefined,a.cookie,{origin:'https://untrusted.example.test'});
 out.M01_M03_revoke={manualCookie:true,untrustedOriginFractionalVersion:revoked.status,rowStatus:(await db.invitation.findUniqueOrThrow({where:{id:revId}})).status};
 const nullInvite=await api('/api/v1/invitations','POST',null,a.cookie);
 const numberInvite=await api('/api/v1/invitations','POST',{email:42,role:'operator'},a.cookie);
 const extraInvite=await api('/api/v1/invitations','POST',{email:`r3-extra-${tag}@example.test`,role:'operator',unexpected:true},a.cookie);
 out.M03_invitation={nullBody:nullInvite.status,numericEmail:numberInvite.status,unexpectedField:extraInvite.status};
 // Persistent limiter: forwarded headers must not let anonymous preview calls bypass a window.
 await db.authRateLimit.deleteMany({where:{key:{startsWith:'invite-preview:'}}});
 for(let i=0;i<60;i++)await api('/api/v1/invitations/not-a-token','GET',undefined,'',{'x-forwarded-for':'198.51.100.22'});
 const limited=await api('/api/v1/invitations/not-a-token','GET',undefined,'',{'x-forwarded-for':'198.51.100.22'});
 const bypassed=await api('/api/v1/invitations/not-a-token','GET',undefined,'',{'x-forwarded-for':'198.51.100.23'});
 out.M02_invite_proxy={trustProxyHeaders:false,sameIP:limited.status,forgedNewIP:bypassed.status};
 const signout=await api('/api/auth/sign-out','POST',{},op.cookie);out.signout={status:signout.status,oldCookie:(await api('/api/v1/me','GET',undefined,op.cookie)).status};
 writeFileSync(process.env.REVIEW_OUT!,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
run().catch(e=>{console.error(e.message);writeFileSync(process.env.REVIEW_OUT!,JSON.stringify({partial:out,error:e.message},null,2));process.exitCode=1}).finally(()=>db.$disconnect());
