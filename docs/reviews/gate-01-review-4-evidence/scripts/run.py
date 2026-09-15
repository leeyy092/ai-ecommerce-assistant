from pathlib import Path
import os,json,subprocess,time,sys
p=Path(__file__).parent
app=p/'repo/ai-ecommerce-assistant'
env=os.environ.copy();env.update(json.loads((p/'env.json').read_text()));env['PATH']=str(Path((p/'root.txt').read_text())/'ai-ecommerce-assistant/.tools/node24/bin')+':'+env['PATH']
for spec in sys.argv[1:]:
 name,command=spec.split('=',1);start=time.time()
 with (p/'evidence'/f'{name}.log').open('w') as f:
  try:r=subprocess.run(command.split(),cwd=app,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600);code=r.returncode
  except subprocess.TimeoutExpired:code='TIMEOUT'
 row={'name':name,'command':command,'exit':code,'seconds':round(time.time()-start,2)}
 with (p/'evidence/checks.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
 print(json.dumps(row),flush=True)
 print((p/'evidence'/f'{name}.log').read_text()[-1800:],flush=True)
