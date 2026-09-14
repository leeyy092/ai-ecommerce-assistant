-- Gate-01 REVIEW_4 M07｜Schema 同步：审计复合外键进入迁移维护边界。
--
-- Schema（AuditLog.store）已声明复合关系 (orgId, storeId) → Store(orgId, id)，
-- 使该约束成为 Prisma 意图的一部分；本迁移对齐数据库侧，避免自动 diff 生成
-- 悬空的 DROP：
--   1) 删除被复合外键覆盖的单列外键 audit_log_store_id_fkey——其
--      ON DELETE SET NULL 语义（删除店铺清空 store_id、保留 org_id）已由
--      复合外键的 MATCH SIMPLE + SET NULL (store_id) 完整承载；
--   2) 将复合外键更名为 Prisma 约定名 audit_log_org_id_store_id_fkey，
--      使名称对齐、仅剩定义性差异。
--
-- 已知边界（自定义 SQL 不能由 Schema 表达，须人工保护）：
--   Prisma 的 onDelete: SetNull 生成"全部引用列置空"的 FK；本约束使用
--   PG 特有的按列 SET NULL (store_id)（org_id 必填，全列置空会使删除店铺失败，
--   违背 H08 删除语义）。因此 prisma migrate diff 会持续输出对该 FK 的
--   DROP+ADD 等价重建（同引用、同 ON DELETE SET NULL 类型，仅列清单表达差异）。
--   维护规则：任何自动生成且包含 audit_log 外键变更的迁移必须人工审查，
--   不得直接应用；行为护栏为 H08 回归（双向并发拒绝、删除店铺只清 store_id、
--   存量坏行守卫），照用破坏性迁移会被回归立即拦截。

ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_store_id_fkey";
ALTER TABLE "audit_log" RENAME CONSTRAINT "fk_audit_log_store_same_domain" TO "audit_log_org_id_store_id_fkey";
