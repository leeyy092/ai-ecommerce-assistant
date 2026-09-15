-- Gate-01 H09｜领域时间字段落实 timestamptz（04_DATA_MODEL §10.1 合同）
-- 转换依据：历史业务行全部经 Prisma 写入（UTC 墙钟）；集群时区为 Asia/Shanghai，
-- 因此显式 USING ... AT TIME ZONE 'UTC'，不依赖会话时区的隐式 cast。
-- Better Auth 官方四表（user/session/account/verification）遵守框架约定，不在本迁移内。
-- auth_rate_limit 为瞬时计数（raw SQL now() 按会话时区写入），直接重置以免错位：
DELETE FROM auth_rate_limit;
-- AlterTable
ALTER TABLE "action_state" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ad_metric" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "after_sale_record" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "occurred_at" SET DATA TYPE TIMESTAMPTZ(6) USING "occurred_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ai_insight" ALTER COLUMN "evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "evaluation_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ai_report" ALTER COLUMN "evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "evaluation_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ai_run" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "alert" ALTER COLUMN "evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "evaluation_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "audit_log" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "auth_rate_limit" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(6) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "customer_message" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "message_at" SET DATA TYPE TIMESTAMPTZ(6) USING "message_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "daily_metric" ALTER COLUMN "evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "evaluation_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "data_coverage" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "data_source" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "domain_user" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "import_task" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "invitation" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(6) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "job_run" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "membership" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "order" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "ordered_at" SET DATA TYPE TIMESTAMPTZ(6) USING "ordered_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "order_item" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "organization" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "product" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "refund_event" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "occurred_at" SET DATA TYPE TIMESTAMPTZ(6) USING "occurred_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "rule_config" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "rule_evaluation" ALTER COLUMN "evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "evaluation_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sku" ALTER COLUMN "source_updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "source_updated_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sku_alias" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "store" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "voc_insight" ALTER COLUMN "evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "evaluation_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "updated_at" AT TIME ZONE 'UTC';
