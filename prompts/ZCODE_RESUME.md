# ZCode 当前会话接手提示词

唯一状态以12_PROGRESS为准；本文件仅为可复制接手入口。

```text
当前状态（2026-09-27T12:07:38+08:00）：ZCODE-MIGRATE-20260927-01 RESUME已实际送达，唯一最新Z02【最新Z02】电商中台｜Phase3返修与交接 / sess_bc9ea3f4-180b-493b-81c0-8d91565029d4已记接收并持有写入权，正按P08执行G3R1-20260927-02返修。本文件首块将在下一次ZCode换窗冻结时重写；下方首次只读ACK要求仅用于尚未激活的新接手会话。

你是AI电商运营助手的新ZCode主开发会话。本次ZCODE-MIGRATE-20260927-01接手，首次严格只读ACK，不写文件/测试/sync/提交，不开发，不另开会话。等唯一Codex03正式记录本次COMPLETE并发送同编号RESUME，实际送达才取得写入权。任何心跳/旧START/历史COMPLETE都不能替代激活。

路径：/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用ai-ecommerce-assistant/；总控/Users/yuyuyu/Documents/AI-Workspace。原项目原路径原分支继续，不fork旧完整历史，不建worktree/平行副本/重复状态源。协调者为【最新03】电商中台｜P0开发与独立审查，01a0e0d7-253e-7f13-9ae5-027c827e73dd；Codex用桌面与你直接交接，Owner不搬运。

必读AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md（含ZCode上下文换窗与最新开发会话）、00_START_HERE.md、唯一进度docs/ai-ecommerce-assistant/12_PROGRESS.md当前导航/状态块/TASK表/最新ZCODE迁移记录；CODEX_REVIEW_HANDOFF顶部、FINAL_DECISIONS F01–F23及§6–8、PHASE_PLAN、DEVELOPMENT_HANDOFF、09_TASKS 008–012；prompts/P08_FIX.md首块、正式docs/reviews/CODEX_REVIEW_GATE_03_REVIEW_1_2026-09-27.md完整报告尤其§4/5/13、机器索引及gate-03-review-1-evidence/README/observations/g3-independent.test.ts。按原报告读02/04/08/10/11对应合同，不从历史摘要发明行为。

目标保留原完整P0：六类CSV→经营/商品/广告/售后/VOC事实证据→告警、AI建议/日报、本人行动、必要页面及运维验收。原30TASK/依赖/栈/Phase不变，旧A/B不采用，P1/P2不做。F05交易四通道首次事实或覆盖确认原子绑定同一DataSource/namespace；F12 AI单列表保留五类业务内容。独立注册是交付要求，TASK031草案未批。Owner仅授权Phase3 TASK008→012，一次一TASK，Gate03独立PASS后约35功能节点停反馈；不开始013/Phase4、不合并main、不部署购买资源。重大范围疑义停问Owner，普通合同内返修直接完成。

冻结现场：phase/03-import@fe57663e355ea0b092146ffb7305b9c1fc89c9b8（START管理），业务277109d6cb3493949aaf26e5852340e03797d6df，已审8f3f28d20c3f562df90420f36ec271ff0fe41e19，main85a93ec2336016dda8a65314a4fb716b6eacca96。Gate02 REVIEW5 PASS保持，Gate03 REVIEW1 FAIL 8HIGH/1MEDIUM；旧独立12迁移/typecheck/unit72/integration139/build/E2E8和18场景1PASS/17FAIL不证明新改动通过。

旧ZCode在11:29:38接收RESUME后做了一部分未提交改动，11:43为本次换窗完整冻结：实际只有src/services/importPreview.ts（+159/-78）和src/jobs/handlers/imports.ts（+1）有业务diff，src/services/imports/commitTask.ts尚未修改。未跟踪tests/integration/g3-contract.test.ts SHA256=529823d96a4dfb3c70558e5ea87818383ad2e0509fd00f87b55a3239db7f0b6a必须保留。管理差异也须保留。证据docs/reviews/zcode-migration-20260927-01/freeze-manifest.json和business-diff.patch、freeze-snapshot.tar.gz；备份仅证据，不用来覆盖当前工作树。

当前预览改动只是中间态：旧ZCode口述3文件已改与磁盘不符，本人又承认提交内核未写；自述2个TS错误，Codex未复测。已读代码还有Number退款总账、未选occurredAt的引用等未完成点，不能只修TS就称修复完整。按原H01–H08/M01逐项检查实际落地：错误全拒/同键异内容/币种、全历史及整批退款和行更正、提交时效/权限/当前事实、最终覆盖、F05来源、别名消费、广告完整键、完整脱敏正文/no-op版本。H01重复冲突/错误白名单等不可仅凭口述标完成。金额用现有Decimal/精确整数，维护原合同，不新增平台或范围。

激活后按008→009→010→011→012一次一TASK接续原G3R1-20260927-02，保留已完成有效红基线，不重抄/重跑旧全套，实际更改触发原必要合法/权限/事务/故障/并发回归。工具链只在本次新/tmp副本+本次新PG17验证最终单一候选。旧/tmp/aiea-fix-g2r4与/tmp/aiea-pg-r4:5435（旧自述PID91086）是待核资产，不能假作新独立证据；不动其他项目资源。冻结新候选后交精确业务/管理版本、命令真实结果/证据/未运行项及写入权给Codex独立复审。

激活后第一件管理动作：追加真实RESUME接收/版本/完整status/写入权，统一唯一进度导航/TASK/状态块为实际进行中、ZCode/P08，保留Gate FAIL，更新当前交接与P08顶部，sync读回首页md/html与总控。每次只保留一个状态块，30TASK保留，不把append一条记录或sync成功等同当前字段正确。

长期主动换窗：遵守STATE_PROTOCOL对应条款；约75%准备、85%或长任务可能接近上限时安全迁移，用户要求或可靠性问题可提前，未知占用不猜。旧会话先安全冻结/完整交接，整理本ZCODE_RESUME首块和原唯一进度；能力允许实际创建同项目新普通会话，否则明确交Codex桌面创建。新会话先只读ACK，Codex核验身份/COMPLETE/RESUME后才能开发。旧会话标历史退出；Codex只联系最新，会话编号写原进度，不建第二条自动化。

本轮只读ACK完成判据：真实路径/分支/HEAD、完整在途diff及以上3文件的实际差别、回归哈希、已测与未测、原范围/停止点、下一步、你可核实的会话标题/ID（未知不编造）、当前写入者Codex及等待RESUME。不要运行测试或修代码。ACK后结束本轮等待激活。
```
