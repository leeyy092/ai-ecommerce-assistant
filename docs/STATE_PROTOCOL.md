# 电商项目状态维护协议

## 唯一事实来源

`.product-os.json` 映射原有文档；`docs/ai-ecommerce-assistant/12_PROGRESS.md` 是唯一进度源。
`09_TASKS.md` 保留任务定义、依赖、验收和测试合同，不复制任务状态到新表；执行状态与证据在 `12_PROGRESS.md` 的任务表和执行记录中。
`PHASE_PLAN.md` 保存阶段与 Gate 规则；`CODEX_REVIEW_HANDOFF.md` 保存某一次审查交接，须核对其任务范围和版本。
项目首页、工作区总控都是生成视图，不是第二份事实来源。

## 每轮收尾顺序

1. 读取磁盘最新进度和差异，确认自己负责写回；禁止用会话里的旧全文覆盖其他工具的新记录。
2. 执行相称检查，更新 TASK 行与证据，追加日期、执行人、范围、文件、实际命令/结果、版本、限制、下一步。
3. 同时更新当前摘要与唯一 JSON 状态块。历史章节可保留但必须明确为历史，不得继续引导已完成的旧 TASK。
4. `updated_at` 使用带时区 ISO 日期，只有业务进展或真实交接才改变；刷新页面不得改它。
5. 根据当前动作更新 `next_owner`、`next_prompt`、`acceptance`、`checkpoint`、`next_action`。完整提示词放在项目 `prompts/`，必须有一个 `text` 代码块。
6. 执行 `/usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync`。
7. 读回 `00_START_HERE.md/.html` 与工作区 `00_CONTROL_CENTER/PROJECTS.md`，确认当前 TASK、工具、完成标准、Checkpoint、下一步和技术状态一致。

## 状态与接力规则

- 模板字段 `stage` 用 `06 分任务开发 · Phase N 阶段名` 或 `07 阶段审查 · Phase N 阶段名`，不更改 PHASE_PLAN 的 Phase 编号。
- `current_task` 始终保留实际 TASK 编号。开发中：任务表 `IN_PROGRESS`，状态块 `进行中`，工具 ZCode，提示词 `prompts/P06_BUILD.md`。
- Phase 内按照已经授权的 `PHASE_PLAN.md` 顺序推进；一次一个 TASK。每项验收满足才写 DONE，未通过写具体原因。
- 到 Gate：保留刚完成的当前 TASK，状态 `待审查`，Checkpoint=YES，工具 Codex，提示词 `prompts/P07_CODE_REVIEW.md`，并在进度写明 `CODEX_REVIEW_REQUIRED` 和 Gate 编号。准备干净、已推送的审查版本与最新交接；条件不齐要如实写阻塞，不能宣布已冻结。
- Review FAIL：状态 `待修复`，工具 ZCode，提示词 `prompts/P08_FIX.md`；修完回 Codex 复审。缺证据写 BLOCKED/受阻。
- Review PASS 与用户放行分别留证；两者满足再按 Git 生命周期进入下一 Phase。不能让总控刷新自行放行。
- 当前任务中断或换窗口使用 `prompts/P13_RESUME.md`；只需补收尾使用 `prompts/P14_CLOSE.md`，不推进业务任务。

## 结构字段

状态块使用 schema_version=1；必填字段为 project_name、goal、stage、current_task、status、last_completed、next_action、next_owner、next_prompt、acceptance、blockers、checkpoint、review、updated_at、updated_by、evidence。
status 只允许 未开始/进行中/待审查/待修复/受阻/已完成/暂缓；checkpoint 只允许 YES/NO。
github、deployment 各含 status、url、verified_at、evidence；未知状态写 `unknown（待核实）`，未知 URL 为空字符串。记录明确版本和核验时间，不能因为本地刷新就刷新远端核验时间。

## 只读、失败与同步边界

只读请求不写文件、不运行 sync；给出待写回内容。刷新失败必须报告“进度是否已写回、视图是否已刷新”，修正后重跑。
这是 ZCode/Codex 每轮必须遵守的执行约定，不是后台程序。普通浏览器刷新只重新显示生成文件，不读取 Markdown，也不联网验证 GitHub。
首次接入或换工具显式读取规则；不假设 ZCode 自动加载 Codex 的全局规则，也不承诺运行中的旧会话已加载新规则。

## Codex ↔ ZCode 直接协作（Owner 2026-09-26授权）

Owner明确要求两工具直接沟通开发结果、审查与修复，省去人工复制交接；关键功能里程碑和拿不准的重要取舍交Owner审核。Codex可通过已核实的ZCode桌面项目会话发送本项目技术指令、读取反馈并启动独立审查。原完整P0、TASK依赖、独立Gate及原安全/质量标准保留。

- 角色：ZCode仍为主开发；Codex负责技术协调、独立验证、问题去重和回传修复指令；Owner负责产品范围、重要业务规则、资源购买、正式部署及里程碑验收。普通实现/测试问题由两工具在既有授权内解决。
- 技术闭环：Codex派发唯一交接编号 → ZCode先报告接收、实际HEAD/分支/在途修改及本轮范围 → 执行并逐TASK更新原进度 → 冻结业务候选并提供命令/退出码/证据/残余项 → Codex在独立环境按差异复验 → FAIL直接交ZCode，PASS按当前阶段授权记录接续。自测全绿不等于Gate PASS。
- 防冲突：ZCode开发期间拥有业务与进度写入权；Codex只读监看，不同时覆盖进度。ZCode冻结并明确交接后，Codex接管复审及管理写回；修改同一文件前必须重读。每个交接编号只发送一次；已在执行的指令不重复派发，不创建第二条开发链。
- 反馈最小字段：交接编号、接收/完成/受阻、branch与HEAD、最后业务提交、差异范围、已关闭/未关闭项、原始证据路径、测试命令及实际结果、环境缺证、当前写入者、下一步。秘密不得写进聊天或证据；不要求Owner搬运正文。
- Owner节点建议：约35%=Phase3六类文件导入链路可验收；约50%=Phase4指标/规则链路可验收；约70%=Phase5 AI/VOC/日报/行动建议可验收；100%=完整P0界面/运维/整体验收以及已补齐合同的自助开户达到交付条件。百分比是约定的功能里程碑标签，不是TASK数或已耗工时的测量值；未满足验收不能抬高数字。
- 升级Owner：到上述节点给可体验产物、已过证据、未完成项与明确决策；产品范围/权限业务定义改变、外部花费/发布、不可逆数据操作及无法在既定合同内判断的重要取舍立即提请。已判定技术缺陷的常规返修无需Owner再转述。
- 阶段接续权限：当前已确认直接沟通/修复/复审授权；是否把原每Phase的Owner放行改为“技术PASS后自动接续、仅里程碑停审”已向Owner提出一次明确问题，答案未落盘前维持原阶段放行边界。不能把当前Gate02 FAIL或无人回复当成PASS/放行。
- 持续跟进：使用本Codex任务的心跳自动化；只在状态变化时采取下一动作，无新结果时不重复发指令或例行打扰Owner。桌面控制依赖本机及应用可用；锁屏、权限/连接失败如实记障碍，不绕过、不承诺机器离线也持续运行。自动化是否已创建以唯一进度的实际工具结果为准。

协调入口：`prompts/CODEX_ZCODE_COORDINATION.md`。唯一任务状态仍为`12_PROGRESS.md`；本节和提示词仅定义工作方式。
