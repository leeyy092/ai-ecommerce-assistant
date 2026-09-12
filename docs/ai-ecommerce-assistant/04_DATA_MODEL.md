# 数据模型、数据流与CSV规范

版本：v1.0 · 2026-09-11。状态：产品与工程规格；应用尚未开发。P0为本次定义的开发范围，P1/P2只作规划。

# PART 10｜数据模型

## 10.1 建表约束与共用字段

以下是逻辑模型，Coding Agent据此建立Prisma模型及SQL约束。所有P0实体采用UUID领域主键；Auth框架的string主键通过User.auth_user_id映射，不强迫修改认证框架表。字段表内“—”表示无额外索引/关系，并非缺少定义。B组字段由每个注明“继承B”的实体完整继承；T组由店铺实体完整继承，避免逐表复写相同字段。共同外键使用复合(org_id,id)或(org_id,store_id,id)约束，不只在应用层检查。

|共用字段组/字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|B.id|uuid|是|服务端生成，不使用来源ID当主键|PK；UNIQUE(org_id,id)|供领域外键引用|
|B.org_id|uuid|是|服务端从session成员关系/后台任务推导|普通索引；与全部自然键组合|Organization.id|
|B.created_at|timestamptz|是|首次入库UTC时间|—|—|
|B.updated_at|timestamptz|是|最后写入UTC时间，不等于来源更新时间|—|—|
|B.row_version|integer|是|初始1；可变记录更新时CAS+1；API expected_version映射此字段，ActionState用其专用version|—|并发写冲突409|
|T.store_id|uuid|是|店铺事实所属店铺|INDEX(org_id,store_id)；UNIQUE(org_id,store_id,id)|Store复合外键|
|F.source_namespace|string(64)|是|DataSource范围内来源命名空间，如mock_demo/platform_export；不使用文件名|纳入自然键|同店DataSource.source_namespace|
|F.source_updated_at|timestamptz|是|来源更正时间，用于新旧比较|—|—|
|F.import_task_id|uuid|是|最近一次实际写入该行的导入任务|INDEX|ImportTask复合外键|
|F.row_hash|string(64)|是|规范化业务字段SHA256，排除上传时间|—|用于同更新时间冲突检测|

P0建立以下实体及必要认证表；后文P1/P2实体只写模型设计文档，不生成migration，不开放增删改API。各表字段大小上限必须在CSV校验、API校验和DB层一致，备注文本最多2000字符，正文脱敏文本最多10000字符，来源ID最多128字符。

## 10.2 身份与设置

### User（P0；全局身份，不继承B）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|id|uuid|是|领域用户ID|PK|Membership.user_id|
|auth_user_id|string|是|Better Auth user主键|UNIQUE|auth user.id|
|email|string(320)|是|规范化小写邮箱，框架同步|UNIQUE|—|
|display_name|string(80)|是|显示名|—|—|
|status|enum active/disabled|是|禁用同时终止session|INDEX|—|
|created_at|timestamptz|是|创建时间|—|—|
|updated_at|timestamptz|是|最后修改|—|—|

### Organization（P0；不继承B）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|id|uuid|是|租户ID|PK|全部租户数据|
|name|string(100)|是|组织名称|—|—|
|owner_user_id|uuid|是|唯一Owner，变更P1|INDEX|User.id；必须存在对应owner Membership|
|status|enum active/suspended|是|组织有效状态|INDEX|—|
|ai_daily_budget|numeric(20,6)|是|每日LLM金额预算CNY，默认3，允许0—20|—|AIRun计费聚合|
|ai_monthly_budget|numeric(20,6)|是|每月LLM预算CNY，默认100，允许0—500；独立硬限额，不要求大于日限额|—|AIRun计费聚合|
|budget_currency|char(3)|是|P0服务账单CNY，与店铺经营币种独立|—|—|
|budget_timezone|string(64)|是|P0 Asia/Shanghai，组织内店铺共用计费周期|—|—|
|ai_enabled|boolean|是|默认true；无可用模型配置仍不发起调用|—|组织AI设置|
|daily_message_limit|integer|是|默认2000，允许0—10000；按组织日预算周期|—|分类排队配额|
|demo_mode|boolean|是|初始化后不可改；演示组织与真实组织分离|—|Store继承|
|row_version|integer|是|默认1，组织设置/预算CAS更新+1|—|expected_version|
|created_at / updated_at|timestamptz|是|服务端时间，两独立字段|—|—|

### Membership（P0；继承B）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|user_id|uuid|是|组织成员|UNIQUE(org_id,user_id)|User.id|
|role|enum owner/admin/operator/customer_service|是|固定角色，组织内所有店铺同权限|单Owner部分唯一约束(org_id) WHERE role=owner|Organization.owner一致性事务校验|
|status|enum active/disabled|是|禁用即时失权|INDEX(org_id,status)|—|

### Invitation（P0；继承B）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|email|string(320)|是|受邀邮箱|INDEX(org_id,email)|—|
|role|Membership.role|是|Admin仅能邀请operator/customer_service|—|—|
|token_hash|string(64)|是|只存随机令牌哈希|UNIQUE|—|
|expires_at|timestamptz|是|创建起48小时|INDEX|—|
|status|enum pending/accepted/revoked/expired|是|单次领取|INDEX|—|
|invited_by|uuid|是|发起成员|—|User/Membership|
|accepted_by|uuid|否|实际领取者|—|User|

### Store（P0；继承B）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|name|string(100)|是|显示名称|—|—|
|external_store_id|string(128)|是|文件逐行店铺校验码|UNIQUE(org_id,external_store_id)|CSV store_external_id|
|status|enum active/archived|是|归档后不可新导入，历史可读|INDEX(org_id,status)|—|
|demo_mode|boolean|是|从Organization继承且不可自行切换|—|演示标识|
|platform|string(32)|是|manual/mock/shopify等标识；P0不表示已连接API|—|—|
|currency|char(3)|是|唯一记账币种，有事实后P0不可改|—|—|
|timezone|string(64)|是|IANA，有事实后P0不可改|—|—|
|dataset_version|bigint|是|初始0，每次接受导入或有效VOC标签批次/人工修正事务+1|—|全部版本化快照|
|current_snapshot_version|bigint|否|最近一致发布的数据版本；无发布为null|—|DailyMetric/Alert/VOCInsight|
|ruleset_version|string(80)|是|当前生效规则集不变标识；配置变化换新值|—|RuleConfig|
|current_snapshot_ruleset_version|string(80)|否|最近已发布快照规则集版本|—|与current_snapshot_version构成读身份|
|snapshot_status|enum ready/updating/failed|是|事实提交后updating，成功发布ready，终止失败failed|INDEX|ImportTask/worker|
|settings|jsonb|是|有限已校验设置：必需源、阈值金额；日报固定08:00；不是任意脚本|—|RuleConfig|

### DataSource（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|source_namespace|string(64)|是|稳定来源身份，迁移连接方式仍保持身份|UNIQUE(org_id,store_id,source_namespace)|所有F实体|
|name|string(100)|是|来源显示名|—|—|
|adapter_kind|enum csv/mock|是|P1才增加平台adapter|—|—|
|status|enum active/disabled|是|禁用不删除历史|INDEX|—|
|configuration|jsonb|是|白名单非密钥设置、mapping版本；不得存API明文密钥。P0一个DataSource支持六类文件，不为每类另造namespace|—|ImportTask|

### RuleConfig（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|rule_id|string(16)|是|R01…R12|UNIQUE(org_id,store_id,rule_id,rule_version)|Alert.rule_id|
|rule_version|integer|是|该规则配置不可变版本|同上|Alert.rule_version|
|ruleset_version|string(80)|是|组合规则集版本|INDEX(org_id,store_id,ruleset_version)|Store|
|enabled|boolean|是|P1规则P0强制false|—|—|
|parameters|jsonb|是|带类型、单位和边界的阈值配置|—|规则schema校验|

## 10.3 商品、交易与广告事实

### Product（P0；继承B+T+F）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|external_product_id|string(128)|是|来源产品稳定ID|UNIQUE(org_id,store_id,source_namespace,external_product_id)|SKU.product_id|
|name|string(300)|是|产品名，改名不改身份|—|—|
|category|string(100)|否|类目|INDEX(org_id,store_id,category)|—|
|status|enum active/archived|是|停售仍保留交易引用|—|—|

### SKU（P0；继承B+T+F）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|product_id|uuid|是|产品归属|INDEX(org_id,store_id,product_id)|Product同租户店铺|
|external_sku_id|string(128)|是|来源SKU稳定ID|UNIQUE(org_id,store_id,source_namespace,external_sku_id)|订单行/别名|
|sku_code|string(128)|是|店内稳定业务编码，不随名称改变|UNIQUE(org_id,store_id,sku_code)|对人显示|
|name|string(300)|是|SKU名称|—|—|
|specification|string(500)|否|规格文本，非身份依据|—|—|
|status|enum active/archived|是|在售/归档|INDEX(org_id,store_id,status)|—|

### SkuAlias（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|source_namespace|string(64)|是|别名所在来源|UNIQUE(org_id,store_id,source_namespace,external_sku_id)|DataSource|
|external_sku_id|string(128)|是|来源别名ID，不是模糊名称|同上|—|
|sku_id|uuid|是|人工明确匹配的现有SKU|INDEX|SKU同租户店铺|
|created_by|uuid|是|创建映射的人；自动初始化用明确系统操作者|—|User|

直接ID优先；别名不得与直接SKU身份指向不同实体，冲突拒绝。产品和SKU名字相似不自动合并。别名更正只影响未来导入，已导入事实须显式更正重导；写审计。

### Order（P0；继承B+T+F）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|external_order_id|string(128)|是|来源订单号|UNIQUE(org_id,store_id,source_namespace,external_order_id)|OrderItem|
|payment_status|enum unpaid/paid/cancelled|是|paid含付款后退款；不能用refunded抹除付款历史|INDEX|—|
|paid_at|timestamptz|条件|paid必填，其他必须空|INDEX(org_id,store_id,paid_at)|队列归属|
|ordered_at|timestamptz|是|下单时间≤paid_at|—|—|
|currency|char(3)|是|等于Store.currency|—|—|
|expected_item_count|integer|是|该订单应有不同external_order_item_id数，≥1|—|用于验证订单行是否齐全|

### OrderItem（P0；继承B+T+F）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|order_id|uuid|是|所属订单|INDEX(org_id,store_id,order_id)|Order同来源/店铺|
|external_order_item_id|string(128)|是|订单内稳定行ID|UNIQUE(org_id,store_id,source_namespace,order_id,external_order_item_id)|售后/退款行引用|
|sku_id|uuid|是|已存在SKU|INDEX(org_id,store_id,sku_id)|SKU同店，允许通过SkuAlias匹配|
|quantity|integer|是|正整数销量，1..100000000|—|—|
|item_paid_amount|numeric(20,6)|是|整行商品实付，≥0，非单价；不含运费税|—|GMV唯一金额源|
|currency|char(3)|是|等于Order与Store|—|—|

### AfterSaleRecord（P0；继承B+T+F；仅case）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|external_record_id|string(128)|是|售后case稳定事件ID|UNIQUE(org_id,store_id,source_namespace,external_record_id)|来源售后事件|
|order_id|uuid|是|由行引用解析|INDEX|Order|
|order_item_id|uuid|是|本事件关联的订单行|INDEX(org_id,store_id,order_item_id)|OrderItem；必须属于order_id|
|occurred_at|timestamptz|是|售后申请发生时间，更新状态不改发生时间|INDEX(org_id,store_id,occurred_at)|售后D7|
|status|enum requested/processing/closed/rejected|是|业务处理状态|—|—|
|reason_code|string(64)|是|来源/人工标准原因，unknown允许|INDEX(org_id,store_id,reason_code)|售后聚合|
|reason_text|string(2000)|否|脱敏原因补充|—|证据白名单文本|

### RefundEvent（P0；继承B+T+F；仅refund）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|external_record_id|string(128)|是|独立退款到账事件ID；同ID更新替换不是再退一次|UNIQUE(org_id,store_id,source_namespace,external_record_id)|来源退款事件|
|order_id|uuid|是|由行解析|INDEX|Order|
|order_item_id|uuid|是|退款所属行；整单退款须平台/用户按行分摊后导入|INDEX(org_id,store_id,order_item_id,completed_at)|OrderItem|
|after_sale_record_id|uuid|否|可关联已存case，不强迫每笔退款有case|INDEX|AfterSaleRecord同订单行|
|occurred_at|timestamptz|是|退款申请/事件创建时间|—|—|
|status|enum pending/succeeded/failed|是|只有succeeded计退款|INDEX|—|
|completed_at|timestamptz|条件|succeeded必填；其他必须空|INDEX(org_id,store_id,completed_at)|退款事件日|
|refund_amount|numeric(20,6)|条件|成功必填且>0，其他空；此独立事件到账商品金额，不是累计金额|—|Σ同订单行成功金额≤item_paid_amount|
|refunded_quantity_cumulative|integer|条件|成功必填，0..销售quantity，该成功时刻该行累计退款退件数|—|窗内max去重计件|
|currency|char(3)|是|与订单币种一致|—|—|
|reason_code|string(64)|是|退款原因unknown允许|INDEX|—|
|reason_text|string(2000)|否|脱敏原因|—|—|

同一售后有多个退款到账时，每笔退款事件各有独立ID与金额，累计退件数可相同。若来源给累计退款金额，Adapter先根据完整事件历史转换为事件金额，无法安全转换则拒绝，不直接相加。P0无退款撤销负事件；来源更正用同事件ID较新时间替换并重验全部关联成功事件。

### AdMetric（P0；继承B+T+F）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|campaign_id|string(128)|是|来源广告活动ID|复合自然键K1|—|
|campaign_name|string(300)|是|显示名|—|—|
|report_date|date|是|平台按店铺配置时区生成报告日|INDEX(org_id,store_id,report_date)|—|
|attribution_model|string(64)|是|如last_click，保留平台定义|K1|—|
|attribution_window_days|integer|是|统一日数0..90|K1|归因完成等待|
|spend|numeric(20,6)|是|≥0实际花费|—|—|
|attributed_sales|numeric(20,6)|是|≥0该归因模型销售额|—|—|
|currency|char(3)|是|等于店铺币种|K1|—|

K1=UNIQUE(org_id,store_id,source_namespace,campaign_id,report_date,attribution_model,attribution_window_days,currency)。同campaign同日不同模型是不同归因组，禁止累计销售/花费；店铺默认广告卡必须选择一个明确可兼容的归因组，多个组返回分组及不可汇总提示，不选最大值。P0无SKU广告归因字段。

## 10.4 客服、指标与AI快照

### CustomerMessage（P0；继承B+T+F）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|external_message_id|string(128)|是|来源消息稳定ID|UNIQUE(org_id,store_id,source_namespace,external_message_id)|VOC证据|
|external_conversation_id|string(128)|是|会话ID，不能拿它当消息ID去重|INDEX(org_id,store_id,external_conversation_id)|—|
|sku_id|uuid|否|已确认SKU，可无关商品；非空必须能解析|INDEX|SKU|
|message_at|timestamptz|是|客户消息发生时间|INDEX(org_id,store_id,message_at)|—|
|channel|string(32)|是|平台客服/邮件等标准渠道|INDEX|—|
|redacted_text|string(10000)|是|入业务库前脱敏的客户正文|—|不存姓名/地址/电话字段|
|language|string(16)|是|BCP47，如zh-CN/en，unknown允许|—|—|
|is_complaint|boolean（可空）|否|来源或人工导入时明确的投诉标记；缺失null，不是false，非模型情感判断|—|投诉率|
|classification_status|enum pending/succeeded/failed|是|未分类也保留消息|INDEX(org_id,store_id,classification_status)|AIRun|
|primary_topic|string(64)|否|成功分类/人工标签主主题|INDEX(org_id,store_id,primary_topic)|VOCInsight|
|secondary_topics|jsonb array<string>|是|默认空；最大2项，与vocBatch schema一致|—|—|
|sentiment|enum positive/neutral/negative/unknown|是|默认unknown|INDEX|VOC计数|
|classification_version|string(128)|否|模型+prompt+标签集版本|—|AIRun|
|classification_source|enum ai/manual/null|否|人工标签优先，批量模型不覆盖manual|—|AuditLog|
|ai_classification|jsonb|否|最近验证通过的vocClassificationResult及source_revision/taxonomy/model/prompt元数据，保留原模型标签与evidence_spans|—|PART9 vocBatch单项|
|manual_classification|jsonb|否|用户确认的primary_topic/secondary_topics/sentiment/note/source_revision/user_id/updated_at；聚合优先此值|—|User与AuditLog|

### DailyMetric（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|metric_id|string(128)|是|PART6固定/受控派生指标ID|K2|—|
|entity_key|string(256)|是|store、sku:{uuid}或campaign:{sha256(来源+campaign_id+归因模型+窗口+币种)}，不拼接超长原始ID|K2|相关SKU/广告；类型服务端校验|
|period_start / period_end|date|是|两独立字段，[start,end)|K2|—|
|value_numeric|numeric(24,6)|否|聚合金额/比率/数量统一持久化，序列化遵循指标类型|—|MetricValue.value|
|numerator / denominator|numeric(24,6)|否|两独立字段；非比率可空|—|MetricValue|
|sample_size|bigint|是|非负，样本口径按指标|—|—|
|status|enum available/unavailable|是|指标有无可用值|—|—|
|coverage_status|enum complete/partial/missing|是|完整度，与status独立|—|DataCoverage|
|maturity|enum mature/provisional/not_applicable|是|观察窗成熟度|—|—|
|unavailable_reason|string(64)|否|缺源/零分母/成本缺失等，available时空|—|—|
|currency|char(3)|否|金额填币种，其他空|—|—|
|dataset_version|bigint|是|计算接受的数据版本|K2|Store|
|ruleset_version|string(80)|是|发布规则集身份|K2|Store|
|metric_version|string(32)|是|v1|K2|—|

K2=UNIQUE(org_id,store_id,metric_id,entity_key,period_start,period_end,dataset_version,ruleset_version,metric_version)。未发布快照写入也必须标识版本；对外查询只能匹配Store发布指针，不靠MAX(created_at)取最新。

### VOCInsight（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|topic|string(64)|是|受控主题编码|K3|CustomerMessage.primary_topic|
|period_start / period_end|date|是|统计期间两字段|K3|—|
|message_count|bigint|是|主题主标签消息数，确定性计数|—|—|
|negative_count|bigint|是|该主题负面消息数≤message_count|—|—|
|classified_count / total_message_count|bigint|是|两独立字段，整个查询期间分类覆盖分子分母|—|—|
|sample_message_ids|jsonb array<uuid>|是|最多5条授权脱敏样本引用|—|CustomerMessage同店|
|dataset_version|bigint|是|快照版本|K3|Store|
|ruleset_version|string(80)|是|发布规则集身份|K3|Store|
|classification_version|string(128)|是|明确标签集与模型版本|K3|—|

K3=UNIQUE(org_id,store_id,topic,period_start,period_end,dataset_version,ruleset_version,classification_version)。历史样本原文证据需在AIReport/AIRun证据包留脱敏快照，防止可变消息让旧报告内容漂移。

### Alert（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|rule_id / rule_version|string(16) / integer|是|两字段规则身份|K4|RuleConfig|
|ruleset_version|string(80)|是|整套发布规则|INDEX|Store|
|entity_key|string(256)|是|与DailyMetric相同编码|K4|相关实体服务端验证|
|period_start / period_end|date|是|两字段，异常分析期|K4|—|
|severity|enum info/warning/critical|是|规则确定|INDEX(org_id,store_id,severity)|—|
|title|string(160)|是|确定性规则标题|—|—|
|category|enum data_quality/sku/advertising/customer_service/after_sales|是|规则固定映射，供首页分组与客服授权白名单|INDEX(org_id,store_id,category)|RuleConfig|
|status|enum open/acknowledged/resolved/ignored|是|默认open，用户记录处理状态，不修改事实证据|INDEX(org_id,store_id,status)|告警PATCH|
|handling_note|string(500)|否|脱敏处理备注，非任务评论系统|—|AuditLog记操作者|
|evidence|jsonb|是|指标ID、值、基准、阈值、覆盖、样本、来源不可变包|—|DailyMetric同快照|
|dataset_version|bigint|是|事实版本|K4|Store|
|metric_version|string(32)|是|v1|—|—|

K4=UNIQUE(org_id,store_id,rule_id,entity_key,period_start,period_end,rule_version,dataset_version)。ruleset发布变更未改变某条rule时可复用同版本告警并建立该规则集读取关联，最小实现对整套规则配置发布统一递增各启用规则rule_version，避免唯一键与当前快照冲突。不额外增加告警任务工作台；Alert.status只记录该版本告警的处理标记，AI建议的本人动作状态另存下表。新日期/新版本告警重新检测，不把旧状态解释为事实已经恢复。

### AIInsight（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|ai_run_id|uuid|是|生成运行|INDEX|AIRun|
|period_start / period_end|date|是|两字段分析区间|INDEX|—|
|dataset_version|bigint|是|证据快照版本|INDEX(org_id,store_id,dataset_version)|Store|
|ruleset_version|string(80)|是|证据规则集|—|Store|
|visibility_scope|enum business/customer_service|是|生成前确定授权范围|INDEX|服务端投影不可靠前端隐藏|
|generation_status|enum succeeded/failed/skipped|是|生成结果状态，排队状态在AIRun|—|—|
|status|enum active/archived|是|记录展示生命周期，与行动状态不同|—|—|
|schema_version|string(32)|是|PART9 schema版本|—|—|
|metric_version|string(32)|是|默认v1，证据口径版本|—|DailyMetric|
|payload|jsonb（可空）|否|严格通过PART9 Ajv的结构化模型内容；失败空|—|related_skus/metrics引用复验|
|evidence / confidence|jsonb|是|两字段，服务端证据与完整度，不是模型概率|—|不可变证据包|
|error|jsonb（可空）|否|失败/跳过代码、可重试标志和安全文案|—|—|
|generated_at|timestamptz（可空）|否|仅成功模型结果有值|—|—|

stale读取时比较(dataset_version,ruleset_version)与当前发布/生效身份计算，不持久化容易过期的布尔真源。action_states由当前用户ActionState记录组装，不允许放进共享payload保存个人状态。

### ActionState（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|ai_insight_id|uuid|是|动作所属建议|UNIQUE(org_id,ai_insight_id,action_id,user_id)|AIInsight|
|action_id|string(64)|是|PART9动作稳定ID，必须存在payload|同上|AIInsight.payload.recommended_actions|
|user_id|uuid|是|当前操作者，服务端推导|同上|User+active Membership|
|status|enum pending/accepted/done/dismissed|是|个人处理状态|INDEX(org_id,user_id,status)|—|
|version|integer|是|首次写1，更新CAS+1；无记录读为0|—|API并发冲突409|

无记录返回pending/version0/updated_at=null。无assigned_user_id、跨成员任务分派、截止日期或任务评论。每次状态更改写AuditLog。

### AIReport（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|ai_run_id|uuid|是|日报生成运行|INDEX|AIRun|
|period_start / period_end|date|是|两字段日报区间|INDEX(org_id,store_id,period_start)|—|
|dataset_version / ruleset_version|bigint / string(80)|是|两字段快照身份|INDEX|Store|
|visibility_scope|enum business/customer_service|是|P0经营日报只business|INDEX|—|
|generation_status|enum succeeded/failed/skipped|是|真实模型结果状态|—|—|
|summary_source|enum ai/rules/null|否|规则降级也保留generation_status失败|—|—|
|metric_version|string(32)|是|默认v1，冻结证据口径|—|DailyMetric|
|summary_payload|jsonb（可空）|否|通过PART9 dailyConclusion schema的结构|—|—|
|evidence / confidence|jsonb|是|两字段服务端不可变证据与完整度|—|—|
|insight_ids|jsonb array<uuid>|是|同版同权限建议引用，可空|—|AIInsight|
|error|jsonb（可空）|否|安全错误详情|—|—|
|generated_at|timestamptz（可空）|否|仅模型成功时填|—|—|

### AIRun（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|kind|enum voc_classification/insight/daily_report|是|三生成入口|INDEX|—|
|idempotency_key|string(64)|是|org/store/期间/权限/快照/规则/model/prompt/kind/attempt哈希|UNIQUE|防任务重投重复生成|
|attempt_revision|integer|是|初次1，显式失败重试递增|—|—|
|dataset_version / ruleset_version|bigint / string(80)|是|两字段输入身份|INDEX|Store|
|visibility_scope|enum business/customer_service|是|证据授权范围|—|—|
|status|enum queued/running/succeeded/failed/skipped/superseded|是|执行状态|INDEX(org_id,status)|队列|
|model_id / prompt_version / schema_version|string(128)|是|三个独立字段，固定部署model快照记录|—|—|
|input_hash|string(64)|是|脱敏规范化输入哈希|—|分类缓存|
|input_tokens / output_tokens|bigint|否|两字段provider实际usage，未知null|—|成本计费|
|reserved_cost / actual_cost|numeric(20,6)|是/否|预算预占非负；真实费用未知保持null|—|Organization预算|
|billing_currency|char(3)|是|CNY|—|—|
|billing_status|enum reserved/settled/unknown/released|是|超时不能认定零花费；unknown保留预占待核对|INDEX|—|
|attempts|jsonb array|是|每次外呼分别存attempt_no/provider_request_id/start/end/input_tokens/output_tokens/reserved_cost/actual_cost/billing_status/error_code；未知usage为null，不存prompt正文|—|最多3次自动尝试，显式失败重试建立新attempt_revision|
|request_context|jsonb|是|period_start/end、生成scope；VOC还含本批message_id与source_revision、taxonomy_version；定义完整幂等输入|—|JobRun|
|error_code|string(64)|否|脱敏错误分类|—|—|
|started_at / finished_at|timestamptz|否|两个时间字段|—|—|

## 10.5 导入、覆盖与执行记录

### ImportTask（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|data_source_id|uuid|是|同店来源|INDEX|DataSource|
|source_kind|enum products/orders/order_items/ads/customer_messages/after_sales|是|六类文件|INDEX|—|
|status|enum uploaded/validating/preview_ready/committing/committed/failed/expired|是|committed仅表示事实成功，不代表AI已生成|INDEX(org_id,store_id,status)|—|
|original_filename|string(255)|是|仅显示，不作对象路径|—|—|
|raw_object_key|string(512)|是|私有原始CSV对象键|—|StorageAdapter|
|file_sha256|string(64)|是|原始字节哈希|—|导入幂等键组成|
|mapping|jsonb|是|初始空对象；验证后含字段映射及mapping_version|—|Adapter|
|coverage_declaration|jsonb|是|初始空数组；验证后按channel列from/to/status和explicit_zero_dates|—|DataCoverage|
|upload_request_key|string(64)|是|上传HTTP幂等键，按org/user/请求路径隔离，不依赖尚未填写的映射|UNIQUE(org_id,created_by,upload_request_key)|上传重放|
|idempotency_key|string(64)|条件|映射校验完成后必填：文件hash+来源/店铺+映射+范围+声明+adapter版本的哈希；uploaded阶段为null|UNIQUE(org_id,store_id,idempotency_key)|已成功任务直接复用|
|preview_version|integer|是|初始0，每次映射/校验变化+1，确认只接受当前预览|—|commit API|
|base_dataset_version|bigint|是|预览依据版本，提交变化重新验引用|—|Store|
|committed_dataset_version|bigint|否|实际成功版本，无业务变化且声明无变化不递增并复用现版|INDEX|Store|
|row_count / valid_count / error_count|integer|是|三个独立字段|—|校验结果|
|insert_count / update_count / unchanged_count|integer|是|三个预览影响计数，初始0；与staging manifest一致|—|预览与提交结果|
|staging_object_key|string(512)|否|规范化staging及预览manifest私有对象|—|StorageAdapter|
|error_object_key|string(512)|否|逐行错误CSV/JSON，敏感内容脱敏|—|StorageAdapter|
|outbox_status|enum none/pending/dispatched|是|业务提交事务写pending，dispatcher持久发队列后dispatched|INDEX(outbox_status,updated_at)|pg-boss|
|created_by|uuid|是|导入者，提交前再校验权限|—|User+Membership|
|confirmed_at / committed_at|timestamptz|否|两个独立字段，确认与落库|—|—|
|error_code|string(64)|否|任务级失败码|—|—|

不另建巨大raw逐行表。ImportTask.staging_object_key指向校验后的规范化行与manifest，manifest包含原文件行号、自然键、原始hash、规范化hash、受影响日期和验收摘要。临时对象私有、24小时自动过期；已提交原始CSV与错误文件按设置保留，演示数据与真实数据对象前缀隔离。提交失败不删除原始文件，便于更正定位。

### DataCoverage（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|data_source_id|uuid|是|覆盖对应具体来源|K5|DataSource|
|source_kind|ImportTask.source_kind|是|六类|K5|—|
|channel|enum default/case/refund|是|after_sales必须case/refund分别声明，其他default|K5|—|
|coverage_date|date|是|店铺本地自然日|K5|—|
|status|enum complete/partial/missing|是|用户确认后的来源完整度，不是推断零事件|—|—|
|explicit_zero|boolean|是|只有用户确认该日该channel没有事件且库无冲突事实才能true|—|—|
|record_count|bigint|是|当前该来源日已接收行数；0不能自动升级complete|—|—|
|dataset_version|bigint|是|该声明生效的数据版本，历史保留|K5|Store|
|import_task_id|uuid|是|承载声明的导入任务，零日也需确认任务|INDEX|ImportTask|

K5=UNIQUE(org_id,store_id,data_source_id,source_kind,channel,coverage_date,dataset_version)。当前声明取≤目标版本的最新声明，但计算结果将覆盖摘要冻结进快照。products覆盖记录目录导入确认，已存在有效目录无需每日重导或重复确认；order_items按其订单paid_at（未付款按ordered_at）归日。refund以completed_at成功日覆盖，case以occurred_at；退款D7要窗口内全部日refund覆盖，只有case完整不能推出refund完整。多来源同时计业务必须明确权威来源/无重叠；P0一个店铺每source_kind/channel设置一个有效经营来源，其他来源先做身份迁移，禁止两份相同平台导出双加。

### JobRun（P0；继承B+T）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|job_kind|enum recompute_snapshot/classify_voc/generate_ai|是|少量工作流|INDEX|pg-boss|
|idempotency_key|string(64)|是|org/store/version/ruleset/kind及完整context哈希：日报含期间/scope/model/prompt/schema，VOC含有序消息修订集合；不得仅按store/version去重|UNIQUE|防至少一次重复副作用|
|context|jsonb|是|任务种类要求的period/scope/source_ids/ai_run_id/model/prompt/schema等，Schema验证后固化，不能由模型写入|—|同租户关联验证|
|actor_type|enum user/system|是|系统日报无浏览器session，仍有固定org/store业务范围|—|审计|
|requested_by|uuid|否|人工任务发起者；system为null|—|User/Membership|
|dataset_version / ruleset_version|bigint / string(80)|是|两个输入身份字段|INDEX|Store|
|status|enum pending/running/succeeded/failed/superseded|是|实际执行状态|INDEX(status,updated_at)|—|
|attempt_count|integer|是|已尝试次数|—|—|
|outbox_status|enum pending/dispatched|是|非导入触发如人工VOC/规则配置重算的事务发件箱|INDEX|dispatcher|
|error_code|string(64)|否|最终安全错误码|—|—|
|started_at / finished_at|timestamptz|否|两个独立时间字段|—|—|

### AuditLog（P0；继承B；store_id可空）

|字段|类型|必填|说明|索引|关系|
|---|---|---|---|---|---|
|store_id|uuid|否|组织成员操作无店铺|INDEX(org_id,store_id,created_at)|Store同org|
|actor_user_id|uuid|否|后台系统为null且actor_type=system|INDEX|User|
|actor_type|enum user/system|是|操作者类型|—|—|
|action|string(64)|是|import_commit/label_override/action_state_change/invite等|INDEX|—|
|entity_type / entity_id|string(64) / uuid|是|两个目标字段|INDEX(org_id,entity_type,entity_id)|不做跨租户任意实体查询|
|before_summary / after_summary|jsonb|否|两字段脱敏变化摘要，不存客户原文/密钥|—|—|
|request_id|string(64)|是|与Pino请求链路关联|INDEX|—|

认证完整性：Better Auth Prisma adapter生成并保留user、session、account、verification等框架必需表，含其原生索引、session token及过期、account凭据机制；不假定框架默认把session token哈希存储；不把领域User替代auth表，不自行实现密码哈希。Organization/Membership归业务服务，框架Auth User为跨组织身份例外，无org_id；所有业务查询从Membership导出org范围。

## 10.6 P1/P2仅设计实体，不建表

以下同样给字段和关系，避免下一阶段拿P0近似字段冒充真实来源；均继承B+T，P0 migration、CSV菜单和写API不包含它们。

|实体|字段（类型；必填；说明）|索引|关系|
|---|---|---|---|
|Competitor（P2）|name(string100；是；竞品名)、platform(string32；是；平台)、url(string1000；是；公开商品页)、related_sku_id(uuid；否；本店对照SKU)、last_observed_at(timestamptz；否；最后人工/授权抓取)、observed_price(numeric20,6；否；原币商品标价)、currency(char3；是；原币，不自动换算)、observation_source(string64；是；来源)|UNIQUE(org_id,store_id,url)，INDEX related_sku_id|related_sku_id→SKU；P2才扩历史快照|
|CostEntry|order_item_id(uuid；是；成本归属行)、cost_kind(enum product/platform/fulfillment/advertising；是；四类成本)、amount(numeric20,6；是；成本≥0)、currency(char3；是；店铺币种)、allocated_at(timestamptz；是；归属时刻)、external_cost_id(string128；是；稳定凭证ID)、source_namespace(string64；是；来源)、source_updated_at(timestamptz；是；更正时间)、completeness(enum complete/partial；是；此类成本是否结清)|UNIQUE(org_id,store_id,source_namespace,external_cost_id)，INDEX order_item_id+cost_kind|OrderItem；成本必须明确对齐付款队列，广告分配成本不能再重复加AdMetric|
|TrafficMetric|report_date(date；是；访问日)、source_namespace(string64；是；来源)、eligible_session_count(bigint；是；过滤机器人后session数)、converted_session_count(bigint；是；这些session中下单数≤访问数)、definition_version(string32；是；归因定义)、source_updated_at(timestamptz；是；更正时间)|UNIQUE(org_id,store_id,source_namespace,report_date,definition_version)|DataSource；转化率无法从订单CSV补造|
|Review|external_review_id(string128；是；评价稳定ID)、source_namespace(string64；是；来源)、sku_id(uuid；是；SKU)、reviewed_at(timestamptz；是；评价发生)、rating(integer；是；1..5)、redacted_text(string10000；否；脱敏评价)、status(enum published/removed；是；有效性)、source_updated_at(timestamptz；是；更正时间)|UNIQUE(org_id,store_id,source_namespace,external_review_id)，INDEX sku_id+reviewed_at|SKU；删除评价不进入有效评价分母|
|InventorySnapshot|sku_id(uuid；是；SKU)、warehouse_code(string64；是；仓库)、as_of(timestamptz；是；快照时刻)、available_quantity(bigint；是；非负可售件数)、inventory_cost(numeric20,6；否；该快照库存成本)、currency(char3；是；店铺币种)、source_namespace(string64；是；来源)、source_updated_at(timestamptz；是；更正时间)|UNIQUE(org_id,store_id,source_namespace,sku_id,warehouse_code,as_of)|SKU；平均库存需连续每日完整快照，禁止仅两点冒充日均|

P1成本0必须明确提交“真实为零”凭证/覆盖，缺成本行不是零；利润计算所有必需成本类别齐全方可available。P0产品CSV不塞采购价、库存量、评价星级等尚未建立口径的数据。



## 10.7 字段投影与最小运行约束

HTTP的expected_version对应可变领域记录的row_version；只有个人ActionState使用专用version。每次CAS更新与AuditLog一起提交；不可变指标/AI快照不开放PATCH。HTTP角色名Owner/Admin/Operator/CustomerService与存储枚举owner/admin/operator/customer_service是一一映射，不接受任意角色字符串。

Organization.ai_daily_budget/ai_monthly_budget在设置API中投影为daily_budget_cny/monthly_budget_cny；每日3元、每月100元是同一组默认，后者可比日限额更小，两者任一耗尽就暂停。并发预占通过锁Organization行、核算对应Asia/Shanghai计费周期内AIRun已结算与未决attempt费用完成；预占输入费用加允许最大输出费用。unknown保留上限费用直到核对，不能重试时释放。AIRun汇总值与attempt明细在同一事务调整，不做两套账。

Store.settings只允许required_channels（orders/default、order_items/default及可选ads/default、customer_messages/default、after_sales/case、after_sales/refund）和authoritative_source_ids（上述channel到同店DataSource.id的映射）；商品目录存在性另验，不要求每天重新导入。DataSource.configuration只存mapping_version和规范化白名单配置，supported_entities在P0固定为六类标准文件，由API按角色裁剪。每个channel首次成功确认的来源原子设为权威来源；P0其他来源写同一channel会返回SOURCE_MIGRATION_REQUIRED，正式来源迁移留待单独TASK，不能靠新namespace双算。required_channels由O/A通过Store PATCH配置；已存在订单数据时orders/default与order_items/default不可关掉。

AI输出label/secondary_labels明确映射CustomerMessage.primary_topic/secondary_topics；人工分类API直接使用后两个字段名并复用同一voc-v1枚举。review_status不新增平行状态字段，由manual_classification存在且revision有效投影为reviewed，否则unreviewed。

CustomerMessage.source_revision是F.row_hash的只读投影；源文本/字段变化即产生新revision。ai_classification保留最近模型原结果，manual_classification保留人工最终结果；只有source_revision匹配才可作为当前标签。原文更正导致旧人工标签失配时标需要复核，不把旧人工意见静默套到新文本；旧修正保留审计。有效primary_topic/secondary_topics/sentiment是上述优先级选择的结果；不依赖模型计算计数。

Authentication表由锁定版本的Better Auth生成，不复制猜测的第三方表字段。领域User与Auth用户同步由事务服务维护；其email不一致时拒绝邀请接受并提示重新登录核对，避免产生双重身份。任务context关联、JSON中的SKU/消息/建议ID同样逐项验证租户与店铺，JSONB不是越权通道。


# PART 11｜数据流设计

## 11.1 上传至Dashboard的最小流水线

1. 服务端确认session、Membership和店铺归属，允许角色只选择其可导入类型。用户选店铺、DataSource、六类之一、字段映射及覆盖声明；店铺身份不得从文件自动创建。每行store_external_id必须与所选店铺匹配。
2. 上传至私有StorageAdapter，校验扩展名/MIME/20MB和100000行限制，建立ImportTask=uploaded并计算文件SHA256。原始文件不可被Web静态目录访问，预览和错误下载都重新授权。
3. CsvAdapter用流式解析生成CanonicalBatch，先处理UTF-8/BOM、CSV引号/换行，再做字段映射、Decimal和时间规范化、客户文本脱敏。清洗不改身份、不猜币种、不把空金额变零，不直接写业务表。
4. 进行全文件结构、逐行类型、重复自然键、跨行一致性、来源新旧时间、外键同租户同店及覆盖校验，生成私有staging manifest。产品同ID元信息冲突、订单行缺引用、重复退款超额、SKU累计退件越界均列明确行号错误。错误行存在时任务failed，不提供“跳过错误继续”。
5. 无错误进入preview_ready，显示新增/更新/无变化/旧版本不覆盖/重复折叠条数、影响日期、币种、覆盖及预计受影响旧付款队列；用户确认具体预览。预览24小时有效，过期重新校验。CSV字段映射预览不是业务成功。
6. 提交时再次验证角色、staging完整性及base_dataset_version；其他导入改变引用或相同自然键后，重验再提交，有内容冲突返回409。按店铺加事务锁，整文件所有Product/SKU/Order等upsert、DataCoverage声明、ImportTask状态/committed_dataset_version与outbox_status=pending、Store.dataset_version+1在一个数据库事务中提交。任一失败全部回滚，不产生半份业务数据/半份coverage/新版本。完全相同数据和声明为no-op，返回既有版本，不为重复上传制造新数据版本。
7. dispatcher扫描持久化outbox并幂等发送pg-boss任务，成功才标dispatched；进程在任意位置重启可重发，由业务唯一键处理重复。不能只在HTTP响应后内存调用worker，以免丢任务。
8. worker以Repeatable Read读取对应当前事实，计算确定性DailyMetric、规则结果与已有效分类的VOCInsight。初始未分类消息可先以分类覆盖不足发布基础指标。VOC批次经过Schema校验及人工优先规则后原子写标签；只有有效标签确实变化时，Store.dataset_version+1并写JobRun outbox，触发一次聚合重发。无变化/缓存命中不递增，避免分类与重算无限循环。人工修正同理。
9. 发布前锁Store行检查dataset_version和ruleset_version仍等于任务输入；不相等则标JobRun=superseded，禁止把旧结果发布成新快照，调度最新重算。相等时在同一发布事务将current_snapshot_version/current_snapshot_ruleset_version指向该套完整指标+规则+VOC快照，snapshot_status=ready。旧快照保留，失败不改发布指针。
10. AI仅读已发布且授权的证据。按store/period/visibility/snapshot/ruleset/model/prompt/schema做预算检查与幂等调用；日报/建议结果独立落AIReport/AIInsight，模型失败不回滚已发布指标。新快照或规则版本生效使旧AI读取时stale=true，历史内容不覆盖。
11. Dashboard、SKU、VOC、Alerts所有聚合接口同次读取使用同一发布身份。响应带dataset_version（已发布）、latest_dataset_version（最新已提交事实）、ruleset_version、snapshot_status。落后时展示更新中/失败提示，不能把旧数据标成最新；无任何已发布快照返回明确未准备好状态，不补零。SKU基础身份可来自当前SKU表，但销售/规则/排名必须来自同版聚合。

## 11.2 可替换来源的Adapter契约

P0不提供复杂插件市场，只在同一代码库保留DataAdapter接口：validateMetadata、parse、normalize、validateBatch、preview。统一CanonicalBatch包含source_kind、source_namespace、store_id（服务端赋值）、adapter_version、records、coverage_declaration、raw_checksum、row_errors；records是本规范六种判别联合类型，不是任意JSON。

CsvAdapter和MockAdapter都输出此对象，再走同一个ImportService事务、MetricService、RuleService和AI证据链。MockAdapter不得直接写Dashboard数字、告警或模型假结论；UI持续显示“演示数据”。Mock店铺与真实店铺不同source_namespace，最好使用独立演示Organization，禁止默认混入真实结果。

P1 Amazon/Shopify/Shopee/TikTok Shop/ERP/客服Connector只负责鉴权、分页、游标、限流、原始格式读取，之后通过Normalizer输出相同CanonicalBatch；watermark、撤销/删除语义与重试策略到P1单独定义。Connector同样必须证明日期覆盖，不能“拉到几条”就标complete。未来平台权限或来源不具备数据时返回unsupported_source/coverage缺失，不能改Dashboard公式迁就接口。平台增量导入还须补业务更新时间与幂等键，保留现有事实自然键。

## 11.3 版本、重算与日期完整性

事实最新状态允许upsert，但历史AI和DailyMetric/VOC/Alert必须不可变保存。Store.dataset_version对任何accepted业务事实变化递增，包括导入、有效分类批次与人工标签修正；纯个人行动状态/显示名变更不改变经营事实版本。规则配置有独立ruleset_version，不虚增事实版本，但须重算发布，AI缓存与stale比较包含它。事务更新失败没有新版本。

更正订单paid_at/订单行金额/数量会同时重算旧付款日期和新付款日期；后到退款会重算退款completed_at事件日及订单paid_at所属D7队列；消息正文更正清除其旧AI分类为pending（manual标签是否沿用须显式人工确认，P0默认清除并审计）并重算旧/新message_at日期。更正产品归属会影响产品聚合。P0数据量有限，允许按店铺完整重算现有覆盖期间，不能只重算上传当天而漏旧队列。

缺日期不插人工零。完全空文件缺少合法表头一律拒绝。仅表头文件属于“无记录文件”，未声明零事件时默认只显示empty_file，不递增版本或标complete；唯一例外是合法表头+零业务行+明确explicit_zero_dates，可进入coverage-only预览；用户逐项显式确认某些日期/渠道“完整且零事件”，再执行一个有审计的零事件覆盖事务，无需虚构0金额订单。若该日已有事实，声明零与事实冲突则拒绝。after_sales上传case行不能暗示refund也完整，必须分渠道声明；没有refund渠道数据也未确认零，就不生成可用退款率。products只需有效目录，不要求每日报到。


# PART 12｜CSV / Excel 数据规范

## 12.1 文件格式、公共元数据与更新协议

P0支持products.csv、orders.csv、order_items.csv、ads.csv、customer_messages.csv、after_sales.csv六类，Excel用户另存为“CSV UTF-8”。原生.xlsx为P1，不接受.xls/.xlsm。每文件≤20MB、≤100000数据行；首行列名、逗号分隔、双引号包围含逗号/换行/双引号的文本，双引号写为两个双引号；UTF-8可带BOM。数字用点号小数，不接受货币符号/千位逗号/科学计数。bool仅true/false；空单元格表示null，仅允许在可选列；ID当字符串保留前导零。时间用RFC3339且含时区偏移，如2026-09-01T10:00:00+08:00，不接受含糊的09/01/26。

下面“是”列必须存在且每行非空；“否”列可缺列或留空；“条件”按行类型/状态决定。未列列名需字段映射明确忽略，并在预览列出，不能隐式忽略混入的store_id/org_id。服务端不接受文件指定org_id、领域uuid、dataset_version或created_by。

POST上传先提供store_id、data_source_id、entity_type和文件，entity_type映射ImportTask.source_kind；随后PUT mapping提供field_mapping、timezone确认和coverage_declaration。服务端记录mapping_version（映射规范化hash）与固定adapter_version，最终预览必须齐备上述元数据后才允许提交。org_id和权限来自服务端，不能要求用户在最初上传时预先知道映射版本。coverage_declaration为数组，各项source_kind/channel/from/to/status/explicit_zero_dates，from/to是本地日期。status仅允许用户声明complete或partial；missing是没有声明的系统状态。after_sales需分别case/refund声明。时间范围外有效业务行报OUT_OF_COVERAGE；products无事件期，覆盖只记录目录确认日。订单行归订单paid_at，未付款归ordered_at，非订单行CSV文件更新时间不决定指标日期。

六类文件共同两列如下；它们是每个模板实际必备列，不是省略掉的建议字段。

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|必须等于选择Store.external_store_id；多店混入整文件STORE_MISMATCH|
|source_updated_at|RFC3339 timestamptz|是|2026-09-02T09:00:00+08:00|来源实际最后更新时间或本次人工导出的可信版本时间，不得服务端随意补现在；非法时间INVALID_TIMESTAMP|

同文件去重：自然键相同且规范化字段完全相同，预览明确折叠重复并记录行号；同键内容不同即DUPLICATE_KEY_CONFLICT，整文件失败，不采用最后一行胜出。跨文件自然键upsert：较新source_updated_at替换整行受控业务字段，较旧为已识别no-op并在预览报告；相同时间且同hash为no-op，相同时间而不同内容返回409 VERSION_CONFLICT。可选列缺失/空值在替换导入中会将旧可选值清空，预览必须突出显示，不当作patch。不存在删除语义，漏掉旧行不会删除旧事实或归零。更正必须包含每个待更正自然键。

幂等键为org/store/source/kind/file_sha256/mapping_version/adapter_version/coverage_declaration规范化哈希；重复已成功任务复用其结果，不重复金额，不触发重复AI。完全重复文件试图更改覆盖声明时须新预览，可能更新coverage并产生新版本，但业务行仍不增加。所有类型均先全文件校验再原子提交，错误清单包含row_number、field、error_code、安全说明和建议修正，不回显未脱敏消息/密钥。

## 12.2 products.csv

每行一个SKU，同时携带所属Product元信息。先导此文件建立Product/SKU；同external_product_id多行的product_name/category/product_status/source_updated_at须一致，否则PRODUCT_METADATA_CONFLICT。P0不支持在此模板顺便导成本/库存。

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|共同列规则|
|source_updated_at|timestamptz|是|2026-09-01T00:00:00+08:00|共同列规则，同时是Product/SKU版本|
|external_product_id|string128|是|P100|稳定产品ID，非产品名称|
|product_name|string300|是|便携保温杯|同产品跨行一致|
|category|string100|否|家居/杯具|空为未知类目|
|product_status|enum active/archived|是|active|非法枚举拒绝|
|external_sku_id|string128|是|S100-RED|来源稳定SKU ID|
|sku_code|string128|是|CUP-RED-500|店内唯一稳定业务码；冲突SKU_CODE_CONFLICT|
|sku_name|string300|是|500ml红色保温杯|允许改名，不改变身份|
|specification|string500|否|红色/500ml|空可；不用于模糊匹配|
|sku_status|enum active/archived|是|active|归档不删除历史|

自然键：SKU为(org,store,namespace,external_sku_id)，Product为(org,store,namespace,external_product_id)。同一文件两行用不同external_sku_id但相同sku_code且不指同SKU时拒绝。要承接不同来源ID，先明确建立SkuAlias；名称相同不会合并。

## 12.3 orders.csv

每行一个订单头；不得按SKU重复订单头制造订单数。用户源文件只有一张订单明细时，由用户或试点接入人员在上传前拆成头/行两个标准文件，P0界面不额外实现任意文件自动拆表；两份各生成独立预览，但仍按顺序分别原子导入，不能新增第七类格式。

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|共同规则|
|source_updated_at|timestamptz|是|2026-09-01T10:05:00+08:00|共同规则|
|external_order_id|string128|是|O1001|来源订单稳定ID|
|ordered_at|timestamptz|是|2026-09-01T09:55:00+08:00|不得晚于paid_at|
|payment_status|enum unpaid/paid/cancelled|是|paid|已付款后退款仍paid；不接受refunded替代付款历史|
|paid_at|timestamptz|条件|2026-09-01T10:00:00+08:00|paid必填，unpaid/cancelled必须空|
|currency|ISO4217 char3|是|CNY|必须等于店铺币种|
|expected_item_count|positive integer|是|2|不同订单行ID总数，≥1；不是商品件数|

自然键：(org,store,namespace,external_order_id)。无订单总金额列。已导头无行可保存头并显示订单数，但GMV/销量覆盖partial；等行齐后重算。更改已存paid订单为unpaid/cancelled须检查退款引用；有成功退款则拒绝INVALID_PAYMENT_TRANSITION，不能抹除已付款事实。增加/减少expected_item_count均与现存行数重验，多余行不自动删除。

## 12.4 order_items.csv

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|共同规则|
|source_updated_at|timestamptz|是|2026-09-01T10:05:00+08:00|共同规则|
|external_order_id|string128|是|O1001|须已存同店同namespace订单|
|external_order_item_id|string128|是|L01|订单内稳定行ID|
|external_sku_id|string128|是|S100-RED|须直接匹配SKU或明确SkuAlias；找不到SKU_NOT_FOUND|
|quantity|integer|是|2|1..100000000；不接受负数退件行|
|item_paid_amount|decimal(20,6)|是|100.000000|整行两件合计实付；≥0；不含运费税|
|currency|ISO4217 char3|是|CNY|与Order和Store相同|

自然键：(org,store,namespace,external_order_id,external_order_item_id)。同SKU在同一订单有两行允许，不得按SKU误去重。全文件提交后任一订单现存行数>expected_item_count则拒绝ITEM_COUNT_EXCEEDED；小于expected_item_count允许导入但强制对应日期partial和缺行提醒，不准确认该日订单行完整。金额/quantity更正后须满足已成功退款金额和累计件数上界，不能把销量改小导致退款越界。未来平台订单号跨店重复不影响身份。

## 12.5 ads.csv

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|共同规则|
|source_updated_at|timestamptz|是|2026-09-09T00:00:00+08:00|含归因晚更新时真实版本|
|report_date|YYYY-MM-DD date|是|2026-09-01|平台报告日，导入预览确认与Store时区相同|
|campaign_id|string128|是|AD001|campaign粒度，不填SKU ID代替|
|campaign_name|string300|是|保温杯搜索广告|更名不改campaign身份|
|attribution_model|string64|是|last_click|保留来源模型含义；不能自动统一不同平台语义|
|attribution_window_days|integer|是|7|0..90；归因模型无法用天表达则此版本不支持，不能猜7|
|spend|decimal(20,6)|是|40.000000|≥0，不能空|
|attributed_sales|decimal(20,6)|是|100.000000|≥0，不能空|
|currency|ISO4217 char3|是|CNY|店铺币种|

自然键见AdMetric K1。必须以相同campaign/report_date/归因组更新替换，晚到归因不能累加成新销售。归因组不同分列显示；选择范围跨组不可汇总时返回分组而非一个ROAS。report_date结束后attribution_window_days天未到，标provisional；即使用户声明complete，成熟度仍独立判断。

## 12.6 customer_messages.csv

仅客户消息，客服发送回复不作为此版分母。用户须在来源导出或映射筛选中明确角色；不能混入系统通知、机器人回执。如果无法区分，声明coverage partial并给出来源限制。

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|共同规则|
|source_updated_at|timestamptz|是|2026-09-01T11:01:00+08:00|共同规则|
|external_message_id|string128|是|M001|单条消息ID|
|external_conversation_id|string128|是|C001|会话ID，允许多条消息共享|
|message_at|timestamptz|是|2026-09-01T11:00:00+08:00|按发生日统计|
|channel|string32|是|platform_chat|标准渠道，空拒绝|
|message_text|string10000|是|杯盖漏水，想申请退款|必须非空；入库先脱敏为redacted_text；脱敏后无有效内容则错误提示，不静默丢行|
|language|string16|是|zh-CN|BCP47或unknown，不靠乱码猜语言|
|external_sku_id|string128|否|S100-RED|空表示未关联；非空无法匹配则拒绝|
|is_complaint|boolean（可空）|否|true|空表示来源无投诉标记，导入VOC仍可用；不得自动false或按负面情感填true|

自然键：(org,store,namespace,external_message_id)。message_text不进入普通日志，原始CSV私有存储按权限短链接读取。业务表只留redacted_text；分类标签由AI或人工工作流写，不信任CSV塞入的confidence/priority。is_complaint标记完整度单独计算：有效消息只要有null，本期投诉率返回unavailable，投诉数可显示“已明确标记N条，标记覆盖X/Y”，R08投诉子通道暂停，但售后case子通道可继续。

## 12.7 after_sales.csv

一份文件两种行，通过record_type分流。case是售后申请/处理记录；refund是退款到账事件；二者不可计为同一“售后次数”，也不得将case金额当退款到账。每个refund必须归一条订单行；整单退款在导入前按行拆分，生成稳定事件ID并保留分摊规则，分摊金额之和等于原事件商品退款金额。

|字段|类型|必填|示例|约束/错误处理|
|---|---|---|---|---|
|store_external_id|string128|是|XM-DEMO-A|共同规则|
|source_updated_at|timestamptz|是|2026-09-04T11:01:00+08:00|共同规则|
|record_type|enum case/refund|是|refund|决定校验和目标实体|
|external_record_id|string128|是|RF001|record_type内稳定事件ID|
|external_order_id|string128|是|O1001|同店同namespace已有订单|
|external_order_item_id|string128|是|L01|必须属于所填订单|
|related_case_id|string128|否|AS001|仅refund可填，必须已存或同文件可解析case且同订单行；case行必须空|
|occurred_at|timestamptz|是|2026-09-03T10:00:00+08:00|case申请时间或refund创建时间；付款后事件不得早于paid_at|
|status|枚举，按record_type|是|succeeded|case=requested/processing/closed/rejected；refund=pending/succeeded/failed，不能互用|
|completed_at|timestamptz|条件|2026-09-04T11:00:00+08:00|仅成功refund必填且≥occurred_at；case及其他退款状态空|
|refund_amount|decimal(20,6)|条件|25.000000|仅成功refund必填且>0；是此事件金额，不是累计总金额；其他行空|
|refunded_quantity_cumulative|integer|条件|1|仅成功refund必填，可0；该行截至此次成功事件累计退件，不是本次增量；其他行空|
|currency|ISO4217 char3|条件|CNY|refund必填并同店；case留空，因为case不计金额|
|reason_code|string64|是|quality|统一原因码quality/logistics/wrong_item/refund_process/other/unknown；可在映射表对应平台原码|
|reason_text|string2000|否|杯盖漏水|脱敏后保存|

自然键：(org,store,namespace,record_type,external_record_id)，写不同实体；同一字符ID作为case和refund不冲突。成功退款金额独立求和，Σ同订单行所有succeeded refund_amount≤item_paid_amount，超出整文件REFUND_AMOUNT_EXCEEDS_PAID；累计件数≤quantity，按completed_at排序非递减，同一完成时刻不同事件累计数必须相同，避免顺序不确定；不满足REFUND_QUANTITY_CONFLICT。成功金额更正必须较新source_updated_at，金额及累计件数重验全历史；不直接添加负数冲销。重复成功事件同ID只更新不重复退款；同一件分两笔退钱的累计件数都填1，件数为max(1,1)=1。

一份after_sales文件包含两类行时，全部一起原子提交；其中refund一行失败，case行也不提交。只有case文件声明case完整，refund保持missing；用户需独立确认refund完整/零事件才允许可用退款指标。failed/pending退款不计到账金额，但可在导入/售后详情解释来源状态。

## 12.8 可手算黄金fixture

该fixture是待实现自动化测试的规范预期，不是“已测试通过”。建立同一演示组织下A、B两个店：external_store_id分别XM-DEMO-A/XM-DEMO-B，currency=CNY，timezone=Asia/Shanghai；namespace=mock_demo。评估时点固定2026-09-11T12:00:00+08:00。除单独说明外，source_updated_at统一2026-09-11T09:00:00+08:00；表中日期时间均补+08:00，日期完整年为2026年9月。两店必须分别创建任务导入，禁止一个CSV混店。以下表是模板字段的精确数据清单，公共固定列按上述值展开，空项即CSV空单元格。

products.csv：所有product_status/sku_status=active，category=杯具，specification可空。

|店|external_product_id|product_name|external_sku_id|sku_code|sku_name|
|---|---|---|---|---|---|
|A|P1|保温杯|S1|CUP-RED|红杯|
|A|P1|保温杯|S2|CUP-BLUE|蓝杯|
|B|P1|保温杯|S1|CUP-RED|红杯|

orders.csv：全部payment_status=paid，currency=CNY，ordered_at等于paid_at前5分钟。

|店|external_order_id|paid_at|expected_item_count|
|---|---|---|---|
|A|O1|09-01T10:00:00|2|
|A|O2|09-01T12:00:00|1|
|A|O3|09-10T10:00:00|1|
|B|O1|09-01T10:00:00|1|

order_items.csv：全部currency=CNY。

|店|external_order_id|external_order_item_id|external_sku_id|quantity|item_paid_amount|
|---|---|---|---|---|---|
|A|O1|L1|S1|2|100.000000|
|A|O1|L2|S2|1|60.000000|
|A|O2|L1|S1|1|70.000000|
|A|O3|L1|S1|1|50.000000|
|B|O1|L1|S1|3|900.000000|

ads.csv：campaign_id=AD1、campaign_name=杯子搜索、attribution_model=last_click、attribution_window_days=7、currency=CNY。

|店|report_date|spend|attributed_sales|
|---|---|---|---|
|A|2026-09-01|40.000000|100.000000|
|A|2026-09-02|0.000000|0.000000|
|B|2026-09-01|100.000000|500.000000|

customer_messages.csv：channel=platform_chat、language=zh-CN。

|店|external_message_id|external_conversation_id|message_at|external_sku_id|message_text|is_complaint|
|---|---|---|---|---|---|---|
|A|M1|C1|09-01T11:00:00|S1|杯盖漏水，想申请退款|true|
|A|M2|C1|09-01T11:05:00|S1|退款什么时候到账|false|
|A|M3|C2|09-01T12:00:00|S2|可以装热水吗|false|
|B|M1|C1|09-01T11:00:00|S1|请问什么时候发货|空|

测试使用Mock分类入口提交固定有效标签：A M1 primary_topic=product_quality/sentiment=negative，M2=refund_process/neutral，M3=usage_question/neutral；B M1=logistics/neutral。不是在原CSV中添加标签。由此A分类覆盖3/3、负面1/3、complaint_message_rate=1/3、voc_refund_process_message_count=1；B投诉率unavailable（标记缺失），但VOC分类仍可用。

after_sales.csv：reason_text可空；所有refund currency=CNY，case currency空；occurred_at见表，成功refund completed_at同occurred_at；case completed_at/refund_amount/refunded_quantity_cumulative都空。

|店|record_type|external_record_id|external_order_id|external_order_item_id|related_case_id|occurred_at|status|refund_amount|refunded_quantity_cumulative|reason_code|
|---|---|---|---|---|---|---|---|---|---|---|
|A|case|AS1|O1|L1|空|09-02T09:00:00|closed|空|空|quality|
|A|refund|RF1|O1|L1|AS1|09-03T10:00:00|succeeded|25.000000|1|quality|
|A|refund|RF2|O1|L1|AS1|09-04T10:00:00|succeeded|25.000000|1|quality|
|A|refund|RF3|O1|L2|空|09-04T11:00:00|succeeded|60.000000|1|wrong_item|
|A|refund|RF4|O2|L1|空|09-09T11:00:00|succeeded|10.000000|0|other|

覆盖声明必须独立展开：两店orders/order_items在[2026-09-01,2026-09-11)完整，无订单日期逐日explicit_zero；A case/refund在同区间分别完整，无各类事件的日期分别explicit_zero，B case/refund全区间明确零事件；广告仅09-01和09-02相应数据已声明范围，B只09-01，其他广告日期missing；消息只09-01完整；products为已有完整目录。无事件日期不能从上表行少自动推完整，fixture必须通过确认流程提交这些声明。

|查询/动作|严格预期|
|---|---|
|A的09-01付款日GMV/订单数/销量/客单价|230.000000 / 2 / 4 / 115.000000；O1两行只计1订单|
|A S1同日销量/销售额|3 / 170.000000；S2为1 / 60.000000|
|A成熟09-01队列订单退款率D7|O1有窗内成功退款，O2只有窗外退款；1/2=0.5，mature|
|A成熟09-01队列SKU退款率D7|S1=max(RF1累计1,RF2累计1)/3=1/3；S2=1/1=1，不能把RF1+RF2计为退2件|
|A成熟09-01售后率D7|仅O1有case，1/2=0.5；RF3/RF4不是新case|
|A退款事件日金额|09-03=25；09-04=25+60=85；09-09=10；[09-01,09-11)总额120|
|A09-01队列观察窗净商品收入（P1公式中间值）|230−(25+25+60)=120；不扣窗外RF4的10；ROI仍null因缺成本|
|A09-01广告ROAS|100/40=2.5，不能显示成ROI150%或利润率|
|A09-02广告ROAS|0/0=null；spend=0与sales=0可显示真零|
|A09-09的订单数/GMV/退款事件金额比|有明确零付款覆盖：0 / 0.000000 / null；退款金额10，不能除0得到无穷大或100%|
|A09-10新队列|订单1/GMV50/销量1；D7未成熟，显示provisional，任何队列退款率规则暂停，即便已知退款0也不能说成熟无退款|
|B09-01|GMV900、订单1、销量3、ROAS5；同名SKU、O1/L1/M1不与A合并|
|重复导入RF1原文件|金额不增加、累计件数不增加；业务和覆盖无变化时不递增版本|
|用更晚source_updated_at把RF1金额改为20|A09-03退款20，观察窗退款105，队列净收入125；订单/件数退款率不变；新dataset_version与旧AI stale|
|在尚未导入订单行的独立副本遗漏O1-L2（该用例不导入引用L2的RF3）|orders.expected_item_count=2但仅1行；A09-01金额覆盖partial且无业务异常，不能把100+70=170当完整GMV。若完整导入后仅漏行重传，因无删除语义旧L2仍在，GMV应仍230，两个场景分别断言|
|将A一行store_external_id改为B放入A文件|整文件STORE_MISMATCH，A与B业务/覆盖/版本都不改变|
|将RF2累计退件改3或金额改100|超过O1-L1销售2件/实付100，整文件失败且RF1、case等同文件其他行不提交|
|将B消息is_complaint留空|正常导入并可分类，投诉率null；不得自动false使投诉率显示0|
|所有店铺未导成本/库存/流量/评价|ROI/库存/周转/转化/差评率全部unavailable，不生成P1假异常|

另外独立验证：100条有效消息已全部分类，但50条negative、50条unknown时，classification_coverage=1、sentiment_coverage=0.5、negative_voc_rate=1；R09因情感覆盖不足暂停，不能算50%负面率。投诉子通道任一期间存在is_complaint空值时R08该通道暂停。超过安全整数/金额上界的聚合返回numeric_overflow，不泄漏浮点舍入值。

另外用独立副本验证稀疏历史：只有此fixture时共同基准不足，R01/R02/R03/R05/R07/R08/R09/R10全部按相应样本/历史门槛suppressed，不应凭数值看似很大就报警。R11可报告缺行/未确认覆盖，R12只在已配置目标与币种样本金额且归因成熟时考虑。测试必须分别断言“不触发，因为历史不足”与“未执行，因为源缺失”，不能只检查告警列表为空。
