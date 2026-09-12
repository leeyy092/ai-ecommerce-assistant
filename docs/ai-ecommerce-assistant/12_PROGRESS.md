# 开发进度与交接

版本：v1.1 · 2026-09-12（含当晚 iCloud 事故恢复记录）。本文是项目唯一进度真源，规则中提到的progress.md均指此文件。

## Git 状态（由 Zcode 自动维护；2026-09-13 Owner 授权 Git 生命周期规则）

- Project Status：IN_PROGRESS（Phase 1）
- Current Branch：`phase/01-foundation`
- Base Branch：`main`
- Origin：`git@github.com:leeyy092/ai-ecommerce-assistant.git`（SSH）
- 同步状态：与 `origin/phase/01-foundation` 一致（随每次 commit 更新本段）
- Current Phase：Phase 1（TASK-001 ✅ TASK-002 ✅ TASK-003 进行中 TASK-004 待）
- Next Action：完成 TASK-003 → commit/push → TASK-004 → Gate 01（CODEX_REVIEW_REQUIRED）
- 规则要点：main 只接收通过 Review Gate 的 Phase 合并；禁止 main 上开发/force push/重写历史；每 TASK 独立 commit（含编号，测试通过后提交）；Gate 冻结=干净树+已推送+HANDOFF 更新。

## 当前结论

两份审查的 P0 取舍已形成 FINAL_DECISIONS.md，并写入 v1.1 规格与交接入口。2026-09-12 收到 DEVELOPMENT_HANDOFF v1.1 作为开发指令，TASK-001（可启动的应用与验证环境）与 TASK-002（P0数据库与约束迁移）已完成并通过其全部指定检查；TASK-003 进行中被中断，恢复后维持 IN_PROGRESS。**2026-09-12 晚间发生 iCloud「桌面与文档」同步事故，工作区文件被大规模驱逐并最终整目录失联；已从 ZCode/Codex 会话转录与数据库 dump 完成重建（见下方事故记录），typecheck/unit 7/7/integration 13/13 在重建后全部通过。**未上传客户业务文件，未调用真实企业数据或收费模型。

## 仓库与远程状态（2026-09-12）

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
| TASK-001 | 可启动的应用与验证环境 | DONE | 无前置开发任务；2026-09-12 收到 v1.1 DEVELOPMENT_HANDOFF 作为开发指令后执行 | 全部指定检查通过（见下方 TASK-001 执行记录） |
| TASK-002 | P0数据库与约束迁移 | DONE | TASK-001（DONE） | 全部指定检查通过（见 TASK-002 执行记录；迁移链已于事故后重建并复验） |
| TASK-003 | 登录、初始Owner与受控邀请 | IN_PROGRESS | TASK-002（DONE） | 进行中；2026-09-12 晚被 iCloud 事故中断于 auth 迁移生成阶段，恢复后待续 |
| TASK-004 | 组织隔离与固定权限服务 | TODO | TASK-003 | 未执行 |
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
| 应用可启动 | TASK-001 已通过（2026-09-12；事故后未重新跑 build/e2e，typecheck/unit/integration 已复验） | 构建、启动与健康检查 |
| 六类CSV导入 | 未开发/未执行 | 全链路导入与错误/幂等验证 |
| 指标与规则正确 | 未开发/未执行 | 黄金案例手算与实际PG结果一致 |
| 角色隔离 | 未开发/未执行 | 两组织四角色API及文件测试 |
| AI联网质量 | 未执行 | 固定模型、脱敏测试集、分类与事实引用指标 |
| 首页三分钟任务 | 未执行 | 目标角色观察记录，不能用截图替代 |
| 性能/恢复 | 未执行 | 指定规模p95/p99、备份恢复记录 |
| 真实企业试用 | 未验证 | 企业脱敏文件与实际使用记录 |
| 再次使用/报价/付款 | 均未验证 | 分别提供使用、报价接受与付款证据 |

## 下一步

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

## 每次TASK完成后追加的记录格式

记录日期、TASK编号、执行人、状态、完成行为、修改路径、实际测试命令及结果、证据路径/commit、已知限制、下一TASK。未运行项目写“未执行”并写原因，不能写“应该通过”。遇到范围/技术栈变化，同时记录对应主文档的变更位置和依据。
