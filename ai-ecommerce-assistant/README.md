# AI 电商运营助手（应用）

TASK-001 交付：可启动的本地 Web + 独立 Worker + PostgreSQL 17 最小工程。
产品与工程规格见 [`../docs/ai-ecommerce-assistant/`](../docs/ai-ecommerce-assistant/)（进度真源为其中 `12_PROGRESS.md`）；开发指令见 [`../DEVELOPMENT_HANDOFF.md`](../DEVELOPMENT_HANDOFF.md)。

## 架构（当前范围）

- **Web**：Next.js App Router（`src/app`），提供基础页与 `GET /api/health`。
- **Worker**：独立进程（`src/jobs/worker.ts`），启动时校验环境并检查数据库连通，
  周期心跳写入 `.runtime/worker-status.json`；业务队列（pg-boss）在 TASK-007 起接入。
- **状态检查**：`src/jobs/status.ts`（编译产物 `dist/jobs/status.js`）读取心跳文件，
  存活退出码 0，停止/过期退出码 1；同时作为 compose 中 worker 的 healthcheck。
- **数据库**：PostgreSQL 17。TASK-001 仅需空业务库可连接；领域表迁移属 TASK-002。

## 工具链（应用隔离，不改动系统与其他项目）

| 组件 | 版本 | 位置 / 获取方式 |
|---|---|---|
| Node.js | v24.21.0（darwin-arm64 官方二进制） | `.tools/node24/`（已包含，gitignored） |
| pnpm | 10.34.5（corepack 激活） | `source scripts/env.sh` 后自动可用 |
| PostgreSQL | 17（Homebrew 二进制，不注册系统服务） | `/opt/homebrew/opt/postgresql@17`，数据目录 `.postgres/` |

如需重建 Node 工具链：

```bash
mkdir -p .tools && cd .tools
curl -sL -o node24.tar.xz https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.xz
tar -xJf node24.tar.xz && rm node24.tar.xz && mv node-v24.21.0-darwin-arm64 node24
```

`package.json` 已设 `engines.node >=24 <25` 且 `.npmrc` 开启 `engine-strict`，
用其他 Node 大版本执行命令会立即明确报错。

## 从干净环境启动（本机路径，已验证）

前置：macOS（arm64）、Homebrew、`brew install postgresql@17`。

```bash
cd ai-ecommerce-assistant
source scripts/env.sh            # 使用应用内 Node 24 + pnpm

./scripts/postgres.sh init       # 初始化并启动本应用专属 PG17 实例（端口 5433），创建空库 aiea_dev
cp .env.example .env             # 填入 DATABASE_URL=postgres://aiea@127.0.0.1:5433/aiea_dev

pnpm install --frozen-lockfile   # 可重复安装
pnpm typecheck && pnpm test && pnpm test:integration

pnpm build                       # 构建 Web 与 Worker 产物（dist/jobs/）
pnpm start                       # 启动 Web → http://127.0.0.1:3000
pnpm worker:start                # 独立启动 Worker（开发期用 pnpm worker:dev）
```

日常操作：

| 命令 | 行为 |
|---|---|
| `pnpm dev` | 本地开发 Web |
| `pnpm start` | 启动构建后的 Web（默认 3000 端口） |
| `pnpm worker:dev` / `pnpm worker:start` | 开发 / 构建版 Worker |
| `pnpm worker:status` | Worker 存活检查（退出码 0/1） |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm test` / `pnpm test:integration` / `pnpm test:e2e` | 单元 / 真实 PG 集成 / Playwright E2E |
| `./scripts/postgres.sh start\|stop\|status` | 本地 PG17 实例管理 |
| `docker compose up -d --build` | 容器方式启动 Web/Worker/PostgreSQL（本机未装 Docker，未在本机执行，见下） |

首次运行 `pnpm test:e2e` 前需安装浏览器：`pnpm exec playwright install chromium`。

## TASK-001 实测结果（2026-09-12，本机 macOS arm64）

| 验收项 | 命令 | 结果 |
|---|---|---|
| 可重复安装 | `pnpm install --frozen-lockfile` | ✅ 通过（lockfile 一致） |
| 类型检查 | `pnpm typecheck` | ✅ 0 错误 |
| 单元测试（env 校验，含不泄露值断言） | `pnpm test` | ✅ 7/7 |
| 真实 PG 集成（SELECT 1、版本=17、pingDb 真假两例） | `pnpm test:integration` | ✅ 4/4 |
| 构建（Web + Worker 产物） | `pnpm build` | ✅ 退出码 0，产出 `dist/jobs/worker.js`、`dist/jobs/status.js` |
| E2E（/api/health=200 ok；基础页可打开） | `pnpm test:e2e` | ✅ 2/2 |
| Worker 生命周期 | 启动→`pnpm worker:status`→SIGTERM→再次检查 | ✅ 运行时退出码 0；停止后退出码 1（状态文件 state=stopped） |
| Worker 缺失 DATABASE_URL | 无 .env 环境启动 | ✅ 明确报错「缺少…：DATABASE_URL」且不含值，退出码 1 |
| Web 缺失 DATABASE_URL | 同上启动 `next start` | ✅ 同样明确报错并退出码 1（instrumentation 校验） |
| 健康接口降级 | 停止 PG → `GET /api/health` → 重启 PG | ✅ 200 ok → 503 `{"status":"degraded"}` → 200 ok；响应仅含 status 字段 |
| dev 模式冒烟 | `next dev` + health | ✅ 200 ok |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## TASK-002｜数据库与约束（2026-09-12）

- 技术栈落点：Prisma **7.10.0**（稳定最新，pnpm latest 标签当前指向 8.0.0-RC，故显式锁定 7.x）+ `@prisma/adapter-pg@7.10.0`（Prisma 7 要求 driver adapter）+ Better Auth **1.7.4**（认证表由官方 CLI `@better-auth/cli@1.4.21` 生成，核心表结构与运行时 1.x 一致；Prisma 模型重命名为 AuthUser/AuthSession/AuthAccount/AuthVerification，表名保持官方 `user/session/account/verification`）。
- Schema：`prisma/schema.prisma` —— 28 个 P0 领域实体（04_DATA_MODEL PART 10 v1.1 全字段，含 evaluation_at、固定 VOC 日桶、RuleEvaluation、R08 subchannel、product_id_at_snapshot、previous_snapshot_* 等六组契约修订）；复合外键 `(org_id,id)/(org_id,store_id,id)` 全部用 Prisma 多字段 relation 表达。
- 迁移：`20260912102945_p0_init`（结构+索引+唯一键）+ `20260912103005_p0_constraints`（受审查 SQL：20+ CHECK 约束与 2 个部分唯一索引——单 Owner、recompute 目标唯一）。
- 客户端：`src/database/prisma.ts`（driver adapter 单例；生成产物 `src/generated/prisma`，已 gitignore，`postinstall` 自动生成）。

### TASK-002 常用命令

```bash
source scripts/env.sh
pnpm exec prisma migrate deploy      # 空库部署迁移（幂等）
pnpm exec prisma migrate dev         # 开发期改 schema 后生成新迁移
pnpm vitest run tests/integration/database.test.ts   # 仅数据库迁移/约束测试
```

### TASK-002 实测结果（真实 PostgreSQL 17，独立测试库 aiea_test）

| 验收项 | 结果 |
|---|---|
| 空库 `migrate deploy` + 重复部署幂等（_prisma_migrations=2） | ✅ |
| 正常记录链写入（org→store→source→import→product→sku→order→order_item） | ✅ |
| 异租户外键阻断（B 组织订单行引用 A 组织 SKU） | ✅ 复合外键生效 |
| 重复自然键阻断（同 org/store/ns/external_sku_id） | ✅ P2002 |
| 单 Owner 部分唯一阻断 | ✅ uq_membership_single_owner |
| 负销量 CHECK 阻断（quantity=-1） | ✅ ck_order_item_quantity_range |
| 非法币种 CHECK 阻断（"cny"/"CNYX"） | ✅ ck_order_currency / Char(3) |
| 退款 succeeded 条件字段缺失阻断 | ✅ ck_refund_succeeded_fields |
| P1/P2 实体未建表；28 领域表 + 4 认证表存在 | ✅ |
| 回归：unit 7/7、integration 13/13、build 0 错误、e2e 2/2 | ✅ |

## Docker 路径（已交付文件，本机未执行）

本机未安装 Docker，`docker compose up -d --build` 未在本机运行。
`Dockerfile`（node:24.21.0 多阶段）与 `compose.yaml`（postgres:17 + web + worker，
worker 挂 `dist/jobs/status.js` healthcheck）已按契约交付；在有 Docker 的机器上执行：

```bash
cp .env.example .env   # compose 自行注入容器内 DATABASE_URL，可不填
docker compose up -d --build
# Web: http://127.0.0.1:3000  健康检查: /api/health
# docker compose ps 查看 worker healthcheck 状态
```

## 常见失败

| 现象 | 处置 |
|---|---|
| `Unsupported engine` 报错 | 先 `source scripts/env.sh`，确认 `node -v` 为 v24.x |
| 健康接口 503 degraded | 检查 PG：`./scripts/postgres.sh status`；`.env` 的 DATABASE_URL 是否指向 5433 |
| 集成测试连接失败 | PG 未启动：`./scripts/postgres.sh start` |
| 端口占用 | 3000/5433 被占用时改 `compose.yaml`/`PG_PORT` 并同步 `.env` |
| E2E 浏览器缺失 | `pnpm exec playwright install chromium` |

## 边界与下一步

- 本仓库不含任何业务实体、业务页面、模型调用或云部署（按 TASK-001 合同禁止）。
- 下一任务：TASK-002（P0 数据库与约束迁移，Prisma + 迁移）。

## TASK-003｜登录、初始Owner与受控邀请（2026-09-13）

- 能力：Better Auth 邮箱密码 + 数据库 session（无公开注册）；受控邀请（单次/48h/只存哈希/并发原子消费）；Owner 初始化幂等；成员禁用即时撤会话；登录与邀请防爆破（数据库限流，重启有效）；/api/v1/me 系列端点；/login 与 /invite/[token] 页面。
- 本地启用：`.env` 需 `BETTER_AUTH_SECRET`（随机 64 hex）与 `BETTER_AUTH_URL=http://127.0.0.1:3000`（缺失时 Web 启动明确失败）。

### TASK-003 常用命令

```bash
# 初始化/幂等重跑 Owner（密码经 stdin 隐藏输入；或 OWNER_PASSWORD_FILE=受限文件）
read -s -p "Owner 密码: " PW && echo "$PW" | \
  pnpm exec tsx scripts/init-owner.ts --org "组织名" --email a@b.c --name 显示名 [--demo]

# 一次性密码重置（撤销全部旧会话）
read -s -p "新密码: " PW && echo "$PW" | \
  pnpm exec tsx scripts/reset-owner-password.ts --email a@b.c

pnpm vitest run tests/integration/auth.test.ts   # 认证/邀请集成测试
```

### TASK-003 实测结果（真实 PostgreSQL 17 + 真实会话）

| 验收项 | 结果 |
|---|---|
| typecheck / build | ✅ 0 错误 |
| 集成 auth.test.ts（8 例：初始化+登录、幂等、单Owner、禁用失权、邀请全生命周期、并发仅一次、限流） | ✅ 8/8 |
| unit / integration 全量 | ✅ 7/7 · 21/21 |
| E2E（登录页/错误密码/登录成功+me=owner/未登录 401/健康/基础页） | ✅ 6/6 |
| init-owner 真实运行 + 幂等重跑（不重设密码） | ✅ |

## TASK-004｜组织隔离与固定权限服务（2026-09-13）

- `src/services/access/permissions.ts`：固定四角色能力矩阵（含导入范围、邀请范围、Admin 可管理范围、Dashboard 类入口）；客服告警白名单（R08 两子通道+R09）；字段级客服投影 `projectForRole`。
- `src/services/access/index.ts`：统一授权入口 `requirePermission`（路由/任务/文件/AI 证据共用）、`requireStoreAccess` 同域校验（跨组织统一 404）、成员管理与邀请范围断言。
- 路由重构：invitations/members/organization 全部走 requirePermission；新增 GET/PATCH `/api/v1/organization`（预算字段仅 O/A 可见）。

### TASK-004 实测结果

| 验收项 | 结果 |
|---|---|
| typecheck / build | ✅ 0 错误 |
| unit（能力矩阵+投影） | ✅ 14/14 |
| integration（含新增 permissions 7/7：跨组织 404、C/P 403、禁用重放 401、双组织同名 SKU 隔离） | ✅ 28/28 |
| e2e 回归 | ✅ 6/6 |

### Gate-01 H10 修复（2026-09-13）

- Dockerfile deps 阶段在 `pnpm install` 前 COPY `prisma/schema.prisma` 与 `prisma.config.ts`（postinstall 的 `prisma generate` 不再缺 Schema）。
- compose.yaml 为 Web 显式注入 `BETTER_AUTH_SECRET`（缺失即拒绝启动）与 `BETTER_AUTH_URL`；补充容器内迁移命令说明。
- 等价复现：`scripts/docker-deps-repro.sh` 在与 deps 阶段相同的文件布局执行 install（--ignore-scripts）+ postinstall 等价命令 `prisma generate` → **OK**（本机无 Docker，真实容器构建仍未验证）。

### Gate-01 H08/H09 修复（2026-09-13，TASK-002）

- 新迁移 `20260913043631_p0_domain_timestamptz`：77 个领域 DateTime 列转 `TIMESTAMPTZ(6)`，显式 `USING ... AT TIME ZONE 'UTC'`（历史业务行均经 Prisma 以 UTC 墙钟写入；集群时区 Asia/Shanghai，不依赖隐式 cast）；Better Auth 四表保持框架原生类型；瞬时表 auth_rate_limit 重置。
- 新迁移 `20260913044218_p0_audit_tenant_fk`：AuditLog 店铺同域校验以**数据库触发器**实现（同域/空 store 放行、异域异常；选触发器而非复合外键的原因见迁移注释——Prisma 混合可空性建模限制 + 零漂移）。
- 升级路径：aiea_dev（现有数据）`migrate deploy` 应用成功且复查 `migrate dev` "Already in sync"；空库路径由测试套件覆盖。
- 回归：`tests/integration/gate01.db.test.ts` 3/3（同域三例 + 类型断言 + UTC/+08 等值）。
