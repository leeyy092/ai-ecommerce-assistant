-- T017R3 H04/L03：逐 attempt 预算账本——费用/预留按每次 attempt 的 claim 时刻归属
-- 预算窗口（上海自然日/月），跨日恢复不得依赖整条 ai_run.created_at 漏计今日新费用，
-- 也不把历史已结算费用搬到新日重复计入；usage 未知的预留保持未决。
CREATE TABLE "ai_attempt_ledger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "reserve_cost" DECIMAL(20,6) NOT NULL,
  "actual_cost" DECIMAL(20,6),
  "status" TEXT NOT NULL DEFAULT 'reserved',
  CONSTRAINT "ai_attempt_ledger_org_run_attempt_key" UNIQUE ("org_id", "run_id", "attempt_no")
);
CREATE INDEX "ai_attempt_ledger_org_created_idx" ON "ai_attempt_ledger"("org_id", "created_at");
CREATE INDEX "ai_attempt_ledger_run_idx" ON "ai_attempt_ledger"("run_id");
