<!-- PRODUCT_OS_GENERATED: regenerate from project progress; do not edit -->
# 电商中台 · AI 电商运营助手 · 我现在做什么

> 自动生成视图。改进度主记录后运行刷新，不在此单独改状态。

| 你要知道的事 | 当前记录 |
|---|---|
| 最终目标 | 让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动 |
| 当前阶段 | 07 阶段审查 · Phase 2 数据接入基础 · GATE_02 复修完成待复审 |
| 当前任务 | TASK-007 |
| 当前状态 | 待审查 |
| 上一个完成项 | ZCode 完成 GATE_02 全部修复：G2-H01–H09 关闭，M01–M04/L01–L02 逐项处理；新冻结 b2fa10f 已推送 |
| 下一步 | Codex 对 ce5f286..b2fa10f 独立复审（prompts/P07_CODE_REVIEW.md 首个 text 块）；PASS 后等 Owner 明确放行 Phase 2 |
| 交给谁 | Codex |
| 做到什么算完成 | 正式报告第13节九项HIGH关闭标准逐项复核：客服投影/原子CAS/解析边界/CanonicalBatch与覆盖声明/权限链/真流式限额/幂等/失败恢复/私有容器链；M/L逐项核定；独立PASS后Owner另行放行 |
| 卡点 | 无技术阻塞；等待Codex独立复审；未合并main、未部署、未开始TASK-008；OSS真实云端联调缺云资源如实记录（非获批延期） |
| 检查点 | YES |
| 审查 | GATE_02 首轮 FAIL（ce5f286，9H/4M/2L）已按 P08 修复；新冻结 b2fa10f，范围 ce5f286..b2fa10f；待独立复审 |
| 进度最后更新 | 2026-09-16T02:30:00+08:00 |

项目绝对路径：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`

## 复制这一段，交给 Codex

```text
当前项目：/Users/yuyuyu/Documents/ChatGPT/产品-开发
产品目标：让受邀企业导入 CSV，在一页看到可信经营摘要、异常、客户反馈与有证据的今日行动
当前任务：TASK-007
本轮动作：Codex 对 ce5f286..b2fa10f 独立复审（prompts/P07_CODE_REVIEW.md 首个 text 块）；PASS 后等 Owner 明确放行 Phase 2

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

## 技术状态（各自独立）

- Git：已建立本地 Git；存在未提交或未跟踪内容。
- 分支：phase/02-data-ingestion；版本：b2fa10fa7dd8a8448bcac8f9064a520faeb59cfd。
- origin：ssh://github.com/leeyy092/ai-ecommerce-assistant.git（仅配置，不能证明已推送）。
- GitHub：phase/02-data-ingestion 本地/远端=b2fa10f（已推送）；main=4c7e95b 未合并；管理文档本轮变更待 Codex 接手核对；最后核验：2026-09-16T02:30:00+08:00；地址：https://github.com/leeyy092/ai-ecommerce-assistant；证据：git push 输出 7616c4c..b2fa10f；实际推送记录见执行记录。
- 部署：未部署（本轮授权不含部署）；最后核验：从未核验；地址：未记录；证据：TASK-029 试点运行与运维要求另计。

刷新前本地快照时间：2026-09-16T01:38:56+08:00。远端与部署是最后核验的记录，未由此次刷新联网重验。

[进度主记录](docs/ai-ecommerce-assistant/12_PROGRESS.md) · [完整提示词库](prompts/README.md) · [返回总控](../../AI-Workspace/00_CONTROL_CENTER/index.html)
