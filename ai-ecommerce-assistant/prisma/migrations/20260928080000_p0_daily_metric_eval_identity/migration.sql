-- G4R2 H01/C13：DailyMetric 唯一键纳入 evaluation_at，同版重评估写新行而非原地覆盖；
-- 已发布评估的行在新发布 CAS 成功前保持可读（F08 发布身份隔离）。
-- 旧索引名被 PG 截断为 daily_metric_org_id_store_id_metric_id_entity_key_period_st_key。
DROP INDEX "daily_metric_org_id_store_id_metric_id_entity_key_period_st_key";
CREATE UNIQUE INDEX "daily_metric_eval_identity_key"
  ON "daily_metric" (org_id, store_id, metric_id, entity_key, period_start, period_end,
                     dataset_version, ruleset_version, metric_version, evaluation_at);
