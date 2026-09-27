# GATE 02 REVIEW 2 · 独立证据（2026-09-16）

冻结 ce5f286..072f9ba，业务止于 b2fa10f；正式结论 **FAIL**。本目录保存本次独立实际执行记录，原 gate-02-evidence 原位保留。expected/actual/status 才是断言结果，run.py 的 exit 仅代表该命令退出码；不得把采集完成等同通过。

## 快速读取

- `http-assertions.json`：有效版本与角色、真CAS屏障、同名/内容并发、HTTP Key、多用户/过期、失败清理、空行行限额。
- `adapter-assertions.json`：12 CSV 对手写 oracle、金额/整数/时间/空值/语法/metadata/coverage；H03/H04 失败。
- `worker-assertions.json`：真实 dist Worker/pg-boss 撤权、补投、缺文件、终态与重试；observations.archived 的 STORE_MISMATCH 来自测试店铺标识不匹配，不作归档权限结论。
- `recovery-assertions.json`：真实 PG advisory-lock + BEFORE INSERT trigger 屏障，同 HTTP Key 异 body 后 2 任务/1 无文件任务。
- `write-error-assertions.json`、`review-write-error.log`：开启输入流时写流 EACCES 未捕获；已结束输入控制组日志另存。
- `oss-assertions.json`：注入内存对象服务，但执行真实 spool/read/cleanup；未调用云资源。NoSuchKey 是调用链错误，非缺账号。
- `extra-assertions.json` / `coverage-default-response.json`：CAS 审计回滚 PASS；不传日期返回101日，FAIL。
- `wire-longwait-assertions.json`：最终20秒观察窗的未结束 multipart 字节/普通行提前422，PASS；7秒旧观察及装置修正日志保留。
- `compose-assertions.json`：本次真实Docker文件链/重启读回；`docker-build-legacy.log`、`docker-canary.log`、`compose-shared-mounts.log` 补充构建/排除/共享卷。
- `typecheck/unit/integration/build/e2e` 成对 json/log 为原套件；`migrate*` 为本次官方空库12迁移/10→12/重复部署/diff。
- `pre-write-integrity.json`：应用152文件、首轮Gate02证据72文件全部SHA未变；未物化的旧Phase1历史文件不强行同步读，保留原位。
- `git-final-baseline.json`、`final-verification.json`：版本、管理写回、sync/读回与清理。`.before` 是接手管理原文备份，不是当前指令。

## 复现顺序与隔离要求

本轮真实临时目录为 `/tmp/aiea-g2r2-9hnwja_c`，已在收尾删除。脚本保留该路径作为事实；重跑请选新 /tmp 目录并替换脚本中的 T，不能在iCloud主工作区直接运行。

1. 读项目规则、当前进度、正式报告和上述原始断言。核对新候选HEAD；从Git归档建立隔离副本。若主.git对象dataless，用经核验同一SHA的远端克隆归档，不reset主工作树。安装本机可正常读取的Node24/pnpm，锁定依赖。测试数据仅为合成数据。
2. 新建可丢弃PostgreSQL17集群和review库，使用空闲回环端口。本轮55574为独立测试库，非UTC默认Asia/Shanghai；生产HTTP测试端口3324；E2E3000；容器PG55575/HTTP3344。生产/共享库禁止执行这些故障注入脚本。
3. 在临时目录创建 `config.json`（app 指向归档应用、root、head、business、started_at）及0600的 `env.json`。env继承必要系统PATH，设置 DATABASE_URL、BETTER_AUTH_SECRET（新随机值）、BETTER_AUTH_URL=http://127.0.0.1:3324、PORT=3324、STORAGE_DRIVER=local、STORAGE_PRIVATE_ROOT=<新T>/private。不要复用已销毁的会话/密钥。`scripts/run.py` 需要放在新T根目录读取这些文件。
4. **先运行原套件**：pnpm install --frozen-lockfile、pnpm typecheck、pnpm test、pnpm exec prisma migrate deploy、pnpm test:integration、pnpm build（Web/Worker/scripts）、pnpm test:e2e。先完成构建，再把review*.ts复制到临时应用根目录，避免审查探针被误加入原项目tsconfig或Docker构建上下文。
5. 启动原构建的Web并等待健康。按顺序 `review-adapter` → `review-http` → `review-wire-longwait` → `review-oss` → `review-worker` → `review-recovery` → `review-extra` → `review-write-error`。通过 `pnpm exec tsx <script>.ts`，NODE_ENV=production；scripts内以T保存json，expected/actual有失败时退出1，装置异常通常2。原wire-longwait脚本需以review-wire.ts文件名运行或匹配runner参数。HTTP探针会生成只留临时目录的actors-private.json，后续测试依赖它。Worker探针运行真正的dist/jobs/worker.js，结束后停止，再运行恢复竞争探针。
6. `review-write-error` 预期正确实现会捕获失败并exit0；当前候选发生未捕获error且exit1，不得修改测试期待使其变绿。SQL故障/锁屏障仅作用于上述一次性库，探针finally卸载自己的trigger/约束。
7. Docker须从冻结应用另建干净上下文（不包含review脚本）。在.data/private放合成canary再构建，检查镜像不含该目录；以唯一Compose项目名、本次卷和独立端口启动官方PG17/Web/Worker，运行官方迁移与node dist/scripts/init-owner.js（密码经stdin），真实登录上传，等Worker状态，签名下载比对，重启再比对。`review-compose.mjs` 记录本轮请求与断言；它读取临时compose-args.json/compose-private.json，后者不得归档。Compose环境须覆盖宿主BETTER_AUTH_URL，不能只写env文件后继续继承3324。真实H09复验结果不能由静态compose config代替。
8. 停止本次Web/Worker/PG，删除本次Compose卷/容器与自己构建的镜像及临时目录，保留日志、断言与版本索引。不要全局prune或清理他人的资源。旧schema10→12测试为空业务库，不能当作已有客户数据迁移验证。

## 装置失败与环境事件

`*-harness-setup`、`*-enum-setup`、`compose-*-setup` 属已纠正的装置问题，不计产品失败。首次7秒wire窗口未收到响应，20秒窗口同输入得到未闭合请求的422，以后者作为结论。首次Node启动因iCloud dataless无输出超时，改同版本官方Node并核对SHA。Docker缺buildx改legacy builder；Postgres direct pull因token EOF失败，FROM同官方postgres:17成功，记录digest；无另换数据库版本。环境处理、审查判断与Owner放行分别计。

## 修复交接

正式报告§13是HIGH关闭标准。先复现再修复，保留已通过的正常路径，不以减少断言来关闭问题。真正云账号联调未运行，限定延期与本机OSS调用链失败见报告M04。TASK-008 mapping/正式提交/聚合/UI均不在本轮；Phase1已关闭项及D01方案A保持。
