-- Gate-01 REVIEW_3 H08/M04｜审计同域的并发安全关闭 + 领域主键 UUID 约束。
--
-- H08 背景：v1 行级触发器与 v2 父行守卫都只读"当前可见"数据（READ COMMITTED
-- 语句快照），并发交错仍能产生跨组织引用（T1 改 store.org_id 未提交、T2 插入
-- 旧组织的审计引用，两者先后提交后 cross_org=true）。本轮按 04_DATA_MODEL
-- 合同原文"共同外键使用复合(org_id,id)约束，不只在应用层检查"落地复合外键：
--
--   audit_log(org_id, store_id) REFERENCES store(org_id, id)
--
-- 复合 FK 在默认 READ COMMITTED 下即关闭两个并发方向（已在 PG 17 独立集群
-- 用两连接交错实测）：
--   方向 A：T1 改 store.org_id 未提交 → T2 插入旧组织审计引用。T2 的 RI 检查
--     对 store 行取 FOR KEY SHARE，与 T1 的 key-update 行锁冲突而等待；T1 提交
--     后 RI 检查用最新快照重评，(org_id=A, id=S) 不再存在 → T2 被拒。
--   方向 B：T2 先插入审计引用（持有 store 行 KEY SHARE）→ T1 改 store.org_id
--     属于被引用键变更，与 KEY SHARE 冲突而等待；T2 提交后 RI 反向检查用最新
--     快照发现仍被引用 → T1 被拒。
-- 语义：
--   - MATCH SIMPLE（默认）：store_id 为 NULL（组织级操作）不适用该约束；
--   - ON DELETE SET NULL (store_id)：删除店铺只清空 store_id、保留 org_id；
--   - 存量坏行守卫保留（先精确计数报错再建约束，禁止静默改写历史审计）；
--   - v1 触发器（插入/更新同域校验）与 v2 父行守卫保留，作为 FK 之外的纵深防御。
--
-- M04 背景：REVIEW_2 核定的"领域 UUID 数据库格式约束"延期触发点（首次后续
-- Schema 变更）已随本迁移到达。按 04_DATA_MODEL"所有 P0 实体采用 UUID 领域
-- 主键"，对全部领域表主键加格式 CHECK；认证框架四表保持原生 string 主键不动。
-- 外键列格式由引用完整性传导（引用目标主键已受约束），不重复加 CHECK。

-- 1) H08 升级守卫：存量跨域审计引用必须先人工处理，禁止静默通过或改写
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

-- 2) 复合外键：审计引用必须在 store(org_id, id) 中同域存在。
--    被引用侧复用 p0_init 已建的 store_org_id_id_key 唯一索引
--    （schema Store.@@unique([orgId, id])），无需新建唯一约束。
ALTER TABLE "audit_log" ADD CONSTRAINT "fk_audit_log_store_same_domain"
  FOREIGN KEY ("org_id", "store_id") REFERENCES "store" ("org_id", "id")
  ON DELETE SET NULL ("store_id");

-- 3) M04：领域主键 UUID 格式约束（认证框架表除外）
DO $$
DECLARE
  t TEXT;
  bad BIGINT;
  tbls TEXT[] := ARRAY[
    'domain_user','organization','membership','invitation','store',
    'data_source','rule_config','product','sku','sku_alias',
    'order','order_item','after_sale_record','refund_event',
    'ad_metric','customer_message','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE id !~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''',
      t) INTO bad;
    IF bad > 0 THEN
      RAISE EXCEPTION '表 % 存在 % 条非 UUID 格式的主键 id，拒绝升级；请先人工核对', t, bad;
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT ck_domain_uuid_%s CHECK (id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'') NOT VALID',
      t, t);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT ck_domain_uuid_%s', t, t);
  END LOOP;
END $$;
