import {getPrismaClient} from './src/database/prisma';
import {auth} from './src/lib/auth';
import {acceptInvitation} from './src/services/invitations';
const db=getPrismaClient();
acceptInvitation(db,{token:process.env.REVIEW_INVITE_TOKEN!,displayName:'CrashUser',password:process.env.E2E_OWNER_PASSWORD!,signUpNewUser:async(email,password,name)=>{const x=await auth.api.signUpEmail({body:{email,password,name}});return {authUserId:x.user.id}},testHookAfterAuth:async()=>{process.exit(55)}}).catch(()=>process.exit(56));
