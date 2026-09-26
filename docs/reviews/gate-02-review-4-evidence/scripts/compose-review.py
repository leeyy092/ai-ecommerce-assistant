import sys,pathlib,json,subprocess,os,secrets,socket,time,urllib.request,urllib.error,urllib.parse,http.cookiejar,hashlib,hmac
R=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(R));from run import run,E
C=R/'compose';C.mkdir(exist_ok=True);subprocess.run(['tar','-xf',str(R/'application.tar'),'-C',str(C)],check=True)
P='aiea-review4-t6xh';steps=[]
def mark(name,expected,actual):
 steps.append({'name':name,'expected':expected,'actual':actual,'status':'PASS' if actual==expected else 'FAIL'});(R/'evidence/compose-assertions.json').write_text(json.dumps(steps,indent=2));print(name,steps[-1]['status'],flush=True);assert actual==expected
ports=[]
for _ in range(2):
 s=socket.socket();s.bind(('127.0.0.1',0));ports.append(s.getsockname()[1]);s.close()
ports=json.loads((R/'compose-config.json').read_text()).get('ports',ports) if (R/'compose-config.json').exists() else ports
if (R/'compose-config.json').exists():
 old=json.loads((R/'compose-config.json').read_text());ports=[old['pgport'],old['webport']]
pgport,webport=ports;B=f'http://127.0.0.1:{webport}';pw=secrets.token_hex(20);secret=secrets.token_hex(32);ownerpw='Review4-'+secrets.token_hex(20)
(C/'.env').write_text(f'POSTGRES_PASSWORD={pw}\nBETTER_AUTH_SECRET={secret}\nBETTER_AUTH_URL={B}\n');os.chmod(C/'.env',0o600)
p=C/'compose.yaml';p.write_text(p.read_text().replace('127.0.0.1:5433:5432',f'127.0.0.1:{pgport}:5432').replace('127.0.0.1:3000:3000',f'127.0.0.1:{webport}:3000'))
canary='synthetic-review4-canary-'+secrets.token_hex(12);d=C/'.data/private';d.mkdir(parents=True,exist_ok=True);(d/'canary.txt').write_text(canary)
(R/'compose-config.json').write_text(json.dumps({'project':P,'context':str(C),'pgport':pgport,'webport':webport,'canary':canary},indent=2))
cmd=['docker','compose','-p',P]
CE=E.copy();CE.update(BETTER_AUTH_URL=B,BETTER_AUTH_SECRET=secret,POSTGRES_PASSWORD=pw)
def crun(name,args,**kw):return run(name,cmd+args,cwd=str(C),env=CE,**kw)
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def http(path,body=None,typ='application/json'):
 headers={'origin':B};data=None
 if list(jar):headers['Cookie']='; '.join(c.name+'='+c.value for c in jar)
 if body is not None:headers['content-type']=typ;data=json.dumps(body).encode() if isinstance(body,dict) else body
 req=urllib.request.Request(B+path,data=data,headers=headers)
 try:
  with opener.open(req,timeout=15) as res:return res.status,res.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def api(path,body=None):
 code,b=http(path,body);return code,json.loads(b)
def healthy():
 for i in range(60):
  try:
   if http('/api/health')[0]==200:return 200
  except Exception:pass
  time.sleep(1)
 return 0
try:
 mark('actual web image build exit',0,crun('compose-build-web',['build','web'],timeout=720))
 mark('actual worker image build exit',0,crun('compose-build-worker',['build','worker'],timeout=300))
 code=run('compose-canary',['docker','run','--rm',P+'-web','node','-e',"const fs=require('fs');if(fs.existsSync('/app/.data'))process.exit(1);console.log('no .data in image')"],timeout=30)
 mark('private .data canary excluded',0,code)
 mark('compose up exit',0,crun('compose-up',['up','-d'],timeout=120));mark('web health',200,healthy())
 env=E.copy();env['DATABASE_URL']=f'postgresql://aiea:{pw}@127.0.0.1:{pgport}/aiea_dev'
 mark('official migrations exit',0,run('compose-migrate',['pnpm','exec','prisma','migrate','deploy'],env=env,timeout=60))
 with (R/'evidence/compose-owner.log').open('wb') as log:
  p=subprocess.run(cmd+['exec','-T','web','node','dist/scripts/init-owner.js','--org','Review4Container','--email','owner-review4@example.test','--name','Owner'],input=ownerpw.encode(),cwd=C,env=CE,stdout=log,stderr=subprocess.STDOUT,timeout=30)
 mark('container init-owner exit',0,p.returncode)
 code,_=api('/api/auth/sign-in/email',{'email':'owner-review4@example.test','password':ownerpw});mark('container login',200,code)
 code,b=api('/api/v1/stores',{'name':'Review4 Store','external_store_id':'REVIEW4','platform':'manual','currency':'CNY','timezone':'Asia/Shanghai'});mark('container create store',201,code);sid=b['data']['id']
 code,b=api('/api/v1/data-sources',{'store_id':sid,'name':'csv','adapter_kind':'csv','source_namespace':'review4'});mark('container create source',201,code);did=b['data']['id']
 csv=b'store_external_id,source_updated_at,external_product_id,product_name,category,product_status,external_sku_id,sku_code,sku_name,specification,sku_status\nREVIEW4,2026-09-11T00:00:00Z,P1,Product,,active,S1,SKU1,Name,,active\n'
 boundary='review4-container-multipart';body=''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k,v in [('store_id',sid),('data_source_id',did),('entity_type','products')]).encode()+f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="products.csv"\r\nContent-Type: text/csv\r\n\r\n'.encode()+csv+f'\r\n--{boundary}--\r\n'.encode()
 code,b=http('/api/v1/imports',body,'multipart/form-data; boundary='+boundary);mark('container upload response',201,code);task=json.loads(b)['data']['id']
 status='unknown'
 for i in range(45):
  code,b=api('/api/v1/imports/'+task);status=b.get('data',{}).get('status')
  if status in ['preview_ready','failed']:break
  time.sleep(1)
 mark('built Worker validation','preview_ready',status)
 def download():
  expires=str(int(time.time()*1000)+300000);key='raw/'+task+'/source.csv';sig=hmac.new(secret.encode(),(key+':'+expires).encode(),hashlib.sha256).hexdigest();return http('/api/v1/imports/'+task+'/file?expires='+expires+'&signature='+sig)
 code,b=http('/api/v1/imports/'+task+'/file');mark('unsigned file denied',403,code)
 code,b=download();mark('signed download matches',[200,True],[code,b==csv])
 mark('container restart exit',0,crun('compose-restart',['restart','web','worker'],timeout=60));mark('health after restart',200,healthy());code,b=download();mark('read after restart matches',[200,True],[code,b==csv])
 crun('compose-ps',['ps'],timeout=20)
 crun('compose-worker-logs',['logs','--no-color','worker'],timeout=20)
finally:
 crun('compose-down',['down','-v','--remove-orphans'],timeout=60)
 if all(x['status']=='PASS' for x in steps):run('compose-rmi',['docker','image','rm',P+'-web',P+'-worker'],timeout=30)
 for name,args in [('containers',['docker','ps','-a','--filter','label=com.docker.compose.project='+P,'-q']),('volumes',['docker','volume','ls','--filter','label=com.docker.compose.project='+P,'-q']),('networks',['docker','network','ls','--filter','label=com.docker.compose.project='+P,'-q'])]:
  p=subprocess.run(args,env=E,capture_output=True,text=True);mark('own '+name+' cleaned','',p.stdout.strip())
 (C/'.env').unlink(missing_ok=True)
