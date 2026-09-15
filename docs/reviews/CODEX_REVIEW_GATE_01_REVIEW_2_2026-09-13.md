# Gate 01 第二轮独立复审

审查人：Codex；日期：2026-09-13（Asia/Shanghai）；范围：Phase 1，TASK-001–004。

## 1. 结论：FAIL

**第二轮审查已完成，Gate 01 未通过。** H01/H02/H03/H04/H05/H07 及 D01 已通过本轮复核；H06/H08/H09/H10 仍有已复现的 HIGH 问题。没有确认新的 CRITICAL。真实 Docker 构建、启动、迁移、登录证据仍缺失，另记为 BLOCKED 检查项；已有确定的代码失败，因此总体用 **FAIL**，不能仅以“环境缺证”描述本轮结论。

- 分支：`phase/01-foundation`；首轮基线：`c263610541f8c8f7b41fd38c185f5feac94e8ee2`。
- 本轮审查提交：`c87a141648227954725402c715063a900fa72659`；复审差异：`c263610..c87a141`。
- main：`2a983cc55f136abbb49c5d02b55c1cb82b6547cc`；TASK-001/002 另检查当前完整应用，未把恢复基线排除在合同之外。
- 开始已有 8 份未提交管理文档；测试结束、写回前对照全部 126 个已跟踪文件，变化为 0。原管理差异另保存在证据目录的 `pre-review-management.patch`，首轮报告及证据保持原件。
- 本轮不修改原应用源码、Schema、迁移、依赖或既有测试；不提交、推送、合并、部署，不开始 TASK-005。复审脚本仅在临时副本执行，并作为审查证据保留。

证据主索引：[GATE_01_REVIEW_2_EVIDENCE.json](GATE_01_REVIEW_2_EVIDENCE.json)；原始日志及复现脚本：[gate-01-review-2-evidence/README.md](gate-01-review-2-evidence/README.md)。首轮 `GATE_01_EVIDENCE.json` 只证明 c263610，本轮没有复用它作为 c87a141 的通过证据。

## 2. H01–H10 / D01 逐项结论

| 项目 | 独立结论 | 实际证据与边界 |
|---|---|---|
| H01 活跃组织 | PASS | 真实 HTTP/Cookie：A=Owner、B=CustomerService，切 B 后 `/me` 和组织 GET 均为 B、预算字段不返回，PATCH=403，A 未被修改；伪造 Cookie 回退有效 A。既有权限集成同时通过。 |
| H02 拟授角色 | PASS | Admin 将 Operator 升 Admin=403、角色不变；授 Owner=422、未授权；P→C 和 C→P 均 200；Owner 授 Admin=200。Owner 属非法可授枚举，422 与“不能授予”一致，不把状态码差异误判成越权。 |
| H03 成员禁用 | PASS | A 禁用同时为 B Owner 的成员，旧 Cookie `/me`=401；全局 User 仍 active、B Membership 仍 active；重新登录=200、`/me`=200、active_org=B、role=owner。 |
| D01 方案 A | PASS / RESOLVED | 行为与既有 Owner 决策一致。当前不再询问产品裁决，也不把技术复核当 Owner 阶段放行。 |
| H04 公开注册 | PASS（关闭目标） | 连续两次真实匿名 URL 均 403、AuthUser=0；受控初始化和邀请均成功。第二次 403 响应体为空，归入 M03，不能称所有错误响应已正确。 |
| H05 邀请后会话 | PASS | 生产 Web 接受邀请=200，返回的框架 Cookie 访问 `/me`=200；重放=409。8 条 E2E 中的全新浏览器邀请流程通过。 |
| H06 身份一致性 | **FAIL** | 长姓名拒绝、单次故障补偿、邀请进程中止后恢复、已有用户并发接受均通过；并发 Owner 初始化会删除另一在途流程的认证身份，详见下文。 |
| H07 审计原子性 | PASS | DB CHECK 故障注入覆盖邀请创建/撤销/接受、成员禁用、组织改名。失败后领域状态、版本、审计均不部分提交；成员禁用失败时 2 个旧会话仍在且旧 Cookie 可用。未知异常非 JSON 500 单列 M03。 |
| H08 AuditLog 同域 | **FAIL** | 新增跨域 INSERT 被拒，同域/空 store 通过，删除店铺时 org 保留、store 置空；但 Store 父行改归属能留下跨域审计，旧库跨域记录在升级后原样存留。 |
| H09 时间类型 | **FAIL** | 77 列已转 timestamptz，已修列的默认值、ORM 和 UTC 墙钟升级样本通过；14 个可空领域时间列遗漏，实际仍可产生同一时刻相差 8 小时的记录。 |
| H10 Docker | **FAIL；容器实测另 BLOCKED** | deps 布局安装/生成通过；干净 build 布局缺生成客户端而失败，单独补客户端后又因构建期缺认证环境失败。无 Docker/Podman/Colima/Docker.app，未执行真实容器。 |

TASK 状态：001 因 H10、002 因 H08/H09及身份外键、003 因 H06/M01–M03 未完成验收；004 的首轮 HIGH 修复通过，但其现有写入口 M01/M03 仍需处理。唯一进度中四项继续 BLOCKED，表示仍有具体待修或待补证事项，不再笼统写“独立复审未执行”。

## 3. 尚未关闭的 HIGH

### H06：并发初始化会把成功 Owner 变成无认证身份的领域账号

位置：[ownerInit.ts:80](../../ai-ecommerce-assistant/src/services/ownerInit.ts#L80)，另见该文件 58–70 行的幂等返回与 97–140 行事务/补偿。

`initOwner` 在无共享邮箱锁的情况下，先查领域用户、再将同邮箱 AuthUser 当孤儿删除。使用代码已有 `testHookAfterAuth` 控制两个真实初始化流程的交错：流程 1 创建 Auth-1 后暂停；流程 2 看到尚无领域 User，删除 Auth-1、创建 Auth-2 后暂停；放行流程 1，其领域事务仍可引用已删除的 Auth-1 并成功；放行流程 2，领域邮箱唯一冲突，补偿又删除 Auth-2。

**实测最终状态：流程 1 成功、流程 2 失败；AuthUser=0、领域 User=1；领域引用不存在；普通重跑返回 `alreadyInitialized=true`，登录=401。** 这是对真实 Better Auth/PostgreSQL 的确定性交错注入，并非模拟数据库返回，也不是对生产事故已发生的断言。

最小修复：初始化和邀请使用一致的邮箱协调规则，权威判定、孤儿回收、在途创建与补偿不能互相误删；幂等返回前验证身份链完整；落实 M04 的认证外键及删除策略。不要只把现有故障 hook 用例再跑一遍。新增并发初始化、初始化与邀请交错、已损坏身份重跑的行为回归。

已通过但不足以关闭全项的证据：单次 Auth 后异常补偿；真实子进程在 Auth 创建后直接 exit 55，邀请仍 pending/Auth=1/领域=0，重试后 accepted/Auth=1/领域=1；同一已有用户并发接受结果 200/409，Membership 仅 1 条。

### H08：单边触发器未形成持续有效的同域约束

位置：[20260913044218_p0_audit_tenant_fk/migration.sql:8](../../ai-ecommerce-assistant/prisma/migrations/20260913044218_p0_audit_tenant_fk/migration.sql#L8)。

两个数据库反例均成功：① 插入 A 的店铺与合法 A 审计，随后把 Store.org_id 更新为 B，AuditLog 仍指 A，触发器未运行；② 在首轮两次迁移的旧库插入 A 审计引用 B 店铺，再执行两次新迁移，deploy=0，但跨域审计仍存在。前者为 DB 约束反例，当前没有公开“迁移店铺组织”接口，因此不夸大为已复现的普通用户越权。

迁移注释称 Prisma 不允许非空 org_id 与可空 store_id 的复合关系，该笼统理由不成立：固定 Prisma 7.10.0 对同样混合可空字段、可选关系、复合引用的最小 Schema 执行 `prisma validate` 已通过。这只证明关系可表达，不意味着生产删除策略已设计或验证。

最小修复：优先使用真正的复合引用约束，明确 store 删除时仅清空 store_id、保留非空 org_id 的策略；用新增迁移检测已有坏引用，拒绝静默通过，不能自动篡改历史审计。覆盖父行变化、升级存量、删除及并发下不变式。PostgreSQL 官方文档区分持续的外键约束与仅在写行时检查的触发器，且支持指定 SET NULL 的列，技术方案应据实际版本验证。[PostgreSQL 17 Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)

### H09：可空领域时间漏转，业务快照与交易时间仍可能错位

位置：[schema.prisma:500](../../ai-ecommerce-assistant/prisma/schema.prisma#L500)、692、798 行及下列其他字段；迁移 `20260913043631_p0_domain_timestamptz`。

数据库实查：领域/自建表 77 列为 timestamp with time zone，**14 列仍为 timestamp without time zone**：

- Store：input_evaluation_at、current_snapshot_evaluation_at、previous_snapshot_evaluation_at。
- Order.paid_at、RefundEvent.completed_at。
- AIInsight.generated_at、AIReport.generated_at。
- AIRun.started_at/finished_at、JobRun.started_at/finished_at。
- ImportTask.committed_evaluation_at、confirmed_at、committed_at。

对 Store.input_evaluation_at 写入 `2026-01-01 12:00:00+00` 与 `2026-01-01 20:00:00+08`，两种表示同一时刻，数据库读回相差 **8 小时**。测试用例只检查部分表的 created_at/updated_at，未检测这些遗漏。正常 ORM 将 Date 规范化的成功样本不等于数据库类型合同已满足；日期型 `@db.Date` 和认证框架四表不在本问题内。[PostgreSQL 17 Date/Time Types](https://www.postgresql.org/docs/17/datatype-datetime.html)

最小修复：按领域合同补齐全部可空时间原生类型，新增向前迁移；核对历史值的真实来源和时区后显式转换。全表类型清单、关键可空列 UTC/+08 等值、默认值/ORM、空库及上次版本升级均需验证。不得改写已共享迁移，也不能无证据把混合来源历史值都解释为 UTC。

### H10：修复只覆盖 deps，后续 build 仍不可用

位置：[Dockerfile:17](../../ai-ecommerce-assistant/Dockerfile#L17) 与 21–22 行。

从 c87a141 的已跟踪文件建立干净布局，不带开发机 `src/generated`，按 build 阶段只带入 deps 的 node_modules，执行 `pnpm build`：**exit 1，Cannot resolve `@/generated/prisma/client`**。生成物位于 deps 的 `/app/src/generated/prisma`，该目录没有 COPY 到 build。开发机未跟踪的生成目录可能掩盖此问题。

为单独检查下一层，仅在临时布局补生成客户端；保持 Dockerfile 构建期只给 DATABASE_URL，再运行 build：**exit 1，收集 `/api/v1/me` 配置时缺 BETTER_AUTH_SECRET/BETTER_AUTH_URL**。Compose 的运行环境不会自动进入镜像构建阶段。这两次都是本机的阶段布局复现，不冒称 Linux 容器实测。[Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)

最小修复：把正确版本的 Prisma 客户端生成/复制放到 build 可见的位置，给构建期合理的非生产占位或延迟认证实例初始化；真实运行配置仍须强校验，生产密钥不得烘入镜像。随后在可用 Docker 环境完成干净构建、Web/Worker/PG 启动、迁移、Owner 初始化及登录 smoke。**Docker 缺证不批准延到 TASK-029**，这是 TASK-001 的交付命令合同与 H10 原关闭标准。

## 4. M01–M04 延期核定

首轮 PHASE_PLAN 允许相称处理 Medium，不代表执行者可自行宣布所有项不阻塞。下表是 Reviewer 的技术处置结论，不是新的 Owner 产品裁决，也没有启动或扩展 TASK-005。

| 项目 | 本轮复验 | 核定与完成时点 |
|---|---|---|
| M01 | 人工附带有效 Cookie、非可信 Origin、text/plain，创建邀请仍=201。未演示真实浏览器跨站攻击。 | **ACCEPT，拒绝整项延期。** TASK-003/004 的现有写入口在 Gate 01 PASS 前统一校验可信来源、Content-Type/必要 CSRF 条件；保持正常同源和受控脚本行为。实际部署域名/代理的浏览器验证仍属 TASK-029。 |
| M02 | 错误密码=401，持久 count=1；缺 password=400 后记录被删除。代码仍直接信任客户端 x-forwarded-for。 | **ACCEPT，拒绝核心语义延期。** TASK-003 在 Gate 01 PASS 前仅对明确认证成功清零，400/429 等不能清零；明确可执行的代理信任规则，不能任意信任公网传入头。补相称限流回归，实际反代配置在 TASK-029 再验。 |
| M03 | name 数字已=422；body=null 仍非 JSON 500；expected_version=1.1 被接受为 200，组织真实改名；连续第二次注册拒绝返回空 403；审计故障返回非 JSON 500。 | **MODIFY。** Gate 01 PASS 前补齐当前 Phase 1 接口的对象、类型、长度、正整数版本校验与稳定错误信封，每次注册拒绝创建新 Response。安全日志与响应关联 request_id；不建通用异常平台。未来端点在各自 TASK 内复用，不为本轮实现未来 API。 |
| M04 | 非 UUID id 和不存在 auth_user_id 的领域用户仍可写；H06 进一步证明当前执行路径确能制造断裂身份。 | **MODIFY，拆分处理。** auth_user_id 外键及删除/恢复策略在 TASK-002/003、Gate 01 PASS 前完成。领域 UUID 的数据库格式约束可 **DEFER** 至“首次后续 Schema 变更或 TASK-028 演示包前，取较早者”，仍登记为 TASK-002 技术债；不将认证框架 string 主键改 UUID。当前应用生成正常 UUID，未证实 TEXT 存储构成越权；此局部延期不等于放弃 P0 合同。 |

## 5. 实际执行结果与证据限制

测试在 c87a141 临时源码副本、独立 PostgreSQL 17.11 集群 `127.0.0.1:55449` 执行。开发库 5433 未用于这些写入。使用本次随机测试密码/认证密钥；无客户数据、生产凭据或收费模型调用。

| 检查 | 结果 |
|---|---|
| Node 24.21.0 / pnpm 10.34.5，offline frozen-lockfile install | PASS，锁文件安装及 postinstall generate 实际执行 |
| `pnpm typecheck` | PASS |
| `pnpm test` | 14/14 PASS |
| `pnpm test:integration` | 46/46 PASS，7 文件、真实隔离 PG |
| `pnpm build`，完整审查环境 | PASS，Web + Worker |
| `pnpm test:e2e` | 8/8 PASS；日志保留一次 ECONNRESET/aborted，未写成零运行警告 |
| 新空库完整迁移；旧两次迁移→当前四次；重复 deploy | 命令均 PASS；旧行 UTC 墙钟转换样本通过；约束/遗漏问题另按 H08/H09 判 FAIL |
| 补充 HTTP、数据库、进程中止/并发和审计故障探测 | 逐项结果见本报告与 JSON；现有测试通过不覆盖这些全部反例 |
| Worker 启动/停止后状态；缺 DB；Web 缺 Auth 环境 | 退出码 0/1/1/1，均符合预期 |
| 健康接口数据库在线/停止 | 200 `{status:ok}` / 503 `{status:degraded}` |
| Docker deps 布局安装生成 | PASS |
| Docker build 布局；补客户端后的 Auth 构建隔离 | 两次 exit 1，分别证明 H10 的两个缺口 |
| 真实 Docker build/compose/登录 | 未执行；本机无可用容器运行时，补证仍是关闭 H10 的必要条件 |

环境记录：首次临时依赖准备不完整，出现模块/命令缺失，未将这些结果记为产品缺陷；完整离线安装后重跑 integration/build 得到上述结果。撤销邀请故障探测第一次将 expected_version 放 body，接口实际从 query 取值，因此该次 422 不证明回滚；后续 `?expected_version=1` 补测得到 500、pending/version=1/audit=0，使用 `supplement.json` 为该项依据。

认证、SQL 的行为判断优先依据当前固定版本与实测。附带官方资料仅解释多阶段复制、时间类型及约束机制，不替代应用验收。

## 6. 交接、放行与收尾

下一工具 **ZCode**，完整提示词 [P08_FIX.md](../../prompts/P08_FIX.md)。按原 TASK 顺序逐项修复 H10 → H08/H09/身份外键 → H06及 M01–M03 → TASK-004 的共同入口回归；保留本轮已经通过的行为测试。每项写 ACCEPT/DISCUSS/REJECT、修改提交、实际回归和残余缺口。无新产品决策请求。

修复后由 Codex 以 **c87a141..新冻结提交** 做下一轮独立复审；本轮报告和首轮历史均保留。新冻结版本须核对 Git 与管理差异，不能把本轮未提交审查文件误写成已经远端同步。

- 技术测试：上述套件通过，补充反例存在。
- Gate 审查：**FAIL**。
- Owner 阶段放行：**未取得**；未来 Review PASS 也仍须单独取得。
- GitHub：本轮只读实查两个远端 ref，phase=c87a141、main=2a983cc；本轮文档未提交/推送。
- 部署与真实试用：未执行；线上状态 unknown。
- 允许合并 main / 进入 Phase 2 / TASK-005：**NO**。

本轮隔离 Web/Worker/PG 已停止，临时故障约束剩余 0；最终临时目录删除、应用哈希复核、Product OS sync 与读回结果在唯一进度末尾及证据 JSON 中记录。不得因视图刷新而自动放行。
