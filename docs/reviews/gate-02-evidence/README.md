# Gate 02 独立复审证据

冻结 `ce5f28699910e19310b790d31a6e8871a78b5e58`，基线 `4c7e95b925c2b04aa2c1116979678cac7af091f2`。正式结论 **FAIL**，见上级 [报告](../CODEX_REVIEW_GATE_02_2026-09-15.md) 与 [机器索引](../GATE_02_EVIDENCE_2026-09-15.json)。证据由 Codex 本轮独立生成；原 ZCode 自测没有替代这里的执行。

## 读取顺序

1. `start.json`、`pre-write-verification.json`：冻结、隔离环境、原工作区未变。
2. `typecheck/unit/integration/build/e2e/migrate.log` 与同名 JSON：原测试结果。
3. `adapter-probes.json`：六类×两店、一致性与规范独立反例。
4. `http-probes.json`、`extra-probes.json`：真实 HTTP、角色/跨组织、PG 并发、审计和故障窗口。
5. `wire-probes.json`：真正 chunked multipart 的限额测试。
6. `worker-probes.json`、`worker-built.log`：built Worker 实际消费 pg-boss 作业、错误对象、撤权、重试、拒绝 commit。
7. `worker-compose-environment.log`、`storage-env-probe.log`、`static-probes.json`：原 Compose 环境对照及存储/迁移静态证据；不是本轮 Docker 构建日志。
8. `source-excerpts.txt`、`secrets-source.json`、`final-verification.json`：源码位置、有限敏感扫描与收尾。

`review-*.json` 是命令退出状态，业务判定在对应 `*-probes.json`。这些探针是收集器，退出 0 表示成功取得证据，**不等于产品 PASS**。`worker-probes.normal.queue` 含同一 task 的 validate completed 和 commit failed 两条作业，后者是预期拒绝；索引按队列名称语义解释，不把正常校验误判失败。

`*-setup-*.log`、`http-probes-partial.json` 是 Reviewer harness 的早期设置失败，已修正隔离脚本后重跑：登录频率保护、生产 secure Cookie、Prisma enum 标识和 pg-boss 12 SQL 列名。它们不作为产品缺陷。本目录保留它们以说明执行过程。

## 复现

只在**本次新建的一次性 PG 集群和 Git 归档副本**运行脚本。探针会创建合成账号/文件、设置测试行锁、临时约束故障并取消该测试库既有队列作业；不得连接开发库/客户库。原应用源文件不作任何修改。脚本中的源码兼容性适用于冻结版本；修复后应将有效反例迁入现有测试体系，而不是把收集器 exit 0 当作关闭断言。

`scripts/bootstrap.py` 提供新环境准备辅助（本轮收尾新增，仅语法检查；实际执行用的是 `scripts/run.py` 与保存的探针）。准备 Node 24.21.0/pnpm 10.34.5 和 PG 17 CLI 后，向它提供 `--repo`、`--node-bin`、`--pg-bin`，默认从 ce5f286 归档，先检查 55572/3322/3000 无占用，输出新临时目录。它不会自动执行测试，也不会修改主副本。离线安装要求已有锁定依赖缓存，缺缓存应记录环境受阻，不能换依赖版本。生成的 env.json 含随机测试凭据和继承环境，不得归档或展示。

在打印的新临时目录中，按顺序执行：

```text
python3 run.py setup
python3 run.py baseline
python3 run.py e2e
python3 run.py web
python3 run.py probe review-adapter
python3 run.py probe review-http
python3 run.py probe review-worker
python3 run.py probe review-wire
python3 run.py probe review-extra
```

`web` 启动后待 3322 健康端点可读，再跑 HTTP；review-http 生成仅供后续脚本使用的 actors-private.json，包含测试 Cookie，不能放证据目录。review-worker 自行启动/停止 built Worker。其余探针依赖前面步骤，不适合乱序并行；baseline 内为串行检查。查看 JSON 的实际断言值与正式报告关闭标准，而不只看命令退出码。

复现完成停止本次 web.pid 对应进程组及 PG 集群（`pg_ctl -D <临时目录>/pgdata -m fast -w stop`），只删除此次临时目录与本次 integration 创建的私有文件目录。不要删除其他 `aiea-storage-*`、开发库或已有服务。原始可执行脚本的固定路径在 bootstrap 复制时替换为新临时目录。

## 保留与限制

原始工作区快照、初始未提交 diff 和管理文件 `.before` 用于证明保留历史。证据没有 env.json、数据库文件、测试 Cookie、真实用户数据或真实云凭据。包含的邮箱/任务 ID/客户文本均为合成测试数据。旧迁移升级、Docker 双口令与 D01 历史证据从 Gate 01 REVIEW_5 按未变条件沿用；本轮不声称重跑它们。无云端上传、模型调用、部署或 Git 推送。
