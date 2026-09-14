-- Gate-01 M04/H06（正式复核）｜领域 User 到认证身份的数据库外键。
-- 升级守卫：存在悬空 auth_user_id 时拒绝通过（H06 的历史损坏在此显性化）。
-- 删除策略 RESTRICT：有领域身份时认证账号不可被删（H06 修复后也不应再出现悬空）。

DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad FROM domain_user u
  WHERE NOT EXISTS (SELECT 1 FROM "user" a WHERE a.id = u.auth_user_id);
  IF bad > 0 THEN
    RAISE EXCEPTION 'domain_user 存在 % 条悬空 auth_user_id，拒绝升级；请先人工核对这些身份链', bad;
  END IF;
END $$;

ALTER TABLE "domain_user"
  ADD CONSTRAINT "domain_user_auth_user_id_fkey"
  FOREIGN KEY ("auth_user_id") REFERENCES "user"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
