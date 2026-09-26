-- G2-M02（Gate-02 修复）：店铺同名原子保护——同组织内店铺名唯一。
-- 对应 Schema 中 Store 的 @@unique([orgId, name])；并发创建/改名由数据库约束原子裁决，
-- 应用层将唯一冲突映射为 409 STORE_NAME_EXISTS。
-- 该迁移不触碰 audit_log 复合外键（M07 人工维护约定无需触发 H08 回归）。
CREATE UNIQUE INDEX "store_org_id_name_key" ON "store"("org_id", "name");
