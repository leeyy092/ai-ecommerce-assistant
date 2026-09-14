-- Gate-01 H09（正式复核）｜补齐 14 个可空领域时间列的 timestamptz。
-- 与 p0_domain_timestamptz 同规则：显式 USING ... AT TIME ZONE 'UTC'（历史行均
-- 经 Prisma 以 UTC 墙钟写入；集群时区 Asia/Shanghai）。认证四表不在此列。

ALTER TABLE "store" ALTER COLUMN "input_evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "input_evaluation_at" AT TIME ZONE 'UTC';
ALTER TABLE "store" ALTER COLUMN "current_snapshot_evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "current_snapshot_evaluation_at" AT TIME ZONE 'UTC';
ALTER TABLE "store" ALTER COLUMN "previous_snapshot_evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "previous_snapshot_evaluation_at" AT TIME ZONE 'UTC';
ALTER TABLE "order" ALTER COLUMN "paid_at" SET DATA TYPE TIMESTAMPTZ(6) USING "paid_at" AT TIME ZONE 'UTC';
ALTER TABLE "refund_event" ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMPTZ(6) USING "completed_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_insight" ALTER COLUMN "generated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "generated_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_report" ALTER COLUMN "generated_at" SET DATA TYPE TIMESTAMPTZ(6) USING "generated_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_run" ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMPTZ(6) USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "ai_run" ALTER COLUMN "finished_at" SET DATA TYPE TIMESTAMPTZ(6) USING "finished_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_run" ALTER COLUMN "started_at" SET DATA TYPE TIMESTAMPTZ(6) USING "started_at" AT TIME ZONE 'UTC';
ALTER TABLE "job_run" ALTER COLUMN "finished_at" SET DATA TYPE TIMESTAMPTZ(6) USING "finished_at" AT TIME ZONE 'UTC';
ALTER TABLE "import_task" ALTER COLUMN "committed_evaluation_at" SET DATA TYPE TIMESTAMPTZ(6) USING "committed_evaluation_at" AT TIME ZONE 'UTC';
ALTER TABLE "import_task" ALTER COLUMN "confirmed_at" SET DATA TYPE TIMESTAMPTZ(6) USING "confirmed_at" AT TIME ZONE 'UTC';
ALTER TABLE "import_task" ALTER COLUMN "committed_at" SET DATA TYPE TIMESTAMPTZ(6) USING "committed_at" AT TIME ZONE 'UTC';
