import os,json,subprocess,time,sys,pathlib
T=pathlib.Path(__file__).parent
C=json.loads((T/'config.json').read_text()); E=json.loads((T/'env.json').read_text()); A=C['app']; V=T/'evidence'
def run(name,args,cwd=A,timeout=300):
    start=time.monotonic()
    with (V/(name+'.log')).open('wb') as log:
        try:
            p=subprocess.run(args,cwd=cwd,env=E,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
            code=p.returncode
        except subprocess.TimeoutExpired: code=124
    result={'name':name,'args':args,'exit':code,'seconds':round(time.monotonic()-start,2)}
    (V/(name+'.json')).write_text(json.dumps(result,indent=2)); print(json.dumps(result),flush=True)
    return code
if __name__=='__main__':
    phase=sys.argv[1]
    if phase=='setup':
        assert run('initdb',['initdb','-D',str(T/'pgdata'),'-U','reviewer','-A','trust','--no-locale','-E','UTF8'])==0
        with (T/'pgdata/postgresql.conf').open('a') as f:f.write("\nlisten_addresses='127.0.0.1'\nport=55574\ntimezone='Asia/Shanghai'\nunix_socket_directories='"+str(T)+"'\n")
        assert run('pg-start',['pg_ctl','-D',str(T/'pgdata'),'-l',str(V/'postgres.log'),'-w','start'])==0
        assert run('createdb',['createdb','-h','127.0.0.1','-p','55574','-U','reviewer','review'])==0
        assert run('install',['pnpm','install','--offline','--frozen-lockfile'])==0
    if phase=='baseline':
        for name,args in [('typecheck',['pnpm','typecheck']),('unit',['pnpm','test']),('migrate',['pnpm','exec','prisma','migrate','deploy']),('integration',['pnpm','test:integration']),('build',['pnpm','build'])]:
            run(name,args,timeout=600)
    if phase=='web':
        with (V/'web.log').open('wb') as log:
            p=subprocess.Popen(['pnpm','start'],cwd=A,env=E,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            (T/'web.pid').write_text(str(p.pid)); print({'web_pid':p.pid})
    if phase=='worker':
        with (V/'worker.log').open('wb') as log:
            p=subprocess.Popen(['pnpm','worker:start'],cwd=A,env=E,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            (T/'worker.pid').write_text(str(p.pid)); print({'worker_pid':p.pid})
    if phase=='e2e':
        import socket
        with socket.socket() as s:s.bind(('127.0.0.1',3000))
        E.update({'PORT':'3000','BETTER_AUTH_URL':'http://127.0.0.1:3000','E2E_BASE_URL':'http://127.0.0.1:3000'})
        run('e2e',['pnpm','test:e2e'],timeout=180)
    if phase=='probe':
        E['NODE_ENV']='production'
        name=sys.argv[2];run(name,['pnpm','exec','tsx',name+'.ts'],timeout=180)
