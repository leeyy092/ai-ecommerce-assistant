# 接口规格

版本：v1.0 · 2026-09-11。状态：产品与工程规格；应用尚未开发。P0为本次定义的开发范围，P1/P2只作规划。

# PART 17｜API 设计

## 17.1 统一协议

业务采用REST，前缀 `/api/v1`；认证端点保留Better Auth原生 `/api/auth`。所有业务端点采用Session Cookie；服务器从会话及有效Membership推导组织。客户端传 `store_id` 是选店条件，不是授权凭据。不接收可用于越权的 `org_id` 覆盖。组织选择是已认证用户已有membership的切换。

成功：`{data: T, meta: {request_id, dataset_version?, latest_dataset_version?, snapshot_status?, timezone?, currency?, next_cursor?}}`；列表 `data.items`，页大小默认25、最大100，游标用稳定 `(sort_value,id)`，禁止无上限导出。错误：`{error:{code,message,field_errors?,retryable,request_id}}`，不返回SQL、堆栈和模型原始输出。认证库端点保留官方响应，前端auth-client负责适配，不冒充同一信封。

所有日期查询 `from`、`to` 为本店本地日期，右开区间，单次最大90天；单日日报1天。时间戳RFC3339带时区；金额字符串；比率小数而非带百分号字符串。空值为 `null` 并附 unavailable_reason，不能用0代替。MetricValue.status唯一为available/unavailable；coverage_status为complete/partial/missing；maturity为mature/provisional/not_applicable。三个维度不可混成一串状态，规则还要检查覆盖和成熟度。`dataset_version` 对发布聚合是 `current_snapshot_version`；原始ImportTask接口同时报告最新事实版。每个请求必须一致读取一次(data_version,ruleset_version,metric_version)发布身份；data_version在API中固定命名dataset_version。只在服务器缓存按 org/store/permission_scope/version/range 完整分键的数据，业务HTTP `Cache-Control: private,no-store`。

公共错误：401 `UNAUTHENTICATED`；403 `FORBIDDEN`；不可见资源统一404 `NOT_FOUND`；409 `VERSION_CONFLICT/IMPORT_CONFLICT`；422 `VALIDATION_ERROR`；429 `RATE_LIMITED/AI_BUDGET_EXCEEDED`；503 `SERVICE_UNAVAILABLE`。不提供原始订单/客户PII通用查询API。

角色缩写：O=Owner，A=Admin，P=Operator，C=CustomerService；“全员”仍需组织成员关系有效。“客服投影”必须先在服务端选白名单字段、客服分类和证据，再序列化。

## 17.2 Auth、组织、Store、设置

| Endpoint | Method | Request | Response | Authentication | Errors |
|---|---|---|---|---|---|
| `/api/auth/sign-in/email` | POST | email、password、rememberMe=false | 库原生user/session + Set-Cookie | 公开但限流；无开放注册 | 401凭据无效、429 |
| `/api/auth/sign-out` | POST | 空body，可信Origin | 原生success并撤销session | 登录 | 401 |
| `/api/auth/get-session` | GET | 无 | 原生session/user或null | Cookie | 503 |
| `/api/auth/change-password` | POST | currentPassword、newPassword、revokeOtherSessions=true | 库原生成功结果 | 登录 | 400/401/422 |
| `/api/v1/me` | GET | 无 | user的id/name/email，memberships、active_org、role、allowed_modules | 全员 | 401/503 |
| `/api/v1/me/active-organization` | PUT | organization_id | 新active_org与role；清空客户端旧域缓存 | 该组织成员 | 404 |
| `/api/v1/organization` | GET | 无 | id/name、demo_mode、配置版本；O/A可看限额 | 全员分字段 | 401 |
| `/api/v1/organization` | PATCH | name、expected_version | 更新后元数据 | O/A | 409/422 |
| `/api/v1/stores` | GET | cursor/limit | items: id/name/platform/currency/timezone/status；C无经营数值 | 全员 | 401 |
| `/api/v1/stores` | POST | name、external_store_id、platform(enum manual/amazon/shopify/shopee/tiktok/other)、currency、timezone；demo_mode继承组织不可自行切换 | 201 Store；平台只是标签，不表示已连接 | O/A | 409同名、422 |
| `/api/v1/stores/{id}` | PATCH | name/status(active/archived)、required_channels可选、expected_version | Store；首笔事实后禁止改币种/时区/namespace | O/A | 409 `STORE_CONFIG_LOCKED` |
| `/api/v1/data-sources` | GET | store_id、from/to可选 | id/adapter_kind/source_namespace/mapping_version、supported_entities（按角色裁剪）、coverage按日摘要、last_import_at | O/A/P；C仅消息源 | 404 |
| `/api/v1/data-sources` | POST | store_id、name、adapter_kind=csv/mock、source_namespace；P0同一来源支持六类标准文件 | 201 DataSource；mock只能写演示店 | O/A | 422/409 |
| `/api/v1/members` | GET | cursor/limit | id/name/email/role/status | O/A | 403 |
| `/api/v1/invitations` | POST | email、role(仅允许授予范围) | 201 id、一次性邀请URL、expires_at | O可邀A/P/C，A只可邀P/C | 403/409已成员 |
| `/api/v1/invitations` | GET | status=pending/expired/revoked、cursor/limit | id、遮罩email、role、expires_at、status；不回原始token | O/A在可管理角色范围 | 403 |
| `/api/v1/invitations/{id}` | DELETE | expected_version | 200 revoked；立即使未使用token失效 | O/A在可管理角色范围 | 404/409已接受 |
| `/api/v1/invitations/{token}` | GET | path token | 组织名称、遮罩email、到期时间；无内部数据 | 未登录可验token | 404/410过期 |
| `/api/v1/invitations/{token}/accept` | POST | 新用户name/password；已有用户须登录且email一致 | membership，之后正常登录；原子消耗token | 邀请token+防爆破 | 409已用、410过期、403邮箱不符 |
| `/api/v1/members/{id}` | PATCH | role或status=disabled、expected_version | member并撤销被禁成员session/访问 | O可改非Owner；A只可P↔C或禁用P/C，不能动O/A | 403最后Owner、409 |
| `/api/v1/settings/ai` | GET | 无 | enabled、model_id、daily_budget_cny、monthly_budget_cny、used/reserved_cny、daily_message_limit、budget_timezone、provider_status、last_checked_at、日/月reset_at、配置版本；绝无Key | O/A | 403 |
| `/api/v1/settings/ai` | PATCH | enabled、daily_budget_cny(0—20)、monthly_budget_cny(0—500)、daily_message_limit(0—10000)、expected_version | 更新配置；不能在UI改provider或model/budget_timezone | O/A | 409/422 |
| `/api/v1/alert-rules` | GET | store_id | 规则阈值、启用状态、版本与样本门槛 | O/A/P | 403/404 |
| `/api/v1/alert-rules/{rule_id}` | PATCH | store_id、允许的thresholds、enabled、expected_version | 新配置版+rebuild_job_id | O/A | 409/422 |
| `/api/health` | GET | 无 | status为ok或degraded，无配置/数据 | 公开基础探针 | 503 |

初始Owner通过部署初始化创建；找回密码P0由部署管理员核验身份后执行一次性重置流程并撤销旧会话，不能由普通Admin知道或设置别人明文密码。自助邮件找回/自动发邀请邮件为P1。Owner创建组织的初始化与邀请是两条明确路径，不暴露匿名组织创建API。

## 17.3 Import 与更正

| Endpoint | Method | Request | Response | Authentication | Errors |
|---|---|---|---|---|---|
| `/api/v1/import-templates/{entity_type}` | GET | entity_type为6种文件类型 | CSV下载，带字段说明链接 | O/A/P；C仅customer_messages | 403/404 |
| `/api/v1/imports` | POST | multipart file、store_id、data_source_id、entity_type；Idempotency-Key | 202 ImportTask(id/status/filename/bytes) | O/A/P；C仅customer_messages且对应源 | 413超限、415类型、422、409 |
| `/api/v1/imports` | GET | store_id、status、cursor/limit | 自己可见类型的历史任务列表 | 全员受类型限制 | 404 |
| `/api/v1/imports/{id}` | GET | id | status/progress_counts/preview_version/error_counts/commit_result/stage，不返回原始消息 | 可访问该源且当前有权限 | 404 |
| `/api/v1/imports/{id}/mapping` | PUT | field_mapping、timezone确认、coverage_declaration、expected_preview_version | 202 validating；重跑全量校验，生成新preview_version；合法表头+显式零事件可生成coverage-only预览 | O/A/P；C仅消息 | 409状态变化、422 |
| `/api/v1/imports/{id}/preview` | GET | cursor/limit≤100 | 脱敏样本、insert/update/unchanged/rejected计数、覆盖缺口、hash、preview_version | 同上 | 409尚未校验 |
| `/api/v1/imports/{id}/commit` | POST | preview_version、confirmation=true；Idempotency-Key | 202同一commit任务ID；不是“已导入完成” | 同上且重新检查权限 | 409预览过期/冲突、422含错误行 |
| `/api/v1/imports/{id}/retry` | POST | expected_status、Idempotency-Key | 202从安全阶段重试同一任务 | 同上 | 409非可重试、429 |
| `/api/v1/imports/{id}/error-file` | GET | 无 | 5分钟下载URL；C字段投影 | 同上 | 404无错误文件 |
| `/api/v1/sku-aliases` | POST | store_id、source_namespace、external_sku_id、canonical_sku_id | 201明确映射记录；只影响后续校验，返回需重试的导入ID | O/A/P | 409已映射到别SKU、404异店、422 |

Dashboard.data_status包含published_version/latest_version/snapshot_status及job_failure（安全code、stage、failed_at、retryable）；没有运行故障时job_failure=null。运行故障提示不计入业务告警数。

coverage_declaration具体结构见PART12；不从“文件最后一行日期”推断完整性。来源source_namespace由DataSource固定；不能通过重传另一个namespace逃过去重。无通用 `PATCH /orders`、`DELETE /imports`；更正原文件后重导，旧更新时间不得覆盖新数据。文件重传和业务行重复是两个不同层次的幂等。

## 17.4 Dashboard、SKU、VOC、Alerts、AI、Reports

| Endpoint | Method | Request | Response | Authentication | Errors |
|---|---|---|---|---|---|
| `/api/v1/dashboard` | GET | store_id、from/to | summary_metrics、data_status、ai_conclusion、rule_summary、alert_groups(五类各最多3条及total)、sku_panels、voc_panels(complaints/faq/negative_keywords/after_sales各最多3条)、actions_top3；meta含统一快照版 | O/A/P | 403 C、422范围、503 |
| `/api/v1/metrics` | GET | store_id、from/to、metric_ids白名单、grain=day | metrics及series，每项value/unit/status/coverage_status/maturity/unavailable_reason/baseline/metric_version | O/A/P | 422未知指标 |
| `/api/v1/skus` | GET | store_id、from/to、group_by=sku/product、view=top/declining/abnormal/refunds、q、sort、cursor/limit | SKU id/code/name、销量/销售额/成熟退款率、告警数、coverage | O/A/P | 403/422 |
| `/api/v1/skus/{id}` | GET | store_id、from/to | 基础商品资料、已发布指标趋势、相关告警、VOC脱敏摘要、AI链接 | O/A/P | 404异店 |
| `/api/v1/voc` | GET | store_id、from/to、tab=voc/faq/after-sales、sku_id可选、category、cursor/limit | topics/counts/negative_voc_rate/unknown_count/coverage/classification_coverage/sentiment_coverage/classification_counts/sample_basis | 全员；C客服投影 | 422/404 |
| `/api/v1/customer-messages` | GET | store_id、from/to、sku_id可选、topic、sentiment、cursor/limit | message id/redacted_text、language、category、effective_label_source；无订单金额 | 全员 | 422 |
| `/api/v1/customer-messages/{id}/classification` | PATCH | primary_topic、secondary_topics(最多2项)、sentiment、note(≤500字)、expected_version | 人工effective_label及新修订，排队重算VOC | 全员 | 409并发修正、422 |
| `/api/v1/after-sales` | GET | store_id、from/to、reason、cursor/limit | 售后case的id/reason/status/occurred_at/sku_code；C不含退款金额与订单经营字段 | 全员投影 | 404 |
| `/api/v1/alerts` | GET | store_id、from/to、category/severity/status、cursor/limit | Alert列表+确定性证据+base/sample/threshold；C仅客服类别且无财务证据 | 全员投影 | 422/404 |
| `/api/v1/alerts/{id}` | PATCH | status=acknowledged/resolved/ignored、note、expected_version | 新状态/actor/时间；数值证据不可改 | O/A/P；C仅客服告警 | 409版本、403 |
| `/api/v1/ai-insights` | GET | store_id、from/to、category、record_status=active/archived、my_action_status、sort=priority/created_at、cursor/limit | 完整AIInsight envelope列表；只显示可授权建议；包含本人行动状态 | 全员投影 | 404/422 |
| `/api/v1/ai-insights/{id}` | GET | 无 | PART9完整验证后的AIInsight；可过期但醒目标记 | 全员受visibility_scope限制 | 404 |
| `/api/v1/ai-insights/generate` | POST | store_id、date、scope=business或customer_service、retry_failed=false；Idempotency-Key | 202 job_id/status，已有同版本有效结果则200返回id | O/A/P；C仅customer_service | 409快照更新、422缺证据、429额度 |
| `/api/v1/ai-insights/{id}/actions/{action_id}` | PATCH | status=pending/accepted/done/dismissed、expected_version | action_state及新状态版本 | 全员仅本人状态，C仅客服；未操作为version=0 | 409本人状态版本冲突、422 |
| `/api/v1/reports` | GET | store_id、from/to、cursor/limit | AIReport列表，period/generated_at/dataset_version/status | O/A/P | 403 C |
| `/api/v1/reports/{id}` | GET | 无 | 冻结的指标摘要、告警、建议ID、缺源、生成状态、引用版本 | O/A/P | 404 |
| `/api/v1/reports/generate` | POST | store_id、date、retry_failed=false、Idempotency-Key | 202 job_id；同配置/版本复用已有日报 | O/A/P | 409数据准备中、429 |
| `/api/v1/jobs/{id}` | GET | 无 | user_safe stage/progress/status/retryable；无prompt与原始payload | 发起人或O/A，且当前仍有域权限 | 404 |

服务端先对完整授权候选集按规则严重度、证据样本、生成时间及id稳定排序，再分页；首页前三条也从完整候选集选。my_action_status只筛当前用户状态，record_status只筛洞察active/archived，不混用。

同版本已有成功结果时生成端点始终复用。只有既有运行failed/skipped且用户显式retry_failed=true，才在原逻辑运行键下原子建立新的attempt_revision并再受预算/限流；保留旧运行记录。没有请求中的强制重生成成功结果能力。新数据/规则版本按新逻辑键生成。

客户端不能POST一份自己构造的AIInsight。AI相关GET返回PART9服务端组装且校验后的对象；AIInsight只允许 `succeeded/failed/skipped`。失败/跳过时payload=null；Dashboard的独立 `rule_summary` 和AIReport的 `summary_source=rules` 明确显示“规则摘要”，不能显示为模型分析成功。CSV导入成功不等于AI已经完成，状态在API里分开。

## 17.5 具体响应示例与幂等

以下示例只展示Dashboard中的GMV卡片；其他指标按同一DTO返回，不能把此示例值当成演示fixture真值。

```json
{
  "data": {
    "summary_metrics": [{
      "metric_id": "gmv",
      "value": "12500.000000",
      "unit": "currency",
      "currency": "CNY",
      "status": "available",
      "coverage_status": "complete",
      "maturity": "not_applicable",
      "unavailable_reason": null,
      "comparison": {"baseline_value": "10000.000000", "change_ratio": 0.25, "status": "comparable"}
    }]
  },
  "meta": {
    "request_id": "req-demo-001",
    "dataset_version": 7,
    "latest_dataset_version": 8,
    "snapshot_status": "updating",
    "timezone": "Asia/Shanghai",
    "currency": "CNY"
  }
}
```

变更接口支持 `expected_version` 乐观锁；若行版本不符返回409，前端刷新后由用户决定，不静默覆盖。Idempotency-Key按 org/user/endpoint 隔离，保存请求hash和结果24小时；同key不同body返回409。业务自然键、生成运行键长期保证幂等，不能只依赖24小时HTTP缓存。
