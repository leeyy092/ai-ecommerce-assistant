# CODEX REVIEW｜GATE 01

Reviewer：Codex｜2026-09-14｜REVIEW_4｜范围：Phase 1 / TASK-001–004。

## 1. 最终结论

**BLOCKED；项目协议中的技术审查结果为 FAIL。** 原 H08、H11 本轮均独立通过，M01、M02、M05 关闭；新增 HIGH **H12：非 UTC 数据库会话下，时间读写偏移导致过期邀请仍可接受**。当前剩余 1 HIGH、4 MEDIUM（M03/M04/M06/M07），没有 CRITICAL。

实际审查分支为 `phase/01-foundation`，冻结提交 **`858c20ab9645b494840b219f0b39b01c39023291`**；本地与实际读取的远端一致。main 仍为 `2a983cc55f136abbb49c5d02b55c1cb82b6547cc`。本轮主要差异 `9a5798c..858c20a`；交接中的 e293b2e 是最后业务修复提交，随后 858c20a 记录管理文档、README 和历史证据，不改变业务实现。开始时工作区干净。

按项目规则与 P07 读取最新状态、合同、决策、交接及前轮报告，复核 24 个应用变更文件、迁移、测试与相关现有实现。测试在纯 Git 导出的临时副本、独立 PostgreSQL 17.11 集群（127.0.0.1:55470）和独立 Compose 项目运行。没有修改原应用代码、Schema、迁移或测试，没有操作开发库 5433，没有提交、推送、合并或部署。

证据：[机器索引](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/GATE_01_REVIEW_4_EVIDENCE_2026-09-14.json)、[日志与复现说明](/Users/yuyuyu/Documents/ChatGPT/产品-开发/docs/reviews/gate-01-review-4-evidence/README.md)。原 REVIEW_3、较早审查及 ZCode 修复证据保留。本轮“发现既有问题”与“本轮修复引入回归”分开记录：H12 的连接工厂和固定适配器版本在本轮修复前已存在。

## 2. TASK 验收

| TASK | 结论 | 说明 |
|---|---|---|
| TASK-001 | **PASS** | 锁定安装、Web/Worker 构建/启动、缺配置失败、健康降级、真实 Docker 默认与特殊字符密码两条闭环通过，M05关闭。 |
| TASK-002 | **FAIL** | H08复合外键、H11测试隔离、正式空库/升级通过；H12绝对时刻读写不成立；M04/M06/M07未关闭。 |
| TASK-003 | **FAIL** | 常规身份、邀请、登录/退出、并发与回滚回归通过；但H12让已过期邀请签发有效会话，属于本任务直接验收失败。M03还有异常信封缺口。 |
| TASK-004 | **FAIL（完整依赖验收）** | H01/H02/H03/H07/D01角色隔离及撤权通过；依赖TASK-003未验收。未推翻已通过的权限修复。 |

## 3. CRITICAL

**NONE。** 本次未复现任意匿名跨组织读取或生产数据破坏。

## 4. HIGH

### H12｜非 UTC 数据库会话下时间偏移，过期邀请仍被接受

- **问题：**应用创建 PrismaPg 连接池时没有固定会话 TimeZone。锁定的 `@prisma/adapter-pg 7.10.0` 将数据库返回的 timestamptz 偏移标识直接替换为 `+00:00`，没有换算墙钟时间；Date 参数写入的序列化也依赖 UTC 会话。数据库默认为 Asia/Shanghai 时，真实存储时刻与 ORM/API 解释不一致。
- **位置：**[src/database/prisma.ts:12](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/database/prisma.ts:12)；[邀请预览时效检查:155](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/services/invitations.ts:155)、[接受时效检查:210](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/services/invitations.ts:210)。固定适配器的相关代码和文件哈希见证据 `adapter-timestamp-excerpt.txt`。
- **证据：**在新 initdb 的 Asia/Shanghai 会话中，以数据库真实时刻建立“49小时前创建、TTL 48小时、1小时前过期”的合成邀请。PG 判断 `expires_at < now()` 为 true；原始 pg 客户端读到 `10:08:25Z`，Prisma却读为 `18:08:25Z`，偏移约28,800,000ms。真实HTTP预览200、接受200，并签发会话，随后 `/api/v1/me` 200。另有普通邀请创建响应的到期 epoch 比数据库实际存储 epoch 多整8小时。
- **对照：**同一代码与数据库，只在独立对照进程的连接参数中固定 `timezone=UTC`，创建响应与数据库 epoch 相等；过期预览410、之后接受409、没有Cookie。409是预览已把该行标记expired后的结果，不误写成接受成功或单独410。证据为 `timezone-probe.json`、`timezone-utc-control.json`、`review-timezone.ts`。
- **风险：**时间语义依赖写入者和会话配置；旧库升级、SQL/ORM混合写入、环境切换后，48小时邀请时效可能失真。未来事实时间也不能安全依赖该连接边界。此实验要求持有对应邀请token，不表示可以绕过token验证接管任意账号。
- **建议修复方式：**在所有应用/Worker数据库连接的建立阶段强制并验证UTC会话，统一CLI/脚本配置；不要仅对连接池随机一次查询执行SET TIME ZONE。补数据库真实epoch与ORM/API绝对时刻一致、48小时有效/过期边界、多连接池和跨环境回归。既有数据先按写入来源与历史会话核对，不对所有行盲目加减8小时，不更改用户可见店铺时区或D01业务规则。

H12是本轮首次独立复现的既有运行时缺口。原H09的91列类型迁移、UTC/+08相同时刻相等检查仍通过，但它们没有证明“读出的时刻就是数据库真实时刻”；本轮用独立pg读取epoch补足了这一边界。PostgreSQL本身按UTC存储timestamptz，并按会话时区显示；不能只替换显示偏移而不换算时刻。[PostgreSQL 17 时间类型](https://www.postgresql.org/docs/17/datatype-datetime.html#DATATYPE-DATETIME-INPUT-TIMESTAMPS)

## 5. MEDIUM

### M03｜限流数据库异常仍绕过统一错误信封

- **问题：**邀请预览和接受的 `consumeRateLimit` 位于try/catch之外。
- **位置：**[预览路由:25](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/route.ts:25)、[接受路由:57](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/src/app/api/v1/invitations/[idOrToken]/accept/route.ts:57)。
- **证据：**仅在临时库向auth_rate_limit注入拒绝invite键写入的CHECK，两个真实HTTP入口都返回500且非JSON；约束随后移除。`http-probes.json/M03_rate_db_failure`。本轮其余非法对象/类型/额外字段/小数版本均422；审计故障撤销已为503信封，日志和响应request_id一致，均已通过。
- **风险：**数据库故障时客户端失去约定的错误码、重试信息和request_id；当前未见业务部分提交。
- **建议修复方式：**将当前入口的限流、会话读取等可能失败操作纳入统一异常边界，保留业务错误状态；补数据库失败的真实HTTP回归。ACCEPT，继续完成前轮既定的当前错误处理范围，不建设新平台。

### M04｜UUID约束覆盖17张领域表，仍遗漏11张

- **问题：**迁移中的固定表名单没有覆盖合同要求的所有P0领域主键。
- **位置：**[新迁移:53](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/migrations/20260914150000_p0_audit_store_composite_fk/migration.sql:53)；[JobRun:1273](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:1273)。
- **证据：**数据库目录查询确认遗漏 `daily_metric/voc_insight/rule_evaluation/alert/ai_insight/action_state/ai_report/ai_run/import_task/data_coverage/job_run`。实际通过Prisma写入JobRun.id=`not-a-uuid-review`成功。另有AuthRateLimit辅助表未约束，不将其混为认证框架四表；框架四表string ID保持正确。`db-probes.json/M04_*`。
- **风险：**文档“所有领域主键已约束”的结论不成立，后续接口和数据清理存在格式不一致；当前没有因此发生越权。
- **建议修复方式：**按Schema与合同完整枚举领域表补新增迁移和存量守卫；认证框架原生string ID不改。MODIFY，原延期触发点已经到达，应与本轮遗留修复一起补齐，不再机械顺延；仍为MEDIUM。

### M06｜重复调用upTo会执行目标之后的迁移

- **问题：**目标迁移已在done集合时直接continue，跳过终止判断。
- **位置：**[pgMigrate.ts:55](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/tests/helpers/pgMigrate.ts:55)。
- **证据：**新库首次applyMigrationsUpTo到第4份只执行4份；同参数再调用，却执行第5–8份。`db-probes.json/M06_upto_first/M06_upto_repeat`。官方元数据列兼容已修，辅助器全量后官方migrate deploy exit0；不继续声称原缺列问题未修。
- **风险：**升级夹具重试时会悄悄变成最新版，削弱测试结论。当前正式应用部署使用官方CLI已通过，故不升级为HIGH。
- **建议修复方式：**先界定本次迁移集合到指定目标，再排除已执行项；验证首次/重复/不存在目标的行为。MODIFY，保留官方CLI空库、重复和升级验证。辅助器的用途注释不能替代实际边界正确。

### M07｜Schema差异生成会删除刚修好的审计复合外键

- **问题：**Schema仍只声明store_id→Store.id单列关系，数据库新增复合外键没有在模型/迁移维护流程中得到保护。
- **位置：**[AuditLog.store:1332](/Users/yuyuyu/Documents/ChatGPT/产品-开发/ai-ecommerce-assistant/prisma/schema.prisma:1332)、新迁移的fk_audit_log_store_same_domain。
- **证据：**在已成功执行8迁移的临时库运行官方 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`，输出仅一条结构变更：`ALTER TABLE "audit_log" DROP CONSTRAINT "fk_audit_log_store_same_domain";`，见 `schema-diff.log`。本次仅生成、未执行该SQL。
- **风险：**后续照用自动生成迁移可能撤销H08保护。当前数据库复合约束确实存在，H08两方向并发均通过；这里是迁移维护风险，不冒称当前再次跨域。
- **建议修复方式：**将可表达的复合关系同步进Schema，明确PG按列SET NULL等自定义语义的SQL维护方式；新迁移生成与审查必须防止意外移除此约束。ACCEPT，下一次Schema变更前落实，并保留H08并发/删除回归；仍为MEDIUM。

**已关闭的Medium：**M01来源保护（非可信Origin撤销403，无Origin/无body合法撤销200）；M02邀请预览/接受伪造代理头不能更换桶，限流后仍429，登录计数回归通过；M05默认和含空格、@、:、/、#、?、%的随机密码在全新Docker卷上均完整通过。真实反代部署拓扑仍按既定TASK-029核验。本轮HIGH由H12独立构成，不把所有Medium一并升格或批准整包延期。

## 6. LOW

**NONE（当前独立列项）。** 没有要求代码风格重构；首页旧版本、任务表旧描述与“P0无部署要求”等管理文字在本轮收尾纠正，保留原历史。

## 7. 数据库审查

**结论：FAIL；是否允许进入下一Phase：NO。**

H08两个方向均由实际锁等待及拒绝写入证明cross_org=0；删除店铺只清store_id，org_id保留。官方CLI空库8迁移、c87四→八、9a七→八、重复deploy通过；跨域审计、悬空身份、非法领域UUID的旧库样例按预期拒绝。历史迁移未重写。

91个领域时间列为timestamptz的事实保持；H12说明“类型正确”仍不足以保证应用读写绝对时刻。M04遗漏表、M06辅助器边界、M07模型差异仍需处理。所有样例均为隔离合成数据，未核验真实历史行的写入来源。

## 8. Auth / 权限 / 多租户审查

**结论：H12导致邀请时效验收失败；现有四角色、组织切换、禁用与D01回归通过。**

**是否复现跨Organization数据读取泄漏：NO（限本轮已实现接口）。** H08原数据库关联漏洞已关闭；不能据此保证未来尚未开发的文件、Job、AI对象已完成端到端隔离。

本轮真实HTTP回归覆盖：A Owner/B CustomerService切换与预算投影；Admin不能授Admin/Owner；合法角色切换；禁用当前组织资格后旧Cookie401，其他组织重登可用；公开注册两次403；邀请Cookie可访问/me、重放409；初始化并发一胜一幂等；审计故障下成员/组织/邀请与会话回滚。D01方案A不变，无需再裁决。H12过期邀请反例单独列出，不能用常规邀请通过覆盖它。

Git历史Secrets模式扫描26个提交、429个唯一blob，未发现强模式密钥/Cookie候选，真实.env无跟踪；历史合成测试值和开发口令保留其用途说明。模式扫描不是绝对不存在秘密的证明。

## 9. 测试审查

| 本轮独立检查 | 结果 |
|---|---|
| Node / pnpm / PG | 24.21.0 / 10.34.5 / 17.11 |
| 冻结离线安装与Prisma generate | PASS，278包；ignored build scripts提示保留，generate实际执行成功 |
| Typecheck / Unit | PASS / 18/18 |
| Integration | 60/60；旁观连接及在途事务保留，冲突.env未覆盖注入配置，测试库清理后无遗留 |
| Web/Worker build | PASS |
| E2E | 首次即8/8；保留aborted/ECONNRESET与颜色变量警告 |
| 官方迁移 | 空库/重复/四→八/七→八PASS；坏行拒绝符合预期 |
| HTTP及数据库补充 | H08/H11通过；H12与四项Medium反例见各节 |
| Docker | 纯Git上下文构建PASS（允许标准层缓存，无宿主依赖或生成客户端）；默认/特殊字符密码分别完整启动→8迁移→Owner→登录/me200→注册403×2→Worker0→down --volumes |
| 运行边界 | Worker运行0、SIGTERM退出0、停止检测1；缺Auth/DB启动exit1；健康200→503 |

现有测试可信但不充分。新H08测试确实等待并发事务，H11本轮另用完整套件跨越在途事务验证。H09旧断言只看类型及两个读数相等，漏了与真实epoch的对照；UUID测试只抽7表，不能证明全量；upTo重跑与限流数据库故障也未覆盖。

执行偏差：旧版本归档最初缺prisma/config依赖解析，基线命令失败；仅在临时旧目录链接已锁定依赖后重跑成功，首个错误日志保留。未把该准备错误当产品缺陷。ZCode所称iCloud根因本轮未独立重做系统诊断，本轮临时目录CLI耗时约2秒；不把执行者归因升级为本轮已验证事实。R3真实子进程退出证据保留，本轮H06执行现有恢复回归及真实HTTP并发，没有另跑整套进程退出实验。

## 10. P0范围检查

**是否超范围：NO。** 本轮新增连接串工具、约束和测试调整属于当前Phase修复；没有新增大型依赖、真实平台接入或P1/P2业务。

## 11. 过度设计检查

**是否存在需要大规模整改的过度设计：NO。** 单应用、单PostgreSQL、Web/Worker分进程及固定权限服务保持。M06只要求修正辅助器边界，不要求重建测试平台。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**NONE。** D01已定；H12与Medium均是现有合同内技术问题，不更改48小时邀请规则、店铺时区或P0范围。Owner阶段放行仍待后续独立记录。

## 13. Zcode必须修复项

仅列CRITICAL/HIGH：CRITICAL为NONE。

1. **H12（TASK-002连接边界 + TASK-003邀请时效）：**所有实际数据库连接会话统一UTC；使用真实epoch对照验证读写、48小时边界与多连接池；在默认非UTC数据库环境中，49小时前创建、48小时有效期的邀请必须被拒绝，不能签发会话。现有数据按来源核对再决定处置，不能盲目时间平移。

M03/M04/M06/M07按第5节核定处理，不混入HIGH清单。H08/H11、M01/M02/M05保留已通过回归，不重新开发。

## 14. 是否需要Codex复审

**YES。** 下一轮以 `858c20a..新冻结提交` 为差异，重点H12、Medium实际处理和已通过回归；核对数据库默认时区、每条实际连接、迁移生成保留约束及真实容器配置。先查最新HEAD与未提交差异，不能用旧e293b2e覆盖当前版本。

## 15. Gate结论

- **允许phase/01-foundation合并main：NO。**
- **允许开始Phase 2 / TASK-005：NO。**
- 当前Phase 1 / TASK-004 / 待修复 / Checkpoint=YES；下一工具ZCode，使用 [P08_FIX.md](/Users/yuyuyu/Documents/ChatGPT/产品-开发/prompts/P08_FIX.md) 顶部最新提示词。
- 顺序保持：ZCode修复自测 → Codex独立复审PASS → Owner明确阶段放行 → 按原Git生命周期推进。

本轮只完成Review与原管理文档维护，实际源文件/历史校验、临时环境清理、Product OS sync及首页/总控读回见证据索引与唯一进度最新执行记录。线上部署与真实企业试用未核验。
