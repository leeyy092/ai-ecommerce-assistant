import os,json,subprocess,time,sys,pathlib
T=pathlib.Path(__file__).resolve().parent
C=json.loads((T/'config.json').read_text());E=json.loads((T/'env.json').read_text());A=C['app'];V=T/'evidence'
def run(name,args,timeout=600,env=None,cwd=None):
 start=time.monotonic()
 with (V/(name+'.log')).open('wb') as log:
  try:p=subprocess.run(args,cwd=cwd or A,env=env or E,stdout=log,stderr=subprocess.STDOUT,timeout=timeout);code=p.returncode
  except subprocess.TimeoutExpired:code=124
 result={'name':name,'args':args,'exit':code,'seconds':round(time.monotonic()-start,2)}
 (V/(name+'.json')).write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True);return code
if __name__=='__main__':
 name=sys.argv[1];args=sys.argv[2:];sys.exit(run(name,args))
