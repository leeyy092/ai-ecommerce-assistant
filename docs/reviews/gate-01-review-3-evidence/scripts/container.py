from pathlib import Path
import os,json,subprocess,time,urllib.request,urllib.error,secrets
p=Path(__file__).parent;app=p/'clean-context/ai-ecommerce-assistant';env=os.environ.copy();review=json.loads((p/'env.json').read_text());env['BETTER_AUTH_SECRET']=review['BETTER_AUTH_SECRET'];env['BETTER_AUTH_URL']='http://127.0.0.1:3300';env.pop('POSTGRES_PASSWORD',None)
override=p/'compose-review.yaml';override.write_text('''services:
  postgres:
    ports: !override
      - "127.0.0.1:55479:5432"
  web:
    image: aiea-r3-review:clean-9a5798c
    ports: !override
      - "127.0.0.1:3300:3000"
  worker:
    image: aiea-r3-review:clean-9a5798c
''')
prefix=['docker','compose','-p','aiea-r3-codex-9a5798c','--project-directory',str(app),'-f',str(app/'compose.yaml'),'-f',str(override)]
out={'source':'9a5798c git archive','review_only_overrides':['unique project and image name','loopback ports 3300 and 55479','runtime auth secret/url'],'steps':{}}
def cmd(name,args,input=None,timeout=120):
 with (p/'evidence'/f'container-{name}.log').open('w') as f:
  try:r=subprocess.run(prefix+args,cwd=app,env=env,input=input,text=True,stdout=f,stderr=subprocess.STDOUT,timeout=timeout);code=r.returncode
  except subprocess.TimeoutExpired:code='TIMEOUT'
 out['steps'][name]={'exit':code,'args':args};print(name,code,flush=True);return code
def http(path,body=None,cookie=''):
 headers={'Origin':env['BETTER_AUTH_URL'],'Content-Type':'application/json'}
 if cookie:headers['Cookie']=cookie
 req=urllib.request.Request(env['BETTER_AUTH_URL']+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 try:res=urllib.request.urlopen(req,timeout=4)
 except urllib.error.HTTPError as e:res=e
 raw=res.read().decode();data=json.loads(raw) if raw else None
 return res.status,data,'; '.join(x.split(';')[0] for x in (res.headers.get_all('Set-Cookie') or []))
try:
 assert cmd('up',['up','-d','--no-build','--wait','--wait-timeout','50'])==0
 for i in range(30):
  try:
   status,_,_=http('/api/health')
   if status==200:break
  except Exception:pass
  time.sleep(.5)
 out['health']=status
 assert cmd('migrate',['exec','-T','web','node','node_modules/prisma/build/index.js','migrate','deploy'])==0
 assert cmd('init-owner',['exec','-T','web','node','--import','tsx','scripts/init-owner.ts','--org','Review','--email','docker-review@example.test','--name','Reviewer','--demo'],review['E2E_OWNER_PASSWORD']+'\n')==0
 status,body,cookie=http('/api/auth/sign-in/email',{'email':'docker-review@example.test','password':review['E2E_OWNER_PASSWORD']});out['login']={'status':status,'cookieIssued':bool(cookie)}
 status,body,_=http('/api/v1/me',cookie=cookie);out['me']={'status':status,'role':(body or {}).get('data',{}).get('role')}
 out['public_signup']=[http('/api/auth/sign-up/email',{'email':'public@example.test','password':review['E2E_OWNER_PASSWORD'],'name':'Public'})[0] for i in range(2)]
 cmd('worker-status',['exec','-T','worker','node','dist/jobs/status.js']);cmd('ps',['ps'])
finally:
 cmd('down',['down','--volumes','--remove-orphans']);(p/'evidence/container-results.json').write_text(json.dumps(out,indent=2))
env['POSTGRES_PASSWORD']=secrets.token_hex(16)
try:
 cmd('custom-password-up',['up','-d','--no-build'])
 time.sleep(6)
 try:out['custom_password_health']=http('/api/health')[0]
 except Exception as e:out['custom_password_health']=type(e).__name__
 cmd('custom-password-worker-status',['exec','-T','worker','node','dist/jobs/status.js'])
 cmd('custom-password-logs',['logs','--tail','35','web','worker'])
finally:
 cmd('custom-password-down',['down','--volumes','--remove-orphans']);(p/'evidence/container-results.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
