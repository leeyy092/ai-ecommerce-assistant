# CODEX_REVIEW_HANDOFF｜CODEX_REVIEW_GATE_01_REVIEW_2（第二轮复审交接）

- 生成日期：2026-09-13（ZCode 修复完成后）
- 交接根目录：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`
- 审查类型：**Gate-01 第二轮复审**（第一轮 BLOCKED → H01–H10 已修复 → 待复审）
- 修复依据：[docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md](docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md) + [GATE_01_EVIDENCE.json](docs/reviews/GATE_01_EVIDENCE.json) + Owner 对 D01 的裁决（方案 A，RESOLVED）

## 复审定位信息

| 项 | 值 |
|---|---|
| Current Branch | `phase/01-foundation` |
| Base Branch | `main`（= 2a983cc） |
| Base Review Commit（第一轮冻结） | `c263610541f8c8f7b41fd38c185f5feac94e8ee2` |
| Current Review Commit | 本文件提交后的最新 commit（`chore(review): prepare gate-01 review-2`） |
| Git Diff Range | `c263610..HEAD`（复审范围） |
| Project Status | CODEX_REVIEW_REQUIRED（Checkpoint=YES；禁止合并 main / Phase 2 / TASK-005） |
| Working Tree | 提交并推送本文件后 clean，与 origin/phase/01-foundation 一致 |

## Fixes：H01–H10（逐项 ACCEPT）

| # | 修复 commit | 修复内容 | 复审要点 |
|---|---|---|---|
| H10 | 73a5108 | Dockerfile deps 先 COPY prisma/schema.prisma+prisma.config.ts 再 install；compose 注入 BETTER_AUTH_SECRET/URL；docker-deps-repro.sh 等价复现 OK | 干净布局 install+generate；**真实 Docker runtime 未实测（本机无 Docker）** |
| H08 | 3e90bf6 | 新迁移 p0_audit_tenant_fk：audit_log 同域触发器（同域/空 store 放行、异域拒绝）；选触发器而非复合外键的原因见迁移注释 | 异域 INSERT 被 DB 拒绝；空 store 合法；删除行为=单列 FK SET NULL |
| H09 | 3e90bf6 | 新迁移 p0_domain_timestamptz：77 列 TIMESTAMPTZ(6) 显式 `USING ... AT TIME ZONE 'UTC'`（历史行均 Prisma UTC 墙钟、集群时区 Asia/Shanghai）；Auth 四表保持框架原生；auth_rate_limit 重置 | 空库+升级双路径；UTC/+08 同一时刻等值；默认值/ORM 路径 |
| H04 | 63e16ea | `/api/auth/sign-up/email` HTTP 层 403 PUBLIC_SIGNUP_DISABLED；受控路径（初始化/邀请）走服务端 auth.api 不受影响 | 匿名 URL 拒绝且零 AuthUser；两条受控路径成功 |
| H05 | 63e16ea | 接受邀请转发框架 signUpEmail(asResponse:true) 的完整 Set-Cookie；不再手工伪造 Cookie | E2E 双浏览器上下文：接受→受保护接口 200 |
| H06 | 63e16ea | 输入写库前完整校验（422 零副作用）；孤儿 Auth 身份回收（幂等重试恢复）；单事务+PG 事务级咨询锁（邮箱+邀请双键）覆盖 CAS+领域+审计；Auth 创建失败/事务失败补偿删除 | 长姓名 500→422 无残留；孤儿恢复；注入失败→邀请 pending+AuthUser 0→重试成功；并发仅一成功 |
| H07 | 63e16ea + e56be99 | 邀请创建/撤销/接受、成员 PATCH（CAS+会话撤销+审计）、organization PATCH（CAS+审计，补齐缺失审计）全部单事务 | DB 级 NOT VALID 约束注入：失败后业务/版本/审计零提交 |
| H01 | e56be99 | session.ts 唯一活跃组织解析（Cookie 仅在有效成员关系内选择，否则回退首个）；/me、requirePermission、organization 读写同源；active-organization 直接写响应 Set-Cookie | 同账号 A=owner/B=CS：切换后读写均为 B、CS 无预算/无 PATCH 权；伪造 Cookie 回退 |
| H02 | e56be99 | assertRoleAssignment 校验拟授予新角色：Admin 禁授 admin；owner 永不可授予 | Admin op→admin 403 且角色不变；Owner 合法；P↔C 允许 |
| H03 | e56be99 | D01 方案 A：禁用仅本组织 Membership.status+撤登录会话；不修改全局 User.status；其他组织可用（重登验证）；02_USER_ROLES 已同步裁决 | A 禁用不伤 B 的 Owner；旧 Cookie 401；重登 active_org=B role=owner |

**D01：RESOLVED（方案 A）**——Owner 2026-09-13 裁决：组织成员禁用仅影响当前 Organization 的 Membership；不通过组织接口改全局 User.status；其他组织有效 Membership 继续可用；全局封禁属平台级运维 P0 不开发。已同步 `docs/ai-ecommerce-assistant/02_USER_ROLES.md`。

## Tests（修复后全量真实执行，2026-09-13）

| 套件 | 结果 |
|---|---|
| typecheck | ✅ 0 错误 |
| unit（env 7 + 权限矩阵/投影 7） | ✅ 14/14 |
| integration（7 文件 46 例：db 4 / database 9 / auth 8 / permissions 7 / **gate01.db 3** / **gate01.auth 8** / **gate01.access 7**） | ✅ 46/46 |
| build（web+worker） | ✅ 退出码 0 |
| e2e（原 6 + **邀请全流程 + 公开注册拒绝**） | ✅ 8/8 |
| migration | ✅ 空库×4 套件 + aiea_dev 升级（deploy 后 Already in sync） |
| docker deps 等价复现 | ✅ scripts/docker-deps-repro.sh OK |

新增回归覆盖：多组织授权（双组织双角色读写同源/伪造 Cookie 回退）、role escalation（Admin 提权 403）、member disable isolation（A 禁用不伤 B）、public signup rejection、invitation success session（框架 Cookie 真实会话）、invitation failure recovery（孤儿/补偿/重试/并发）、audit transaction rollback（邀请/成员/组织三处注入）、AuditLog 跨组织 FK（触发器）、timezone semantics（类型断言+UTC/+08 等值）、Docker dependency installation path（等价复现）。Codex 原有测试全部保留并通过。

## Known Issues（剩余）

1. **真实 Docker runtime 构建/启动未实测**（本机无 Docker）——H10 已修配置并用相同布局等价复现验证，但干净容器构建→迁移→登录链路仍需真实 Docker 环境（TASK-029 部署阶段或提供 Docker 的机器）。
2. E2E 默认密码仅用于本地演示库 aiea_dev。
3. 旧下载地址/旧 job 重放拒绝分别属 TASK-007/013 对象（本轮已覆盖 Cookie 重放拒绝）。

## Medium Follow-up（M01–M04：未修复，不阻塞本轮）

| # | 内容 | 状态 |
|---|---|---|
| M01 | 业务写 API Origin/CSRF 校验 | Follow-up（建议 TASK-005 前置或并入首个业务写端点任务） |
| M02 | 仅成功认证清零登录失败计数（400/429 不清零）；固定代理信任边界 | Follow-up |
| M03 | 输入类型/长度统一 Zod 校验与未预期异常稳定信封 | Follow-up（本轮已在 organization PATCH/邀请路径落地局部校验） |
| M04 | User.authUserId 外键与领域 UUID 数据库校验 | Follow-up（建议与下一次 schema 迁移一并评估） |

## 建议 Codex 优先阅读（按 diff 顺序）

| 顺序 | 文件 |
|---|---|
| 1 | `git log c263610..HEAD --oneline`（4ec0011→73a5108→3e90bf6→24f877a→63e16ea→e56be99） |
| 2 | `prisma/migrations/20260913043631_p0_domain_timestamptz/`、`20260913044218_p0_audit_tenant_fk/` |
| 3 | `src/lib/session.ts`（H01 唯一解析点）、`src/app/api/v1/me/active-organization/route.ts` |
| 4 | `src/services/invitations.ts`（H05/H06/H07：校验前置/咨询锁事务/补偿）、`src/services/ownerInit.ts` |
| 5 | `src/app/api/auth/[...all]/route.ts`（H04 封禁）、`src/app/api/v1/invitations/[idOrToken]/accept/route.ts`（H05） |
| 6 | `src/app/api/v1/members/[id]/route.ts`（H02/H03/H07）、`src/app/api/v1/organization/route.ts`（H01/H07） |
| 7 | `tests/integration/gate01.{db,auth,access}.test.ts`（新增 18 例回归）+ `tests/e2e/auth.spec.ts`（新增 2 例） |
| 8 | `Dockerfile`、`compose.yaml`、`scripts/docker-deps-repro.sh`（H10） |
| 9 | `docs/ai-ecommerce-assistant/02_USER_ROLES.md`（D01 同步）、`docs/ai-ecommerce-assistant/12_PROGRESS.md`（修复执行记录） |

## 复审结论回填约定

PASS → Owner 放行 → 合并 main（`merge: phase/01-foundation after CODEX_REVIEW_GATE_01`，不 squash）→ 创建 `phase/02-data-ingestion` → TASK-005。
PASS_WITH_FIXES → 修复 Critical/High → 独立 commit → 更新本文件 → 按要求决定是否第三轮。
BLOCKED / GPT_PRODUCT_DECISION_REQUIRED → 停止等待 Owner。
