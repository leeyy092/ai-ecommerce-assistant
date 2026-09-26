# ZCode · 完整 P0 中台接手与开发接续指令

日期：2026-09-21。用途：Owner 将首个 text 块交给 ZCode 后，按最新磁盘状态开始其中允许的工作。当前 Gate02 仍待独立复审；此文件不替代 P07，不代表复审通过或阶段放行。唯一进度仍为 12_PROGRESS.md。

```text
你现在是 AI 电商运营助手的主开发 ZCode。请立即接手下列工作并交付实际文件和核验结果，不要只回复“理解了”，不要重新让我选择产品方向。

一、已明确的交付目标

我要的是最初设计的完整 P0 电商运营中台，并尽快上线：六类 CSV 导入、经营指标、商品分析、广告分析、退款与售后、客服 VOC、十条 P0 告警规则、AI 建议与日报、个人行动记录、导入/设置/成员管理、完整工作台及上线验收全部保留。线上测试链接须可注册和实际使用。
不采用“只做晨报”“只做商品＋客户反馈”等历史 A/B 缩减方案。原 P1/P2 不自动进入首版。保留原技术栈、30 TASK 编号、依赖和阶段 Gate。9月28日仍是上线目标；按真实剩余工作给出可验证排期，不能靠删功能、少验收或空壳页面承诺按时。

二、工作目录与必读材料

项目根目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发
应用目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant
总控目录：/Users/yuyuyu/Documents/AI-Workspace

按顺序读取：
1. /Users/yuyuyu/Documents/ChatGPT/产品-开发/AGENTS.md
2. /Users/yuyuyu/Documents/ChatGPT/产品-开发/.product-os.json
3. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/STATE_PROTOCOL.md
4. /Users/yuyuyu/Documents/ChatGPT/产品-开发/00_START_HERE.md
5. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/12_PROGRESS.md（唯一进度，优先最新导航、执行记录、任务表与状态块）
6. /Users/yuyuyu/Documents/ChatGPT/产品-开发/FINAL_DECISIONS.md（含第6节完整P0方向重申）
7. /Users/yuyuyu/Documents/ChatGPT/产品-开发/DEVELOPMENT_HANDOFF.md（原完整P0；旧启动说明不可覆盖当前进度；AI页面以F12为准）
8. /Users/yuyuyu/Documents/ChatGPT/产品-开发/PHASE_PLAN.md
9. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/09_TASKS.md
10. /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/SEPT28_BETA_PROPOSAL.md（只按顶部2026-09-21现行方向；历史缩减表与旧日期不执行）
11. /Users/yuyuyu/Documents/ChatGPT/产品-开发/CODEX_REVIEW_HANDOFF.md（顶部当前交接）
12. /Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/P07_CODE_REVIEW.md（首个text块用于识别当前待审范围，不由ZCode代替Codex出独立结论）

随后按实际工作读取同目录下的产品/角色/信息架构/数据模型/指标/AI/规则/API/验收/工程规则分册。自助开户尤其核对：
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/02_USER_ROLES.md
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/08_API_SPEC.md
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/10_ACCEPTANCE_CRITERIA.md
/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/ai-ecommerce-assistant/11_DEVELOPMENT_RULES.md

三、先核对实际状态，再选合法动作

本指令生成时：phase/02-data-ingestion；HEAD=a4652611e29d3e316de7f41bf46550fe02a64c2d；业务修复候选=a6f141f（0882e06→eee45c1→a6f141f）；TASK-007/待审查/Codex/P07/Checkpoint=YES；当前独立复审范围072f9ba..实际HEAD。已有未提交管理文档和未跟踪审查证据，必须保留。
先核对分支、HEAD、未提交差异、最新报告对应的业务版本及是否有其他执行者正在修改。磁盘变化则采用最新已核实状态，不能reset、clean、覆盖工作或启动第二条共享代码开发链。

必须分清：旧冻结版本的FAIL、新候选待审、同一候选独立PASS、Owner明确阶段放行。历史FAIL不意味着当前候选应再修同样代码；自测全绿也不等于独立PASS。
- 若仍为当前“修复完成待复审”，立即完成第四节的准备交付，保持待审业务候选；不开始TASK-008、不修改待审业务代码、不合并main、不部署。
- 若最新独立报告要求修复，按该报告和 /Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/P08_FIX.md 修复未关闭项，记录版本变化并重新交接；不要修改无关模块。
- 若同一候选已独立PASS但没有Owner明确“放行 Phase 2”，完成准备交付并保留待放行，不自行前进。
- 只有独立PASS且Owner阶段放行已有明确记录，才按第五节接续开发；若磁盘已经进入后续阶段，就从实际合法TASK继续，不回滚到旧TASK。

四、在当前Gate等待期间，立即完成三项具体工作

A. 完整交付计划：逐项核对TASK-008–030剩余工作，用“TASK/模块、依赖、可验证产物、估算投入、验证与审查修复时间、资源阻塞”的表格给出完整计划，指出影响最早完成日期的依赖链。给出最早合理窗口、主要假设和9月28日缺口，不沿用旧A/B估算，不以任务数量比例推算工程进度。不重写整套PRD。

B. 自助独立开户合同草案：明确“注册→独立Organization→首位Owner→首家店→导入→再次登录”的身份与权限、API/响应、重复请求与失败回滚、既有邮箱/成员场景、限流及验收。原受邀加入不能代替新客户开户，不能简单解封sign-up接口。列出需要修改的原合同和建议归属的原TASK，普通工程细节给出具体方案；仅真实影响产品规则且现有文档不能决定的事项标GPT_PRODUCT_DECISION_REQUIRED。此时先作为草案，不改认证代码、不把原Gate01结论改为失败、不自行重排TASK。

C. 复审材料与上线输入核对：检查当前候选的报告/关闭标准/有效反例/自测证据/复现命令是否完整可读，缺什么列具体路径和补齐方式；已有充分证据不重复空跑全套测试。核对真实脱敏样本、模型账号、域名、服务器和私有OSS等输入的准备情况，未知就写待核实，不输出密钥、不购买或部署。该核对不等于提前实现TASK-017/029。

计划和开户草案追加到现有 /Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/SEPT28_BETA_PROPOSAL.md 的当前有效部分，标“ZCode完整交付计划与开户合同草案”；保留历史。任务状态只写原12_PROGRESS.md，不新建第二份进度。此草案未形成正式裁决前，不改变本轮Gate02被审合同。
如Codex正在写共享进度/交接，先完成本轮独立产物，再协调单一写入者收尾，禁止用旧全文覆盖。

五、满足Gate条件后的开发执行方式

Gate02独立PASS且Owner明确放行后，按既有Git规则处理phase/02-data-ingestion→main和phase/03-import，从TASK-008开始，依次完成008–012，到Gate03停止。后续Phase同样按原计划推进，不自动跳过阶段放行。
每次只有一个TASK处于IN_PROGRESS；已授权Phase内Checkpoint=NO时，完成一项并通过相应检查后连续推进下一项，不反复等待我对普通实现细节确认。自助开户按最终确认的合同和任务归属实施，不借此跳过依赖或混进当前待审差异。

提速要求：
1. 保留已审地基；六类导入共用内核，保留各自完整业务规则；指标、告警、VOC、AI共用可信事实和证据；页面使用统一列表/筛选/详情/状态组件，遵守F12单一AI列表。
2. 每TASK先核对验收、样本与明确期望，覆盖其高风险失败/权限/并发/恢复场景；修复附有效反例修前失败、修后通过。按任务运行typecheck和必要测试；小型管理变更不造业务测试。
3. 工具链在非iCloud的可丢弃工作副本和隔离PG17环境验证；不能把主工程复制成第二个进度真源，不在主副本的被驱逐node_modules上反复挂死。
4. 不为风格做无关重构，不新增大型架构或依赖，不把必要数据正确性、权限、失败恢复与上线验证删掉。Medium/Low是否延期逐项核定，Critical/High不能用赶工豁免。
5. 每阶段拿出真实可运行结果；完整验收覆盖从新客户独立开户、六类导入，到经营/商品/广告/售后/VOC/告警/AI/行动及历史恢复。API存在、Mock演示、页面能打开不能替代完整产品验收。

六、收尾与本轮交付要求

工作结束前重读最新12_PROGRESS.md，追加本轮文件/版本/命令/结果/未运行原因与下一步；保持任务表、摘要、唯一状态块一致。当前只是准备时，不将TASK-008标IN_PROGRESS或DONE，不将next_owner从Codex改成ZCode，不用本指令覆盖P07审查入口。仅在实际修复/审查/放行状态发生变化后，按协议切换工具和提示词。
执行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync ，读回项目00_START_HERE.md/.html及 /Users/yuyuyu/Documents/AI-Workspace/00_CONTROL_CENTER/PROJECTS.md。

本轮最终答复必须给出：
- 核实后的当前Phase/TASK/Gate和本轮实际允许的工作；
- 完整计划与自助开户草案的绝对路径和具体完成内容；
- 9月28日可行性、完整交付窗口的依据及仍缺的输入；
- 实际执行/未执行的检查；
- 下一责任人和唯一下一步。当前若仍待独立复审，明确交Codex复审，不能只回复“等放行”而不完成上述准备。
```
