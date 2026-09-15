# Gate 02 后续独立复审入口

2026-09-16：ZCode 已完成 GATE_02 修复，新冻结 **b2fa10f**（已推送）。下方首个 text 块为本轮（ce5f286..b2fa10f）独立复审完整提示词；2026-09-15 对 ce5f286 的 FAIL 审查结论保留为历史。

```text
请接手 AI 电商运营助手 GATE_02 修复后的独立复审，范围仅 Phase 2 / TASK-005–007 的修复差异，不改业务代码、不推进 TASK-008、不合并 main、不部署。

项目根目录 /Users/yuyuyu/Documents/ChatGPT/产品-开发，应用在其下 ai-ecommerce-assistant，总控 /Users/yuyuyu/Documents/AI-Workspace。
依次读 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md、唯一进度 docs/ai-ecommerce-assistant/12_PROGRESS.md（含"GATE_02 修复轮执行记录"）、CODEX_REVIEW_HANDOFF.md 顶部交接、09_TASKS 005–007、08_API_SPEC、04_DATA_MODEL、02_USER_ROLES、11_DEVELOPMENT_RULES、DEVELOPMENT_HANDOFF、PHASE_PLAN、FINAL_DECISIONS。
上一轮正式报告 docs/reviews/CODEX_REVIEW_GATE_02_2026-09-15.md（FAIL，G2-H01–H09/M01–M04/L01–L02）、GATE_02_EVIDENCE_2026-09-15.json 与 gate-02-evidence/ 及其反例继续有效。

实际冻结：phase/02-data-ingestion = b2fa10f（本地/远端已推送）；main = 4c7e95b 未合并。本轮复审范围 **ce5f286..b2fa10f**，修复提交链 5690395→286527d→1c8909c→13c95e4→36e7764→da6de14→9263890→7616c4c→b2fa10f。开始重查 HEAD、未提交差异与其他执行者；保护原报告/证据/管理文档。

逐项复核上轮关闭标准（G2-H01–H09）与本轮修复声明：
1. H01 coverage：服务端 DISTINCT ON 有效版本（dataset_version 最高）后按角色可见类型汇总；C 仅消息；last_import_at 按可见类型；from/to 严格日历、右开、90 天、非法 422。
2. H02 店铺 CAS：版本条件在 UPDATE WHERE 内原子裁决；并发同版本恰一 200 一 409；事实锁与审计同事务不回退。
3. H03 解析：csv-parse 严格 RFC4180（未闭合引号/列数不匹配整文件拒）；金额整数≤14 位；SafeInteger 前置；RFC3339 带时区+真实日历；source_updated_at 必填不补造（含 Worker 不传任务时间）；必填枚举不兜底；可选列缺列合法；completed_at≥occurred_at；重复表头拒。
4. H04：CanonicalBatch typed 合同（store_id 服务端赋值/namespace/adapter_version/raw_checksum/coverage_declaration）+ createCanonicalBatch 校验；黄金 A M3=false、B null；两店独立覆盖声明 fixture；手写规范 oracle，CSV≡oracle 且 Mock≡oracle（不再以两入口相等当正确）。
5. H05 权限链：任务查询/文件下载=全员能力+canImport(role,sourceKind)（C 消息可读/下载，C 订单 403，跨组织 404）；Worker 执行前重查发起人有效 Membership 与类型权限（失权终态 UPLOAD_PERMISSION_REVOKED）。
6. H06 真流式：busboy 流式 multipart；字节/CSV 逻辑记录（quoted 换行按单条）限额在接收链路即时生效，超限销毁上游立即响应；失败清理临时对象；真实分块不闭合流测试。
7. H07 幂等：部分唯一索引原子认领（并发同内容恰一任务）；HTTP Idempotency-Key 头按 org/user/endpoint 存档 24h、同 key 异 body 409、重放 201；multipart 字段不冒充。
8. H08 恢复：文件先落位后建账（无空键任务可复用）；孤儿清理；outbox=pending+dispatcher 周期补投；悬挂 validating 落终态；文件缺失/重试耗尽终态；终态重投幂等跳过。
9. H09 私有运行配置：web/worker 共享 private-data 卷；.data Git/Docker 排除；真实隔离 Compose 文件链证据（canary 不进镜像、上传→Worker→下载→重启读回）。
M/L 核定：M01 entity_type+响应字段；M02 org+name 唯一+409；M03 .csv 415/严格 UTF-8 422/F10 上传限流；M04 可测试 OSS 适配（ali-oss 注入式单测；真实云端联调缺资源未执行——请核定该剩余范围的处理是否可接受，ZCode 未自行宣布延期获批）；L01 删除重复副本；L02 签名 300 秒。

新增事实请核定：新迁移 2 个（store(org_id,name) 唯一；import_task 部分唯一认领索引+http_idempotency 表，部分索引为自定义 SQL，沿 M07 式维护约定）；新依赖 csv-parse/busboy/ali-oss；Schema 新约束触发的 Phase 1 两处测试适配（H08 夹具改名、迁移计数 10→12）；build:scripts 产出 dist/scripts（容器内无 pnpm 联网场景）。已接受执行偏差（pg-boss 批数组、esbuild shim、guardWrite multipart 同源）不重复计缺陷。

验证必须在 /tmp 可丢弃工作副本、独立 PG 集群执行，不依赖 ZCode 全绿日志或探针 exit0；给出有证据的 PASS/FAIL/BLOCKED 与正式报告，保留本轮报告历史。Phase1 关闭项不重开（仅 Schema 触发适配已说明）；D01 方案 A 不重问；完整 mapping/提交/聚合/UI 按原任务不抢跑 008。FAIL 回 ZCode；PASS 仍等 Owner 明确说"放行 Phase 2"。按协议更新唯一进度/任务表/状态块/交接与完整提示词，运行 Product OS sync 并读回首页 md/html 与总控 PROJECTS；测试、审查、Owner、GitHub、部署分开记录。
```

---

## 历史：2026-09-15 首次 GATE_02 接手提示词原文

# CODEX_REVIEW_GATE_02 · Phase 2 独立复审 · Codex 接手提示词

```text
请接手 AI 电商运营助手的 CODEX_REVIEW_GATE_02，只做 Phase 2（TASK-005–007）的独立复审，不修改业务代码、不推进 TASK-008、不合并 main 或部署。

项目根目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant；总控：/Users/yuyuyu/Documents/AI-Workspace。

先显式读取根目录 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md；按配置读取 docs/ai-ecommerce-assistant/12_PROGRESS.md（唯一进度）、09_TASKS.md（TASK-005–007 合同原文）、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md、CODEX_REVIEW_HANDOFF.md（顶部 GATE_02 交接与关闭约定）。Phase 1 基线：REVIEW_5 PASS、Owner 已放行 32fb0d3；其已关闭问题（H01–H12、M01–M06、D01 方案 A）不重开，仅当本轮改动触发相关边界时核对对应回归。

本次交接核对状态：Phase 2 / TASK-005–007 完成 / GATE_02 待复审 / Checkpoint=YES。分支 phase/02-data-ingestion；main 基线 4c7e95b（Phase 1 合并结果）；复审差异 **4c7e95b..4e44270**（f51ed41 TASK-005 店铺与数据源、7583ed7 TASK-006 统一 Adapter 与黄金样本、6d1928c TASK-007 上传/私有存储/ImportTask/pg-boss）。先重查 HEAD、分支、未提交差异及是否另有执行者；版本变化则重定范围。

重点逐项验证：
1. TASK-005：店铺创建/列表/改名/归档（08_API_SPEC 31–35 行契约）；事实锁——注入任一事实行后 PATCH currency/timezone 必须 409 STORE_CONFIG_LOCKED 且改名/归档不受限；demo_mode 继承组织；409 同名/同外部标识；platform 仅标签（响应无 connected/provider 字段）；归档店拒绝数据源；mock 源仅演示店；GET data-sources 按角色裁剪（C 仅 customer_messages）+ mapping_version + coverage 摘要 + last_import_at；store_create/store_update/data_source_create 审计同事务。
2. TASK-006：contracts.ts 六类标准记录与纯解析（无 DB 访问）；用 tests/fixtures/golden 独立复跑——同一逻辑数据 CSV 与 Mock 标准记录一致、ID 前导零保留、BOM/quoted 逗号换行/空值三态/日期金额边界/unsupported 类型/STORE_MISMATCH 整文件拒绝；确认无 Excel 解析器、无直连业务库。
3. TASK-007：私有存储根不在 public（客户消息文件不落静态目录）；角色文件类型限制（C 订单文件 403、C 客户消息 201）；20MB/10 万行超限即停止（422 FILE_TOO_LARGE/TOO_MANY_ROWS）；幂等（同内容重复请求返回同任务）；任务查询；签名下载（未签名/过期 403、正确签名 200 内容一致）；pg-boss import-validate 真实解析统计（preview_ready/failed + 私有错误对象）与 import-commit 显式拒绝边界；归档店/mock 源拒绝上传；guardWrite multipart 放行的边界说明。
4. 迁移：Phase 2 无新增 Schema 迁移（10 迁移链沿用 Gate 01 收敛冻结证据，可引用并说明适用条件）；M07 约定持续有效（无 audit_log 外键变更）。

环境事实：ZCode 全部验证在独立可丢弃集群（/tmp initdb PG 17）与 /tmp 工作副本执行（主副本 iCloud dataless 挂死规避，样本栈卡 uv_fs_read 为既往已证机制）；ZCode 记录 typecheck 0 错、unit 49/49、integration 82/82、web/worker build exit 0、worker 队列就绪冒烟、e2e 8/8。执行偏差：pg-boss 12 work handler 批处理数组语义、esbuild import.meta.url banner+define shim（已固化 build:worker）、guardWrite multipart 放行——请按产品缺陷与执行偏差区分核定。

输出逐项复核依据、真实执行结果、未运行原因与剩余问题；按项目协议给出 PASS / FAIL / BLOCKED，测试、审查、Owner 放行、GitHub 同步、部署和真实试用分开记录。FAIL 交 ZCode 修复；PASS 后仍等 Owner 阶段放行；本轮不执行合并或新 Phase。

收尾重新读取磁盘最新进度，更新原 12_PROGRESS.md 的任务表、当前摘要、唯一状态块及 CODEX_REVIEW_HANDOFF.md，保留历史，设置实际下一工具/完整提示词/完成标准/Checkpoint。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目 00_START_HERE.md/.html 与总控 00_CONTROL_CENTER/PROJECTS.md，确认一致。用户明确只读时不写回或刷新。
```
