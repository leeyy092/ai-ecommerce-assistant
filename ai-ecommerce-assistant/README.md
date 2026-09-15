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

### Gate-01 H04–H07 修复（2026-09-13，TASK-003）

- H04：`/api/auth/sign-up/email` HTTP 层 403 `PUBLIC_SIGNUP_DISABLED`；受控路径（初始化/邀请）走服务端 auth.api 不受影响。
- H05：邀请接受后登录态转发 Better Auth 框架完整 Set-Cookie（签名/命名/安全属性由框架决定），不再手工伪造 Cookie。
- H06：接受流程重写——输入先完整校验（422 零副作用）；孤儿 Auth 身份安全回收；单一事务内（PG 事务级咨询锁按邮箱+邀请串行）完成 token CAS+领域身份+成员+审计；Auth 创建失败/领域事务失败均补偿删除 Auth 身份，邀请回 pending 可重试。
- H07：邀请创建/撤销/接受与 AuditLog 同事务（DB 级 NOT VALID 约束注入验证零部分提交）。
- 回归：gate01.auth 集成 8/8（公开注册拒绝、框架会话、孤儿恢复、补偿重试、Owner 同型故障、审计原子）；E2E +2（邀请全流程双浏览器上下文、公开注册拒绝）；全套 39/39 + 8/8。

### Gate-01 H01–H03/H07 修复（2026-09-13，TASK-004）

- H01：`src/lib/session.ts` 成为活跃组织唯一解析点（Cookie 只能在有效成员关系内选择，否则回退首个；伪造/失效 Cookie 不能自授权限）；/me、requirePermission、organization 读写全部同源；active-organization 改为直接写响应 Set-Cookie。
- H02：`assertRoleAssignment` 同时校验操作者与拟授予新角色——Admin 不可授予 admin（owner 永不可授予）。
- H03（D01 方案 A）：成员禁用仅更新本组织 Membership.status 并撤销登录会话；**不修改全局 User.status**，其他组织的有效成员关系不受影响，重新登录后其余组织可用。
- H07：members PATCH（CAS+会话撤销+审计）与 organization PATCH（CAS+审计，原先无审计）单一事务。
- 回归：gate01.access 集成 7/7（双组织双角色切换读写同源、伪造 Cookie 回退、Admin 提权 403/Owner 合法 200、P↔C 允许、A 禁用不伤 B 的 Owner 且重登可用 B、成员/组织审计故障零提交）；全套 unit 14/14、integration 46/46、e2e 8/8。

### Gate-01 正式复核 R3 修复（2026-09-14，H06/H08/H09/H10 + M01–M05）

- **H10 + M05（TASK-001）**：Dockerfile 修构建链——deps 先 COPY `prisma/schema.prisma`+`prisma.config.ts`，build 阶段从 deps 拷贝生成的 Prisma 客户端，构建期仅占位 `BETTER_AUTH_*`（认证改为运行时懒加载强校验，见 `src/lib/auth.ts` 的 `getAuth()`），runner 用 `node` 直启绕开容器内 corepack 无 DNS；compose 端口全部绑 `127.0.0.1`、口令 `:?required` 注入。**真实容器全链路已验证**（本机 colima + compose v2）：干净构建 → 迁移 → init-owner → 登录 200 → /me 200 → 公开注册 403，证据在 `docs/reviews/gate-01-r3-evidence/`（仓库根）。
- **H08/H09/M04（TASK-002）**：三份新迁移——`20260913120000_p0_nullable_timestamptz`（14 个可空业务时间列转 TIMESTAMPTZ(6)，`USING ... AT TIME ZONE 'UTC'`，此后除 Auth 框架四表外全量 TIMESTAMPTZ）；`20260913120100_p0_audit_tenant_fk_v2`（升级守卫：存量跨域审计行使迁移失败；store 父行改 `org_id` 被触发器阻断）；`20260913120200_p0_domain_user_auth_fk`（悬空守卫 + `domain_user→"user"` FK RESTRICT）。
- **H06（TASK-003）**：`ownerInit` 重写——单事务 + `pg_advisory_xact_lock(hashtext('identity-email:<email>'))` 统一邮箱锁，锁内权威重查；断链（Auth 身份丢失）走 signUp 重建 + `owner_init_recovered` 审计；孤儿回收与补偿删除 Auth 身份；`acceptInvitation` 用同一把锁。并发 init/init 一胜一幂等、init/invite 交错恰一路径胜出、断链恢复后二次密码真实登录，均有回归。
- **M01/M02/M03/M05**：v1 写路由接入 `guardWrite`（跨源 403 / 非 JSON 415）+ Zod 严格校验（422 fieldErrors）+ `internalFailure` 稳定 503 信封；登录失败计数仅 401 消费、200 清零，peek 预检不消费；代理头仅 `TRUST_PROXY_HEADERS=true` 信任；公开注册每次新 Response。
- **测试基建**：本机 Prisma CLI 启动空转 ~10 分钟 → `tests/helpers/pgMigrate.ts` 用 pg 驱动直跑迁移 + `resetDbSingletons`（含 Better Auth 懒单例重置）+ `baseUrlFromDotenv`；vitest singleFork/maxWorkers=1。本机全绿：typecheck 0 错、unit 14/14、integration 53/53、build exit 0、e2e 8/8。

### Gate-01 REVIEW_3 修复（2026-09-14，H08/H11 + M01–M06）

- **H08（TASK-002）**：新迁移 `20260914150000_p0_audit_store_composite_fk` 落地 04_DATA_MODEL 合同的"复合(org_id,id)外键"——`audit_log(org_id,store_id)→store(org_id,id)`，删除店铺只清 `store_id` 保留 `org_id`。READ COMMITTED 下即关闭两个并发方向（PG 17 双连接交错实测）：先改归属再插审计引用→FK 拒；先插审计引用再改归属→行锁冲突+反向 RI 检查拒。v1/v2 触发器保留为纵深防御；坏行守卫保留，不改写历史。**M04**：延期触发点已到，同迁移为 17 张领域表主键加 UUID 格式 CHECK（认证框架四表保持 string）。
- **H11（TASK-002 测试）**：删除六套件 `datname LIKE 'aiea_%'` 的 `pg_terminate_backend` 模糊清理；测试库改为每次运行唯一命名 `aiea_t_<tag>`，重建前仅终止连到本库的会话；测试基线在 vitest.config 启动时求值一次（进程 `DATABASE_URL` 注入优先）经 `AIEA_TEST_BASE_DB` 固化，不再被 .env 或先跑文件覆盖。验收：独立可丢弃集群上，旁观库的连接与在途事务（BEGIN-INSERT-sleep 400s）跨越整个 60/60 集成运行后 COMMIT 成功、数据完好。
- **M01/M02/M03（TASK-003/004）**：DELETE invitation 接入 guardWrite；邀请预览/接受与登录共用 `clientIpFromRequest`（`TRUST_PROXY_HEADERS` 边界，关信任时伪造 XFF 不能换限流桶）；创建/接受/撤销全部 Zod 严格校验（422），接受区分合法空 body 与非法 JSON；`internalFailure` 日志与响应共用 request_id。
- **M05（TASK-001）**：`src/lib/dbUrl.ts` 统一连接串解析（进程 env → .env → `PG*` 分量组装 + percent-encode），compose 的 postgres/web/worker 引用同一 `POSTGRES_PASSWORD`，口令含 URL 保留字符也可用。真实容器（colima，全新卷）验证：`r4-p@ss w0rd:!/#?Xy` 与默认口令两条链路均为 up→健康 200→迁移→init-owner→登录 200→/me 200→注册 403。
- **M06（TASK-002 测试）**：本机 Prisma CLI"空转"根因= iCloud 驱逐 node_modules 文件后同步 read 挂死（sample 栈卡 `uv_fs_read`）；`_prisma_migrations` 补齐官方列，官方 `migrate deploy` 可接续；空库 1.2s / 重复 / 4→8 升级 / 坏行 P3018 拒绝四项真实 CLI 检查在 /tmp 工作副本通过。
- 本机全绿（独立集群 127.0.0.1:5434 可丢弃实例）：typecheck 0 错、unit 18/18、integration **60/60**（+7 新回归）、build exit 0、e2e 8/8。
