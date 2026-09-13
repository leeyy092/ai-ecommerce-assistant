# CODEX REVIEW｜GATE 01

审查人：Codex（独立技术 Reviewer）｜日期：2026-09-13（Asia/Shanghai）｜范围：Phase 1，TASK-001–004。

## 1. 最终结论

**BLOCKED。当前不允许合并 main，不允许开始 Phase 2 / TASK-005。**

发现 10 项 HIGH、4 项 MEDIUM；未确认 CRITICAL。现有测试确实通过，但真实 HTTP 和数据库反例证明权限、邀请、事务、数据库约束及容器构建仍不满足阶段验收。BLOCKED 表示本 Gate 未通过，并非本次审查未完成。

审查基线：`main = 2a983cc`；开发分支 `phase/01-foundation`；冻结提交 `c263610541f8c8f7b41fd38c185f5feac94e8ee2`。`main..phase/01-foundation` 为 45 个文件、3176 行增加、97 行删除；TASK-003 提交 `a77f7b5`、TASK-004 提交 `1ab433f`。TASK-001/002 已因恢复事故并入 main 基线，未出现在本轮分支差异中；为完成用户指定的四项验收，本报告对其当前代码快照进行了检查，不能用现有 Git 历史证明丢失提交前后的逐字节等价。

审查开始已有 `12_PROGRESS.md` 管理修改及 4 个未跟踪管理文件，不能称整个工作区 clean。审查期间未改应用代码、Schema、Migration、依赖或现有测试，未提交、推送、合并、部署。仅交付审查报告、证据与管理状态更新。

证据：[GATE_01_EVIDENCE.json](GATE_01_EVIDENCE.json)。检查使用独立 PostgreSQL 17.11 集群（127.0.0.1:55439）和随机测试口令，未使用客户数据；原开发数据库 5433 未用于这些写入。原测试日志保存在 [gate-01-evidence/](gate-01-evidence/)。

## 2. TASK 验收

| TASK | 结论 | 实际依据与缺口 |
|---|---|---|
| TASK-001 | **FAIL** | Web/Worker 本地启动、生产构建、健康检查、缺配置失败、Worker 停止检测通过；Dockerfile 的依赖阶段可复现缺 Schema 导致 postinstall 失败，Compose 也未传入 TASK-003 后必需的认证配置。见 H10。不能因本机没有 Docker 就将已发现的配置错误延后。 |
| TASK-002 | **FAIL** | 空库两次迁移 deploy 及现有约束测试通过；多数业务关联采用复合外键、金额为 Decimal；AuditLog 可写入异组织店铺，领域时间类型未落实 timestamptz。见 H08/H09，另见 M04。 |
| TASK-003 | **FAIL** | 登录、退出、改密拒绝旧密码、Owner 幂等、邀请哈希/过期/邮箱不符/重放等已有证据；公开注册仍开启，邀请返回无效 Cookie，失败可能残留 Auth 身份并永久阻断普通重试，管理写入不原子。见 H03–H07。 |
| TASK-004 | **FAIL** | 固定能力映射、单组织客服字段裁剪、跨组织成员 ID 404 等通过；切换组织上下文不一致、Admin 可授予 Admin、租户管理者可禁用其他组织 Owner 的全局身份。见 H01–H03。 |

FAIL 是对完整验收合同的判断，不表示该 TASK 没有实现或所有测试都失败。旧 DONE 记录作为历史保留，当前任务表须标记需修复重新验收。

## 3. CRITICAL

**NONE。** 未证实匿名直接读取企业数据、非成员任意读取其他租户数据或数据库整体损坏。不得把下面的具体风险升级为已发生的大规模泄漏。

## 4. HIGH

### H01｜切换组织只影响 /me，业务 API 仍使用第一条 Membership

- **问题：**显示上下文与服务端授权上下文不一致。
- **位置：**[session.ts:49](../../ai-ecommerce-assistant/src/lib/session.ts#L49)、[access/index.ts:60](../../ai-ecommerce-assistant/src/services/access/index.ts#L60)、[me/route.ts:46](../../ai-ecommerce-assistant/src/app/api/v1/me/route.ts#L46)。
- **证据：**同一账号在 A 为 Owner、B 为 CustomerService。切换 B 返回 200，`/me` 返回 B/customer_service；`GET /organization` 却返回 A 及预算；随后 PATCH 返回 200，数据库中 A 的名称被修改。`getSessionContext` 固定 `memberships[0]`，没有采用经成员关系验证的 active-org Cookie。
- **风险：**数据在错误的组织界面呈现，写请求修改错误租户；后续列表、缓存和导入若复用入口会继承问题。本例账号本来有 A 的权限，不能据此称“非成员能读取 A”。
- **建议修复方式：**集中解析、验证活跃组织，`/me` 与 `requirePermission` 使用同一结果；Cookie 只能选择当前有效成员关系，不能自授权限；验证 A/B 各不相同角色、切换后读写、失效 Cookie 和非成员组织。

### H02｜Admin 可以把 Operator 提升为 Admin

- **问题：**仅校验目标成员的旧角色，未校验拟授予角色。
- **位置：**[members/[id]/route.ts:39](../../ai-ecommerce-assistant/src/app/api/v1/members/[id]/route.ts#L39)、[access/index.ts:105](../../ai-ecommerce-assistant/src/services/access/index.ts#L105)。
- **证据：**Admin 对 Operator 成员提交 `{role:"admin", expected_version:1}`，HTTP 200，数据库角色实际变为 admin。原权限表及路由注释限定 Admin 管理 Operator/CustomerService。
- **风险：**绕过 Owner 的管理员授权权力；不能用“Admin 不能操作当前 Admin”代替对新角色的检查。
- **建议修复方式：**同时检查操作者、目标旧角色和目标新角色；Admin 仅允许 Operator↔CustomerService，拒绝授予 Owner/Admin；以实际 PATCH 请求覆盖反例及 Owner 的合法操作。

### H03｜一个组织的成员禁用会禁用账号在其他组织的身份

- **问题：**租户成员管理修改了全局 `User.status`。
- **位置：**[members/[id]/route.ts:66](../../ai-ecommerce-assistant/src/app/api/v1/members/[id]/route.ts#L66)、[session.ts:40](../../ai-ecommerce-assistant/src/lib/session.ts#L40)。
- **证据：**账号在 A 是 Operator、在 B 是 Owner。A 的 Owner 禁用它后，B 的 Membership 仍 active，但全局 User 变 disabled；重新登录认证返回 200，业务 `/me` 仍为 401。启用 A 成员也直接重新启用全局 User。
- **风险：**A 的管理者可让 B 的唯一 Owner 无法使用系统，并可能撤销本应仅由全局运维控制的禁用。
- **建议修复方式：**隔离组织成员撤权与全局账号停用；不可让租户成员 API 直接决定其他组织的有效性。多组织下仍应实时撤权，撤销旧 session 后也应允许在其余有效组织重新登录。具体状态语义见第 12 节 D01，禁止自行改变产品定义。

### H04｜公开注册 API 实际开启

- **问题：**注释和交接声称关闭公开注册，实际配置与路由未关闭。
- **位置：**[auth.ts:35](../../ai-ecommerce-assistant/src/lib/auth.ts#L35)、[auth/[...all]/route.ts:54](../../ai-ecommerce-assistant/src/app/api/auth/[...all]/route.ts#L54)。
- **证据：**无邀请、无登录时 POST `/api/auth/sign-up/email` 返回 200，创建 AuthUser 并下发认证 Cookie。新账号 `/api/v1/me` 为 401，因为没有领域 User/Membership。现有测试从未对该公开 URL 作拒绝断言。库配置与入口行为也与 [Better Auth email/password 文档](https://www.better-auth.com/docs/authentication/email-password)一致。
- **风险：**违反受控账号创建合同，可抢先占用受邀邮箱、创建孤立账号并阻断正常邀请；本次未证实由此直接获得企业数据。
- **建议修复方式：**关闭外部公开注册入口，同时保留受控初始化/邀请的服务端创建路径；不能只增加 `disableSignUp` 却把内部共用 `signUpEmail` 一并破坏。补匿名 URL 拒绝及两条受控路径成功测试。

### H05｜邀请成功下发的 Cookie 无法建立可用会话

- **问题：**路由手工把裸 session token 当作 Better Auth Cookie；未沿用框架签名和生产 Cookie 命名规则。
- **位置：**[accept/route.ts:56](../../ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/accept/route.ts#L56)、[AcceptForm.tsx:38](<../../ai-ecommerce-assistant/src/app/(auth)/invite/[token]/AcceptForm.tsx#L38>)。
- **证据：**生产构建下接受邀请返回 200，Cookie 名为 `better-auth.session_token`；携带原样 Cookie 请求 `/me` 为 401。用同一新账号正常登录后 `/me` 为 200。页面成功后直接跳 `/`，没有引导正常登录。
- **风险：**首次受邀加入的登录流程失败；服务端返回成功但用户没有实际可用登录态。
- **建议修复方式：**采用框架正式返回的完整 Set-Cookie；若按现有 API 合同选择“接受后正常登录”，则不伪造 Cookie，并明确跳转登录。覆盖生产配置下浏览器接受邀请到受保护请求的完整路径。

### H06｜邀请/身份创建失败后留下不可正常重试的 AuthUser

- **问题：**Auth 创建、token 消费、领域身份和成员写入分属不同事务；异常补偿只恢复 invitation。
- **位置：**[invitations.ts:208](../../ai-ecommerce-assistant/src/services/invitations.ts#L208)、[invitations.ts:232](../../ai-ecommerce-assistant/src/services/invitations.ts#L232)、[ownerInit.ts:76](../../ai-ecommerce-assistant/src/services/ownerInit.ts#L76)。
- **证据：**以 81 字符姓名接受有效邀请：HTTP 500；数据库 AuthUser=1、领域 User=0、邀请仍 pending。姓名改短重试返回 409“该邮箱已存在账号”。此孤立账号又不能通过 `getSessionContext` 成为已有领域用户，常规登录重试不能完成加入。Owner 初始化也采用“先建 Auth，再建领域事务”的同类结构，该入口的故障后果尚未单独注入复现。
- **风险：**可用邀请被异常路径锁死；token 消费与领域提交之间进程退出也可能留下不一致状态。
- **建议修复方式：**先做服务端完整输入校验；将可合并的 token CAS、User、Membership、Audit 写入同一事务；对认证库创建提供明确原子性或安全、幂等的恢复方案。补 Auth 创建后失败、CAS 后失败、并发已有用户接受及初始化故障恢复，不能仅捕获异常改回 token。

### H07｜成员/邀请管理与审计不原子，失败时权限已变化

- **问题：**管理写入先提交，再单独写审计；组织 PATCH 根本没有审计。
- **位置：**[members/[id]/route.ts:54](../../ai-ecommerce-assistant/src/app/api/v1/members/[id]/route.ts#L54)、[invitations.ts:114](../../ai-ecommerce-assistant/src/services/invitations.ts#L114)、[organization/route.ts:63](../../ai-ecommerce-assistant/src/app/api/v1/organization/route.ts#L63)。
- **证据：**仅在隔离数据库注入 `member_update` 审计写入失败，PATCH 返回 500，成员却已变 admin、row_version=2，audit 条数=0；注入约束随后移除。原文 04 §10.7 明确要求每次 CAS 与 AuditLog 一起提交。
- **风险：**用户收到失败但权限已变更，重试又遇版本冲突；关键操作没有可追溯记录。
- **建议修复方式：**成员 CAS、必要的会话撤销、审计同事务；邀请创建/撤销同样处理；组织名称变化补审计。故障注入断言必须证明失败后业务状态、版本与审计均未提交。

### H08｜AuditLog 的店铺外键允许异组织引用

- **问题：**审计表分别引用 org_id 与 store_id，店铺关联仅按 store.id。
- **位置：**[schema.prisma:1330](../../ai-ecommerce-assistant/prisma/schema.prisma#L1330)、[p0_init/migration.sql:1498](../../ai-ecommerce-assistant/prisma/migrations/20260912102945_p0_init/migration.sql#L1498)。
- **证据：**实际数据库接受 `AuditLog.org_id=A` 且 `store_id=B组织店铺` 的 INSERT；没有同域约束拒绝。与大量事实表已经实现的 `(org_id,store_id)` 外键不同。此项来自恢复基线，不是 TASK-003/004 新增差异。
- **风险：**后续按组织查审计可混入其他组织店铺引用，破坏审计归属与查询隔离基础。目前尚无面向用户的审计查询 API，因此未宣称已通过此表读取客户数据。
- **建议修复方式：**使用店铺复合外键并明确可空店铺的删除行为，不可让删除店铺误清空非空 org_id；以新增迁移处理，覆盖合法空 store_id、同域与异域记录、删除约束。

### H09｜领域时间列未采用合同规定的 timestamptz

- **问题：**领域 `DateTime` 未指定数据库原生带时区类型，数据库默认时间写入依赖会话时区。
- **位置：**[schema.prisma:402](../../ai-ecommerce-assistant/prisma/schema.prisma#L402)、[schema.prisma:500](../../ai-ecommerce-assistant/prisma/schema.prisma#L500)、[04_DATA_MODEL.md:15](../ai-ecommerce-assistant/04_DATA_MODEL.md#L15)。
- **证据：**全库有 103 个 `timestamp without time zone` 列（其中也包括官方 Auth 字段，不意味着全部应统一修改）。在同一 PostgreSQL 事务中分别以 UTC、Asia/Shanghai 会话通过 `domain_user.created_at` 默认值插入，两条同一时刻记录相差 8 小时；事务已回滚。正常邀请样本的 created/updated 未观察到此偏差，因此不声称所有当前 API 已写错时间。
- **风险：**未来 CSV、原生 SQL、Worker、默认值混用时，同一时间可被存为不同值，影响事件日、D+7、邀请有效期及版本时间；等有真实业务数据后迁移更难。
- **建议修复方式：**领域和自建表按合同明确 timestamptz；认证框架表单独遵守固定版本官方约定。迁移必须先确认历史无时区值的真实时区，明确转换，不能盲目按本机时区 cast；补 UTC/+08 同一时刻、默认值与 ORM 路径的等值验证。

### H10｜Docker 依赖阶段必然缺少 Prisma Schema，Compose 认证环境也未补齐

- **问题：**依赖层只 COPY package/lock/config 后即安装，项目 postinstall 当时就运行 `prisma generate`；Compose Web 未注入必需 Auth 环境。
- **位置：**[Dockerfile:8](../../ai-ecommerce-assistant/Dockerfile#L8)、[package.json:15](../../ai-ecommerce-assistant/package.json#L15)、[compose.yaml:25](../../ai-ecommerce-assistant/compose.yaml#L25)、[instrumentation-node.ts:11](../../ai-ecommerce-assistant/src/instrumentation-node.ts#L11)。
- **证据：**在与 deps COPY 完全相同的文件布局执行当前 postinstall，退出 1：`Could not find Prisma Schema`。`.dockerignore` 排除 `.env`；Compose 仅传 DATABASE_URL/LOG_LEVEL，未传 BETTER_AUTH_SECRET/URL；启动代码明确要求两者。本机无 Docker，未执行真实 docker build/compose，不能将该隔离复现称为容器实测。
- **风险：**交付的标准启动命令无法完成镜像构建，修过生成顺序后仍需补正确的构建/运行配置。TASK-001 的交付入口不可用。
- **建议修复方式：**在正确层提供 Schema/config 并执行客户端生成；避免依赖未 COPY 的文件。区分安全构建占位与真实运行密钥、在 Compose 显式注入 Auth 配置；真实 Docker 环境完成干净构建、迁移和登录 smoke，生产密钥不得写入镜像层。

## 5. MEDIUM

### M01｜业务写 API 没有 Origin/CSRF 校验

- **问题：**`/api/v1` 手写路由不经过 Better Auth 的写请求保护，且直接按 JSON 解析 text/plain 内容。
- **位置：**[invitations/route.ts:16](../../ai-ecommerce-assistant/src/app/api/v1/invitations/route.ts#L16)及其他 v1 写路由。
- **证据：**携带有效 Cookie、`Origin: https://untrusted.example.test`、`Content-Type: text/plain` 的邀请创建返回 201。此为手动携带 Cookie 的服务端反例，未在实际部署域名完成浏览器跨站攻击演练。
- **风险：**同站不同源的子域等浏览器会带 Cookie 的情形存在 CSRF 面；SameSite=Lax 会阻止许多普通跨站情形，因此不能据此声称任意第三方网站都能攻击成功。
- **建议修复方式：**已有写入口统一验证可信 Origin/必要 CSRF 条件和 Content-Type；在实际部署域名验证正常调用及不可信来源请求。

### M02｜400/429 等失败响应也会清空持久登录失败计数

- **问题：**包装层只保留 401，其他所有状态都 resetRateLimit。
- **位置：**[auth/[...all]/route.ts:46](../../ai-ecommerce-assistant/src/app/api/auth/[...all]/route.ts#L46)。
- **证据：**同 IP 一次错误密码返回 401，DB count=1；随后缺 password 的请求返回 400，计数行被删除。另一次高频探测触发了库本身的 429，说明还有框架限流；不能说系统完全没有限流。X-Forwarded-For 的可信来源也尚未固定。
- **风险：**不满足“成功登录才清零”的持久防护语义，进程重启/多个实例时不能依赖框架内存限流兜底。
- **建议修复方式：**仅明确成功的认证响应清零；固定代理信任边界；回归错误凭据、坏请求、框架 429、重启后的累计次数。

### M03｜输入类型/长度与未预期异常没有统一 API 错误响应

- **问题：**TypeScript 类型断言替代运行时验证，未匹配异常直接 throw。
- **位置：**[organization/route.ts:49](../../ai-ecommerce-assistant/src/app/api/v1/organization/route.ts#L49)、[http.ts:54](../../ai-ecommerce-assistant/src/lib/http.ts#L54)、[invitations.ts:224](../../ai-ecommerce-assistant/src/services/invitations.ts#L224)。
- **证据：**合法 Owner 提交 `{name:123, expected_version:1}` 得到非 JSON 500；H06 中超长姓名同样 500。所有 signUp 异常又统一伪装成“邮箱已存在”，不能准确说明校验/数据库失败。
- **风险：**客户端收不到字段错误和稳定 request_id，用户可能误判操作是否已提交；与 H07 联合时尤其难恢复。
- **建议修复方式：**使用已有 Zod 或同等简单服务端校验，限制类型、长度与正整数版本；区分已知冲突/验证/数据库暂不可用和未知错误，安全日志与响应共享 request_id，不回传内部值。

### M04｜领域身份映射没有外键，UUID 仅靠应用生成

- **问题：**`User.authUserId` 只有 UNIQUE，没有 AuthUser 外键；领域 id 为 TEXT，没有数据库 UUID 格式约束。
- **位置：**[schema.prisma:396](../../ai-ecommerce-assistant/prisma/schema.prisma#L396)。
- **证据：**隔离事务成功插入 `id='not-a-uuid'` 且 auth_user_id 指向不存在认证账号的领域 User，随后回滚。部分现有测试也直接构造不存在的 authUserId。
- **风险：**维护脚本/故障恢复可制造孤立领域身份，数据库不能保证映射存在。TEXT 存储正常 UUID 本身不是已确认的权限绕过，因此列 MEDIUM。
- **建议修复方式：**领域到认证身份补明确关系/删除策略并调整 fixture；按合同落实领域 UUID 的数据库验证或原生类型，不改认证库的字符串主键。与 H09 迁移一起评估现有数据，但不把两个问题混为一个。

## 6. LOW

**NONE。** 未将重复注释、格式和个人编码偏好列为必修问题。

## 7. 数据库审查

**结论：部分正确，整体 FAIL。是否允许进入下一 Phase：NO。**

已确认：空库迁移成功；重复 deploy 无待执行迁移；单 Owner 部分唯一、商品/订单等自然键、主要事实表同组织同店复合外键、数量/金额/币种 CHECK、Decimal 金额、关键版本字段已存在；现有约束测试实际通过。官方 Auth 表使用其框架表名，未强制 UUID。P1 成本、库存、竞品运行实体未建立。

风险：H08 审计归属、H09 时间语义和 M04 身份引用；H06/H07 另说明数据库事务使用不正确。多数领域关系使用 RESTRICT，Auth session/account 随认证用户级联；AuditLog 的 SET NULL 删除行为须与复合关联一并确定。没有发现需新增数据库、微服务或通用权限引擎的理由。

迁移复审必须分别验证“新空库全链路”和“现有迁移版本向前升级”，不改写已共享迁移伪造通过。

## 8. Auth / 权限 / 多租户审查

**结论：FAIL。是否存在跨 Organization 泄漏：YES——已复现活跃组织上下文串域；未证实非成员可任意读取其他组织。**

H01 中 B/customer_service 的显示上下文实际收到 A/owner 的组织与预算数据，并能误改 A；H03 中 A 的成员操作让 B 的 Owner 失效。这两条必须阻断后续复用。

通过的反例控制包括：未登录业务请求 401；CustomerService 读成员列表 403；单组织 CustomerService 组织 DTO 不含预算字段；B Owner 按 A 成员 ID 修改返回 404；正常退出后旧 Cookie `/me` 返回 401；正常改密后旧密码返回 401。现有邀请过期/邮箱不符/撤销和重放测试通过；密码交给 Better Auth 哈希，不自造密码算法。

文件下载、旧 job、Dashboard/AI 经营证据等对象尚未实现，不能因为权限纯函数已有就写成这些业务路径已实际安全验证。后续 TASK-007/013/019 等继续按本来的验收合同补验证。

Secrets：扫描本地可达 7 个 Git 提交、125 个 blob，没有发现真实 provider key/私钥、当前 `.env` Secret 值或被跟踪的 `.env`；`.env` 被 ignore，`.env.example` 相关字段为空。Compose 含明确的本地样例密码 `aiea_local_dev`，不是“代码没有任何密码字符串”。这不是对远端已删除历史或所有可能密钥形式的绝对保证。本次不输出真实密钥、Cookie/token 或数据库连接凭据。

## 9. 测试审查

**现有测试是否可信：执行结果可信，但覆盖不足以证明 TASK-001–004 完整验收。**

| 独立执行 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm test` | 14/14 PASS |
| `pnpm test:integration` | 28/28 PASS；真实隔离 PG17 |
| `pnpm exec prisma migrate deploy` | 现有两次迁移成功；重复运行无待应用迁移 |
| `pnpm build` | PASS，Web+Worker；使用审查环境必要变量 |
| `pnpm test:e2e` | 6/6 PASS |
| Worker 启动 / 停止后 status | exit 0 / exit 1，PASS |
| Worker 缺 DATABASE_URL | exit 1，错误准确提到变量名，PASS |
| Docker deps 布局执行 postinstall | exit 1，发现 H10 |
| 真实 HTTP / 数据库反例、审计故障注入 | 结果见上述问题及证据 JSON |
| 隔离 PG 停止后的健康接口 | HTTP 503 `{status:degraded}`，PASS |
| 真正 Docker build/Compose、线上环境 | 未执行；本机无 Docker，未部署 |

E2E 日志有一次请求中止 ECONNRESET，六条断言仍通过；保留原日志，不将其写成零控制台错误。

现有测试的问题：公开注册用例名称写“无公开入口”，实际只调用内部初始化/登录；禁用用例直接改数据库，没有经过成员 PATCH；并发新用户接受测试会同时受认证邮箱唯一约束影响，不能单独证明 token 与成员事务的崩溃恢复；角色矩阵没有覆盖“旧角色允许、新角色禁止”；六条 E2E 未覆盖邀请接受和登出按钮路径。部分“关键能力已覆盖”描述超过断言范围。

建议：为 H01–H10 各保存能先失败、修复后通过的行为回归，优先真实 HTTP+Cookie、真实 PG、同一用户双组织和故障注入；保留既有通过测试作回归。补 M01–M04 的相称测试即可，不添加纯样式或镜像实现测试，不要求本 Phase 实现未来文件/AI功能。

## 10. P0 范围检查

**是否存在超范围实现：YES。** H04 暴露了不在受控邀请范围内的公开注册能力，属于配置导致的未授权入口。

未发现提前开发 P1/P2 业务、自动发送邀请、短信/社交登录、计费、真实平台操作。TASK-002 提前建立合同定义的 P0 数据表属于该任务本来范围；成员/组织 API 与后续 UI 分开实现也有任务依据。

## 11. 过度设计检查

**是否存在：NO。**

保持单应用、同仓 Web/Worker、单 PostgreSQL；未新增 Redis、向量库、RAG、Agent 编排或可配置 RBAC。固定 capability 映射和一个轻量 Prisma 委托门面不构成当前阻塞；升级认证库时再复核适配兼容性。不建议为本轮问题改技术栈、重命名整个模型或新建基础设施。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**D01｜全局账号禁用与组织成员禁用的业务语义。**

需要 GPT/Owner 确认：租户 Owner/Admin 的“禁用成员”是否只撤销本组织 Membership，以及 `User.status=disabled` 是否仅用于受限部署运维的全局停用。

- **方案 A（建议）：**成员管理仅控制本组织有效性；其他 active Membership 保持可登录使用；全局状态不由租户成员 API 修改。技术上可复用现有两层状态，无须增加新 UI 或服务。
- **方案 B：**产品确实需要全局封禁时，由受限全局运维操作承担，记录全局影响和审计；租户 Owner/Admin 仍不能仅凭本组织角色封禁其他组织账号。P0 可沿用受限运维流程，不为此新增后台平台。

如果要求普通租户管理员直接全局禁用共享账号，该要求与租户隔离相冲突，本 Reviewer 不建议放行。不能把当前跨组织失权当作已获批准的业务规则。其他问题均可在现有合同内技术修复，不需要新产品需求。

## 13. Zcode 必须修复项

仅列 CRITICAL/HIGH；本次没有 CRITICAL。遵守一次一个 TASK，仍在 `phase/01-foundation` 修复，不开始 TASK-005。

| 顺序/归属 | 修复项 | 完成判据 |
|---|---|---|
| TASK-001 | H10 容器生成顺序与 Auth 配置 | 正确 COPY 后生成 Prisma；干净容器构建/启动/迁移/登录；容器实测未具备时如实保留缺口 |
| TASK-002 | H08 审计同域 FK | 同域/空 store 合法，异域 INSERT 被 DB 拒绝，删除语义正确 |
| TASK-002 | H09 领域时间原生类型 | 审核历史时区后新增迁移；同一时刻跨时区/默认值/ORM 等值，空库与升级均通过 |
| TASK-003 | H04 关闭匿名注册 | 无邀请 sign-up URL 拒绝；初始化和邀请创建仍成功 |
| TASK-003 | H05 邀请后会话流程 | 浏览器接受后得到真正可用会话，或按合同明确正常登录，不再伪造 Cookie |
| TASK-003 | H06 邀请/身份一致性 | 长度/类型错误无副作用；故障和进程中断可恢复；无孤立 Auth 身份卡死重试 |
| TASK-003/004 | H07 管理写入与审计 | 审计故障时权限/版本/会话不部分提交；组织 PATCH 留完整审计 |
| TASK-004 | H01 活跃组织统一 | `/me`、组织读写、角色和缓存选择一致；未授权组织仍拒绝 |
| TASK-004 | H02 授予角色校验 | Admin→Admin/Owner 拒绝；允许的两种低角色调整和 Owner 操作通过 |
| TASK-004 | H03 禁用范围 | D01 裁决落实；A 禁用不让 B Owner 失效，A 旧权限立即撤销 |

ZCode 修复后逐项写 ACCEPT/DISCUSS/REJECT、修改提交、回归结果及剩余缺口；不能将“修复已提交”当作“复审已通过”。

## 14. 是否需要 Codex 复审

**YES。**

复审基于本次冻结提交 `c263610` 到修复提交的实际差异，覆盖 H01–H10 和 D01 裁决落实；复跑必要的原测试和反例，重点真实 Cookie、多组织读写/撤权、邀请失败与并发恢复、审计故障回滚、迁移升级和容器启动。代码、Schema 与实际 HTTP 行为一致后才能改 Gate 结论。

## 15. Gate 结论

- **允许 `phase/01-foundation` 合并 `main`：NO。**
- **允许开始 Phase 2 / TASK-005：NO。**
- **下一步：**Owner/GPT 确认 D01；ZCode 按本报告修复 Phase 1；Codex 复审；最终 Owner 放行。

本轮仅完成 Review 与报告/进度/交接文档维护。应用源代码未修改，无 Git 提交或远端写操作。当前修复交接入口为 [P08_FIX.md](../../prompts/P08_FIX.md)；Product OS 只显示该待修状态，不自动启动开发或放行。

管理收尾：唯一进度、交接及P08修复提示词已更新；Product OS sync成功，项目首页与总控读回为TASK-004/待修复/ZCode/Checkpoint YES。隔离Web、Worker、PG已停止，临时数据库及随机凭据已删除，报告证据保留。原99个已跟踪文件中应用文件零修改。
