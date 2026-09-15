import pathlib,subprocess,json,os,time,signal,urllib.request
r=pathlib.Path(__file__).parent;a=r/'snapshot/ai-ecommerce-assistant';env=os.environ.copy();env.update(json.loads((r/'env.json').read_text()));out={}
p=subprocess.Popen(['node','dist/jobs/worker.js'],cwd=a,env=env,stdout=open(r/'logs/worker.log','w'),stderr=subprocess.STDOUT)
for _ in range(30):
 time.sleep(.1)
 s=subprocess.run(['node','dist/jobs/status.js'],cwd=a,env=env,capture_output=True,text=True)
 if s.returncode==0:break
out['workerRunningExit']=s.returncode;p.terminate();p.wait(timeout=5)
s=subprocess.run(['node','dist/jobs/status.js'],cwd=a,env=env,capture_output=True,text=True);out['workerStoppedExit']=s.returncode
missing=env.copy();missing.pop('DATABASE_URL',None)
s=subprocess.run(['node','dist/jobs/worker.js'],cwd=a,env=missing,capture_output=True,text=True);out['workerMissingDbExit']=s.returncode;out['workerMissingDbNamed']='DATABASE_URL' in s.stderr
missingAuth=env.copy();missingAuth.pop('BETTER_AUTH_SECRET',None);missingAuth.pop('BETTER_AUTH_URL',None)
s=subprocess.run(['pnpm','start','--port','3001','--hostname','127.0.0.1'],cwd=a,env=missingAuth,capture_output=True,text=True,timeout=15);out['webMissingAuthExit']=s.returncode;out['webMissingAuthNamed']=all(x in s.stderr+s.stdout for x in ['BETTER_AUTH_SECRET','BETTER_AUTH_URL'])
with urllib.request.urlopen('http://127.0.0.1:3000/api/health') as resp:out['health']={'status':resp.status,'body':json.load(resp)}
(r/'logs/runtime-probes.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
