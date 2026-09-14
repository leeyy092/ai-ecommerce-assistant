# Gate 01 REVIEW_3 独立证据 · 2026-09-14

本目录是 Codex 对 `9a5798ccdfad1be1e60d2df4dce9f9c189f85b93` 的独立复验记录，不是 ZCode 自测的复制品，也不是唯一进度源。正式结论见 [15 节报告](../CODEX_REVIEW_GATE_01_REVIEW_3_2026-09-14.md)，汇总见 [机器索引](../GATE_01_REVIEW_3_EVIDENCE_2026-09-14.json)。历史 REVIEW_2、正式复核与 ZCode R3 证据目录均保留。

审查范围为 Phase 1 / TASK-001–004，修复差异 `c87a141..9a5798c`，另核对 main 与完整当前实现。结果为 BLOCKED，剩余 HIGH 为 H08 和 H11。测试通过、Reviewer 结论、Owner 放行分别记录。

## 证据对应

| 内容 | 原始记录 |
|---|---|
| 精确源文件、Git 范围及远端 | source-snapshot-before.json、source-scope.json、remote-refs.txt、pre-write-source-check.json、final-verification.json |
| 安装、类型、Unit 14、Integration 53、Web/Worker 构建 | install.log、typecheck.log、unit.log、integration.log、build.log、checks.jsonl |
| E2E 最终 8/8 | e2e-corrected.log；首次配置错误留在 e2e.log、e2e-initial-setup.json |
| H01–H07、D01、当前邀请 Medium | http-probes.json；review-http.ts |
| H06 真实进程退出后恢复 | crash-probes.json；review-crash.ts |
| **H08 有效并发反例** | **db-race-final.json；review-race.ts** |
| H09 91 个领域时间列、相同时刻；H11 旁观库被断开 | db-probes.json 的 H09* 与 test_cleanup_scope；review-db.ts |
| 真实 Prisma 空库与旧库升级 | migrate.log、upgrade-results.json、real-upgrade-*.log；upgrade.py |
| M06 测试迁移器与 Prisma 不兼容 | helper-prisma-deploy.log、db-probes.json/helper_migration_columns |
| Web/Worker 运行、缺配置、健康 200→503 | runtime.json、runtime-health-cleanup.json、missing-*.log、worker.log |
| 真实 Docker 第一次无缓存构建、第二次纯 Git 上下文构建 | docker-build.log、docker-build-result.json、docker-clean-context-build.log、docker-clean-context-result.json |
| 容器七迁移、初始化、真实 Cookie 登录与 /me、注册拒绝、Worker | container-results.json、container-*.log；container.py、compose-review.yaml |
| M05 非默认密码失败 | container-results.json/custom_password_health、container-custom-password-*.log |
| Secrets 模式核查与归档脱敏 | secrets.json、archive-safety.json |
| 临时环境清理、Product OS 同步与读回 | environment-cleanup.json、colima-stop.log、review-pg-stop.log、docker-review-images-cleanup.log、product-os-sync.log、final-verification.json |

脚本位于 `scripts/`。脚本是本次探测程序的原样归档，须按其预期目录与环境重新准备独立副本后运行；不是向应用安装的新测试或一键开发入口。

## 复现边界与运行顺序

1. 从指定 Git 提交创建临时工作副本，不在用户现有应用或开发库里执行这些探测。使用 Node 24.21.0、pnpm 10.34.5、PostgreSQL 17.11；准备新的独立 PG 集群（本次 127.0.0.1:55469），其中所有数据库均可丢弃。本版本集成测试含 H11，不能只换一个同集群库名就认为已隔离。
2. 在临时副本写入仅用于测试的 `.env` 和 `env.json`：DATABASE_URL、随机 BETTER_AUTH_SECRET、BETTER_AUTH_URL=http://127.0.0.1:3000、随机 E2E_OWNER_PASSWORD。`root.txt` 指向工具链来源；Python 脚本的父目录包含 `repo/ai-ecommerce-assistant`、`old/ai-ecommerce-assistant`、`clean-context/ai-ecommerce-assistant` 和 `evidence/`。本次密码、Session、cookie jar、数据库数据和原始 env.json 均不归档。
3. 运行锁定安装/生成、typecheck、test、test:integration、正式 Prisma migrate deploy、build、test:e2e。具体参数和退出码在 checks.jsonl；Integration 内的 SQL 辅助执行不等同真实 Prisma 迁移。旧库升级先从 c87a141 的四份迁移建立样例，再用当前 CLI 执行三份新迁移；坏行样例预期拒绝，正常与重复迁移预期成功。
4. 使用已构建的真实 Web 和固定框架 Cookie 运行 HTTP 探测；review-crash.ts 通过子进程在 Auth 创建后 exit 55，验证重试恢复。review-db.ts 管理本独立集群的合成样例并执行原样测试清理 SQL；review-race.ts 是最终有效的 H08 并发探测。运行时必须满足独立、可丢弃的整集群前提。
5. Docker 使用从 Git archive 导出的纯跟踪文件上下文，确认无 node_modules/生成客户端，再构建镜像。本机没有 buildx，使用 DOCKER_BUILDKIT=0 的 legacy builder。Compose 只覆写项目名、镜像名、回环端口和运行时认证配置；没有修正仓库密码连接串。默认配置闭环后 down --volumes，再以新的非默认 PG 密码和干净卷复测 M05，最后再次 down --volumes。

## 不能误读的失败记录

- `db-probes.json/H08_concurrent` 是审查夹具第一次参数类型错误 42P08 的无效实验，**不能据此关闭 H08**。最终结论只取 `db-race-final.json`：两个事务均提交，cross_org=true。`db-probes-invalid-fixture.log` 是更早的夹具单 Owner 约束错误，同样不是产品缺陷。
- `upgrade-good-baseline.log` 是在没有 package.json 的旧 Prisma 目录使用 pnpm exec 的审查命令错误。后续 `real-upgrade-*` 改用当前固定 CLI 的绝对路径，完成了真实升级；以 upgrade-results.json 为准。
- 首次 E2E 的 localhost/127.0.0.1 不一致造成 Invalid origin，最终仅修正隔离环境 URL 后 8/8。保留 aborted/ECONNRESET 警告，不将其隐藏或算作新增业务缺陷。
- `docker-build-cli-attempt.log` 为缺 buildx 时不支持 --progress 参数；不是应用构建失败。第一次成功构建来自已安装过依赖的副本，第二次成功构建来自纯 Git 上下文；后者防止宿主生成物掩盖 H10。
- 容器默认链路通过与自定义密码链路失败同时成立；本地容器运行不是线上部署，也不代表真实企业验收。

未运行未来 CSV/Job/AI/文件功能、生产负载或真实企业数据验收。没有 Owner 放行。SHA256SUMS.json 覆盖本目录最终归档文件（清单自身除外）；摘要与唯一进度以正式报告和项目协议为准。
