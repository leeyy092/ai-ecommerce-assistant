import pathlib, json, os, subprocess, time, sys
ROOT = pathlib.Path(__file__).resolve().parent
C = json.loads((ROOT / 'context.json').read_text())
ENV = os.environ.copy()
for k in list(ENV):
    if k.lower() in ('http_proxy', 'https_proxy', 'all_proxy'): ENV.pop(k)
ENV.update(PATH=C['node'] + ':' + ENV['PATH'], DATABASE_URL=f"postgresql://postgres@127.0.0.1:{C['pg_port']}/aiea_review", BETTER_AUTH_SECRET='g3r3-synthetic-secret-0123456789abcdef', BETTER_AUTH_URL=f"http://127.0.0.1:{C['web_port']}", STORAGE_DRIVER='local', PRISMA_HIDE_UPDATE_MESSAGE='1', NEXT_TELEMETRY_DISABLED='1', CI='1', E2E_BASE_URL=f"http://127.0.0.1:{C['web_port']}", E2E_OWNER_PASSWORD='g3r3-synthetic-password-123', TMPDIR=str(ROOT/'tmp'))
(ROOT/'tmp').mkdir(exist_ok=True)
def run(name, args, cwd=None):
    start=time.time()
    with (ROOT/'evidence'/f'{name}.log').open('wb') as out:
        p=subprocess.run(args,cwd=cwd or ROOT/'repo',env=ENV,stdout=out,stderr=subprocess.STDOUT)
    result={'command':args,'cwd':str(cwd or ROOT/'repo'),'exit_code':p.returncode,'seconds':round(time.time()-start,3),'started_at':time.strftime('%Y-%m-%dT%H:%M:%S%z',time.localtime(start))}
    (ROOT/'evidence'/f'{name}.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'step':name,**result}),flush=True)
    return p.returncode
if __name__=='__main__':
    if sys.argv[1]=='setup':
        pg=C['pg_bin']
        for name,args in [
            ('node-version',[C['node']+'/node','--version']),
            ('pg-version',[pg+'/postgres','--version']),
            ('initdb',[pg+'/initdb','-D',str(ROOT/'pgdata'),'-U','postgres','--auth=trust','--encoding=UTF8','--no-locale']),
            ('pg-start',[pg+'/pg_ctl','-D',str(ROOT/'pgdata'),'-l',str(ROOT/'evidence'/'postgres.log'),'-o',f"-p {C['pg_port']} -h 127.0.0.1 -k {ROOT/'pgsock'}",'start']),
            ('createdb',[pg+'/createdb','-h','127.0.0.1','-p',str(C['pg_port']),'-U','postgres','aiea_review']),
            ('install',[C['node']+'/pnpm','install','--frozen-lockfile','--offline']),
            ('generate',[C['node']+'/pnpm','exec','prisma','generate']),
            ('migrate',[C['node']+'/pnpm','exec','prisma','migrate','deploy']),
        ]:
            code=run(name,args)
            if code:sys.exit(code)
    else:
        sys.exit(run(sys.argv[1],sys.argv[2:]))
