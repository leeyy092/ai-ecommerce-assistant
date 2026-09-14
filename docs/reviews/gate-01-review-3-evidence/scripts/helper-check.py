from pathlib import Path
import os,json,subprocess
p=Path(__file__).parent;app=p/'repo/ai-ecommerce-assistant';env=os.environ.copy();env.update(json.loads((p/'env.json').read_text()));env['DATABASE_URL']=env['DATABASE_URL'].rsplit('/',1)[0]+'/aiea_review_helper';env['PATH']=str(Path((p/'root.txt').read_text())/'ai-ecommerce-assistant/.tools/node24/bin')+':'+env['PATH']
subprocess.run(['pnpm','exec','prisma','migrate','deploy'],cwd=app,env=env)
