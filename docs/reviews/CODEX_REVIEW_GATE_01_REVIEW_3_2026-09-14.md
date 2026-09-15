# CODEX REVIEW｜GATE 01

Reviewer：Codex｜2026-09-14｜第三轮独立复审｜范围：Phase 1 / TASK-001–004。

## 1. 最终结论

**BLOCKED。项目协议中的技术审查结果为 FAIL。** 审查已经完成，当前有两项已复现 HIGH：H08 未完全修复；H11 为本次测试基建引入的问题。不能合并 main，不能进入 Phase 2 / TASK-005。

实际冻结版本为 `9a5798ccdfad1be1e60d2df4dce9f9c189f85b93`，分支 `phase/01-foundation`，本地和远端一致；main 仍为 `2a983cc55f136abbb49c5d02b55c1cb82b6547cc`。交接中的 `e7b5eea` 是最后一次业务修复提交，其后的 `9a5798c` 只更新管理文档和应用 README。本轮以 `c87a141..9a5798c` 为修复范围，补查 `main...9a5798c` 和当前完整 Phase 1 实现。开始时工作区干净；测试结束、写回前核对 228 个已跟踪文件零变化，其中应用 81 个。

已读取当前规则、唯一进度、任务/开发合同、决定、交接、P07、前轮报告与证据，并核对相关角色、数据模型、API、验收、源码、迁移与测试。历史冻结时的“开始 TASK-001”等文字不是本轮执行指令。D01 继续采用方案 A。

本轮重跑 typecheck、Unit 14/14、Integration 53/53、build、E2E 8/8；使用独立 PostgreSQL 17.11 / 55469，测试副本位于系统临时目录。真实 Linux 容器使用独立 Compose 项目和数据卷，端口限回环 3300/55479。没有改原应用代码、Schema、迁移或测试，没有操作开发库 5433，没有提交、推送、合并或部署。

证据：[机器索引](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/GATE_01_REVIEW_3_EVIDENCE_2026-09-14.json)、[日志与复现说明](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/gate-01-review-3-evidence/README.md)。前轮正式报告及 44 份证据、REVIEW_2 的 33 份证据校验一致，未覆盖历史。

## 2. TASK 验收

| TASK | 结论 | 依据与边界 |
|---|---|---|
| TASK-001 | **PASS** | 支持的默认本地配置下，锁定安装、Web/Worker、健康降级、缺配置失败和真实容器闭环通过，H10 关闭。非默认数据库密码配置缺陷保留为 M05，非独立 HIGH。 |
| TASK-002 | **FAIL** | H09 与认证外键通过；审计同域并发不变量仍失败 H08，测试清理越界 H11；测试迁移器不能替代真实 Prisma 验证 M06。 |
| TASK-003 | **FAIL（完整依赖验收）** | 本任务的 H04/H05/H06/H07 核心行为通过，登录/退出/改密/邀请测试通过；但依赖 TASK-002 未通过，现有邀请入口 M01–M03 也未按原核定完整处理。不是重新判定 Owner 并发修复失败。 |
| TASK-004 | **FAIL（完整依赖验收）** | H01/H02/H03/H07/D01 服务端权限、投影、撤权通过；依赖链未验收，撤销邀请等当前写入口还遗漏保护。未来文件/Job/AI 实体的端到端测试仍归其所属 TASK。 |

任务本身的已通过能力、依赖验收、Gate 和 Owner 放行分别记录，不因两个依赖项 FAIL 就推倒已通过修复。

## 3. CRITICAL

**NONE。** 没有证据表明匿名请求能读取任意企业数据，或本次发生生产数据泄漏/损坏。

## 4. HIGH

### H08｜审计与店铺归属的并发写入仍能形成跨组织引用

- **问题：**新增父行守卫只读当前可见审计行；旧审计触发器只读当前可见店铺归属，二者没有保证并发提交后的持续同域。
- **位置：**[父行守卫迁移:21](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/migrations/20260913120100_p0_audit_tenant_fk_v2/migration.sql:21)；[审计行守卫迁移:9](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/migrations/20260913044218_p0_audit_tenant_fk/migration.sql:9)。
- **证据：**真实 PG 两连接：T1 在没有审计引用时把 Store 从 A 改到 B，暂不提交；T2 INSERT A 的审计引用该店，触发器仍看见旧 A，之后等待父行锁；T1 COMMIT 后 T2 也成功 COMMIT。最终 `parent_update_committed=true`、`insert_result=OK`、`insert_waited=true`、`cross_org=true`，见 `db-race-final.json`。没有禁用触发器或绕过约束。顺序父行修改阻断与旧库坏行升级拒绝已通过，但不能覆盖该并发反例。
- **风险：**数据库仍允许组织 A 的审计指向组织 B 的资源，后续代码不能安全依赖此不变量。当前没有公开店铺转组织接口，因此这是数据库跨组织关联缺陷，不冒称已通过现有 API 读取其他组织经营数据。
- **建议修复方式：**新增迁移，使用持续维护同域的复合外键，或经并发验证的锁定/重查机制；删除店铺只清空 store_id、保留 org_id；保留存量坏行守卫，禁止自动改写历史审计。补上上述事务交错和相反顺序、删除、升级回归。跨表关系约束和行锁语义参见 [PostgreSQL Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)、[Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)。

### H11｜集成测试会主动断开同集群其他 aiea 数据库的连接

- **问题：**六个套件的 beforeAll 新增 `pg_terminate_backend`，按 `datname LIKE 'aiea_%'` 清理整个集群，超出了本套件创建的测试库。部分测试还无条件用磁盘 `.env` 覆盖进程 DATABASE_URL。
- **位置：**[gate01.db.test.ts:30](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/tests/integration/gate01.db.test.ts:30)；同样出现在 auth、gate01.auth、gate01.access、database、permissions 的 beforeAll；[pgMigrate.ts:84](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/tests/helpers/pgMigrate.ts:84)。
- **证据：**本次提取并执行套件中的原样清理 SQL，在独立集群内另建一个不属于测试目标的 `aiea_review_sentinel` 库，保持连接并开启含 INSERT 的事务。清理后该连接被终止，未提交行回滚为 0，见 `db-probes.json/test_cleanup_scope`。原开发库未参与实验。代码中的匹配也会命中 `aiea_dev`；测试运行者具有终止自身其他连接的权限时即可发生。
- **风险：**日常执行集成测试可能踢掉开发 Web/Worker 或其他套件正在使用的连接，使无关请求和事务中断；外部注入隔离连接串也可能被 `.env` 覆盖。不是普通测试慢或代码风格问题。
- **建议修复方式：**测试仅管理本次明确创建、唯一命名的数据库与连接；删除跨数据库模糊清理，关闭自身客户端后仅清理本次测试库。明确配置优先级，禁止悄悄回退到开发库。回归验证旁观数据库的连接和在途事务保持有效，再运行完整套件。不要通过提高权限或扩大 kill 范围解决资源泄漏。

## 5. MEDIUM

### M01｜来源保护遗漏邀请撤销入口

- **问题：**新增 guardWrite 没有接入 DELETE invitation。
- **位置：**[invitations/[idOrToken]/route.ts:53](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/route.ts:53)。
- **证据：**人工携带有效 Cookie、非可信 Origin，DELETE 成功 200 且邀请实际 revoked。创建邀请的相同来源反例已变为 403。见 `http-probes.json/M01_M03_revoke`。
- **风险：**当前写入口来源边界不一致。本次人工提供 Cookie，不等同已证明浏览器跨站 CSRF 成功。
- **建议修复方式：**按前轮 ACCEPT 补全当前写路由，含无请求体 DELETE；同时明确 JSON MIME 的精确校验和无 Origin 调用边界，保留合法调用回归。

### M02｜登录计数修复有效，邀请仍信任可伪造代理头

- **问题：**登录已采用 TRUST_PROXY_HEADERS，邀请预览/接受仍直接采信请求 X-Forwarded-For。
- **位置：**[邀请预览路由:17](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/route.ts:17)、[邀请接受路由:16](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/accept/route.ts:16)。
- **证据：**未启用代理信任时，对同一无效 token 的第 61 次预览得到 429，换一个自填 X-Forwarded-For 就得到 404，表示重新绕过计数。登录错误密码 401 后 count=1，缺 password 的 400 保持 count=1，原清零缺陷已修。见 `http-probes.json/M02*`。
- **风险：**受控邀请的限流可由客户端切换计数键绕过。随机长 token 降低实际枚举成功概率，当前按 MEDIUM，未夸大为账号接管。
- **建议修复方式：**将已定代理信任边界覆盖登录与全部邀请入口；测试关闭信任时伪造头不能换桶，开启时只接受实际可信反代清洗的头。默认登录共享 direct 桶的并发/可用性边界需写清，部署拓扑验证仍归 TASK-029。

### M03｜邀请输入与异常处理没有完整落实

- **问题：**交接称五路由统一 Zod，但创建/接受邀请仍是类型断言；DELETE 版本仍允许小数，异常仍向框架抛出。internalFailure 的日志 ID 与响应 request_id 也分别生成。
- **位置：**[邀请创建:25](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/route.ts:25)、[邀请接受:45](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/accept/route.ts:45)、[邀请撤销:60](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/route.ts:60)、[http.ts:89](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/lib/http.ts:89)。
- **证据：**POST invitation 的 null body 和数字 email 均返回 503；额外字段仍 201。DELETE expected_version=1.1 返回 200 并撤销 version=1 的邀请。审计故障下撤销仍非 JSON 500，业务回滚正常。组织接口的 null/数字/小数版本已正确 422，两次公开注册拒绝也都返回 JSON，见 `http-probes.json`。
- **风险：**非法输入被当成服务器故障、版本合同不一致，错误无法按 request_id 对应日志；未改变 H07 原子回滚通过结论。
- **建议修复方式：**仅补当前入口的对象、类型、长度、额外字段、正整数版本与稳定错误信封；接受邀请区分合法空 body 和非法 JSON。日志和响应共用一个 request_id，并只记录安全诊断字段；不建设新异常平台。

### M04｜认证外键已通过，UUID 格式约束仍未落实延期触发点

- **问题：**数据库领域 ID 仍为 TEXT，无 UUID 格式约束；上轮允许延期至“首次后续 Schema 变更或 TASK-028 前，取较早”，本轮已经发生三份新迁移。
- **位置：**[schema.prisma:397](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:397) 及领域主键；当前进度的延期声明。
- **证据：**Schema 默认 uuid() 生成，但不限制直接写入；新身份外键 RESTRICT 和悬空升级守卫已实测通过。没有证据证明 TEXT 本身产生当前 API 越权。
- **风险：**既定技术债期限被继续顺延而未处理；未来跨接口校验和脏数据治理成本增加。
- **建议修复方式：**登记为已到触发点的 TASK-002 技术债，在后续 H08 迁移时按原合同检查存量并约束领域 UUID；保持认证框架 string ID。不得继续机械复制“首次后续迁移”来无限延期。本项仍为 MEDIUM，不单独提升为 HIGH。

### M05｜Compose 自定义数据库密码只更新 PostgreSQL，未更新 Web/Worker

- **问题：**POSTGRES_PASSWORD 可覆盖，但两个 DATABASE_URL 仍写死旧开发密码；交接所称数据库口令 `:?required` 实际并未落实，该 required 仅用于认证 secret。
- **位置：**[compose.yaml:16](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/compose.yaml:16)、32、47 行。
- **证据：**独立干净数据卷下默认配置完整容器闭环通过；只设置随机 POSTGRES_PASSWORD 后，再启动相同镜像，健康接口 503、Worker 状态命令 exit 1，日志为数据库认证失败。见 `container-results.json` 与 custom-password 日志。
- **风险：**按注释更换开发口令反而使栈不可用，可能诱导继续用固定口令。回环端口已正确限制；不能因此声称生产数据库已暴露。
- **建议修复方式：**PostgreSQL、Web、Worker 统一引用同一受限环境配置，正确处理连接串编码；在新数据卷上以非默认口令验证启动/迁移/登录。默认本地容器路径已通过，故不重新打开原 H10 的生成客户端/构建配置问题。

### M06｜测试迁移器生成的元数据不兼容 Prisma Migrate

- **问题：**自建 `_prisma_migrations` 缺少 rolled_back_at、started_at；也不校验已执行迁移的校验和/失败状态。替换了原本真实 migrate deploy 的测试路径。
- **位置：**[pgMigrate.ts:20](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/tests/helpers/pgMigrate.ts:20)、[database.test.ts:107](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/tests/integration/database.test.ts:107)。
- **证据：**新空库先用 applyMigrations 执行七份迁移成功，再运行固定 Prisma 7.10 `migrate deploy`，exit 1：`column "rolled_back_at" does not exist`。见 `helper-prisma-deploy.log`。本轮正常独立环境中真实 Prisma CLI 约 2 秒完成，没有复现交接所述 10 分钟空转；不能据此认定原慢启动原因。
- **风险：**53 项测试通过不再证明实际部署迁移可接续，可能掩盖迁移工具回归。实际应用空库/正常旧库使用官方 CLI 已通过，因此当前按测试可信度缺口定为 MEDIUM。
- **建议修复方式：**保留真实 Prisma 空库/重复/升级检查；优先移除不必要的自制迁移历史写入。若保留 SQL 辅助执行器，只限明确标识的测试用途，并实证兼容性，不能宣称等价。upTo 在目标已执行时仍可能继续向后执行，也需限定清楚。

M01–M04 不是执行者声称“全部落地”就可关闭；沿用前轮已核定的最小修补范围，不扩大 P0。本轮两项 HIGH 独立决定 BLOCKED，MEDIUM 未被整体升格为 HIGH，也没有新增一揽子延期批准。

| 项 | 本轮技术核定 | 当前处置 |
|---|---|---|
| M01 | ACCEPT | 按前轮 Gate01 范围补当前邀请撤销来源保护。 |
| M02 | ACCEPT | 按前轮 Gate01 范围补邀请代理信任；真实部署拓扑验证仍归 TASK-029。 |
| M03 | ACCEPT | 按前轮 Gate01 范围补当前输入、版本与信封，不扩建异常平台。 |
| M04 | MODIFY | 身份外键关闭；UUID 延期触发点已到，随后续 H08 迁移处理，仍是 MEDIUM。 |
| M05 | ACCEPT | 统一非默认数据库密码配置并作干净数据卷回归，仍是 MEDIUM。 |
| M06 | MODIFY | 保留官方 CLI 的实际迁移验证，移除或明确限定不兼容辅助器，仍是 MEDIUM。 |

## 6. LOW

**NONE（当前独立列项）。** L01 根目录遗留 package/lockfile/旧 Schema 已清理，通过；不用风格问题增加返工。当前交接版本、任务表旧描述和测试分项计数等管理不一致在本轮写回纠正，原记录保留历史。

## 7. 数据库审查

**结论：FAIL；是否允许进入下一 Phase：NO。** P0 表、主要自然键/复合外键、金额 CHECK 与单 Owner 约束测试通过。H09 的 91 个领域时间列全部为 timestamptz；同刻 UTC/+08 差为 0；已知 UTC 墙钟的旧库样例升级后保留原时刻。认证原生四表保持框架类型。

官方 Prisma 空库七迁移、c87a141 四迁移→七迁移、重复 deploy 均通过；预置旧审计跨域行或悬空认证身份时，正式 CLI 分别报 P3018 拒绝升级，符合守卫目的。H08 的并发反例仍失败。上述为合成旧库证据，不证明所有真实历史行原始时区已审计；上线前仍须按实际数据来源核对。

## 8. Auth / 权限 / 多租户审查

**结论：H01–H07 和 D01 已通过，邀请入口的 Medium 未完整关闭。是否存在已复现的跨 Organization 数据读取泄漏：NO（限已实现接口与本轮测试范围）。数据库跨组织关联风险：YES，见 H08。**

| 项 | 本次独立证据 |
|---|---|
| H01 | A Owner/B CustomerService 切换后 /me 和组织查询均归 B；无预算字段，写入 403；伪造活跃组织 Cookie 回退有效组织。 |
| H02 | Admin 授 Admin 403、授 Owner 422；P↔C 与 Owner 授 Admin 合法请求 200。 |
| H03/D01 | A 禁用后旧 Cookie 401；全局 User 和 B Membership 仍 active；重新登录进入 B Owner。 |
| H04/H05 | 公开注册两次 403、零 AuthUser；邀请后框架 Cookie 可访问 /me 200，重放 409；独立浏览器 E2E 通过。 |
| H06 | 强制交错 init/init：后者等待，一组织、一 Auth、一领域身份，登录 200；init/invite 和断链恢复原回归通过。额外真实子进程 Auth 创建后 exit 55，Owner/邀请均留下可恢复孤儿；重试后各一身份且登录 200。 |
| H07 | 邀请创建/撤销/接受、组织修改、成员禁用注入审计故障，业务/版本/会话无部分提交；禁用失败保留两条会话。撤销 500 信封缺陷另列 M03。 |

密码由 Better Auth 散列，Session 仍为数据库会话；未替换为自制认证。现有登录、改密撤旧会话、过期邀请和邮箱不符回归通过。

Secrets：扫描 21 个 Git 提交对应 318 个唯一 blob，私钥、典型云/供应商/GitHub Key、Cookie 强模式无候选；真实 .env 未入历史且本地被忽略。本地 .env 只核对变量名；ZCode 容器证据 token 已脱敏。历史仍有合成测试 secret、固定本地开发密码，不写成“没有任何密码字符串”，也不据此宣称真实生产 Secret 泄漏。模式扫描不是绝对不存在秘密的证明。

## 9. 测试审查

**现有测试有真实断言、真实 PG，可信但不充分；新测试基建存在 H11/M06。**

| 检查 | 本次结果 |
|---|---|
| Node / pnpm / 本地 PG | 24.21.0 / 10.34.5 / 17.11 |
| 冻结离线安装 + Prisma generate | PASS，278 包；保留 ignored build scripts 提示，generate 实际成功 |
| typecheck / unit / integration / build | PASS / 14/14 / 53/53（7 文件）/ Web+Worker PASS |
| E2E | 最终 8/8；保留 aborted/ECONNRESET 与颜色变量警告 |
| 正式迁移 | 空库七份 PASS，c87 四→七 PASS，重复 PASS；两类坏旧行按预期拒绝 |
| 并发/进程退出/真实 Cookie/回滚 | H06 等通过；H08 并发失败；Medium 反例如各节 |
| Worker 与缺配置 | 运行状态 0、正常退出 0、停止状态 1；缺 DB 和缺 Auth 启动均 exit 1 |
| Docker | 真实 Linux 构建成功；另从纯 Git 跟踪文件上下文构建成功，无宿主机 node_modules/生成客户端；7 迁移、Owner、登录 200、/me 200、公开注册 403×2、Worker 状态 0，down 清理成功 |
| 非默认 DB 密码 | 栈启动命令完成，但健康 503、Worker 不可用：M05 |

执行偏差如实记录：首次 E2E 的审查环境 URL 为 localhost，Playwright 为 127.0.0.1，6/8 并出现 Invalid origin；仅统一隔离环境 URL 后 8/8。首次 Docker CLI 缺 buildx 不接受 --progress，改用已安装的 legacy builder 成功。审查 SQL 首次夹具误用同一 Owner 建两个组织、首次参数复用类型冲突，均不作为产品缺陷；最终有效 H08 用独立 Owner 和显式参数类型重跑。首个 Docker 无缓存构建上下文来自已装依赖的副本（忽略规则排除依赖，但可能含生成源码），故又用纯 git archive 上下文独立构建，不仅凭第一次关闭 H10。

缺失回归：审计父/子写并发；测试旁观数据库不中断；Prisma 真正接续；所有邀请写入口的来源/输入/信封；非默认数据库口令。建议补有意义的行为回归，保留现有 53 项，不为风格写镜像测试。未来 CSV/Job/AI/文件闭环未开发，不提前实现来补本轮证据。

## 10. P0 范围检查

**是否存在超范围功能实现：NO。** 没有新增真实平台连接、计费、自动客服、RAG/Agent 或 P1/P2 业务实体。当前阶段表结构为未来 P0 所需，不等于提前实现后续业务功能。

## 11. 过度设计检查

**是否存在需要大规模整改的过度设计：NO。** 单应用、单 PostgreSQL、Web/Worker 分进程，固定权限服务仍与合同相称。测试迁移器问题按 M06 的具体兼容性处理，不泛化为架构重做或更换技术栈。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**NONE。** D01 方案 A 已实证通过，无需重问。其余均可在当前技术合同内修复。Owner 阶段放行是后续独立动作，当前未取得。

## 13. Zcode 必须修复项

仅列 CRITICAL/HIGH；CRITICAL 为 NONE。

1. **TASK-002 / H08：**修复审计同域并发不变量；以上 T1/T2 交错至少一方拒绝或重试，最终不产生跨组织引用；保留新增/修改/删除/升级守卫回归，用新增迁移，不改写历史。
2. **TASK-002 测试基建 / H11：**删除跨库模糊终止连接；测试只使用本次明确创建的独立库和连接，配置不能悄悄覆盖隔离目标。验证旁观库连接与事务完好，再跑完整套件。

M01–M06 的具体处置按第 5 节，不混入 HIGH 清单；H01–H07、H09、H10 已通过，需要保留回归而非重新开发。

## 14. 是否需要 Codex 复审

**YES。** ZCode 交付新冻结提交后，以 `9a5798c..新提交` 为差异，复核 H08/H11、Medium 实际处理与已通过行为回归；重核迁移链、测试隔离和容器口令配置。先读最新 HEAD 和未提交差异，不能继续引用 e7b5eea 作为最新冻结。

## 15. Gate 结论

- **允许 phase/01-foundation 合并 main：NO。**
- **允许开始 Phase 2 / TASK-005：NO。**
- 当前 Phase 1 / TASK-004 / 待修复 / Checkpoint=YES；下一工具 ZCode，使用 [P08_FIX.md](/Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/P08_FIX.md)。
- 后续顺序：ZCode 修复并自测 → Codex 独立复审 PASS → Owner 明确放行 → 按原 Git 生命周期推进。

本轮只完成 Review 与报告/进度/交接维护。实际清理、源文件核对、Product OS sync 和首页/总控读回结果见机器索引与唯一进度末尾；本地容器运行不表示线上部署或真实企业验证。
