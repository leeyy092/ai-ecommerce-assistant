-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'operator', 'customer_service');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('ready', 'updating', 'failed');

-- CreateEnum
CREATE TYPE "AdapterKind" AS ENUM ('csv', 'mock');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SkuStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('unpaid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "AfterSaleStatus" AS ENUM ('requested', 'processing', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "MessageClassificationStatus" AS ENUM ('pending', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('positive', 'neutral', 'negative', 'unknown');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('ai', 'manual');

-- CreateEnum
CREATE TYPE "MetricStatus" AS ENUM ('available', 'unavailable');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('complete', 'partial', 'missing');

-- CreateEnum
CREATE TYPE "Maturity" AS ENUM ('mature', 'provisional', 'not_applicable');

-- CreateEnum
CREATE TYPE "VocBucketType" AS ENUM ('messages', 'after_sales_case');

-- CreateEnum
CREATE TYPE "RuleEvalStatus" AS ENUM ('triggered', 'not_triggered', 'suppressed');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'ignored');

-- CreateEnum
CREATE TYPE "AlertCategory" AS ENUM ('data_quality', 'sku', 'advertising', 'customer_service', 'after_sales');

-- CreateEnum
CREATE TYPE "VisibilityScope" AS ENUM ('business', 'customer_service');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SummarySource" AS ENUM ('ai', 'rules');

-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('voc_classification', 'insight', 'daily_report');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'skipped', 'superseded');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('reserved', 'settled', 'unknown', 'released');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('recompute_snapshot', 'classify_voc', 'generate_ai');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'superseded');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('user', 'system');

-- CreateEnum
CREATE TYPE "ImportSourceKind" AS ENUM ('products', 'orders', 'order_items', 'ads', 'customer_messages', 'after_sales');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'validating', 'preview_ready', 'committing', 'committed', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('none', 'pending', 'dispatched');

-- CreateEnum
CREATE TYPE "JobOutboxStatus" AS ENUM ('pending', 'dispatched');

-- CreateEnum
CREATE TYPE "CoverageChannel" AS ENUM ('default', 'case', 'refund');

-- CreateEnum
CREATE TYPE "ActionStateStatus" AS ENUM ('pending', 'accepted', 'done', 'dismissed');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_user" (
    "id" TEXT NOT NULL,
    "auth_user_id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'active',
    "ai_daily_budget" DECIMAL(20,6) NOT NULL DEFAULT 3,
    "ai_monthly_budget" DECIMAL(20,6) NOT NULL DEFAULT 100,
    "budget_currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "budget_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "daily_message_limit" INTEGER NOT NULL DEFAULT 2000,
    "demo_mode" BOOLEAN NOT NULL DEFAULT false,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "role" "MemberRole" NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by" TEXT NOT NULL,
    "accepted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "external_store_id" VARCHAR(128) NOT NULL,
    "status" "StoreStatus" NOT NULL DEFAULT 'active',
    "demo_mode" BOOLEAN NOT NULL DEFAULT false,
    "platform" VARCHAR(32) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "dataset_version" BIGINT NOT NULL DEFAULT 0,
    "input_evaluation_at" TIMESTAMP(3),
    "last_evaluation_date" DATE,
    "current_snapshot_version" BIGINT,
    "ruleset_version" VARCHAR(80) NOT NULL DEFAULT 'rules-v1-init',
    "current_snapshot_ruleset_version" VARCHAR(80),
    "current_snapshot_evaluation_at" TIMESTAMP(3),
    "previous_snapshot_version" BIGINT,
    "previous_snapshot_ruleset_version" VARCHAR(80),
    "previous_snapshot_evaluation_at" TIMESTAMP(3),
    "snapshot_status" "SnapshotStatus" NOT NULL DEFAULT 'ready',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_source" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "adapter_kind" "AdapterKind" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'active',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "data_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_config" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "rule_id" VARCHAR(16) NOT NULL,
    "rule_version" INTEGER NOT NULL DEFAULT 1,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parameters" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rule_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "external_product_id" VARCHAR(128) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "category" VARCHAR(100),
    "status" "ProductStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "product_id" TEXT NOT NULL,
    "external_sku_id" VARCHAR(128) NOT NULL,
    "sku_code" VARCHAR(128) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "specification" VARCHAR(500),
    "status" "SkuStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku_alias" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "external_sku_id" VARCHAR(128) NOT NULL,
    "sku_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sku_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "external_order_id" VARCHAR(128) NOT NULL,
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'unpaid',
    "paid_at" TIMESTAMP(3),
    "ordered_at" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expected_item_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "order_id" TEXT NOT NULL,
    "external_order_item_id" VARCHAR(128) NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "item_paid_amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sale_record" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "external_record_id" VARCHAR(128) NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "status" "AfterSaleStatus" NOT NULL DEFAULT 'requested',
    "reason_code" VARCHAR(64) NOT NULL,
    "reason_text" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "after_sale_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_event" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "external_record_id" VARCHAR(128) NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "after_sale_record_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),
    "refund_amount" DECIMAL(20,6),
    "refunded_quantity_cumulative" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "reason_code" VARCHAR(64) NOT NULL,
    "reason_text" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "refund_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_metric" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "campaign_id" VARCHAR(128) NOT NULL,
    "campaign_name" VARCHAR(300) NOT NULL,
    "report_date" DATE NOT NULL,
    "attribution_model" VARCHAR(64) NOT NULL,
    "attribution_window_days" INTEGER NOT NULL,
    "spend" DECIMAL(20,6) NOT NULL,
    "attributed_sales" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ad_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_message" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "source_namespace" VARCHAR(64) NOT NULL,
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "row_hash" VARCHAR(64) NOT NULL,
    "external_message_id" VARCHAR(128) NOT NULL,
    "external_conversation_id" VARCHAR(128) NOT NULL,
    "sku_id" TEXT,
    "message_at" TIMESTAMP(3) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "redacted_text" VARCHAR(10000) NOT NULL,
    "language" VARCHAR(16) NOT NULL,
    "is_complaint" BOOLEAN,
    "classification_status" "MessageClassificationStatus" NOT NULL DEFAULT 'pending',
    "primary_topic" VARCHAR(64),
    "secondary_topics" JSONB NOT NULL DEFAULT '[]',
    "sentiment" "Sentiment" NOT NULL DEFAULT 'unknown',
    "classification_version" VARCHAR(128),
    "classification_source" "ClassificationSource",
    "ai_classification" JSONB,
    "manual_classification" JSONB,
    "manual_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customer_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metric" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "metric_id" VARCHAR(128) NOT NULL,
    "entity_key" VARCHAR(256) NOT NULL,
    "product_id_at_snapshot" TEXT,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "value_numeric" DECIMAL(24,6),
    "numerator" DECIMAL(24,6),
    "denominator" DECIMAL(24,6),
    "sample_size" BIGINT NOT NULL,
    "status" "MetricStatus" NOT NULL,
    "coverage_status" "CoverageStatus" NOT NULL,
    "maturity" "Maturity" NOT NULL DEFAULT 'not_applicable',
    "unavailable_reason" VARCHAR(64),
    "currency" CHAR(3),
    "dataset_version" BIGINT NOT NULL,
    "evaluation_at" TIMESTAMP(3) NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "metric_version" VARCHAR(32) NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voc_insight" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "bucket_type" "VocBucketType" NOT NULL,
    "sku_key" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_message_count" BIGINT,
    "pending_count" BIGINT,
    "failed_count" BIGINT,
    "classified_count" BIGINT,
    "sentiment_known_count" BIGINT,
    "negative_count" BIGINT,
    "complaint_known_count" BIGINT,
    "complaint_count" BIGINT,
    "topic_counts" JSONB NOT NULL DEFAULT '{}',
    "keyword_counts" JSONB NOT NULL DEFAULT '{}',
    "case_count" BIGINT,
    "reason_counts" JSONB NOT NULL DEFAULT '{}',
    "coverage_status" "CoverageStatus" NOT NULL,
    "samples" JSONB NOT NULL DEFAULT '{}',
    "dataset_version" BIGINT NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "classification_version" VARCHAR(128) NOT NULL,
    "evaluation_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "voc_insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_evaluation" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "rule_id" VARCHAR(16) NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "entity_key" VARCHAR(256) NOT NULL,
    "subchannel" VARCHAR(32) NOT NULL DEFAULT 'default',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "dataset_version" BIGINT NOT NULL,
    "evaluation_at" TIMESTAMP(3) NOT NULL,
    "status" "RuleEvalStatus" NOT NULL,
    "reason_code" VARCHAR(64),
    "sample_size" BIGINT NOT NULL,
    "threshold" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rule_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "rule_id" VARCHAR(16) NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "entity_key" VARCHAR(256) NOT NULL,
    "subchannel" VARCHAR(32) NOT NULL DEFAULT 'default',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "category" "AlertCategory" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "handling_note" VARCHAR(500),
    "evidence" JSONB NOT NULL,
    "evidence_fingerprint" VARCHAR(64) NOT NULL,
    "carried_from_alert_id" TEXT,
    "dataset_version" BIGINT NOT NULL,
    "evaluation_at" TIMESTAMP(3) NOT NULL,
    "metric_version" VARCHAR(32) NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insight" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "ai_run_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "dataset_version" BIGINT NOT NULL,
    "evaluation_at" TIMESTAMP(3) NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "visibility_scope" "VisibilityScope" NOT NULL,
    "generation_status" "GenerationStatus" NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'active',
    "schema_version" VARCHAR(32) NOT NULL DEFAULT '1.1',
    "metric_version" VARCHAR(32) NOT NULL DEFAULT 'v1',
    "payload" JSONB,
    "evidence" JSONB NOT NULL,
    "confidence" JSONB NOT NULL,
    "error" JSONB,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_state" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "ai_insight_id" TEXT NOT NULL,
    "action_id" VARCHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ActionStateStatus" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "action_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_report" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "ai_run_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "dataset_version" BIGINT NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "evaluation_at" TIMESTAMP(3) NOT NULL,
    "visibility_scope" "VisibilityScope" NOT NULL DEFAULT 'business',
    "generation_status" "GenerationStatus" NOT NULL,
    "summarySource" "SummarySource",
    "metric_version" VARCHAR(32) NOT NULL DEFAULT 'v1',
    "summary_payload" JSONB,
    "evidence" JSONB NOT NULL,
    "confidence" JSONB NOT NULL,
    "insight_ids" JSONB NOT NULL DEFAULT '[]',
    "error" JSONB,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_run" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "attempt_revision" INTEGER NOT NULL DEFAULT 1,
    "dataset_version" BIGINT NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "visibility_scope" "VisibilityScope" NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'queued',
    "model_id" VARCHAR(128) NOT NULL,
    "prompt_version" VARCHAR(128) NOT NULL,
    "schema_version" VARCHAR(128) NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "input_tokens" BIGINT,
    "output_tokens" BIGINT,
    "reserved_cost" DECIMAL(20,6) NOT NULL,
    "actual_cost" DECIMAL(20,6),
    "billing_currency" CHAR(3) NOT NULL DEFAULT 'CNY',
    "billing_status" "BillingStatus" NOT NULL DEFAULT 'reserved',
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "request_context" JSONB NOT NULL,
    "error_code" VARCHAR(64),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ai_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_task" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "source_kind" "ImportSourceKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "original_filename" VARCHAR(255) NOT NULL,
    "raw_object_key" VARCHAR(512) NOT NULL,
    "file_sha256" VARCHAR(64) NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "coverage_declaration" JSONB NOT NULL DEFAULT '[]',
    "upload_request_key" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(64),
    "preview_version" INTEGER NOT NULL DEFAULT 0,
    "base_dataset_version" BIGINT NOT NULL,
    "committed_dataset_version" BIGINT,
    "committed_ruleset_version" VARCHAR(80),
    "committed_evaluation_at" TIMESTAMP(3),
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "valid_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "insert_count" INTEGER NOT NULL DEFAULT 0,
    "update_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "staging_object_key" VARCHAR(512),
    "error_object_key" VARCHAR(512),
    "outbox_status" "OutboxStatus" NOT NULL DEFAULT 'none',
    "created_by" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "committed_at" TIMESTAMP(3),
    "error_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "import_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_coverage" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "data_source_id" TEXT NOT NULL,
    "source_kind" "ImportSourceKind" NOT NULL,
    "channel" "CoverageChannel" NOT NULL DEFAULT 'default',
    "coverage_date" DATE NOT NULL,
    "status" "CoverageStatus" NOT NULL,
    "explicit_zero" BOOLEAN NOT NULL DEFAULT false,
    "record_count" BIGINT NOT NULL DEFAULT 0,
    "dataset_version" BIGINT NOT NULL,
    "import_task_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "data_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_run" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "job_kind" "JobKind" NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "context" JSONB NOT NULL,
    "result_manifest" JSONB,
    "actor_type" "ActorType" NOT NULL DEFAULT 'user',
    "requested_by" TEXT,
    "dataset_version" BIGINT NOT NULL,
    "ruleset_version" VARCHAR(80) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "outbox_status" "JobOutboxStatus" NOT NULL DEFAULT 'pending',
    "error_code" VARCHAR(64),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT,
    "actor_user_id" TEXT,
    "actor_type" "ActorType" NOT NULL DEFAULT 'user',
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before_summary" JSONB,
    "after_summary" JSONB,
    "request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "domain_user_auth_user_id_key" ON "domain_user"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_user_email_key" ON "domain_user"("email");

-- CreateIndex
CREATE INDEX "domain_user_status_idx" ON "domain_user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_owner_user_id_key" ON "organization"("owner_user_id");

-- CreateIndex
CREATE INDEX "organization_status_idx" ON "organization"("status");

-- CreateIndex
CREATE INDEX "membership_org_id_status_idx" ON "membership"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "membership_org_id_id_key" ON "membership"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_org_id_user_id_key" ON "membership"("org_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_org_id_email_idx" ON "invitation"("org_id", "email");

-- CreateIndex
CREATE INDEX "invitation_expires_at_idx" ON "invitation"("expires_at");

-- CreateIndex
CREATE INDEX "invitation_status_idx" ON "invitation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_org_id_id_key" ON "invitation"("org_id", "id");

-- CreateIndex
CREATE INDEX "store_org_id_status_idx" ON "store"("org_id", "status");

-- CreateIndex
CREATE INDEX "store_snapshot_status_idx" ON "store"("snapshot_status");

-- CreateIndex
CREATE UNIQUE INDEX "store_org_id_id_key" ON "store"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "store_org_id_external_store_id_key" ON "store"("org_id", "external_store_id");

-- CreateIndex
CREATE INDEX "data_source_org_id_store_id_idx" ON "data_source"("org_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_org_id_id_key" ON "data_source"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_org_id_store_id_id_key" ON "data_source"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "data_source_org_id_store_id_source_namespace_key" ON "data_source"("org_id", "store_id", "source_namespace");

-- CreateIndex
CREATE INDEX "rule_config_org_id_store_id_ruleset_version_idx" ON "rule_config"("org_id", "store_id", "ruleset_version");

-- CreateIndex
CREATE UNIQUE INDEX "rule_config_org_id_id_key" ON "rule_config"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_config_org_id_store_id_id_key" ON "rule_config"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_config_org_id_store_id_ruleset_version_rule_id_rule_ve_key" ON "rule_config"("org_id", "store_id", "ruleset_version", "rule_id", "rule_version");

-- CreateIndex
CREATE INDEX "product_org_id_store_id_idx" ON "product"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "product_org_id_store_id_category_idx" ON "product"("org_id", "store_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_id_key" ON "product"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_store_id_id_key" ON "product"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_org_id_store_id_source_namespace_external_product_i_key" ON "product"("org_id", "store_id", "source_namespace", "external_product_id");

-- CreateIndex
CREATE INDEX "sku_org_id_store_id_idx" ON "sku"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "sku_org_id_store_id_product_id_idx" ON "sku"("org_id", "store_id", "product_id");

-- CreateIndex
CREATE INDEX "sku_org_id_store_id_status_idx" ON "sku"("org_id", "store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sku_org_id_id_key" ON "sku"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_org_id_store_id_id_key" ON "sku"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_org_id_store_id_source_namespace_external_sku_id_key" ON "sku"("org_id", "store_id", "source_namespace", "external_sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_org_id_store_id_sku_code_key" ON "sku"("org_id", "store_id", "sku_code");

-- CreateIndex
CREATE INDEX "sku_alias_org_id_store_id_idx" ON "sku_alias"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "sku_alias_org_id_store_id_sku_id_idx" ON "sku_alias"("org_id", "store_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_alias_org_id_id_key" ON "sku_alias"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sku_alias_org_id_store_id_source_namespace_external_sku_id_key" ON "sku_alias"("org_id", "store_id", "source_namespace", "external_sku_id");

-- CreateIndex
CREATE INDEX "order_org_id_store_id_idx" ON "order"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "order_org_id_store_id_paid_at_idx" ON "order"("org_id", "store_id", "paid_at");

-- CreateIndex
CREATE INDEX "order_payment_status_idx" ON "order"("payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "order_org_id_id_key" ON "order"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_org_id_store_id_id_key" ON "order"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_org_id_store_id_source_namespace_external_order_id_key" ON "order"("org_id", "store_id", "source_namespace", "external_order_id");

-- CreateIndex
CREATE INDEX "order_item_org_id_store_id_idx" ON "order_item"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "order_item_org_id_store_id_order_id_idx" ON "order_item"("org_id", "store_id", "order_id");

-- CreateIndex
CREATE INDEX "order_item_org_id_store_id_sku_id_idx" ON "order_item"("org_id", "store_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_org_id_id_key" ON "order_item"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_org_id_store_id_id_key" ON "order_item"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_org_id_store_id_source_namespace_order_id_extern_key" ON "order_item"("org_id", "store_id", "source_namespace", "order_id", "external_order_item_id");

-- CreateIndex
CREATE INDEX "after_sale_record_org_id_store_id_idx" ON "after_sale_record"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "after_sale_record_org_id_store_id_occurred_at_idx" ON "after_sale_record"("org_id", "store_id", "occurred_at");

-- CreateIndex
CREATE INDEX "after_sale_record_org_id_store_id_order_item_id_idx" ON "after_sale_record"("org_id", "store_id", "order_item_id");

-- CreateIndex
CREATE INDEX "after_sale_record_org_id_store_id_reason_code_idx" ON "after_sale_record"("org_id", "store_id", "reason_code");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_record_org_id_id_key" ON "after_sale_record"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_record_org_id_store_id_id_key" ON "after_sale_record"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sale_record_org_id_store_id_source_namespace_external_key" ON "after_sale_record"("org_id", "store_id", "source_namespace", "external_record_id");

-- CreateIndex
CREATE INDEX "refund_event_org_id_store_id_idx" ON "refund_event"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "refund_event_org_id_store_id_order_item_id_completed_at_idx" ON "refund_event"("org_id", "store_id", "order_item_id", "completed_at");

-- CreateIndex
CREATE INDEX "refund_event_org_id_store_id_completed_at_idx" ON "refund_event"("org_id", "store_id", "completed_at");

-- CreateIndex
CREATE INDEX "refund_event_status_idx" ON "refund_event"("status");

-- CreateIndex
CREATE INDEX "refund_event_after_sale_record_id_idx" ON "refund_event"("after_sale_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_event_org_id_id_key" ON "refund_event"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_event_org_id_store_id_id_key" ON "refund_event"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_event_org_id_store_id_source_namespace_external_reco_key" ON "refund_event"("org_id", "store_id", "source_namespace", "external_record_id");

-- CreateIndex
CREATE INDEX "ad_metric_org_id_store_id_idx" ON "ad_metric"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "ad_metric_org_id_store_id_report_date_idx" ON "ad_metric"("org_id", "store_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_metric_org_id_id_key" ON "ad_metric"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_metric_org_id_store_id_id_key" ON "ad_metric"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_metric_org_id_store_id_source_namespace_campaign_id_repo_key" ON "ad_metric"("org_id", "store_id", "source_namespace", "campaign_id", "report_date", "attribution_model", "attribution_window_days", "currency");

-- CreateIndex
CREATE INDEX "customer_message_org_id_store_id_idx" ON "customer_message"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "customer_message_org_id_store_id_external_conversation_id_idx" ON "customer_message"("org_id", "store_id", "external_conversation_id");

-- CreateIndex
CREATE INDEX "customer_message_org_id_store_id_message_at_idx" ON "customer_message"("org_id", "store_id", "message_at");

-- CreateIndex
CREATE INDEX "customer_message_org_id_store_id_classification_status_idx" ON "customer_message"("org_id", "store_id", "classification_status");

-- CreateIndex
CREATE INDEX "customer_message_org_id_store_id_primary_topic_idx" ON "customer_message"("org_id", "store_id", "primary_topic");

-- CreateIndex
CREATE INDEX "customer_message_sentiment_idx" ON "customer_message"("sentiment");

-- CreateIndex
CREATE INDEX "customer_message_channel_idx" ON "customer_message"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "customer_message_org_id_id_key" ON "customer_message"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_message_org_id_store_id_id_key" ON "customer_message"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_message_org_id_store_id_source_namespace_external__key" ON "customer_message"("org_id", "store_id", "source_namespace", "external_message_id");

-- CreateIndex
CREATE INDEX "daily_metric_org_id_store_id_idx" ON "daily_metric"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "daily_metric_org_id_store_id_dataset_version_ruleset_versio_idx" ON "daily_metric"("org_id", "store_id", "dataset_version", "ruleset_version", "product_id_at_snapshot");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metric_org_id_id_key" ON "daily_metric"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metric_org_id_store_id_metric_id_entity_key_period_st_key" ON "daily_metric"("org_id", "store_id", "metric_id", "entity_key", "period_start", "period_end", "dataset_version", "ruleset_version", "metric_version");

-- CreateIndex
CREATE INDEX "voc_insight_org_id_store_id_idx" ON "voc_insight"("org_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "voc_insight_org_id_id_key" ON "voc_insight"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "voc_insight_org_id_store_id_bucket_type_sku_key_channel_per_key" ON "voc_insight"("org_id", "store_id", "bucket_type", "sku_key", "channel", "period_start", "period_end", "dataset_version", "ruleset_version", "classification_version");

-- CreateIndex
CREATE INDEX "rule_evaluation_org_id_store_id_idx" ON "rule_evaluation"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "rule_evaluation_org_id_store_id_dataset_version_ruleset_ver_idx" ON "rule_evaluation"("org_id", "store_id", "dataset_version", "ruleset_version", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rule_evaluation_org_id_id_key" ON "rule_evaluation"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_evaluation_org_id_store_id_rule_id_rule_version_entity_key" ON "rule_evaluation"("org_id", "store_id", "rule_id", "rule_version", "entity_key", "subchannel", "period_start", "period_end", "dataset_version", "ruleset_version");

-- CreateIndex
CREATE INDEX "alert_org_id_store_id_idx" ON "alert"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "alert_org_id_store_id_severity_idx" ON "alert"("org_id", "store_id", "severity");

-- CreateIndex
CREATE INDEX "alert_org_id_store_id_category_idx" ON "alert"("org_id", "store_id", "category");

-- CreateIndex
CREATE INDEX "alert_org_id_store_id_status_idx" ON "alert"("org_id", "store_id", "status");

-- CreateIndex
CREATE INDEX "alert_evidence_fingerprint_idx" ON "alert"("evidence_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "alert_org_id_id_key" ON "alert"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_org_id_store_id_rule_id_entity_key_subchannel_period__key" ON "alert"("org_id", "store_id", "rule_id", "entity_key", "subchannel", "period_start", "period_end", "rule_version", "dataset_version", "ruleset_version");

-- CreateIndex
CREATE INDEX "ai_insight_org_id_store_id_idx" ON "ai_insight"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "ai_insight_org_id_store_id_dataset_version_idx" ON "ai_insight"("org_id", "store_id", "dataset_version");

-- CreateIndex
CREATE INDEX "ai_insight_visibility_scope_idx" ON "ai_insight"("visibility_scope");

-- CreateIndex
CREATE INDEX "ai_insight_period_start_period_end_idx" ON "ai_insight"("period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insight_org_id_id_key" ON "ai_insight"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_insight_org_id_store_id_id_key" ON "ai_insight"("org_id", "store_id", "id");

-- CreateIndex
CREATE INDEX "action_state_org_id_user_id_status_idx" ON "action_state"("org_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "action_state_org_id_id_key" ON "action_state"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "action_state_org_id_ai_insight_id_action_id_user_id_key" ON "action_state"("org_id", "ai_insight_id", "action_id", "user_id");

-- CreateIndex
CREATE INDEX "ai_report_org_id_store_id_period_start_idx" ON "ai_report"("org_id", "store_id", "period_start");

-- CreateIndex
CREATE INDEX "ai_report_visibility_scope_idx" ON "ai_report"("visibility_scope");

-- CreateIndex
CREATE UNIQUE INDEX "ai_report_org_id_id_key" ON "ai_report"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_idempotency_key_key" ON "ai_run"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_run_org_id_store_id_idx" ON "ai_run"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "ai_run_org_id_status_idx" ON "ai_run"("org_id", "status");

-- CreateIndex
CREATE INDEX "ai_run_billing_status_idx" ON "ai_run"("billing_status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_org_id_id_key" ON "ai_run"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_run_org_id_store_id_id_key" ON "ai_run"("org_id", "store_id", "id");

-- CreateIndex
CREATE INDEX "import_task_org_id_store_id_idx" ON "import_task"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "import_task_org_id_store_id_status_idx" ON "import_task"("org_id", "store_id", "status");

-- CreateIndex
CREATE INDEX "import_task_outbox_status_updated_at_idx" ON "import_task"("outbox_status", "updated_at");

-- CreateIndex
CREATE INDEX "import_task_committed_dataset_version_idx" ON "import_task"("committed_dataset_version");

-- CreateIndex
CREATE UNIQUE INDEX "import_task_org_id_id_key" ON "import_task"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_task_org_id_store_id_id_key" ON "import_task"("org_id", "store_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "import_task_org_id_created_by_upload_request_key_key" ON "import_task"("org_id", "created_by", "upload_request_key");

-- CreateIndex
CREATE UNIQUE INDEX "import_task_org_id_store_id_idempotency_key_key" ON "import_task"("org_id", "store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "data_coverage_org_id_store_id_idx" ON "data_coverage"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "data_coverage_import_task_id_idx" ON "data_coverage"("import_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_coverage_org_id_id_key" ON "data_coverage"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "data_coverage_org_id_store_id_data_source_id_source_kind_ch_key" ON "data_coverage"("org_id", "store_id", "data_source_id", "source_kind", "channel", "coverage_date", "dataset_version");

-- CreateIndex
CREATE UNIQUE INDEX "job_run_idempotency_key_key" ON "job_run"("idempotency_key");

-- CreateIndex
CREATE INDEX "job_run_org_id_store_id_idx" ON "job_run"("org_id", "store_id");

-- CreateIndex
CREATE INDEX "job_run_status_updated_at_idx" ON "job_run"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_run_org_id_id_key" ON "job_run"("org_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limit_key_key" ON "auth_rate_limit"("key");

-- CreateIndex
CREATE INDEX "auth_rate_limit_expires_at_idx" ON "auth_rate_limit"("expires_at");

-- CreateIndex
CREATE INDEX "audit_log_org_id_store_id_created_at_idx" ON "audit_log"("org_id", "store_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_org_id_entity_type_entity_id_idx" ON "audit_log"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_org_id_id_key" ON "audit_log"("org_id", "id");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization" ADD CONSTRAINT "organization_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "domain_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "domain_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "domain_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "domain_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_source" ADD CONSTRAINT "data_source_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_config" ADD CONSTRAINT "rule_config_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku" ADD CONSTRAINT "sku_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku" ADD CONSTRAINT "sku_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku" ADD CONSTRAINT "sku_org_id_store_id_product_id_fkey" FOREIGN KEY ("org_id", "store_id", "product_id") REFERENCES "product"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_alias" ADD CONSTRAINT "sku_alias_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_alias" ADD CONSTRAINT "sku_alias_org_id_store_id_sku_id_fkey" FOREIGN KEY ("org_id", "store_id", "sku_id") REFERENCES "sku"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku_alias" ADD CONSTRAINT "sku_alias_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "domain_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_org_id_store_id_order_id_fkey" FOREIGN KEY ("org_id", "store_id", "order_id") REFERENCES "order"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_org_id_store_id_sku_id_fkey" FOREIGN KEY ("org_id", "store_id", "sku_id") REFERENCES "sku"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_record" ADD CONSTRAINT "after_sale_record_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_record" ADD CONSTRAINT "after_sale_record_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_record" ADD CONSTRAINT "after_sale_record_org_id_store_id_order_id_fkey" FOREIGN KEY ("org_id", "store_id", "order_id") REFERENCES "order"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sale_record" ADD CONSTRAINT "after_sale_record_org_id_store_id_order_item_id_fkey" FOREIGN KEY ("org_id", "store_id", "order_item_id") REFERENCES "order_item"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_event" ADD CONSTRAINT "refund_event_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_event" ADD CONSTRAINT "refund_event_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_event" ADD CONSTRAINT "refund_event_org_id_store_id_order_id_fkey" FOREIGN KEY ("org_id", "store_id", "order_id") REFERENCES "order"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_event" ADD CONSTRAINT "refund_event_org_id_store_id_order_item_id_fkey" FOREIGN KEY ("org_id", "store_id", "order_item_id") REFERENCES "order_item"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_event" ADD CONSTRAINT "refund_event_org_id_store_id_after_sale_record_id_fkey" FOREIGN KEY ("org_id", "store_id", "after_sale_record_id") REFERENCES "after_sale_record"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_metric" ADD CONSTRAINT "ad_metric_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_metric" ADD CONSTRAINT "ad_metric_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_message" ADD CONSTRAINT "customer_message_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_message" ADD CONSTRAINT "customer_message_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_message" ADD CONSTRAINT "customer_message_org_id_store_id_sku_id_fkey" FOREIGN KEY ("org_id", "store_id", "sku_id") REFERENCES "sku"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metric" ADD CONSTRAINT "daily_metric_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metric" ADD CONSTRAINT "daily_metric_org_id_store_id_product_id_at_snapshot_fkey" FOREIGN KEY ("org_id", "store_id", "product_id_at_snapshot") REFERENCES "product"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voc_insight" ADD CONSTRAINT "voc_insight_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_org_id_store_id_ruleset_version_rule_id_ru_fkey" FOREIGN KEY ("org_id", "store_id", "ruleset_version", "rule_id", "rule_version") REFERENCES "rule_config"("org_id", "store_id", "ruleset_version", "rule_id", "rule_version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert" ADD CONSTRAINT "alert_org_id_store_id_ruleset_version_rule_id_rule_version_fkey" FOREIGN KEY ("org_id", "store_id", "ruleset_version", "rule_id", "rule_version") REFERENCES "rule_config"("org_id", "store_id", "ruleset_version", "rule_id", "rule_version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insight" ADD CONSTRAINT "ai_insight_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insight" ADD CONSTRAINT "ai_insight_org_id_store_id_ai_run_id_fkey" FOREIGN KEY ("org_id", "store_id", "ai_run_id") REFERENCES "ai_run"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_state" ADD CONSTRAINT "action_state_org_id_store_id_ai_insight_id_fkey" FOREIGN KEY ("org_id", "store_id", "ai_insight_id") REFERENCES "ai_insight"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_state" ADD CONSTRAINT "action_state_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_state" ADD CONSTRAINT "action_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "domain_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report" ADD CONSTRAINT "ai_report_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_report" ADD CONSTRAINT "ai_report_org_id_store_id_ai_run_id_fkey" FOREIGN KEY ("org_id", "store_id", "ai_run_id") REFERENCES "ai_run"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_run" ADD CONSTRAINT "ai_run_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_task" ADD CONSTRAINT "import_task_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_task" ADD CONSTRAINT "import_task_org_id_store_id_data_source_id_fkey" FOREIGN KEY ("org_id", "store_id", "data_source_id") REFERENCES "data_source"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_task" ADD CONSTRAINT "import_task_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "domain_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_coverage" ADD CONSTRAINT "data_coverage_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_coverage" ADD CONSTRAINT "data_coverage_org_id_store_id_data_source_id_fkey" FOREIGN KEY ("org_id", "store_id", "data_source_id") REFERENCES "data_source"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_coverage" ADD CONSTRAINT "data_coverage_org_id_store_id_import_task_id_fkey" FOREIGN KEY ("org_id", "store_id", "import_task_id") REFERENCES "import_task"("org_id", "store_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_org_id_store_id_fkey" FOREIGN KEY ("org_id", "store_id") REFERENCES "store"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_run" ADD CONSTRAINT "job_run_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "domain_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "domain_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

