-- Gate-01 H08（正式复核）｜审计同域的持续维护：
-- 1) 升级守卫：存在跨域审计引用时拒绝静默通过（明确报错并给出数量，不自动改写历史）；
-- 2) 父行保护：store.org_id 变更若使既有 audit_log 引用脱离同域，则阻断该变更；
-- 3) 删除语义维持既有单列 FK：删除店铺仅清空可空 store_id、保留 org_id。
-- 说明：p0_audit_tenant_fk 的 audit 行级触发器继续生效（插入/更新同域校验）。

-- 1) 升级守卫（DO 块在迁移事务内失败即整体回滚）
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad FROM audit_log a
  WHERE a.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM store s WHERE s.org_id = a.org_id AND s.id = a.store_id);
  IF bad > 0 THEN
    RAISE EXCEPTION 'audit_log 存在 % 条跨组织店铺引用，拒绝升级；请先人工核对这些历史行', bad;
  END IF;
END $$;

-- 2) 父行保护函数与触发器
CREATE FUNCTION "store_org_reassign_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."org_id" IS DISTINCT FROM OLD."org_id" AND EXISTS (
    SELECT 1 FROM audit_log al
    WHERE al."store_id" = NEW."id" AND al."org_id" IS DISTINCT FROM NEW."org_id"
  ) THEN
    RAISE EXCEPTION 'store % 的组织归属变更会使既有审计引用脱离同域，已阻断', NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "store_org_reassign_guard_trg"
  BEFORE UPDATE OF "org_id" ON "store"
  FOR EACH ROW EXECUTE FUNCTION "store_org_reassign_guard"();
