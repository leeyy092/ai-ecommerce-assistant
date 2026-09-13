# CODEX REVIEW｜GATE 01

Reviewer：Codex（独立技术审查）｜日期：2026-09-13，22 时续接复核（Asia/Shanghai）｜范围：Phase 1 / TASK-001–004。

## 1. 最终结论

**BLOCKED。不允许合并 main，不允许开始 Phase 2 / TASK-005。**

按本次用户指定的 `PASS / PASS_WITH_FIXES / BLOCKED` 输出口径，Gate 为 BLOCKED；项目协议中的技术审查结果仍为 **FAIL**。二者表示同一事实：审查已完成，但有 4 项已复现 HIGH，阶段未通过；不是仅因环境不足而无法作出判断。真实 Docker 实测另外记录为缺证。

本次确认没有新的待审修复提交：本地与远端 `phase/01-foundation` 均为 `c87a141648227954725402c715063a900fa72659`；`main` 均为 `2a983cc55f136abbb49c5d02b55c1cb82b6547cc`。最新交接正文是 16:36 的 REVIEW_2 FAIL，而非第三轮修复完成声明。126 个已跟踪文件逐一核对，76 个应用文件与 c87a141 相同，未提交差异仅为 8 份管理文档。历史报告及 33 份 REVIEW_2 证据的 SHA256 校验全部一致。

重点比较 `main...phase/01-foundation`（79 个文件，含 45 个应用文件；10851 行增加、222 行删除），并核对 `c263610..c87a141` 修复差异。TASK-001/002 的初始实现已随事故恢复进入 main，故同时按合同核对当前完整应用，不能因其不全在分支差异中而豁免验收。

本轮在相同提交的临时副本和独立 PostgreSQL 17.11 / 55459 上重新执行测试、HTTP/数据库反例及构建阶段复现。原应用源码、Schema、迁移、依赖和现有测试未修改；没有提交、推送、合并或部署，没有操作开发库 5433。17 时中断前的临时准备不计为成功测试，以下使用 22 时续接后保存的结果。

证据：[本次证据索引](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/GATE_01_FORMAL_EVIDENCE_2026-09-13.json)、[日志与复现说明](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/gate-01-formal-evidence/README.md)。[REVIEW_2 原报告](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_2_2026-09-13.md) 保留历史，本报告按用户要求补齐正式 15 节输出，不把同一代码版本包装成新修复版本。

## 2. TASK 验收

| TASK | 结论 | 实现、测试与完整验收判断 |
|---|---|---|
| TASK-001 | **FAIL** | Web/Worker、健康接口、缺配置失败、锁定安装、typecheck/build/测试通过；但干净 Docker 构建阶段仍有两处确定失败，真实容器闭环未验证，见 H10。 |
| TASK-002 | **FAIL** | P0 表、主要复合外键/唯一键/金额 CHECK、空库与向前迁移命令通过；审计持续同域、14 个可空时间和认证身份外键仍有缺口，见 H08/H09及 H06/M04。 |
| TASK-003 | **FAIL** | 登录/退出、受控邀请、公开注册拒绝、原有改密/过期/重放等测试通过；并发初始化能留下无法登录的 Owner，普通重跑不能恢复，见 H06。 |
| TASK-004 | **FAIL（整体依赖验收未满足）** | 本任务已实现的组织上下文、四角色服务端授权、客服投影、角色授予、成员撤权与审计原子性已通过，H01/H02/H03/H07 已关闭；但依赖 TASK-003 的身份完整性未通过，现有写入口另有 M01/M03，不能把整项标为阶段验收完成。此处 FAIL 不表示已关闭的授权缺陷重新出现。 |

TASK-004 对未来文件、Job、AI 证据的公共授权服务已检查；这些业务对象尚未实现，不能声称已完成真实下载链接、运行 Job 或完整 AI 输出的端到端撤权测试，也不为补证提前实现 TASK-005 之后的功能。

## 3. CRITICAL

**NONE。** 未证实匿名读取企业数据、普通非成员直接读取其他组织经营数据，或数据库整体损坏。下面的具体反例按实际影响定为 HIGH，不扩大为已发生的生产泄漏。

## 4. HIGH

### H06｜并发 Owner 初始化误删另一流程的在途认证身份

- **问题：**初始化的邮箱检查、孤儿回收、认证创建与领域提交没有共用协调规则；幂等返回也不检查认证身份是否仍存在。
- **位置：**[ownerInit.ts:60](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/services/ownerInit.ts:60)、[ownerInit.ts:80](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/services/ownerInit.ts:80)，以及同文件事务/补偿分支；认证引用见 [schema.prisma:398](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:398)。
- **证据：**使用已有 `testHookAfterAuth` 对真实 Better Auth + PG 调度两个初始化流程。流程 1 创建 Auth-1 后暂停；流程 2 把 Auth-1 当孤儿删除，创建 Auth-2；流程 1 仍能提交引用已删除身份的领域用户；流程 2 因邮箱唯一冲突失败后删除 Auth-2。本次最终 `firstSucceeded=true`、`secondSucceeded=false`、AuthUser=0、领域 User=1、引用不存在；重跑 `alreadyInitialized=true`，真实登录 HTTP 401。见 `http-probes.json/H06_owner_concurrent`。
- **风险：**初始化返回成功但 Owner 无法登录，后续普通重跑也无法恢复；初始化与邀请并行时同类回收逻辑可能互相干扰。后者需要修复后补交错测试，不在本报告冒称已单独复现。
- **建议修复方式：**初始化和邀请统一邮箱协调、锁内权威重查、可恢复的孤儿判断和补偿所有权；幂等返回前核实完整身份链；补认证外键与明确删除/恢复策略。覆盖 init/init、init/invite、认证创建后失败、进程中止和损坏身份重跑；不允许只捕获异常并报告初始化成功。

### H08｜AuditLog 的触发器未维持持续同域，也未校验升级存量

- **问题：**只在审计行 INSERT/UPDATE 时查店铺组织，未约束 Store 父行归属变化，新增迁移未验证已有坏引用。
- **位置：**[p0_audit_tenant_fk/migration.sql:8](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/migrations/20260913044218_p0_audit_tenant_fk/migration.sql:8)。
- **证据：**本次再次验证：合法 A 店铺/A 审计创建后，直接 UPDATE Store.org_id 为 B 成功，审计仍指 A；在旧两次迁移的数据库预置 A 审计引用 B 店铺，再执行全部新迁移，deploy exit 0，跨域审计仍存在。`db-probes.json` 与 `upgrade-results.json` 对应项均为 true。新增异域 INSERT 已被拒，删除店铺清空 store_id 并保留 org_id 的样例通过，不能据此关闭整体问题。
- **风险：**历史审计与资源归属不一致，后续查询、恢复和依赖该约束的代码可能越过组织边界。当前没有公开店铺转组织接口，因此这是已复现的数据库不变量失败，尚不是普通用户通过现有 URL 读取他组织数据的证据。
- **建议修复方式：**新增受审查迁移，优先采用可持续维护的复合引用；明确删除时只清空可空 store_id、保留 org_id；升级前检测历史坏数据并拒绝静默通过，不自动改写审计历史。回归新增、父行变更、删除、并发与升级。固定 Prisma 7.10 的混合可空复合关系已在 REVIEW_2 最小 Schema 校验通过，不能笼统称 Prisma 不支持。跨行约束机制参见 [PostgreSQL 17 Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)。

### H09｜遗漏 14 个可空领域时间字段的 timestamptz

- **问题：**已迁移 77 列，但可空交易、评估和任务时间仍为 `timestamp without time zone`，未满足数据合同。
- **位置：**[schema.prisma:500](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:500)、[Order.paidAt:692](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:692)、[RefundEvent.completedAt:798](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:798) 及对应领域字段；迁移 `20260913043631_p0_domain_timestamptz`。
- **证据：**本次数据库清单仍有 14 列遗漏；向 Store.input_evaluation_at 写入同一时刻 `2026-01-01 12:00:00+00` 与 `2026-01-01 20:00:00+08`，读回相差 8 小时。已修列的默认值和已知 UTC 墙钟升级样例通过。见 `db-probes.json`、`upgrade-results.json`。
- **风险：**付款、退款、快照评估和任务时间可能错位；未来导入和分析依赖这些字段时难以判断历史值的真实时区，后补修复会增加数据修复成本。并非声称全部现存真实数据已经偏移。
- **建议修复方式：**补齐原合同的可空时间类型，使用新增迁移；先核实历史值来源和时区再转换，不改写共享迁移。覆盖全字段类型清单、同刻不同偏移、默认值/ORM、空库与旧库升级；日期型和认证框架原生表不在本项内。

遗漏清单：Store 的 input_evaluation_at/current_snapshot_evaluation_at/previous_snapshot_evaluation_at；Order.paid_at；RefundEvent.completed_at；AIInsight.generated_at；AIReport.generated_at；AIRun.started_at/finished_at；JobRun.started_at/finished_at；ImportTask.committed_evaluation_at/confirmed_at/committed_at。

### H10｜Docker 修复仅覆盖依赖安装，build 阶段仍失败

- **问题：**deps 生成的客户端不在 build COPY 范围内；补齐客户端后，构建阶段仍缺认证初始化所需环境。
- **位置：**[Dockerfile:17](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/Dockerfile:17) 和 21–22 行；认证模块 [auth.ts:14](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/lib/auth.ts:14)。
- **证据：**本次从 c87a141 已跟踪文件重建干净 build 布局，带入 node_modules、不带本机生成源码，`pnpm build` exit 1，无法解析 `@/generated/prisma/client`；只在临时布局补生成客户端后再次执行，编译/类型阶段通过，但收集路由数据时缺 `BETTER_AUTH_SECRET/BETTER_AUTH_URL`，exit 1。完整测试环境下的常规 build 则通过。两份独立日志见 `docker-build-missing-client.log`、`docker-build-missing-auth.log`。
- **风险：**开发目录能构建不代表可从干净提交构建镜像，TASK-001 的交付命令不可复现；运行时 Compose 变量不会自动成为镜像构建变量。
- **建议修复方式：**在 build 中生成或显式复制正确客户端；提供合理的非生产构建配置或延迟认证初始化，运行时仍强校验，生产秘密不得写入镜像。随后补真实 Docker 干净 build、Web/Worker/PG 启动、迁移、Owner 初始化与登录。当前没有 Docker/Podman/Colima/Docker.app，阶段布局复现不是 Linux 容器实测；不得延期到 TASK-029 才关闭 H10。机制见 [Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)。

## 5. MEDIUM

### M01｜已有业务写入口缺可信来源与内容类型边界

- **问题：**Better Auth 的可信来源配置没有自动保护自建 v1 写路由。
- **位置：**[invitations/route.ts:16](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/route.ts:16)，及组织/成员/活跃组织写入口。
- **证据：**人工附带有效 Cookie，Origin 为非可信站点、Content-Type 为 text/plain，创建邀请仍返回 201 并落库。见 `http-probes.json/M01`。本次没有证明真实浏览器会在该跨站情形自动附带 Cookie。
- **风险：**业务写请求缺少服务端来源防护，依赖浏览器 Cookie 行为和部署拓扑；不把人工 Cookie 探测直接写成已成功的浏览器 CSRF 攻击。
- **建议修复方式：**沿用 REVIEW_2 的 ACCEPT：在 TASK-003/004 现有入口统一校验来源、内容类型及必要 CSRF 条件，保留合法同源/脚本路径；真实域名/反代浏览器验证归 TASK-029。

### M02｜非认证成功响应也清零登录失败计数，IP 来源可伪造

- **问题：**除 401 外都 reset，且直接信任传入的 x-forwarded-for/x-real-ip。
- **位置：**[auth 路由:16](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/auth/[...all]/route.ts:16) 和 65–70 行。
- **证据：**错误密码返回 401 后 count=1；紧接缺 password 的请求返回 400，数据库计数记录被删除。代码直接取转发头首项。见 `http-probes.json/M02`。
- **风险：**攻击者可重置失败窗口；不可信 IP 头还能切换计数键，削弱已承诺的登录防爆破。
- **建议修复方式：**沿用 ACCEPT：只对明确认证成功清零；400/429 不清零；落实可执行的可信代理规则，并验证错误请求、成功请求和转发头的限流行为。真实反代配置在 TASK-029 验证。

### M03｜当前 API 输入边界和错误信封仍不完整

- **问题：**请求体强制类型断言不构成校验，版本允许小数；未知异常与重复注册拒绝不稳定。
- **位置：**[organization/route.ts:51](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/organization/route.ts:51)、[members 路由:44](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/members/[id]/route.ts:44)、[http.ts:58](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/lib/http.ts:58)、[auth 路由:22](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/auth/[...all]/route.ts:22)。
- **证据：**本次 name 数字返回 422；body=null 返回非 JSON 500；expected_version=1.1 返回 200 并实际改名；第二次匿名注册拒绝为无 JSON 的 403；审计注入失败返回非 JSON 500。见 `http-probes.json/M03/H04/H07*`。
- **风险：**异常请求可绕过版本输入合同，前端无法按既定错误协议处理，故障难以关联 request_id。
- **建议修复方式：**沿用 MODIFY：只补当前 Phase 的对象/类型/长度/正整数版本校验、稳定错误信封和安全日志关联；每次拒绝注册创建新 Response；不建设新异常平台，也不提前实现未来 API。

### M04｜领域身份的数据库约束欠缺

- **问题：**auth_user_id 没有认证外键，UUID 仅依靠默认生成器，数据库仍允许任意 TEXT。
- **位置：**[schema.prisma:396](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:396) 及相关领域主键。
- **证据：**不存在认证身份的领域 User 和非 UUID id 均可直接写入；H06 又证明正常初始化代码实际能制造悬空身份。见 `db-probes.json/nonuuid_and_missing_auth_accepted`。
- **风险：**认证链断裂影响登录与恢复；UUID 缺少约束增加后续数据校验成本，但本次未证明 TEXT 本身造成越权。
- **建议修复方式：**沿用 MODIFY：认证外键、删除与恢复策略并入 H06 的阻断修复，在 TASK-002/003 完成；UUID 格式约束单独 DEFER 到首次后续 Schema 变更或 TASK-028 前，取较早者，仍登记 TASK-002 技术债；不改认证框架 string 主键。

### M05｜本地 Compose 固定数据库口令配合未限定宿主机地址的端口发布

- **问题：**本地配置提交了固定开发数据库口令，并发布 `5433:5432`，未限定 loopback。这是 TASK-001 当前配置的延续问题，不是本次新修复引入的生产 Secret 泄漏。
- **位置：**[compose.yaml:15](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/compose.yaml:15) 和 18、31、46 行。
- **证据：**配置静态读取可确认；没有真实容器，因此没有进行外部连接实验。Docker 默认未指定宿主机地址的发布规则面向所有宿主机地址，除非另有守护进程/网络配置覆盖。[Docker 端口发布说明](https://docs.docker.com/engine/network/port-publishing/)
- **风险：**按默认配置启动开发栈时，开发库可能暴露给可达网络且口令已知；不能从当前证据断言生产库已暴露。
- **建议修复方式：**本地 DB 不需要宿主机访问时取消发布，需要时显式限制 loopback；由本地受限环境提供口令，避免与真实环境复用。建议随 H10 做小幅配置收敛；MEDIUM，不单独增加 Gate 阻断条件。

M01–M04 保留 REVIEW_2 的技术核定和拆分，不把 ZCode 的整包延期建议视为批准。当前 Gate 已由四项 HIGH 独立阻断；第 13 节只列 CRITICAL/HIGH，不将一般 Medium/Low 或风格偏好提升成 HIGH。

## 6. LOW

### L01｜项目根遗留第二份包配置与旧 Schema，存在误操作入口

- **问题：**根目录与应用目录同时存在 package/lockfile/Prisma 配置，而根目录 Schema 已与应用版不同。
- **位置：**[根 package.json:14](/Users/yuyuyu/Documents/ChatGPT/产品-开发/package.json:14)、[根 prisma/schema.prisma:1](/Users/yuyuyu/Documents/ChatGPT/产品-开发/prisma/schema.prisma:1)；实际应用是 `ai-ecommerce-assistant/`。
- **证据：**Git 显示这些根文件在 `73a5108` 引入；根脚本指向根 src/jobs，但根并无应用 src；根 Schema 与当前应用 Schema 不同。并非两套正在运行的应用。
- **风险：**从项目根直接运行 pnpm/Prisma 可能生成旧客户端或使用错误 Schema，增加接手与迁移误操作概率。
- **建议修复方式：**核对用途后移除误留的实验副本，或明确归入不执行的证据目录；保持应用命令只在既定应用目录执行。低风险维护项，不要求为此重构业务或重新设计目录。

## 7. 数据库审查

**结论：未通过；不允许据当前 Schema 验收进入下一 Phase。**

P0 主要表、复合组织/店铺引用、自然键、单 Owner 部分唯一、金额 Decimal 和 CHECK 已有真实 PG 测试。空库四次迁移、旧版两次到四次迁移、重复 deploy 的命令均成功；P1/P2 实体未建表。迁移“执行成功”与迁移后数据“不变量成立”已分开判断：H08 升级坏行仍在，H09 类型仍漏，H06/M04 身份链无外键。

Organization/Store 等服务必须继续采用当前租户范围；没有新增组织删除或 Owner 转移接口。数据库同域/时间缺陷应在后续模块大量依赖前修正，而非以未来服务会校验为由接受。

## 8. Auth / 权限 / 多租户审查

**结论：现有授权修复通过，身份完整性仍未通过。是否存在已复现的跨 Organization 数据读取泄漏：NO（限已实现 API 与本次测试范围）。** 数据库跨组织关联风险为 YES，具体见 H08，不能将两种结论混为“全系统不存在泄漏”。

| 检查 | 本次结果 |
|---|---|
| H01 活跃组织 | A=Owner/B=CustomerService；切 B 后 /me、组织查询均为 B；预算不返回、写组织=403；伪造 Cookie 回退有效 A。PASS |
| H02 角色授予 | Admin→Admin=403、角色未变；Admin→Owner=422；P↔C 及 Owner 授 Admin 的合法操作=200。PASS |
| H03 / D01 禁用语义 | A 禁用后旧 Cookie=401；全局 User 与 B Membership 保持 active；重新登录进入 B Owner。PASS，D01 方案 A RESOLVED |
| H04 公开注册 | 连续两次匿名请求均 403、AuthUser=0。关闭目标 PASS；第二次响应体问题单列 M03 |
| H05 邀请后会话 | 接受=200，框架 Cookie 访问 /me=200，重放=409；新浏览器 E2E 通过。PASS |
| H07 审计原子性 | 邀请创建/撤销/接受、组织修改、成员禁用注入审计失败，状态/版本/会话均不部分提交。PASS |
| H06 初始化身份 | 并发后认证身份丢失且重跑无法恢复。FAIL |

密码处理仍由 Better Auth 执行，数据库 Session、HttpOnly/Secure/SameSite 行为未替换为自制认证；现有邀请 token 用随机值、只存哈希、48h/重放/邮箱不符测试通过。登录错误未发现返回账号存在性差异；错误处理与限流欠缺单列 M02/M03。

Secrets 核验：本次扫描当前历史 14 个提交对应 167 个 blob，未发现私钥、典型云密钥/供应商 Key/GitHub Token 的强特征候选，历史未跟踪真实 `.env`；本地 `.env` 被 Git 忽略，仅核对变量名，未输出值。`.env.example` 的秘密值为空。但仓库确实含固定本地开发数据库口令、合成测试口令与测试 secret，不能写成“没有任何数据库密码/Token 字符串”。未发现真实生产 Secret 被提交的证据；模式扫描不能证明所有可能秘密绝对不存在。风险和最小配置处理见 M05。

## 9. 测试审查

**现有测试可信：YES，有真实断言和真实数据库；覆盖充分：NO。** 本次实跑结果如下，全部使用隔离副本/数据库与随机审查凭据。

| 检查 | 22 时续接后实测 |
|---|---|
| Node / pnpm / PG | 24.21.0 / 10.34.5 / 17.11 |
| offline frozen-lockfile install + Prisma generate | PASS |
| typecheck | PASS |
| Unit | 14/14 PASS |
| Integration | 46/46 PASS，7 文件，真实 PG |
| Web + Worker build | PASS（完整认证环境） |
| E2E | 8/8 PASS；保留 aborted/ECONNRESET 警告，不称零警告 |
| 空库 / 上版升级 / 重复迁移 | 命令 PASS；升级后的数据反例见 H08/H09 |
| HTTP/Cookie + 并发 + 审计故障 | H01/H02/H03/H04/H05/H07/D01 目标 PASS，H06 与 M01–M03 反例重现 |
| Worker 启停 / 缺 DB / Web 缺 Auth | 退出码 0/1/1/1，符合预期 |
| 健康接口 | DB 在线 200 ok，停止隔离 PG 后 503 degraded |
| Docker 两种干净 build 布局 | 分别 exit 1，缺生成客户端 / 缺构建认证环境 |
| 真实 Docker build / Compose / 容器迁移登录 | 未执行，环境无可用容器运行时；仍须补证 |

缺失的关键回归：初始化并发与身份链恢复；审计父行变化及升级历史坏行；全部领域时间列类型清单；干净镜像完整启动；输入错误/版本类型/来源/限流语义。现有 H09 测试只抽查 created_at/updated_at，现有 H06 测试只验证单次补偿成功，因而可以全部通过但漏掉上述缺陷。

建议把本报告的失败行为加入相应 TASK 回归，保留原测试。不得将静态 schema validate、测试数量或进度 DONE 作为阶段验收替代；未实现的下载/Job/AI/CSV 全链路在其任务到达时验证。

## 10. P0 范围检查

**是否存在超范围功能实现：NO。** 没有发现真实平台 API/OAuth、短信/社交登录、付费/计费、自动发邀请邮件、自动客服、竞品、库存/成本 ROI、Agent 执行或 P1/P2 数据表。TASK-002 建立未来 P0 任务会使用的表本身属于合同。根目录遗留副本按 L01 处理，不误称增加了新产品模块。

## 11. 过度设计检查

**是否存在需要整改的过度设计：NO。** 仍为单应用、单 PostgreSQL、Web/Worker 分进程；没有 Redis、第二数据库、RAG、微服务或自定义 RBAC。固定 capability、租户范围服务和小型认证适配门面与当前目标相称。无需为风格偏好改技术栈、引入基础设施或做大规模重构。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**NONE。** D01 已裁决方案 A，并在本次真实多组织登录/撤权流程再次通过。其他发现可在现有产品合同内技术修复，不重新询问 D01，不擅自更改 P0 或权限定义。Owner 阶段放行仍是后续独立动作。

## 13. Zcode 必须修复项

只列 CRITICAL/HIGH；CRITICAL 为 NONE。保持 Phase 1，按原 TASK 顺序一次处理一项。

| 归属/顺序 | 必修项 | 可执行完成标准 |
|---|---|---|
| TASK-001 | H10 | 修复生成客户端和构建环境；真实 Docker 干净 build→Web/Worker/PG→迁移→初始化→登录全部留证。无容器环境时明确缺证，不宣称通过。 |
| TASK-002 | H08 | 持续同域引用，覆盖父行变更、删除和并发；旧库坏引用被识别，升级不得静默通过；新增迁移、不篡改历史审计。 |
| TASK-002 | H09 | 补齐 14 个可空领域时间原生类型；核实历史值时区后新增迁移；全清单、同刻偏移、ORM/默认值、空库与上版升级通过。 |
| TASK-002/003 | H06 | 身份外键及删除/恢复策略与邮箱协调共同完成；init/init、init/invite、失败/中止、损坏身份重跑不产生悬空账号，成功初始化后能真实登录。 |

H01/H02/H03/H04/H05/H07 已通过，需保留回归，不要求推倒重做。M01–M05 和 L01 的处置在各自章节说明，不混入此必修 HIGH 清单。

## 14. 是否需要 Codex 复审

**YES。** ZCode 交付新冻结修复提交后，以 `c87a141..新提交` 为差异范围，复核 H06/H08/H09/H10、相应 Medium 处理及所有已关闭项回归；真实 Docker 证据是 H10 的必需部分。先核对最新 HEAD、未提交差异与迁移历史，不能再拿同一 c87a141 交接称“修复已完成”。

## 15. Gate 结论

- **允许 phase/01-foundation 合并 main：NO。**
- **允许开始 Phase 2 / TASK-005：NO。**
- 当前状态：Phase 1 / TASK-004 / 待修复 / Checkpoint=YES；下一工具 ZCode，使用 [P08_FIX.md](/Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/P08_FIX.md)。
- 技术测试通过、Gate 技术 FAIL/阶段 BLOCKED、Owner 未放行、GitHub 已提交版本、未提交管理文档、未部署分别记录。
- 后续顺序：ZCode 修复并自测 → Codex 独立复审 PASS → Owner 明确阶段放行 → 才能按原 Git 生命周期推进。

本轮只完成 Review 与审查/进度/交接文档维护。隔离运行环境清理、源文件保持不变、Product OS sync 和首页/总控读回的实际结果，以本次证据索引及唯一进度末尾记录为准。
