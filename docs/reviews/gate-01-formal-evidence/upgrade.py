import pathlib,subprocess,os,json,shutil
r=pathlib.Path(__file__).parent;app=r/'repo/ai-ecommerce-assistant';env=os.environ.copy();env.update(json.loads((r/'env.json').read_text()));env['PATH']='/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/.tools/node24/bin:'+env['PATH'];env['DATABASE_URL']='postgresql://yuyuyu@127.0.0.1:55459/aiea_upgrade_formal'
def migrate(name,config=None):
 args=['pnpm','exec','prisma','migrate','deploy']+(['--config',str(config)] if config else [])
 with open(r/f'{name}.log','w') as f:ret=subprocess.run(args,cwd=app,env=env,stdout=f,stderr=subprocess.STDOUT)
 if ret.returncode:raise Exception((r/f'{name}.log').read_text())
def q(s):
 p=subprocess.run(['/opt/homebrew/opt/postgresql@17/bin/psql','-h','127.0.0.1','-p','55459','-d','aiea_upgrade_formal','-X','-At','-v','ON_ERROR_STOP=1','-c',s],capture_output=True,text=True,check=True);return p.stdout.strip()
migrate('upgrade-baseline',app/'review-upgrade/prisma.config.ts')
q("""INSERT INTO domain_user(id,auth_user_id,email,display_name,created_at,updated_at) VALUES ('10000000-0000-4000-8000-000000000001','upgrade1','upgrade1@example.test','upgrade1','2026-01-01 12:00:00','2026-01-01 12:00:00'),('10000000-0000-4000-8000-000000000002','upgrade2','upgrade2@example.test','upgrade2','2026-01-01 12:00:00','2026-01-01 12:00:00');
INSERT INTO organization(id,name,owner_user_id,updated_at) VALUES ('20000000-0000-4000-8000-000000000001','upgradeA','10000000-0000-4000-8000-000000000001',now()),('20000000-0000-4000-8000-000000000002','upgradeB','10000000-0000-4000-8000-000000000002',now());
INSERT INTO store(id,org_id,name,external_store_id,platform,currency,timezone,ruleset_version,updated_at) VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','upgrade store','upgrade-store','manual','CNY','Asia/Shanghai','v1',now());
INSERT INTO audit_log(id,org_id,store_id,action,entity_type,entity_id,request_id,updated_at) VALUES ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','upgrade','upgrade','upgrade','upgrade',now());""")
migrate('upgrade-forward'); migrate('migrate-repeat')
results={'forward_deploy_exit':0,'repeat_deploy_exit':0,'migration_count':q('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'),'utc_wallclock_preserved':q("SELECT created_at='2026-01-01 12:00:00+00'::timestamptz FROM domain_user WHERE auth_user_id='upgrade1'")=='t','existing_cross_org_audit_survives_upgrade':q('SELECT count(*) FROM audit_log a JOIN store s ON s.id=a.store_id WHERE a.org_id<>s.org_id')=='1'}
(r/'upgrade-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
