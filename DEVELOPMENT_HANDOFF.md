# DEVELOPMENT_HANDOFF — AI 电商运营助手

版本：P0 冻结交接版 · 2026-09-11  
执行对象：Zcode  
首个任务：**TASK-001：可启动的应用与验证环境**  
交付状态：规格已确认，应用尚未开发；全部开发任务尚未开始。

## 1. 给 Zcode 的执行指令

你接手的是已完成设计的开发项目。收到本文件作为开发指令后，直接执行 TASK-001，不再讨论产品定位、重新选择技术栈或扩展功能。第一轮只完成 TASK-001、运行对应检查、更新进度并交付结果；不顺手实施 TASK-002。

本文件冻结本轮 P0 范围与开始方式。配套规格中的未来规划不属于开发输入，旧文档“执行开发需用户另行发起”描述的是上一轮只做设计的状态；本交接指令被用于启动开发后，不再把该句作为重复确认门槛。本次编写交接文档本身没有执行应用开发。

普通工程细节、兼容补丁版本和局部文件拆分，在既定技术栈与 TASK 范围内自行完成。只有真实阻塞当前验收的缺失信息才需要询问；先给出已完成内容、具体错误和最小所需输入。百炼密钥、云资源、域名和客户文件均不阻塞 TASK-001。

### 1.1 工作位置与文档真源

当前交接根目录为 `/Users/yuyuyu/Documents/ChatGPT/产品-开发`。在其他机器执行时，以本文件所在目录为交接根目录，以下相对路径保持不变。

| 路径 | 用途 |
|---|---|
| `DEVELOPMENT_HANDOFF.md` | P0 范围、开始指令与 TASK-001 执行包 |
| `ai-ecommerce-assistant/` | 应用目录；TASK-001 在这里初始化工程，独立 package.json、src、测试与运行配置 |
| `docs/ai-ecommerce-assistant/` | 已确认的详细规格；按当前 TASK 查阅对应部分 |
| `docs/ai-ecommerce-assistant/12_PROGRESS.md` | 唯一开发进度记录；规则中的 progress.md 即此文件 |

应用目录是现有“独立应用子目录”约定的具体落点。当前已有 Git 仓库时沿用仓库，不另建嵌套仓库；不移动或覆盖根目录已有报告，不把图豆调研报告当代码模板。不再复制一套可编辑进度文件到应用目录。

若只传递本文件，TASK-001 的范围与验收可直接使用下文；继续后续任务前，需要同时取得 `docs/ai-ecommerce-assistant/` 的配套规格。不得凭本文件摘要重新发明数据库字段或 AI Schema。

### 1.2 TASK-001 的阅读顺序

1. 本文件全文，重点是第 3、4 节。
2. [12_PROGRESS.md](docs/ai-ecommerce-assistant/12_PROGRESS.md)：确认实际状态，不覆盖已有开发记录。
3. [11_DEVELOPMENT_RULES.md](docs/ai-ecommerce-assistant/11_DEVELOPMENT_RULES.md)：只读执行规则、PART 14 的本版技术栈和 PART 16 目录职责。
4. [08_API_SPEC.md](docs/ai-ecommerce-assistant/08_API_SPEC.md)：TASK-001 只使用 `/api/health` 契约。

无需为 TASK-001 先实现或完整展开其余业务文档。

## 2. P0 产品范围已冻结

### 2.1 唯一目标

老板每天打开一次系统，在一页中看懂：本店经营发生了什么、哪些变化需要复核、证据在哪里，以及今天优先做什么。目标用户为约 10—100 人的电商团队，具体使用者是老板、运营负责人、商品运营和客服负责人。

流程固定为：**登录与选店 → CSV 导入及确认 → 指标计算 → 规则异常 → VOC 聚合 → 结构化日报/建议 → 用户记录本人行动状态。**

### 2.2 开发白名单

| 能力 | 本版交付边界 |
|---|---|
| 身份与组织 | 邮箱密码登录、初始化 Owner、受控邀请、组织成员、四种固定角色、服务端租户隔离 |
| 店铺与来源 | 建店、改名、归档、固定时区/币种、CSV/Mock 数据源、来源覆盖状态 |
| 文件导入 | 六种 CSV 模板；字段映射、全量校验、脱敏预览、明确确认、原子提交、去重与更正、错误下载、任务恢复 |
| 经营数据 | GMV、付款订单数、销量、客单价、事件日退款金额、成熟队列退款/售后率、广告花费/归因销售额/ROAS、趋势和覆盖说明 |
| 首页 | 日期及覆盖、经营摘要、AI 四条结论、分类异常、商品表现、VOC、最多三条优先行动 |
| 商品分析 | SKU 列表/详情、销量/金额/成熟退款率、下滑和异常列表、按既有 Product 关系聚合、相关 VOC/告警 |
| 客服分析 | FAQ/VOC/售后三个 Tab；消息主题/情感分类、确定性计数、脱敏样本、固定词表变化、人工标签修正 |
| 告警 | 既定十条 P0 规则、基准与样本、阈值配置、状态记录、版本重算 |
| AI 与日报 | 一个固定模型、结构化结果、证据与权限校验、每日固定调度、手动生成、历史阅读、失败降级 |
| 行动状态 | 每人独立记录 pending/accepted/done/dismissed，不改变建议原文 |
| 必要设置与运行 | 组织/成员/固定权限说明、AI 开关与额度、私有文件、日志审计、任务状态、备份恢复、测试与试点运行说明 |

页面、表、接口、依赖和任务必须能归入以上白名单及现有 TASK。清单外不建功能、空路由、假按钮或后台运行逻辑；配套规格中的架构展望不作为开工清单。首页 ROI 只显示“不可计算，缺少完整成本数据”，不新增 ROI 工作台或估算结果。其他未支持指标按既定接口返回 unavailable/null。

### 2.3 P0 页面清单

| 路由 | 职责 |
|---|---|
| `/login`、`/invite/[token]` | 登录和受控邀请接受 |
| `/dashboard` | 单店经营晨报；Owner/Admin/Operator 使用 |
| `/data/metrics` | 指标、趋势、口径与覆盖 |
| `/data/reports`、`/data/reports/[reportId]` | 日报列表与冻结历史 |
| `/products/skus`、`/products/skus/[skuId]` | SKU/产品聚合对照与详情 |
| `/customer-service?tab=faq/voc/after-sales` | 三个客服 Tab；CustomerService 的默认入口 |
| `/alerts` | 分类告警、证据与处理状态 |
| `/ai-insights?tab=focus/diagnosis/issues/actions/priority` | 同一批结果的五种视图 |
| `/ai-insights/[insightId]` | 建议详情与本人行动状态 |
| `/import`、`/import/[importId]` | 上传、映射、预览确认、历史与恢复 |
| `/settings?tab=organization/stores/data-sources/ai/members/permissions` | 必要设置与只读固定权限说明 |

斜线分隔的 query 值表示单个参数的可选值，不是同时传入的字符串。路径参数遵循各页面原规格；不另造重复首页、VOC 或报表路由。TASK-001 只建立基础 layout 与健康检查，不提前建设上述业务页面。

## 3. 最终技术栈

一个应用代码库、一个 PostgreSQL、一个 Web 进程、一个 Worker 进程。Web/Worker 共享领域服务与发布版本。

| 部分 | 已确认选择 |
|---|---|
| 运行环境 | Node.js 24 LTS、pnpm；在工程配置与 lockfile 锁定兼容的精确版本 |
| 前端 | Next.js App Router、React、TypeScript、Tailwind CSS |
| 后端 | 同项目 Next.js Route Handlers；业务 REST 前缀 `/api/v1`，Node runtime |
| 数据库/ORM | PostgreSQL 17、Prisma ORM、Prisma Migrate |
| 登录 | Better Auth email/password、Prisma adapter、数据库 Session |
| 后台任务 | pg-boss、单一 Worker 入口、持久任务状态与事务发件箱 |
| LLM | 阿里云百炼北京 `qwen-flash-2025-07-28`，非思考模式，原生 HTTPS 兼容接口 |
| 校验 | Zod 用于 HTTP/表单；Ajv 2020 + ajv-formats 用于唯一 AI JSON Schema |
| 文件/CSV | 开发环境 LocalStorageAdapter；私有阿里云 OSS + ali-oss；csv-parse 流式解析 |
| 图表 | Recharts |
| 部署 | Docker Compose、Caddy、HTTPS；既定试点落点为阿里云 ECS 单机 |
| 日志/监测 | Pino、滚动日志、健康接口、Worker 状态；部署阶段接主机监控 |
| 测试 | Vitest、Testing Library、真实 PostgreSQL 集成、Playwright |

不启用 Embedding、向量数据库、RAG 或 Agent 框架。依赖按当前 TASK 需要安装，技术栈表不意味着 TASK-001 就要完成模型、认证、云存储或全部队列业务。不得因本机已有其他 Node 版本而修改运行时选型；在应用隔离环境使用 Node 24，不改动其他项目运行环境。

## 4. TASK-001：Zcode 第一轮执行包

### 4.1 任务合同

| 字段 | 固定内容 |
|---|---|
| 名称 | 可启动的应用与验证环境 |
| 目标 | 建立本地 Web、独立 Worker 和 PostgreSQL 可连通的最小工程 |
| 依赖 | 无前置开发 TASK；本交接规格已确认 |
| 修改范围 | `ai-ecommerce-assistant/` 的根配置、基础 `src/app`、`src/lib/env.ts`、`src/jobs/worker.ts`、Docker/Compose、README、测试配置；以及唯一进度文件 |
| 输入 | 本文件第 3、4 节；配套技术栈/目录职责和健康接口契约 |
| 输出 | 锁定依赖、基础页面、健康接口、独立启动入口、可运行检查命令、本地运行说明 |
| 验收标准 | 空业务库环境启动成功；真正连接 PostgreSQL；缺失启动必需变量时明确失败；健康输出无敏感配置；关闭 Worker 可被状态检查发现 |
| 测试方式 | 构建、类型检查、真实数据库连接、健康接口 smoke、环境变量错误与 Worker 停止检查 |
| 禁止修改 | 业务范围和厂商选型；现有其他项目文件；不得提前建立业务实体/业务页面、收费模型调用或云端部署 |

### 4.2 执行步骤

1. 检查当前目录、已有文件与进度。只在指定应用目录创建或续接工程；不要清空已有目录，不重置仓库。
2. 使用 Node 24 和 pnpm 初始化 Next.js/TypeScript/Tailwind 基础工程，锁定兼容版本，保留一份 lockfile。建立最小 layout 和可打开的基础页，不放业务假数字。
3. 建立本地 PostgreSQL 17 运行配置与真实连接检查。此任务只需要空业务库可连接；领域表和正式迁移属于 TASK-002。
4. 建立 `src/jobs/worker.ts` 独立入口，具备启动、数据库连通检查、可检测的运行状态和正常退出。pg-boss 业务 handler/dispatcher 在 TASK-007 实施，此处不注册空的导入、AI 或日报任务来冒充可用。
5. 建立 `src/lib/env.ts` 与 `.env.example`。按当前启用的组件校验变量，缺少当前启动必需值时给出安全且明确的错误。
6. 实现 `GET /api/health`：健康时 HTTP 200、status=ok；基础服务不可用时 HTTP 503、status=degraded。响应不返回连接串、密钥、内部配置、堆栈或业务数据。Worker 运行状态可通过内部状态检查/Compose 检查验证，不要求公开探针暴露细节。
7. 接好下表命令，运行与 TASK-001 相称的检查；用真实结果填写 README 与进度，不用空测试或固定成功结果代替验证。
8. 只更新 TASK-001 的实际状态，记录版本、命令、结果、修改路径和限制。验收通过后报告 TASK-001 完成，下一项为 TASK-002；第一轮到此结束。

### 4.3 应用目录与命令约定

以下目录在 TASK-001 按实际需要建立；未使用的业务目录无需批量生成空壳。

```text
ai-ecommerce-assistant/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/health/route.ts
│   ├── lib/env.ts
│   └── jobs/worker.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── Dockerfile
├── compose.yaml
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── README.md
```

| 在应用目录执行的命令 | 本轮必须提供的行为 |
|---|---|
| `pnpm install --frozen-lockfile` | 从已交付 lockfile 安装可重复的依赖 |
| `pnpm dev` | 启动本地 Web |
| `pnpm build` | 构建可运行的 Web 与所需 Worker 产物 |
| `pnpm start` | 启动构建后的 Web |
| `pnpm worker:dev` | 独立启动开发 Worker |
| `pnpm worker:start` | 独立启动构建后的 Worker |
| `pnpm typecheck` | 执行 TypeScript 类型检查 |
| `pnpm test` | 执行本轮有实际断言的单元检查，例如环境变量校验 |
| `pnpm test:integration` | 验证真实 PostgreSQL 连通及相关服务行为 |
| `pnpm test:e2e` | 用 Playwright 验证基础页/健康接口可访问，不伪装业务闭环 |
| `docker compose up -d --build` | 按本地配置启动 Web/Worker/PostgreSQL；记录实际访问地址与状态检查方法 |

这些是 TASK-001 要交付的命令契约，不是当前已经存在或已运行成功的命令。README 必须给出可从干净环境执行的实际步骤、环境文件使用方式、启动顺序、访问地址、停止方法和常见失败信息。

### 4.4 环境变量分阶段生效

- TASK-001 使用本地 `DATABASE_URL` 和当前进程所需运行配置；先验证本地数据库连接。
- `.env.example` 按既定规范列出认证、模型与存储变量名及说明，秘密值留空，不填写假生产密钥。
- `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL` 在认证启用时校验；TASK-001 不提前实现完整认证。
- `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`AI_MODEL_ID` 在模型接入任务处理。未配置模型时基础 Web/Worker 仍可启动；不得为通过启动而发起真实收费调用。
- `STORAGE_DRIVER=local` 使用开发本地存储；OSS 变量只在启用 OSS 时要求。TASK-001 不需要云账号、真实 Bucket 或公网域名。
- 真实 `.env` 不进 Git，客户端包与普通日志不含数据库凭据、Cookie 或 Key。

### 4.5 完成与阻塞的判断

必须实际确认：干净安装、构建、类型检查、本轮单元/集成/E2E 检查通过；Web 与独立 Worker 可启动；数据库可连接；缺失当前必需配置会失败；Worker 停止后状态检查能识别；公开健康响应不泄密。

缺依赖或环境不兼容先在应用范围修复并复测。确实无法满足环境条件时，记录已尝试操作、真实错误和剩余步骤，TASK-001 标 BLOCKED，不写 DONE。不可用跳过数据库、无测试放行、写死健康状态的方式通过验收。

## 5. 所有 P0 TASK 必须遵守的业务不变量

以下用于防止实现偏离既有规格，不增加页面、接口或数据源。

### 5.1 数据、金额与时间

- 每次查询一店一币种，店铺采用固定 IANA 时区，事实时间存 UTC；日期区间为 `[from,to)`。默认昨日完整自然日，今天必须标注截至时间与未完结状态。
- 金额用 Decimal 计算、原始值 numeric(20,6) 存储、API 十进制字符串；聚合使用 numeric(24,6) 并检查金额和安全整数上界。禁止浮点财务计算、NaN/Infinity、混加币种。
- `MetricValue.status` 只取 available/unavailable；`coverage_status` 为 complete/partial/missing；`maturity` 为 mature/provisional/not_applicable。缺失、零值、部分覆盖与未成熟分别处理。
- GMV 只汇总已付款订单行商品实付，不再加订单头金额；多商品行订单只计一次订单。`expected_item_count` 不满足时相关金额/销量标 partial。
- 退款金额按独立成功事件与完成日求和；D+7 使用付款起连续 168 小时观察窗。SKU 退款件数取同订单行窗内累计退件量最大值，不把同一件分两笔退款计为两件。窗外退款不倒灌 D+7 分子。
- 广告销售额是平台归因销售，ROAS=同归因组广告销售额/花费；花费为零时 ROAS=null。不得当作经营 ROI。
- 本版没有完整成本、库存、流量、评价来源，相关指标按规范 unavailable，不造值或新增数据模板。

### 5.2 导入与发布

只接收 `products.csv`、`orders.csv`、`order_items.csv`、`ads.csv`、`customer_messages.csv`、`after_sales.csv`。Excel 用户另存 CSV UTF-8。文件上限 20MB/100000 数据行；六类精确字段、自然键与错误规则沿用 [04_DATA_MODEL.md](docs/ai-ecommerce-assistant/04_DATA_MODEL.md) PART 12。

先商品，再订单头，再订单行；退款/售后引用需已经存在或按规范可解析。CSV 与 Mock 统一 Adapter，Mock 不直接写页面指标或告警。演示组织与真实组织隔离并明确标记。

每文件全量校验、预览确认、原子提交。一个错误行阻止整文件提交；按自然键和来源更新时间更正，不按名称猜测合并，不因漏行重传删除旧数据。空文件不等于零事件；合法表头且显式零事件声明才能进入 coverage-only 确认。case/refund 的覆盖独立记录。

事实写入、版本递增、待派发记录同事务提交；队列重投必须幂等。确定性指标/规则/VOC 发布同一个完整快照；旧任务不得覆盖新版本。AI 不阻塞核心发布。有效 VOC 分类/人工修正也进入版本链；旧 AI 标 stale，历史报告不静默改写。

### 5.3 权限与行动

固定 Owner、Admin、Operator、CustomerService 四角色；所有接口、后台任务、缓存、文件与 AI 证据先校验租户/店铺/当前成员权限。

Owner/Admin/Operator 可看经营；CustomerService 默认进客服中心，只看脱敏客服数据及允许的 SKU 标识、客服建议，不能得到 Dashboard、财务日报或混合经营证据。客服只可导入 customer_messages。Owner/Admin 维护设置；Admin 只管理 Operator/CustomerService，不能授予或修改 Owner/Admin。

所有角色仅修改本人行动状态，唯一键 `(insight_id,action_id,user_id)`。状态为 pending/accepted/done/dismissed；默认未操作版本 0，更新检查 expected_version。done 只表示用户记录完成，不代表经营效果已经改善。告警处理状态与本人行动状态是两个不同对象。

### 5.4 规则与 AI

启用的 P0 规则为 R01/R02/R03/R05/R07/R08/R09/R10/R11/R12，阈值、基准和最低样本沿用 [07_ALERT_RULES.md](docs/ai-ecommerce-assistant/07_ALERT_RULES.md) 的对应行。缺覆盖、缺历史、分母不足或队列未成熟时暂停对应业务告警，不交给模型补判断。运行故障通过 data_status/job_failure 展示，不冒充已发布业务告警。

VOC 使用既定 voc-v1 标签；模型逐消息分类，SQL 确定性计数，人工有效标签优先。unknown 情感不进入负面率分母；classification_coverage 与 sentiment_coverage 分开。投诉标记缺失不当 false，也不把负面情感当作明确投诉。

所有 LLM 输出先解析 JSON，再 Ajv，再核对授权证据、数值、版本和引语。唯一完整 Schema 取自 [06_AI_CAPABILITIES.md](docs/ai-ecommerce-assistant/06_AI_CAPABILITIES.md) PART 9，包括 AIInsight envelope、llmPayload、vocBatch、dailyConclusion；不能根据摘要重写另一套结构。Schema 的 priority 枚举表示行动紧急度，与开发范围无关。

经营建议包含问题、数据依据、可能原因、动作、优先级、预期影响与证据充分性；原因是待核实假设，不承诺销售提升。服务端生成元数据，模型不能决定租户、权限、处理状态或实际业务数值。AIInsight 的 generation_status 只取 succeeded/failed/skipped；失败/跳过时 payload=null，规则摘要明确标注来源。

日报固定店铺本地每日 08:00；手动和定时同版本复用。每组织默认模型预算每日 3 元、每月 100 元、每日自动分类最多 2000 条；任一预算耗尽暂停新调用。每批最多 20 条、每条 500 字、总文本 12000 字；单次输入最多 16000 tokens、输出最多 6000 tokens。LLM 全局并发 2、每组织 1；总尝试最多 3 次，其中格式修复最多 1 次。按每次外呼预占与结算，usage 未知不立即释放额度。具体计费和调度均沿用现有合同，不增加模型路由。

## 6. 固定任务顺序

以下 30 项均属于既有 P0，没有新增 TASK。表中只作定位，实际状态只读写 [12_PROGRESS.md](docs/ai-ecommerce-assistant/12_PROGRESS.md)。TASK-002 起每项完整的目标、修改范围、输入、输出、验收和测试取自 [09_TASKS.md](docs/ai-ecommerce-assistant/09_TASKS.md) 对应编号；一次只推进一项，依赖未通过不开始。

| TASK | 名称 | 依赖 |
|---|---|---|
| TASK-001 | 可启动的应用与验证环境 | 无前置开发任务；执行本交接指令 |
| TASK-002 | P0数据库与约束迁移 | TASK-001 |
| TASK-003 | 登录、初始Owner与受控邀请 | TASK-002 |
| TASK-004 | 组织隔离与固定权限服务 | TASK-003 |
| TASK-005 | 店铺与数据源配置 | TASK-004 |
| TASK-006 | 统一Adapter与最小黄金样本 | TASK-005 |
| TASK-007 | 文件上传、私有存储与ImportTask | TASK-006 |
| TASK-008 | 字段映射、全量校验与预览 | TASK-007 |
| TASK-009 | 原子提交内核与商品主数据 | TASK-008 |
| TASK-010 | 订单头与订单行导入 | TASK-009 |
| TASK-011 | 广告日数据导入 | TASK-009 |
| TASK-012 | 客服、售后与退款事件导入 | TASK-009、TASK-010 |
| TASK-013 | 持久任务与快照发布骨架 | TASK-010、TASK-011、TASK-012 |
| TASK-014 | 基础经营与广告指标 | TASK-013 |
| TASK-015 | 退款与售后队列指标 | TASK-014 |
| TASK-016 | 确定性异常规则与快照发布 | TASK-015 |
| TASK-017 | 模型网关与结构化输出门禁 | TASK-004、TASK-016 |
| TASK-018 | VOC分类、人工标签优先与聚合 | TASK-017、TASK-012 |
| TASK-019 | 有证据的运营建议 | TASK-018 |
| TASK-020 | 固定日报调度与规则降级 | TASK-019 |
| TASK-021 | Dashboard与3分钟老板路径 | TASK-020 |
| TASK-022 | SKU列表、详情与产品聚合 | TASK-021 |
| TASK-023 | 客服中心与VOC人工修正 | TASK-018、TASK-021 |
| TASK-024 | 告警中心与阈值配置 | TASK-016、TASK-021 |
| TASK-025 | 建议行动状态与日报阅读 | TASK-020、TASK-021 |
| TASK-026 | 导入向导与历史问题恢复 | TASK-008至TASK-016、TASK-021 |
| TASK-027 | 必要系统设置与成员管理UI | TASK-005、TASK-017、TASK-021 |
| TASK-028 | 演示包与手工可核对案例 | TASK-022至TASK-027 |
| TASK-029 | 试点运行与最低安全运维 | TASK-028 |
| TASK-030 | 整体验收与真实试点交接 | TASK-029 |

TASK-001 的执行起点按本交接文件第 4 节；其后不改编号、不合并任务、不跳过测试。最终任务包含试点环境与交接，但 TASK-001 不申请云资源、发布网站或导入客户文件。

## 7. 后续 TASK 的精确规格索引

| 需要确认的内容 | 唯一详细来源与使用范围 |
|---|---|
| 角色授权 | [02_USER_ROLES.md](docs/ai-ecommerce-assistant/02_USER_ROLES.md)，固定权限矩阵 |
| 页面、首页与路由 | [03_INFORMATION_ARCHITECTURE.md](docs/ai-ecommerce-assistant/03_INFORMATION_ARCHITECTURE.md)，只使用本文件第 2 节列出的 P0 页面与组件 |
| 表结构、Adapter、CSV、手算样本 | [04_DATA_MODEL.md](docs/ai-ecommerce-assistant/04_DATA_MODEL.md)，P0 实体及 PART 11/12；不建立规划实体 |
| 指标 | [05_METRIC_DEFINITIONS.md](docs/ai-ecommerce-assistant/05_METRIC_DEFINITIONS.md)，P0 可计算指标及既定 unavailable 返回 |
| AI 结构与失败/额度 | [06_AI_CAPABILITIES.md](docs/ai-ecommerce-assistant/06_AI_CAPABILITIES.md)，现有生成能力、完整 Schema、失败与成本约束 |
| 异常规则 | [07_ALERT_RULES.md](docs/ai-ecommerce-assistant/07_ALERT_RULES.md)，只实现第 5.4 节列明的十条规则 |
| 请求/响应/错误 | [08_API_SPEC.md](docs/ai-ecommerce-assistant/08_API_SPEC.md)，现有 P0 REST 契约；分页默认 25、最大 100 |
| TASK 合同 | [09_TASKS.md](docs/ai-ecommerce-assistant/09_TASKS.md)，当前 TASK 及已完成依赖 |
| 最终验收、安全与隐私 | [10_ACCEPTANCE_CRITERIA.md](docs/ai-ecommerce-assistant/10_ACCEPTANCE_CRITERIA.md)，现有 P0 必过项 |
| 工程规则与目录职责 | [11_DEVELOPMENT_RULES.md](docs/ai-ecommerce-assistant/11_DEVELOPMENT_RULES.md)，已确认本版选型与职责 |
| 实际状态与证据 | [12_PROGRESS.md](docs/ai-ecommerce-assistant/12_PROGRESS.md)，唯一进度真源 |

本文件管理 P0 范围和本次启动方式；详细字段以对应主文档为准。跨文档通用参数以接口主文档为准，例如验收文字的分页默认数不替代接口的 25。遇到真正影响当前任务的合同冲突，记录具体字段与最小修正，不借机重新设计产品。不从旧合订本或商业调研中增加需求。

## 8. 完成标准与每次交付

### 8.1 工程完成标准

沿用已确认的验收：六类文件从新环境导入后可查询指标、告警、SKU、VOC、日报与本人行动状态；重传、更正、缺行、明确零事件、队列成熟度与快照竞态正确；两组织四角色隔离通过；AI 结构及业务校验有效，AI 失败不使核心页面不可用；没有未处理的严重数据或权限问题。

固定黄金案例需可手算对账：A 店指定付款日 GMV=230、订单数=2、销量=4、客单价=115；成熟 D7 订单退款率=1/2，S1 退款件率=1/3；窗内退款金额=110，全部事件退款金额=120；B 店 GMV=900 独立隔离。以上是测试预期，当前不是软件运行结果。

完整模型验收仍需固定证据包和脱敏文本的联网评测；Schema 示例检查不替代模型质量评测。已定性能规模、p95/p99、导入/发布耗时、三分钟用户路径和备份恢复目标按验收主文档执行，不提前放宽，也不在 TASK-001 执行整套业务压测。

### 8.2 每个 TASK 的记录要求

- 先将当前 TASK 标为 IN_PROGRESS，任何时刻只执行一项。
- 运行该 TASK 指定检查与类型检查；不为低影响改动新写复述实现的测试，不把未执行写成通过。
- 验收通过才标 DONE；真实阻塞标 BLOCKED，写具体错误、已尝试操作、所需输入和未完成项。
- 在唯一进度文件记录日期、TASK、执行者、修改路径、依赖版本、实际命令及结果、证据路径、限制和下一项。
- 对用户报告：本 TASK 完成了什么、实际测试结果、尚存限制、下一 TASK。应用可启动、工程验收、部署可访问、真实试用、再次使用与付款分别记录。

冻结要求持续有效：不改产品范围、不换技术栈、不加大型依赖、不做无关重构；UI 先保证使用与状态清晰；Mock 与真实数据共用 Adapter；LLM 输出必须校验，指标不用 LLM，异常先用规则；重要逻辑必须可测试；未在 P0 TASK 中明确的业务行为不实现。

**Zcode 现在的第一步：读取进度，在 `ai-ecommerce-assistant/` 开始 TASK-001，交付可启动的本地 Web/Worker/PostgreSQL 与真实验证结果。**
