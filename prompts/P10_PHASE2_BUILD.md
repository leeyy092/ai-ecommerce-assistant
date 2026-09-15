# Phase 2 数据接入基础 · 开发执行提示词（TASK-005–007 · ZCode）

Phase 内常规开发；GATE_02 时更新本文件为下一环节。当前有效指令如下。

```text
请接手 AI 电商运营助手 Phase 2（数据接入基础）开发。项目根目录 /Users/yuyuyu/Documents/ChatGPT/产品-开发，应用在其下 ai-ecommerce-assistant，总控 /Users/yuyuyu/Documents/AI-Workspace。

先显式读取根目录 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、唯一进度 docs/ai-ecommerce-assistant/12_PROGRESS.md、09_TASKS.md、11_DEVELOPMENT_RULES.md、DEVELOPMENT_HANDOFF.md、PHASE_PLAN.md、FINAL_DECISIONS.md。Gate 01 已由 Owner 放行（32fb0d3，REVIEW_5 PASS）；当前分支 phase/02-data-ingestion（自 main 创建），Checkpoint=NO，Phase 内连续执行 TASK-005→007，TASK-007 完成后停在 CODEX_REVIEW_GATE_02。

约束：一次只推进一个 TASK；每个 TASK 按原合同实现、测试、以含 TASK 编号的提交、更新唯一进度；不在 main 开发、不 force push、不重写共享历史；已关闭问题（H01–H12、M01–M06、L01、D01 方案 A）不对同一版本返修；涉及 audit_log/store 迁移时遵守 M07 自定义外键维护约定（人工核对 + H08 并发/删除回归）；不扩大 P0、不换技术栈、不做无关重构；不部署。

TASK-005 店铺与数据源配置、TASK-006 统一 Adapter 与最小黄金样本、TASK-007 文件上传、私有存储与 ImportTask——实现前读取 09_TASKS 对应合同原文、04_DATA_MODEL 实体定义、08_API_SPEC 接口契约与验收标准（10_ACCEPTANCE_CRITERIA）；数据库变更使用新增迁移（遵守既有 TIMESTAMPTZ/UUID 领域主键/复合外键约定，官方 migrate deploy 可接续）；测试沿用现有 vitest 结构与独立可丢弃集群；身份/权限/审计/错误信封复用 Phase 1 既有设施（guardWrite、requirePermission、writeAudit、internalFailure、clientIpFromRequest）。

每 TASK 完成后输出固定格式汇报（TASK/状态/本次完成/修改文件/测试结果/当前 Phase/Checkpoint/下一步），更新 12_PROGRESS 并运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 读回首页与总控。遇到产品规则待决策（GPT_PRODUCT_DECISION_REQUIRED）或实质阻塞时停止并说明具体问题。
```
