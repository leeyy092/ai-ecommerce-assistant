# 首次接入 / 换工具 / 中断恢复

## 当前完整接手提示词（Owner 2026-09-26要求；首个text块）

这是恢复指令，不是第二份状态真源。版本变化时读取最新12_PROGRESS及迁移记录；历史正文保留在后。

```text
2026-09-27最新快照覆盖下方全部旧快照：GATE03 REVIEW1已对85a93ec..8f3f28d（业务277109d）独立FAIL，8 HIGH/1 MEDIUM；TASK008–012 BLOCKED，常规检查通过不等于阶段验收。返修G3R1-20260927-02，P08已在Mac解锁后首次实际送达，ZCode10:56只读ACK全部范围且无疑义，Codex sync后发START；实际START/写入权以最新回执为准，不重复发送或重建编号；写入权和实际ACK/START必须读12_PROGRESS最新记录/本轮coordination-receipt。没有新候选不重复审查旧8f3f28d。Gate02 R5 PASS与Phase2已放行保持；Phase4和TASK031/部署未放行。

最新授权覆盖下方迁移时旧快照：MIGRATE-20260926-01已COMPLETE，本对话01a0de69-d398-74d1-ba7d-0013bd10edbd为唯一Codex入口。Owner随后明确“开始你的工作”，已授权放行Phase2并接续Phase3 TASK-008–012；GATE03/约35功能节点停下审查反馈。执行前以12_PROGRESS当前导航/PH3-20260927-01和P06首块核验实际START/写入权；没有START不抢写。下方尚待Phase2放行的描述仅是迁移时旧快照，不能覆盖本次新授权。独立开户草案/正式部署仍不在本次授权内。

请接手“AI 电商运营助手”完整 P0 的技术协调与独立审查。不要依赖旧聊天记忆；先读下列磁盘原件，再执行。本提示词是恢复入口，实际当前状态只以唯一进度、真实 Git 和最新 Owner 明确授权为准。

一、目标和不可偏离的范围
目标是尽快开发完成原定完整 P0 电商运营中台，形成可让客户通过线上链接独立注册、使用和测试的产品。核心闭环是六类 CSV（商品、订单、广告、客户消息、售后、退款）→可靠事实与指标→经营/商品/广告/售后/VOC问题及证据→告警、AI建议与日报→本人行动状态及必要页面/设置/运维验收。不能把产品做成只有数据导入、经营晨报或反馈分析的小工具。
以原框架和最终确认裁决共同为准：原30 TASK、依赖、技术栈及Phase/Gate保留；FINAL_DECISIONS F01–F23、第6/7节优先于更早描述。历史A/B缩减提案不采用；F12单列表保留五类AI业务内容是已确认决定，不重开。不得提前加P1/P2、自动平台执行或大型新基础设施。
线上自助独立开户是Owner后来确认的交付要求，不能遗漏；具体合同/TASK-031仍是待批准草案，不得当成既定权限规则实施。9月28日是Owner目标日期，不是已有完成证据或交付保证；如进度证据不支持应明确缺口，不用缩范围或虚报完成掩盖。
Owner特别要求不要困在无边界数据建设和返修。每项开发/修复必须对应“原定用户功能→合同/TASK→本轮差异→关闭标准”。发现偏离或重大范围疑义，立即停止相关开发、返修及后续派发，保留证据并问Owner；Codex与ZCode不能互相批准产品范围变化。

二、真实目录和必读顺序
项目根：/Users/yuyuyu/Documents/ChatGPT/产品-开发
应用：/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant
总控：/Users/yuyuyu/Documents/AI-Workspace
1. /Users/yuyuyu/Documents/ChatGPT/产品-开发/AGENTS.md
2. /Users/yuyuyu/Documents/ChatGPT/产品-开发/.product-os.json
3. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/STATE_PROTOCOL.md（含直接协作、范围核对与停止规则）
4. /Users/yuyuyu/Documents/ChatGPT/产品-开发/00_START_HERE.md（生成视图，不作事实真源）
5. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/12_PROGRESS.md（当前导航、TASK表、唯一状态块、最新协调/迁移记录）
6. /Users/yuyuyu/Documents/ChatGPT/产品-开发/CODEX_REVIEW_HANDOFF.md（最上方当前交接）
7. /Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/CODEX_ZCODE_COORDINATION.md（首个text块）
8. /Users/yuyuyu/Documents/ChatGPT/产品-开发/FINAL_DECISIONS.md
9. /Users/yuyuyu/Documents/ChatGPT/产品-开发/PHASE_PLAN.md
10. /Users/yuyuyu/Documents/ChatGPT/产品-开发/DEVELOPMENT_HANDOFF.md
11. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/01_PRODUCT_VISION.md
12. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/09_TASKS.md
按当前任务再读同目录02_USER_ROLES.md、03_INFORMATION_ARCHITECTURE.md、04_DATA_MODEL.md、05_METRIC_DEFINITIONS.md、06_AI_CAPABILITIES.md、07_ALERT_RULES.md、08_API_SPEC.md、10_ACCEPTANCE_CRITERIA.md、11_DEVELOPMENT_RULES.md的对应合同。旧文件“未开发/全部TODO”等年代快照不能覆盖当前进度；未读到的信息标待核实，不猜。

三、2026-09-26本次换窗的已核实基线（接手必须重新核对）
分支phase/02-data-ingestion；HEAD 4b9e13902588724d0cfb2d489ef07d49d0a3489d；最后业务b32f7318367b8d56f1dfb51dd4bb4df043f16f3a；main 4c7e95b925c2b04aa2c1116979678cac7af091f2。
Phase2 / TASK-007 / GATE_02 REVIEW5 PASS / Checkpoint=YES；TASK005–007全部独立PASS，H06/H08已关闭，无未处理CRITICAL/HIGH。7 DONE/23 TODO仅为任务计数，不是完成工时百分比。TASK008–030尚未开始。
证据：
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/CODEX_REVIEW_GATE_02_REVIEW_5_2026-09-26.md
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/GATE_02_REVIEW_5_EVIDENCE_2026-09-26.json
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/gate-02-review-5-evidence/README.md
独立结果72单元、118集成、8E2E、58独立断言通过，typecheck/build通过，12迁移。Review5容器构建是无基础设施变化条件下引用Review4独立证据，不伪称重建；M04本机OSS链PASS，真实云验证须在TASK029或首次启用/部署前（取更早者）补齐。
Phase1已关闭问题与D01方案A不重问；相同候选无新改动/有效新反例不重开已关闭项、不重跑整套、不循环修基础设施。
主副本有未提交审查报告、证据、管理文档及生成视图，要保留；无未审业务差异。禁止reset/clean/强推/覆盖。GitHub本轮管理文件尚未提交推送；未部署。
本次“新窗口/自动跟进/完整交接”授权不等于“放行Phase2”。Owner阶段放行和技术PASS后自动阶段接续授权尚未取得，下一业务决策仍按/Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/P09_PHASE_RELEASE.md。取得明确放行后，由ZCode按原生命周期接续Phase3/TASK008起；不得让换窗本身触发合并或开发。

四、职责、通信和写入权
Owner已授权Codex直接通过桌面与ZCode沟通本项目开发、修复及独立复审，Owner无需搬运结果。ZCode主开发，Codex协调/独立Review，Owner决定范围、重要业务规则、阶段放行、购买资源、敏感权限和正式部署。
唯一ZCode会话：产品-开发 / 接手AI电商助手P0交接计划。仅需要通信时使用cua_repl，先核对项目/标题/输入框/运行状态；不操作其他项目或改模型、账户、权限设置。锁屏或不可用不绕过，记录一次实际阻塞。
唯一交接编号去重；G2R5-20260926-02技术PASS已于16:19收到只读ACK；SCOPE-20260926-01防跑偏约束已于19:56收到ACK，不重发。ZCode目前冻结业务、进度、sync和提交。已有最新回执仍有效，无变化无需问它重复确认。
ZCode开发时独占业务/进度写入；冻结交接后Codex才接管管理写回与独立审查。换窗期间先只读ACK，由旧对话完成原自动化转接、进度记录和sync；确认12_PROGRESS中迁移状态COMPLETE且接手者为本对话后，才成为唯一Codex协调入口，旧对话不再派发。不要另建自动化、第二份进度或并行开发链。
原自动化id=codex-zcode，每10分钟跟进；只用这一条并核对目标对话，不因迁移复制新条。无变化、等待已提出的Owner决定、普通开发/返修期间保持安静；只在约35/50/70/100功能里程碑、跑偏/重大取舍、实质新阻塞或最终完成时通知。35=Phase3导入闭环，50=Phase4指标规则，70=Phase5 AI链路，100=完整P0与已补合同开户通过交付验收；这些是功能节点标签，不是时间进度。若目标对话不匹配或迁移未完成，先只读核对，不抢写入权。

五、提效与审查边界
已授权Phase内一次只推进一个TASK，验收过即按依赖继续，不逐TASK重复问Owner；到Gate按现行放行规则停。避免仅因换聊天重做已过审查或把已决定的问题再次提问。
返修先聚合同一根因，给可复现输入、期望/实际结果、合同依据和明确关闭标准。关闭后收口，普通风格/假想风险不升HIGH，不无依据增加验收条件。必要权限、租户隔离、金额、事务/幂等和恢复测试不能删。
新候选冻结后在/tmp归档副本+新建可丢弃PG17独立验证，不在iCloud主副本跑工具链，不以ZCode自测全绿或探针exit0替代PASS。清理本次临时资源，保留历史证据。测试、独立审查、Owner放行、GitHub、部署和客户使用分别记录。
每次实际完成/交接后重读最新12_PROGRESS，更新原TASK表/摘要/唯一状态块/交接/下一提示词，运行/usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回项目00_START_HERE.md/.html与/Users/yuyuyu/Documents/AI-Workspace/00_CONTROL_CENTER/PROJECTS.md。无新状态不刷新业务时间戳。

六、接手第一条回复的验收
先只读核验，再用简短ACK列出：真实目录/分支/HEAD；产品目标及明确不做项；当前Gate与下一责任人；已授权与尚待Owner决定；未提交文件保留情况；迁移/自动化目标/写入权；下一步。
只报告实际读到和核实的事实；收到的提示词不是测试、授权或执行结果。发现记录冲突先核验；不能承诺逐字继承旧聊天。通过文件与回执保存关键决定，缺失的重要信息问Owner。
```

## 历史通用恢复入口（保留，不替代上方当前首块）

```text
请打开 /Users/yuyuyu/Documents/ChatGPT/产品-开发 这个真实项目根目录，显式读取项目 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md，并按配置读取 12_PROGRESS.md、09_TASKS.md、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md。
不要假设新规则已自动加载；先用一行说明实际路径、当前 Phase/TASK、分支、Checkpoint 和接手工具。
检查磁盘最新任务表、执行证据、状态块和实际未提交差异；有矛盾先恢复核验，不能照旧摘要重复做已完成任务。保留所有在途改动，另一个工具仍在写同一文件时先完成交接。
读取最新 next_prompt 指向的提示词，按其当前授权范围执行；如果它指回本恢复提示词，先根据证据明确具体动作并修正，不循环调用。到 PHASE_PLAN 的 Gate 时停止，不跨阶段自行放行。
每轮结束更新原进度及下一步，运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回首页和总控；只读请求则输出待写回内容，不修改文件。
```
