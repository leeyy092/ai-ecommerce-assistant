from pathlib import Path
import os,json,subprocess,uuid
p=Path(__file__).parent;root=Path((p/'root.txt').read_text());app=p/'repo/ai-ecommerce-assistant';oldapp=p/'old/ai-ecommerce-assistant'
env=os.environ.copy();env.update(json.loads((p/'env.json').read_text()));env['PATH']=str(root/'ai-ecommerce-assistant/.tools/node24/bin')+':'+env['PATH'];pg='/opt/homebrew/opt/postgresql@17/bin/';result={}
def sql(db,s):return subprocess.check_output([pg+'psql','-h','127.0.0.1','-p','55469','-d',db,'-X','-v','ON_ERROR_STOP=1','-At','-c',s],text=True)
def mig(db,cwd,label):
 env['DATABASE_URL']=env['DATABASE_URL'].rsplit('/',1)[0]+'/'+db
 with (p/'evidence'/f'{label}.log').open('w') as f:r=subprocess.run(['node',str(app/'node_modules/prisma/build/index.js'),'migrate','deploy'],cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=40)
 return r.returncode
for kind in ['good','bad_audit','bad_identity']:
 db='aiea_r3_real_upgrade_'+kind;subprocess.run([pg+'createdb','-h','127.0.0.1','-p','55469',db],check=True);baseline=mig(db,oldapp,'real-upgrade-'+kind+'-baseline');assert baseline==0
 u,v,a,b,s=[str(uuid.uuid4()) for i in range(5)]
 fixture=f'''INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('a','a','a@example.test',false,now(),now()),('b','b','b@example.test',false,now(),now());
 INSERT INTO domain_user(id,auth_user_id,email,display_name,updated_at) VALUES('{u}','a','a@example.test','a',now()),('{v}','b','b@example.test','b',now());
 INSERT INTO organization(id,name,owner_user_id,updated_at) VALUES('{a}','A','{u}',now()),('{b}','B','{v}',now());
 INSERT INTO store(id,org_id,name,external_store_id,platform,currency,timezone,updated_at,input_evaluation_at) VALUES('{s}','{a}','S','S','manual','CNY','Asia/Shanghai',now(),'2026-01-01 12:00:00');''';sql(db,fixture)
 if kind=='bad_audit':sql(db,f"INSERT INTO audit_log(id,org_id,store_id,action,entity_type,entity_id,request_id,updated_at) VALUES('{uuid.uuid4()}','{a}','{s}','probe','probe','probe','{uuid.uuid4()}',now()); UPDATE store SET org_id='{b}' WHERE id='{s}';")
 if kind=='bad_identity':sql(db,f"UPDATE domain_user SET auth_user_id='missing' WHERE id='{u}';")
 upgrade=mig(db,app,'real-upgrade-'+kind+'-forward');row={'baseline_exit':baseline,'forward_exit':upgrade}
 if kind=='good':row.update({'repeat_exit':mig(db,app,'real-upgrade-good-repeat'),'utc_preserved':sql(db,"SET TIME ZONE 'UTC'; SELECT input_evaluation_at::text FROM store;").strip(),'domain_without_tz':sql(db,"SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND data_type='timestamp without time zone' AND table_name NOT IN ('user','session','account','verification');").strip()})
 else:row['error_tail']=(p/'evidence'/f'real-upgrade-{kind}-forward.log').read_text()[-900:]
 result[kind]=row
(p/'evidence/upgrade-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
