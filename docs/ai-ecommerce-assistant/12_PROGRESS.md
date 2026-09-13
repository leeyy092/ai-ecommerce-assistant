# 开发进度与交接

版本：v1.1 · 2026-09-12（含当晚 iCloud 事故恢复记录）。本文是项目唯一进度真源，规则中提到的progress.md均指此文件。

## 当前导航（唯一进度的一部分）

**Phase 1 项目地基 / CODEX_REVIEW_GATE_01_REVIEW_2 = CODEX_REVIEW_REQUIRED / H01–H10 修复完成待复审 / 下一工具 Codex。**
D01 已由 Owner 裁决为方案 A（RESOLVED）并同步至 02_USER_ROLES。ZCode 已按依赖顺序完成 H01–H10 全部修复（TASK-001→004 各自独立 commit 并推送）；真实 HTTP 多组织/角色/邀请、审计故障注入、迁移升级与时区等值回归全部通过。等待 Codex 第二轮复审；复审 PASS 且 Owner 放行前禁止合并 main 或开始 TASK-005。

<!-- PRODUCT_OS_STATE_BEGIN -->
```json
{
  "schema_version": 1,
  "project_name": "电商中台 · AI 电商运营助手",
  "goal": "让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动",
  "stage": "07 阶段审查 · Phase 1 项目地基 · Gate-01 第二轮",
  "current_task": "GATE_01_REVIEW_2",
  "status": "CODEX_REVIEW_REQUIRED",
  "last_completed": "H01–H10 修复完成（fix TASK-001/002/003/004 四个提交）；D01=RESOLVED 方案A",
  "next_action": "Codex 第二轮复审 c263610..<latest>；PASS 后 Owner 放行才可合并 main 并开 Phase 2",
  "next_owner": "Codex",
  "next_prompt": "docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md + CODEX_REVIEW_HANDOFF.md(REVIEW_2)",
  "acceptance": "复审基于实际差异覆盖 H01–H10 与 D01 落实；复跑原测试与反例（真实 Cookie、多组织读写/撤权、邀请失败与并发恢复、审计回滚、迁移升级、容器依赖路径）",
  "blockers": "等待 Codex 第二轮复审结论；Docker 真实 runtime 构建仍未实测（本机无 Docker，等价复现已过）；M01–M04 为 Follow-up 不阻塞。",
  "checkpoint": "YES",
  "review": "REVIEW_2 · CODEX_REVIEW_GATE_01 · 2026-09-13 · base c263610",
  "updated_at": "2026-09-13T15:40:00+08:00",
  "updated_by": "ZCode · Gate-01 H01–H10 修复执行",
  "evidence": [
    "fix(TASK-001) 73a5108：Dockerfile prisma 生成顺序 + compose 认证配置 + scripts/docker-deps-repro.sh 等价复现 OK",
    "fix(TASK-002) 3e90bf6+24f877a：audit_log 同域触发器迁移 + 77 列 TIMESTAMPTZ(UTC 显式转换) + gate01.db 3/3",
    "fix(TASK-003) 63e16ea：公开注册 403、框架 Set-Cookie、校验前置/孤儿恢复/咨询锁事务/补偿、邀请审计原子 + gate01.auth 8/8 + E2E 邀请全流程",
    "fix(TASK-004) e56be99：session 唯一活跃组织解析、拟授予角色校验、D01 方案A 仅 Membership、成员/org 审计同事务 + gate01.access 7/7",
    "修复后全量回归：typecheck 0 错、unit 14/14、integration 46/46、build 0、e2e 8/8；aiea_dev 升级部署 Already in sync"
  ],
  "github": {
    "status": "已连接（SSH）；修复提交均已推送 origin/phase/01-foundation",
    "url": "https://github.com/leeyy092/ai-ecommerce-assistant",
    "verified_at": "2026-09-13T15:40:00+08:00",
    "evidence": "git push origin phase/01-foundation 至 e56be99 成功；远端与本分支一致"
  },
  "deployment": {
    "status": "unknown（无生产部署；本机无 Docker）",
    "url": "",
    "verified_at": "2026-09-13T15:40:00+08:00",
    "evidence": "docker-deps-repro.sh 静态等价复现通过；真实 docker build/compose 未执行"
  }
}
```
<!-- PRODUCT_OS_STATE_END -->

## Git 状态（由 Zcode 自动维护；2026-09-13 Owner 授权 Git 生命周期规则）

- Project Status：**CODEX_REVIEW_REQUIRED**（CODEX_REVIEW_GATE_01_REVIEW_2，等待 Codex 第二轮复审）
- Current Branch：`phase/01-foundation`
- Base Branch：`main`
- Origin：`git@github.com:leeyy092/ai-ecommerce-assistant.git`（SSH）
- 同步状态：修复提交已全部推送（e56be99）；本段更新随最终 chore(review) 提交推送后工作区 clean。
- Base Review Commit（Gate-01 冻结）：`c263610541f8c8f7b41fd38c185f5feac94e8ee2`
- Current Review Commit（REVIEW_2）：本段提交后的最新 commit（chore(review): prepare gate-01 review-2）
- Git Diff Range（复审范围）：`c263610..HEAD`
- 修复提交清单：4ec0011 docs(review) 基线 → 73a5108 fix(TASK-001) → 3e90bf6+24f877a fix(TASK-002) → 63e16ea fix(TASK-003) → e56be99 fix(TASK-004)
- Fixes：H01–H10 全部；D01：RESOLVED（方案 A）
- Tests（修复后全量）：typecheck 0 错；unit 14/14；integration 46/46（7 文件）；build 0 错误；e2e 8/8；空库迁移×4 套件 + aiea_dev 升级 Already in sync；docker deps 等价复现 OK
- Known Issues：真实 Docker runtime 构建未实测（本机无 Docker）；E2E 演示密码仅本地库
- Medium Follow-up：M01 Origin/CSRF、M02 限流清零语义、M03 输入验证信封、M04 Auth 外键/UUID——均未修复，登记为 Review Follow-up（不阻塞本轮）
- Next Action：Codex 第二轮复审 → PASS + Owner 放行 → 合并 main → 创建 phase/02-data-ingestion
- Git Diff Range：`main..phase/01-foundation`
- TASK 验收（本 Phase）：TASK-001 FAIL、TASK-002 FAIL、TASK-003 FAIL、TASK-004 FAIL；ZCode 原完成记录保留为历史，当前需修复复审
- Test Results（冻结时全量回归）：typecheck 0 错误；unit 14/14；integration 28/28；build 0 错误；e2e 6/6
- Next Action：GPT/Owner 确认 D01 → ZCode 按报告逐 TASK 修复 → Codex 复审 → Owner 最终放行；当前禁止合并或 TASK-005
- 规则要点：main 只接收通过 Review Gate 的 Phase 合并；禁止 main 上开发/force push/重写历史；每 TASK 独立 commit（含编号，测试通过后提交）；Gate 冻结=干净树+已推送+HANDOFF 更新。

## 历史结论（2026-09-12 恢复时，当前以状态块与任务表为准）

两份审查的 P0 取舍已形成 FINAL_DECISIONS.md，并写入 v1.1 规格与交接入口。2026-09-12 收到 DEVELOPMENT_HANDOFF v1.1 作为开发指令，TASK-001（可启动的应用与验证环境）与 TASK-002（P0数据库与约束迁移）已完成并通过其全部指定检查；TASK-003 进行中被中断，恢复后维持 IN_PROGRESS。**2026-09-12 晚间发生 iCloud「桌面与文档」同步事故，工作区文件被大规模驱逐并最终整目录失联；已从 ZCode/Codex 会话转录与数据库 dump 完成重建（见下方事故记录），typecheck/unit 7/7/integration 13/13 在重建后全部通过。**未上传客户业务文件，未调用真实企业数据或收费模型。

## 历史仓库与远程状态（2026-09-12，仅保留当时记录）

- Remote：https://github.com/leeyy092/ai-ecommerce-assistant.git（Private；实际推送通道为 SSH `git@github.com:leeyy092/ai-ecommerce-assistant.git`，因本机钥匙串无 HTTPS PAT）
- Remote Status：CONNECTED
- GitHub Backup：ENABLED（main 已推送并跟踪 origin/main，本地 HEAD 与 origin/main 一致于 2a983cc）
- Current Branch：phase/01-foundation（自 main 2a983cc 创建，已推送并跟踪 origin/phase/01-foundation）
- Phase：Phase 1（foundation）。Phase 开发一律在 phase/01-foundation 进行；main 仅接受通过 Codex Review 后的合并推送
- 当前 TASK：TASK-003（登录、初始Owner与受控邀请）IN_PROGRESS；GitHub 连接未重置 TASK-001/002 的 DONE 状态
- Codex Review Checkpoint：NO（未到达 CODEX_REVIEW_GATE_01）

## 状态定义

- TODO：尚未开始。
- IN_PROGRESS：仅当前一个TASK在执行。
- BLOCKED：记录具体失败、已尝试方法、所需输入；不把未知写成通过。
- DONE：该TASK验收与指定测试都通过，且有可核对证据。

## 开发任务状态

| TASK | 名称 | 状态 | 依赖 | 测试/证据 |
|---|---|---|---|---|
| TASK-001 | 可启动的应用与验证环境 | BLOCKED | 无前置开发任务 | Gate 01 FAIL：H10 Docker/Compose；本地启动、build、Worker检查通过；原执行记录见下 |
| TASK-002 | P0数据库与约束迁移 | BLOCKED | TASK-001 | Gate 01 FAIL：H08审计同域、H09时间语义；现有迁移及约束测试通过；需修复后复审 |
| TASK-003 | 登录、初始Owner与受控邀请 | BLOCKED | TASK-002 | Gate 01 FAIL：H03–H07；公开注册、邀请会话/恢复、管理事务；原测试通过不等于验收 |
| TASK-004 | 组织隔离与固定权限服务 | BLOCKED | TASK-003 | Gate 01 FAIL：H01–H03；组织上下文、角色提升、跨组织禁用；D01待产品裁决 |
| TASK-005 | 店铺与数据源配置 | TODO | TASK-004 | 未执行 |
| TASK-006 | 统一Adapter与最小黄金样本 | TODO | TASK-005 | 未执行 |
| TASK-007 | 文件上传、私有存储与ImportTask | TODO | TASK-006 | 未执行 |
| TASK-008 | 字段映射、全量校验与预览 | TODO | TASK-007 | 未执行 |
| TASK-009 | 原子提交内核与商品主数据 | TODO | TASK-008 | 未执行 |
| TASK-010 | 订单头与订单行导入 | TODO | TASK-009 | 未执行 |
| TASK-011 | 广告日数据导入 | TODO | TASK-009 | 未执行 |
| TASK-012 | 客服、售后与退款事件导入 | TODO | TASK-009、TASK-010 | 未执行 |
| TASK-013 | 持久任务与快照发布骨架 | TODO | TASK-010、TASK-011、TASK-012 | 未执行 |
| TASK-014 | 基础经营与广告指标 | TODO | TASK-013 | 未执行 |
| TASK-015 | 退款与售后队列指标 | TODO | TASK-014 | 未执行 |
| TASK-016 | 确定性异常规则与快照发布 | TODO | TASK-015 | 未执行 |
| TASK-017 | 模型网关与结构化输出门禁 | TODO | TASK-004、TASK-016 | 未执行 |
| TASK-018 | VOC分类、人工标签优先与聚合 | TODO | TASK-017、TASK-012 | 未执行 |
| TASK-019 | 有证据的运营建议 | TODO | TASK-018 | 未执行 |
| TASK-020 | 固定日报调度与规则降级 | TODO | TASK-019 | 未执行 |
| TASK-021 | Dashboard与3分钟老板路径 | TODO | TASK-020 | 未执行 |
| TASK-022 | SKU列表、详情与产品聚合 | TODO | TASK-021 | 未执行 |
| TASK-023 | 客服中心与VOC人工修正 | TODO | TASK-018、TASK-021 | 未执行 |
| TASK-024 | 告警中心与阈值配置 | TODO | TASK-016、TASK-021 | 未执行 |
| TASK-025 | 建议行动状态与日报阅读 | TODO | TASK-020、TASK-021 | 未执行 |
| TASK-026 | 导入向导与历史问题恢复 | TODO | TASK-008至TASK-016、TASK-021 | 未执行 |
| TASK-027 | 必要系统设置与成员管理UI | TODO | TASK-005、TASK-017、TASK-021 | 未执行 |
| TASK-028 | 演示包与手工可核对案例 | TODO | TASK-022至TASK-027 | 未执行 |
| TASK-029 | 试点运行与最低安全运维 | TODO | TASK-028 | 未执行 |
| TASK-030 | 整体验收与真实试点交接 | TODO | TASK-029 | 未执行 |

## 实际验收状态

| 项目 | 当前状态 | 达成时需要的证据 |
|---|---|---|
| 应用可启动 | 2026-09-13 Codex 本地启动/build/E2E/Worker通过；容器路径 H10 阻断，TASK-001 整体 FAIL | 修复 Docker/Compose 并真实容器验证 |
| 六类CSV导入 | 未开发/未执行 | 全链路导入与错误/幂等验证 |
| 指标与规则正确 | 未开发/未执行 | 黄金案例手算与实际PG结果一致 |
| 角色隔离 | Phase 1 已实现并审查，但 H01–H03 失败；未来文件/AI对象尚未实测 | 修复后真实多组织角色/撤权回归及后续对象测试 |
| AI联网质量 | 未执行 | 固定模型、脱敏测试集、分类与事实引用指标 |
| 首页三分钟任务 | 未执行 | 目标角色观察记录，不能用截图替代 |
| 性能/恢复 | 未执行 | 指定规模p95/p99、备份恢复记录 |
| 真实企业试用 | 未验证 | 企业脱敏文件与实际使用记录 |
| 再次使用/报价/付款 | 均未验证 | 分别提供使用、报价接受与付款证据 |

## 历史恢复下一步（2026-09-12，TASK-003 后续已完成）

恢复 TASK-003（登录、初始Owner与受控邀请）：开始前阅读 02_USER_ROLES.md、08_API_SPEC.md §17.2 与 DEVELOPMENT_HANDOFF §5.3/§5.4（登录/邀请限流与 Owner 初始化要求）。TASK-003 中断时的在途改动已并入重建后的 schema（AuthRateLimit 模型 + auth_rate_limit 表），其结构已包含在重建的 p0_init 迁移中；继续 TASK-003 时直接在现有 schema 基础上开发。

实际试点前需补证：首家企业的真实导出字段和范围、老板采用日报的实际流程、百炼账号可用模型/地域、部署域名与资源条件。它们是后续任务输入，不在本次伪造为已确认事实。

## TASK-001 执行记录（2026-09-12）

- 日期/执行人：2026-09-12 · Zcode（依据根目录 DEVELOPMENT_HANDOFF.md v1.1 第 4 节执行包）。
- 状态：DONE。
- 完成行为：在 `ai-ecommerce-assistant/` 建立可启动工程——Next.js 16.3.5/React 19.2.8/TypeScript 5/Tailwind 4 基础页面与 layout；`src/lib/env.ts` 分阶段环境校验（错误只含变量名不含值）；`GET /api/health`（200 ok / 503 degraded，响应仅 status 字段）；`src/jobs/worker.ts` 独立入口（环境校验→DB 连通→5s 心跳写 `.runtime/worker-status.json`→SIGINT/SIGTERM 正常退出，未注册任何业务队列）；`src/jobs/status.ts` 存活检查（退出码 0/1，兼作 compose healthcheck）；Web 启动 instrumentation 校验（缺失必需变量时明确报错并以退出码 1 终止）。未创建业务实体、业务页面、模型调用或云端部署。
- 环境与工具链：应用隔离 Node v24.21.0（`.tools/node24`，darwin-arm64 官方二进制）+ corepack pnpm 10.34.5；PostgreSQL 17（Homebrew 二进制，应用内实例 `.postgres/`，端口 5433，空库 `aiea_dev`）；`engines >=24 <25` 且 `engine-strict` 开启。未改动系统与其他项目运行环境。
- 修改路径（新增）：`ai-ecommerce-assistant/` 下 `package.json`、`pnpm-lock.yaml`、`.npmrc`、`.env.example`、`.gitignore`、`.dockerignore`、`tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`vitest.config.ts`、`playwright.config.ts`、`Dockerfile`、`compose.yaml`、`README.md`、`scripts/env.sh`、`scripts/postgres.sh`、`src/app/{layout,page,globals.css}`、`src/app/api/health/route.ts`、`src/instrumentation.ts`、`src/instrumentation-node.ts`、`src/lib/{env,dotenv,db,workerStatus}.ts`、`src/jobs/{worker,status}.ts`、`tests/unit/env.test.ts`、`tests/integration/db.test.ts`、`tests/e2e/smoke.spec.ts`。另有 gitignored 本地目录 `.tools/`、`.postgres/`、`.runtime/`、`.env`、`dist/`、`node_modules/`。
- 数据库变化：无业务表；仅创建空数据库 `aiea_dev`（TASK-002 起建表）。
- API 变化：新增 `GET /api/health`（公开探针，按 08_API_SPEC §17.2 契约）。
- 实际测试命令及结果（均在本机真实执行，2026-09-12）：`pnpm install --frozen-lockfile` ✅；`pnpm typecheck` ✅ 0 错误；`pnpm test` ✅ 7/7；`pnpm test:integration` ✅ 4/4；`pnpm build` ✅ 退出码 0；`pnpm test:e2e` ✅ 2/2；Worker 生命周期（start→状态 running→SIGTERM→stopped→退出码校验）与健康接口降级序列（PG 停→503 degraded→恢复 200）✅。过程细节以事故前 README 记录为准。
- 已知限制：① 本机未安装 Docker，compose 链路未在本机执行；② Worker 无业务 handler（按合同属 TASK-007）；③ 应用镜像 runner 阶段包含 devDependencies（TASK-029 再优化）；④ 事故后未重跑 build/e2e（代码与 TASK-001 时期一致或等价恢复，typecheck/unit/integration 已复验通过）。
- 下一TASK：TASK-002。

## TASK-002 执行记录（2026-09-12）

- 日期/执行人：2026-09-12 · Zcode（依据 v1.1 DEVELOPMENT_HANDOFF §5 与 09_TASKS TASK-002 合同）。
- 状态：DONE。
- 完成行为：按 04_DATA_MODEL PART 10（v1.1）落地全部 P0 数据库结构——`prisma/schema.prisma` 含 28 个领域实体（B/T/F 共用字段、evaluation_at、固定 VOC 日桶 K3、RuleEvaluation K6、R08/R09 subchannel、product_id_at_snapshot、previous_snapshot_* 快照保留三元组等六组契约修订字段）；Better Auth 官方四表（模型重命名 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 user/session/account/verification）；复合外键 (org_id,id)/(org_id,store_id,id) 全部以 Prisma 多字段 relation 表达（仅不可表达约束用 SQL）；两个迁移：`20260912102945_p0_init`（结构/索引/唯一键）与 `20260912103005_p0_constraints`（受审查 SQL：组织预算/消息限额、店铺快照三元组同时空或同时有效、订单 paid⇔paid_at、ordered_at≤paid_at、销量 1..100000000、金额≥0、退款 succeeded 条件字段、广告窗口 0..90、VOC 桶条件与计数关系、suppressed 必填 reason、币种 ^[A-Z]{3}$ 等 CHECK，及单 Owner 部分唯一、recompute_snapshot 目标部分唯一）；`src/database/prisma.ts` driver-adapter 单例；`prisma.config.ts` 显式注入连接串。
- 版本决策记录：Prisma 锁定稳定 7.10.0（npm latest 指向 8.0.0-RC，不符合"锁定兼容精确版本"）；Prisma 7 要求 driver adapter，新增 `@prisma/adapter-pg@7.10.0`；tsconfig target ES2022（BigInt 字面量）。
- 实际测试（2026-09-12 真实执行）：typecheck ✅ 0 错误；`tests/integration/database.test.ts` ✅ 9/9（空库 migrate deploy+幂等、正常链写入、异租户复合外键阻断、重复自然键阻断、单Owner部分唯一阻断、负销量/非法币种/退款条件字段 CHECK 阻断、P1 未建表且 28 领域+4 认证表齐备）；回归 install/test 7/7/integration 13/13/build 0 错误/e2e 2/2 ✅。事故后复验：typecheck ✅、unit 7/7 ✅、integration 13/13 ✅（重建迁移链）。
- 已知限制：① 原始 `p0_init` 迁移文件字节内容在 iCloud 事故中丢失，已按最终 schema 用 `prisma migrate diff --from-empty` 重建（同名目录、等价 SQL；`_prisma_migrations` 校验和链随之重建，属全新历史）；② TASK-003 中断时的 `p0_auth_protections` 迁移未恢复为独立文件，其结构（含 AuthRateLimit）已并入重建的 p0_init；③ build/e2e 未在事故后重跑。
- 下一TASK：TASK-003。

## 2026-09-12 晚 iCloud 事故与恢复执行记录

- 事故经过：19:06 前后，旧开发会话（上下文将满的窗口）执行 TASK-003 的 `prisma migrate dev` 时卡在交互式迁移命名提示挂起；同时段 iCloud「桌面与文档」同步守护进程异常，开始驱逐 `~/Documents/产品-开发` 下的文件（dataless 化），随后整目录从文件系统视图失联（含 `.git`、全部源码与文档）。挂在被驱逐文件上的读写导致 tsc/vitest/prisma/corepack 全部 0% CPU 挂死，一度连进程 spawn 都失败。19:18 结束了挂死的旧会话进程链；20 时前后完成诊断并开始恢复。
- 抢救与恢复手段：① 对仍在运行的 PostgreSQL 执行 `pg_dump`，保全 34 表完整结构（`/tmp/aiea-dev-db-dump.sql`）；② 从 `~/.zcode/cli/rollout/` 三个会话转录（约 81MB）按时间线重放 Write/Edit + bash heredoc + Read/cat 结果快照，恢复 50 个文本文件；③ 从 `~/.codex/sessions/` 提取载荷恢复《独立技术审查报告》（76697 字节，与原文件逐字节一致）；④ `/tmp/aiea-scaffold/`（未受 iCloud 影响）提供 next.config/postcss/pnpm-workspace/tsconfig 原件；⑤ 重装隔离 Node v24.21.0 + `corepack enable`，`pnpm install` 重建 node_modules 与 pnpm-lock.yaml；⑥ `prisma migrate diff --from-empty` 重建 p0_init，与恢复的 p0_constraints 组成新迁移链，在全新 PG 集群上 `migrate deploy`，并以 `migrate diff`（空差异）+ dump 结构对比（33 表/148 索引一致）验证等价；⑦ 修复重放损坏：schema.prisma 的 AuthRateLimit 模型重复 24 次（去重）、package.json 依赖丢失（按最终版重写）、database.test.ts 两处 `.sku`→`.sKU`。
- 恢复后验证（2026-09-12 真实执行）：`tsc --noEmit` ✅ 0 错误；unit 7/7 ✅；integration 13/13 ✅（含空库部署+幂等+全部约束阻断）。
- 恢复损失清单（未找回）：① `图豆AI产品与增长调研报告.md`（40285 字节，早于全部会话转录；同名 .docx 同失）——建议登录 iCloud.com「最近删除」尝试找回，或从原始来源重新导出；② `DEVELOPMENT_HANDOFF.md` 恢复至 26628/31424 字节（约 85%，尾部章节缺失），缺失内容可由 12 份规格 + FINAL_DECISIONS.md 补足开发所需；③ `SHA256SUMS.txt` 按恢复后文件重新生成（旧校验和已无意义）；④ `src/app/favicon.ico`（二进制未恢复，不影响构建）；⑤ `.env` 按已知变量重建（仅 DATABASE_URL/LOG_LEVEL，无密钥）。原 p0_init/p0_auth_protections 迁移字节、原始 pnpm-lock.yaml 已等价重建。
- 风险与建议：① 项目位于 iCloud 同步范围是事故根因，强烈建议把仓库迁出 `~/Documents`（如 `~/dev/`），或至少在系统设置中关闭「优化 Mac 存储」；② 已建立 git 基线提交，并将 `git bundle` 备份存放于 Documents 之外；③ 旧窗口（上下文将满的会话）请勿继续使用，避免双会话并发写同一仓库。
- 执行人：Zcode（新会话）。

## TASK-003 执行记录（2026-09-13）

- 日期/执行人：2026-09-13 · Zcode（依据 09_TASKS TASK-003 合同、02_USER_ROLES v1.1、08_API_SPEC §17.2、DEVELOPMENT_HANDOFF §5.3/§5.4 与 F10 限流归属）。
- 状态：DONE。
- 完成行为：
  - `src/lib/auth.ts`：Better Auth 1.7.4（emailAndPassword、数据库 session、无公开注册）；官方 prismaAdapter 1.7.4 无 modelMapping 选项，以委托门面（user→AuthUser 等）映射认证四表；trustedOrigins/baseURL 来自 BETTER_AUTH_URL。
  - `/api/auth/[...all]`：库原生路由；sign-in/email 外包裹数据库持久限流（登录失败 10 次/IP/分钟 → 429 含等待秒数；成功清零），`src/lib/rateLimit.ts`（auth_rate_limit 固定窗口原子 upsert，等待秒数在 SQL 内计算）。
  - `src/lib/session.ts` 会话上下文（Better Auth session → 领域 User + 活跃 Membership；禁用即时失权）；`src/lib/http.ts` 统一信封（data/meta.request_id、error.code、no-store）。
  - 邀请服务 `src/services/invitations.ts`：单次使用、48h、只存 SHA256 token 哈希、按角色可邀请范围（O→A/P/C，A→P/C）、已是成员 409、过期实时 410 落库、撤销乐观锁、接受 CAS 原子消费（并发仅一次成功）、新用户经 signUpEmail 建身份（库哈希）后事务建领域身份+Membership+审计、失败回滚 token 消费、已登录邮箱不符 403。
  - Owner 初始化 `src/services/ownerInit.ts` + `scripts/init-owner.ts`（密码仅 stdin/OWNER_PASSWORD_FILE 隐藏输入；幂等：重复执行返回既有身份不重设密码；不凭邮箱接管；DB 单 Owner 部分唯一双保险）；`scripts/reset-owner-password.ts` 一次性重置（better-auth/crypto hashPassword + 撤销全部会话 + 审计）。
  - 业务路由：GET `/api/v1/me`（memberships/active_org/role/allowed_modules）、PUT `/api/v1/me/active-organization`（成员校验+HttpOnly Cookie）、POST/GET `/api/v1/invitations`（列表遮罩邮箱不回 token）、GET/DELETE `/api/v1/invitations/{idOrToken}`（公开 token 预览限流 60/IP/min）、POST `…/accept`（防爆破 20/IP/min；新用户接受后下发登录 Cookie）、GET `/api/v1/members`、PATCH `/api/v1/members/{id}`（角色/禁用；Admin 不能动 O/A；禁用删全部会话+领域禁用；最后 Owner 保护）。
  - 页面：`/login`（表单+错误提示+无公开注册说明）、`/invite/[token]`（组织名/遮罩邮箱/到期时间；新用户建号 vs 已登录匹配/不符分流）。
  - instrumentation 启用 auth 组件校验（缺 BETTER_AUTH_* 启动失败）；`.env.example` 既有条目不变，本地 `.env` 注入开发 secret。
- 修改/新增路径：新增 src/lib/{auth,session,http,rateLimit,email}.ts、src/services/{audit,invitations,ownerInit}.ts、src/app/api/auth/[...all]/route.ts、src/app/api/v1/{me,me/active-organization,invitations,invitations/[idOrToken],invitations/[idOrToken]/accept,members,members/[id]}/route.ts、src/app/(auth)/{login,invite/[token]}/…、scripts/{init-owner,reset-owner-password}.ts、tests/integration/auth.test.ts、tests/e2e/{auth.spec.ts,auth.global-setup.ts}；修改 src/instrumentation-node.ts、playwright.config.ts（globalSetup）、README。
- 数据库变化：无 schema 变更（auth_rate_limit 已在重建的 p0_init 内）。
- API 变化：新增 /api/auth/*（库原生）与 08 §17.2 列明的 me/invitations/members 端点。
- 实际测试命令及结果（2026-09-13 真实执行）：`pnpm typecheck` ✅ 0 错误；`pnpm vitest run tests/integration/auth.test.ts` ✅ 8/8（初始化+真实会话登录、幂等重跑不改密码、单 Owner 部分唯一、禁用失权、Operator 禁邀、token 只存哈希、已成员 409、并发双接受仅一成功+重放拒绝、过期 410/邮箱不符 403/撤销 409、限流 10 次窗口 429+重置）；`pnpm test` ✅ 7/7；`pnpm test:integration` ✅ 21/21（3 文件）；`pnpm build` ✅ 0 错误；`pnpm test:e2e` ✅ 6/6（登录页、错误密码、登录成功+页面内 fetch /api/v1/me=owner、未登录 401、健康检查、基础页）；init-owner 脚本真实运行含幂等重跑 ✅。
- 已知限制：① E2E 密码默认值 e2e-owner-pass-123 仅用于本地演示库（aiea_dev），生产初始化必须用隐藏输入/受限文件；② Better Auth 1.7.4 prismaAdapter 无 modelMapping，采用委托门面——升级 better-auth 时需复核；③ C 角色登录默认入口的强制跳转在 TASK-004 权限服务落地后按 03 规则完善；④ 登录限流按 IP 计失败（成功清零），未区分共出口 NAT（08 已允许管理员调整）；⑤ 未提交 git commit——随后按 Git 规则以 feat(TASK-003) 提交。
- 下一TASK：TASK-004（组织隔离与固定权限服务）。

## TASK-004 执行记录（2026-09-13）

- 日期/执行人：2026-09-13 · Zcode（依据 09_TASKS TASK-004 合同与 02_USER_ROLES v1.1）。
- 状态：DONE。
- 完成行为：
  - `src/services/access/permissions.ts`：固定四角色能力矩阵（viewBusinessData/viewProductData/manageSettings/manageOrgInfo/viewMembers/导入范围/邀请范围/Admin 可管理范围/canViewDashboard），纯函数无运行时依赖，可单测；客服告警白名单（F04：R08 两子通道+R09，R03/R10 拒绝）与 `projectForRole` 字段投影。
  - `src/services/access/index.ts`：统一授权入口 `requirePermission`（session→活跃/指定组织成员→能力→可选店铺同域）；`requireStoreAccess`（店铺不存在或跨组织统一 404，不泄露存在性）；`assertMemberManageable`/`assertInvitable`；`AccessError`。
  - 路由改造为单一授权入口：invitations POST/GET/DELETE、members GET/PATCH、新增 organization GET/PATCH（O/A 可见预算字段，P/C 不可见；改名乐观锁）。`src/lib/http.ts` 增加 `serviceFailure`（服务层 {status,code,message} → 错误信封）与 `ok(meta.status)` HTTP 状态支持（修复邀请创建应 201）。
  - 已知边界：Dashboard/SKU/AI 端点属后续 TASK；本任务以能力矩阵 `canViewDashboard(C)=false`、店铺同域校验与 DB 复合键共同构成其前置防线，C 拒绝 Dashboard 将在 TASK-021/022/019 端点落地时直接复用 requirePermission。
- 修改/新增路径：新增 src/services/access/{permissions.ts,index.ts}、src/app/api/v1/organization/route.ts、tests/unit/permissions.test.ts、tests/integration/permissions.test.ts；重写 invitations×2/members×2 路由与 http.ts。
- 数据库变化：无。API 变化：新增 GET/PATCH /api/v1/organization。
- 实际测试（2026-09-13 真实执行）：typecheck ✅ 0 错误；unit 14/14（能力矩阵 5 + 客服投影 2 + env 7）；integration 28/28（新增 permissions 7/7：O/A 可见预算字段而 P/C 不可见、P 改组织名 403/O 200 乐观锁、C/P 邀请 403、Admin 邀 admin 403/邀 operator 201、P 成员列表 403、跨组织改成员 404、禁用后旧 Cookie 401、跨组织店铺 404、两组织同名 SKU 复合键隔离+同域拒绝）；build ✅ 0 错误；e2e 6/6。
- 已知限制：① 旧下载地址/旧 job 重放拒绝属 TASK-007/013 的文件与任务对象，本任务先行落地 Cookie 重放拒绝；② scoped repositories 完整形态随后续数据实体服务（005+）在 requireStoreAccess 之上生长，未提前建空壳。
- 下一TASK：无——Phase 1 全部完成，进入 CODEX_REVIEW_GATE_01。

## Gate-01 修复执行记录（2026-09-13，Zcode）

- 依据：docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md（BLOCKED，10 HIGH/4 MEDIUM）+ Owner D01 裁决（方案 A，RESOLVED）。
- 逐项判定：H01–H10 全部 **ACCEPT**；M01–M04 **DEFER**（登记 Follow-up，本轮不扩范围）。
- 按依赖顺序一次一个 TASK 修复，每个 TASK 独立 commit 并推送：
  - fix(TASK-001) 73a5108｜H10：Dockerfile deps 阶段先 COPY prisma/schema.prisma + prisma.config.ts 再 install（postinstall generate 不再缺 Schema）；compose 为 Web 注入 BETTER_AUTH_SECRET（缺失拒绝启动）/BETTER_AUTH_URL；scripts/docker-deps-repro.sh 在相同布局执行 install + postinstall 等价命令 → OK。真实 Docker runtime 未实测（如实保留缺口）。
  - fix(TASK-002) 3e90bf6 + 24f877a｜H08：新迁移 20260913044218_p0_audit_tenant_fk——audit_log 同域校验用数据库触发器（同域/空 store 放行、异域异常；不用复合外键的原因：Prisma 混合可空性建模限制 + 零漂移；删除行为维持单列 FK SET NULL）。H09：新迁移 20260913043631_p0_domain_timestamptz——77 个领域 DateTime 列 TIMESTAMPTZ(6)，显式 USING ... AT TIME ZONE 'UTC'（历史行均 Prisma UTC 墙钟；集群时区 Asia/Shanghai）；Auth 四表保持框架原生；auth_rate_limit 瞬时计数重置。空库（测试套件）与 aiea_dev 升级（deploy + Already in sync）双路径验证；迁移计数断言 2→4 修正。
  - fix(TASK-003) 63e16ea｜H04：/api/auth/sign-up/email HTTP 层 403 PUBLIC_SIGNUP_DISABLED（受控路径走服务端 auth.api 不受影响）。H05：接受邀请转发框架 signUpEmail 完整 Set-Cookie（asResponse:true），不再手工伪造 Cookie。H06：输入写库前完整校验（姓名 1–80/密码≥8，422 零副作用）；孤儿 Auth 身份安全回收（含幂等重试恢复）；接受流程单事务 + PG 事务级咨询锁（邮箱+邀请双键，并发串行、后到者 409 且从未建号）；Auth 创建在事务回调内、失败补偿删除（testHookAfterAuth 注入验证 + 重试成功）。H07：邀请创建/撤销/接受与审计同事务（DB 级 NOT VALID 约束注入证明零部分提交）。
  - fix(TASK-004) e56be99｜H01：src/lib/session.ts 为活跃组织唯一解析点（Cookie 仅在有效成员关系内选择，伪造/失效回退首个；/me、requirePermission、organization 同源）；active-organization 直接写响应 Set-Cookie（不经请求作用域 API）。H02：assertRoleAssignment 校验拟授予新角色——Admin 禁授 admin、owner 永不可授予。H03（D01 方案 A）：禁用仅更新本组织 Membership.status + 撤销登录会话，不修改全局 User.status；其他组织可用性保持（重登后验证）；02_USER_ROLES 已同步裁决。H07：members PATCH（CAS+会话撤销+审计）与 organization PATCH（CAS+审计，补齐原先缺失的审计）单一事务。
- 新增回归：tests/integration/gate01.db.test.ts（3）、gate01.auth.test.ts（8）、gate01.access.test.ts（7）；E2E +2（邀请全流程双浏览器上下文、公开注册拒绝）。
- 修复后全量（真实执行）：typecheck 0 错；pnpm test 14/14；pnpm test:integration 46/46（7 文件：db 4/database 9/auth 8/permissions 7/gate01.db 3/gate01.auth 8/gate01.access 7）；pnpm build 0 错误；pnpm test:e2e 8/8；aiea_dev migrate deploy Already in sync；docker-deps-repro.sh OK。
- 遗留：M01–M04 未修（Follow-up）；真实 Docker 构建未实测；旧下载地址/旧 job 重放拒绝属 TASK-007/013 对象。
- 状态：CODEX_REVIEW_REQUIRED（GATE_01_REVIEW_2），停止开发等待 Codex 第二轮复审。

## 每次TASK完成后追加的记录格式

记录日期、TASK编号、执行人、状态、完成行为、修改路径、实际测试命令及结果、证据路径/commit、已知限制、下一TASK。未运行项目写“未执行”并写原因，不能写“应该通过”。遇到范围/技术栈变化，同时记录对应主文档的变更位置和依据。

## 2026-09-13T00:54:14+08:00 · Product OS 接入（管理工作）

原工程原地登记；补充规则、映射、协议、提示词与首页；保留原任务表和历史证据。重读 ZCode 新提交和最新 Gate 01 交接后，当前工具设为 Codex，状态待审查。本轮未改业务代码、未重跑业务测试、未提交/推送。备份与审计见 docs/PRODUCT_OS_ADOPTION.md、docs/DEPLOYMENT_STATUS.md。接入验证已完成，见下方记录。

## 2026-09-13T01:01:42+08:00 · Product OS 接入验收

实际刷新启动器成功（1 个真实项目，0 错误）；日常入口、总控、原项目首页、完整提示词复制路径通过本机临时预览验证。15 处本地链接有效，30 条任务行和四份执行证据保留；桌面与390px手机宽度显示正常，复制成功且无剪贴板API时可全选。业务代码未改、业务测试本轮未重跑；当前仍为 TASK-004 / Gate 01 待 Codex 审查，不进入 TASK-005。详细证据与原生 file 模式验证边界见 docs/PRODUCT_OS_ADOPTION.md。

## 2026-09-13T01:28:09+08:00 · Codex 正式独立审查 CODEX_REVIEW_GATE_01

范围：TASK-001–004；main `2a983cc`、冻结 `c263610541f8c8f7b41fd38c185f5feac94e8ee2`；分支差异 45 文件，TASK-001/002 补查恢复基线当前快照。结论 **BLOCKED**，四 TASK 均未满足完整验收：10 HIGH、4 MEDIUM、无已确认 CRITICAL。报告：`docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md`；证据：`docs/reviews/GATE_01_EVIDENCE.json`。

实际检查：独立 PostgreSQL 17.11/55439（原5433不动）、Node24.21.0；`pnpm typecheck`、`pnpm test` 14/14、`pnpm test:integration` 28/28、`pnpm build` Web+Worker、`pnpm test:e2e` 6/6；空库两次迁移成功，重复 migrate deploy 无待应用迁移；Worker运行/停止/缺配置返回预期状态。HTTP反例和审计故障注入证明组织串域、Admin升权、跨组织失权、公开注册、邀请无效Cookie/孤立身份、审计非原子；SQL证明审计跨域引用与时间默认值风险；Docker依赖层等价布局postinstall失败。真正Docker/Compose未执行（无Docker），无部署/客户/AI实测。

代码边界：原99个已跟踪文件在审查测试后与开始哈希一致；随后只新增报告/脱敏证据并更新本进度、CODEX_REVIEW_HANDOFF和P08_FIX；未改应用源码/Schema/Migration/现有测试，未Git提交/推送/合并。旧DONE和原始执行证据保留在历史章节，当前任务表与唯一状态块调整为待修复。

交接：GPT/Owner明确D01禁用范围；下一工具ZCode，完整提示词`prompts/P08_FIX.md`；逐TASK修复H01–H10后回Codex复审，Checkpoint=YES。无Owner放行，禁止TASK-005。Product OS刷新与清理结果见本记录后续补充。

收尾实测：停止隔离PG后，Web健康接口返回503 `{status:degraded}`；随后本次Web/Worker/PG全部停止，临时集群、脚本、随机口令与运行文件已删除，脱敏证据保留。最终99个原已跟踪文件比对：应用文件0改动，仅CODEX_REVIEW_HANDOFF、12_PROGRESS、P08_FIX为本轮跟踪文档变化。Product OS sync成功（1项目、0错误），首页与总控读回均为TASK-004/待修复/ZCode/Checkpoint YES，完整提示词指向P08_FIX；无自动开发或放行。
