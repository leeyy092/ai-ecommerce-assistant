# GATE 02 · REVIEW 4 复修证据（2026-09-26 · ZCode）

交接编号 G2R4-20260926-02。基线 a80d62a（业务 83e33e7），唯一修复范围：H06/H08 同一组请求级收尾——完整文件部分结束后 multipart 尾部截断/取消遗留无归属 tmp。expected/actual 以日志为准；自测全绿不等于 Gate PASS。

## 根因（Route 层，83e33e7）

文件部分完整终止 → spool 成功落定并持有 tempKey；随后整个 multipart 因尾部截断/取消失败 → Route 内部 catch 直接 return：①跳过外层 `deleteObjectSafe(spooled.tempKey)`，遗留无任务归属的私有 tmp；②catch 中等待 spool 结算时丢弃了**成功返回值**（仅取错误），快速竞态下 `spooled` 变量尚未赋值，无法靠外层清理。服务层"成功 settled 后忽略后续 fail"是合理边界，不能替 Route 删除已交接文件。

## 修复（src/app/api/v1/imports/route.ts 内部 catch，单一出口）

multipart 失败时统一接管：`nodeReq.destroy()` → 等待 spool promise 结算（无论先后）→ **失败**：保留原业务错误（`serviceFailure(spoolError)`）；**成功**：接管返回的 tempKey 并 `deleteObjectSafe` 清理未归属文件（`spooled` 置 null 防外层重复清理）→ 无 spool 错误时按请求级中断返回 **400 UPLOAD_INTERRUPTED**。不依赖 `spooled` 变量是否已赋值；不删有效任务已拥有的 raw 对象（建账从未发生的请求才可能走到本出口）；无新 Schema/后台清理。

## 修前红色回归（对 a80d62a 工作副本实测，2026-09-26 15:36）

| 反例 | 期望 | 修前实际 |
|---|---|---|
| 尾部截断（products，文件部分完整终止后缺最终边界） | tmp=0/任务=0 | **tmp=1** |
| CS 合成消息 0ms 快速截断 | tmp=0 | **tmp 泄漏（计数累积 +1）** |
| CS 350ms 延迟截断（spool 已落定） | tmp=0 | **tmp 泄漏** |
| CS 350ms 后取消 | tmp=0 | **tmp 泄漏** |
| socket 取消（products；错误落于文件流打开期→R3 路径已覆盖） | tmp=0 | 修前即绿（对照） |
| 合法完整尾部对照（products / CS） | 201/1 任务/tmp=0 | 修前即绿（对照） |

## 修后全量（/tmp 远端 clone 副本 @a80d62a + 一次性 PG17 @5435，Node 24.21.0）

| 套件 | 结果 | 日志 |
|---|---|---|
| typecheck（--incremental false） | 0 错 | typecheck.log/.exit |
| unit | 72/72 | unit.log/.exit |
| integration | **118/118**（111 + 7 新 R4 回归：2 对照 + 5 反例全部转绿） | integration.log/.exit |
| build（web+worker+scripts） | exit 0 | build.log/.exit |
| e2e | 8/8（一次性库 aiea_e2e_r4，官方 12 迁移） | e2e.log/.exit |
| 新增回归断言 | `tests/integration/imports.test.ts` "GATE_02 REVIEW 4 回归" describe 7 例（含尾部截断/socket 取消/CS 0ms/350ms/350ms 变体与 2 个合法对照） | — |

## 隔离 Compose 链复验（按实际触发边界：本轮改动即上传请求生命周期，重跑全链）

`compose-n2/`：与 N1 同款脚本（真实退出码+完整日志），上下文刷新为 a80d62a+本修复，canary 换新值（canary-secret-r4fix）。结果：**S1、S3–S10 全部 exit=0**（构建真实退出码/健康/12 迁移/init-owner/登录建店源上传 201/preview_ready/签名下载一致/重启读回一致/down -v 清理）。**S2 如实保留失败**：脚本残留上一轮项目名，inspect 了不存在的 aiea-r3fix-web（canary 断言未实际执行）；已以正确镜像名补跑 **S2b exit=0**（镜像存在+新 canary 值排除），随后 `docker rmi` 清理 img=0。逐项断言见 `summary.jsonl` 与各 s*.log。

## Colima/VM 配置台账（承接 N1，本轮操作）

- 本轮仅 `colima start`（链路重验需要）→ 结束后 `colima stop`，恢复未运行原状；未改 resolv.conf/daemon.json（N1 台账中的 resolv.conf 静态文件修改保持中，恢复命令见 gate-02-r3fix-evidence/README.md）。
- 本轮一次性凭据（compose .env、owner 密码、cookie）仅存在于 /tmp 与证据目录；证据目录中 cookie jar 已删除。

## N1 收尾补充（2026-09-26 15:57–15:58 · Codex 收尾核对落实）

- **远端最终核对**：`git ls-remote` 实测 `phase/02-data-ingestion=5b51908`（=本地最终 HEAD；业务候选 b32f731 经 `git merge-base --is-ancestor` 确认在远端分支祖先链中），`main=4c7e95b` 未变动。Codex 15:56 clone 看到的 a80d62a 为本轮 push 完成前的中间态。
- **VM 空闲块归还**：按已验证流程 `colima start` → `sudo fstrim -v /mnt/lima-colima`（输出：**93.7 MiB trimmed**）→ `colima stop`（恢复未运行）。宿主 `/` 可用空间 **7.4GiB → 11GiB**（df 实测前后）。未全局 prune、未改 DNS/其他项目资源。
- **本轮剩余资源清理**：一次性 PG17 集群（/tmp/aiea-pg-r4，端口 5435）已 `pg_ctl stop -m fast`；/tmp 工作副本与上下文目录保留至会话结束随系统清理，不占主副本。
- 最终写入权交回 Codex（Review5 独立环境）。
