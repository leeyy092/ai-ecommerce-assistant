# CODEX REVIEW｜GATE 03｜REVIEW 3

日期：2026-09-27；Reviewer：Codex04；审查编号 `G3R3-20260927-01`，后续返修编号 `G3R3-20260927-02`。

冻结 `phase/03-import@6539fcbf149ec6e31175ab2731340988123790b9`，业务 `ca5ad76b313c1c836ec75cde1631e769414e2569`，差异 `dd975cd..6539fcb`；main `85a93ec`。Z02于15:43:18记录交回，Codex桌面核实15:47最终回执及空闲；主业务工作树干净。管理规则和R2不可变证据未提交部分保留。本轮未改主业务代码。

证据：[索引](GATE_03_REVIEW_3_EVIDENCE_2026-09-27.json)、[复现说明](gate-03-review-3-evidence/README.md)、[实际观测](gate-03-review-3-evidence/observations.json)。

## 1. 最终结论

**FAIL：1 HIGH（H04父订单更正后覆盖未失效）、1 MEDIUM（H03损坏staging错误分类）。** 原R2的21个有效场景全部通过，H02/H08/M02关闭；H03错任务提交风险已关闭，残余降为MEDIUM；H04历史缺行、unchanged和DST场景关闭，但R2原关闭标准中的父订单更正仍未满足。没有新产品范围，也不重开已关H01/H05/H06/H07、广告或Gate02 REVIEW5。

本次新归档、新PG17：12迁移、typecheck、unit72、integration139、build、E2E8通过；原18有效隔离去重18通过，H04四对照通过，R2补充21通过。R3定向4例为1通过、3失败，对应两组根因。尚未达到约35功能节点。

## 2. TASK验收

| TASK | 结论 | 说明 |
|---|---|---|
| 008 | 原R2预览/退款/脱敏反例通过 | 阶段依赖未解除 |
| 009 | FAIL | H03损坏staging；H04覆盖维护 |
| 010 | FAIL | 父订单expected_item_count更正后仍读到complete |
| 011 | 原技术验收保持通过 | 不另派广告改动 |
| 012 | 原R2退款/脱敏反例通过 | 阶段依赖未解除 |

唯一任务表008–012保留BLOCKED待阶段复审，不把局部通过当Owner放行；013–030不启动。

## 3. CRITICAL

无本轮确认项；以下均为本地合成数据，无线上事故或外部攻击能力声明。

## 4. HIGH

### G3-H04｜父订单更正后，既有订单行完整覆盖仍有效

位置：`ai-ecommerce-assistant/src/services/imports/commitTask.ts:407`订单头upsert；`:739–740`只在kind=order_items时计算partialDates；`:770`仅写本次kind的覆盖。

`R3-H04-parent`有效反例：独立店铺，订单expected_item_count=1，已有1行，声明9月1日订单行complete成功，coverage版本3/count1。再以较新source_updated_at把同订单expected_item_count改为2，并提交合法orders声明。实际202，订单头expected=2、现存行=1、店铺版本4；该日最新有效order_items覆盖仍是版本3的complete/count1，没有新partial或等效失效记录。此前完整结论被继续保留。

依据：04_DATA_MODEL §12.3要求增减expected_item_count与现存行重验，§12.4缺行日期强制partial；R2报告§4已明确“父订单日期/预期行数更正不能留下虚假的complete”。本轮只补证此前明确的关闭边界，不新增计算引擎或改来源级口径。

关闭标准：订单头更正影响行齐或行所属日期时，在同一事务维护受影响来源/日期的有效订单行覆盖，保留历史版本，不能让最新有效覆盖继续虚假complete；补齐后按有效确认恢复。金额/版本/outbox及其他店铺来源隔离保持。至少验证本反例、正常补齐恢复与父订单日期变动边界；不能通过删历史覆盖、忽略订单头更正或改为本文件计数通过。

## 5. MEDIUM

### G3-H03｜损坏staging未成为可操作的预览冲突

位置：`commitTask.ts:242`直接JSON.parse、`:246`未验证非空对象就解构。

`R3-H03-truncated`把合法预览对象受控改成截断JSON `{`；`R3-H03-null`改成JSON `null`。两者实际HTTP503 / INTERNAL_ERROR / retryable=true；事实、覆盖、版本、outbox均保持零变化。期望409预览损坏/不一致，提示重新校验确认。用户重复确认只会重复503，不能修复确定性的损坏对象。

依据：R2 H03明确要求结构/完整性核验，损坏或不一致安全拒绝且零副作用。错任务完整manifest现已409，时效控制的完整manifest（重算自身checksum以隔离时效分支）实际409 IMPORT_PREVIEW_STALE且零副作用，因此原错误商品写入HIGH已关闭；此残余是恢复语义MEDIUM，不夸大为数据泄露/错误入库。

关闭标准：仅把已确认的JSON损坏/结构不合法转为稳定409和重校验提示，仍零副作用；真实存储网络故障保留可重试语义，不用宽泛catch把所有基础设施故障吞成409。保留错任务、旧预览、24h、权限、正常确认及已提交重放。

## 6. LOW

无独立LOW派发。冻结g3探针共享店铺前提需在维护副本受控修正，见测试节，不新增业务缺陷编号。

## 7. 数据库审查

独立PG17.11在127.0.0.1:57024，空库12迁移通过。H04更正前后读取最新覆盖、头行数与版本；H03前后全事实/覆盖/outbox计数不变。未复用Z02的55501数据库或测试结论。无schema迁移/依赖变化。

## 8. Auth / 权限 / 多租户

常规139集成、原18及R2 21包含原权限/隔离/来源/事务对照，通过部分保持。四个新增场景使用独立店铺；未扩展旧跨namespace别名假设。Gate02 REVIEW5 PASS保持。

## 9. 测试审查

| 检查 | 实际结果 |
|---|---|
| offline frozen install / generate / 12迁移 / typecheck | exit0 |
| unit / integration | 72/72、139/139，exit0 |
| 原test:g3三独立进程 | 原探针17/18、H04四对照4/4、R2补充21/21；分项exit1/0/0，聚合exit1 |
| 原件仅选择H04d | 1通过/17跳过，exit0；与整套去重后原18有效场景全过 |
| M02实际package脚本受控退出码 | 前/中/后任一23→聚合1；全0→聚合0 |
| R3定向补充 | 1通过/3失败，exit1（H04一例、H03两例） |
| build / 生产Web E2E | exit0；8/8 exit0 |

原g3-contract SHA256仍为529823d96a4dfb3c70558e5ea87818383ad2e0509fd00f87b55a3239db7f0b6a。整套H04d受共享店铺历史事实影响；R2曾选H04a与H04d一起跑，本次正确的全来源日行齐会识别H04a的零行订单，所以只选H04d才满足独立前提。其complete与2n断言保持，未改2→6。原件及失败日志保留；下轮可在app维护副本为该例隔离店铺/来源或独立业务日，历史审查原件不动，恢复test:g3全绿且保留聚合失败语义。

第一轮由相对路径import审查runner导致TMPDIR相对化，上传临时键防护拒绝，unit/integration/g3出现环境无效失败。原始env-invalid日志保留；runner改为Path(__file__).resolve().parent后仅重跑受影响检查。类型检查exit0保留；有效integration在新增R3文件之前运行，139不含R3，不能混数。见harness-correction.json。

R1的42件、R2的57件不可变产物哈希全部匹配。每条命令/cwd/开始时间/退出码与原始输出均存档，E2E输出未删。100000行性能、SIGKILL恢复、新生产Worker容器、真实OSS云未本轮新验，仍按原TASK029或更早启用/部署前边界。PG与本轮/tmp已清理，57024/57025关闭；Z02资产未动。

## 10. P0范围检查

保持原完整P0/F01–F23/六CSV/经营商品广告售后VOC/告警AI日报本人行动/必要页面运维。独立开户为交付要求，TASK031合同待批准。没有缩减为数据工具，也不扩P1/P2。剩余修复均对应原合同和R2明确关闭标准。

## 11. 过度设计检查

只修已有提交事务中的覆盖失效和staging损坏处理，不新建基础设施或额外审查平台。H02/H08/M02关闭，无新有效反例不重开；H04此前已过历史/unchanged/DST场景作为回归，不再增加任意前提。

## 12. GPT_PRODUCT_DECISION_REQUIRED

两项残余均为已有合同内技术问题，无需Owner新增产品裁决。Phase4、TASK031、合并main、购买与部署仍未放行；用户本轮询问工期/备案不构成这些授权。工期答复为估算，不改原范围或阶段状态。

## 13. ZCode返修项

新编号G3R3-20260927-02，仅H04父订单更正覆盖、H03损坏staging语义，并按测试节受控修正app探针隔离。先读报告/索引/README及P08首块只读ACK，再待同编号START。剩余共享根因按TASK009→010一次一项，不重做已过功能。

本反例修前日志已独立落盘；修后新/tmp代码副本+本次新PG17验证，单一候选冻结交回，下一范围6539fcb..新HEAD。不得只对现有例子改期望值；提供完整声明生命周期和合法恢复对照。

## 14. 是否需要复审

需要，按上述差异与关闭标准独立复审。FAIL直接技术反馈最新Z02，PASS才报告Owner约35功能节点。管理写回/sync/发送均记录真实状态，不把准备当送达。

## 15. Gate结论

**GATE_03 REVIEW3 = FAIL，1 HIGH / 1 MEDIUM。** 下一工具ZCode/P08（ACK、START后），Checkpoint=YES。技术检查、独立Review、Owner放行、GitHub、部署、客户试用分开；本轮无提交/推送/合并/部署。
