import subprocess,pathlib,json
r=pathlib.Path(__file__).parent; pg='/opt/homebrew/opt/postgresql@17/bin/psql'; results={}
def q(sql,db='aiea_review2'):
 p=subprocess.run([pg,'-h','127.0.0.1','-p','55449','-d',db,'-X','-At','-v','ON_ERROR_STOP=1','-c',sql],text=True,capture_output=True)
 if p.returncode: raise Exception(p.stderr)
 return p.stdout.strip()
results['remaining_domain_timestamp_without_timezone']=json.loads(q("SELECT json_agg(x) FROM (SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='timestamp without time zone' AND table_name NOT IN ('user','session','account','verification') ORDER BY table_name,column_name)x"))
results['domain_timezone_types']=json.loads(q("SELECT json_agg(x) FROM (SELECT data_type,count(*)::int FROM information_schema.columns WHERE table_schema='public' AND data_type LIKE 'timestamp%' AND table_name NOT IN ('user','session','account','verification','_prisma_migrations') GROUP BY data_type)x"))
q("""INSERT INTO domain_user(id,auth_user_id,email,display_name,updated_at) VALUES ('10000000-0000-4000-8000-000000000001','probe1','probe1@example.test','probe1',now()),('10000000-0000-4000-8000-000000000002','probe2','probe2@example.test','probe2',now());
INSERT INTO organization(id,name,owner_user_id,updated_at) VALUES ('20000000-0000-4000-8000-000000000001','probeA','10000000-0000-4000-8000-000000000001',now()),('20000000-0000-4000-8000-000000000002','probeB','10000000-0000-4000-8000-000000000002',now());
INSERT INTO store(id,org_id,name,external_store_id,platform,currency,timezone,ruleset_version,updated_at) VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','probe store','probe-store','manual','CNY','Asia/Shanghai','v1',now());
INSERT INTO audit_log(id,org_id,store_id,action,entity_type,entity_id,request_id,updated_at) VALUES ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','probe','probe','probe','probe',now());""")
q("UPDATE store SET org_id='20000000-0000-4000-8000-000000000002' WHERE id='30000000-0000-4000-8000-000000000001'")
results['audit_parent_change_leaves_cross_org']=q("SELECT count(*) FROM audit_log a JOIN store s ON s.id=a.store_id WHERE a.org_id<>s.org_id")=='1'
q("DELETE FROM store WHERE id='30000000-0000-4000-8000-000000000001'")
results['audit_store_delete_preserves_org_and_nulls_store']=q("SELECT store_id IS NULL AND org_id='20000000-0000-4000-8000-000000000001' FROM audit_log WHERE id='40000000-0000-4000-8000-000000000001'")=='t'
q("""BEGIN; SET LOCAL TIME ZONE 'UTC'; INSERT INTO domain_user(id,auth_user_id,email,display_name,updated_at) VALUES ('10000000-0000-4000-8000-000000000003','tz3','tz3@example.test','tz3',now()); SET LOCAL TIME ZONE 'Asia/Shanghai'; INSERT INTO domain_user(id,auth_user_id,email,display_name,updated_at) VALUES ('10000000-0000-4000-8000-000000000004','tz4','tz4@example.test','tz4',now()); COMMIT;""")
results['fixed_created_at_default_equal']=q("SELECT (SELECT created_at FROM domain_user WHERE auth_user_id='tz3')=(SELECT created_at FROM domain_user WHERE auth_user_id='tz4')")=='t'
q("""INSERT INTO store(id,org_id,name,external_store_id,platform,currency,timezone,ruleset_version,input_evaluation_at,updated_at) VALUES ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','tz store 1','tz-store1','manual','CNY','Asia/Shanghai','v1','2026-01-01 12:00:00+00',now()),('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','tz store 2','tz-store2','manual','CNY','Asia/Shanghai','v1','2026-01-01 20:00:00+08',now());""")
results['unfixed_input_evaluation_same_instant_delta_hours']=q("SELECT EXTRACT(epoch FROM ((SELECT input_evaluation_at FROM store WHERE external_store_id='tz-store2')-(SELECT input_evaluation_at FROM store WHERE external_store_id='tz-store1')))/3600")
results['nonuuid_and_missing_auth_accepted']=q("BEGIN; INSERT INTO domain_user(id,auth_user_id,email,display_name,updated_at) VALUES ('not-a-uuid','missing-auth','missing@example.test','missing',now()); SELECT count(*) FROM domain_user WHERE id='not-a-uuid'; ROLLBACK;").splitlines()[-2]=='1'
(r/'logs/db-probes.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
