<!-- PRODUCT_OS_GENERATED: regenerate from project progress; do not edit -->
# 电商中台 · AI 电商运营助手 · 我现在做什么

> 自动生成视图。改进度主记录后运行刷新，不在此单独改状态。

| 你要知道的事 | 当前记录 |
|---|---|
| 最终目标 | 让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动 |
| 当前阶段 | 08 任务推进 · Phase 2 数据接入基础（005–007） |
| 当前任务 | TASK-005 |
| 当前状态 | 进行中 |
| 上一个完成项 | Gate 01 全链路收官：REVIEW_5 PASS 且 Owner 放行 Phase 1（32fb0d3）；已合并 main 并自 main 创建 phase/02-data-ingestion |
| 下一步 | TASK-005 店铺与数据源配置：按 09_TASKS 原合同实现、测试、提交、更新唯一进度；完成后连续推进 006/007，007 后停在 GATE_02 交 Codex |
| 交给谁 | ZCode |
| 做到什么算完成 | TASK-005–007 逐项按 09_TASKS 合同实现并通过其指定检查；每 TASK 单独提交（含 TASK 编号）并更新进度；007 完成后冻结交 Codex GATE_02 复审 |
| 卡点 | 无（Phase 内常规事项无需逐项向 Owner 确认；产品规则待决策或实质阻塞时再上报） |
| 检查点 | NO |
| 审查 | Gate 01 五轮全链路收官：首轮BLOCKED(10H)→R2 FAIL(4H)→R3 BLOCKED→R4 BLOCKED→R5 PASS；Owner 已放行 32fb0d3 |
| 进度最后更新 | 2026-09-14T23:45:00+08:00 |

项目绝对路径：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`

## 复制这一段，交给 ZCode

```text
当前项目：/Users/yuyuyu/Documents/ChatGPT/产品-开发
产品目标：让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动
当前任务：TASK-005
本轮动作：TASK-005 店铺与数据源配置：按 09_TASKS 原合同实现、测试、提交、更新唯一进度；完成后连续推进 006/007，007 后停在 GATE_02 交 Codex

请接手 AI 电商运营助手 Phase 2（数据接入基础）开发。项目根目录 /Users/yuyuyu/Documents/ChatGPT/产品-开发，应用在其下 ai-ecommerce-assistant，总控 /Users/yuyuyu/Documents/AI-Workspace。

先显式读取根目录 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、唯一进度 docs/ai-ecommerce-assistant/12_PROGRESS.md、09_TASKS.md、11_DEVELOPMENT_RULES.md、DEVELOPMENT_HANDOFF.md、PHASE_PLAN.md、FINAL_DECISIONS.md。Gate 01 已由 Owner 放行（32fb0d3，REVIEW_5 PASS）；当前分支 phase/02-data-ingestion（自 main 创建），Checkpoint=NO，Phase 内连续执行 TASK-005→007，TASK-007 完成后停在 CODEX_REVIEW_GATE_02。

约束：一次只推进一个 TASK；每个 TASK 按原合同实现、测试、以含 TASK 编号的提交、更新唯一进度；不在 main 开发、不 force push、不重写共享历史；已关闭问题（H01–H12、M01–M06、L01、D01 方案 A）不对同一版本返修；涉及 audit_log/store 迁移时遵守 M07 自定义外键维护约定（人工核对 + H08 并发/删除回归）；不扩大 P0、不换技术栈、不做无关重构；不部署。

TASK-005 店铺与数据源配置、TASK-006 统一 Adapter 与最小黄金样本、TASK-007 文件上传、私有存储与 ImportTask——实现前读取 09_TASKS 对应合同原文、04_DATA_MODEL 实体定义、08_API_SPEC 接口契约与验收标准（10_ACCEPTANCE_CRITERIA）；数据库变更使用新增迁移（遵守既有 TIMESTAMPTZ/UUID 领域主键/复合外键约定，官方 migrate deploy 可接续）；测试沿用现有 vitest 结构与独立可丢弃集群；身份/权限/审计/错误信封复用 Phase 1 既有设施（guardWrite、requirePermission、writeAudit、internalFailure、clientIpFromRequest）。

每 TASK 完成后输出固定格式汇报（TASK/状态/本次完成/修改文件/测试结果/当前 Phase/Checkpoint/下一步），更新 12_PROGRESS 并运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 读回首页与总控。遇到产品规则待决策（GPT_PRODUCT_DECISION_REQUIRED）或实质阻塞时停止并说明具体问题。
```

## 技术状态（各自独立）

- Git：已建立本地 Git；存在未提交或未跟踪内容。
- 分支：phase/01-foundation；版本：32fb0d3e8ad19b691cf66006638a418ca949e2a4。
- origin：ssh://github.com/leeyy092/ai-ecommerce-assistant.git（仅配置，不能证明已推送）。
- GitHub：main=Phase 1 合并结果（32fb0d3+merge）；phase/02-data-ingestion 自 main 创建并推送；phase/01-foundation 保留；最后核验：2026-09-14T23:45:00+08:00；地址：https://github.com/leeyy092/ai-ecommerce-assistant；证据：git push 后 ls-remote 核验三分支。
- 部署：未部署（本次 Owner 指令明确不授权部署）；最后核验：2026-09-14T23:45:00+08:00；地址：未记录；证据：P0 后续 TASK-029 试点运行与运维要求另计。

刷新前本地快照时间：2026-09-15T11:39:35+08:00。远端与部署是最后核验的记录，未由此次刷新联网重验。

[进度主记录](docs/ai-ecommerce-assistant/12_PROGRESS.md) · [完整提示词库](prompts/README.md) · [返回总控](../../AI-Workspace/00_CONTROL_CENTER/index.html)
