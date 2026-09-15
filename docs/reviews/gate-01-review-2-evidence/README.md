# Gate 01 第二轮证据目录

对应 `c87a141648227954725402c715063a900fa72659`；首轮差异基线 c263610。当前结论与逐项映射见上级 `CODEX_REVIEW_GATE_01_REVIEW_2_2026-09-13.md` 和 `GATE_01_REVIEW_2_EVIDENCE.json`。

## 日志映射

- install/typecheck/unit/integration-final/build-final/e2e：独立执行的原套件；integration=46/46，unit=14/14，e2e=8/8。
- migrate、upgrade-baseline、upgrade-forward、migrate-repeat：新空库及旧两次迁移向前升级；命令成功不代表 H08/H09 全部语义正确。
- docker-deps：deps 布局实际安装和生成成功；docker-build-layout-final：干净 build 布局缺客户端；docker-build-auth-isolation：仅补客户端后发现缺构建期认证变量。这些均非真实 Docker 日志。
- http-probes.json、supplement.json：真实生产 Web HTTP/Cookie、事务故障、并发 Owner、邀请进程退出恢复。H07 撤销的正确 query 参数补测以 supplement.json 为准。
- db-probes.json、upgrade-results.json：14 个遗漏时间列、8 小时差异、AuditLog 父行变更/升级存量/删除行为、UUID/Auth 外键反例。
- runtime-probes.json、health-pg-stopped.json：Web/Worker 配置与运行检查；web.log/worker.log 为本次隔离服务日志，含主动故障注入产生的错误。
- nullable-composite.prisma 与对应日志：固定 Prisma 7.10.0 能验证混合可空复合关系的最小例子；不是已实施的业务迁移。
- pre-review-management.patch、pre-review-tracked-sha256.json：开始时已有管理差异及文件指纹，仅作历史快照，不能作为第二份进度源。

## 复现前提与运行方式

审查原临时根为 `/tmp/aiea-gate01-r2-0oo1wpux`，其中 `snapshot/ai-ecommerce-assistant` 为 git archive c87a141 的副本，`upgrade/` 放 c263610 的 schema/config/两次原迁移。原临时目录在收尾删除，本目录保留复现逻辑，不保留随机秘密、数据库或 node_modules。

重跑者应新建隔离临时根和 PostgreSQL 17 集群，使用独立端口/数据库，按脚本调整审查路径；不要直接指向开发库。`db-probes.py`、`upgrade.py`、`runtime-probes.py` 包含建样本、迁移或停止审查服务的动作，必须逐行确认目标后运行。`env.json` 需由重跑者创建，提供临时 DATABASE_URL、BETTER_AUTH_SECRET/URL、E2E_OWNER_PASSWORD、Node24/pnpm 的 PATH；不提交该文件。Python 编排假定与本次一致的目录布局及 PG 55449。

在临时应用安装锁定依赖，运行 Prisma generate/migrate、原测试和 build；E2E 与生产 HTTP 探测使用本机 3000，确保端口未被其他服务占用。把三个 review-*.ts 复制到临时应用根，通过 `pnpm exec tsx review-probes.ts` / `review-supplement.ts` 执行，设置 `REVIEW_OUT` 为临时 logs/http-probes.json。supplement 的 crash child 会按设计 exit 55。JSON 记录实际观察，不把这些反例脚本的 exit 0 理解成产品 PASS。

保存的日志已移除 ANSI 控制序列，并核对不含本次生成的测试密码/认证密钥。没有保留 Cookie 值或邀请 token。合成测试邮箱与 ID 不是客户数据。
