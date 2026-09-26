"""Create a disposable review copy. Does not run tests or change the source checkout."""
import argparse, pathlib, tempfile, json, os, secrets, subprocess, socket, shutil
p=argparse.ArgumentParser()
p.add_argument('--repo',required=True)
p.add_argument('--ref',default='ce5f28699910e19310b790d31a6e8871a78b5e58')
p.add_argument('--node-bin',required=True)
p.add_argument('--pg-bin',required=True)
a=p.parse_args();R=pathlib.Path(a.repo).resolve();S=pathlib.Path(__file__).parent
for port in [55572,3322,3000]:
    with socket.socket() as s:s.bind(('127.0.0.1',port))
head=subprocess.check_output(['git','rev-parse',a.ref],cwd=R,text=True).strip()
T=pathlib.Path(tempfile.mkdtemp(prefix='aiea-g2-reproduce-'));(T/'repo').mkdir();(T/'evidence').mkdir()
archive=subprocess.Popen(['git','archive',head],cwd=R,stdout=subprocess.PIPE)
subprocess.run(['tar','-x','-C',str(T/'repo')],stdin=archive.stdout,check=True)
archive.stdout.close();assert archive.wait()==0
A=T/'repo/ai-ecommerce-assistant'
E=dict(os.environ)
for key in list(E):
    if key.startswith('PG') or key in ['DATABASE_URL','BETTER_AUTH_SECRET','BETTER_AUTH_URL']:E.pop(key,None)
E.update({'PATH':a.node_bin+':'+a.pg_bin+':'+os.environ.get('PATH',''),'DATABASE_URL':'postgresql://reviewer@127.0.0.1:55572/review','BETTER_AUTH_SECRET':secrets.token_hex(32),'BETTER_AUTH_URL':'http://127.0.0.1:3322','PORT':'3322','STORAGE_DRIVER':'local','STORAGE_PRIVATE_ROOT':str(T/'private'),'NEXT_TELEMETRY_DISABLED':'1'})
(T/'env.json').write_text(json.dumps(E));os.chmod(T/'env.json',0o600)
(T/'config.json').write_text(json.dumps({'root':str(R),'app':str(A),'head':head,'main':'4c7e95b925c2b04aa2c1116979678cac7af091f2'}))
shutil.copy2(S/'run.py',T/'run.py')
for f in S.glob('review-*.ts'):(A/f.name).write_text(f.read_text().replace('/tmp/aiea-g2-review-h99ruviq',str(T)))
print(T)
