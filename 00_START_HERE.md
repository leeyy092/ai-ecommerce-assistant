<!-- PRODUCT_OS_GENERATED: regenerate from project progress; do not edit -->
# 电商中台 · AI 电商运营助手 · 我现在做什么

> 自动生成视图。改进度主记录后运行刷新，不在此单独改状态。

| 你要知道的事 | 当前记录 |
|---|---|
| 最终目标 | 交付原完整 P0 电商运营中台：六类 CSV、经营/商品/广告/售后/VOC、告警、AI 日报与行动；满足线上独立注册使用要求（新增开户合同待补齐） |
| 当前阶段 | 06 分任务开发 · Phase 4 计算与规则引擎 |
| 当前任务 | TASK-013 |
| 当前状态 | 进行中 |
| 上一个完成项 | Phase3 TASK008–012技术完成，GATE03 REVIEW4独立PASS，约35功能节点达成 |
| 下一步 | Z02已18:19:09接收PH4-20260927-01 START并接管唯一写入：先落回执并统一进度，随后按P06执行原Git生命周期（提交管理/证据在途→合并Phase3至main→建phase/04-metrics-alerts），再013→014→015→016单TASK推进至Gate04冻结交Codex；PASS前不实施017/031 |
| 交给谁 | ZCode |
| 做到什么算完成 | 按原013–016合同验证持久任务恢复、金额/时区/覆盖、成熟退款队列、确定性规则与完整快照发布；支撑老板三分钟主路径，不扩范围。 |
| 卡点 | 当前无已知Phase4技术阻塞。域名/注册商、云账号、备案主体待补；具体采购与发布另行确认。031先补齐合同，重要未决开户规则不得假称已批准。 |
| 检查点 | NO |
| 审查 | GATE03 REVIEW4 PASS；Owner本轮直接要求自主推进，Phase4已授权；Gate04尚未审查。 |
| 进度最后更新 | 2026-09-27T18:19:09+08:00 |

项目绝对路径：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`

## 复制这一段，交给 ZCode

```text
当前项目：/Users/yuyuyu/Documents/ChatGPT/产品-开发
产品目标：交付原完整 P0 电商运营中台：六类 CSV、经营/商品/广告/售后/VOC、告警、AI 日报与行动；满足线上独立注册使用要求（新增开户合同待补齐）
当前任务：TASK-013
本轮动作：Z02已18:19:09接收PH4-20260927-01 START并接管唯一写入：先落回执并统一进度，随后按P06执行原Git生命周期（提交管理/证据在途→合并Phase3至main→建phase/04-metrics-alerts），再013→014→015→016单TASK推进至Gate04冻结交Codex；PASS前不实施017/031

你是产品-开发唯一最新Z02，继续当前窗口。交接编号PH4-20260927-01，协调者Codex04 / 01a0e16d-be56-7741-bced-49133cdcafeb，MIGRATE-20260927-03 COMPLETE；ZCODE-MIGRATE-20260927-01 COMPLETE，Z02 sess_bc9ea3f4-180b-493b-81c0-8d91565029d4。根目录/Users/yuyuyu/Documents/ChatGPT/产品-开发，应用ai-ecommerce-assistant。
Owner于2026-09-27在收到两批范围与风险说明后明确要求：“你把问题都给我解决，或者给我解决方案。围绕这个上线目标来做所有动作，你自己想办法。”按本次直接执行指令，恢复原完整P0范围的后续开发，立即放行Phase4 TASK013–016；同一冲刺内已定范围经Codex独立PASS后由Codex协调接续，不再为普通阶段接续重复等Owner。9/30先MVP、10/5功能冻结、10/8完整P0为目标；按PLAN-MVP-20260927-01分批组织，完整范围和验收不减。TASK031必须先补齐开户合同，尚未逐条批准的重要开户规则不能假称已批准；资源采购、部署发布、敏感权限及重大范围变化仍给Owner具体方案确认。技术PASS与Owner产品验收仍分开。
先读AGENTS/.product-os.json/STATE_PROTOCOL/00_START_HERE/12_PROGRESS当前导航与本编号最新记录、FINAL_DECISIONS第11节、PHASE_PLAN顶部最新授权、DEVELOPMENT_HANDOFF原功能/栈、09_TASKS TASK013–016以及04模型、05指标、06数据、07规则、08API、10验收、11开发规则中本任务引用合同；F01–F08与最新裁决优先，不用旧摘要改合同。
原定用户功能是“老板一页看经营变化、最大问题、待验证机会、今天首要动作，并展开同版证据”，对应03_INFORMATION_ARCHITECTURE PART4、09_TASKS TASK021/022及FINAL_DECISIONS。MVP保留指标/问题/商品/VOC摘要/最多3行动和证据的老板核心路径，四张AI短句结论由019已授权Insight支持；自动定时日报/历史与完整配置在第二批补齐。若现有019响应不能支持四卡，先指出合同差额，不另造第二套模型服务、不伪造结论。老板页当前尚未实现。Phase4提供其正确、可读的同版指标与规则，不扩成无业务价值的基础设施。
当前冻结phase/03-import@ea1c15ff8477c041873922109221f09a36e2aebf（业务bc5e4b2），main85a93ec；GATE03 REVIEW4独立PASS，TASK008–012 DONE，Gate02 REVIEW5保持。管理差异与R1–R4证据全部保留。首次只读ACK真实Git、在途范围、TASK013验收、阶段停止点与阻塞；不得因ACK测试/写文件/改Git。收到同编号START才接管唯一业务/进度/sync/Git写入，先落真实回执。编号已START则继续，不重复握手。Codex送达START后只读，冻结后才回交。
START后按原Git生命周期安全保存本项目管理/证据修改，逐路径检查差异和敏感文件、只提交相关文件；合并已通过的Phase3至main、创建/接续phase/04-metrics-alerts，禁止reset/clean/force/覆盖或盲目git add全部；不能安全合并则保留现场报告具体阻塞。原授权远端同步照生命周期执行并单列证据，不因本指令部署。
一次一TASK：013持久任务/评估身份/两阶段发布（提交后入队前崩溃可恢复、重投/Worker重启、并发导入旧任务不顶替新版、指标和规则齐备才发布）；014确定性经营广告指标（Decimal逐分、IANA时区/缺源真零、归因分组、无成本ROI不可计算）；015成熟D+7退款/售后队列（事件日≠付款队列、晚到/部分退款不重计、未成熟/小样本）；016既定十条规则与首个完整快照（触发/不触发/边界、阈值版本/竞争、无P1库存ROI规则）。未做模块不得提前声称完整可用。
相称测试，沿用原必要检查；不重复无改动的旧全套、不重开已过项。TASK013实现规划写清接下来的指标/规则完成标记接口，避免空handler误发布；F01定时评估不能被AI开关阻断。金额、权限、版本质量不减；模型/云账号不阻塞本Phase。
TASK013–016完成后在GATE04冻结单一候选，写明差异/提交/测试命令退出码/临时资产/未测项，交回Codex独立复审；不得自行跨Gate实施017/031。Codex PASS后按最新Owner执行授权接续原范围，不再把旧“仅到Phase3”当阻塞。任务片段前置前必须补对应合同，部分TASK不标DONE。
每TASK核对用户功能→合同→本轮差异→验收；仅一个IN_PROGRESS。收尾更新唯一进度、HANDOFF、P13/下轮首块并运行/usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回00_START_HERE.md/.html和总控PROJECTS。
CTX-RULE-20260927-01保持原窗口；不按占用比例/长任务提前迁移，不改模型/账户/权限。重大产品疑义停受影响工作；普通工程问题自主解决。老板核心路径不可被MVP删掉；完整P0不砍、市场验证不伪造。
```

## 技术状态（各自独立）

- Git：已建立本地 Git；存在未提交或未跟踪内容。
- 分支：phase/03-import；版本：ea1c15ff8477c041873922109221f09a36e2aebf。
- origin：ssh://github.com/leeyy092/ai-ecommerce-assistant.git（仅配置，不能证明已推送）。
- GitHub：本地候选ea1c15f（业务bc5e4b2），Z02报告本轮未推送；远端仅历史11:10核验phase/03-import=fe57663/main85a93ec，本轮未重验；R4管理未提交；最后核验：2026-09-27T11:10:10+08:00；地址：https://github.com/leeyy092/ai-ecommerce-assistant；证据：本轮本地git status/log/rev-parse；主业务diff为空。未联网重验远端，不用本地PASS推断GitHub已同步。
- 部署：未部署，未进行真实客户试用；Phase3技术PASS不等于完整P0上线；最后核验：从未核验；地址：未记录；证据：R4独立按提交服务差异验证；浏览器/构建引用无变化R3独立证据，Z02本候选自测单列；正式部署/TASK031开户与后续完整页面均未验收。

刷新前本地快照时间：2026-09-27T18:19:56+08:00。远端与部署是最后核验的记录，未由此次刷新联网重验。

[进度主记录](docs/ai-ecommerce-assistant/12_PROGRESS.md) · [完整提示词库](prompts/README.md) · [返回总控](../../AI-Workspace/00_CONTROL_CENTER/index.html)
