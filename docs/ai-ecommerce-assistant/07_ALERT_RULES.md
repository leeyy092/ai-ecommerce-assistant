# 异常预警规则

版本：v1.0 · 2026-09-11。状态：产品与工程规格；应用尚未开发。P0为本次定义的开发范围，P1/P2只作规划。

# PART 7｜异常预警规则

所有阈值是供试点调整的建议默认，尚无客户数据验证。规则先计算，再由LLM解释。severity=info/warning/critical，与开发阶段P0/P1/P2及行动优先级P0/P1/P2分别存储。

共同门槛：完整自然日与同口径历史比较；需要覆盖的任一源partial/missing时业务规则suppressed，仅显示数据缺失提醒。默认基准为前28日中相同星期的最多4个完整日中位数，至少3个历史样本；不足则使用此前7个完整日中位数，仍不足7日则suppressed=insufficient_history。基准为0的相对变化不计算，改用明确的绝对增量门槛；新店不自动视为上涨/下降。队列规则使用最近一个已成熟付款日及其之前成熟队列，不用昨日未成熟队列。当天只比较同小时数据覆盖，未导入小时覆盖时停用日内异常。变化幅度统一(current−baseline)/baseline，下降阈值看负号，不以绝对值混淆。

|规则名称/ID/阶段|计算方式|基准|触发条件（建议默认）|严重等级|建议动作|是否可配置|展示位置|
|---|---|---|---|---|---|---|---|
|R01 销量下降/P0|店铺units_sold相对变化|共同历史中位数|baseline≥20件，下降≥30%且少≥10件|warning；下降≥50%且少≥30件critical|核查漏单、主力SKU、活动结束；列证据SKU|阈值/最小样本可调|Dashboard/Alerts/经营|
|R02 销量上涨/P0|units_sold相对变化|共同基准|baseline≥20且上涨≥50%、增≥20件；baseline=0时需7个完整零日且新增≥30件|info；不把机会默认升级critical|核查活动和大单，人工确认履约能力|可调|Dashboard/Alerts|
|R03 订单退款率异常/P0|成熟order_refund_rate_d7与历史差，单位百分点|成熟历史同口径；历史总分母≥100|当前队列≥30单、成功退款订单≥5，当前≥10%且高基准≥5个百分点|warning；≥20%且退款≥10单critical|查看退款订单与原因，抽查相关SKU|率/百分点/样本可调，D7不可变|Dashboard/Alerts/售后|
|R04 经营ROI异常/P1停用|operating_roi低于阈值|成熟完整成本队列|P0始终disabled=unsupported_source；P1拟默认ROI<0且成本>0|P1 warning|补齐成本并复核亏损来源；P0仅显示无法计算|P0不开放启用；P1可调|未来ROI/Alerts|
|R05 广告成本异常/P0|同campaign同归因组spend上升，roas下降|共同基准，各组分开|基准spend>0，当前增长≥30%且绝对增量≥该店配置金额，ROAS下降≥20%，当前有有效销售归因|warning；花费增≥100%且ROAS降≥50%critical|核对预算/归因延迟，人工查看广告后台|可调；绝对金额须按币种初始化，如CNY建议100，未配置停用|Dashboard/Alerts/广告|
|R06 库存风险/P1停用|库存量及可售天数（另定义库存量/完整近7日均销量）|库存新鲜度与已售SKU|P0 disabled；P1拟可售天数<7且近7日销量≥7|P1 warning；可售0 critical|人工确认库存和补货，不自动采购|P1可调|未来库存/Alerts|
|R07 SKU表现下降/P0|sku_sales_amount与sku_units_sold双下降|该SKU共同基准|历史基准销量≥10，销量降≥40%且少≥5件、销售额降≥30%|warning；销量降≥70%且少≥20件critical|检查该SKU定价、断货线索、页面和活动；无流量源不声称转化下降|可调|SKU/Alerts/Dashboard|
|R08 售后投诉增加/P0|case数或显式投诉消息数，两条子通道独立计算不相加|各自共同基准；投诉子通道当前及基准期is_complaint标记覆盖均须100%，case通道独立|对应当前≥10条、较基准增≥100%且绝对增≥5；零基准需7个完整零日且当前≥10|warning；当前≥30且增≥200%critical|按原因/商品聚合抽样；分清售后申请与投诉|可调，子通道开关可配|售后/VOC/Alerts|
|R09 负面VOC增加/P0|negative_voc_rate及负面条数|同渠道/分类版本历史中位数|当前情感已知消息≥30、sentiment_coverage≥80%、负面≥10、负面率升≥15个百分点；每个基准样本也须情感已知≥30且sentiment_coverage≥80%|warning；率升≥30个百分点且负面≥30 critical|查看脱敏原文样本并人工校正标签|阈值可调，模型/标签版本变化需重建基准|VOC/Alerts/Dashboard|
|R10 SKU退款率异常/P0|成熟sku_refund_rate_d7|成熟SKU历史，历史售出≥50件|当前售出≥20件、累计退件≥5，退款件率≥15%且高基准≥8个百分点|warning；≥30%且退≥10件critical|查看该SKU退件及售后原因，区分金额补偿|可调|SKU/Alerts|
|R11 数据不完整/P0|必需源Coverage缺失/partial、订单行缺漏|设置的必需源与已确认日期区间|每日08:00（店铺时区）必需源未complete或付款订单行数不齐；首次接入只显示引导info，不伪造经营异常|warning；运行故障另走data_status|显示具体缺日期/来源/订单，重导更正|仅必需源可调，截止固定08:00；默认orders+order_items，products只需有效目录存在，不要求每日重导；refund缺失单独禁退款指标|导入/Dashboard/Alerts|
|R12 广告ROAS偏低/P0|同campaign归因组roas|该组配置目标，不跨平台平均|spend≥按币种配置的最小样本金额，归因窗已结束、coverage完整且roas低于目标（建议1.5）；无目标/金额配置停用|warning|核查素材、落地页及归因周期，不直接停广告|目标/金额可调，不把ROAS当利润|广告/Alerts|

计算失败不能依赖失败快照发布Alert。Dashboard的data_status/job_failure读取JobRun运行诊断，失败级别critical、显示重试入口，与已发布快照同时可读，但不计入业务异常数量；R11只记录可成功发布的数据覆盖/缺行问题。

R05/R12对尚未结束平台归因窗口的广告报告标provisional并暂停业务报警，窗口格式见CSV；平台后续更新会产生新版本。无共同历史只显示“历史不足”，不调用LLM代替阈值判断。所有suppressed结果保留rule_id、原因和样本数供详情页查看，但不计“异常数量”。告警唯一键含org/store/rule/entity/period/rule_version/dataset_version；当前页面仅读已发布快照，旧快照留审计。规则配置修改增ruleset_version，该规则增rule_version，重新发布并使旧AI过期；每次触发不重复创建同键告警。
