# AI 电商运营助手 · 项目工作规则

## 真实目录与规则来源

- 项目根目录：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`；应用在其下 `ai-ecommerce-assistant/`。Codex 与 ZCode 都打开项目根目录。
- 总控位于 `/Users/yuyuyu/Documents/AI-Workspace`，只登记原工程，不复制平行项目。
- 当前用户指令优先；本文件补充 Codex 全局 `~/.codex/AGENTS.md`，不覆盖其通用要求。ZCode 的自动读取行为未实测，必须使用首页完整提示词显式读取本文件。

## 每轮开始

1. 确认打开的绝对路径，读取本文件、`.product-os.json`、`docs/STATE_PROTOCOL.md` 与 `00_START_HERE.md`。
2. 按配置读取 `docs/ai-ecommerce-assistant/12_PROGRESS.md`、`09_TASKS.md`、`DEVELOPMENT_HANDOFF.md`、`FINAL_DECISIONS.md` 和 `PHASE_PLAN.md`；根据当前 TASK 读取对应角色、数据模型、API、验收原文。
3. 唯一进度真源是 `12_PROGRESS.md`：当前任务表、最新执行证据与其中的 Product OS 状态块必须一致。旧章节保留历史，旧审查交接不代表当前阶段。发现矛盾先核验，不能拿旧摘要覆盖最新任务状态。
4. 检查实际 Git 分支、未提交内容及当前版本。保留在途修改；另一个执行者仍在修改同一代码或进度时，先协调交接，不覆盖、不重置、不启动第二条开发链。

## 开发与阶段审查

- 保持现有 P0 范围、技术栈、原文档路径与 TASK 编号。不要为了接入 Product OS 重命名业务文件或建立第二份进度。
- 沿用 `PHASE_PLAN.md`：一次只推进一个 TASK；已授权的 Phase 内在 Checkpoint=NO 时按依赖顺序推进，每项单独检查、记录。阶段末停止开发，等待 Codex Review 与用户放行。不套用模板中“每个 TASK 都审查”的默认规则。
- Phase 1 为 TASK-001–004；TASK-004 完成后触发 `CODEX_REVIEW_GATE_01`，状态 `CODEX_REVIEW_REQUIRED`，Checkpoint=YES，下一工具 Codex；不能直接进入 TASK-005。
- 审查须基于明确基线、提交与实际差异，结论 PASS / FAIL / BLOCKED。测试通过、审查通过、用户放行、GitHub 同步、部署和真实试用分别记录。
- 现有 Git 生命周期以 `PHASE_PLAN.md` 与进度记录为准：Phase 分支开发；main 只接收通过 Gate 并获放行的阶段。禁止 force push、重写共享历史或覆盖未提交工作。已授权提交时仅纳入本任务相关文件，检查差异与敏感文件；总控刷新本身不提交、不推送、不部署。

## 每轮结束必须完成

1. 执行与本轮改动相称的检查，记录日期、版本、实际结果和未运行原因；不为低影响管理文档另造业务测试。
2. 读取磁盘最新进度，更新 `12_PROGRESS.md` 的当前任务表、当前摘要、唯一 `PRODUCT_OS_STATE_BEGIN / END` 状态块并追加执行记录，保留已有证据。
3. 根据本轮结果设置当前阶段/TASK、下一工具、完整提示词路径、完成标准、Checkpoint 和下一步。到 Gate 时更新 `CODEX_REVIEW_HANDOFF.md`，不要拿 TASK-001 的旧交接充当整个 Phase 的交接。
4. 运行 `/usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync`，由工具更新项目 `00_START_HERE.md/.html` 和总控。读回两处确认任务、工具、提示词一致；首页不是另一份可手填的进度源。
5. 简短告诉用户本轮结果、当前任务、下一工具和必要卡点。未写回或刷新失败必须说明；不能把规则存在说成工具已执行。

用户明确只读时不写回、不刷新，输出待写回内容。任务中断后先核对实际文件再续接。更改规则不会自动注入已经运行的 ZCode 会话；首次接入、换工具或新窗口都发送首页完整提示词。
