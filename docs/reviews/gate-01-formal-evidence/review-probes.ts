import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getPrismaClient } from './src/database/prisma';
import { auth } from './src/lib/auth';
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
 const countBefore=await db.authRateLimit.findUnique({where:{key:'login-fail:'+ip}});
 const bad=await api('/api/auth/sign-in/email','POST',{email:a.email},'',{'x-forwarded-for':ip});
 out.M02={wrong:wrong.status,countBefore:countBefore?.count,bad:bad.status,counterAfter:await db.authRateLimit.findUnique({where:{key:'login-fail:'+ip}})};
 const numericName=await api('/api/v1/organization','PATCH',{name:123,expected_version:1},a.cookie);
 const nullBody=await api('/api/v1/organization','PATCH',null,a.cookie);
 const fraction=await api('/api/v1/organization','PATCH',{name:'FractionAccepted',expected_version:1.1},a.cookie);
 out.M03={numericNameStatus:numericName.status,nullBodyStatus:nullBody.status,nullBodyJSON:nullBody.json,fractionalVersionStatus:fraction.status,fractionalVersionJSON:fraction.json,orgNameAfterFraction:(await db.organization.findUniqueOrThrow({where:{id:a.orgId}})).name};
 const anonEmail=`r2-anon-${tag}@example.test`;const s1=await api('/api/auth/sign-up/email','POST',{email:anonEmail,password,name:'anon'});const s2=await api('/api/auth/sign-up/email','POST',{email:anonEmail,password,name:'anon'});
 out.H04={statuses:[s1.status,s2.status],json:[s1.json,s2.json],authRows:await db.authUser.count({where:{email:anonEmail}})};
 // Controlled deterministic concurrent initOwner scheduling using the shipped fault hook.
 const email=`r2-race-${tag}@example.test`;let release1!:()=>void,release2!:()=>void,entered1!:()=>void,entered2!:()=>void;
 const wait1=new Promise<void>(resolve=>release1=resolve),wait2=new Promise<void>(resolve=>release2=resolve),ready1=new Promise<void>(resolve=>entered1=resolve),ready2=new Promise<void>(resolve=>entered2=resolve);
 const input={orgName:'ConcurrentOwner',email,displayName:'ConcurrentOwner',demoMode:true,password};
 const first=initOwner(db,{...input,testHookAfterAuth:async()=>{entered1();await wait1}},signup).then(x=>({ok:true,result:x}),e=>({ok:false,error:e.code??e.name}));
 await ready1;
 const second=initOwner(db,{...input,testHookAfterAuth:async()=>{entered2();await wait2}},signup).then(x=>({ok:true,result:x}),e=>({ok:false,error:e.code??e.name}));
 await ready2;release1();const firstResult=await first;release2();const secondResult=await second;
 const domain=await db.user.findUnique({where:{email}});const retry=await initOwner(db,input,signup);const raceLogin=await login(email);
 out.H06_owner_concurrent={firstSucceeded:firstResult.ok,secondSucceeded:secondResult.ok,authRows:await db.authUser.count({where:{email}}),domainRows:await db.user.count({where:{email}}),domainPointsToExistingAuth:domain?!!await db.authUser.findUnique({where:{id:domain.authUserId}}):false,retryAlreadyInitialized:retry.alreadyInitialized,relogin:raceLogin.status};
 const signout=await api('/api/auth/sign-out','POST',{},op.cookie);out.signout={status:signout.status,oldCookie:(await api('/api/v1/me','GET',undefined,op.cookie)).status};
 writeFileSync(process.env.REVIEW_OUT!,JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}
run().catch(e=>{console.error(e.message);writeFileSync(process.env.REVIEW_OUT!,JSON.stringify({partial:out,error:e.message},null,2));process.exitCode=1}).finally(()=>db.$disconnect());
