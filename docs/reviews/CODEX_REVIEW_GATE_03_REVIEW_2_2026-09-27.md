# CODEX REVIEW｜GATE 03｜REVIEW 2

日期：2026-09-27；Reviewer：Codex04；复审编号 `G3R2-20260927-01`，返修编号 `G3R2-20260927-02`。

冻结分支 `phase/03-import`，HEAD `dd975cdedf55e9b4ac86691b150301e5b5e074f2`，业务 `6b408cbe2182b605c1bcaabc485af4b8d1e476f9`；本轮差异 `8f3f28d..dd975cd`，已放行 main `85a93ec2336016dda8a65314a4fb716b6eacca96`。Z02 13:54 冻结 ACK，Codex04 14:05:51 正式接管；本轮未修改主业务代码。迁移管理差异与业务候选分开。

证据：[索引](GATE_03_REVIEW_2_EVIDENCE_2026-09-27.json)、[复现说明](gate-03-review-2-evidence/README.md)、[观测](gate-03-review-2-evidence/observations.json)、[场景计数](gate-03-review-2-evidence/supplemental-accounting.json)。

## 1. 最终结论

**FAIL：3 组 HIGH、2 组 MEDIUM，未确认 CRITICAL。** 原 H01/H05/H06/H07 关闭；H02 的资金上界主要反例已修复，但合法旧版本退款被误拒，残余降为 MEDIUM；H03/H04/H08 尚未满足原关闭标准。M01 正常 no-op 已通过，覆盖误升级导致的版本变化归入 H04，不重复计算。另确认本次新增 `test:g3` 脚本会掩盖前一套件失败，记 M02。

新独立 `/tmp` 归档、新 PostgreSQL 17：12 迁移、typecheck、unit 72、integration 139、build、E2E 8 均通过。原 18 场景受控隔离后去重 18 PASS；H04 四对照 4 PASS；补充有效场景 21 个，12 PASS / 9 FAIL。9 个失败场景不等于 9 个根因。尚未达到约35功能节点。

Gate02 REVIEW5 PASS 保持。返修在既有 Phase3 授权内；Phase4、TASK031、main 合并、资源购买和正式部署未放行。

## 2. TASK 验收

| TASK | 本轮技术结果 | 剩余事项 |
|---|---|---|
| 008 映射/校验/预览 | FAIL | H02 旧退款择新、H08 脱敏与空内容；H01/H06 通过 |
| 009 原子提交/商品 | FAIL | H03 staging 身份、H04 来源日覆盖；H05/H06 与正常 M01 通过 |
| 010 订单头/行 | FAIL | H04 历史缺行/unchanged/DST；原退款约束下行更正通过 |
| 011 广告 | 原 H01/H07 验收通过，阶段依赖未解除 | 无独立广告返修项，不重开 |
| 012 消息/售后/退款 | FAIL | H02 合法旧退款、H08 完整地址及空内容；原旧消息保护通过 |

唯一任务表仍保留 008–012 BLOCKED，表示 Gate/依赖未放行；011 备注技术已通过。001–007 DONE、013–030 TODO 不变。不能把任务数当工时进度。

## 3. CRITICAL

无本轮确认项。以下均为本地合成数据验证，不表示线上事故或外部用户已可修改私有文件。

## 4. HIGH

### G3-H03｜staging 与待确认任务身份未绑定（原项未关闭）

位置：`ai-ecommerce-assistant/src/services/imports/commitTask.ts:231` 直接解析 manifest，234 只查生成时间，266 采用 manifest.kind，298 采用 manifest.rows。未核对与任务绑定的文件/映射/适配器等身份及完整性。

有效反例 `R2-H03-identity`：同店准备商品 A、B 两份不同文件，均仅预览；受控存储故障注入，把 B 完整 manifest 放到 A 的 staging 对象。合法确认 A 的 preview_version，实际返回 202，落库 `S-unconfirmed`，dataset_version 0→1、outbox pending 0→1。期望拒绝 409，事实/coverage/version/outbox 全不变。这是存储错配故障注入，不声称攻击者具备对象写入能力。

依据：04 §11.1 步骤6 staging 完整性、原 R1 H03 明确的身份/时效关闭标准、TASK008/009。原旧消息、25h、导入者撤权和同刻不同内容场景已通过，保持。

关闭：提交前核验 manifest 结构、身份及与 ImportTask/原文件/当前预览的一致性；错任务、损坏或不一致均安全拒绝且零业务副作用。保留正常确认、已提交幂等重放、时效/当前数据/权限保护。只修现有 staging 合同，不新建存储平台。

### G3-H04｜来源日完整性遗漏既有/unchanged 订单，日窗口固定24小时（原项未关闭）

位置：`commitTask.ts:329,456,715–725` 只检查本次发生更改的 parentOrderIds；`132–137` 的 localDayUtcRange 用起点加 86400000 生成终点；`735–758` 使用上述结果写覆盖。

有效反例：

- `R2-H04-history-missing`：同来源同日已有 O-missing，预期2行但仅L1；再导入另一完整订单并声明 complete。实际来源日 record_count=2（正确）、status=complete（错误），应 partial。
- `R2-H04-unchanged`：预期2行仅L1且已 partial；再次上传两条完全相同 L1。实际 no_op=true，却把覆盖升级 complete，version 3→4、coverage 1→2、pending 3→4。应保持 partial，事实/有效覆盖/版本/outbox 均不变。该副作用同时影响 M01，按同根因只计一次。
- `R2-H04-DST-spring`：America/New_York 2026-03-08 为23小时，事实在次日本地00:30。声明3/8显式零实际409 EXPLICIT_ZERO_CONFLICT，误纳次日首小时；应成功，两个日期分别计0/1。
- `R2-H04-DST-fall`：2026-11-01 为25小时，当日本地23:30的订单实际计0/partial；应计1/complete。

依据：04 Store IANA 时区/DataCoverage/§11.3/§12.4，原 R1 H04 整批后来源/channel/业务日最终事实与行齐标准；DST 属此次新增日窗口的边界，不扩大产品范围。原 H04a/H04d 在正确隔离条件通过；新增四对照保持通过。

关闭：按所声明来源日的全部相关最终订单判断行齐，包含历史和 unchanged；父订单日期/预期行数更正不能留下虚假的 complete；按相邻本地午夜计算 IANA 日期边界。record_count 继续按来源级全部最终事实，保留独立2行、同源累计3行、显式零冲突和空缺日 partial 对照及渠道/来源隔离，不改成本文件计数。

### G3-H08｜常见地址及楼栋房间残留，纯手机号被当成有效业务正文（原项未关闭）

位置：`src/services/importPreview.ts:220–225` 地址正则强制省/市/区且在首个“号/栋/室”停止；`596–607` 空内容判断把 PHONE 掩码中的英文当业务内容。提交侧售后 reason 复用同一脱敏函数。

有效反例：纯 `13800138000` 实际 preview_ready、commit202、落库 `***PHONE***`，应 REDACTED_TEXT_EMPTY 整文件拒绝；`收货地址：厦门市思明区测试路88号2栋301室；杯盖漏水` 在提交前 preview200 和落库均原样保留地址；长售后 reason 中 `测试省测试市测试区测试路88号2栋301室` 实际只变为 `***ADDRESS***2栋301室`。地址和手机号均为合成测试数据。

依据：TASK012 电话/邮箱/地址脱敏、04 §12.6 脱敏后空内容、§12.7 reason 及原 R1 H08 关闭标准。长正文保留、预览无原始 record、手机号/邮箱基本掩码及纯邮箱拒绝已通过，不重做。

关闭：有限常见原合同地址样式须遮盖完整定位段（含无省地址、楼栋房间），保留“杯盖漏水”等业务语义；判断空内容时不能把系统掩码当用户正文；消息与售后 reason 一致执行。拒绝时业务副作用为零，合法长正文保持完整，不增加外部清洗服务或 LLM 裁决。

## 5. MEDIUM

### G3-H02｜旧退款版本被当作将生效记录参与上界，合法重传被拒（原项残余降级）

位置：`importPreview.ts:420–439,675–701` 排除文件中同ID的历史记录、再加入全部候选退款，未按最终 unchanged/旧版本选择保留较新事实。

`R2-H02-stale`：实付100，较新R1=20、R2=60，实际合法总额80；重传较旧R1=60应 no-op 保留20。实际预览 failed/REFUND_AMOUNT_EXCEEDS_PAID，commit409，因为错算为120。数据库无变化，故不继续宣称资金超退 HIGH。

依据：04 §12.1 旧版本 no-op、§12.7 全历史最终集合，原 H02 关闭标准。原三资金风险反例、Decimal 0.1+0.2、同ID更正、累计件数/同刻约束及预览后引用变化拒绝已通过。

关闭：先确定自然键最终生效事实，再执行全历史金额/件数校验；该旧版本应合法 no-op 且零副作用，同ID较新更正和真实超额拒绝继续成立。沿用 Decimal。

### G3-M02｜test:g3 只返回末套件退出码（新增脚本回归）

位置：`ai-ecommerce-assistant/package.json` 的 test:g3 以分号串两个独立 Vitest 进程。实际受控执行原脚本，PATH 注入仅返回指定退出码的 Vitest stub：第一套23、第二套0、聚合0；见 script-exit-propagation.json。此23是脚本控制实验，不是业务套件退出码；真实原探针单跑 exit1、H04四对照 exit0 分别另存。

关闭：保留独立进程隔离，但任意套件失败时命令整体非0；测试前失败/后成功、前成功/后失败、全成功。原冻结探针前提修正须留对照与原件，不得通过排除/删断言掩盖失败。

## 6. LOW

无独立 LOW 派发项。

## 7. 数据库审查

新 PG17.11、空库12迁移通过。资金使用 Decimal 的合法/非法边界已实测；来源组并发首次确认只一方成功，四交易通道一致绑定。H03 实际写入错误商品、H04 虚假覆盖与版本/outbox 副作用有前后数据库计数证据。主副本无业务修改，未用 Z02 数据库作为独立结果。

## 8. Auth / 权限 / 多租户审查

原导入者撤权拒绝通过，原套件/常规集成隔离保持。补充场景每项建立独立店铺与来源；H03 错配注入限定同店同源，以避免把额外权限假设混入根因。F05 显式零首次绑定及双来源并发验证通过；H06 仅以原确认的同店同来源别名合同关闭，跨 namespace 探针不作本轮缺陷。

## 9. 测试审查

本次归档 `/tmp/aiea-g3r2-20260927-nes78fkd/repo`；新原生 PG17 仅 `127.0.0.1:57014`，E2E生产Web `57015`，Node24.21.0。每条命令、真实退出码、时间、原始输出见同名 json/log。

| 检查 | 实际结果 |
|---|---|
| offline frozen install / Prisma generate / 12迁移 | exit0 |
| tsc --noEmit --incremental false | exit0 |
| unit / integration | 72/72、139/139；exit0 |
| build / 生产Web E2E | exit0；8/8 exit0 |
| 原 g3-contract 全18 | 17PASS/1FAIL exit1（H04d 共享店铺实际6n与固定2n） |
| 原件 H04a/H04d 受控单跑 | 2PASS/16skipped exit0 |
| 原18逻辑场景去重有效结论 | 18PASS；skipped 不计通过 |
| g3-h04-contract 四对照 | 4/4 exit0 |
| 首轮补充19 | 11PASS/8FAIL exit1，原日志保留 |
| 补充修正与DST定向4 | 1PASS/3FAIL/17skipped exit1 |
| 补充最终有效21 | 12PASS/9FAIL，按 supplemental-accounting.json 去重 |

原 g3-contract SHA256 `529823d96a4dfb3c70558e5ea87818383ad2e0509fd00f87b55a3239db7f0b6a` 未改。H04d 失败来自共享店铺假设，使用原文件仅选择 H04a/H04d 获得正确隔离；不把2改6、不改来源级合同。R1索引42件不可变产物逐一匹配。

补充首轮跨 namespace 别名探针与 R1 同来源前提不同，退出本轮缺陷集合，后以原前提验证通过。地址首轮在commit后读preview得到409，不能证明预览泄露；改为commit前读200后复现地址泄露。两次原件/日志都保留，只补测上述修正和新DST边界，未重复不变的常规全套。原 R1 地址断言仅检查不含完整地址，不能检出楼栋后缀；本轮补明确断言，不改历史证据。

integration139不含两g3独立文件，也不含之后才加入的补充探针；不得合并成常规通过数。E2E中的 aborted/ECONNRESET 输出保留。100000行性能、SIGKILL、此次新生产Worker容器链、真实OSS云未新验，不写成通过；按原TASK029或更早启用/部署前边界补齐。本轮 PG/工作副本已清理，证据保存，见 cleanup.json。

## 10. P0 范围检查

完整 P0/F01–F23/原30 TASK、六类CSV、经营/商品/广告/售后/VOC、告警、AI建议/日报/本人行动与必要页面/运维验收保持。独立注册是交付要求，但 TASK031 合同仍待批准。上述返修均追溯原合同及本次差异，旧A/B缩减方案不采用。

## 11. 过度设计检查

不要求新增基础设施平台、外部脱敏服务或整套来源迁移功能。沿用现有事务、Decimal、staging 与时区机制修原根因。无新变更/有效反例不重开 H01/H05/H06/H07 或 Gate02。

## 12. GPT_PRODUCT_DECISION_REQUIRED

本轮有效缺陷无需新产品裁决。重要范围疑义仍须立即停止相关开发交 Owner；不因本次 FAIL 或换窗推导 Phase4/开户/部署放行。

## 13. ZCode 必须修复项（CRITICAL/HIGH）

H03 staging 绑定、H04 全来源日行齐与 IANA 日期边界、H08 完整脱敏/有效正文为必须关闭；同轮收口 H02 合法旧版本退款及 M02 脚本退出码。先只读 ACK `G3R2-20260927-02`，核对版本/在途管理/范围/写入者，等待 Codex START。一次一TASK按008→009→010→012推进共享根因，011技术通过不另派广告改动。

先记录有明确期望值的修前失败回归，再修后验证；不覆盖R1/R2报告或证据。新/tmp代码副本+本次新PG17测试，原隔离错误受控纠正并保留原件；最终单一候选、精确业务/管理提交及差异/真实退出码/未运行项。冻结后交回Codex，待 `dd975cd..新HEAD` 独立复审。

## 14. 是否需要 Codex 复审

需要。按新差异与本轮未关闭标准复审，保留合法/隔离/事务对照；自测绿不替代独立 PASS。管理收尾按 STATE_PROTOCOL 更新唯一进度并 sync，正式送达/ACK/START 以协调回执为准。

## 15. Gate 结论

**GATE_03 REVIEW2 = FAIL。** 原8 HIGH已收敛为3 HIGH、H02残余1 MEDIUM及新增脚本1 MEDIUM；尚不能接受六类导入功能节点。下一责任人ZCode（收到START后），下一提示词P08，Checkpoint=YES。技术检查、独立审查、Owner放行、GitHub、部署、客户试用分别记录。
