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
