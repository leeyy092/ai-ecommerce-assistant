# GATE 02 · REVIEW 3 复修证据（2026-09-26 · ZCode）

交接编号 G2R3-20260926-01。基线 a465261（业务 a6f141f），修复范围见 12_PROGRESS 本轮记录与 CODEX_REVIEW_HANDOFF。expected/actual 以日志为准；自测全绿不等于 Gate PASS。

## 修前红色回归（对 a465261 工作副本实测，2026-09-26 13:38–13:55）

| 反例 | 期望 | 实际（修前） | 修复后 |
|---|---|---|---|
| 单测 spool input-error（PassThrough 中途 destroy） | UPLOAD_INTERRUPTED / 新tmp=0 / abort=1 | 新tmp=**1** / abort=**0** | ✓ tmp=0 / abort=1 |
| 集成 multipart 提前截断（未闭合即关闭） | 400 UPLOAD_INTERRUPTED | **422 通用错误（multipart 解析失败）** | ✓ 400 UPLOAD_INTERRUPTED |
| 集成 请求未结束行超限（110,000 行） | 422 TOO_MANY_ROWS | **422 VALIDATION_ERROR 通用** | ✓ 422 TOO_MANY_ROWS |
| 集成 请求源中途 error（客户端断开） | 400 UPLOAD_INTERRUPTED，tmp=0 | 修前此路径无 nodeReq error 监听（崩溃/悬挂） | ✓ 400 + tmp=0 |
| 集成 同 key 同 body 并发 ×4 | 全 201、恰 1 任务 | **败者 200** | ✓ 全 201、1 任务、raw 文件可读 |

断言落位：`tests/unit/spool-interruption.test.ts`（新增 3 例）、`tests/integration/imports.test.ts` "GATE_02 REVIEW 3 回归" describe（新增 5 例）。

## 根因（三处，均在本轮关闭）

1. **spool 收尾分裂（H06/H08）**：`spoolUpload` 的输入流 error 分支与 end 阶段失败分支绕过统一 `fail()`——不删临时文件、不调用 onAbort。修复：所有中止路径共用唯一收尾（销毁上游→onAbort 恰一次→等写流 close→删未被任务拥有的 tmp→以原始业务错误落定）。
2. **mkdir 异步间隙（R3 新发现，作为 1 的同根因一并修复）**：`await mkdir()` 在挂接事件监听前留出异步窗口，窗口内到达的中断以"无监听 error 事件"逃逸（进程崩溃/请求悬挂）。修复：mkdirSync，监听全部在同一 tick 挂接。
3. **route 错误映射竞态**：multipart 收尾错误（busboy "Unexpected end of form"）先于 spool 结算（拒绝被 unlink 推迟），catch 读到 spoolError=null 返回通用 422。修复：catch 内先等待 spool promise 结算再映射；并挂接请求源 error→销毁 busboy（其 _destroy 联动文件流走同一收尾）。
4. **G2-M06**：`bindHttpArchiveForReuse` 同 hash 冲突从"静默返回（败者 200）"改为"返回已存档首次响应（201 重放）"；无 key 内容复用仍 200。

## 修复后全量（/tmp 归档副本 + 一次性 PG17 集群 127.0.0.1:5434，Node 24.21.0 官方二进制）

| 套件 | 结果 | 日志 |
|---|---|---|
| typecheck（--incremental false，清除 tsbuildinfo） | 0 错 | typecheck.log/.exit |
| unit | 72/72（+3 新回归） | unit.log/.exit |
| integration | 111/111（+5 新回归） | integration.log/.exit |
| build（web+worker+scripts） | exit 0 | build.log/.exit |
| e2e | 8/8（保留历轮一致 ECONNRESET 警告） | e2e.log/.exit |

## 隔离 Compose 文件链（colima 29.5.2，独立项目 aiea-r3fix，回环端口，一次性凭据，私有卷）

canary（.data/private/raw/canary-secret.txt 置于构建上下文）不进镜像（镜像内 /app/.data 不存在、全文 grep 无命中）→ up 三服务 healthy/200 → 宿主对暴露端口官方 `prisma migrate deploy` 12 份全应用 → dist/scripts init-owner 真实执行（org/user 返回）→ 真实登录 → 建店/建 csv 源 → multipart 上传 201 → Worker 校验至 preview_ready → BETTER_AUTH_SECRET 同源 HMAC 签名下载内容逐字节一致 → 重启 web+worker 后再次签名下载一致（共享私有卷持久化）→ down -v、镜像/卷清理。环境障碍与修复：VM 内 DNS（[::1]:53 拒绝，systemd-resolved 符号链接悬空）致镜像拉取失败，替换 VM /etc/resolv.conf 为宿主局域网 DNS 后恢复；docker.io 直连不可用经 docker.m.daocloud.io 镜像源拉取（daemon.json registry-mirrors，仅本 VM 生效）。

## 环境事实

- 工具链在 /tmp 远端 clone 副本执行（主副本 .git 数据文件 iCloud dataless：本地 `git archive` 挂起，`cp -R .tools/node24` 挂起；Node 24.21.0 官方下载并 SHA256 校验 6239d4cf…）。
- tsc `incremental: true` + 陈旧 tsconfig.tsbuildinfo 会复用过期程序状态——本轮全部 typecheck 以 `--incremental false` + 预先删除 tsbuildinfo 执行。
- 真实 OSS 云账号/桶/网络验证维持 REVIEW 3 §5 限定延期（TASK-029 或启用 OSS/部署前，以更早者为准）；本轮未触碰。
