-- T017R1 H03：AIRun 持久化尝试计数——同一运行跨 Worker/重投递共享总尝试上限（≤3），
-- 每次 attempt 原子递增并作为预算预留与并发的 claim 依据。
ALTER TABLE "ai_run" ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;
