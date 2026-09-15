import os, pathlib, json, subprocess, sys, time
root = pathlib.Path(__file__).parent
app = root/'repo/ai-ecommerce-assistant'
env = dict(os.environ)
env.update(json.loads((root/'env.json').read_text()))
env['PATH'] = '/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/.tools/node24/bin:' + env['PATH']
commands = {
    'migrate': ['pnpm','exec','prisma','migrate','deploy'],
    'typecheck': ['pnpm','typecheck'],
    'unit': ['pnpm','test'],
    'integration': ['pnpm','test:integration'],
    'build': ['pnpm','build'],
    'e2e': ['pnpm','test:e2e'],
    'http-probes': ['pnpm','exec','tsx','review-probes.ts'],
}
for name in sys.argv[1:]:
    start=time.monotonic()
    env['REVIEW_OUT']=str(root/(name+'.json'))
    with (root/(name+'.log')).open('w') as log:
        result=subprocess.run(commands[name],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=300)
    print(json.dumps({'check':name,'exit':result.returncode,'seconds':round(time.monotonic()-start,2)}),flush=True)
    with (root/'check-results.jsonl').open('a') as f:
        f.write(json.dumps({'check':name,'exit':result.returncode})+'\n')
    if result.returncode:sys.exit(result.returncode)
