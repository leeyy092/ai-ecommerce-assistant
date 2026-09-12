-- TASK-002｜P0 CHECK 约束与部分唯一索引（Prisma schema 无法可靠表达的部分）
-- 依据：docs/ai-ecommerce-assistant/04_DATA_MODEL.md PART 10（v1.1）
-- 说明：仅添加约束，不改表结构；约束名以 ck_/uq_ 前缀便于审计与回滚。

-- ============ organization ============
ALTER TABLE "organization" ADD CONSTRAINT "ck_org_ai_daily_budget" CHECK ("ai_daily_budget" >= 0 AND "ai_daily_budget" <= 20);
ALTER TABLE "organization" ADD CONSTRAINT "ck_org_ai_monthly_budget" CHECK ("ai_monthly_budget" >= 0 AND "ai_monthly_budget" <= 500);
ALTER TABLE "organization" ADD CONSTRAINT "ck_org_daily_message_limit" CHECK ("daily_message_limit" >= 0 AND "daily_message_limit" <= 10000);
ALTER TABLE "organization" ADD CONSTRAINT "ck_org_budget_currency" CHECK ("budget_currency" ~ '^[A-Z]{3}$');

-- ============ membership：单 Owner 部分唯一（org_id）WHERE role='owner' ============
CREATE UNIQUE INDEX "uq_membership_single_owner" ON "membership" ("org_id") WHERE "role" = 'owner';

-- ============ store ============
ALTER TABLE "store" ADD CONSTRAINT "ck_store_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "store" ADD CONSTRAINT "ck_store_dataset_version_nonneg" CHECK ("dataset_version" >= 0);
ALTER TABLE "store" ADD CONSTRAINT "ck_store_current_snapshot_triple" CHECK (
  ("current_snapshot_version" IS NULL AND "current_snapshot_ruleset_version" IS NULL AND "current_snapshot_evaluation_at" IS NULL)
  OR
  ("current_snapshot_version" IS NOT NULL AND "current_snapshot_ruleset_version" IS NOT NULL AND "current_snapshot_evaluation_at" IS NOT NULL)
);
ALTER TABLE "store" ADD CONSTRAINT "ck_store_previous_snapshot_triple" CHECK (
  ("previous_snapshot_version" IS NULL AND "previous_snapshot_ruleset_version" IS NULL AND "previous_snapshot_evaluation_at" IS NULL)
  OR
  ("previous_snapshot_version" IS NOT NULL AND "previous_snapshot_ruleset_version" IS NOT NULL AND "previous_snapshot_evaluation_at" IS NOT NULL)
);
ALTER TABLE "store" ADD CONSTRAINT "ck_store_ruleset_version_nonempty" CHECK (length("ruleset_version") >= 1);

-- ============ order：付款状态/时间条件与币种 ============
ALTER TABLE "order" ADD CONSTRAINT "ck_order_paid_iff_paid_at" CHECK (
  ("payment_status" = 'paid' AND "paid_at" IS NOT NULL)
  OR
  ("payment_status" <> 'paid' AND "paid_at" IS NULL)
);
ALTER TABLE "order" ADD CONSTRAINT "ck_order_ordered_before_paid" CHECK ("paid_at" IS NULL OR "ordered_at" <= "paid_at");
ALTER TABLE "order" ADD CONSTRAINT "ck_order_expected_item_count" CHECK ("expected_item_count" >= 1);
ALTER TABLE "order" ADD CONSTRAINT "ck_order_currency" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ============ order_item：正整数销量、非负金额、币种 ============
ALTER TABLE "order_item" ADD CONSTRAINT "ck_order_item_quantity_range" CHECK ("quantity" >= 1 AND "quantity" <= 100000000);
ALTER TABLE "order_item" ADD CONSTRAINT "ck_order_item_amount_nonneg" CHECK ("item_paid_amount" >= 0);
ALTER TABLE "order_item" ADD CONSTRAINT "ck_order_item_currency" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ============ refund_event：成功事件的条件字段 ============
ALTER TABLE "refund_event" ADD CONSTRAINT "ck_refund_succeeded_fields" CHECK (
  ("status" = 'succeeded'
    AND "completed_at" IS NOT NULL
    AND "refund_amount" IS NOT NULL AND "refund_amount" > 0
    AND "refunded_quantity_cumulative" IS NOT NULL AND "refunded_quantity_cumulative" >= 0)
  OR
  ("status" <> 'succeeded'
    AND "completed_at" IS NULL
    AND "refund_amount" IS NULL
    AND "refunded_quantity_cumulative" IS NULL)
);
ALTER TABLE "refund_event" ADD CONSTRAINT "ck_refund_completed_after_occurred" CHECK ("completed_at" IS NULL OR "occurred_at" <= "completed_at");
ALTER TABLE "refund_event" ADD CONSTRAINT "ck_refund_currency" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ============ ad_metric ============
ALTER TABLE "ad_metric" ADD CONSTRAINT "ck_ad_window_days_range" CHECK ("attribution_window_days" >= 0 AND "attribution_window_days" <= 90);
ALTER TABLE "ad_metric" ADD CONSTRAINT "ck_ad_spend_nonneg" CHECK ("spend" >= 0);
ALTER TABLE "ad_metric" ADD CONSTRAINT "ck_ad_attributed_sales_nonneg" CHECK ("attributed_sales" >= 0);
ALTER TABLE "ad_metric" ADD CONSTRAINT "ck_ad_currency" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ============ customer_message ============
ALTER TABLE "customer_message" ADD CONSTRAINT "ck_message_manual_revision_nonneg" CHECK ("manual_revision" >= 0);

-- ============ daily_metric ============
ALTER TABLE "daily_metric" ADD CONSTRAINT "ck_metric_available_no_reason" CHECK (NOT ("status" = 'available' AND "unavailable_reason" IS NOT NULL));
ALTER TABLE "daily_metric" ADD CONSTRAINT "ck_metric_sku_entity_has_product" CHECK (("entity_key" LIKE 'sku:%') = ("product_id_at_snapshot" IS NOT NULL));
ALTER TABLE "daily_metric" ADD CONSTRAINT "ck_metric_sample_size_nonneg" CHECK ("sample_size" >= 0);
ALTER TABLE "daily_metric" ADD CONSTRAINT "ck_metric_currency" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

-- ============ voc_insight：固定日桶条件字段 ============
ALTER TABLE "voc_insight" ADD CONSTRAINT "ck_voc_messages_counts" CHECK (
  ("bucket_type" = 'messages'
    AND "total_message_count" IS NOT NULL AND "total_message_count" >= 0
    AND "pending_count" IS NOT NULL AND "pending_count" >= 0
    AND "failed_count" IS NOT NULL AND "failed_count" >= 0
    AND "classified_count" IS NOT NULL AND "classified_count" >= 0
    AND "sentiment_known_count" IS NOT NULL AND "sentiment_known_count" >= 0
    AND "negative_count" IS NOT NULL AND "negative_count" >= 0
    AND "complaint_known_count" IS NOT NULL AND "complaint_known_count" >= 0
    AND "complaint_count" IS NOT NULL AND "complaint_count" >= 0
    AND "case_count" IS NULL)
  OR
  ("bucket_type" = 'after_sales_case'
    AND "total_message_count" IS NULL AND "pending_count" IS NULL AND "failed_count" IS NULL
    AND "classified_count" IS NULL AND "sentiment_known_count" IS NULL AND "negative_count" IS NULL
    AND "complaint_known_count" IS NULL AND "complaint_count" IS NULL
    AND "case_count" IS NOT NULL AND "case_count" >= 0)
);
ALTER TABLE "voc_insight" ADD CONSTRAINT "ck_voc_message_count_relations" CHECK (
  "bucket_type" <> 'messages' OR (
    "pending_count" + "failed_count" + "classified_count" = "total_message_count"
    AND "negative_count" <= "sentiment_known_count"
    AND "sentiment_known_count" <= "classified_count"
    AND "complaint_count" <= "complaint_known_count"
    AND "complaint_known_count" <= "total_message_count"
  )
);

-- ============ rule_evaluation：suppressed 必填 reason ============
ALTER TABLE "rule_evaluation" ADD CONSTRAINT "ck_rule_eval_suppressed_reason" CHECK ("status" <> 'suppressed' OR ("reason_code" IS NOT NULL AND length("reason_code") >= 1));
ALTER TABLE "rule_evaluation" ADD CONSTRAINT "ck_rule_eval_sample_size_nonneg" CHECK ("sample_size" >= 0);

-- ============ job_run：recompute_snapshot 同目标部分唯一 ============
CREATE UNIQUE INDEX "uq_job_run_recompute_target" ON "job_run" ("org_id", "store_id", "dataset_version", "ruleset_version") WHERE "job_kind" = 'recompute_snapshot';

-- ============ ai_run / action_state / data_coverage / import_task ============
ALTER TABLE "ai_run" ADD CONSTRAINT "ck_ai_run_reserved_cost_nonneg" CHECK ("reserved_cost" >= 0);
ALTER TABLE "ai_run" ADD CONSTRAINT "ck_ai_run_attempt_revision_pos" CHECK ("attempt_revision" >= 1);
ALTER TABLE "ai_run" ADD CONSTRAINT "ck_ai_run_billing_currency" CHECK ("billing_currency" ~ '^[A-Z]{3}$');
ALTER TABLE "action_state" ADD CONSTRAINT "ck_action_state_version_pos" CHECK ("version" >= 1);
ALTER TABLE "data_coverage" ADD CONSTRAINT "ck_data_coverage_record_count_nonneg" CHECK ("record_count" >= 0);
ALTER TABLE "data_coverage" ADD CONSTRAINT "ck_data_coverage_dataset_version_nonneg" CHECK ("dataset_version" >= 0);
ALTER TABLE "import_task" ADD CONSTRAINT "ck_import_task_counts_nonneg" CHECK (
  "row_count" >= 0 AND "valid_count" >= 0 AND "error_count" >= 0
  AND "insert_count" >= 0 AND "update_count" >= 0 AND "unchanged_count" >= 0
  AND "preview_version" >= 0
);
