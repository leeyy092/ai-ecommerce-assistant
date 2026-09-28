-- G4R3 H01/T01：RuleEvaluation/Alert 唯一键纳入 evaluation_at——同元组新评估写自己的行，
-- 发布 CAS 前不再原地改写旧发布身份的规则/告警行；构建期仅清理"非已发布身份"的更旧行，
-- 发布成功后清理同元组全部非当前评估行（与 daily_metric 同一口径）。
DROP INDEX "rule_evaluation_org_id_store_id_rule_id_rule_version_entity_key";
CREATE UNIQUE INDEX "rule_evaluation_eval_identity_key"
  ON "rule_evaluation" (org_id, store_id, rule_id, rule_version, entity_key, subchannel,
                        period_start, period_end, dataset_version, ruleset_version, evaluation_at);
DROP INDEX "alert_org_id_store_id_rule_id_entity_key_subchannel_period__key";
CREATE UNIQUE INDEX "alert_eval_identity_key"
  ON "alert" (org_id, store_id, rule_id, entity_key, subchannel,
              period_start, period_end, rule_version, dataset_version, ruleset_version, evaluation_at);
