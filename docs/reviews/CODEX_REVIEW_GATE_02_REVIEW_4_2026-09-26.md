# CODEX REVIEW｜GATE 02｜REVIEW 4

审查日期：2026-09-26；Reviewer：Codex（独立执行）。直接协作编号 `G2R4-20260926-01`。仅审 Phase 2 / TASK-007 修复及所触发的 TASK-005/006 回归；未修改业务代码、推进 TASK-008、合并 main 或部署。

冻结 HEAD：`a80d62a51d24dc92f9fb55a3549abaaac1978803`；分支 `phase/02-data-ingestion`；差异 `a4652611e29d3e316de7f41bf46550fe02a64c2d..a80d62a51d24dc92f9fb55a3549abaaac1978803`。最后业务提交 `83e33e76571f0d9a8fcefe9701b6efc3d8dd1c1a`；5c1c4ed / 9df3a3a / a80d62a 为管理、证据或生成视图。main=`4c7e95b925c2b04aa2c1116979678cac7af091f2`，未合并。接手后 N1 补证期间只在独立副本验证；ZCode 于14:46明确停止全部写入并 ACK，之后由 Codex 管理写回。

独立运行使用远端5c1c4ed的应用归档；已核对其可执行代码/测试/Schema/依赖/Docker配置与最终a80d62a完全一致，业务均为83e33e7。后继证据文件不计业务验收。机器索引：[GATE_02_REVIEW_4_EVIDENCE_2026-09-26.json](GATE_02_REVIEW_4_EVIDENCE_2026-09-26.json)；[原始断言与复现](gate-02-review-4-evidence/README.md)。REVIEW 1/2/3报告及证据保留。

## 1. 最终结论

**FAIL。仍有1组HIGH：G2-H06/H08，请求失败时已成功完成的spool文件未清理。** 这是同一上传生命周期问题的未关闭边界，不新建两项HIGH。原先“文件仍在上传时断流”的反例现已通过，M06并发响应问题已关闭。

常规独立结果：typecheck=0，unit **72/72**，integration **111/111**，Web/Worker/scripts build exit0，E2E **8/8**。另外执行 **62条独立断言：57 PASS / 5 FAIL**；5个失败断言对应同一个剩余缺陷。真实隔离Docker/Compose链最终 **20/20项PASS**；首跑超时与测试环境的Origin/Cookie配置偏差分别保留，未混入业务缺陷。

| 问题 | 本轮核定 | 证据 |
|---|---|---|
| H06/H08：输入流error、文件未完成时截断/取消 | PASS，关闭这些反例 | stream-faults / http-interruption；新tmp=0、可控错误、无新任务、Web200 |
| H06：未闭合请求字节/行限额及错误码 | PASS | wire-longwait；422 FILE_TOO_LARGE / TOO_MANY_ROWS，响应早于请求结束 |
| H06/H08：文件已完成后multipart仍未完成即失败 | **FAIL，仍阻塞** | upload-lifecycle / late-message；每次新增1个无归属tmp；§4 |
| H08：EACCES/ENOSPC、原子性、对象所有权、真实队列恢复 | PASS，维持关闭 | 故障注入、PG并发屏障及built Worker原回归通过 |
| G2-M06：同key同body首次状态重放 | **PASS，关闭** | 真实PG屏障证明两请求同时等待，返回201/201，恰1条任务且原文件可读 |
| G2-M04 | 本机链PASS，真实云限定DEFER | 实际spool→注入对象服务→任务→Worker→读取/故障清理5项通过；§5 |
| H01–H05/H07原HIGH、M01–M03/M05、L01–L02 | 保持已关闭 | 原套件及被触发的HTTP/权限/幂等/覆盖/签名正常路径无回退；不重开旧项 |
| H09 | PASS，补齐本轮容器证据 | 真实构建/canary/迁移/上传→Worker→签名下载→重启读回，独立环境执行 |

## 2. TASK 验收

| TASK | 结论 | 说明 |
|---|---|---|
| TASK-005 | **PASS，保持DONE** | 本轮服务未改；已有店铺/CAS/角色/覆盖/审计回归通过，不要求重新实现。 |
| TASK-006 | **PASS，保持DONE** | Adapter未改；原unit含黄金oracle与解析边界全部通过。完整mapping与提交仍属TASK-008起。 |
| TASK-007 | **FAIL，保持BLOCKED** | 上传完整文件后，请求尾部失败仍遗留无归属私有文件，未满足H06/H08统一清理关闭标准。 |

## 3. CRITICAL

**NONE。** 本轮未发现跨组织读取、任务事实损坏或其他新CRITICAL反例。

## 4. HIGH

### G2-H06 / G2-H08（同一组残余）｜文件部分已经完成后，整个multipart失败仍遗留私有文件

- **问题：**本次将spool内部错误统一清理，但临时文件成功交给Route之后，Route内部multipart `catch` 直接返回，跳过外层清理。不能以“spool成功”代替“整个上传请求成功”。
- **位置：**[src/app/api/v1/imports/route.ts:123](../../ai-ecommerce-assistant/src/app/api/v1/imports/route.ts#L123)，尤其125–141：已赋值的 `spooled` 在内部catch直接return；132–133在spool稍后成功时又丢弃返回值。外层catch的 `deleteObjectSafe(spooled.tempKey)` 根本不执行。服务层 [src/services/imports.ts:130](../../ai-ecommerce-assistant/src/services/imports.ts#L130) 在成功settled后忽略后续fail是合理边界，不能指望它替Route删除已交接的文件。行号以83e33e7为准。
- **复现：**合法鉴权与store/source/type字段 → 发送完整合法CSV文件部分 → 正常结束该文件部分并开始一个后续文本字段 → 不发送multipart最终边界，直接结束请求，或取消socket。传输本身通过真实HTTP与构建后的Web，不是只调用Route或Mock请求。
- **证据：**`upload-lifecycle-assertions.json`中产品CSV：完整尾部正常对照201/1任务/tmp=0；截断尾部422 VALIDATION_ERROR，新tmp=1/新任务=0；socket取消同样新tmp=1/新任务=0。`late-message-assertions.json`中合法CustomerService上传合成客户消息：正常对照201/1任务/tmp=0；0ms快速截断、350ms延迟截断、350ms取消均各留1个tmp，新增任务0、健康接口200。延迟变体确认中断前已有spool；快速变体确认等待中的成功spool也必须被接管。共5个失败断言，根因相同。
- **风险：**网络取消或不完整请求可持续积累没有ImportTask可追踪的私有文件，客户消息内容也可能残留并耗用磁盘。这里没有声称跨组织泄漏、额度绕过或进程崩溃；已修好的半途断流不重新记为失败。
- **合同依据：**TASK-007私有上传与可追踪任务；REVIEW 3 §13明确要求“multipart失败”“所有中止路径”“删除未被任务拥有的文件”。这是既有关闭标准，没有新增产品功能。
- **建议修复：**在现有Route内明确临时文件的接管与清理责任。multipart失败时等待spool落定：若失败，保留其原始业务错误；若成功，必须接管返回的tempKey并清理。将内部错误统一送入能覆盖已完成spool的收尾出口；保留原始错误及文件所有权保护。不能只在当前已赋值的spooled上加删除，因为快速竞态下它还可能为null；不能删除有效任务已拥有的raw对象。无需增加清理平台、后台扫描器或新Schema。

## 5. MEDIUM

**新增NONE；G2-M06已关闭。** 同key同body通过真实PG BEFORE INSERT屏障保证竞争，期望和实际均为201/201、1任务、0无文件任务。无key内容复用200、异body201/409、跨用户、24h及7/8/128/129边界全部通过。证据：`samebody-assertions.json`、`recovery-assertions.json`、`http-assertions.json`、`key-lengths-assertions.json`。

**G2-M04限定DEFER继续有效。** 共享spool改动触发本机OSS链重跑，5项独立断言通过。真实云账号、私有桶权限、网络与部署配置没有资源，未运行；仅该范围延期到TASK-029或更早的首次启用OSS/部署之前。届时需云上上传→Worker→签名下载→清理证据。不是允许提前使用未经验证的生产OSS，也不抵消§4的公共上传清理缺陷。

M01–M03/M05保持关闭。未增加其他延期项。

## 6. LOW

**NONE（新增）。** L01/L02保持关闭。环境或审查脚本准备偏差不转为业务LOW。

## 7. 数据库审查

**本轮差异PASS。** `a465261..a80d62a`无Schema、迁移或依赖变更；本轮在新PG17.11空库实际官方migrate deploy应用12份迁移通过。原partial unique index与M07 audit_log复合外键维护约定仍有效，未改外键、未执行db push、未应用migrate diff。

旧库升级与migrate diff结果沿用REVIEW 3已核验证据，适用条件是12份迁移及schema逐文件无差异；本轮没有重复运行它们，不把历史标成新结果。真实PG的HTTP存档冲突/失败回滚、内容唯一与所有权回归均通过。**数据库本身无新增阻塞，但Gate整体不得进入下一Phase。**

## 8. Auth / 权限 / 多租户审查

**本轮回归PASS。是否存在跨Organization泄漏：NO（在已执行范围内未发现）。** HTTP角色查询、下载及跨组织404；CustomerService订单403/消息可用；禁用后旧链接403；built Worker的全局User禁用、Membership禁用和角色降权均正确落失权终态。D01方案A未改变，也未重新询问。临时文件残留在私有存储，不被描述为跨组织可读。

## 9. 测试审查

现有套件能独立复跑，新增的原反例回归可信，但仍漏了“文件部分已经完成、请求其余部分尚未完成”的边界。不能以全套绿代替Gate通过。

| 独立检查 | 实际结果 |
|---|---|
| 官方Node24.21.0归档SHA256 / 冻结pnpm安装 | PASS；node-runtime.json / install.log |
| tsc --noEmit --incremental false | exit0 |
| unit / integration | 72/72 / 111/111，exit0 |
| 新PG17.11官方空库迁移 | 12份成功；migrate-deploy.log |
| Web/Worker/scripts build / Playwright | exit0 / 8/8 |
| HTTP/权限/存档/限流/quoted行/普通拒绝 | 21 PASS |
| 真请求不结束的字节/行限额 | 2 PASS，正确422码 |
| PG强制并发异body/同body、key边界、CAS补充 | 1+1+4+2 PASS |
| built Worker / 实际本机OSS链 | 12 PASS / 5 PASS |
| 输入error/非法CSV/EACCES/注入ENOSPC/正常清理 | 5 PASS |
| 原真实HTTP半途截断/socket取消 | 2 PASS |
| 文件完成后请求尾部失败矩阵 | 2 PASS正常对照、5 FAIL；商品与客服合成消息 |
| 当前候选隔离Docker/Compose链 | 20/20项PASS；首跑及配置偏差日志保留 |
| 真实OSS云验证 | NOT RUN，限定延期见§5 |

62条独立断言不含容器断言，原始汇总见`assertion-summary.json`；诊断观察不计成断言。未改变原探针期望值迎合实现。未重跑未变的全部Adapter独立44条或221日M05专用探针，已有unit和触发HTTP/集成回归覆盖保持，旧关闭证据继续有效。

环境全部在新`/tmp/gate02-review4-20260926-t6xh05db`、独立PG端口52979/Web52980与独立Compose项目；未在iCloud主副本跑工具链。读取主目录历史文件哈希遇到同步读取挂起后终止该只读进程，改用独立远端clone的同一tracked历史blob核对；不算业务失败。N1记录与本轮启动前实查都表明Colima VM resolv.conf仍保留ZCode测试期DNS改动；本轮未修改DNS、registry或宿主配置。环境来源与业务结论分开，不把停止VM说成已还原其网络配置。

## 10. P0 范围检查

**是否超范围：NO。** 本轮只有上传清理、幂等响应和对应测试；没有Excel、完整mapping/commit、聚合、UI或平台接入。原完整P0保持，自助开户合同仍单独待补，不属于本轮Gate实现。

## 11. 过度设计检查

**NO。** 现有流处理方式可在原Route边界内完成修复，不要求代码风格重构或新增基础设施。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**NONE（本轮新增）。** 剩余项是已经有明确关闭标准的技术缺陷，直接由Codex/ZCode解决。Owner自动阶段接续授权尚未落盘，故保持原Phase放行规则。自助开户草案及后续资源/部署决策保留在原记录，不擅自裁决。

## 13. ZCode 必须修复项（仅CRITICAL/HIGH）

**仅1组：H06/H08请求级收尾。**

1. 先把`review-upload-lifecycle.ts`和`review-late-message.ts`的有效反例落成回归。保留合法multipart尾部成功对照；覆盖文件结束后立即截断、等待spool完成再截断、再socket取消，且包含CustomerService合成消息。
2. 接管成功spool后，无论错误先于spooled变量赋值还是后于赋值，统一清理未被任务拥有的临时文件；拒绝路径无新增tmp/孤儿任务、无悬挂Promise。不要仅修其中一个时间点。
3. 保留已经通过的早期input-error/截断/socket、INVALID_CSV、TOO_MANY_ROWS/FILE_TOO_LARGE、EACCES/ENOSPC及正常文件不误删；不改已关闭M06/权限/队列语义。
4. 关闭期望：以上5个失败断言全部转PASS（新tmp=0、新任务=0、Web200，合法对照正常建账）；原回归继续通过。冻结单一候选后提供差异、实际命令/退出码和可复现证据，直接交Codex。

真实云延期不是该组HIGH修复内容。没有要求Owner再次转述或确认实现方法。

## 14. 是否需要 Codex 复审

**YES。** 下轮范围`a80d62a..新实际HEAD`，业务以新最后修复提交为准，管理差异单列。重点§13的Route接管/清理，实际运行原反例与正常路径；已关闭M06等只在被新改动触发时回归，Phase1/D01不重开。容器新链证据保留，下一轮按实际触发范围决定复跑，不机械重做无变化全部检查。

## 15. Gate 结论

- **允许phase/02-data-ingestion合并main：NO。**
- **允许开始Phase 3 / TASK-008：NO。**
- **独立审查FAIL；下一工具ZCode，P08修复本报告唯一HIGH组。**
- 当前技术测试大部分通过不等于Gate PASS。Owner尚未“放行Phase 2”；自动阶段接续亦未确认。远端冻结版本a80d62a已核实；本轮独立报告/管理写回由Codex落盘，提交推送状态另以交接时核验记录为准；没有部署或客户试用。

直接通信送达、主副本保护、历史完整性、临时资源清理、Product OS sync及首页/总控读回结果见本轮`final-verification.json`与协调receipt。它们不会更改本报告FAIL结论。
