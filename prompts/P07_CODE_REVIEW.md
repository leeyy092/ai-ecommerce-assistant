# Gate 01 第二轮独立复审 · Codex 接手提示词

```text
请接手 AI 电商运营助手的 CODEX_REVIEW_GATE_01_REVIEW_2，只做 Phase 1（TASK-001–004）的独立复审，不修改业务代码、不推进 TASK-005、不合并 main 或部署。

项目根目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant；总控：/Users/yuyuyu/Documents/AI-Workspace。

先显式读取根目录 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md；按配置读取 docs/ai-ecommerce-assistant/12_PROGRESS.md（唯一进度）、09_TASKS.md、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md、CODEX_REVIEW_HANDOFF.md，以及首轮 docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md、docs/reviews/GATE_01_EVIDENCE.json。按需读取角色、数据模型、API 和验收原文。

本次交接核对状态：Phase 1 / TASK-004 / 待审查 / CODEX_REVIEW_REQUIRED / Checkpoint=YES / 下一工具 Codex。分支 phase/01-foundation；首轮冻结 c263610541f8c8f7b41fd38c185f5feac94e8ee2；第二轮待审提交 c87a141648227954725402c715063a900fa72659；main 基线 2a983cc55f136abbb49c5d02b55c1cb82b6547cc。先重查 HEAD、分支、未提交差异及是否另有执行者；保留本轮未提交管理文档，版本变化则重定范围，不覆盖或重置。

首轮 c263610 为 BLOCKED（10 HIGH、4 MEDIUM）。ZCode 已提交修复：73a5108（TASK-001）、3e90bf6+24f877a（TASK-002）、63e16ea（TASK-003）、e56be99（TASK-004）；c87a141 为 REVIEW_2 交接。复审差异 c263610..c87a141；TASK-001/002 原实现含恢复基线，必要时核对 main..c87a141 和当前完整应用。不要只看新增回归或交接摘要。

D01 已在角色规格与交接记录中裁决为方案 A：只禁用当前 Organization 的 Membership，不通过组织管理接口修改全局 User.status；撤销登录会话后，其他组织有效 Membership 重新登录仍可用。全局账号封禁管理平台不属 P0。无需重新询问 D01，但须验证实现和行为一致。

ZCode 记录 typecheck/build 通过、unit 14/14、integration 46/46、e2e 8/8、空库/已有库迁移及 Docker 依赖布局复现通过；上轮 Codex 仅做交接收尾，未重跑这些测试，未产生 REVIEW_2 结论。首轮日志只证明 c263610，不是修复后的独立通过证据。

逐项验证 H01–H10 与 D01，重点真实 HTTP/Cookie、多组织不同角色读写、Admin 拟授角色边界、成员禁用后的会话与其他组织、公开注册关闭及受控邀请/初始化、失败重试与并发恢复、审计故障事务回滚、AuditLog 同域约束、新空库及向前升级和时区语义。用隔离环境完成必要验证，避免破坏已有开发数据。

真实 Docker 干净构建/启动仍无实测证据，不能把依赖布局复现当作容器验证；环境不具备时明确缺口及对 Gate 的影响。M01–M04 延期是 ZCode 建议，尚未获独立复审认可；按风险和 P0 范围核定处理时点，不能自动排入 TASK-005 或自行扩范围。

输出逐项复核依据、真实执行结果、未运行原因与剩余问题；按项目协议给出 PASS / FAIL / BLOCKED，测试、审查、Owner 放行、GitHub 同步、部署和真实试用分开记录。FAIL 交 ZCode 修复，缺证据明确补证，PASS 后仍等 Owner 放行；本轮不执行合并或新 Phase。

收尾重新读取磁盘最新进度，更新原 12_PROGRESS.md 的任务表、当前摘要、唯一状态块及 CODEX_REVIEW_HANDOFF.md，保留历史，设置实际下一工具/完整提示词/完成标准/Checkpoint。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目 00_START_HERE.md/.html 与总控 00_CONTROL_CENTER/PROJECTS.md，确认一致。用户明确只读时不写回或刷新。
```
