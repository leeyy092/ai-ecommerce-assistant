from pathlib import Path
import os,json,subprocess,time,urllib.request,urllib.error,secrets
p=Path(__file__).parent;app=p/'clean-context/ai-ecommerce-assistant';review=json.loads((p/'env.json').read_text());env=os.environ.copy();env['BETTER_AUTH_SECRET']=review['BETTER_AUTH_SECRET'];env['BETTER_AUTH_URL']='http://127.0.0.1:3301'
override=p/'compose-review.yaml';override.write_text('''services:
  postgres:
    command: ["postgres", "-c", "timezone=Asia/Shanghai"]
    ports: !override
      - "127.0.0.1:55480:5432"
  web:
    image: aiea-r5-review:32fb0d3
    ports: !override
      - "127.0.0.1:3301:3000"
  worker:
    image: aiea-r5-review:32fb0d3
''')
prefix=['docker','compose','-p','aiea-r5-codex-32fb0d3','--project-directory',str(app),'-f',str(app/'compose.yaml'),'-f',str(override)]
out={};case=''
def cmd(name,args,input=None):
 with (p/'evidence'/f'container-{case}-{name}.log').open('w') as f:
  r=subprocess.run(prefix+args,cwd=app,env=env,input=input,text=True,stdout=f,stderr=subprocess.STDOUT,timeout=90)
 out[case][name+'_exit']=r.returncode;return r.returncode
def http(path,body=None,cookie=''):
 headers={'Origin':env['BETTER_AUTH_URL'],'Content-Type':'application/json'}
 if cookie:headers['Cookie']=cookie
 req=urllib.request.Request(env['BETTER_AUTH_URL']+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 try:r=urllib.request.urlopen(req,timeout=5)
 except urllib.error.HTTPError as e:r=e
 return r.status,json.loads(r.read()),'; '.join(x.split(';')[0] for x in (r.headers.get_all('Set-Cookie') or []))
for case in ['default','special']:
 out[case]={}
 if case=='default':env.pop('POSTGRES_PASSWORD',None)
 else:env['POSTGRES_PASSWORD']='R5!@:/#?% '+secrets.token_hex(12)
 try:
  assert cmd('up',['up','-d','--no-build','--wait','--wait-timeout','55'])==0
  out[case]['health']=http('/api/health')[0]
  assert cmd('migrate',['exec','-T','web','node','node_modules/prisma/build/index.js','migrate','deploy'])==0
  assert cmd('init',['exec','-T','web','node','--import','tsx','scripts/init-owner.ts','--org','Review','--email','container-review@example.test','--name','Reviewer','--demo'],review['E2E_OWNER_PASSWORD']+'\n')==0
  status,_,cookie=http('/api/auth/sign-in/email',{'email':'container-review@example.test','password':review['E2E_OWNER_PASSWORD']});out[case]['login']={'status':status,'cookie_issued':bool(cookie)}
  status,data,_=http('/api/v1/me',cookie=cookie);out[case]['me']={'status':status,'role':data.get('data',{}).get('role')}
  assert cmd('db-timezone',['exec','-T','postgres','psql','-U','aiea','-d','aiea_dev','-At','-c','SHOW timezone'])==0
  invite_status,inv,_=http('/api/v1/invitations',{'email':'time-'+case+'@example.test','role':'operator'},cookie)
  inv_id=inv['data']['id'];token=inv['data']['url'].split('/')[-1]
  q="SELECT extract(epoch from expires_at)*1000 FROM invitation WHERE id='"+inv_id+"'"
  assert cmd('epoch',['exec','-T','postgres','psql','-U','aiea','-d','aiea_dev','-At','-c',q])==0
  from datetime import datetime
  epoch=float((p/'evidence'/f'container-{case}-epoch.log').read_text().strip())
  out[case]['H12_create_epoch_delta_ms']=datetime.fromisoformat(inv['data']['expires_at'].replace('Z','+00:00')).timestamp()*1000-epoch
  q="UPDATE invitation SET created_at=now()-interval '49 hours',expires_at=now()-interval '1 hour' WHERE id='"+inv_id+"'"
  assert cmd('age-invite',['exec','-T','postgres','psql','-U','aiea','-d','aiea_dev','-c',q])==0
  expired_status,_,expired_cookie=http('/api/v1/invitations/'+token+'/accept',{'name':'Expired','password':review['E2E_OWNER_PASSWORD']})
  out[case]['H12_expired_direct']={'status':expired_status,'cookie_issued':bool(expired_cookie)}
  out[case]['public_signup']=[http('/api/auth/sign-up/email',{'email':'public@example.test','name':'Public','password':review['E2E_OWNER_PASSWORD']})[0] for _ in range(2)]
  cmd('worker',['exec','-T','worker','node','dist/jobs/status.js']);cmd('ps',['ps'])
 except Exception as e:out[case]['error']=str(e)
 finally:
  cmd('down',['down','--volumes','--remove-orphans']);(p/'evidence/container-results.json').write_text(json.dumps(out,indent=2));print(case,json.dumps(out[case]),flush=True)
