# CODEX_REVIEW_HANDOFF｜TASK-001 审查交接

- 生成日期：2026-09-12
- 审查类型：用户提前发起的单任务审查（TASK-001），非 Phase 1 完成门（Phase 1 = TASK-001~004，尚余 002/003/004）
- 交接根目录：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`
- 开发依据：`DEVELOPMENT_HANDOFF.md`（v1.1）+ `FINAL_DECISIONS.md` + `docs/ai-ecommerce-assistant/` 分册

## 项目

AI 电商运营助手（P0 MVP）。老板每天一页看懂：经营发生了什么、哪些异常、哪些 SKU 要关注、客户在反馈什么、今天优先做什么。当前阶段：30 个 TASK 中的 TASK-001 已完成，其余 TODO。

## 当前 Phase

Phase 1 项目地基（TASK-001~004）。已完成 TASK-001；TASK-002（P0 数据库与约束迁移）为下一项，尚未开始。

## 本阶段目标

建立本地 Web + 独立 Worker + PostgreSQL 17 可连通的最小工程：可启动、可构建、可测试、健康检查可用、缺失必需环境变量时明确失败、Worker 停止可被状态检查发现。不含业务实体、业务页面、模型调用、云部署。

## 本阶段完成 TASK

仅 TASK-001（可启动的应用与验证环境），状态 DONE，记录于 `docs/ai-ecommerce-assistant/12_PROGRESS.md`「TASK-001 执行记录」。

## 本阶段新增功能

无业务功能（按合同禁止）。工程能力清单：

- Next.js 16.3.5 App Router 基础页面与 layout（无业务假数据）
- `GET /api/health`：200 {"status":"ok"} / 503 {"status":"degraded"}，响应仅 status 字段
- `src/lib/env.ts` 分阶段环境校验（base/auth/ai/oss；STORAGE_DRIVER=oss 隐式要求 OSS 组；错误只含变量名不含值）
- Web 启动 instrumentation 校验：缺失必需变量 → 明确报错 + 退出码 1
- 独立 Worker（`src/jobs/worker.ts`）：环境校验 → PG 连通 → 5s 心跳写 `.runtime/worker-status.json` → SIGINT/SIGTERM 正常退出；未注册业务队列（pg-boss 属 TASK-007）
- Worker 存活检查（`src/jobs/status.ts` / `dist/jobs/status.js`）：退出码 0/1，兼作 compose healthcheck
- Dockerfile（node:24.21.0 多阶段）+ compose.yaml（postgres:17 + web + worker）
- 应用隔离工具链：Node v24.21.0（`.tools/node24`）+ corepack pnpm 10.34.5 + engine-strict；本地 PG17 实例（`.postgres/`，端口 5433，空库 `aiea_dev`）

## 主要修改文件

- `docs/ai-ecommerce-assistant/12_PROGRESS.md`（进度与执行记录）
- `ai-ecommerce-assistant/` 全部 27 个新增文件（源码/测试/配置/脚本/README，清单见 12_PROGRESS 执行记录）

## 数据库变化

无业务表。仅创建空数据库 `aiea_dev`（本地实例）。领域表迁移属 TASK-002。

## API 变化

新增 `GET /api/health`（公开基础探针，契约见 `docs/ai-ecommerce-assistant/08_API_SPEC.md` §17.2）。

## AI 逻辑变化

无。TASK-001 不涉及任何模型调用（百炼 Key 不阻塞本任务，属 TASK-017）。

## 核心业务逻辑

无业务逻辑。核心工程逻辑集中在：

- `src/lib/env.ts`（校验语义与错误信息安全）
- `src/app/api/health/route.ts` + `src/lib/db.ts`（探针语义、超时、降级判定、无泄露）
- `src/instrumentation.ts` + `src/instrumentation-node.ts`（启动失败语义）
- `src/jobs/worker.ts` + `src/lib/workerStatus.ts`（心跳/退出/状态文件原子写）
- `Dockerfile` / `compose.yaml` / `scripts/*.sh`（可重复构建与本地运行）

## 测试结果（全部真实执行于 2026-09-12，本机 macOS arm64）

| 检查 | 命令 | 结果 |
|---|---|---|
| 可重复安装 | `pnpm install --frozen-lockfile` | 通过 |
| 类型检查 | `pnpm typecheck` | 0 错误 |
| 单元测试 | `pnpm test` | 7/7（含"错误不泄露变量值"断言） |
| 真实 PG 集成 | `pnpm test:integration` | 4/4（SELECT 1、server_version=17、pingDb 真连接 true/不可达 false） |
| 构建 | `pnpm build` | 退出码 0；Web 路由 + dist/jobs 产物 |
| E2E | `pnpm test:e2e` | 2/2（health 200；基础页） |
| Worker 生命周期 | 启动→status(0)→SIGTERM→status(1) | 通过；worker:dev 同过 |
| 缺失 DATABASE_URL | Worker / Web 分别验证 | 明确报错不含值，退出码 1 |
| 健康接口降级 | 停 PG→503 degraded→重启→200 ok | 通过 |

## 尚未解决的问题

1. 本机无 Docker：`docker compose up -d --build` 未在本机执行（文件已交付，待有 Docker 的环境验证）
2. 容器镜像 runner 阶段包含 devDependencies（待 TASK-029 优化）
3. 未做 git commit（未获用户提交指令；.gitignore 已排除 .env/.tools/.postgres/.runtime/dist/node_modules）

## 当前已知风险

- Next.js 16.3.5 / React 19.2.8 / Tailwind 4 为当前最新主线版本，P0 后续任务需关注升级兼容
- 应用隔离 Node 24 依赖 `.tools/node24` 目录存在；scripts/env.sh 缺失时 engine-strict 会明确报错（可接受失败，但 README 需始终先 source）
- Worker 心跳基于本地文件，多 Worker 实例共写同一 `.runtime/worker-status.json` 会互相覆盖（当前单 Worker 合同下可接受，TASK-007 引入队列时需复核）

## 需要 Codex 重点检查

1. 是否存在逻辑错误（env 分阶段校验语义、pingDb 超时竞态、心跳/退出路径）
2. 是否存在架构问题（Web/Worker 共库共型的边界、状态文件方案是否够用）
3. 数据模型是否合理（本任务无业务表；重点关注是否提前引入了业务实体——应当没有）
4. API 是否合理（/api/health 是否严格符合 08_API_SPEC §17.2：无配置/数据泄露、503 语义）
5. 是否存在安全问题（错误信息泄露值、日志泄露连接串、Dockerfile/compose 中的凭据、.gitignore 覆盖度）
6. 是否存在不必要复杂度（是否超范围实现了 TASK-007 及以后的内容）
7. 是否影响后续 Phase（instrumentation 行为、db.ts 单例池对 TASK-002 Prisma 迁移的影响、目录结构与 11_DEVELOPMENT_RULES PART 16 的一致性）
8. 是否存在测试缺失（验收五项是否都有可复核证据；单元/集成/E2E 断言质量）
9. 是否符合 DEVELOPMENT_HANDOFF.md（§4 任务合同逐项：验收标准、命令契约 11 项、环境变量分阶段、禁止项）
10. 是否擅自扩大 P0 范围（业务页面/假数据/模型调用/云部署——应当全部为无）

## 建议 Codex 优先阅读的文件

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | `DEVELOPMENT_HANDOFF.md` | §3 技术栈、§4 TASK-001 执行包（验收与命令契约） |
| 2 | `docs/ai-ecommerce-assistant/12_PROGRESS.md` | 「TASK-001 执行记录」：修改路径、命令与真实结果、已知限制 |
| 3 | `ai-ecommerce-assistant/README.md` | 干净环境步骤、命令表、实测结果表 |
| 4 | `ai-ecommerce-assistant/src/lib/env.ts` | 分阶段校验与错误安全 |
| 5 | `ai-ecommerce-assistant/src/app/api/health/route.ts` + `src/lib/db.ts` | 探针语义与降级判定 |
| 6 | `ai-ecommerce-assistant/src/jobs/worker.ts` + `src/lib/workerStatus.ts` + `src/jobs/status.ts` | Worker 生命周期与状态检查 |
| 7 | `ai-ecommerce-assistant/src/instrumentation.ts` + `src/instrumentation-node.ts` | 启动失败语义（Edge/Node 拆分） |
| 8 | `ai-ecommerce-assistant/tests/`（unit/integration/e2e） | 断言是否覆盖验收五项 |
| 9 | `ai-ecommerce-assistant/Dockerfile` + `compose.yaml` + `.dockerignore` + `scripts/*.sh` | 可重复构建与本地运行 |
| 10 | `ai-ecommerce-assistant/package.json` + `.npmrc` + `.env.example` + `.gitignore` | 版本锁定、engine-strict、密钥不入库 |

## Review 结果回填约定

Codex 意见交回后，逐条标记 ACCEPT / DISCUSS / REJECT（REJECT 附理由）；优先修复 Critical/High；修复后重跑测试并更新 12_PROGRESS.md，再进入 TASK-002。
