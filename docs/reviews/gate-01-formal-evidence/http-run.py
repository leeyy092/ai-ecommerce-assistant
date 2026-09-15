import pathlib,os,json,subprocess,socket,time,urllib.request
root=pathlib.Path(__file__).parent;app=root/'repo/ai-ecommerce-assistant'
env=dict(os.environ);env.update(json.loads((root/'env.json').read_text()))
env['PATH']='/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/.tools/node24/bin:'+env['PATH']
sock=socket.socket();sock.bind(('127.0.0.1',3000));sock.close()
with (root/'web.log').open('w') as log:
    web=subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT)
    try:
        for i in range(60):
            if web.poll() is not None:raise RuntimeError('Web exited before readiness')
            try:
                with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=1) as response:
                    if response.status==200:break
            except Exception:time.sleep(.5)
        else:raise RuntimeError('Web readiness timed out')
        subprocess.run(['/usr/bin/python3',str(root/'run.py'),'http-probes'],check=True)
    finally:
        web.terminate()
        try:web.wait(timeout=10)
        except subprocess.TimeoutExpired:web.kill();web.wait()
