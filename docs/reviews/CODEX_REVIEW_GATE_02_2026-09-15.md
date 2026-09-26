# CODEX REVIEW｜GATE 02

审查日期：2026-09-15；Reviewer：Codex。范围仅 Phase 2 / TASK-005–007。本文为本轮正式报告；此前 Gate 01 报告、修复和 Owner 放行记录继续保留。

## 1. 最终结论

**FAIL。TASK-005、TASK-006、TASK-007 均未达到完整合同验收，交 ZCode 修复。** 发现 **9 HIGH、4 MEDIUM、2 LOW，CRITICAL 为 NONE**。这些是本轮新增实现的缺陷，不是重开 Phase 1 已关闭问题。问题编号使用 `G2-` 前缀。

独立运行现有测试确实全绿：typecheck 0 错、Unit 49/49、Integration 82/82、Web/Worker build exit 0、E2E 8/8。但补充的真实 HTTP、PostgreSQL 并发、文件/队列故障和 Adapter 合同反例失败，故不能用测试全绿替代技术审查通过。

实际冻结：`phase/02-data-ingestion` = `ce5f28699910e19310b790d31a6e8871a78b5e58`；main = `4c7e95b925c2b04aa2c1116979678cac7af091f2`；审查范围 **4c7e95b..ce5f286**。远端分支通过 `git ls-remote` 核对一致。TASK 提交为 f51ed41 / 7583ed7 / 6d1928c，后续为管理文档提交。开始时只有原进度末尾两行未提交管理说明，已保留。写回前 562 个跟踪文件全部与开始快照一致，其中应用目录 146 个文件未变。

证据入口：[机器索引](GATE_02_EVIDENCE_2026-09-15.json)、[执行说明与复现顺序](gate-02-evidence/README.md)。下文短文件名均位于 `docs/reviews/gate-02-evidence/`。源码位置相对应用目录 `ai-ecommerce-assistant/`；行号对应 ce5f286，带行号摘录另见 `source-excerpts.txt`。

## 2. TASK 验收

| TASK | 结论 | 已独立通过 | 未通过 / 范围边界 |
|---|---|---|---|
| TASK-005 店铺与数据源 | **FAIL** | 顺序创建、外部 ID 冲突、demo_mode 继承、platform 仅标签；真实 Product 事实后币种/时区 409，改名/归档成功；归档拒绝数据源、mock 仅演示店、namespace 冲突；三种审计失败时事务回滚 | G2-H01 客服摘要泄漏及历史覆盖重复累计、G2-H02 并发版本锁失效、G2-M02 同名并发/改名失守。基础设置表单尚未实现，集中 UI 可合理留 TASK-027，不能宣称已有人机设置闭环。 |
| TASK-006 统一 Adapter | **FAIL** | 两店六类 CSV/Mock 共 12 对标准记录相等；前导零、BOM、常见 quoted 逗号/换行、null 与 false 区分、unsupported 和整文件 STORE_MISMATCH 正例/反例通过；纯解析无 DB/HTTP；无 Excel 解析器 | G2-H03 数值/日期/必填校验错误；G2-H04 没有合同要求的 CanonicalBatch/coverage manifest，黄金样本 A M3 与规范不符。共享同一解析器只能证明两入口一致，不能证明共同结果正确。 |
| TASK-007 上传/存储/任务 | **FAIL** | C 订单 403 FILE_KIND_FORBIDDEN、C 消息 201；顺序同内容复用；Owner 查询/签名下载；无签名与过期 403、正确签名 200 且内容一致；跨组织查询/下载 404；public 路径 404；归档/mock 拒绝上传；真实 built Worker 能解析并生成私有错误 CSV；commit 显式拒绝 | G2-H05 读写/执行权限链、H06 请求流限制、H07 并发与 HTTP 幂等、H08 失败恢复、H09 Web/Worker 私有存储配置；M01/M03/M04 另列。完整 mapping/preview/原子业务提交仍属 TASK-008 起，本轮没有要求提前实现。 |

结论中的 FAIL 指验收结果；唯一任务表可用项目现有 `BLOCKED` 表示“因明确缺陷待修复”，不能把它误读为本轮仅缺环境证据。

## 3. CRITICAL

**NONE。** 没有证据证明本轮已发生真实客户数据外泄或跨组织读写成功；同组织角色越权见 G2-H01。

## 4. HIGH

### G2-H01｜客服数据源摘要返回经营统计，覆盖历史还被重复累计

- **问题：**只裁剪 `supported_entities` 标签，coverage 与 last_import_at 查询未按角色类型限制；coverage 对历史版本直接 sum/count，没有取有效版本。
- **位置：**`src/services/dataSources.ts:116`、`:129`、`:152`；`src/app/api/v1/data-sources/route.ts`。
- **证据：**`http-probes.json` 的 `coverage_cs/coverage_owner/coverage_to_exclusive/invalid_date`。同一天 orders 为 v1=100、v2=120，messages 为 v1=3、v2=4，Store.dataset_version=2；Owner 和 C 都得到 `record_count=227, source_kinds=4`。当前版本应分别为全部 124、客服 4，类型数不应把历史行当不同来源类型。`to=2026-09-01` 仍包含当日，非法日期产生 503。
- **风险：**C 可看到含订单量的汇总；导入历史越多，摘要越不可信。不是跨 Organization 泄漏，但违反客服经营数据禁见规则。
- **合同依据：**08_API_SPEC:13、:34；02_USER_ROLES 权限表及服务端摘要裁剪；04_DATA_MODEL 的版本化 DataCoverage。
- **建议修复方式：**在服务端查询前限定可见 source_kind；按来源/类型/渠道/日期选当前有效版本后聚合，last_import_at 同样按可见类型筛选；验证日期格式、右开区间和 90 天上限。回归需包含多历史版本、多类型、零事件、无导入和两角色不同结果。

### G2-H02｜店铺 expected_version 不是原子版本锁

- **问题：**事务内先读取 rowVersion，随后按 id 无条件 update；两个请求能同时通过旧版本检查。
- **位置：**`src/services/stores.ts:182`–`:218`。
- **证据：**`http-probes.json.concurrent_store_cas`：用独立 PG 连接持有 Store 行锁，观察到两个 UPDATE 真正等待；同一个 `expected_version=1` 的 Owner/Admin PATCH 最终均 200，分别写出版本 2、3，后一次覆盖前一次名称。
- **风险：**用户依据旧页面提交的改名/归档/配置变更静默覆盖他人修改。
- **合同依据：**08_API_SPEC:129 明确 expected_version 乐观锁，不符 409，不静默覆盖。
- **建议修复方式：**把版本与授权域放入同一原子更新条件，或先锁定记录再检查版本；审计与更新同事务。并发同版本必须恰好一次成功、另一次 409；保留事实锁与审计回滚回归。

### G2-H03｜Adapter 接受超界数值、非法日期，并补造来源更新时间

- **问题：**金额只检查小数位，整数转换未防安全范围/目标字段上界；日期校验过宽；缺失必填值被默认；可选列却全部按必需表头要求。
- **位置：**`src/adapters/contracts.ts:216`、`:239`、`:268`、`:289`、`:422`、`:476`；`src/jobs/handlers/imports.ts:34`。
- **证据：**`adapter-probes.json.boundaries`：`100000000000000.000000` 超出 numeric(20,6) 仍接受；`9007199254740993` 被接受并变成 `9007199254740992`；无时区/歧义时间、`2026-02-30` 被接受；缺失 `source_updated_at` 变为上下文提供的时间，而 Worker 上下文直接取上传任务创建时间；必填 product_status/sku_status 空值变 active；省略合法可选列被报 MISSING_COLUMN。未闭合 quoted 字段也被接受。退款完成早于发生时间的纯行级反例亦被接受。
- **风险：**输出的“标准记录”已含舍入、错误业务日期或伪造新旧版本，后续 TASK 无法可靠依赖；不能等到数据库写入时才发现类型越界。
- **合同依据：**TASK-006 明确日期/金额边界；04_DATA_MODEL §12.1–12.7，尤其 :521 禁止服务端随意补来源时间；11_DEVELOPMENT_RULES:88 固定 csv-parse/RFC4180。
- **建议修复方式：**按六类字段清单统一必填/可选/枚举/长度/数值与时间规则，金额保持精确字符串，整数在转换前检查上界；来源时间缺失明确报错；采用既定 csv-parse 严格处理语法。先把本轮反例转为失败测试再修复；TASK-008 的跨行、数据库引用、mapping 全量校验仍留原任务，不在这里提前做业务入库。

### G2-H04｜TASK-006 没有 coverage manifest，黄金样本也未遵循独立规范

- **问题：**DataAdapter 只有 kind/parse，返回 kind/records/errors；缺少 CanonicalBatch 的服务端店铺身份、namespace、adapter_version、raw_checksum、coverage_declaration 等元数据合同，也没有 coverage fixture。两入口复用同一错误样本，测试未对照规范。
- **位置：**`src/adapters/contracts.ts:678`–`:731`；`tests/fixtures/golden/store-a/customer_messages.csv:4`；`tests/fixtures/golden/mock-golden.ts`；`tests/unit/adapters.test.ts:90`。
- **证据：**`adapter-probes.json` 记录 12 对一致，但 A M3 的 isComplaint=null。04_DATA_MODEL:686 要求 false，:689 明确 A 投诉标记覆盖 3/3、投诉率 1/3；现样本导致 2/3 并不可用。04:701 要求两店独立展开完整/缺失/explicit_zero 覆盖声明，现 fixture 没有这些声明。
- **风险：**接口“相等”掩盖共同错误；后续聚合将依赖错误预期，缺事件与显式零事件无法区分。
- **合同依据：**TASK-006 目标明确“标准记录与 coverage manifest”；04_DATA_MODEL:491 与 §12.8。
- **建议修复方式：**落实纯解析层的统一元数据与 typed batch 合同，服务端赋值不信任 CSV 授权字段；在 fixture 中独立展开规范覆盖声明，恢复 A M3=false，B 缺失标记保持 null；分别断言规范期望与 CSV/Mock 一致性。这里只要求合同/fixture，不实现 TASK-008 确认流程、指标或提交。

### G2-H05｜上传、查询、下载与 Worker 执行没有贯通相同权限

- **问题：**查询和文件接口使用 manageSettings（仅 O/A），与允许 O/A/P/C 按类型上传冲突；Worker 仅按 taskId 取任务，没有重新检查发起人的有效 Membership/当前类型权限。
- **位置：**`src/app/api/v1/imports/[id]/route.ts:14`、`src/app/api/v1/imports/[id]/file/route.ts:16`、`src/jobs/handlers/imports.ts:19`。
- **证据：**`http-probes.json.read_own_task/cs_signed_file`：C 上传消息 201 后查询和正确签名下载均 403；P 上传订单 201 后查询 403；Admin 查询 200。`worker-probes.json.revoked_before_execute`：任务执行前禁用创建人的当前组织 Membership，built Worker 仍解析 2 行并给出 preview_ready/completed。
- **风险：**授权用户无法追踪自己能上传的任务；被撤权人员留下的任务仍继续处理。不能通过简单取消 manageSettings 校验来修复，否则会放开 C 订单文件访问。
- **合同依据：**02_USER_ROLES：任务执行和下载签发重新鉴权；08_API_SPEC:55、:58；TASK-007 任务归属测试。D01 仍为方案 A，不涉及修改全局 User.status。
- **建议修复方式：**复用统一授权入口与类型白名单，查询/签名/读取/Worker 都检查组织、店铺、来源、有效身份和当前能力。测试 C 自己消息可用、订单不可用，P 合法类型可用，异组织 404，禁用/降权后的旧任务和链接拒绝。上述是新增文件/队列消费者的责任，不重做已关闭认证模块。

### G2-H06｜HTTP 上传在限额检查前已经完整缓冲，行数按物理换行误算

- **问题：**路由先 `req.formData()` 全量接收，再将已缓冲 File 伪装成流交 service；service 接收全文后才数 `\n`，不是 CSV 逻辑记录计数。
- **位置：**`src/app/api/v1/imports/route.ts:25`；`src/services/imports.ts:84`–`:108`。
- **证据：**`wire-probes.json`：真实 chunked multipart 已发 21 MiB（超过 20 MiB）且等待 1 秒，服务器仍未响应；追加到 22 MiB 并结束 multipart 后才 422 FILE_TOO_LARGE。`http-probes.json.service_row_limit`：首块已超 100000 行，后两块仍被读取。50,001 条含 quoted 换行的 CSV 逻辑记录（100,003 物理行）被误拒 TOO_MANY_ROWS。service 单独的字节限制确实能在第 21 块停止，但不代表 HTTP 层实现了该保障。
- **风险：**超限输入在保护生效前占用 Web 内存；合法多行客户消息被误拒。
- **合同依据：**TASK-007 的分块上传/超限即停止/流式计数，以及用户本轮明确的 20MB/10万行验收。
- **建议修复方式：**在真实请求接收链路设置文件字节上限，增量哈希并按 CSV parser 的逻辑记录限额计数；越界立刻取消上游并清理本次临时对象。测试必须经真实 HTTP 不闭合 multipart 的分块请求及合法 quoted 换行；不得只对 Readable.from(buffer) 做断言。

### G2-H07｜并发内容幂等和 Idempotency-Key 合同都失效

- **问题：**内容查重在事务外执行，无原子认领；uploadRequestKey 混入 Date.now；HTTP Idempotency-Key 未读取，multipart 同名字段误占最终业务 idempotencyKey。
- **位置：**`src/services/imports.ts:112`–`:147`；`src/app/api/v1/imports/route.ts:33`。
- **证据：**`http-probes.json.concurrent_upload`：4 个相同内容并发请求产生两个任务；顺序重复则能复用。`extra-probes.json.header_idempotency`：同一个 HTTP Key 配不同文件两次都 201，任务不同；`http-probes.json.http_key_conflict`：改用 multipart key 后，不同内容第二次是 503 INTERNAL_ERROR，非 409。
- **风险：**网络重试/双击可能生成多个可校验任务，后续阶段无法依赖上传身份；请求幂等与业务自然键被混为一层。
- **合同依据：**TASK-007 重复请求同任务；08_API_SPEC:55、:129（org/user/endpoint、请求 hash、24小时，同 key 不同 body 409）；04:514、:525 区分上传与映射后业务幂等。
- **建议修复方式：**使用明确且原子的上传请求/内容认领机制，正确处理唯一冲突；HTTP Key 与最终 mapping/adapter/coverage 业务幂等分开。提交阶段业务 upsert 仍留原 TASK。回归并发相同内容、同 key 同 body、同 key 异 body、不同角色/组织隔离与失败重试。

### G2-H08｜文件、投递和 Worker 重试的失败窗口会永久遗留任务

- **问题：**先提交 uploaded 任务再写文件，失败后空 rawObjectKey 的任务仍可复用；投递错误被吞掉，复用不重投；Worker 先改 validating 再读取，抛错后未记录可恢复状态，重试直接返回该中间状态并被队列记成功。
- **位置：**`src/services/imports.ts:135`–`:171`；`src/app/api/v1/imports/route.ts:69`；`src/jobs/handlers/imports.ts:22`–`:34`。
- **证据：**`http-probes.json.disk_failure_retry`：注入 ENOTDIR 后，重试返回 reused=true/status=uploaded/rawObjectKey=""。`enqueue_failure`：PG 队列表注入写入拒绝，HTTP 仍 201；恢复后重传 200，但对应队列作业数 0。`worker-probes.json.transient_file_failure`：文件不存在导致首次失败，一次重试后 queue=completed/retry_count=1，ImportTask 仍 validating，无 errorCode。
- **风险：**用户看到成功接收却无法完成或安全重试，单靠重复上传不能恢复；“队列就绪”冒烟不覆盖可靠性。
- **合同依据：**TASK-007 可追踪任务、最小持久队列/dispatcher；11_DEVELOPMENT_RULES §14.2 数据库状态真源及防丢失窗口；10_ACCEPTANCE_CRITERIA:109 明确重试状态正反用例。
- **建议修复方式：**界定接收/对象就绪/待投递/执行/失败的原子与恢复边界，确保任何阶段失败都有持久可诊断状态；落盘失败不能复用空文件成功态；投递可补偿；Worker 重试必须继续安全阶段或明确失败，不能把中间状态当完成。复验三个故障窗口与进程中断；可在现有表/队列做最小实现，不要求提前建设 TASK-013 快照发布系统。

### G2-H09｜新私有存储没有接入 Web/Worker 运行配置及打包排除

- **问题：**默认写 `.data/private`，但 Web 与 Worker 容器没有共享持久卷；Worker 的既有 Compose 环境没有 storageRoot 新增必需的 auth 变量；`.data` 未被 Git/Docker 上下文排除，Dockerfile `COPY . .` 会带入本机私有业务文件。
- **位置：**`src/storage/index.ts:21`；`compose.yaml:33`、`:53`、`:77`；`.dockerignore`、`.gitignore`；`Dockerfile:25`、`:41`。
- **证据：**`static-probes.json.private_ignore` 的私有路径 check-ignore exit=1（未忽略）；Docker 上下文无排除规则，两个服务仅 PostgreSQL 配了卷。`storage-env-probe.log` 在与现有 Worker 相同的缺 auth 配置下抛 EnvValidationError；`worker-compose-environment.log/worker-probes.json.compose_environment` 中 built Worker 队列就绪但任务仍 validating。正常共用私有目录及完整变量时可解析，见 normal 对照。**这不是本轮真实 Docker 构建证据**，缺卷/打包风险基于原配置静态证据，缺变量已实际执行验证。
- **风险：**进入容器链路后无法读取 Web 上传文件，容器替换丢数据；本机客户文件可能误提交或封装进镜像。现未发现真实客户文件已入库，不把潜在路径误称为已发生泄漏。
- **合同依据：**TASK-007 私有存储与单 Web/Worker；11_DEVELOPMENT_RULES:87、public 与日志隐私边界；不是重开 Gate 01 旧 Docker 问题，而是 Phase 2 新文件消费依赖。
- **建议修复方式：**配置统一持久私有存储/卷及显式运行变量，避免本地读文件无端依赖 Web auth 初始化；新增精确 Git/Docker 排除。用合成 canary 验证不进镜像，再在真实隔离 Compose 跑“上传→Worker读取→查询/下载→重启仍可读”，不部署线上。

## 5. MEDIUM

### G2-M01｜上传字段与既定客户端合同不一致

- **问题/位置：**`src/app/api/v1/imports/route.ts:32` 只收 source_kind，而合同字段是 entity_type；当前响应也未提供 filename/bytes。
- **证据：**`http-probes.json.contract_entity_type` 按合同 multipart 返回 422 必填 source_kind。08_API_SPEC:55 和 04_DATA_MODEL:514 明确 entity_type 映射内部 source_kind。
- **风险：**后续按文档实现上传客户端无法接入。
- **建议：**恢复规定输入映射和可用响应字段，保留内部 source_kind；本轮用户明确的上传 201、超限 422 优先于旧表 202/413，**不将该状态码差异判为缺陷**。核定 **MODIFY，本轮配合 H07 修复，未关闭**。

### G2-M02｜店铺同名约束只有顺序创建检查

- **问题/位置：**`src/services/stores.ts:76` 的预查询不能防并发，updateStore 不检查新名称。
- **证据：**`extra-probes.json.same_name_parallel`：三个相同名称、不同外部 ID 请求全部 201，DB 同名店铺 3 个；`http-probes.json.rename_duplicate` 改成已有名称 200。对照 08_API_SPEC:32 的 409 同名要求。
- **风险：**选店和配置识别歧义，顺序测试无法保护合同。
- **建议：**按当前组织内命名规则原子保护创建及改名；必要 Schema 变更只新增迁移并遵守 M07，不改历史迁移。核定 **ACCEPT，建议本轮修复，未关闭**；等级保持 MEDIUM。

### G2-M03｜上传入口没有文件格式/编码拒绝及已分配的限流

- **问题/位置：**`src/app/api/v1/imports/route.ts:48` 只判断 File 非空，`src/services/imports.ts:104` 用非严格 UTF-8 解码；入口无上传限流。
- **证据：**`http-probes.json.xlsx/upload_rate`：标为 .xlsx 的 CSV 字节文件 201，11 次不同内容连续请求约 103ms 均 201；`extra-probes.json.invalid_utf8` 含 0x80 的非法 UTF-8 输入 201。静态调用链没有 rateLimit；**11 次并不是捏造的限流阈值，只作入口行为观察**。FINAL_DECISIONS F10 把上传限流明确分给 TASK-007；11:88 限 UTF-8/BOM CSV；08:55 有 415 类型错误。
- **风险：**不支持格式/编码被接收，非法字节可被替换，解析负载缺少节流。没有 Excel parser 本身符合 P0。
- **建议：**明确允许的 CSV 类型/文件名与严格编码策略、稳定错误码，落实 F10 的上传限流与可等待响应；复用现有设施，不增平台。核定 **ACCEPT，本轮修复建议，未关闭**。缺列已经由 Worker 失败并写私有错误，此项不要求在 HTTP 内完成 TASK-008 全量业务校验。

### G2-M04｜OSS 适配未实现，不能将其默认视为已批准延期

- **问题/位置：**`src/storage/index.ts:77` 显式拒绝 STORAGE_DRIVER=oss；package.json 无既定 ali-oss。
- **证据：**静态源码明确“P0 未实现 OSS”；TASK-007 输入包含私有 OSS 与本地开发存储，11_DEVELOPMENT_RULES:87 规定该组合。没有真实 OSS 上传/下载证据。
- **风险：**开发本地链路可验，P0 生产存储选型尚未交付。
- **建议：**按原合同补齐可测试适配；真实账号联调留到资源可用并如实记录。若要求延期到 TASK-029，须列明负责人、到期门禁并获得 Owner 接受，不能自行宣称已完成。核定 **未处理；延期未批准，MEDIUM 不自动升级为 HIGH**。

## 6. LOW

### G2-L01｜新增了两份未使用的 Auth/DB URL 重复源码

- **问题/位置：**`src/lib/auth 2.ts`、`src/lib/dbUrl 2.ts`。
- **证据：**`static-probes.json.duplicate_sources`：与无后缀原文件逐字节相同，现有引用使用原文件。
- **风险：**后续修补容易误改副本；当前没有双认证运行的证据。
- **建议：**确认无引用后删除意外副本。**未处理，不阻塞 Gate；与 Phase 1 历史 L01 无关。**

### G2-L02｜本地签名默认有效期为 10 分钟

- **问题/位置：**`src/storage/index.ts:57` 默认 ttlSeconds=600。
- **证据：**11_DEVELOPMENT_RULES:87 的既定签名 URL 为 5 分钟；实际过期拒绝和有效内容下载已通过。
- **风险：**暴露窗口比约定长 5 分钟，当前仍受 Session/对象授权约束。
- **建议：**统一默认 300 秒并验证边界；**未处理，不单独阻塞 Gate**。

## 7. 数据库审查

**Schema/迁移结论：PASS（只针对本轮未变的数据库结构及已运行检查）。应用事务/幂等结论：FAIL，见 H02/H07/H08。**

`static-probes.json` 证明 Phase 2 对 `prisma/` 无差异，10 份 SQL 及 Schema 有逐文件 SHA256；本轮独立 PG 17.11 空库官方 migrate deploy 通过，既有集成约束/审计并发删除回归通过。Phase 1 [REVIEW_5](CODEX_REVIEW_GATE_01_REVIEW_5_2026-09-14.md) 的旧库 8→10、重复部署、坏旧行拒绝、UUID、绝对时刻证据仅在相关 Schema/SQL/连接行为未变的条件下沿用，没有宣称本轮重新跑过全部历史矩阵。

**M07 仍有效：**audit_log 复合外键的按列 SET NULL 与更新语义由自定义 SQL 维护。以后新增迁移人工核对生成差异，并运行 H08 行为回归；本轮没有运行任何生成 DROP/ADD SQL，也无 audit_log 外键变更。pg-boss 自建队列表已在隔离数据库实际创建，不把“无新增 Prisma 迁移”解释成数据库无任何运行时队列表。

**是否允许进入下一 Phase：NO。** 结构可继续沿用，但当前 Phase 2 的应用行为未通过 Gate。

## 8. Auth / 权限 / 多租户审查

**FAIL。** 本轮新数据源摘要、文件与任务消费者存在 H01/H05。既有 Auth 库、Session、D01 方案 A、Phase 1 已关闭问题保持原结论；multipart 放行后同源约束仍在，实际 foreign Origin 返回 403（extra-probes.json）。

**是否复现跨 Organization 泄漏：NO（限本轮已测路径）**。另一组织 Owner 枚举本组织任务/签名下载/数据源均 404；顺序现有权限集成通过。另有**同组织 CustomerService 经营统计泄漏 YES**。没有执行整个未来产品的“两组织各四角色 × 尚未实现端点”矩阵；本轮有一组织四角色 + 另一组织 Owner 的真实 HTTP 与已有权限套件，不作超范围保证。

Secrets：本轮 Git 增量与当前相关源码未发现真实 Secret/API Key/私钥提交，没有新增 .env 跟踪；测试常量与本机开发默认口令不当作真实凭据泄漏。证据 `secrets-source.json` 为有限模式扫描加源码检查，未重新扫描已关闭 Phase 1 全历史。H09 的私有业务文件打包风险单独保留。

## 9. 测试审查

| 实际执行 | 结果 | 证据 |
|---|---|---|
| pnpm install --offline --frozen-lockfile + postinstall Prisma generate | exit 0 | install.log/json |
| pnpm typecheck | exit 0，0 错 | typecheck.log/json |
| pnpm test | 49/49，3 文件 | unit.log/json |
| pnpm exec prisma migrate deploy | 空库 10 迁移通过 | migrate.log/json |
| pnpm test:integration | 82/82，9 文件 | integration.log/json |
| pnpm build | Web/Worker 均 exit 0 | build.log/json |
| pnpm test:e2e | 8/8 | e2e.log/json |
| 独立 Adapter、HTTP/并发/故障、真实分块上传、built Worker 队列探针 | 命令 exit 0，**记录了 FAIL 反例**，见 H/M；exit 0 不代表产品通过 | adapter/http/wire/worker/extra-probes.json；scripts/review-*.ts |
| Compose 变量缺失对照、私有目录/迁移/增量 Secrets 检查 | 如 H09/第7节 | storage-env-probe.log、static-probes.json、secrets-source.json |

环境：Git archive ce5f286 → `/tmp` 工作副本；Node 24.21.0、pnpm 10.34.5、PostgreSQL 17.11 独立集群，服务端默认 Asia/Shanghai，现有应用连接 UTC 约定保留；Web 3322，PG 55572；Playwright 使用它现有配置的临时 3000。没有在 iCloud 主副本执行工具链，没有访问原开发数据库或客户数据。

**现有测试可信度：执行结果可信，覆盖不足。** 新测试主要验证顺序成功及 service/路由函数调用；8 个 E2E 仍是既有认证链路，不能称为 Phase 2 浏览器导入验收。CSV 与 Mock 使用同一解析实现和同一偏差样本，缺少规范独立 oracle；上传超限测试没有证明真实请求在读取时中止；并发、文件故障、投递失败、Worker 重试和当前权限缺少有效断言。

执行偏差核定：pg-boss 12 批数组 handler、esbuild banner+define 的 import.meta.url shim 均已通过实际构建及 built Worker 处理作业，**ACCEPT**；guardWrite 同源 multipart 兼容 **ACCEPT**，但不能替代 H06 接收限额。Reviewer harness 曾遇登录频率保护、生产 Cookie 前缀、Prisma 枚举名、pg-boss SQL 列名错误；均只修隔离探针后重跑，setup 日志保留，未把它们算产品缺陷。

**未运行与合理延期：**真实 Docker 整链、OSS 云端、生产部署/负载/真实企业文件未运行。本轮优先完成可证伪的 PG/HTTP/built Worker 反例；因此 Docker 不能记 PASS，H09 修复后须提供真实隔离 Compose 文件链路证据。TASK-008 mapping/全量预览、TASK-009 起原子提交、TASK-013 聚合发布、TASK-026/027 UI、TASK-029 运维压力与云资源联调按原任务延期，**DEFER（合同内合理，未冒充完成）**。本轮已到期的 H01–H09 不允许用未来任务延期；OSS 范围见 M04，延期未获批准。

## 10. P0 范围检查

**是否存在超范围产品实现：NO。** 无真实平台 OAuth/API、汇率、Excel、RAG/Redis/微服务、LLM 外发或自动业务执行。新增 pg-boss 为已选技术。built Worker 的 commit handler 明确拒绝，没有业务入库或 dataset_version 递增的提交实现；其注释把提交归到 TASK-008 的文字不等于 TASK-008/009 已开始。

## 11. 过度设计检查

**是否存在影响本轮的过度设计：NO。** 不要求因为偏好拆文件、改框架或重构认证。自写 CSV 解析器的问题在于违反既定解析选型且存在反例，不以代码风格定 HIGH；两份重复源码按 LOW 处理。修复可复用现有 Postgres、授权和队列设施，不建立第二套任务/测试平台。

## 12. GPT_PRODUCT_DECISION_REQUIRED

**NONE（本轮没有需要重定产品规则才能修复的阻塞）。** D01 方案 A 已决，不重问。按现有合同修复即可；若执行者要求把 OSS 等已分配责任改期，先提出具体延期请求和影响，当前未视为 Owner 接受。技术复审与 Owner 阶段放行始终分开。

## 13. ZCode 必须修复项

本节只列 CRITICAL/HIGH：CRITICAL 为 NONE。

| ID | 执行范围 | 必须通过的关闭标准 |
|---|---|---|
| G2-H01 | TASK-005 coverage/last_import 查询 | C 只得到消息统计；多版本不重复累计；日期边界正确，非法输入稳定拒绝。 |
| G2-H02 | TASK-005 店铺事务 | 两个同版本并发 PATCH 恰好一成功一 409；审计/事实锁不回退。 |
| G2-H03 | TASK-006 纯解析字段/语法 | 数值上界、精度、合法日历与带时区时间、必填/可选规则按六类合同；不补造来源时间；本轮反例全部成为断言。 |
| G2-H04 | TASK-006 接口与 fixture | typed CanonicalBatch/coverage manifest 元数据存在；两店规范 coverage 明确；A M3=false、B null；独立 oracle 与 CSV/Mock 两层校验。 |
| G2-H05 | TASK-007 查询/文件/Worker | P/C 可读自身授权类型，C 禁止订单；旧身份失效后任务/下载重新拒绝；保留跨组织 404。 |
| G2-H06 | TASK-007 HTTP 接收链 | 真分块输入达到字节/逻辑行限额立即中止，不等 multipart 结束；quoted 换行不误拒，失败无残留。 |
| G2-H07 | TASK-007 幂等 | 并发同内容同任务；正确 HTTP Key 隔离和 hash 冲突 409；不同阶段幂等含义分开。 |
| G2-H08 | TASK-007 文件/队列状态机 | 落盘失败、队列投递失败、Worker 文件失败/重试/中断后能恢复或明确终态失败；没有空对象复用、丢投递或 completed+validating。 |
| G2-H09 | TASK-007 私有运行配置 | 合成文件不进 Git/镜像；Web/Worker 共享持久存储且环境明确；真实隔离 Compose 上传→校验→读回→重启验证。 |

执行顺序：先固定每项反例与合同覆盖表，按 TASK-005 → 006 → 007 一次一个 TASK 修复；同一消费者的成功、拒绝、并发和恢复边界一并检查。每项记录“原反例→相关边界→修复提交→回归结果→剩余项”。MEDIUM/LOW 按第5/6节逐项处理或说明，不能隐去，也不整体升级 HIGH。最终候选跑一次完整已有测试及这些有意义的回归，再交 Codex；不需要每改一个函数让 Owner 中转。

## 14. 是否需要 Codex 复审

**YES。** 下轮从 `ce5f286..新冻结提交` 审查修复差异，逐项关闭本报告 H01–H09，核定 M/L；保留已通过的 Phase 2 正常路径作为回归。若改动依赖、Schema、连接或授权公共入口，才补对应 Phase 1 回归并说明触发原因。不重复审查未变旧问题，也不承诺没有证据前必然一轮 PASS。

## 15. Gate 结论

- **技术 Gate：FAIL。** 证据足以确认缺陷，故不使用只有“缺证据”的 BLOCKED 代替本轮结论。
- **是否允许 phase/02-data-ingestion 合并 main：NO。**
- **是否允许开始 Phase 3 / TASK-008：NO。**
- **当前交接：Phase 2 / TASK-007 / 待修复 / ZCode / Checkpoint=YES；完整接手提示词为 `prompts/P08_FIX.md` 首个 text 代码块。**
- 本轮只新增审查证据并更新原有管理文档/生成视图，未修改业务代码、测试、Schema、依赖，未提交、推送、合并或部署。完成与同步读回结果见证据 `final-verification.json`。
- 修复后先由 Codex 独立 PASS，再等待 Owner 明确说 **“放行 Phase 2”**。测试通过、GitHub 候选已推送、Product OS sync 成功均不等于放行。
