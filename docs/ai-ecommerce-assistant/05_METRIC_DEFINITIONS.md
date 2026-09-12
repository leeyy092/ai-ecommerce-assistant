# 指标定义

版本：v1.0 · 2026-09-11。状态：产品与工程规格；应用尚未开发。P0为本次定义的开发范围，P1/P2只作规划。

# PART 6｜数据指标定义

## 6.1 共同口径与返回结构

本字典是指标计算唯一业务口径。metric_version 固定 v1；公式由确定性服务执行，LLM不得改写数值。金额数据库 numeric(20,6)，服务用 Decimal，API 为十进制字符串；数量 bigint，API 必须是安全整数，越界拒绝而非截断。聚合中间值与DailyMetric使用numeric(24,6)，在写入/输出前仍按类型做范围检查：数量不超过9007199254740991，金额不超过99999999999999.999999，超出返回unavailable/null与numeric_overflow、保留诊断并暂停对应规则，不能截断或导致整轮无限失败。金额保留6位小数；展示比例可四舍五入但公式比较使用未舍入Decimal分子/分母。普通比例为0～1，ROAS可大于1，ROI可为负。无穷大不返回JSON。

每个店铺固定 currency（ISO4217）和 timezone（IANA）。P0只单店查询，不做跨币种加总或汇率换算；币种不同的导入整文件拒绝。日期参数 from/to 是店铺本地日期半开区间[from,to)，事实时间存UTC timestamptz。默认昨日完整自然日；选择今天必须显示“截至某时，未完结”，无历史同小时覆盖不能比较。

统一 MetricValue 字段：metric_id:string、value:decimal-string|safe-integer|number|null（按指标类型）、unit:currency|count|ratio|multiple|days、currency:string|null、period_start/date、period_end/date、status:available|unavailable、coverage_status:complete|partial|missing、maturity:mature|provisional|not_applicable、unavailable_reason:string|null、numerator/denominator:decimal-string|null、sample_size:integer、dataset_version:integer、ruleset_version:string、metric_version:string。无来源为missing+unavailable+null；有部分数据可显示已知值，但partial且不可报警；覆盖完整且确实无事件才显示0。零分母的比例为unavailable/null，reason=zero_denominator。未知不得转成0。

订单头只保存订单身份、付款时间和expected_item_count，不保存可相加的订单金额；GMV只加订单行item_paid_amount。订单行数量与expected_item_count不一致时视为缺行，相关指标覆盖partial，金额不能按缺行补0；有覆盖的空销量与漏导不是同一状态。已付款订单以paid_at归期；unpaid/cancelled且没有付款的订单不计；付款后发生退款仍保留原付款GMV、订单数和销量。

D+7队列使用每笔订单paid_at起连续168小时观察窗[paid_at,paid_at+7d)。队列区间内全部订单均到观察截止，且订单及相应事件源覆盖完整才是mature；否则provisional。整个自然日队列最晚一笔也成熟前，不对该日队列报警。成熟只表示观察窗结束，后来补录但事件发生于窗内仍会重算旧队列。窗外退款计入事件日退款金额，不倒灌D+7分子。退款成功事件按external_record_id去重并替换金额；SKU退款件数按订单行，在窗内成功退款事件的refunded_quantity_cumulative取最大值，每行最多销售quantity。多次退同一件、金额分批到账不重复计件；失败/申请中不进入退款指标。累计件数必须按完成时间非递减，且0≤累计件数≤销售件数，更正导入需对该行全部现存成功事件重验。

## 6.2 指标字典

“可配置”只指显示范围/观察窗等明示参数，不能通过设置偷偷改变公式。P0队列窗固定D+7；未来修改必须生成新metric_version。以下P1字段仅设计，P0显示“未接入，无法计算”，不得造值。

|中文名称 / 英文名称（metric_id）|类型与公式|时间范围|数据来源|页面位置|空值/边界|是否可配置|
|---|---|---|---|---|---|---|
|GMV / Gross Merchandise Value（gmv）|金额；Σ已付款订单行item_paid_amount，已分摊商品折扣，不含运费税，不减退款|按订单paid_at归期|Order+OrderItem，行数完整|Dashboard/经营/SKU汇总|缺订单行partial；完整无付款为0|日期可调，公式不可调|
|订单数 / Paid Order Count（paid_order_count）|整数；COUNT DISTINCT已付款external_order_id|paid_at|Order|Dashboard/经营|完整零单为0；缺源null|日期可调|
|销量 / Units Sold（units_sold）|整数；Σ已付款订单行quantity|paid_at|Order+OrderItem|经营/商品摘要|缺行partial；完整无销售0|日期可调|
|客单价 / Average Order Value（average_order_value）|金额；gmv/paid_order_count|同一付款区间|前两指标|Dashboard/经营|订单数0返回null；任一缺失不可计算|日期可调|
|退款金额 / Refund Amount（refund_amount）|金额；Σstatus=succeeded的独立退款事件refund_amount|completed_at事件日|RefundEvent，refund覆盖|Dashboard/经营/售后|完整无成功事件0；不扣减付款日GMV|日期可调|
|退款率 / 7-day Order Refund Rate（order_refund_rate_d7）|比例；窗内至少一次成功退款的去重订单数/队列付款订单数|付款队列D+7|Order+RefundEvent|Dashboard/高退款/告警|分母0=null；未成熟provisional；需完整refund覆盖|P0固定D+7，日期可调|
|广告花费 / Advertising Spend（ad_spend）|金额；Σspend|平台报告本地report_date|AdMetric|Dashboard/广告简视图|未导入null；确认无投放0|日期/campaign可调|
|广告销售额 / Attributed Advertising Sales（ad_sales）|金额；Σattributed_sales|report_date及同一归因组|AdMetric|广告简视图|缺失null；不同归因组分列禁止合并|归因组/日期可选|
|广告投入产出比 / Return on Ad Spend（roas）|倍数；ad_sales/ad_spend|同日期同归因模型及窗口|AdMetric|广告简视图/告警|spend=0返回null，无穷大不显示|比较范围可调|
|经营ROI / Operating Return on Investment（operating_roi）|比例P1；(净商品收入−商品成本−平台费−履约费−广告费)/(上述四项成本之和)，净商品收入=队列GMV−同D+7窗退款|相同成熟付款队列，各成本已分配到该队列|P1 CostEntry+销售/退款|Dashboard占位/未来ROI|P0恒null，reason=cost_data_unavailable；缺任何成本项null；总成本0=null|P0不可配置，P1版本化成本口径；绝不使用ROAS−1|
|转化率 / Session Conversion Rate（conversion_rate）|比例P1；去重下单session数/合格访问session数|同一访问归属期间|P1 TrafficMetric|未来经营|P0null；没有订单关联session不得用订单数/随意UV替代|P1访问/机器人排除口径版本化|
|SKU销量 / SKU Units Sold（sku_units_sold）|整数；指定sku_id的Σquantity|paid_at|OrderItem+Order|SKU列表/详情/排行|该SKU销售覆盖完整无销售0；缺行partial|SKU/日期可选|
|SKU销售额 / SKU Sales Amount（sku_sales_amount）|金额；指定sku_id的Σitem_paid_amount|paid_at|OrderItem+Order|SKU列表/详情|完整无销售0；不得将广告归因销售混入|SKU/日期可选|
|SKU退款率 / 7-day SKU Refunded Unit Rate（sku_refund_rate_d7）|比例；Σ各订单行窗内max(refunded_quantity_cumulative)/Σ对应销售quantity|付款队列D+7|OrderItem+RefundEvent|SKU详情/高退款列表|分母0=null；未成熟provisional；只退款不退件累计量可为0|P0窗固定，SKU/日期可调|
|库存 / Sellable Inventory on Hand（inventory_on_hand）|整数P1；指定SKU/仓库在截止时最新有效可售库存快照之和|as_of截止点|P1 InventorySnapshot|未来SKU库存|P0null；无快照不是0；过期快照标缺覆盖|P1仓库/新鲜度可调|
|库存周转 / Inventory Turnover Days（inventory_turnover_days）|天数P1；期间平均每日库存成本/同期销售商品成本×期间天数|相同完整成本期间|P1 InventorySnapshot+CostEntry|未来商品分析|成本缺失或销售成本0=null；不拿当前库存/今日销量伪装|P1期间可调，成本方法版本化|
|售后率 / 7-day Order After-sales Rate（after_sale_rate_d7）|比例；窗内至少一条case的去重订单数/队列付款订单数，case状态含申请中/结案/驳回，不含纯退款事件|付款队列D+7，以case occurred_at|AfterSaleRecord+Order|售后/VOC/告警|分母0=null；case覆盖不足partial；未成熟provisional|窗固定，日期可调|
|投诉率（消息口径） / Complaint Message Rate（complaint_message_rate）|比例；is_complaint=true的消息数/全部有效客户消息数|message_at|CustomerMessage显式来源投诉标记；不是LLM情感|VOC/客服/告警|任一有效消息未提供投诉标记，则本期投诉率unavailable/null并说明标记覆盖不足；分母0=null|日期/渠道可调，定义固定|
|差评率 / Negative Review Rate（negative_review_rate）|比例P1；rating≤2的有效评价数/全部有效评价数（统一5分制）|reviewed_at|P1 Review|未来VOC/商品|P0null；删除/无评分排除，零评价null|P1阈值可调且标版本|
|退款事件金额比 / Refund Event Amount Ratio（refund_event_amount_ratio）|比例型可>1；当期refund_amount/当期gmv，是不同付款队列混合的现金事件观察值|同一自然日期区间的退款日与付款日|退款金额+GMV|经营辅助指标，禁止标成退款率|GMV=0返回null；可>100%，不得截断|日期可调；不参与队列退款预警|

派生量不增加首页卡片：voc_{topic}_message_count是topic主标签匹配且分类完成的消息数，例voc_refund_process_message_count；negative_voc_message_count按sentiment=negative计数；negative_voc_rate=负面消息数/情感已知消息数；情感已知仅含positive/neutral/negative，unknown不进分母。另返回classification_coverage=已完成分类数/有效消息数、sentiment_coverage=情感已知消息数/有效消息数，两者不可互换；已完成分类仍可输出unknown。无已知情感则负面率null。总数不能用抽样结果外推，未知标签不等于中性。同一消息仅一个primary_topic，其他标签可多值；主标签计数可相加，secondary标签重叠计数不得相加。SKU排名并列按sku_code稳定排序；产品值从当前产品下SKU相同指标聚合，比例重新汇总分子分母，不能平均比例。
