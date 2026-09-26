# Gate02 REVIEW4 独立证据

冻结a80d62a（业务83e33e7），范围a465261..a80d62a，2026-09-26 Codex独立执行。常规套件全绿（typecheck0/unit72/integration111/build0/e2e8），独立62条断言57PASS/5FAIL；仍有H06/H08同一组HIGH，M06关闭。容器检查另计，见compose-assertions及报告。此目录不是新的进度真源。

## 证据定位

- `baseline.json` / `scope-final-check.json`：分支、实际HEAD、远端、主工作树与最后业务提交；83e33e7后仅管理/证据变化，Schema/12迁移/依赖无差异。
- `review-start.json`：G2R4-20260926-01送达及ZCode冻结ACK；主副本写入权交接。
- `node-runtime.json` / `environment.json`：官方Node归档校验、独立PG17与目录/端口信息。
- `install/typecheck/unit/migrate-deploy/integration/build/e2e` 的日志及JSON：真实退出码与完整输出。新PG17空库12迁移实际执行；旧库升级与migrate diff沿用R3无变化适用条件，不冒称本轮新执行。
- `assertion-summary.json`：62项独立断言按文件统计。Worker的observations、extra的说明等不计入PASS数量。
- `stream-faults-assertions.json` / `http-interruption-assertions.json` / `wire-longwait-assertions.json`：原R3中断反例、输入error、EACCES/注入ENOSPC、未结束请求20MB/100000行均已修复。
- **`upload-lifecycle-assertions.json` / `late-message-assertions.json`：本轮唯一剩余HIGH证据。** 文件部分已完整结束、开始后续文本字段后，截断multipart或取消socket遗留tmp。商品与CustomerService合成消息均通过正常对照但失败路径各遗留1文件；无新任务，Web健康200。0ms/350ms覆盖spool结果尚未被Route接管及已被接管的两个时间点；不能只给spooled变量非空的分支加删除。
- `samebody-assertions.json`：真实PG屏障确认同时等待2请求，201/201、恰1任务、无objectless任务；M06关闭。
- `http/recovery/worker/oss/extra/key-lengths-assertions.json`：必要的原正常、权限、文件所有权、队列恢复、24h/异body与OSS本机链保持。OSS使用注入内存SDK，无真实云账号测试。
- `compose-*.log/.json` / `compose-assertions.json`：本轮独立容器构建、共享私有卷文件链及清理；首次并行build超时原样保存在`compose-attempt-1/`，不把其退出码124写成通过。`compose-attempt-2/3`分别保留Origin环境继承、Python CookieJar不在HTTP发送Secure cookie的审查客户端配置错误。最终用同一次本地登录返回的cookie显式请求本地栈，不改应用认证配置；不把这些准备错误计为业务FAIL。
- `harness-notes.json`：审查环境/脚本准备偏差与处理；不是业务发现。
- `historical-integrity-before.json` / `final-verification.json`：历史报告证据保护、主业务未修改、临时资源和sync读回。

## 复现

1. 在新的`/tmp`独立clone仓库、checkout报告完整HEAD，再归档`ai-ecommerce-assistant`。若主iCloud `.git`/文件同步读取挂起，使用远端同SHA，不在主副本安装/构建。R4归档源5c1c4ed；其可执行内容与83e33e7/a80d62a相同已有diff证明。
2. Node24.21.0官方归档SHA256核对，项目pnpm10.34.5，新PG17 initdb、独立空库与回环端口。随机生成仅在本地临时目录保存的认证secret、测试密码；`DATABASE_URL`/`BETTER_AUTH_URL`/`STORAGE_PRIVATE_ROOT`指向本次目录。不要从ZCode或旧审查复用数据库、cookie/凭据。
3. 依次冻锁安装、`pnpm exec tsc --noEmit --incremental false`、`pnpm test`、官方migrate deploy、`pnpm test:integration`、`pnpm build`、`pnpm test:e2e`；E2E默认3000需确认空闲并配置相同BETTER_AUTH_URL。所有套件完整输出和真实exit留档。
4. **构建完再**复制`scripts/review-*.ts`到应用根，将脚本常量`/tmp/gate02-review4-20260926-t6xh05db`改为新临时根；新建evidence/。以NODE_ENV=production启动真实next start，并使用相同NODE_ENV运行探针，防cookie域名/名称不一致。run.py需要新根下`config.json`含app字段、`env.json`只存本地秘密，不归档这两个秘密配置。
5. 依次执行http→wire-longwait→recovery→worker→oss→extra→samebody→key-lengths→stream-faults→http-interruption→upload-lifecycle→late-message。http创建新的合成组织、角色、文件和actors-private.json，后者含会话，不可复制到证据目录。每个并发probe在新内容/新key上测试；同body/异body均用本次PG临时trigger+advisory锁建立确实的竞争，finally清理。
6. 独立断言按expected/actual判断，不仅看probe exit。当前83e33e7的期望应是正常路径PASS、上述5条残留FAIL。修复后必须全部原期望通过；不得以删掉后续字段或只断开未完成文件来替代反例。
7. 容器：从同冻结应用另建干净Git归档上下文（无审查脚本），放合成`.data/private/canary.txt`；用独立Compose项目及空闲回环端口/一次性凭据/私有卷。`compose-review.py`保存每一步真实exit及HTTP/文件内容断言。宿主原生测试env与Compose的.env会有优先级影响，运行环境应显式对齐该独立Compose的URL/secret/password，不能从另一个测试栈继承。真实链包括canary排除、容器init-owner/12迁移、登录/建店/建源/上传201、built Worker preview_ready、签名下载相同、重启后读回。凭据只在内存/临时.env，不进入日志/证据。
8. ENOSPC仅注入单个探针进程的fs.write，不填满宿主盘。只删除本次自有容器/卷/镜像及临时集群，停止本次Web/Worker；销毁actors、环境配置和密码。不得清理其他项目或全局Docker缓存。

修复落入现有上传服务/Route及有意义的测试即可；这些审查辅助脚本不是新产品基础设施。云OSS仍限定延期到TASK-029或首次启用/部署前，D01/Phase1关闭项不重开。
