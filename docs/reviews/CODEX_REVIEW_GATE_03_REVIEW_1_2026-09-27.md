# CODEX REVIEW｜GATE 03｜REVIEW 1

日期：2026-09-27；Reviewer：Codex；审查交接 `G3R1-20260927-01`，返修交接 `G3R1-20260927-02`。

基线为已放行 main `85a93ec2336016dda8a65314a4fb716b6eacca96`，冻结 HEAD `8f3f28d20c3f562df90420f36ec271ff0fe41e19`，最后业务 `277109d6cb3493949aaf26e5852340e03797d6df`，分支 `phase/03-import`。只审 TASK-008–012 新增业务及其回归；旧 `a80d62a` 不是 Phase 3 起点。ZCode 02:14 明确冻结并交回写入权。远端候选和 main 已核实，管理差异单列。

证据：[索引](GATE_03_REVIEW_1_EVIDENCE_2026-09-27.json)、[复现说明](gate-03-review-1-evidence/README.md)、[逐项实际观测](gate-03-review-1-evidence/observations.json)。

## 1. 最终结论

**FAIL：8 组 HIGH、1 组 MEDIUM，未发现 CRITICAL。** 六类导入的正常链路已存在，但错误文件拒绝、退款上界、更正并发、覆盖完整性、权威来源、SKU 映射、广告自然键和文本落库仍违反原合同。它们会污染后续经营/商品/售后/VOC 证据或阻断日常导入，不能用自测全绿宣布约 35 功能节点已验收。

独立新归档、新 PostgreSQL 17：12 迁移、typecheck、72 unit、139 integration、build、8 E2E 均通过。额外 18 个独立场景的最终有效结果为 1 个正常对照通过、17 个合同反例失败；不是 17 个独立缺陷。首次覆盖探针的 bigint 断言写错导致假绿，已保留原日志并修正，仅重跑相关探针；详见 §9。

GATE_02 REVIEW5 PASS 保持。Phase 3 技术返修仍在既有授权内，Owner 无需中转技术问题。没有批准 Phase 4、TASK-031、正式部署或资源购买。

## 2. TASK 验收

| TASK | 独立结果 | 当前未通过事项 |
|---|---|---|
| 008 映射/校验/预览 | FAIL | H01 全文件拒绝、H03 过期/重验、H04 覆盖、H06 别名解析 |
| 009 原子提交/商品 | FAIL | H03 提交保护、H04/H05 覆盖与来源、H06 别名消费、M01 no-op |
| 010 订单头/行 | FAIL | H02 退款后的行金额/件数更正、H04 全批行齐判断 |
| 011 广告 | FAIL | H01 币种、H07 多日期自然键 |
| 012 消息/售后/退款 | FAIL | H02 全历史退款上界、H03 旧消息覆盖、H08 完整脱敏文本 |

实现提交和原自测记录保留；TASK-008–012 当前均回到 BLOCKED/待修复，TASK-001–007 DONE，013–030 TODO。任务计数不代表工时百分比。

## 3. CRITICAL

本轮未确认 CRITICAL。没有把技术缺陷扩大为未验证的线上事故；当前尚未部署或客户试用。

## 4. HIGH

### G3-H01｜校验错误未阻止整文件提交，且部分跨行/店铺字段合同未执行

位置：`src/jobs/handlers/imports.ts:231`–251 的错误码白名单；`src/services/importPreview.ts:322`–361 的同文件择新逻辑；handler 解析上下文只带店铺外部 ID。

有效反例 `H01`：商品文件含一条合法行和一条非法 `source_updated_at`。实际 `errorCount=1`，却进入 `preview_ready`，commit 202，合法 SKU 已落库；合同要求整文件拒绝且零业务写入。`H07`：同文件同订单自然键内容不同、时间不同，实际择新进入预览，合同 §12.1 要求 `DUPLICATE_KEY_CONFLICT`。`H01b`：CNY 店铺导入 USD 广告，实际 202 并落 USD。

依据：TASK-008 的禁止跳过错误行；04 §11.1、§12.1、§12.5；TASK-011 多币种拒绝。

关闭：任何真实错误（包括非法时间/数值/枚举/覆盖/币种）阻断整文件，明确区分可展示的 ignored-column 提示与错误；不同内容同自然键整文件失败；币种与 Store/引用一致。上述三反例转绿并证明零业务/coverage/version/outbox 变化，合法文件和完全相同重复行继续成功。修新增编排，不重开 Gate02 已关闭解析问题。

### G3-H02｜退款校验没有合并完整历史与整批候选，订单行更正也可突破退款边界

位置：`src/services/importPreview.ts:397`–431 仅按本文件退款 ID 查询既有退款，`refundBoundsByItem.total` 累加后未作为全批上界；`src/services/imports/commitTask.ts:306` 起订单行 upsert 未验既有退款。

`H02a`：实付 100，先导 R1=60，再导不同 ID 的 R2=60，实际总成功退款 120。`H02b`：两笔 60 同文件也整体成功。`H02c`：已有退款 60/累计退件 2 后，把订单行改为实付 10/数量 1，实际 202 并保存 10/1。

依据：04 §12.4、§12.7；TASK-010/012。

关闭：以受影响订单行为单位，把全部既有成功退款与当前文件按自然键替换后的最终集合一起校验，金额用 Decimal/精确整数；金额总和、按完成时间非递减的累计件数及同刻一致性符合合同。预览与提交后发生引用变化时均重验；行金额/件数更正也验全历史。三反例拒绝且整文件回滚；合法两次部分退款、同 ID 金额更正、不重复退件保持成功。

### G3-H03｜提交直接信任旧 staging，未落实当前版本、过期和导入者权限重验

位置：`src/services/imports/commitTask.ts:116`–164、383；只比 preview_version，未按当前数据重新分类所有事实；消息 upsert 无来源新旧判断。

`H03a`：同消息先生成旧/新两份预览，提交新预览后再提交旧预览，实际旧文本/旧时间覆盖新值。`H03b`：将本机合成 staging 的生成时间推进到 25 小时前（过期故障注入），实际仍 202。`H03c`：Operator 预览后禁用其 Membership，再由同组织 Owner 确认该任务，实际 202，未重查 created_by。

依据：04 ImportTask.created_by/base_dataset_version、§11.1 步骤5/6；TASK-008/009。此次不是改变 Owner 权限，而是执行明确的导入者提交前重查合同。

关闭：在有效提交边界重新验证 staging 身份/时效、当前导入者及确认者权限、base_dataset_version 与受影响自然键/引用；旧数据不覆盖、同刻不同内容冲突、过期必须重新校验。三个反例转绿，拒绝时无事实/版本/覆盖写入，当前预览正常确认和已提交幂等重放保留。

### G3-H04｜覆盖声明与最终事实不一致

位置：`src/services/imports/commitTask.ts:326`–331、482–517；逐行暂时缺行加入 partialDates 后不移除，recordCount 只数本文件 affected_dates，而 order_items 的 affected_dates 在预览中为空。

`H04a`：仅 9/1 一笔订单，声明 [9/1,9/3) complete、未明确 9/2 零事件，实际生成 9/2 `complete/explicitZero=false/recordCount=0`。`H04d`：订单预期两行，单文件一次导齐 L1/L2，实际对应日仍为 `partial`，recordCount=0。

依据：TASK-008/010；04 DataCoverage、§11.3、§12.4；无事实日不能从短文件推完整。

关闭：按整批提交后的最终事实和对应渠道/业务日期生成覆盖；订单行按父订单付款日（未付按下单日）归日，case/refund 分渠道；record_count 是已接收事实数，不只本文件。未显式声明零事件的空缺日不写完整，显式零与既有事实冲突拒绝；行齐才可 complete，缺行仍 partial。两反例及各自合法对照通过。

### G3-H05｜未锁定 channel 的权威来源，换 namespace 可重复导入同笔订单

位置：`src/services/imports/commitTask.ts:133`–164、各事实 upsert/coverage 提交；未读写 `Store.settings.authoritative_source_ids`。

`H04c`：第一来源成功确认订单后，用同店第二来源/新 namespace 再导同订单，实际 202，存在两条业务订单，Store.settings 仍 `{}`。

依据：04 §10.7，以及优先适用的 FINAL_DECISIONS F05：交易四通道 orders/default、order_items/default、after_sales/case、after_sales/refund 共用同一 DataSource/namespace；首次事实或覆盖确认原子绑定来源组，其他来源同 channel/交易来源组写入拒绝。

关闭：按F05在首笔事实或覆盖确认时，与事实/coverage/版本同事务绑定交易四通道的同一来源组；其他来源写同 channel/已绑定交易来源组明确拒绝且不写入，包括并发首次确认。非交易通道仍按各自合同绑定，不能把交易四通道分配不同来源。只实现原合同，不开发来源迁移工作台或新增来源平台。

### G3-H06｜显式 SKU 映射创建成功后导入仍无法解析

位置：`src/services/importPreview.ts:369`–381 只查 SKU 外部 ID；`src/services/imports/commitTask.ts` 的订单行/消息解析同样只查 SKU。

`H05`：`POST /sku-aliases` 201 建立同店同来源合法别名，随后订单行引用别名，实际 `SKU_NOT_FOUND/failed`。

依据：TASK-008/009，04 §12.4 直接 SKU 或明确 SkuAlias。

关闭：预览和提交共享同租户/店铺显式解析，合法别名能到达目标 SKU；原跨店拒绝、冲突拒绝保持，不按名称模糊合并，不提前通用别名 UI。

### G3-H07｜广告预览把同 campaign 的不同日期误当成同一自然键

位置：`src/services/importPreview.ts:718`–757、811：byCampaign 仅按 campaignId，indexBy 的非空首键令完整维度 altKey 分支不执行。

`H06`：先导某 campaign 的 9/1，再导同 source_updated_at 的 9/2（合法不同日报），实际 `VERSION_CONFLICT/failed`。

依据：TASK-011，04 §12.5 自然键含 campaign/date/attribution_model/window/currency。

关闭：按完整自然键分类/替换；同 campaign 跨日期、窗口/归因组独立，原键更正只替换该行，不累加或污染另一日期。同日期真实版本冲突继续拒绝。

### G3-H08｜预览短摘录被当作业务正文，地址脱敏未落实

位置：`src/services/importPreview.ts:218`–241、`src/services/imports/commitTask.ts:65`–74、383–403、售后 reasonText 写入。

`M01`（探针原 ID）：252 字合成消息末尾含“杯盖严重漏水”，实际 redactedText 仅201字，关键问题丢失。`M01b`：合成测试地址完整保存进 redactedText。未接通 AI，故不宣称发生真实 AI 外泄；问题是供后续 VOC/AI 使用的事实字段已失真/未完成脱敏。

依据：TASK-012 明确电话/邮箱/地址脱敏测试，04 §12.6 message_text 10000 / §12.7 reason_text 2000，入库保留脱敏业务正文。

关闭：规范化完整脱敏正文与有界预览摘录分离，长消息的业务问题保留；电话/邮箱/地址等原合同敏感内容遮蔽，售后理由同样处理；脱敏后无有效业务内容明确报错。两个反例转绿，同时保留合法业务语义，不新增外部脱敏服务或 LLM 清洗平台。

## 5. MEDIUM

**G3-M01｜无变化导入仍递增 dataset_version。** `commitTask.ts:481` 只要有 coverage_declaration 就 +1，不比较有效覆盖。探针 `H04b`：相同事实与声明，CSV 第二份仅多一条完全相同重复行，实际 version 28→29，响应同时 `no_op=true`。原版本/已成功任务重放正常对照通过，故不是普遍幂等失效。

关闭：按最终事实与有效覆盖是否变化决定版本；同语义不同字节文件不增版本、不重复触发分析，真正覆盖变化仍产生新版本。与 H04 同处提交逻辑，在本轮相邻修复中处理；不另建幂等平台。

## 6. LOW

未新增风格类整改要求。旧管理重复证据/标题冲突只作管理校正，不增加业务范围，不清理或重写历史。

## 7. 数据库审查

本 Phase 无 migration/schema/依赖差异；新 PG17 空库12迁移成功。已有唯一键、租户关系和事务回滚常规测试通过，但数据库结构不能代替退款总额、权威来源和覆盖正确性等业务约束。未要求为本轮问题新建基础设施。SIGKILL 恢复、100000行性能和新生产 Worker 容器全链本轮未新增实测，不能称这些在当前 Phase 已通过；修复影响对应边界时按原合同提供证据。

## 8. Auth / 权限 / 多租户审查

既有 session/跨租户/客服文件类型回归仍绿，显式别名跨店拒绝已有测试。新增提交者与 created_by 不是同一身份时的撤权检查缺失（H03）。只读预览/错误文件仍按 org 和类型授权。地址脱敏仅确认合成数据未遮蔽，未使用真实客户资料。

## 9. 测试审查

隔离目录 `/tmp/aiea-g3r1-20260927-sxfw4c8z`，git archive 冻结8f3f28d；Node24.21.0、独立 PG17、回环端口55483；生产 E2E Web33183，独立安装 frozen lockfile。没有复用 ZCode 的 PG5435、自测结果或旧/tmp数据库。

| 检查 | 独立实际结果 |
|---|---|
| frozen-lockfile offline install / 新空库 migration | exit0 / 12项成功 |
| tsc --noEmit --incremental false | exit0 |
| unit | 72/72 |
| integration 原套件 | 139/139 |
| Web + Worker + scripts build | exit0 |
| Playwright生产 Web（独立端口配置） | 8/8；日志中的请求中断也保留，未抹除 |
| 新业务反例首批 | 15场景：13 FAIL、2 PASS；其中覆盖H04a的number/bigint比较导致假绿 |
| 修正覆盖断言并补齐全批行测试 | 仅运行H04a/H04d：2 FAIL；其余14 skipped，不算新PASS |
| 币种/地址补充 | 仅运行H01b/M01b：2 FAIL；其余16 skipped |
| 去重后的有效结果 | 18场景，1 PASS正常对照、17 FAIL反例 |

全部通过真实上传 API、真实会话、真实校验 handler、提交 API 和 PG 查询执行；唯一时效故障注入修改私有合成 staging 的生成时间，不修改被审业务实现。正常对照六类链、精确重放和同ID退款更正成功。失败明确来自业务断言，非连接/安装/编译错误。测试源与输出一起留存，修复者不得删除断言或改成接受错误结果。

## 10. P0 范围检查

六类 CSV 应是 products/orders/order_items/ads/customer_messages/after_sales，其中 after_sales 分 case/refund。没有把六类误改成六张互不相关输入。全部发现对应008–012已有合同；后续指标/规则、经营/商品/广告/售后/VOC、AI日报/建议/本人行动、页面和运维保留，尚未实现的不冒充交付。独立开户 TASK031 待批，旧A/B缩减不采用。

## 11. 过度设计检查

无需新增服务、队列、数据库、通用清洗平台或别名工作台。修复集中在新增预览/提交内核与对应数据分支，复用现有合同和测试。关掉上述缺陷后收口；没有新改动/有效反例不重开 Gate02 或重复不变全套。

## 12. GPT_PRODUCT_DECISION_REQUIRED

本轮没有新增产品裁决。属于已批准功能未正确实现，按既有授权直接返修。若修复者发现原合同存在实质冲突，停止受影响工作并交 Owner；不得借此自行改金额/权限/覆盖含义。Gate03 PASS 后仍须向 Owner 报告功能节点并取得后续阶段放行；本轮不能把目标日期或无人回复当授权。

## 13. ZCode 必须修复项（CRITICAL/HIGH）

唯一返修 `G3R1-20260927-02`，一次一TASK按依赖完成：008修H01/H04预览与H06解析；009修H03/H04提交/H05权威来源/H06并相邻处理M01；010修H02订单行边界/H04全批行齐；011修H07完整广告键；012修H02退款全历史/H08正文与脱敏及H03消息更正。共享根因一次收口，不能每个函数改完就交回新候选。

先把证据脚本对应红色断言落成可维护回归，遵循每节关闭标准及原合同。正常/错误/并发/更正/恢复受影响边界完成后，在新/tmp+新PG17上对一个最终候选运行必要检查。保留现有事务回滚、角色/租户和合法输入路径。报告修前/修后、真实退出码、业务提交、管理差异与未运行项；冻结并把写入权交回 Codex。不得开始013、合并main或部署。

## 14. 是否需要 Codex 复审

需要。下一轮只审 `8f3f28d..新冻结HEAD` 的修复及触发回归，逐项关 H01–H08/M01；已通过问题无新差异/有效反例不重开。缺陷修复与后续阶段授权分开。没有新候选时不重跑此轮测试。

## 15. Gate 结论

GATE_03 = **FAIL / REPAIR_REQUIRED**。六类导入阶段尚未达到约35可验收功能节点。下一工具 ZCode，P08，待该编号只读ACK及Codex收尾START后接管写入；写入权与实际送达以唯一进度/coordination-receipt为准。没有上线、客户试用或独立注册完成证据。历史 Gate02 Review5 结论不变。
