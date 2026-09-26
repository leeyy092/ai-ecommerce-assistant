# Gate 02 Review 3 独立证据

日期2026-09-25；冻结a465261，业务a6f141f；范围072f9ba..a465261。正式报告在上一级`CODEX_REVIEW_GATE_02_REVIEW_3_2026-09-25.md`，机器索引在上一级`GATE_02_REVIEW_3_EVIDENCE_2026-09-25.json`。唯一进度仍为项目`docs/ai-ecommerce-assistant/12_PROGRESS.md`，本目录不是进度入口。

结论FAIL。原套件typecheck=0、unit69、integration106、build=0、E2E8全部通过；独立104条断言99PASS/5FAIL。H06/H08共有中断清理残余；H07剩余响应一致性降为M06；M04本机链通过、真实云验证限定延期；M05关闭。重复wire只计一次，不用探针exit0替代逐项断言。

## 原始证据对应

| 文件 | 证明内容 |
|---|---|
| baseline.json / remote-head.json / remote-final.json / scope-final-check.json | 接手及最终HEAD、分支、远端、工作树；无未提交应用变化、无a6f之后业务差异、Schema/迁移/依赖/Compose不变 |
| environment.json / node-runtime.json / runtime-versions.log | 独立运行环境、官方Node归档校验、PG17版本；未收录秘密 |
| typecheck/unit/integration/build/e2e/migrate*.log及同名json | 完整命令结果与退出码；migrate diff未应用 |
| adapter-assertions.json | 44条：两店六类CSV/Mock对oracle、时间/金额/CSV边界、批元数据与channel配对 |
| http-assertions.json / rate-responses.json | 21条：真实Web API正常、拒绝、权限、幂等、签名、限流 |
| worker-assertions.json / worker-built.log | 12条：实际构建Worker+pg-boss，撤权、缺文件、恢复、真实retry元数据与commit拒绝 |
| recovery-assertions.json | PG屏障：同key异body201/409，只1条有文件任务 |
| samebody-assertions.json | PG屏障：同key同body实际201/200，期望201/201；只1条有文件任务 |
| stream-faults-assertions.json | 输入error留tmp/不调用abort；EACCES及显式注入ENOSPC的成功对照 |
| http-interruption-assertions.json | 真实截断multipart/socket取消均新增1个tmp；无新任务、Web健康200 |
| wire-repeat-1/2/3-assertions.json | 未关闭multipart，字节超限正确；行超限三次都丢失TOO_MANY_ROWS，变为通用multipart错误 |
| oss-assertions.json | 本地spool到注入远端的实际函数链、Worker读取、内容一致及事务失败对象清理；不是云账号验证 |
| m05-assertions.json / key-lengths-assertions.json / extra-assertions.json | 精确90日及91日拒绝、7/8/128/129 key边界、CAS审计回滚 |
| compose-build.log / docker-info.log / colima-*.log | Docker daemon可用，registry DNS失败阻止镜像构建；未运行当前容器文件链 |
| harness-notes.json | 探针准备偏差，不计产品失败 |
| pre-writeback/ / historical-integrity-before.json | 本轮管理写回前的只读历史快照及旧报告哈希；不是另一份进度真源 |
| final-verification.json | 业务/历史保护、临时资源清理、sync及首页/总控读回核验 |

## 复现顺序

1. **只在新的/tmp目录执行。** 独立clone项目，checkout完整冻结SHA，再`git archive`应用。主iCloud副本不执行pnpm/tsc/Prisma。首次本地主副本archive超时后，本轮用远端同SHA副本归档，来源有证据。保留当前工作树所有管理差异。
2. 使用Node24.21.0及项目指定pnpm；新建PG17 `initdb`/独立端口/独立库（本轮64485），不使用任何现有业务库。设置一次性`DATABASE_URL`、随机`BETTER_AUTH_SECRET`、loopback `BETTER_AUTH_URL`（本轮64486）、`STORAGE_DRIVER=local`、`STORAGE_PRIVATE_ROOT=<新目录>/private`。原env、用户cookie和密码没有归档，不可从旧证据复用。
3. 先在原始归档里执行`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm exec prisma migrate deploy`、`pnpm test:integration`、`pnpm build`、`pnpm test:e2e`。E2E的Playwright配置用3000端口，需要独立测试密码及对应BETTER_AUTH_URL；本轮3000确认空闲。运行命令/版本与日志保留。**在构建完成后才复制审查脚本，避免审查辅助文件进入应用构建。**
4. 将`scripts/review-*.ts`复制到应用根，替换脚本常量`/tmp/gate02-review3-20260925-8_hqanp6`为新目录；先建`evidence/`。用原生产构建启动Web。探针用`NODE_ENV=production`与next start一致，避免生成不同cookie名称。原`run.py`是记录命令退出码的辅助器，需在新目录自行写入`config.json`（app字段）及仅本地保存的`env.json`；不用此辅助器也可逐条运行并保存stdout/stderr。
5. 依次`pnpm exec tsx review-adapter.ts`、`review-http.ts`。HTTP脚本生成独立组织、角色、店/来源及**私有**actors文件，供后续脚本使用，不得归档该文件。然后依次运行`review-wire-longwait.ts`、`review-recovery.ts`、`review-worker.ts`。不要并行修改同一个测试库；worker脚本只操作此新建库的pg-boss，并在结束时停止自己的built Worker。
6. 再执行`review-oss.ts`、`review-extra.ts`、`review-m05.ts`、`review-samebody.ts`、`review-key-lengths.ts`、`review-stream-faults.ts`、`review-http-interruption.ts`。OSS使用内存对象服务和明确假环境值，无云请求；ENOSPC仅在该脚本进程临时注入fs.write故障，不占满磁盘。samebody/recovery借测试库临时trigger+advisory锁确保竞争成立，finally移除。固定内容的并发探针应在新库运行，不能用已有复用任务测竞争。
7. 本冻结的明确预期：常规套件全绿；独立中断清理3条失败、wire行错误1条失败、同body并发1条失败，其余通过。修复版本的预期则全部目标断言通过；不得更改期望以迎合实现。worker的archived观察店号不匹配，不用于归档权限结论。
8. 如重验容器：重新从冻结Git归档创建**没有审查脚本**的Docker上下文，在`.data/private`放合成canary，独立Compose project与回环端口、一次性密码、私有卷；运行真实上传→Worker→签名下载→重启读回并断言canary未进入镜像。本轮在镜像拉取阶段被Colima DNS阻塞，故这里无新容器通过证据。历史REVIEW2容器通过保持历史身份，不能替代当前执行。
9. 停止本轮Web/Worker/PG，销毁本轮副本和秘密，只移除本轮拥有的容器/卷。最终检查见final-verification。M07 audit_log差异和部分唯一索引必须按既有自定义SQL维护，不能把migrate diff输出直接应用。

脚本是可复核的审查证据；业务修复应把有意义的反例整合进现有测试，不把这套一次性环境作为新基础设施。
