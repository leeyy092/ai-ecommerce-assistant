# Gate02 REVIEW5 独立证据

2026-09-26 Codex，G2R5-20260926-01。冻结4b9e139，业务b32f731，范围a80d62a..4b9e139。**PASS**；TASK-005/006保持，TASK-007通过。Owner尚未阶段放行；不合并、不部署、不开始TASK-008。此目录只存证据，唯一进度仍为12_PROGRESS。

- `baseline.json` / `scope-initial.json` / `business.diff`：主副本干净，独立远端归档5b51908与最终4b9e139可执行内容相同；本轮只有Route catch+新增7集成测试，管理单列。
- `node-runtime.json` / `environment.json`：官方Node24.21.0 SHA核对、新/tmp与新PG17端口53189、Web53190。原生E2E用空闲3000。不是执行者数据库。
- `install`、`migrate-deploy`、`typecheck`、`unit`、`integration`、`build`、`e2e`各`.log/.json`：完整输出与真实退出码；0/72/118/build0/E2E8，官方空库12迁移。
- `assertion-summary.json`：58条独立断言58PASS；不把Worker observations计入断言。
- `upload-lifecycle-assertions.json` / `late-message-assertions.json`：原R4真实HTTP5个失败场景按原期望全部转绿，2个完整尾部对照保持。延迟场景中断前spool存在；0ms覆盖另一时序；取消socket以后只断言服务端结果，不虚构客户端响应。
- `preservation-assertions.json`：全部失败场景以后正常任务原文件SHA仍一致；Web重启后正确签名下载一致、未签名403；无无主tmp。
- `http` / `wire-longwait` / `http-interruption` / `stream-faults` / `samebody` / `worker` / `oss`断言：正常路径、权限、幂等、流式限额、EACCES/ENOSPC/输入error、真实PG并发屏障、built Worker恢复、注入式本机OSS链。
- `container-scope-decision.json`：本轮没有独立重建容器；逐文件无变化条件下沿用R4独立基础设施证据，复核ZCode新候选compose-n2日志但不冒作独立运行。当前生产Web/Worker与重启读取独立执行。真实云OSS限定延期至TASK-029或更早启用/部署前。
- `historical-integrity.json`：R4索引180件历史文件哈希/字节均相同；旧报告不覆盖。
- `review-start.json`、`final-verification.json`、`coordination-receipt.json`及sync读回：冻结交接、清理、Owner边界、PASS通知。不是新技术断言或Owner放行。

## 复现顺序

1. 从冻结SHA在新/tmp独立clone/归档，安装已校验Node24.21.0及pnpm10.34.5；新PG17 initdb/空库，随机测试密码/认证secret只保存在临时目录，不归档。
2. 设置DATABASE_URL、BETTER_AUTH_URL、STORAGE_PRIVATE_ROOT指向本轮；冻锁install，官方migrate deploy，tsc --noEmit --incremental false、unit、integration、build和E2E。E2E使用3000且匹配其认证URL；确认端口空闲，不复用其他服务。
3. 构建完成后复制本目录`scripts/review-*.ts`到应用根，仅将脚本根常量改为新的独立根。以NODE_ENV=production启动真实next start，并给tsx探针相同环境。先执行http创建合成用户/店铺/数据源/私有actors文件，再依次upload-lifecycle、late-message、wire-longwait、http-interruption、stream-faults、samebody、worker、oss。
4. 所有故障完成后停止并重启本次Web，再跑preservation验证成功文件保留。脚本断言失败退出1，异常退出2；以expected/actual原始值判定，不只读exit。ENOSPC仅对单个进程fs.write注入，绝不填满磁盘。
5. 保留日志与断言，清理本次Web/Worker/PG与/tmp、销毁actors/env；不操作其他执行者/tmp、不修改业务代码、不清理全局Docker缓存。脚本来自R4原反例，保留原期望；仅复现根路径适配。
