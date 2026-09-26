# Phase 3 接续开发 · PH3-20260927-01

```text
请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 接续完整P0，应用在 ai-ecommerce-assistant/。协调编号PH3-20260927-01，唯一Codex协调对话01a0de69-d398-74d1-ba7d-0013bd10edbd；MIGRATE-20260926-01已COMPLETE。
先读AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、唯一进度docs/ai-ecommerce-assistant/12_PROGRESS.md当前导航/状态块/文末本编号、FINAL_DECISIONS.md第6/7/8节、PHASE_PLAN.md、DEVELOPMENT_HANDOFF.md和09_TASKS.md TASK-008–012。旧“Owner尚未放行Phase2”仅保留历史，不得覆盖最新授权。
Owner已在本对话要求现在开始后续开发、一定进度停下反馈、遇到重要不确定或可能偏离产品时先确认。REVIEW5技术PASS基线为phase/02-data-ingestion@4b9e13902588724d0cfb2d489ef07d49d0a3489d，业务b32f731，main原4c7e95b。本次放行Phase2并授权Phase3 TASK-008–012；不推定未来Phase全部自动放行。下一Owner停点为六类导入闭环/GATE_03（约35功能节点，不是工时进度）。
先只读ACK：实际分支/HEAD、在途差异、阶段范围、TASK-008验收、停止点及具体阻塞。收到Codex START后才接管写入权。本次只读ACK仅用于新交接；若唯一进度已记录本编号START并确认ZCode持有写入权，恢复或下一TASK直接继续已授权工作，不重复等待ACK/START。Codex此前审查报告/证据/管理文件须保留；不得reset/clean/强推覆盖。在原Phase2分支按原Git生命周期检查差异和敏感文件，保存本项目审查/管理记录，核对业务候选未变后合并已放行Phase2至main并推送，创建/接续原计划phase/03-import；main不开发。若出现未审业务变化或无法保护在途文件，停下交Codex核对；不得把未提交报告当作已上GitHub。
Phase3用户结果：六类CSV可经字段映射、全量校验、脱敏预览和用户确认后原子提交，重传不重复、更正可追溯；支持后续指标/告警/VOC/AI中台。严格按008映射预览→009商品提交内核→010订单头/行→011广告→012客服/售后/退款，一次一个TASK，完整验收才记DONE；阶段内按依赖继续，无需逐TASK向Owner重复请求。
TASK-008先按公共内核→六类规则→预览冲突分段，读02_USER_ROLES权限、04_DATA_MODEL的ImportTask/来源约束及PART11/12、08_API_SPEC §17.1/17.3、10_ACCEPTANCE_CRITERIA和11_DEVELOPMENT_RULES对应合同。输出mapping/staging/preview、全量错误清单、私有错误下载、preview_version与insert/update/unchanged/rejected计数；任一错误不能提交、预览过期需重验、未知SKU显式处理、同时间异内容冲突、跨组织/店铺拒绝、coverage不能按文件长度推断。商品/订单/金额/退件/退款关联按原合同；六种文件名是products/orders/order_items/ads/customer_messages/after_sales，后者case/refund分渠道。沿用F05/F07/F10/F13/F15；不引入新平台或独立大表，不抢跑UI、指标AI、开户与P1/P2。
每项记录“用户可用功能→原合同/TASK→本轮差异→验收/关闭标准”。必要测试与类型检查在/tmp隔离副本+本次新PG17执行，不在iCloud主副本跑工具链。权限、金额、事务/幂等、恢复验证保留；低影响管理修改不造业务测试；已有PASS无新差异/有效反例不重跑不返修。常规技术问题自行排查；合同无法裁决的重要不确定、范围偏离、重要Schema/API改变、外部费用或部署需求立即暂停受影响工作，给Codex具体证据与选项，由Codex问Owner，不自行猜测或相互批准。
ZCode开发时独占业务/唯一进度写入，Codex只读跟进。每TASK完成按协议更新12_PROGRESS任务表/摘要/唯一状态块/证据及下一个TASK，sync并读回首页md/html/总控；保留历史。TASK-012完成后冻结候选、更新CODEX_REVIEW_HANDOFF和P07为整个Phase3范围/提交/测试证据，Checkpoint=YES、下一Codex独立GATE_03，不进入TASK-013。直接回本ZCode会话，无需Owner搬运；报告编号、分支/HEAD/最后业务提交、各TASK验收与真实命令结果、残余问题、证据及写入权。好的改进机会可附简短建议，未确认的新范围先不实施。
```

---

## 历史通用继续任务入口

# 继续当前任务 · ZCode

```text
请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 打开真实项目根目录；应用代码在其下 ai-ecommerce-assistant/。
先显式读取 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md，以及映射的 12_PROGRESS.md、09_TASKS.md、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md。先用一行确认实际路径、Phase、当前 TASK、当前分支和本轮停止点。
页面是上次刷新快照；以磁盘最新任务表、执行证据和状态块为准。若矛盾或存在另一个执行者在途改动，先核对并交接，不覆盖、不重置、不重复开启开发。

若当前处于待审查/待放行且Checkpoint=YES，不将本提示词视为绕过Gate的开发授权；保持原审查入口，需做完整P0准备时读取 prompts/ZCODE_FULL_P0_HANDOFF.md。已获得当前阶段开发授权后，继续当前已授权 TASK，严格沿用对应任务的输入、修改范围、验收标准、测试方式与禁止项。四角色/组织隔离任务需要核对 02_USER_ROLES.md、08_API_SPEC.md 与 09_TASKS.md 的完整合同。
遵循 PHASE_PLAN.md 已授权阶段规则：一次一个 TASK；Phase 内 Checkpoint=NO 可顺序继续，每项分别检查和记录。阶段末必须停在对应 Gate，不能跨 Gate 自动进入下一 Phase。
按 PHASE_PLAN.md 的当前阶段末尾触发对应 Gate；例如 Phase 3 的 TASK-008–012 完成后停在 GATE_03，不把旧 TASK-004/GATE_01 当成所有阶段的停止点。仅在本轮差异触发权限边界时检查对应的组织隔离、角色投影、旧会话/下载/job 回归。运行当前任务指定检查和类型检查；缺证据写未执行或受阻，不冒填 PASS。

每轮结束读取最新 12_PROGRESS.md，保留历史，更新当前任务表、摘要与唯一 Product OS 状态块，追加真实检查和版本证据。到 Gate 时更新 CODEX_REVIEW_HANDOFF.md 为当前 Phase 的实际交接，按已授权 Git 规则准备可审查版本；状态写 CODEX_REVIEW_REQUIRED/待审查，Checkpoint=YES，工具改 Codex，next_prompt 改为 prompts/P07_CODE_REVIEW.md。
执行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回项目首页和 00_CONTROL_CENTER/PROJECTS.md。只向我报告当前阶段/TASK、实际结果、下一工具与卡点。规则未执行或刷新失败要明确说，不能声称自动同步已完成。
```
