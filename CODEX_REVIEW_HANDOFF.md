# CODEX_REVIEW_HANDOFF｜Gate01 REVIEW_3 修复完成，待 Codex 第四轮独立复审

日期：2026-09-14T18:35:00+08:00；执行者：ZCode。**Phase 1 / TASK-004 / 待审查（REVIEW_4 待复审）/ Checkpoint=YES / 下一工具 Codex。**

## 复审定位信息

| 项 | 值 |
|---|---|
| Current Branch | `phase/01-foundation` |
| Base Branch | `main`（`2a983cc55f136abbb49c5d02b55c1cb82b6547cc`，未合并） |
| Previous Review Commit（REVIEW_3 冻结） | `9a5798ccdfad1be1e60d2df4dce9f9c189f85b93` |
| Current Review Commit | `e293b2e`（4 个 fix 提交后冻结；handoff 提交随后推送） |
| Git Diff Range | `9a5798c..e293b2e`（936387a H08+M04 → ba12ad3 H11+M06 → 9ef85bd M01/M02/M03 → e293b2e M05） |
| Project Status | TASK-004 / 待审查（Gate 标识 REVIEW_4 待复审）；Checkpoint=YES；下一工具 Codex，prompts/P07_CODE_REVIEW.md |
| Working Tree | handoff 提交后 clean；接手时若 HEAD 变化先重定范围 |

## 本轮修复摘要（ZCode 执行，待独立复核）

| # | 修复 commit | 内容 |
|---|---|---|
| H08+M04 | 936387a (TASK-002) | 复合外键 audit_log(org_id,store_id)→store(org_id,id)（复用既有唯一索引、ON DELETE SET NULL (store_id)）；PG17 双连接交错实测两方向均拒绝、cross_org=0；坏行守卫保留；M04 同迁移为 17 张领域表主键加 UUID CHECK（认证四表保持框架 string） |
| H11+M06 | ba12ad3 (TASK-002 测试) | 删除 LIKE 'aiea_%' 模糊 kill；唯一命名 aiea_t_<tag> 测试库只自管理；基线 vitest 启动时求值经 AIEA_TEST_BASE_DB 固化（注入优先，不被 .env/先跑文件覆盖）；_prisma_migrations 补官方列；M06 根因查明（iCloud dataless 同步读挂死）+ 官方 CLI 四项检查 |
| M01/M02/M03 | 9ef85bd (TASK-003/004) | DELETE invitation 接 guardWrite；clientIpFromRequest 共享（TRUST_PROXY_HEADERS 边界覆盖邀请入口，换头不换桶）；邀请创建/接受/撤销 Zod 严格校验、DELETE 正整数版本、接受区分合法空 body、internalFailure 日志与响应共用 request_id |
| M05 | e293b2e (TASK-001) | src/lib/dbUrl.ts 统一连接串解析（PG* 分量组装+percent-encode）；compose 三服务引用同一 POSTGRES_PASSWORD；Dockerfile deps 补 COPY dbUrl.ts；真实容器双口令链路验证 |

## 关键证据

- **H08 并发**：PG 17 独立集群双连接交错——方向 A（改归属未提交→插旧组织审计）RI 等待父行锁后按最新快照拒绝；方向 B（插引用未提交→改归属）key-change 与 KEY SHARE 冲突+反向 RI 检查拒绝；两方向 cross_org=0。回归入 gate01.db（并发 A/B/删除/UUID 约束 4 例）。
- **H11 验收**：独立可丢弃集群（127.0.0.1:5434，/tmp initdb）上，旁观库 aiea_review_sentinel 连接与 BEGIN-INSERT-sleep(400s) 在途事务在集成运行前建立、跨越 60/60 全程后 COMMIT 成功、数据完好。
- **M06 官方 CLI 四项**（/tmp 工作副本，排除 iCloud dataless 影响）：空库 8 迁移 1.2s exit 0；重复 deploy No pending exit 0；c87a141 四迁移旧库→8 迁移 exit 0；坏行旧库 P3018+守卫报错拒绝 exit 1。根因：本机 CLI 空转=iCloud 驱逐 node_modules 后同步 read 挂死（sample 栈卡 uv_fs_read）。
- **M05 容器双路径**（colima，独立 compose 项目，全新数据卷，端口限回环）：特殊字符口令 `r4-p@ss w0rd:!/#?Xy` 与默认口令均为 up→健康 200→迁移 8 份→init-owner→登录 200→/me 200→公开注册 403→down --volumes。证据 docs/reviews/gate-01-r4-evidence/（20 文件；login.json 会话 token 提交前脱敏）。

## ZCode 记录的 Tests（2026-09-14 晚，独立集群）

| 套件 | 结果 |
|---|---|
| typecheck | ✅ 0 错误 |
| unit | ✅ 18/18（+4 dbUrl/env 组装） |
| integration（7 文件 60 例） | ✅ 60/60（+7 新回归：H08 并发 A/B、删除+UUID、M01/M02/M03 邀请 4 例） |
| build（web+worker） | ✅ exit 0 |
| e2e | ✅ 8/8（DATABASE_URL 注入独立集群；保留一次历轮一致 ECONNRESET 警告） |
| 真实容器 | ✅ 双口令链路（见上）；迁移已应用 aiea_dev（psql 单事务） |

执行偏差如实记录：e2e 首跑失败一次（种子指向的 integration_base 未迁移，属临时环境准备缺口），对基线库执行官方 migrate deploy 后 8/8；gate01.db 并发测试首版把"等待中拒绝"写成顺序 await 造成自死锁，改为"先挂起 promise→对端提交→再断言"后通过（与报告反例时序一致）。

## Known Issues / Follow-up

1. M01–M06 本轮全部按 R3 报告第 5 节核定落实；无新增延期项。M04 外键列不加 UUID CHECK（引用完整性传导至已约束主键）。
2. TRUST_PROXY_HEADERS 真实反代拓扑验证归 TASK-029；旧下载地址/旧 job 重放拒绝属 TASK-007/013 对象。
3. 仓库仍位于 iCloud 同步目录：本轮实证该环境会同时拖慢本机开发（CLI/测试挂死风险）——迁移出 iCloud 仍是基础设施建议，不阻断 Gate。
4. 临时环境已清理：独立 PG 集群、/tmp 工作副本、旧迁移样例、colima 均已停止/删除。

## 建议 Codex 优先阅读（按 diff 顺序）

源码/迁移/测试路径相对应用目录 `ai-ecommerce-assistant/`；docs 路径相对项目根。

| 顺序 | 文件 |
|---|---|
| 1 | `git log 9a5798c..e293b2e --oneline` |
| 2 | `prisma/migrations/20260914150000_p0_audit_store_composite_fk/migration.sql`、`tests/integration/gate01.db.test.ts`（H08 并发回归+M04 断言） |
| 3 | `tests/helpers/pgMigrate.ts`、`vitest.config.ts`、七套件 beforeAll/afterAll（H11）；官方 CLI 四项检查可按 P08_FIX 记录在 /tmp 副本复跑 |
| 4 | `src/app/api/v1/invitations/**`、`src/app/api/v1/invitations/[idOrToken]/route.ts`、`src/lib/rateLimit.ts`（clientIpFromRequest）、`src/lib/http.ts`（requestId）、`src/app/api/auth/[...all]/route.ts` |
| 5 | `src/lib/dbUrl.ts`、`compose.yaml`、`Dockerfile`、`prisma.config.ts`、`src/lib/env.ts`（M05） |
| 6 | `docs/reviews/gate-01-r4-evidence/`（容器双口令链路）；`docs/ai-ecommerce-assistant/12_PROGRESS.md`（R4 执行记录） |

## 复审结论回填约定

独立复审按项目协议记录 PASS / FAIL / BLOCKED 及精确代码版本、实际测试、未运行项、剩余问题。FAIL 交 ZCode 修复并复审；缺证据写清补证动作；只有确需产品决策的问题才交 Owner。PASS 后仍等待 Owner 阶段放行，两者满足后才按 PHASE_PLAN 执行合并与下一 Phase。本轮不合并 main、不部署、不开始 TASK-005。

---

# 历史：REVIEW_3 独立复审（Codex）及此前全部原文

以下为先前原文；其中"待修复""BLOCKED"等表述已被上方 R3 修复完成后的待复审状态取代，仅供追溯。

# CODEX_REVIEW_HANDOFF｜Gate01 REVIEW_3 独立复审完成，待 ZCode 修复

日期：2026-09-14T16:18:39+08:00；Reviewer：Codex。**Phase 1 / TASK-004 / 待修复 / Checkpoint=YES / 下一工具 ZCode。**

**正式 Gate 结论：BLOCKED；项目技术审查：FAIL。** 2 HIGH（H08 未关闭、H11 新增），6 MEDIUM。Owner 尚未阶段放行；不得合并 main、部署或开始 TASK-005。

| 项 | 最新事实 |
|---|---|
| 审查分支/提交 | phase/01-foundation / `9a5798ccdfad1be1e60d2df4dce9f9c189f85b93`，本地与远端一致 |
| 基准与范围 | main=`2a983cc55f136abbb49c5d02b55c1cb82b6547cc`；修复审查 `c87a141..9a5798c`，另核对完整Phase1 |
| 旧交接版本说明 | e7b5eea 为最后业务修复，9a5798c 仅其后管理文档/应用README；当前以实际HEAD为准 |
| 原 HIGH 已关闭 | H01–H07、H09、H10，共9项；D01方案A通过，不再询问 |
| 剩余 HIGH | H08：两事务并发可形成审计/店铺跨组织引用；H11：新测试清理会终止同集群无关库连接，配置覆盖隔离目标 |
| TASK 验收 | 001 PASS；002 FAIL；003/004 核心功能通过，完整依赖验收FAIL |
| 实际测试 | typecheck/build PASS，unit14/14、integration53/53、E2E最终8/8；真实HTTP/进程退出/回滚、真实Prisma空库7迁移与四→七升级 |
| 真实 Docker | 纯Git上下文构建成功，容器7迁移/初始化/登录/me200/公开注册403×2/Worker通过；非默认密码503列M05 |
| Medium | M01来源保护遗漏撤销；M02邀请仍信任伪造代理头；M03邀请输入/版本/错误信封未全落地；M04 UUID债务触发点已到；M05 Compose非默认密码不一致；M06测试迁移元数据不兼容Prisma |
| 报告/证据 | [正式15节报告](docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_3_2026-09-14.md)；[机器索引](docs/reviews/GATE_01_REVIEW_3_EVIDENCE_2026-09-14.json)；[原始记录与复现](docs/reviews/gate-01-review-3-evidence/README.md) |
| 下一提示词 | [prompts/P08_FIX.md](prompts/P08_FIX.md)，只修Phase1；新版本以9a5798c..新冻结提交回Codex |

M01–M03 沿用前轮 ACCEPT 范围，不能把漏改写成全部完成；M04 身份外键已通过，UUID约束延期条件已触发，应在后续H08迁移落实，仍为Medium。M05/M06按报告最小修补处理。两项HIGH独立决定BLOCKED，没有新增产品决策，也没有把全部Medium升级为HIGH。

本轮原应用81跟踪文件保持不变；测试只在临时副本、独立PG/Compose环境进行，未操作原开发库5433。原报告与证据完整保留。本轮只写审查管理文档，未提交/推送/合并/部署；测试成功、Reviewer通过、Owner放行、GitHub与部署分开记录。清理和Product OS实际收尾见唯一进度最新记录。

---

# 历史：ZCode 2026-09-14 R3 修复交接及此前全部原文

以下完整保留审查前交接，其中“待Codex复审”“全部落地”等自报由上方独立结论取代，不能作为当前状态或新指令。

# CODEX_REVIEW_HANDOFF｜Gate01 R3 修复完成，待 Codex 第三轮独立复审

日期：2026-09-14T14:58:39+08:00；执行者：ZCode。当前 Phase 1 / TASK-004 / 待审查（Gate01 REVIEW_3 待复审） / Checkpoint=YES / 下一工具 Codex。

## 复审定位信息

| 项 | 值 |
|---|---|
| Current Branch | `phase/01-foundation` |
| Base Branch | `main`（`2a983cc55f136abbb49c5d02b55c1cb82b6547cc`，未合并） |
| Previous Review Commit（正式复核冻结） | `c87a141648227954725402c715063a900fa72659` |
| Current Review Commit | `e7b5eea`（本地与远端一致，80c1342..e7b5eea 已推送） |
| Git Diff Range | `c87a141..e7b5eea`（6 提交：47269bb 正式报告、80c1342 L01、e66e3f8/c6fc5fa/08e1793/e7b5eea 四个 fix） |
| Project Status | TASK-004 / 待审查（Gate 标识 REVIEW_3）；Checkpoint=YES；下一工具 Codex，prompts/P07_CODE_REVIEW.md |
| Working Tree | 管理文档写回后统一提交（chore(review): prepare gate-01 review-3 handoff）；接手时若 HEAD 变化先重定范围 |

## 本轮修复摘要（ZCode 执行，待独立复核）

| # | 修复 commit | 内容 |
|---|---|---|
| H10+M05 | e66e3f8 (TASK-001) | Dockerfile 构建链（deps COPY schema+config → build 拷贝生成客户端 → 占位 BETTER_AUTH_* → CMD node 直启）；compose 端口 127.0.0.1 + 口令 `:?required`；**真实容器全链路证据** |
| H08/H09/M04 | c6fc5fa (TASK-002) | 三份新迁移：14 可空时间列 TIMESTAMPTZ(6)（USING AT TIME ZONE 'UTC'）、审计 v2 升级守卫 + store 父行 org_id 守卫、悬空守卫 + domain_user→"user" FK RESTRICT |
| H06+M01/M02/M03 认证侧 | 08e1793 (TASK-003) | ownerInit 单事务 + pg_advisory_xact_lock(hashtext('identity-email:<email>')) 统一邮箱锁 + 锁内权威重查 + 断链重建/孤儿回收/补偿删除；auth 懒加载 getAuth()；rateLimit peek 预检（401 消费/200 清零/其余不清零）；TRUST_PROXY_HEADERS 边界；公开注册每次新 Response |
| M01/M03 路由侧 | e7b5eea (TASK-004) | guardWrite（跨源 403/非 JSON 415）+ Zod 严格 schema（422 fieldErrors）+ internalFailure 稳定 503 信封，覆盖 invitations 创建/接受、members PATCH、organization PATCH、active-organization |

**真实 Docker 证据**（docs/reviews/gate-01-r3-evidence/，17 文件）：本机安装 colima + compose v2；干净构建 exit 0 → compose up（web 首启 corepack EAI_AGAIN 失败留档 web-startup.log）→ 修复后重建（compose-rebuild-web.log）→ /api/health 200 → 容器内 migrate exit 0 → init-owner exit 0 → 登录 200 → /api/v1/me 200 → 公开注册双探测 403 → compose down。container-login.json 会话 token 提交前脱敏；curl cookie jar 按安全规则删除未入库。

## ZCode 记录的 Tests（2026-09-14 本机）

| 套件 | 结果 |
|---|---|
| typecheck | ✅ 0 错误（修复后复跑） |
| unit | ✅ 14/14 |
| integration（7 文件 53 例） | ✅ 53/53（gate01.db 7 / database 9 / auth 8 / permissions 7 / gate01.auth 10 / gate01.access 7 / db 4） |
| build（web+worker） | ✅ exit 0 |
| e2e | ✅ 8/8（保留一次 ECONNRESET 警告，与历轮一致） |
| 真实容器 | ✅ 全链路见上（此前"无 Docker"缺口已由本机安装 colima 补上） |

环境事实（复审须知）：本机 Prisma CLI 启动空转 ~10 分钟，测试基建改用 pg 驱动直跑迁移（tests/helpers/pgMigrate.ts）；本地 PG 09-14 12:10 被外部 smart shutdown 后关机 PANIC（iCloud 写超时），重启自动崩溃恢复成功，以上结果均在恢复后取得。

## Known Issues / Follow-up 终态

1. M01/M02/M03/M04/M05 本轮全部落地；唯一延期项：领域 UUID 数据库格式约束（REVIEW_2 核定——首次后续 Schema 变更或 TASK-028 前，取较早）。
2. E2E 默认密码仅用于本地演示库 aiea_dev；旧下载地址/旧 job 重放拒绝分别属 TASK-007/013 对象。
3. e2e 种子超时 120s→300s（tsx 冷启动 + iCloud 慢 I/O 实测 ~62s）。
4. 仓库仍位于 iCloud 同步目录（pg_control 写超时已实证一次）；迁移出 iCloud 属基础设施事项，不阻断 Gate。

## 建议 Codex 优先阅读（按 diff 顺序）

下表源码、迁移与测试路径相对于应用目录 `ai-ecommerce-assistant/`；Git 与 docs 路径相对于项目根。复审还需查看范围内其余差异。

| 顺序 | 文件 |
|---|---|
| 1 | `git log c87a141..e7b5eea --oneline` |
| 2 | `Dockerfile`、`compose.yaml`、docs/reviews/gate-01-r3-evidence/（H10/M05 真实容器证据） |
| 3 | `prisma/migrations/20260913120000_p0_nullable_timestamptz/`、`20260913120100_p0_audit_tenant_fk_v2/`、`20260913120200_p0_domain_user_auth_fk/`、`prisma/schema.prisma`（H08/H09/M04） |
| 4 | `src/services/ownerInit.ts`、`src/services/invitations.ts`（H06：邮箱锁/权威重查/断链重建/补偿） |
| 5 | `src/lib/auth.ts`（懒加载 getAuth/resetAuthForTests）、`src/lib/rateLimit.ts`（peek）、`src/app/api/auth/[...all]/route.ts`（M02/H04） |
| 6 | `src/lib/http.ts`（guardWrite/internalFailure）、五个 v1 写路由（M01/M03） |
| 7 | `tests/helpers/pgMigrate.ts`、`tests/helpers/setup.ts`、`vitest.config.ts`（测试基建）；`tests/integration/gate01.{db,auth,access}.test.ts`（新回归） |
| 8 | `docs/ai-ecommerce-assistant/12_PROGRESS.md`（R3 修复执行记录）、`README.md`（R3 章节） |

## 复审结论回填约定

独立复审按项目协议记录 PASS / FAIL / BLOCKED 及精确代码版本、实际测试、未运行项、剩余问题。技术失败交 ZCode 修复并复审；缺证据写清补证动作；只有确需产品决策的问题才交 Owner。PASS 后仍等待 Owner 阶段放行，两者满足后才按 PHASE_PLAN 执行合并与下一 Phase。本轮不合并 main、不部署、不开始 TASK-005。

---

# 历史：正式复核（22时）与 REVIEW_2 结论及更早交接全文

以下为先前原文；其中历史待审查段落不代表当前状态。

# CODEX_REVIEW_HANDOFF｜Gate01正式复核完成，待ZCode修复

日期：2026-09-13T22:31:24+08:00；Reviewer：Codex。当前Phase1 / TASK-004 / 待修复 / Checkpoint=YES / 下一工具ZCode。

**正式Gate结论：BLOCKED；项目技术审查：FAIL。** 用户指定15节格式与项目协议的状态命名不同，均表示四项已复现HIGH未关闭；不是新的产品裁决或Owner放行。

- 当前本地及远端phase/01-foundation=c87a141；main=2a983cc。76个已跟踪应用文件与已提交版本相同，没有REVIEW_2之后的新应用修复。
- 22时独立重跑typecheck、unit14/14、integration46/46、build、e2e8/8、空库/升级、真实HTTP/并发/回滚、数据库与Docker布局反例。H01/H02/H03/H04/H05/H07/D01通过；H06/H08/H09/H10仍FAIL。
- 真实Docker仍未执行（本机无运行时），不以本地布局代替实测；Docker缺口不延期到TASK-029关闭。
- 当前报告：[正式15节报告](docs/reviews/CODEX_REVIEW_GATE_01_FORMAL_2026-09-13.md)；[本次证据](docs/reviews/GATE_01_FORMAL_EVIDENCE_2026-09-13.json)；下一工具使用[prompts/P08_FIX.md](prompts/P08_FIX.md)。
- ZCode只修Phase1四项HIGH并按报告处理Medium。新增M05为本地Compose配置建议，L01为根旧Schema副本维护建议，均不单独阻断。M01–M04原核定及D01方案A不重问。
- 下轮范围必须为c87a141..新冻结提交，先核对未提交管理差异。修复自测、Codex PASS、Owner阶段放行、GitHub同步和部署分开记录。
- 当前不合并main、不推进TASK-005、不部署；本轮管理文档未提交或推送。首轮及REVIEW_2历史完整保留如下。

---

# 历史：16时REVIEW_2结论及更早交接全文

以下为先前原文；其中历史待审查段落不代表当前状态。

# CODEX_REVIEW_HANDOFF｜Gate 01 REVIEW_2 结论与修复交接

日期：2026-09-13T16:36:06+08:00；Reviewer：Codex；本轮复审已完成，**FAIL**。当前 Phase 1 / TASK-004 / 待修复 / Checkpoint=YES / 下一工具 ZCode。

| 项 | 当前事实 |
|---|---|
| 分支/审查提交 | phase/01-foundation / c87a141648227954725402c715063a900fa72659 |
| 复审范围 | c263610541f8c8f7b41fd38c185f5feac94e8ee2..c87a141；完整Phase1应用另核对 |
| main | 2a983cc55f136abbb49c5d02b55c1cb82b6547cc，未合并 |
| 通过 | H01/H02/H03/H04/H05/H07；D01方案A已实证落实 |
| 未关闭HIGH | H06并发初始化身份断裂；H08审计持续同域/升级存量；H09遗漏14可空时间；H10构建阶段两处失败 |
| Docker | deps布局通过；build布局失败；无真实Docker环境，构建/启动/迁移/登录仍待补证 |
| 测试 | 独立typecheck/build通过，unit14/14、integration46/46、e2e8/8；空库/升级/重复迁移命令通过；反例见报告 |
| 完整报告/证据 | [docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_2_2026-09-13.md](docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_2_2026-09-13.md)；[docs/reviews/GATE_01_REVIEW_2_EVIDENCE.json](docs/reviews/GATE_01_REVIEW_2_EVIDENCE.json) |
| 下一提示词 | [prompts/P08_FIX.md](prompts/P08_FIX.md) |
| 放行 | 未取得Owner阶段放行；当前不允许main合并、部署或TASK-005 |

M01–M04已经独立核定，不沿用ZCode整包延期建议：现有写接口来源保护、登录计数语义/代理边界、当前接口类型/版本/错误信封和认证外键均在Gate01内处理；仅UUID格式约束允许限定延期（首次后续Schema变更或TASK-028前，取较早）。详细完成标准见报告第4节及P08。D01不再询问。

复审后的下轮范围以 **c87a141..新冻结修复提交** 为准。ZCode先核对HEAD及未提交管理差异，按原TASK顺序逐项处理，保留已通过回归；写回真实提交/结果后交Codex。测试通过、Gate PASS、Owner放行、GitHub同步、部署各自记录。

本轮前后的管理修改未提交/推送；实查远端phase=c87a141、main=2a983cc。原应用代码与首轮证据未改。收尾与Product OS真实执行结果见唯一进度最新记录。

---

# 历史交接原文（上一轮收尾，已被上方REVIEW_2结果取代）

以下完整保留上轮"待复审"交接和执行者自报记录，仅供追溯，不能作为当前状态或独立通过结论。

# CODEX_REVIEW_HANDOFF｜CODEX_REVIEW_GATE_01_REVIEW_2（第二轮复审交接）

- 原交接日期：2026-09-13（ZCode 修复完成后）；Codex 交接收尾核对：2026-09-13T16:04:32+08:00
- 交接根目录：`/Users/yuyuyu/Documents/ChatGPT/产品-开发`
- 审查类型：**Gate-01 第二轮复审**（第一轮 BLOCKED → ZCode 已提交 H01–H10 修复 → 待独立复审）
- 修复依据：[docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md](docs/reviews/CODEX_REVIEW_GATE_01_2026-09-13.md) + [GATE_01_EVIDENCE.json](docs/reviews/GATE_01_EVIDENCE.json) + Owner 对 D01 的裁决（方案 A，RESOLVED）

> 本轮 Codex 只完成交接收尾，未执行 REVIEW_2、未重跑业务测试。以下修复行为与测试结果来自 ZCode 的已提交记录，是否满足首轮验收由第二轮独立复审核定。唯一进度仍为 `docs/ai-ecommerce-assistant/12_PROGRESS.md`；本文件保存版本、证据与接手范围。

## 复审定位信息

| 项 | 值 |
|---|---|
| Current Branch | `phase/01-foundation` |
| Base Branch | `main`（`2a983cc55f136abbb49c5d02b55c1cb82b6547cc`） |
| Base Review Commit（第一轮冻结） | `c263610541f8c8f7b41fd38c185f5feac94e8ee2` |
| Current Review Commit | `c87a141648227954725402c715063a900fa72659`（已提交的 REVIEW_2 交接版本） |
| Git Diff Range | `c263610..c87a141`（固定复审范围；main..c87a141 供 Phase 全量背景核对） |
| Project Status | TASK-004 / 待审查 / CODEX_REVIEW_REQUIRED；Checkpoint=YES；下一工具 Codex，prompts/P07_CODE_REVIEW.md |
| Working Tree | 本轮写入前 clean；15:59:55+08:00 实查远端=c87a141。收尾管理修改未提交/推送，接手时须保留并重读 |

## ZCode 修复记录：H01–H10（执行者逐项 ACCEPT，待独立复核）

| # | 修复 commit | 修复内容 | 复审要点 |
|---|---|---|---|
| H10 | 73a5108 | Dockerfile deps 先 COPY prisma/schema.prisma+prisma.config.ts 再 install；compose 注入 BETTER_AUTH_SECRET/URL；docker-deps-repro.sh 等价复现 OK | 干净布局 install+generate；**真实 Docker runtime 未实测（本机无 Docker）** |
| H08 | 3e90bf6 | 新迁移 p0_audit_tenant_fk：audit_log 同域触发器（同域/空 store 放行、异域拒绝）；选触发器而非复合外键的原因见迁移注释 | 异域 INSERT 被 DB 拒绝；空 store 合法；删除行为=单列 FK SET NULL |
| H09 | 3e90bf6 | 新迁移 p0_domain_timestamptz：77 列 TIMESTAMPTZ(6) 显式 `USING ... AT TIME ZONE 'UTC'`（历史行均 Prisma UTC 墙钟、集群时区 Asia/Shanghai）；Auth 四表保持框架原生；auth_rate_limit 重置 | 空库+升级双路径；UTC/+08 同一时刻等值；默认值/ORM 路径 |
| H04 | 63c16ea | `/api/auth/sign-up/email` HTTP 层 403 PUBLIC_SIGNUP_DISABLED；受控路径（初始化/邀请）走服务端 auth.api 不受影响 | 匿名 URL 拒绝且零 AuthUser；两条受控路径成功 |
| H05 | 63c16ea | 接受邀请转发框架 signUpEmail(asResponse:true) 的完整 Set-Cookie；不再手工伪造 Cookie | E2E 双浏览器上下文：接受→受保护接口 200 |
| H06 | 63c16ea | 输入写库前完整校验（422 零副作用）；孤儿 Auth 身份回收（幂等重试恢复）；单事务+PG 事务级咨询锁（邮箱+邀请双键）覆盖 CAS+领域+审计；Auth 创建失败/事务失败补偿删除 | 长姓名 500→422 无残留；孤儿恢复；注入失败→邀请 pending+AuthUser 0→重试成功；并发仅一成功 |
| H07 | 63c16ea + e56be99 | 邀请创建/撤销/接受、成员 PATCH（CAS+会话撤销+审计）、organization PATCH（CAS+审计，补齐缺失审计）全部单事务 | DB 级 NOT VALID 约束注入：失败后业务/版本/审计零提交 |
| H01 | e56be99 | session.ts 唯一活跃组织解析（Cookie 仅在有效成员关系内选择，否则回退首个）；/me、requirePermission、organization 读写同源；active-organization 直接写响应 Set-Cookie | 同账号 A=owner/B=CS：切换后读写均为 B、CS 无预算/无 PATCH 权；伪造 Cookie 回退 |
| H02 | e56be99 | assertRoleAssignment 校验拟授予新角色：Admin 禁授 admin；owner 永不可授予 | Admin op→admin 403 且角色不变；Owner 合法；P↔C 允许 |
| H03 | e56be99 | D01 方案 A：禁用仅本组织 Membership.status+撤登录会话；不修改全局 User.status；其他组织可用（重登验证）；02_USER_ROLES 已同步裁决 | A 禁用不伤 B 的 Owner；旧 Cookie 401；重登 active_org=B role=owner |

**D01：RESOLVED（方案 A）**——Owner 2026-09-13 裁决：组织成员禁用仅影响当前 Organization 的 Membership；不通过组织接口改全局 User.status；其他组织有效 Membership 继续可用；全局封禁属平台级运维 P0 不开发。已同步 `docs/ai-ecommerce-assistant/02_USER_ROLES.md`。

## ZCode 记录的 Tests（2026-09-13；本轮 Codex 未重跑）

| 套件 | 结果 |
|---|---|
| typecheck | ✅ 0 错误 |
| unit（env 7 + 权限矩阵/投影 7） | ✅ 14/14 |
| integration（7 文件 46 例：db 4 / database 9 / auth 8 / permissions 7 / **gate01.db 3** / **gate01.auth 8** / **gate01.access 7**） | ✅ 46/46 |
| build（web+worker） | ✅ 退出码 0 |
| e2e（原 6 + **邀请全流程 + 公开注册拒绝**） | ✅ 8/8 |
| migration | ✅ 空库×4 套件 + aiea_dev 升级（deploy 后 Already in sync） |
| docker deps 等价复现 | ✅ scripts/docker-deps-repro.sh OK |

新增回归覆盖：多组织授权（双组织双角色读写同源/伪造 Cookie 回退）、role escalation（Admin 提权 403）、member disable isolation（A 禁用不伤 B）、public signup rejection、invitation success session（框架 Cookie 真实会话）、invitation failure recovery（孤儿/补偿/重试/并发）、audit transaction rollback（邀请/成员/组织三处注入）、AuditLog 跨组织 FK（触发器）、timezone semantics（类型断言+UTC/+08 等值）、Docker dependency installation path（等价复现）。ZCode 记录原有测试均保留并通过；本轮仅核对记录及相关提交存在。首轮 docs/reviews/gate-01-evidence/ 日志和 GATE_01_EVIDENCE.json 对应 c263610，不能用于证明本次修复测试通过。

## Known Issues（剩余）

1. **真实 Docker runtime 构建/启动未实测**（本机无 Docker）——H10 已修配置并用相同布局等价复现验证，但干净容器构建→迁移→登录链路仍需真实 Docker 环境。该缺口是否阻塞 Gate 须由复审核定，不能在交接收尾中自动延期至 TASK-029。
2. E2E 默认密码仅用于本地演示库 aiea_dev。
3. 旧下载地址/旧 job 重放拒绝分别属 TASK-007/013 对象（本轮已覆盖 Cookie 重放拒绝）。

## Medium Follow-up（M01–M04：ZCode 提议延期，待复审核定）

本轮不将执行者的"不阻塞"建议视为 Reviewer 放行；M03 已有局部修改，其余缺口仍须复核并明确处理时点。

| # | 内容 | 状态 |
|---|---|---|
| M01 | 业务写 API Origin/CSRF 校验 | Follow-up（建议 TASK-005 前置或并入首个业务写端点任务） |
| M02 | 仅成功认证清零登录失败计数（400/429 不清零）；固定代理信任边界 | Follow-up |
| M03 | 输入类型/长度统一 Zod 校验与未预期异常稳定信封 | Follow-up（本轮已在 organization PATCH/邀请路径落地局部校验） |
| M04 | User.authUserId 外键与领域 UUID 数据库校验 | Follow-up（建议与下一次 schema 迁移一并评估） |

## 建议 Codex 优先阅读（按 diff 顺序）

下表第 2–8 项源码、迁移与测试路径均相对于应用目录 `ai-ecommerce-assistant/`；Git 与 docs 路径相对于项目根。复审还需查看范围内其余差异，不能只看本表。

| 顺序 | 文件 |
|---|---|
| 1 | `git log c263610..c87a141 --oneline`（4ec0011→73a5108→3e90bf6→24f877a→63e16ea→e56be99→c87a141） |
| 2 | `prisma/migrations/20260913043631_p0_domain_timestamptz/`、`20260913044218_p0_audit_tenant_fk/` |
| 3 | `src/lib/session.ts`（H01 唯一解析点）、`src/app/api/v1/me/active-organization/route.ts` |
| 4 | `src/services/invitations.ts`（H05/H06/H07：校验前置/咨询锁事务/补偿）、`src/services/ownerInit.ts` |
| 5 | `src/app/api/auth/[...all]/route.ts`（H04 封禁）、`src/app/api/v1/invitations/[idOrToken]/accept/route.ts`（H05） |
| 6 | `src/app/api/v1/members/[id]/route.ts`（H02/H03/H07）、`src/app/api/v1/organization/route.ts`（H01/H07） |
| 7 | `tests/integration/gate01.{db,auth,access}.test.ts`（新增 18 例回归）+ `tests/e2e/auth.spec.ts`（新增 2 例） |
| 8 | `Dockerfile`、`compose.yaml`、`scripts/docker-deps-repro.sh`（H10） |
| 9 | `docs/ai-ecommerce-assistant/02_USER_ROLES.md`（D01 同步）、`docs/ai-ecommerce-assistant/12_PROGRESS.md`（修复执行记录） |

## 复审结论回填约定

独立复审按项目协议记录 PASS / FAIL / BLOCKED 及精确代码版本、实际测试、未运行项、剩余问题。技术失败交 ZCode 修复并复审；缺证据写清补证动作；只有确需产品决策的问题才交 Owner，不能把所有技术 BLOCKED 都转给用户决定。

PASS 后仍等待 Owner 阶段放行，两者满足后才按 PHASE_PLAN 执行合并与下一 Phase。本轮交接收尾不放行、不开 TASK-005，也不自动提交或推送。

## 本轮核对结果与下一步

- 已确认代码：HEAD 与远端均为 c87a141，main 仍为 2a983cc；D01 的方案 A 已写入 02_USER_ROLES，本轮同步登记 FINAL_DECISIONS（沿用既有记录，非重新裁决）。
- 待办：Codex 第二轮独立复核 H01–H10/D01；核定真实 Docker 缺证与 M01–M04 延期安排；复审通过后再等 Owner 放行。没有新业务开发任务。
- 证据边界：本轮仅执行磁盘/Git/文档一致性与 Product OS 刷新检查；ZCode 自报测试与首轮独立日志分开保存。收尾检查及实际 sync 读回结果见唯一进度的最新执行记录。
- 新对话使用 `prompts/P07_CODE_REVIEW.md`；接手先核对最新 HEAD 与本轮未提交管理差异，再决定实际待审范围。
