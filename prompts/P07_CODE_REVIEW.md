# Gate 01 下一轮独立复审预备提示词 · 收敛验收

当前仍待ZCode修复；本提示词供新候选交付后使用，不代表已修复、已冻结或已开始下一轮审查。以下首个text块有效，末尾保留R4原提示词。

```text
请对AI电商运营助手Gate 01下一轮修复候选做独立复审，只审Phase1/TASK-001–004，不改业务代码、不开始TASK-005、不提交/推送/合并或部署。
项目根目录/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用为其下ai-ecommerce-assistant。
先读AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md及配置指定的唯一进度、任务合同、决策、阶段计划和CODEX_REVIEW_HANDOFF.md。再完整读取docs/reviews/GATE_01_CLOSURE_PLAN_2026-09-14.md、CODEX_REVIEW_GATE_01_REVIEW_4_2026-09-14.md、GATE_01_REVIEW_4_EVIDENCE_2026-09-14.json和gate-01-review-4-evidence/README.md，以及执行者本轮提交/测试证据。
先查实际分支、HEAD、未提交差异和候选是否真的交付。前一审查冻结858c20ab9645b494840b219f0b39b01c39023291；本轮范围858c20a..实际新候选；main最后核验2a983cc。当前基线BLOCKED，HIGH H12及MEDIUM M03/M04/M06/M07。没有新的修复候选时如实报告仍待修复，不把相同版本重新跑测试当成新一轮通过。保留所有在途管理文档，不reset/clean。

按关闭矩阵独立验收：
1. H12：原始SQL epoch与ORM/API绝对时刻一致；默认UTC和非UTC数据库、多连接及当前Web/Worker/脚本连接；有效邀请成功、48小时到期与报告49小时前创建的已过期邀请均拒绝且不签发会话。会话等现有时间消费者按真实驱动核查；不盲目平移历史数据、不改店铺时区。
2. M03：当前邀请创建/预览/接受/撤销覆盖清单完整，限流/会话/服务异常稳定返回JSON/request_id；无部分提交；通过项保留。
3. M04：28张领域表全量枚举与非法ID阻断、正常ID通过、旧库坏行守卫，框架四表和辅助表单独说明。
4. M06：首次/重复upTo不越界、不存在目标明确失败；官方迁移接续正常。
5. M07：真实Prisma差异不意外删除审计复合FK；不能表达的自定义SQL逐条说明维护方式；保留H08双向并发、删除及旧库守卫。

复审以本轮差异、五项反例和受影响边界为主。H08/H11及M01/M02/M05等已关闭项无触发原因不反复重开；涉及共同连接、迁移或测试清理时保留对应回归。必要检查由Reviewer独立运行，不能只读ZCode全绿日志。H12/M04/M07影响本轮连接与迁移，运行相称完整回归、真实容器、空库/858c20a旧库升级/重复/坏行检查；更早未改升级链可引用已冻结证据并写适用条件。不要重复无关实验，也不能为赶进度省略受影响验证。
新问题必须给出位置、可复现证据、影响、原合同依据及本轮改动关系；真实CRITICAL/HIGH仍阻断，MEDIUM按原严重级别和期限明确核定，不临时升级风格要求或批准无期限延期。D01方案A不变，无需再问。

按既定15节格式输出正式报告；逐项区分PASS/FAIL/BLOCKED、已关闭、未处理、合理延期及未运行原因。无未关闭CRITICAL/HIGH、TASK合同与必要证据满足后才可技术PASS；通过后仍等Owner明确阶段放行。
收尾重读最新12_PROGRESS.md，更新原任务表、摘要、唯一状态块和CODEX_REVIEW_HANDOFF，保留历史；按实际结果设置下一工具和提示词。执行/usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync，读回项目首页MD/HTML完整提示词和总控PROJECTS.md/HTML。用户明确只读时仅输出待写回内容。本轮不推进下一Phase。
```

---

## 历史：R4审查时的P07全文

# Gate 01 第四轮独立复审 · Codex 接手提示词

```text
请接手 AI 电商运营助手的 CODEX_REVIEW_GATE_01_REVIEW_4，只做 Phase 1（TASK-001–004）的独立复审，不修改业务代码、不推进 TASK-005、不合并 main 或部署。

项目根目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发；应用目录：/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant；总控：/Users/yuyuyu/Documents/AI-Workspace。

先显式读取根目录 AGENTS.md、.product-os.json、docs/STATE_PROTOCOL.md、00_START_HERE.md；按配置读取 docs/ai-ecommerce-assistant/12_PROGRESS.md（唯一进度）、09_TASKS.md、DEVELOPMENT_HANDOFF.md、FINAL_DECISIONS.md、PHASE_PLAN.md、CODEX_REVIEW_HANDOFF.md，以及本轮修复依据 docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_3_2026-09-14.md、GATE_01_REVIEW_3_EVIDENCE_2026-09-14.json 与 gate-01-review-3-evidence/README.md。按需读取角色、数据模型（04_DATA_MODEL"复合(org_id,id)外键"条款）、API 和验收原文。

本次交接核对状态：Phase 1 / TASK-004 / 待审查（Gate01 REVIEW_4 待复审） / Checkpoint=YES / 下一工具 Codex。分支 phase/01-foundation；上一审查冻结 9a5798ccdfad1be1e60d2df4dce9f9c189f85b93；本轮待审提交 e293b2e（推送后以实际远端为准）；main 基线 2a983cc55f136abbb49c5d02b55c1cb82b6547cc。先重查 HEAD、分支、未提交差异及是否另有执行者；保留未提交管理文档，版本变化则重定范围。

审查历史：首轮 c263610 BLOCKED→R2 c87a141 FAIL（4H）→R3 9a5798c BLOCKED（H08/H11 + M01–M06）。ZCode 已修复，提交链 9a5798c..e293b2e：936387a（TASK-002 H08 复合外键 + M04 UUID 主键约束）、ba12ad3（TASK-002 测试 H11 隔离 + M06）、9ef85bd（TASK-003/004 M01/M02/M03）、e293b2e（TASK-001 M05）。复审以 9a5798c..e293b2e 差异为主，必要时核对全量。已通过的 H01–H07/H09/H10/D01 保留回归即可，不重新开发。

重点逐项验证：
1. H08（复合外键）：新迁移 20260914150000_p0_audit_store_composite_fk——audit_log(org_id,store_id)→store(org_id,id)（ON DELETE SET NULL (store_id)，复用 store_org_id_id_key）。请用独立 PG 双连接复跑 R3 反例时序（T1 改 store.org_id 未提交/T2 插旧组织审计引用，及相反顺序），确认至少一方拒绝、最终 cross_org=0；核对坏行守卫保留、v1/v2 触发器保留、不改写历史。
2. H11（测试隔离）：七套件已无 datname LIKE 'aiea_%' 模糊 pg_terminate_backend；测试库唯一命名 aiea_t_<tag> 仅自管理；基线经 vitest.config 的 AIEA_TEST_BASE_DB 固化（进程 DATABASE_URL 注入优先，不被 .env 或先跑文件覆盖）。请用独立可丢弃整集群验证：旁观库连接与在途事务在完整套件运行前后保持有效，再核全套件结果。
3. M01/M02/M03（邀请入口）：DELETE 接 guardWrite（无 body/无 Origin 合法调用保留）；clientIpFromRequest 统一 TRUST_PROXY_HEADERS 边界（关信任时伪造 X-Forwarded-For 不能换限流桶）；创建/接受/撤销 Zod 严格校验、DELETE 正整数 expected_version、接受区分合法空 body 与非法 JSON；internalFailure 日志与响应共用 request_id。
4. M04：领域 17 表主键 UUID CHECK（NOT VALID→VALIDATE）随 H08 迁移落地；认证框架 string ID 保持。
5. M05：src/lib/dbUrl.ts 分量组装+encodeURIComponent；compose 三服务同一 POSTGRES_PASSWORD；请以全新数据卷+非默认（可含 URL 保留字符）口令复跑启动/迁移/初始化/登录，并核对默认口令回归。
6. M06：_prisma_migrations 官方列补齐；官方 migrate deploy 空库/重复/4→8 升级/坏行 P3018 拒绝四项检查建议在 /tmp 工作副本复跑（本机 iCloud 目录下 node_modules 可能被驱逐导致 CLI 同步 read 挂死——ZCode 查明的根因，sample 栈卡 uv_fs_read；这不要求在本机 iCloud 路径下复跑）。
7. 迁移链：空库 8 迁移、c87a141 四→八升级、重复 deploy、坏行拒绝（如环境允许）；pgMigrate 辅助器的测试用途限定与 upTo 语义。

环境事实：ZCode 本轮全部验证使用独立可丢弃集群（127.0.0.1:5434 /tmp initdb，已清理）；ZCode 记录 typecheck 0 错、unit 18/18、integration 60/60、build exit 0、e2e 8/8（注入同一独立集群，保留一次历轮一致 ECONNRESET）；e2e 首跑因种子库未迁移失败一次后补迁移通过（已如实记录）；gate01.db 并发测试首版自死锁已改为与反例一致的"先挂起 promise→对端提交→断言"写法（已如实记录）。执行偏差请按报告惯例区分产品缺陷与执行偏差。

输出逐项复核依据、真实执行结果、未运行原因与剩余问题；按项目协议给出 PASS / FAIL / BLOCKED，测试、审查、Owner 放行、GitHub 同步、部署和真实试用分开记录。FAIL 交 ZCode 修复，缺证据明确补证，PASS 后仍等 Owner 放行；本轮不执行合并或新 Phase。

收尾重新读取磁盘最新进度，更新原 12_PROGRESS.md 的任务表、当前摘要、唯一状态块及 CODEX_REVIEW_HANDOFF.md，保留历史，设置实际下一工具/完整提示词/完成标准/Checkpoint。运行 /usr/bin/python3 /Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py sync 并读回项目 00_START_HERE.md/.html 与总控 00_CONTROL_CENTER/PROJECTS.md，确认一致。用户明确只读时不写回或刷新。
```
