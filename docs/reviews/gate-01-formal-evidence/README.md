# Gate 01 同版本正式复核证据

2026-09-13 22 时续接后的独立执行；提交 c87a141，PostgreSQL 17.11 仅 127.0.0.1:55459，原开发库 5433 未写入。正式报告与 JSON 索引在上级目录。先前 REVIEW_2 证据保留原件，33 份 SHA256 校验通过。

`check-results.jsonl` 是命令退出结果；`http-probes.json`、`db-probes.json` 和 `upgrade-results.json` 是观测值，脚本 exit 0 只表示探测完成，不表示 Gate PASS。Docker 两份日志均 exit 1。E2E 8/8 通过但有 aborted/ECONNRESET 警告。

复现必须使用新建临时目录、该提交源码副本、独立 PostgreSQL 集群和随机测试凭据。所有应用命令工作目录为副本的 ai-ecommerce-assistant。不要在原开发库运行这些脚本；集成套件会 DROP/CREATE 固定名称的测试库，因此必须先核对 DATABASE_URL 的主机、端口与隔离集群。

执行顺序：锁定离线安装并生成客户端；运行 migrate/typecheck/unit/integration/build/e2e；在测试应用根放置 review-probes.ts，以只监听 127.0.0.1 的生产 Web 执行 HTTP 探测；运行 db-probes.py；为 upgrade.py 准备 c263610 的两次原迁移与独立升级库；按生命周期脚本验证 Worker 与健康降级。

这里的 Python 脚本保留本次临时目录结构和端口以便审计，重跑时要先改为新的临时目录。env.json 未留档；重跑时仅在新临时目录以 0600 权限生成 DATABASE_URL、BETTER_AUTH_URL、随机 BETTER_AUTH_SECRET/E2E_OWNER_PASSWORD，不复用生产秘密。REVIEW_OUT 指向临时输出路径。run.py 仅负责编排已知命令。

Docker 阶段复现：从已跟踪应用文件创建干净目录，仅复制 node_modules；按 Dockerfile 只注入 DATABASE_URL 占位值运行 pnpm build，缺少生成客户端；再仅补 src/generated 后运行，缺少构建 Auth 配置。没有执行真实容器，不把布局测试等同 Linux 镜像测试。

审计撤销故障请求本次已使用 ?expected_version=1，返回 500 后 pending/version=1/audit=0；没有重复采用旧脚本将版本放 body 的 422 请求作为回滚证据。

日志输出未包含本次随机密码、认证密钥或 Cookie 值；环境文件和临时数据库不随证据归档。清理、原代码哈希及 Product OS sync 结果见上级本次 JSON 索引。
