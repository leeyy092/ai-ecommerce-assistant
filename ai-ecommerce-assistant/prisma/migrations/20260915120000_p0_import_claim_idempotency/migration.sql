-- G2-H07/G2-H08（Gate-02 修复）：上传原子认领与 HTTP 请求幂等。
-- 1) 同一 (org, store, source, kind, 文件内容) 的未失败任务唯一——并发同内容上传
--    由数据库原子裁决，败者映射为复用既有任务（不再产生第二个可校验任务）。
--    注：部分索引无法用 Prisma Schema 表达（M07 同类约定），后续 migrate diff 会
--    持续输出 DROP 建议，不得直接应用；审计复合外键未触碰，无需 H08 回归。
CREATE UNIQUE INDEX "import_task_active_content_key"
  ON "import_task" ("org_id", "store_id", "data_source_id", "source_kind", "file_sha256")
  WHERE status <> 'failed';

-- 2) HTTP Idempotency-Key 存档（08 §17.5：按 org/user/endpoint 隔离，
--    保存请求 hash 与响应 24 小时；同 key 不同 body 409）。
CREATE TABLE "http_idempotency" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" VARCHAR(128) NOT NULL,
    "request_key" VARCHAR(64) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "http_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "http_idempotency_scope_key"
  ON "http_idempotency" ("org_id", "user_id", "endpoint", "request_key");
CREATE INDEX "http_idempotency_created_at_idx" ON "http_idempotency" ("created_at");

-- 领域 UUID 格式约束（对齐 20260914210000 的 M04 全覆盖口径）
ALTER TABLE "http_idempotency"
  ADD CONSTRAINT "ck_http_idempotency_uuid" CHECK ("id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;
ALTER TABLE "http_idempotency"
  ADD CONSTRAINT "ck_http_idempotency_org_uuid" CHECK ("org_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;
ALTER TABLE "http_idempotency"
  ADD CONSTRAINT "ck_http_idempotency_user_uuid" CHECK ("user_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') NOT VALID;
