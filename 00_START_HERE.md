<!-- PRODUCT_OS_GENERATED: regenerate from project progress; do not edit -->
# 电商中台 · AI 电商运营助手 · 我现在做什么

> 自动生成视图。改进度主记录后运行刷新，不在此单独改状态。

| 你要知道的事 | 当前记录 |
|---|---|
| 最终目标 | 交付原完整 P0 电商运营中台：六类 CSV、经营/商品/广告/售后/VOC、告警、AI 日报与行动；满足线上独立注册使用要求（新增开户合同待补齐） |
| 当前阶段 | 06 分任务开发 · Phase 3 六类文件导入链路 · TASK-010 进行中 |
| 当前任务 | TASK-010 |
| 当前状态 | 进行中 |
| 上一个完成项 | TASK-009 DONE（10adb88）：commit CAS/店铺锁事务/重放复用/注入回滚/sku-aliases 别名；TASK-008 已完成（a5e9b7b） |
| 下一步 | TASK-010 订单头与订单行导入（Phase 内一次一 TASK 连续推进至 TASK-012，GATE_03 停审） |
| 交给谁 | ZCode |
| 做到什么算完成 | TASK-008–012各按原合同验收；六类文件全量校验/预览确认/原子提交、隔离与幂等更正通过；GATE_03独立审查后停下向Owner反馈 |
| 卡点 | 无已知技术阻塞；TASK-009 进行中。开户合同（TASK-031 草案）与真实 OSS 云验证保持原边界 |
| 检查点 | NO |
| 审查 | GATE_02 REVIEW5 PASS（4b9e139/业务b32f731）；Owner已授权Phase3；GATE_03尚未开始 |
| 进度最后更新 | 2026-09-27T01:16:00+08:00 |

项目绝对路径：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`

## 复制这一段，交给 ZCode

```text
当前项目：/Users/yuyuyu/Documents/ChatGPT/产品-开发
产品目标：交付原完整 P0 电商运营中台：六类 CSV、经营/商品/广告/售后/VOC、告警、AI 日报与行动；满足线上独立注册使用要求（新增开户合同待补齐）
当前任务：TASK-010
本轮动作：TASK-010 订单头与订单行导入（Phase 内一次一 TASK 连续推进至 TASK-012，GATE_03 停审）

请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 接续完整P0，应用在 ai-ecommerce-assistant/。协调编号PH3-20260927-01，唯一Codex协调对话01a0de69-d398-74d1-ba7d-0013bd10edbd；MIGRATE-20260926-01已COMPLETE。
先读AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、唯一进度docs/ai-ecommerce-assistant/12_PROGRESS.md当前导航/状态块/文末本编号、FINAL_DECISIONS.md第6/7/8节、PHASE_PLAN.md、DEVELOPMENT_HANDOFF.md和09_TASKS.md TASK-008–012。旧“Owner尚未放行Phase2”仅保留历史，不得覆盖最新授权。
Owner已在本对话要求现在开始后续开发、一定进度停下反馈、遇到重要不确定或可能偏离产品时先确认。REVIEW5技术PASS基线为phase/02-data-ingestion@4b9e13902588724d0cfb2d489ef07d49d0a3489d，业务b32f731，main原4c7e95b。本次放行Phase2并授权Phase3 TASK-008–012；不推定未来Phase全部自动放行。下一Owner停点为六类导入闭环/GATE_03（约35功能节点，不是工时进度）。
先只读ACK：实际分支/HEAD、在途差异、阶段范围、TASK-008验收、停止点及具体阻塞。收到Codex START后才接管写入权。本次只读ACK仅用于新交接；若唯一进度已记录本编号START并确认ZCode持有写入权，恢复或下一TASK直接继续已授权工作，不重复等待ACK/START。Codex此前审查报告/证据/管理文件须保留；不得reset/clean/强推覆盖。在原Phase2分支按原Git生命周期检查差异和敏感文件，保存本项目审查/管理记录，核对业务候选未变后合并已放行Phase2至main并推送，创建/接续原计划phase/03-import；main不开发。若出现未审业务变化或无法保护在途文件，停下交Codex核对；不得把未提交报告当作已上GitHub。
Phase3用户结果：六类CSV可经字段映射、全量校验、脱敏预览和用户确认后原子提交，重传不重复、更正可追溯；支持后续指标/告警/VOC/AI中台。严格按008映射预览→009商品提交内核→010订单头/行→011广告→012客服/售后/退款，一次一个TASK，完整验收才记DONE；阶段内按依赖继续，无需逐TASK向Owner重复请求。
TASK-008先按公共内核→六类规则→预览冲突分段，读02_USER_ROLES权限、04_DATA_MODEL的ImportTask/来源约束及PART11/12、08_API_SPEC §17.1/17.3、10_ACCEPTANCE_CRITERIA和11_DEVELOPMENT_RULES对应合同。输出mapping/staging/preview、全量错误清单、私有错误下载、preview_version与insert/update/unchanged/rejected计数；任一错误不能提交、预览过期需重验、未知SKU显式处理、同时间异内容冲突、跨组织/店铺拒绝、coverage不能按文件长度推断。商品/订单/金额/退件/退款关联按原合同；六种文件名是products/orders/order_items/ads/customer_messages/after_sales，后者case/refund分渠道。沿用F05/F07/F10/F13/F15；不引入新平台或独立大表，不抢跑UI、指标AI、开户与P1/P2。
每项记录“用户可用功能→原合同/TASK→本轮差异→验收/关闭标准”。必要测试与类型检查在/tmp隔离副本+本次新PG17执行，不在iCloud主副本跑工具链。权限、金额、事务/幂等、恢复验证保留；低影响管理修改不造业务测试；已有PASS无新差异/有效反例不重跑不返修。常规技术问题自行排查；合同无法裁决的重要不确定、范围偏离、重要Schema/API改变、外部费用或部署需求立即暂停受影响工作，给Codex具体证据与选项，由Codex问Owner，不自行猜测或相互批准。
ZCode开发时独占业务/唯一进度写入，Codex只读跟进。每TASK完成按协议更新12_PROGRESS任务表/摘要/唯一状态块/证据及下一个TASK，sync并读回首页md/html/总控；保留历史。TASK-012完成后冻结候选、更新CODEX_REVIEW_HANDOFF和P07为整个Phase3范围/提交/测试证据，Checkpoint=YES、下一Codex独立GATE_03，不进入TASK-013。直接回本ZCode会话，无需Owner搬运；报告编号、分支/HEAD/最后业务提交、各TASK验收与真实命令结果、残余问题、证据及写入权。好的改进机会可附简短建议，未确认的新范围先不实施。
```

## 技术状态（各自独立）

- Git：已建立本地 Git；存在未提交或未跟踪内容。
- 分支：phase/03-import；版本：10adb88b124f363c066a476cd1f044bd2f4f73b2。
- origin：ssh://github.com/leeyy092/ai-ecommerce-assistant.git（仅配置，不能证明已推送）。
- GitHub：2026-09-27 本地/远端 phase/03-import=a5e9b7b（TASK-008）；main=85a93ec（Phase2 已按放行合并）；phase/02-data-ingestion=4b9e139 冻结保留；最后核验：2026-09-26T16:06:50.912385+08:00；地址：https://github.com/leeyy092/ai-ecommerce-assistant；证据：本轮独立git ls-remote与实际HEAD一致；审查管理写回另计，未推送。
- 部署：未部署；本轮生产模式Web/Worker在一次性本机环境验证，不是线上发布；最后核验：从未核验；地址：未记录；证据：TASK-029未开始；无Owner部署许可、无线上或客户使用证据。

刷新前本地快照时间：2026-09-27T01:34:54+08:00。远端与部署是最后核验的记录，未由此次刷新联网重验。

[进度主记录](docs/ai-ecommerce-assistant/12_PROGRESS.md) · [完整提示词库](prompts/README.md) · [返回总控](../../AI-Workspace/00_CONTROL_CENTER/index.html)
