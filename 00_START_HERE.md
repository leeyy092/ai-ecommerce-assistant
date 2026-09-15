<!-- PRODUCT_OS_GENERATED: regenerate from project progress; do not edit -->
# 电商中台 · AI 电商运营助手 · 我现在做什么

> 自动生成视图。改进度主记录后运行刷新，不在此单独改状态。

| 你要知道的事 | 当前记录 |
|---|---|
| 最终目标 | 让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动 |
| 当前阶段 | 07 阶段审查 · Phase 2 数据接入基础 · GATE_02 待复审 |
| 当前任务 | TASK-007 |
| 当前状态 | 待审查 |
| 上一个完成项 | Gate 01 全链路收官：REVIEW_5 PASS 且 Owner 放行 Phase 1（32fb0d3）；已合并 main 并自 main 创建 phase/02-data-ingestion |
| 下一步 | Codex GATE_02 独立复审（TASK-005–007：店铺/数据源配置、统一 Adapter 黄金样本、上传/私有存储/ImportTask/pg-boss 边界）；PASS 后仍等 Owner 阶段放行 |
| 交给谁 | Codex |
| 做到什么算完成 | 三 TASK 合同验收达成：事实锁/归档拒绝/角色裁剪；CSV与Mock标准记录一致/前导零；超限停止/C 不传订单/重复同任务/私有存储+签名下载/pg-boss 边界；82/82+49/49+build+e2e 8/8；复审 PASS 后等 Owner |
| 卡点 | 待 Codex GATE_02 复审；无 Owner 放行；不合并 main、不部署、不开始 TASK-008 |
| 检查点 | YES |
| 审查 | Gate 01 五轮全链路收官：首轮BLOCKED(10H)→R2 FAIL(4H)→R3 BLOCKED→R4 BLOCKED→R5 PASS；Owner 已放行 32fb0d3 |
| 进度最后更新 | 2026-09-15T13:20:00+08:00 |

项目绝对路径：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`

## 复制这一段，交给 Codex

```text
当前项目：/Users/yuyuyu/Documents/ChatGPT/产品-开发
产品目标：让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动
当前任务：TASK-007
本轮动作：Codex GATE_02 独立复审（TASK-005–007：店铺/数据源配置、统一 Adapter 黄金样本、上传/私有存储/ImportTask/pg-boss 边界）；PASS 后仍等 Owner 阶段放行

请接手 AI 电商运营助手的 CODEX_REVIEW_GATE_02，只做 Phase 2（TASK-005–007）的独立复审，不修改业务代码、不推进 TASK-008、不合并 main 或部署。

项目根目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant；总控：/Users/yuyuyu/Documents/AI-Workspace。

先显式读取根目录 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md；按配置读取 docs/ai-ecommerce-assistant/12_PROGRESS.md（唯一进度）、09_TASKS.md（TASK-005–007 合同原文）、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md、CODEX_REVIEW_HANDOFF.md（顶部 GATE_02 交接与关闭约定）。Phase 1 基线：REVIEW_5 PASS、Owner 已放行 32fb0d3；其已关闭问题（H01–H12、M01–M06、D01 方案 A）不重开，仅当本轮改动触发相关边界时核对对应回归。

本次交接核对状态：Phase 2 / TASK-005–007 完成 / GATE_02 待复审 / Checkpoint=YES。分支 phase/02-data-ingestion；main 基线 4c7e95b（Phase 1 合并结果）；复审差异 **4c7e95b..6d1928c**（f51ed41 TASK-005 店铺与数据源、7583ed7 TASK-006 统一 Adapter 与黄金样本、6d1928c TASK-007 上传/私有存储/ImportTask/pg-boss）。先重查 HEAD、分支、未提交差异及是否另有执行者；版本变化则重定范围。

重点逐项验证：
1. TASK-005：店铺创建/列表/改名/归档（08_API_SPEC 31–35 行契约）；事实锁——注入任一事实行后 PATCH currency/timezone 必须 409 STORE_CONFIG_LOCKED 且改名/归档不受限；demo_mode 继承组织；409 同名/同外部标识；platform 仅标签（响应无 connected/provider 字段）；归档店拒绝数据源；mock 源仅演示店；GET data-sources 按角色裁剪（C 仅 customer_messages）+ mapping_version + coverage 摘要 + last_import_at；store_create/store_update/data_source_create 审计同事务。
2. TASK-006：contracts.ts 六类标准记录与纯解析（无 DB 访问）；用 tests/fixtures/golden 独立复跑——同一逻辑数据 CSV 与 Mock 标准记录一致、ID 前导零保留、BOM/quoted 逗号换行/空值三态/日期金额边界/unsupported 类型/STORE_MISMATCH 整文件拒绝；确认无 Excel 解析器、无直连业务库。
3. TASK-007：私有存储根不在 public（客户消息文件不落静态目录）；角色文件类型限制（C 订单文件 403、C 客户消息 201）；20MB/10 万行超限即停止（422 FILE_TOO_LARGE/TOO_MANY_ROWS）；幂等（同内容重复请求返回同任务）；任务查询；签名下载（未签名/过期 403、正确签名 200 内容一致）；pg-boss import-validate 真实解析统计（preview_ready/failed + 私有错误对象）与 import-commit 显式拒绝边界；归档店/mock 源拒绝上传；guardWrite multipart 放行的边界说明。
4. 迁移：Phase 2 无新增 Schema 迁移（10 迁移链沿用 Gate 01 收敛冻结证据，可引用并说明适用条件）；M07 约定持续有效（无 audit_log 外键变更）。

环境事实：ZCode 全部验证在独立可丢弃集群（/tmp initdb PG 17）与 /tmp 工作副本执行（主副本 iCloud dataless 挂死规避，样本栈卡 uv_fs_read 为既往已证机制）；ZCode 记录 typecheck 0 错、unit 49/49、integration 82/82、web/worker build exit 0、worker 队列就绪冒烟、e2e 8/8。执行偏差：pg-boss 12 work handler 批处理数组语义、esbuild import.meta.url banner+define shim（已固化 build:worker）、guardWrite multipart 放行——请按产品缺陷与执行偏差区分核定。

输出逐项复核依据、真实执行结果、未运行原因与剩余问题；按项目协议给出 PASS / FAIL / BLOCKED，测试、审查、Owner 放行、GitHub 同步、部署和真实试用分开记录。FAIL 交 ZCode 修复；PASS 后仍等 Owner 阶段放行；本轮不执行合并或新 Phase。

收尾重新读取磁盘最新进度，更新原 12_PROGRESS.md 的任务表、当前摘要、唯一状态块及 CODEX_REVIEW_HANDOFF.md，保留历史，设置实际下一工具/完整提示词/完成标准/Checkpoint。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目 00_START_HERE.md/.html 与总控 00_CONTROL_CENTER/PROJECTS.md，确认一致。用户明确只读时不写回或刷新。
```

## 技术状态（各自独立）

- Git：已建立本地 Git；存在未提交或未跟踪内容。
- 分支：phase/02-data-ingestion；版本：6d1928cce68fd6b7f4758676e4e50f019c1d37da。
- origin：ssh://github.com/leeyy092/ai-ecommerce-assistant.git（仅配置，不能证明已推送）。
- GitHub：phase/02-data-ingestion 本地=6d1928c（推送后以 origin 为准）；main=Phase 1 合并 4c7e95b 未再合并；最后核验：2026-09-14T23:45:00+08:00；地址：https://github.com/leeyy092/ai-ecommerce-assistant；证据：git push 后 ls-remote 核验三分支。
- 部署：未部署（本次 Owner 指令明确不授权部署）；最后核验：2026-09-14T23:45:00+08:00；地址：未记录；证据：P0 后续 TASK-029 试点运行与运维要求另计。

刷新前本地快照时间：2026-09-15T13:01:16+08:00。远端与部署是最后核验的记录，未由此次刷新联网重验。

[进度主记录](docs/ai-ecommerce-assistant/12_PROGRESS.md) · [完整提示词库](prompts/README.md) · [返回总控](../../AI-Workspace/00_CONTROL_CENTER/index.html)
