# 修复 Gate 01 审查问题 · ZCode

```text
请在 /Users/yuyuyu/Documents/ChatGPT/产品-开发 显式读取 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、docs/ai-ecommerce-assistant/12_PROGRESS.md、PHASE_PLAN.md、CODEX_REVIEW_HANDOFF.md，以及 docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md 和 GATE_01_EVIDENCE.json。

当前为 Phase 1 / CODEX_REVIEW_GATE_01，结论 BLOCKED，TASK-001–004 完整验收均 FAIL，10 HIGH、4 MEDIUM。基线 main=2a983cc，冻结 phase/01-foundation=c263610541f8c8f7b41fd38c185f5feac94e8ee2；TASK-001/002已在恢复基线，不能只看分支diff忽略它们。

先核对分支、版本、未提交文件与其他执行者；保留 Product OS 与审查文档修改。逐项给出 ACCEPT/DISCUSS/REJECT，再按依赖一次一个 TASK 修复：TASK-001 H10；TASK-002 H08/H09；TASK-003 H04/H05/H06/H07；TASK-004 H01/H02/H03及相关H07。以报告真实反例和完成判据为准；M01–M04按风险和相称工作量处理，不为风格重构或扩大P0。

D01：GPT/Owner尚需明确全局账号禁用与组织成员禁用语义。裁决前不可自行改变业务定义，可先完成不依赖D01的修复；H03保留待决状态。租户管理员不能仅凭本组织角色控制其他组织账号有效性。

现有unit14/14、integration28/28、e2e6/6、typecheck/build通过，不证明反例已通过。补真实HTTP/Cookie、多组织不同角色、邀请失败和并发、审计故障回滚、数据库同域/时区、新空库及向前升级验证。H10需要真实Docker构建/启动验证；环境不具备时如实记录。关闭公开注册后应保持受控初始化/邀请可用，不手工伪造Better Auth Cookie。

仅在phase/01-foundation修复本轮问题，遵守原Git授权及每TASK记录要求。不改写共享历史/迁移，不开始TASK-005，不合并main，不部署。记录原问题、修改、实际检查、提交版本和剩余缺口。

完成后更新原12_PROGRESS.md任务表、摘要、唯一状态块与CODEX_REVIEW_HANDOFF；保留基线c263610，明确修复commit/diff。满足修复检查后回待审查/CODEX_REVIEW_REQUIRED，Checkpoint=YES，工具Codex，next_prompt=prompts/P07_CODE_REVIEW.md。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目首页与00_CONTROL_CENTER/PROJECTS.md。交Codex复审，Owner最终放行，不自行宣布独立审查通过。
```
