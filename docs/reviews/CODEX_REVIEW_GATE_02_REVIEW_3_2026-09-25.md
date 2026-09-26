# CODEX REVIEW｜GATE 02｜REVIEW 3

审查日期：2026-09-25；Reviewer：Codex（独立执行）。范围仅 Phase 2 / TASK-005–007 修复；未修改应用代码、执行 TASK-008、合并 main 或部署。

审查冻结：`phase/02-data-ingestion` / `a4652611e29d3e316de7f41bf46550fe02a64c2d`；差异 `072f9ba7cebe523832a739b3b3f19fcb1b305c2f..a4652611e29d3e316de7f41bf46550fe02a64c2d`；最后业务提交 `a6f141f177d5aa4f08077fd93edab7642180cd2b`，前序修复 `0882e06`、`eee45c1`。main=`4c7e95b925c2b04aa2c1116979678cac7af091f2`。a6f141f 之后应用差异为空；接手时未提交内容均为管理文档/历史证据，已保留。

机器索引：[GATE_02_REVIEW_3_EVIDENCE_2026-09-25.json](GATE_02_REVIEW_3_EVIDENCE_2026-09-25.json)；[复现顺序与原始断言](gate-02-review-3-evidence/README.md)。前轮 [REVIEW 2](CODEX_REVIEW_GATE_02_REVIEW_2_2026-09-16.md) 及全部原始证据保留。本报告只关闭已实际核对的修复范围。

## 1. 最终结论

**FAIL。** 剩余 **1 组 HIGH 阻塞（G2-H06 / H08 共用的上传生命周期遗漏，不重复计数）**；另有 **1 项 MEDIUM（G2-M06，由 H07 剩余响应一致性问题降级登记）**。M04 本机代码链通过，真实云端验证按限定范围延期。本轮 Docker 重验受环境阻塞，不能写成通过。

常规套件全绿：typecheck=0，unit **69/69**，integration **106/106**，Web/Worker/scripts build=0，E2E **8/8**。另外执行 **104 条独立断言：99 PASS / 5 FAIL**，失败对应中断清理、未结束请求的行超限错误码、并发同 key 同 body 响应；5 个失败断言不等于5个独立缺陷。重复确认的 wire 探针不重复计入104条。

| 前轮编号 | 本轮核定 | 实际依据 |
|---|---|---|
| H01 / H02 | 维持关闭 | 有效版本/客服投影、日期校验、CAS并发一成一败与审计回滚通过；默认窗口见M05 |
| H03 | PASS，关闭 | 非法偏移不抛异常；纯解析边界及真实 built Worker 行错误均通过 |
| H04 | PASS，关闭 | 两店六类 CSV/Mock 分别对独立 oracle；channel枚举及kind配对反例通过 |
| H05 | PASS，关闭 | HTTP权限链；真实队列的全局User禁用、Membership禁用、降权全部拒绝 |
| H06 | FAIL，部分修复 | 空行超限、quoted换行、普通拒绝清理已通过；中断仍遗留临时文件，行限额错误码有竞态 |
| H07 | 原HIGH风险关闭，残余转M06 | 内容唯一、异body原子409、用户隔离、24h、存档故障回滚均通过；同body并发返回201/200 |
| H08 | 部分PASS，整体仍未关闭 | 所有权/任务原子性、EACCES、注入ENOSPC、真实retry耗尽、补投均通过；中断清理与H06是同一遗漏 |
| H09 | 保留历史关闭；本轮重验BLOCKED | Dockerfile/Compose/排除规则未变；当前容器重验因Colima仓库DNS失败未运行，详见§9 |
| M01–M03、L01–L02 | 维持关闭 | 触发范围内字段、扩展名、UTF-8、限流、下载/签名有效期回归通过 |
| M04 | 本机PASS；真实云端DEFER | 注入对象服务跑实际spool→落位→任务→校验→读取及事务失败清理；云权限/网络另验 |
| M05 | PASS，关闭 | 221日合成fixture，无参数/单边/双边90日均精确90条；91日422 |

## 2. TASK 验收

| TASK | 结论 | 说明 |
|---|---|---|
| TASK-005 | **PASS** | M05已关闭，保留店铺/来源/角色/有效版本/CAS/审计既有验收。本轮无新增TASK005阻塞。 |
| TASK-006 | **PASS** | H03/H04关闭；规范oracle、CSV与Mock、来源元数据与解析边界成立。全量mapping/提交仍属TASK008起。 |
| TASK-007 | **FAIL** | 上传中断仍留私有临时文件；H06/H08关闭条件未满足。并发HTTP重放响应另列M06，当前Docker重验缺证据。 |

TASK-005/006可据此登记DONE；这是分项技术验收，**不代表Phase 2 Gate通过或Owner放行**。TASK-007保持BLOCKED/待修复。

## 3. CRITICAL

**NONE。** 本轮未取得跨组织数据泄漏或事实数据破坏的新反例。

## 4. HIGH

### G2-H06 / H08（同一组残余）｜客户端中断仍绕过临时文件清理

- **问题：**`spoolUpload`的输入流error分支只destroy并reject，没有删除已创建的临时文件，也未调用onAbort；HTTP的multipart内部catch直接return，不能依赖外层清理。真实客户端中途断开同样遗漏收尾。H06与H08涉及的是同一上传生命周期，不要求两套修复。
- **位置：**[src/services/imports.ts:159](../../ai-ecommerce-assistant/src/services/imports.ts#L159)（159–164；同时核对179–182的结束失败分支）；[src/app/api/v1/imports/route.ts:107](../../ai-ecommerce-assistant/src/app/api/v1/imports/route.ts#L107)（107–122）。行号均以a6f141f/a465261相同业务内容为准。
- **可复现证据：**`stream-faults-assertions.json`：输入保持开启，写入后注入disconnect，期望`UPLOAD_INTERRUPTED / 新tmp=0 / abort=1`，实际`UPLOAD_INTERRUPTED / 新tmp=1 / abort=0`。`http-interruption-assertions.json`：真实截断multipart返回400 UPLOAD_INTERRUPTED，新增tmp=1；真实socket-abort新增tmp=1。两者均无新ImportTask，健康接口仍200，故没有声称Web进程退出。
- **关联边界：**`wire-repeat-1/2/3-assertions.json`均证实请求尚未结束就收到422，但110000条数据行的错误为`VALIDATION_ERROR / multipart解析失败`，期望`TOO_MANY_ROWS`；byte边界始终为FILE_TOO_LARGE。限额已实际生效，**没有再次把它描述为10万行可绕过**。这是multipart错误先于spoolError落定的竞态，也应在同一收尾/错误传播中修复。
- **影响：**普通网络中断与取消上传会持续积累无人拥有的私有文件；可能包含客户消息，占用磁盘且无法由ImportTask清理定位。这是上一轮已明确的失败清理要求，不能以原文件保留策略或TASK029替代。错误码丢失另影响客户端呈现，但不是本项HIGH定级的主要依据。
- **合同依据：**TASK-007私有存储与上传边界；REVIEW 2 §13 H06“所有拒绝/故障路径不留临时文件、不留悬挂Promise”、H08“输入保持开启时中断可控返回并清理”；08错误响应契约及11:88流式限额。
- **建议修复：**集中管理请求流、busboy文件流、CSV parser、写流和临时文件的终止；无论输入error/abort、multipart异常、存储异常或超限，都只结算一次，结束写入后清理未被任务拥有的文件，再传播原始业务错误。挂接请求源error/aborted，避免只处理文件流。保留正常完成、EACCES/ENOSPC、quoted换行与已拥有原文件不被误删的断言。不要新增清理平台或提前实现TASK008。

## 5. MEDIUM

### G2-M06｜同key同body并发未重放首次响应状态（H07残余降级）

- **问题：**内容唯一冲突的败者复用任务时，`bindHttpArchiveForReuse`发现相同requestHash的已有存档后直接return；调用者丢失存档的201，按`reused=true`返回200。
- **位置：**[src/services/imports.ts:312](../../ai-ecommerce-assistant/src/services/imports.ts#L312)（尤其324）、同文件并发内容冲突分支443–467；`src/app/api/v1/imports/route.ts:193`附近的响应状态选择。
- **证据：**`samebody-assertions.json`在真实PG的import_task BEFORE INSERT屏障上确认两个请求都已等待；同一合法key、完全相同body，期望201/201，实际200/201。任务仅1条且原文件可读。异body的独立屏障测试为201/409、仅1条可读任务，已经通过。
- **影响：**HTTP重放结果不一致；未发现重复导入、越权或任务文件损坏，所以原H07的HIGH风险关闭，剩余问题按MEDIUM登记，不仅凭状态码升HIGH。
- **合同依据：**08 §17.5保存请求hash及结果24h；REVIEW 2 §4/H07“已有内容复用也保存首次状态/响应”；本轮交接明确“重放按存档状态”。
- **建议修复：**冲突裁决返回已有HTTP存档的状态/结果，在并发与快速重放路径使用同一响应映射；无HTTP key的普通内容复用继续200。加同key同body的强制并发回归，不破坏异body409、跨用户及24h边界。原则上不单独阻塞阶段，可随本轮相邻服务修复解决或明确登记延期。

### G2-M04｜真实OSS验证的剩余范围核定

- **位置/范围：**`src/storage/index.ts`、`src/storage/oss.ts`及实际云桶、账号权限/网络环境。
- **证据：**`oss-assertions.json`五项通过。注入内存对象服务但调用实际spool/严格读取/promote/建账/handleValidateTask/getObjectStream；结果preview_ready、2条有效、内容一致、本地tmp已删；强制HTTP存档事务失败后无新任务、无新增远端对象。另有原unit storage-oss四项通过。
- **结论：**本机NoSuchKey/本地清理分域问题关闭。**仅真实云账号、桶权限、网络和运行部署配置验证合理延期到TASK-029或首次启用OSS/部署前，以更早者为准**；必须由届时执行者提供云上上传→Worker→签名下载→清理证据。当前无真实云资源测试，不宣称OSS已可生产使用。本项延期不掩盖H06公共spool中断缺陷，也不构成Owner部署许可。

M05已关闭；M01–M03维持关闭。未新增其他MEDIUM。

## 6. LOW

**NONE（新增）。** G2-L01/L02维持关闭。环境/探针准备错误不转化为LOW业务问题。

## 7. 数据库审查

**本轮差异PASS；Phase整体仍不得进入下一阶段。** `072f9ba..a465261`无Schema/迁移/依赖版本修改；12份迁移在本轮新建PG17空库官方`migrate deploy`成功。`migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`仅有既知audit_log复合外键重建差异，原M07自定义SQL维护约定仍有效；未应用diff。部分唯一索引、HTTP存档原子性通过实际并发及故障注入。

未另跑旧库升级链：这轮没有任何迁移变化，沿用REVIEW 2该链历史证据，适用条件是这12份SQL及schema内容不变；不能把历史执行写作本轮新执行。Phase1已关闭项不重开；现有integration全套作为触发/兼容回归通过。

## 8. Auth / 权限 / 多租户审查

**本轮权限修复PASS。是否存在跨Organization泄漏：NO（在本轮范围及已执行反例中未发现）。** C消息查询/签名下载200、C订单403、异组织404；禁用后旧查询/下载403。真实built Worker对全局User.disabled、Membership.disabled和角色降权均落`failed / UPLOAD_PERMISSION_REVOKED / valid=0`。D01仍只由组织接口禁用Membership，未修改其产品决定。

## 9. 测试审查

现有测试可复跑并可信，但覆盖不完整：全部常规测试通过仍漏掉本轮故障反例。独立断言与原套件分开统计。

| 独立执行内容 | 结果 / 证据 |
|---|---|
| 官方Node24.21.0归档SHA256核对；冻结pnpm安装 | PASS；`node-runtime.json`、`install.log` |
| typecheck / unit / integration | PASS；0 / 69 / 106；对应日志，9个integration文件 |
| Web+Worker+scripts构建 / Playwright | PASS；build exit0 / 8条E2E |
| 新PG17.11空库12迁移 / migrate diff | PASS / 仅M07已知差异；`migrate*.log` |
| Adapter/CSV/Mock/oracle与channel反例 | 44 PASS；`adapter-assertions.json` |
| HTTP合同、权限、签名、并发、限流 | 21 PASS；`http-assertions.json` |
| 真实built Worker/pg-boss重试与恢复 | 12 PASS；`worker-assertions.json`及`worker-built.log`；retry_count=retry_limit=1后failed VALIDATE_FAILED |
| 异body原子屏障 / key长度 / M05 / OSS / CAS补充 | 1 / 4 / 5 / 5 / 2 PASS |
| 输入/写流故障，真实HTTP中断，wire边界，同body并发 | 5 PASS、5 FAIL；见独立断言，EACCES真实文件权限故障、ENOSPC为显式注入，未填满宿主磁盘 |
| 本轮真实Docker构建与Compose链 | **BLOCKED**；Colima启动成功，但拉Node镜像时`lookup registry-1.docker.io on [::1]:53 ... connection refused`；未获得镜像，故canary/Compose上传→Worker→下载→重启未运行。`compose-build.log`保留；不能用历史全绿冒充本轮通过 |
| 真实OSS云账号联调 | **NOT RUN / 限定DEFER**；无云账号/桶资源，本机链已独立通过 |

验证始终在`/tmp/gate02-review3-20260925-8_hqanp6`归档与新集群。主iCloud目录Git archive超时后，使用远端相同完整SHA的独立clone再archive，未reset或改主副本工具链。首次探针因NODE_ENV不一致生成非production cookie而401，改为与next start一致后通过；Mock输入改按接口传JSON字符串；Prisma fixture使用`default_channel`映射枚举；注入OSS设置明确假配置以通过启动校验。上述为探针设置问题，已排除出产品FAIL统计。旧worker archived观察夹具店号不同，不用它宣称归档权限结论。

应补关键回归：真实请求断开与截断multipart的所有资源收尾、未结束行超限错误稳定传播、同key同body并发重放。修复后保留本轮已过正常路径，补齐被存储/Worker改动触发的真实容器链。不要仅报告exit0或增加复述实现的测试。

## 10. P0 范围检查

**是否超范围实现：NO。** 本轮差异服务于既定005–007，无Excel、正式commit/mapping/聚合/UI或新平台连接。Owner于2026-09-21确认的完整P0中台方向保持；新增线上独立开户仍为另需补合同的草案，本轮不实施、不据此重开Phase1。

## 11. 过度设计检查

**NO。** 没有为了风格要求重构、换栈或新增基础设施。收尾修复应在现有流/事务/对象所有权边界内完成。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**NONE（本轮复审无新增产品决策）。** D01不重问；自助开户合同的既有待决项留在原规划文档，不扩入本Gate。M04是限定验证延期，不是删除OSS产品要求。

## 13. ZCode 必须修复项（仅CRITICAL/HIGH）

**只修一组共用遗漏：G2-H06 / G2-H08上传中断与收尾。**

1. 先把`stream-faults`的input-error、`http-interruption`两种真实请求反例写成有期望值的红色回归；确认不是测试环境401/假对象键问题。
2. 统一输入error/abort、multipart失败、CSV失败、写流失败/关闭和限额的单次终止逻辑；等待写流关闭后清理未拥有tmp，不留下悬挂处理，不误删已成功任务文件。输入中断的onAbort/取消传播也要覆盖。
3. 让未结束请求的行超限稳定返回422 TOO_MANY_ROWS；字节仍422 FILE_TOO_LARGE，保留quoted换行50001条、空行+100001条和所有普通拒绝清理。
4. 关闭证据：截断multipart、socket断开、输入error、EACCES、注入ENOSPC均不留新tmp/孤儿任务、Web仍可服务；正常上传/签名下载/Worker/失败补投/终态重投不回退。真实Compose链缺口另按§9补验，网络失败不可伪造通过。

G2-M06及云验证延期在§5管理，不伪装成额外HIGH；H03/H04/H05/M05不得重新列为未修复。

## 14. 是否需要 Codex 复审

**YES。** 下一轮以本报告冻结`a465261..新实际HEAD`为差异，核对新的最后业务提交与后继纯管理提交。重点H06/H08共用关闭标准、M06处理状态及真实容器证据；仅对被新修改触发的已关闭边界扩大回归。保留当前正常路径与原常规套件，不重新全量提出Phase1问题。M04云验证仍按限定延期，若新增OSS代码则重跑本机链。

## 15. Gate 结论

- **允许phase/02-data-ingestion合并main：NO。**
- **允许开始Phase 3 / TASK-008：NO。**
- **本轮独立审查：FAIL。下一工具：ZCode，执行P08首个text块。**
- 常规测试通过、分项TASK验收、Gate审查、Owner放行、GitHub同步、部署分别记录。本候选本地与远端同a465261；本轮报告/管理写回未提交未推送；未部署。即使下轮PASS，仍需Owner明确“放行 Phase 2”。

收尾的历史保护、业务差异、临时环境清理、Product OS sync及首页/总控读回结果以证据目录`final-verification.json`为准；该同步不改变本报告结论。
