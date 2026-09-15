-- Gate-01 H08｜AuditLog 店铺引用必须与 org_id 同域（数据库级强制）。
-- 实现方式：BEFORE INSERT/UPDATE 触发器。不用复合 FOREIGN KEY 的原因：
--   Prisma relation 不允许 org_id(必填)+store_id(可空) 混合可空性的多字段关系，
--   而未在 schema 声明的外键会被 migrate dev 判定为漂移；触发器与 CHECK/部分唯一
--   一样对 Prisma 不可见（零漂移），且同为数据库层强制，不依赖应用代码。
-- 语义：store_id 为 NULL（组织级操作无店铺）不适用；同域/异域由 DB 拒绝或放行。
-- 删除行为：维持既有单列 FK 的 SET NULL（店铺删除时清空引用），org_id 不受影响。
CREATE FUNCTION "audit_log_store_same_domain"() RETURNS trigger AS $$
BEGIN
  IF NEW."store_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "store" s WHERE s."org_id" = NEW."org_id" AND s."id" = NEW."store_id"
  ) THEN
    RAISE EXCEPTION 'audit_log store_id % 不属于 org_id 对应组织（同域校验失败）', NEW."store_id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_store_same_domain_trg"
  BEFORE INSERT OR UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_store_same_domain"();
