# CODEX_REVIEW_HANDOFF｜CODEX_REVIEW_GATE_01（Phase 1 冻结版）

- 生成日期：2026-09-13
- 审查类型：**Phase 1 完成门**（CODEX_REVIEW_GATE_01）
- 交接根目录：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`
- 开发依据：`DEVELOPMENT_HANDOFF.md`（v1.1）+ `FINAL_DECISIONS.md` + `docs/ai-ecommerce-assistant/` 分册 + 根目录 `PHASE_PLAN.md`

## 项目

AI 电商运营助手（P0 MVP）。目标：老板每天一页看懂经营变化、待复核问题、证据与优先行动。当前阶段：**Phase 1（项目地基）四个 TASK 全部完成**，等待本 Gate 审查后合并 main。

## Git 冻结信息

| 项 | 值 |
|---|---|
| Current Branch | `phase/01-foundation` |
| Base Branch | `main` |
| Review Commit | 本文件提交后的最新 commit（`git log -1 phase/01-foundation`） |
| Previous Review Commit | 无（首个 Gate） |
| Git Diff Range | `main..phase/01-foundation` |
| Working Tree | clean，已推送 origin（`origin/phase/01-foundation` 同步） |
| Project Status | CODEX_REVIEW_REQUIRED |

## 本阶段完成 TASK

| TASK | Commit | 内容 |
|---|---|---|
| TASK-001 可启动的应用与验证环境 | 并入重建基线（见"特殊说明"） | Next.js 16/React 19/TS5/Tailwind4 最小工程；/api/health（ok/degraded）；独立 Worker+心跳状态检查；env 分阶段校验；Docker/Compose；本地 PG17 |
| TASK-002 P0数据库与约束迁移 | 并入重建基线 | Prisma 7.10.0（driver adapter）；28 领域实体+Better Auth 官方四表；复合外键 (org,id)/(org,store,id)；p0_init+p0_constraints（20+ CHECK、单 Owner 与 recompute 目标部分唯一） |
| TASK-003 登录、初始Owner与受控邀请 | `a77f7b5` | Better Auth 1.7.4（DB session、无公开注册、委托门面映射 Auth* 表）；邀请 48h 单次（SHA256 落库、CAS 原子消费）；Owner 初始化幂等；登录/邀请数据库限流；/api/v1 me/invitations/members；/login、/invite/[token] 页面 |
| TASK-004 组织隔离与固定权限服务 | `1ab433f` | 固定能力矩阵（含导入/邀请/管理范围）；requirePermission 统一授权入口；requireStoreAccess 同域校验（跨组织 404）；客服告警白名单与字段投影；路由改造+organization 端点 |

## 本阶段新增功能（工程能力，无业务范围扩张）

登录/会话/邀请/成员管理/组织信息端点；权限矩阵与统一授权入口；数据库限流；初始化与重置脚本；全部页面仅 /login 与 /invite/[token]（无业务页面，符合合同禁止项）。

## 主要修改文件

- 规格与流程：`DEVELOPMENT_HANDOFF.md`、`FINAL_DECISIONS.md`、`PHASE_PLAN.md`、`docs/ai-ecommerce-assistant/12_PROGRESS.md`（Git 状态段+四份执行记录+事故记录）、`README.md`（应用）
- 应用：`prisma/`（schema+3 迁移）、`prisma.config.ts`、`src/lib/{env,dotenv,db,auth,session,http,rateLimit,email,workerStatus}.ts`、`src/services/{audit,invitations,ownerInit}.ts`、`src/services/access/{permissions,index}.ts`、`src/database/prisma.ts`、`src/app/api/`（auth/[...all]、v1/me*、v1/organization、v1/invitations*、v1/members*、health）、`src/app/(auth)/*`、`src/instrumentation*.ts`、`src/jobs/{worker,status}.ts`、`scripts/*`、`tests/**`
- 完整清单：`git diff --stat main..phase/01-foundation`

## 数据库变化

28 张领域表 + 4 张 Better Auth 官方表 + auth_rate_limit + _prisma_migrations（33+1）；全部约束见 `prisma/migrations/`。

## API 变化

`/api/auth/*`（库原生）、`/api/health`、`/api/v1/{me, me/active-organization, organization, invitations, invitations/{idOrToken}, invitations/{token}/accept, members, members/{id}}`。

## AI 逻辑变化

无（TASK-017 起）。

## 核心业务逻辑（本阶段=身份/权限/数据底座）

- 认证：Better Auth + 领域 User 映射（auth_user_id）；禁用即时失权（删会话+领域禁用）
- 邀请：token 只存哈希；CAS 消费（并发仅一次）；邮箱一致性 403；过期实时 410
- 权限：能力矩阵纯函数 + requirePermission 单入口 + requireStoreAccess 同域 404
- 数据：B/T/F 共用字段、六组 v1.1 契约修订字段、20+ CHECK 与 2 个部分唯一索引

## 测试结果（2026-09-13 冻结时全量回归）

| 套件 | 结果 |
|---|---|
| typecheck | ✅ 0 错误 |
| unit（env 7 + 能力矩阵/投影 7） | ✅ 14/14 |
| integration（db 4 + database 9 + auth 8 + permissions 7，真实 PG17×独立测试库） | ✅ 28/28 |
| build（web+worker） | ✅ 退出码 0 |
| e2e（Playwright：登录/错误密码/会话 me/未登录 401/健康/基础页） | ✅ 6/6 |

## 尚未解决的问题

1. 本机无 Docker：compose 链路未本机执行（文件已交付，TASK-029 部署验证）
2. TASK-001/002 的原始 commit 因 iCloud 事故丢失，代码经等价重建并入基线 commit（详见 12_PROGRESS 事故记录与 TASK-002 已知限制①）
3. 旧下载地址/旧 job 重放拒绝分别属 TASK-007/013 对象（本阶段已覆盖 Cookie 重放拒绝）
4. Better Auth 1.7.4 prismaAdapter 无 modelMapping，采用委托门面——升级需复核
5. E2E 默认密码仅用于本地演示库

## 当前已知风险

- Next.js 16.3.5 / React 19.2.8 / Prisma 7.10 / better-auth 1.7.4 均为当前主线版本，后续升级需按 11_DEVELOPMENT_RULES 最小变更流程
- iCloud 同步事故史：仓库已建立 GitHub 备份（本分支即产物），但工作区仍在 Documents 下（见 MEMORY 约定：勤提交、保持同步）

## 需要 Codex 重点检查

1. 逻辑错误：env 校验分支、限流 SQL 原子性与等待秒数计算、邀请 CAS/回滚路径、禁用失权时序
2. 架构：权限单入口是否被绕过（有没有路由仍自行判权）；权限矩阵与 02_USER_ROLES 是否逐行一致
3. 数据模型：schema 与 04_DATA_MODEL PART10 的字段/键/约束一致性（重点：六组 v1.1 修订字段、复合外键正确性）
4. API：与 08_API_SPEC §17.1/17.2 一致性（信封、错误码、201/409/410/403/404 语义、遮罩 email、不回 token）
5. 安全：错误信息不泄值；Cookie 属性；.env 不入库；限流可绕过性（X-Forwarded-For 伪造）；邀请 token 熵与哈希落库；审计不含敏感内容
6. 不必要复杂度：委托门面 vs 重命名模型；是否提前实现了 005+ 的内容
7. 后续 Phase 影响：access 服务 API 形状是否支撑 007 文件/013 任务/019 AI 证据复用
8. 测试缺失：并发接受邀请的竞态覆盖是否充分；缺密码重置脚本的真实运行验证
9. 是否符合 DEVELOPMENT_HANDOFF（§5.3/§5.4 不变量、TASK-003/004 合同逐项）
10. 是否擅自扩大 P0 范围

## 建议 Codex 优先阅读

| 顺序 | 文件 |
|---|---|
| 1 | `DEVELOPMENT_HANDOFF.md` §5 不变量 + `FINAL_DECISIONS.md` |
| 2 | `docs/ai-ecommerce-assistant/12_PROGRESS.md`（Git 状态+四份执行记录+事故记录） |
| 3 | `ai-ecommerce-assistant/README.md` |
| 4 | `ai-ecommerce-assistant/src/services/access/{permissions.ts,index.ts}` |
| 5 | `ai-ecommerce-assistant/src/services/{invitations.ts,ownerInit.ts,audit.ts}` |
| 6 | `ai-ecommerce-assistant/src/lib/{auth.ts,session.ts,rateLimit.ts,http.ts,env.ts}` |
| 7 | `ai-ecommerce-assistant/prisma/schema.prisma` + `prisma/migrations/*` |
| 8 | `ai-ecommerce-assistant/src/app/api/` 全部路由 |
| 9 | `ai-ecommerce-assistant/tests/`（unit/integration/e2e） |
| 10 | `ai-ecommerce-assistant/scripts/{init-owner,reset-owner-password,postgres.sh}` |

## Review 结果回填约定

PASS → 合并 main（merge commit: `merge: phase/01-foundation after CODEX_REVIEW_GATE_01`，不 squash）→ 从最新 main 建 `phase/02-data-ingestion`。
PASS_WITH_FIXES → 先修 Critical/High → 单独 commit（`fix(TASK-00X): codex review fixes`）→ push → 更新本文件 → 按要求决定是否复审。
BLOCKED / GPT_PRODUCT_DECISION_REQUIRED → 停止，等待 Owner。
