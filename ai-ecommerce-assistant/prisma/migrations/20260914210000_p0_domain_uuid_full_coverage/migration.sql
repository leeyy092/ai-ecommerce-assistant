-- Gate-01 REVIEW_4 M04｜领域主键 UUID 格式约束全量覆盖（补齐 R3 遗漏的 11 张）。
-- 合同（04_DATA_MODEL）："所有 P0 实体采用 UUID 领域主键"。R3 迁移仅约束 17 张，
-- 遗漏 daily_metric/voc_insight/rule_evaluation/alert/ai_insight/action_state/
-- ai_report/ai_run/import_task/data_coverage/job_run（实测 JobRun 非法 ID 可写入）。
-- 本迁移按 Schema 全量枚举补齐至 28/28 领域表；存量坏行守卫拒绝静默通过。
-- 范围界定：认证框架四表（user/session/account/verification）保持框架原生
-- string 主键不动；auth_rate_limit 为认证辅助表（非领域实体、非框架四表），
-- 经核定其 uuid 主键一并约束（约束名单列），以便区分与追踪。

DO $$
DECLARE
  bad BIGINT;
  t TEXT;
  tbls TEXT[] := ARRAY[
    'daily_metric','voc_insight','rule_evaluation','alert','ai_insight',
    'action_state','ai_report','ai_run','import_task','data_coverage','job_run'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE id !~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''',
      t) INTO bad;
    IF bad > 0 THEN
      RAISE EXCEPTION '表 % 存在 % 条非 UUID 格式的主键 id，拒绝升级；请先人工核对', t, bad;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT ck_domain_uuid_%s CHECK (id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'') NOT VALID',
      t, t);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT ck_domain_uuid_%s', t, t);
  END LOOP;

  -- auth_rate_limit（认证辅助表，单独核定）：uuid 主键同款格式约束
  EXECUTE 'SELECT count(*) FROM auth_rate_limit WHERE id !~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''' INTO bad;
  IF bad > 0 THEN
    RAISE EXCEPTION 'auth_rate_limit 存在 % 条非 UUID 格式的主键 id，拒绝升级', bad;
  END IF;
  EXECUTE 'ALTER TABLE auth_rate_limit ADD CONSTRAINT ck_auth_rate_limit_uuid CHECK (id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'') NOT VALID';
  EXECUTE 'ALTER TABLE auth_rate_limit VALIDATE CONSTRAINT ck_auth_rate_limit_uuid';
END $$;
