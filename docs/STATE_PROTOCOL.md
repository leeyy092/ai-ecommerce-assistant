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
