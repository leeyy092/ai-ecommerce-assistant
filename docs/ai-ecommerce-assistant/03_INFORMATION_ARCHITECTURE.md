# 信息架构、首页、模块与路由

版本：v1.0 · 2026-09-11。状态：产品与工程规格；应用尚未开发。P0为本次定义的开发范围，P1/P2只作规划。

# PART 3｜完整信息架构

以下 Sitemap 包含完整产品方向。`[P0]` 为可开发页面；`[P1/P2]` 仅文档规划，P0 不创建空路由、空菜单或假按钮。同一工作台的 Tab 使用 URL query，可直接链接并共享筛选，不另造多个重复页面。

```text
AI 电商运营助手
├─ 登录 [P0] /login
├─ 接受邀请 [P0] /invite/[token]
├─ 首页 Dashboard [P0] /dashboard
├─ 数据中心
│  ├─ 自动日报/历史 [P0] /data/reports
│  ├─ 日报详情 [P0] /data/reports/[reportId]
│  ├─ 经营指标 [P0] /data/metrics
│  ├─ 异常预警 [P0] /alerts
│  └─ ROI 分析 [P1] /data/roi
├─ 商品中心
│  ├─ SKU 分析 [P0] /products/skus
│  ├─ SKU 详情 [P0] /products/skus/[skuId]
│  ├─ 产品分析 [P1] /products/analysis
│  ├─ 竞品分析 [P2] /products/competitors
│  ├─ 卖点分析 [P1] /products/selling-points
│  └─ 内容生成 [P1] /products/content
├─ 客服中心 [P0] /customer-service
│  ├─ FAQ [P0] ?tab=faq
│  ├─ VOC [P0] ?tab=voc
│  ├─ 售后分类 [P0] ?tab=after-sales
│  ├─ 回复建议 [P1] /customer-service/replies
│  └─ 企业知识库 [P1] /customer-service/knowledge
├─ AI 运营建议 [P0] /ai-insights
│  ├─ 今日重点 ?tab=focus
│  ├─ 经营诊断 ?tab=diagnosis
│  ├─ 问题发现 ?tab=issues
│  ├─ 行动建议 ?tab=actions
│  ├─ 行动优先级 ?tab=priority
│  └─ 建议详情 [P0] /ai-insights/[insightId]
├─ 数据导入 [P0] /import
│  └─ 导入详情/映射/预览/错误 [P0] /import/[importId]
└─ 设置 [P0] /settings
   ├─ 组织 ?tab=organization
   ├─ 店铺 ?tab=stores
   ├─ 数据源 ?tab=data-sources
   ├─ AI 与规则 ?tab=ai
   ├─ 成员 ?tab=members
   ├─ 固定角色权限说明 ?tab=permissions
   ├─ 店铺授权/自定义权限 [P1] /settings/access
   └─ 自动执行与审计 [P2] /settings/automation
```

用户简称：O=Owner、A=Admin、P=Operator、C=CustomerService。以下每行对应页面或可链接的独立 Tab，全部继承权限矩阵。

| 页面/阶段 | 页面目标与使用者 | 第一眼看到 | 核心组件 | 核心数据 | 核心操作 |
|---|---|---|---|---|---|
| 登录 P0 | 四角色进入本组织 | 登录表单/错误 | 邮箱密码、忘记密码说明 | session 状态 | 登录，过期后重登 |
| 接受邀请 P0 | 被邀请者加入组织 | 邀请组织、角色、有效性 | 身份确认、设密/登录 | 邀请状态，非敏感组织名 | 接受一次性邀请 |
| Dashboard P0 | O/A/P 三分钟决策 | 日期/覆盖与首要问题 | 指标、结论、异常、商品、VOC、行动 | 当前版本指标/规则/VOC/建议 | 筛选、看证据、更新本人行动状态 |
| 日报列表 P0 | O/A/P 找到某日结论 | 最近完整日与生成状态 | 日期列表、状态筛选 | AIReport 摘要/版本/stale | 打开日报、人工重新生成 |
| 日报详情 P0 | O/A/P 复核历史判断 | 日期、快照、当前/过期标识 | 摘要、指标、异常、证据 | 固定快照，历史内容不可覆盖 | 查看证据、查看新版本 |
| 经营指标 P0 | O/A/P 核对趋势 | 核心卡片与缺源提示 | 趋势图、口径抽屉 | 单店指标序列/覆盖/分母 | 日期筛选、查看口径 |
| 异常预警 P0 | O/A/P/C 查变化；C 只客服类 | 等级及待复核异常 | 分类筛选、异常表、证据抽屉 | 当前版本 Alert/基准/样本 | 定位 SKU/VOC、看关联建议 |
| ROI 分析 P1 | O/A/P 核对完整成本收益 | 可计算比例与缺失成本 | 成本拆分、队列收益 | 净收入、成本、费用 | 查看成本来源、按同口径比较 |
| SKU 列表 P0 | O/A/P 对照商品表现 | 下滑/异常/高退款商品 | 表格、产品聚合切换、筛选 | 销量/销售额/成熟退款率 | 搜索编码、排序、查看详情 |
| SKU 详情 P0 | O/A/P 找到问题依据 | SKU 身份、变化和覆盖 | 趋势、退款、VOC、建议 | SKU 指标与已授权证据 | 看口径、跳异常、处理建议 |
| 产品分析 P1 | O/A/P 判断产品组合 | 产品贡献与规格差异 | 产品分组、规格对照 | 产品/SKU 汇总、生命周期 | 产品对照、展开规格 |
| 竞品分析 P2 | O/A/P 复核竞争变化 | 有时间戳的变更 | 竞品列表、快照差异 | 授权来源、价格/内容快照 | 添加来源、验证变更 |
| 卖点分析 P1 | O/A/P 提炼有依据卖点 | 事实与客户关注点 | 事实卡、主题证据、草稿 | 产品知识、VOC | 选择证据、修改草稿 |
| 内容生成 P1 | O/A/P 生成待审草稿 | 商品与渠道输入 | 模板、编辑器、事实检查 | 商品事实、卖点、渠道规范 | 生成、编辑、复制；不自动发布 |
| FAQ Tab P0 | O/A/P/C 知道客户常问什么 | 高频问题及样本数 | 问题聚类、趋势、脱敏样本 | CustomerMessage/VOC 标签 | 日期/SKU 筛选、修正标签 |
| VOC Tab P0 | O/A/P/C 归纳客户抱怨 | 主要投诉及新增负面词 | 主题榜、样本、趋势 | 情感/主题/证据/未分类数 | 查看脱敏原文、修正分类 |
| 售后分类 Tab P0 | O/A/P/C 查售后原因 | 原因排行与上升项 | 原因表、关联 VOC、样本 | 售后类型/件数/状态；C 无退款金额 | 筛选原因、看证据，不改退款结果 |
| 回复建议 P1 | A/P/C 准备客服回复 | 问题及知识命中结果 | 检索引用、回复草稿 | 经批准 FAQ/政策/商品资料 | 核实、编辑、复制，不自动发送 |
| 企业知识库 P1 | O/A/C 管理可引用知识 | 有效文档/过期项 | 文档、版本、审核状态 | FAQ、售后规则、SOP | 上传、审核、停用 |
| 今日重点 Tab P0 | O/A/P/C 找当天首要动作 | 最多 3 项；C 仅客服 | 重点卡、来源、状态 | 可见范围内的 AIInsight | 看证据、采纳、完成 |
| 经营诊断 Tab P0 | O/A/P/C 复核原因假设 | 事实与假设分区 | 问题链、证据抽屉 | 已授权异常/VOC/可能原因 | 跳来源、选择复核动作 |
| 问题发现 Tab P0 | O/A/P/C 集中看问题 | 规则事实与 AI 解读标识 | 按类别筛选、来源标签 | Alert 与相关建议 | 查规则、查看建议 |
| 行动建议 Tab P0 | O/A/P/C 记录本人处理 | 待处理建议列表 | 行动卡、状态筛选 | 建议动作、本人状态 | pending→accepted/done/dismissed |
| 行动优先级 Tab P0 | O/A/P/C 决定先后 | 紧急度与排序依据 | 分级列表、证据完整度 | 规则等级、影响范围、行动优先级 | 按固定规则排序、查看解释 |
| 建议详情 P0 | O/A/P/C 复核完整建议 | 问题、适用日期、是否过期 | 证据、假设、动作、状态记录 | schema 全字段及服务端元数据 | 展开来源、改本人状态 |
| 数据导入 P0 | O/A/P/C 提交授权文件 | 支持类型、依赖顺序和历史 | 上传、模板、任务表 | ImportTask、来源覆盖 | 上传、按任务状态筛选 |
| 导入详情 P0 | 上传者及有权成员完成校验 | 当前阶段、错误/影响行数 | 映射、预览、覆盖确认、错误列表 | 映射、校验结果、版本 | 校验、确认提交、下载授权错误文件 |
| 组织设置 P0 | O/A 维护组织名称 | 当前组织信息 | 名称表单 | Organization 基础字段 | 保存名称 |
| 店铺设置 P0 | O/A 建立数据边界 | 店铺币种/时区 | 店铺列表、表单 | Store/币种/IANA 时区 | 建店；有事实后币种时区锁定 |
| 数据源设置 P0 | O/A 核对来源 | CSV 类型与覆盖 | 来源卡、覆盖日历（来源接口摘要） | DataSource、DataCoverage | 配置 namespace，跳转导入 |
| AI 与规则设置 P0 | O/A 控制生成 | AI 开关、固定晨报时间、上次任务、规则阈值 | 每日 08:00 说明、额度/阈值表、健康状态 | 店铺时区、固定计划、规则版本、模型状态 | 配置开关/额度/允许阈值，手动生成 |
| 成员设置 P0 | O/A 管理访问 | 成员角色与待接受邀请 | 成员表、邀请链接弹窗 | Membership/Invite | 邀请、撤销、禁用、合法角色调整 |
| 权限说明 P0 | O/A 核对固定边界 | 固定矩阵和自身角色 | 只读矩阵 | 固定 capability 清单 | 查看，不编辑权限项 |
| 自定义权限 P1 | O/A 按店铺授权 | 当前授权范围 | 角色/店铺授权编辑 | 扩展策略、审计 | 配置并验证访问范围 |
| 自动执行 P2 | O/A 审查外部动作 | 待审批动作与限额 | 审批、执行历史、回滚 | 工具授权、计划、结果 | 批准、撤销、停止 |

全局交互：店铺与日期切换保留在 URL；数据接口使用同一 `store_id/from/to`，分页以稳定键排序。没有店铺时 O/A 看到建店步骤，P/C 看到联系管理员提示；没有数据时显示“导入后生成”，不填演示数。Mock 组织持续显示“演示数据”。403 页面不显示被拒资源的存在、名称或摘要。


# PART 4｜Dashboard 首页设计

首页默认展示**昨日完整自然日的经营晨报**，顶部写清“今日查看 · 数据日期 YYYY-MM-DD”，避免将昨日值标成今日实绩。日期范围遵循店铺本地 `[from,to)`，显示店铺、币种、时区、数据更新时间、已发布快照 `current_snapshot_version`、ruleset_version和来源覆盖。最新已提交数据版本为 `latest_dataset_version`；其高于已发布版本时显示 `snapshot_status=updating`，页面继续统一读取上一完整快照，失败则显示 failed 与重试提示，不混用新旧指标/告警/VOC。用户显式选择今日时标题改为“今日截至 HH:mm · 未完结”，只能与有相同小时覆盖的历史数据比较，否则比较值及异常判定为空并解释原因。

PC 从上到下按以下顺序布局；窄屏卡片顺序一致，无横向挤压。加载用骨架，空值用“— + 原因”，完整覆盖且真实零值显示 0。确定性指标和规则先显示，AI 区域独立加载/失败；AI 失败保留可用数据与重试入口。

## 4.1 顶部今日摘要

| 卡片 | 主值及比较 | 点击与边界 |
|---|---|---|
| GMV | 所选日期已付款订单行商品实付，金额字符串按币种格式化；比较同口径完整基准 | 打开经营指标；不含运费税，不扣退款 |
| 订单数 | 按付款归属、订单头去重计数 | 看口径及覆盖，不能按订单行条数计算 |
| 广告花费 | 所选来源/归因组花费；有不可合并分组时要求选择 | 跳广告指标区；广告缺源显示“未导入广告数据” |
| 7日退款订单率（成熟队列） | 展示最近可完整观察的 D+7 付款队列退款订单率，同时写出队列日期 | 当前付款日不成熟时不伪装成同日退款率；退款事件金额单列辅助值 |
| ROI | P0 固定显示“不可计算”及“需完整成本账，后续版本支持” | 无假数、无空 ROI 页面；下方可显示已具备的 ROAS，名称明确区分 |
| 异常数量 | 当前数据版本、可见范围内有效告警数量，按级别分组 | 跳异常中心；部分来源未覆盖时提示“仅基于已覆盖数据” |

每个指标带 `value/status/coverage_status/maturity/unavailable_reason/comparison/sample_size/metric_version`；status=available/unavailable，coverage_status=complete/partial/missing，maturity=mature/provisional/not_applicable。原因与样本另列，页面按PART6映射中文文案，不把覆盖、成熟度混成一个状态枚举。基准为零时不显示无穷大百分比，显示绝对变化和“基准为零”。当前有完整覆盖但无订单时订单/GMV 可为 0，客单价和相关分母指标为空。

## 4.2 AI 今日结论

四张短句卡：整体经营状态、最大问题、最大机会、今天最应做的一件事。每条均能展开证据，展示数据日期、生成时间与是否过期。“机会”只描述值得验证的信号，例如销量上升且观察窗内退款稳定，不能写成确定爆品或保证利润；证据不足显示“暂未发现有足够依据的机会”。无异常时写“已覆盖范围内未触发规则”，不能宣称全店无问题。

每卡限制 1～2 句，事实与“可能原因”分开。AI 未生成时显示任务状态；失败时用确定性卡片显示“当前 N 条规则异常，点击查看”，不把规则文字冒充 AI。新数据提交但快照尚未发布时显示“数据处理中”；新数据快照或规则版本发布后将对应旧结论标记 stale，并提示“数据已更新，等待重新生成”，始终保留旧日期与版本。

## 4.3 异常中心

五个分类展示数据异常、SKU 异常、广告异常、客服异常、售后异常，每类前 3 条，总览提供“查看全部”。数据异常含覆盖中断/校验失败提示；业务异常只用成功提交的快照，不将失败文件行计入经营结果。

每行包含等级、对象、当前值、基准、绝对/相对变化、时间窗、样本量、规则编号/版本、来源覆盖与“查看依据”。广告分组标明归因模型/窗口，不混加。按 critical→warning→info、影响范围、稳定 ID 排序；级别由规则决定，LLM 无权升降级。库存与 ROI 风险 P0 不检测，不能显示“正常”。

## 4.4 商品表现

四个 Tab：Top SKU（按商品实付降序，可切销量）、下滑 SKU（可比完整时间窗的销量变化）、异常 SKU（关联当前规则告警）、高退款 SKU（成熟 D+7 队列、满足最小样本）。每个默认最多 5 行，列出 SKU 编码/名称、销量、商品实付、变化、退款率、样本数与主要问题。

点击进入同筛选日期的 SKU 详情。无法计算趋势的 SKU 不进入下滑榜，未成熟或分母不足的 SKU 不进入高退款榜，单独注明排除数量。无满足条件商品显示原因而非填充其他商品。SKU 身份来自稳定外部 ID，不按名称合并。

## 4.5 客户 VOC

并列展示投诉最多的问题、FAQ 高频问题、新增负面关键词、售后原因，默认各取前三项；每项显示去重消息/事件数、上一可比完整周期值、证据样本数及“查看脱敏样本”。新增负面词需有基准覆盖及最低样本；基准缺失显示“本期关键词”，不写“新增”。

区分消息条数、售后事件数和涉及订单数，不能把聊天消息频次称为投诉客户数。展示未分类/分类失败数量，人工修正标签有操作者和版本记录；改标签触发受影响聚合更新。没有客服源只显示导入提示；有售后无聊天时售后原因可正常显示。P0 售后分类是分析，不提供退款审批或退款执行。

## 4.6 AI 行动建议与字段结构

首页最多展示 3 条重点，余项进入同一 AI 工作台。每条包含问题、数据依据、原因假设、具体动作、行动紧急度、定性预期影响与证据完整度；采纳/完成/忽略只记录当前用户状态，不代表系统已替用户执行。已过期建议允许查看历史与记录处理结果，但操作前持续提示数据已变化。

以下是产品必须呈现的完整字段，采用服务端 envelope + LLM payload，不建立扁平字段副本。PART 9 的 JSON Schema 是结构验证唯一真源；服务端填充证据、权限、版本和状态，模型只输出 payload。成功时 evidence 非空；失败/跳过时 payload/generated_at 为 null、action_states 为空，界面展示 error 而非虚构建议。

| 字段 | 类型/来源 | 必需与展示规则 |
|---|---|---|
| schema_version / insight_id | string / UUID，服务端 | 必需，Schema 1.0 与建议唯一标识 |
| org_id / store_id | UUID，服务端 | 必需，权限上下文，不由 LLM 自报 |
| dataset_version / metric_version | integer/string，服务端 | 必需，生成时完整发布快照与指标口径 v1 |
| period.from / period.to / period.timezone | 本地日期/string | 必需，店铺时间右开区间 |
| stale / updating | boolean，服务端 | 必需；stale 对比 current_snapshot_version，updating 表示新导入仍在处理 |
| visibility_scope | business/customer_service，服务端 | 必需，继续核验证据和文本，不能只依标签放行 |
| status / generation_status | enum，服务端 | active/archived；succeeded/failed/skipped 分开表示 |
| generated_at | UTC timestamp/null | 成功必有，失败为空；按店铺时区显示 |
| evidence[] | object，服务端 | 成功至少一项；每项 evidence_id、kind、date、period、dataset_version、metric_version、coverage、source_refs，以及互斥 metric/voc/alert 内容；详见 PART 9 |
| evidence[].source_refs[] | object | source_kind、record_id、import_task_id，只允许当前白名单真实记录 |
| confidence | object，服务端 | meaning=evidence_completeness_not_probability、level=sufficient/limited/insufficient、met_checks、total_checks、basis_codes、limitations；不表示正确概率 |
| payload.title / payload.summary | string | 成功必需，短标题及问题描述，不夹带未经核实因果 |
| payload.category | enum | business/sku/advertising/customer_service/after_sales/data_quality |
| payload.severity | info/warning/critical | 必需，服务端按规则证据校正 |
| payload.evidence_ids | string[] | 必需且非空，只能引用 envelope 已授权证据 |
| payload.possible_causes[] | object[] | 必需可空；每项 hypothesis_id、kind=hypothesis、description、evidence_ids、verification_step；固定标“可能原因” |
| payload.recommended_actions[] | object[] | 成功时 1～5 项；每项 action_id、title、description、evidence_ids、hypothesis_ids、priority、expected_impact；仅人工动作 |
| recommended_actions[].expected_impact | object | qualitative 定性预期、metric_id 衡量指标、observation_days 1～30 天；不足以判断写“待验证”，不承诺收益 |
| payload.priority / recommended_actions[].priority | P0/P1/P2 | 行动紧急度：今天先核查/近期处理/持续观察，与开发阶段无关 |
| payload.related_skus | UUID[] | 必需可空，只允许当前授权店铺 SKU |
| payload.related_metrics | string[] | 必需非空，来自服务端指标白名单 |
| action_states[] | object[]，服务端 | 与 action_id 对应，status=pending/accepted/done/dismissed；服务端按当前用户装配个人状态，所有角色只能改本人状态，无认领抢占/派单/代改 |
| action_states[].updated_at / updated_by_user_id / version | timestamp/UUID或null/integer | 服务端审计和并发控制，客户端不可自填操作者 |
| action_states[].estimated_impact | null | P0 固定 null，显示“待行动后观察”，不估计销售提升区间 |
| error | object/null | 成功为空；失败包含 code、retryable、message，文案不暴露模型 Prompt 或内部数据 |

证据展开需要展示“来源事实→计算口径/规则→AI 解读”。预期影响是建议值，完成状态是用户声明；后续指标变化不能直接被系统标为建议带来的收益。


# PART 5｜核心业务模块

以下每个模块固定包含 14 个字段。这里的 P0/P1/P2 为**开发阶段**。P0 的五个 AI 子模块是同一数据集的视图，不对应五套生成服务或五个 Agent。

## 5.1 自动日报

- 模块名称：自动日报。
- 用户：Owner、Admin、Operator。
- 业务目标：每天得到可复核的经营摘要。
- 输入数据：当前版本的 DailyMetric、Alert、VOCInsight、覆盖状态。
- 处理逻辑：每日店铺本地 08:00 按昨日完整日固化快照，规则优先汇总，再结构化生成；无新数据复用合法缓存。
- 输出数据：AIReport、证据引用、版本与生成状态。
- 页面展示：列表、详情，首页显示当期摘要。
- AI 是否参与：是，归纳重点及行动。
- 是否需要 LLM：需要；失败时保留数字和规则摘要。
- 是否需要规则引擎：需要，指标/异常先完成。
- 是否需要 RAG：不需要，结构化证据直供。
- 是否需要 Agent：不需要，固定 Workflow。
- 是否需要定时任务：需要，固定店铺本地每日 08:00；支持幂等人工触发。
- P0 / P1 / P2：P0。

## 5.2 经营指标

- 模块名称：经营指标。
- 用户：Owner、Admin、Operator。
- 业务目标：统一核对单店经营和广告表现。
- 输入数据：Order、OrderItem、AdMetric、RefundEvent、AfterSaleRecord、DataCoverage。
- 处理逻辑：按 PART 6 确定性计算；金额 Decimal，广告按归因组，缺源与零分离。
- 输出数据：指标卡、序列、分母、覆盖和口径版本。
- 页面展示：经营指标页及 Dashboard；ROI 标未支持。
- AI 是否参与：不参与指标计算。
- 是否需要 LLM：不需要。
- 是否需要规则引擎：需要，公式与边界校验。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：需要，导入后刷新及每日观察窗更新。
- P0 / P1 / P2：P0 简单视图，无自定义 BI。

## 5.3 异常预警

- 模块名称：异常预警。
- 用户：四角色，CustomerService 仅客服/售后授权子集。
- 业务目标：找出值得人工复核的变化。
- 输入数据：指标、基准、覆盖、样本和固定规则配置。
- 处理逻辑：按阈值/统计规则计算，样本不足不判正常；同快照业务键幂等。
- 输出数据：Alert、严重等级、实际值/基准/变化、规则版本。
- 页面展示：异常页、首页、SKU/VOC 关联区。
- AI 是否参与：可解读，不负责是否触发或等级。
- 是否需要 LLM：告警生成不需要。
- 是否需要规则引擎：需要，唯一判定来源。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：需要，导入成功后及每日运行。
- P0 / P1 / P2：P0；库存/ROI 规则等待 P1 数据源。

## 5.4 ROI 分析

- 模块名称：ROI 分析。
- 用户：Owner、Admin、Operator。
- 业务目标：基于完整账目比较经营投入收益。
- 输入数据：同队列净商品收入、商品成本、平台费、履约费、广告费。
- 处理逻辑：依 PART 6 的经营 ROI 公式对齐队列/观察窗；任一成本缺失返回 null。
- 输出数据：ROI、成本拆分、缺失项；不能用 ROAS-1 替代。
- 页面展示：P1 独立页；P0 首页仅不可计算说明。
- AI 是否参与：P1 可解释组成与风险，不补成本。
- 是否需要 LLM：计算不需要，解释可选。
- 是否需要规则引擎：需要，成本完整度与公式。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：P1 账目变化后刷新。
- P0 / P1 / P2：P1；P0 不实施利润计算。

## 5.5 SKU 分析

- 模块名称：SKU 分析。
- 用户：Owner、Admin、Operator。
- 业务目标：定位下滑、高退款及值得关注的 SKU。
- 输入数据：SKU、订单行、售后、VOC、覆盖和告警。
- 处理逻辑：稳定 SKU ID 聚合销量/金额/成熟退款率，计算可比趋势，关联授权证据。
- 输出数据：SKU 对照、榜单、详情指标及问题。
- 页面展示：SKU 列表/详情，支持产品分组聚合。
- AI 是否参与：可解释关联反馈，不能确定因果。
- 是否需要 LLM：表格不需要，引用已有建议即可。
- 是否需要规则引擎：需要，指标与异常。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：需要，随指标刷新。
- P0 / P1 / P2：P0。

## 5.6 产品分析

- 模块名称：产品分析。
- 用户：Owner、Admin、Operator。
- 业务目标：比较同产品规格及产品组合贡献。
- 输入数据：Product、SKU、聚合指标、生命周期资料。
- 处理逻辑：仅按显式产品关系汇总，不按名字猜关系；退款率汇总分子分母，不平均百分比。
- 输出数据：产品贡献、规格差异、待验证问题。
- 页面展示：P1 产品分析页；P0 SKU 页仅基础产品聚合。
- AI 是否参与：P1 可总结差异。
- 是否需要 LLM：基础聚合不需要。
- 是否需要规则引擎：需要，聚合及样本限制。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：P1 随事实刷新。
- P0 / P1 / P2：P1 独立模块。

## 5.7 竞品分析

- 模块名称：竞品分析。
- 用户：Owner、Admin、Operator。
- 业务目标：追踪可验证的竞品变化。
- 输入数据：人工/授权来源的竞品快照、URL、抓取时间和字段许可。
- 处理逻辑：同商品快照差异检测，区分促销/规格/来源变化；无证据不估销量。
- 输出数据：价格/内容变化、原始来源和复核提示。
- 页面展示：P2 竞品页和详情抽屉。
- AI 是否参与：归纳变化，不能伪造来源。
- 是否需要 LLM：摘要需要，差异检测不需要。
- 是否需要规则引擎：需要，字段变化与去重。
- 是否需要 RAG：不需要，有限快照直供。
- 是否需要 Agent：默认不需要，授权 Connector Workflow 足够。
- 是否需要定时任务：需要，按来源许可与频率执行。
- P0 / P1 / P2：P2。

## 5.8 卖点分析

- 模块名称：卖点分析。
- 用户：Owner、Admin、Operator。
- 业务目标：从商品事实和反馈提炼可核实卖点。
- 输入数据：已审核商品事实、规格、VOC、适用场景。
- 处理逻辑：将事实、顾客关注点、待验证表达分开，输出逐条引用。
- 输出数据：卖点草稿、事实依据、不支持的主张提示。
- 页面展示：P1 卖点页的事实卡与草稿编辑器。
- AI 是否参与：是，归纳与表达。
- 是否需要 LLM：需要。
- 是否需要规则引擎：需要，必填事实和禁用无依据数字校验。
- 是否需要 RAG：资料量大时需要受控产品知识检索。
- 是否需要 Agent：不需要。
- 是否需要定时任务：不需要，用户按需生成。
- P0 / P1 / P2：P1。

## 5.9 内容生成

- 模块名称：内容生成。
- 用户：Owner、Admin、Operator。
- 业务目标：生成可人工修改的商品内容草稿。
- 输入数据：已批准卖点、商品事实、渠道和内容格式。
- 处理逻辑：模板化生成、结构校验和事实引用；不自动发布。
- 输出数据：标题/卖点/详情文案草稿及引用。
- 页面展示：P1 内容编辑页，标记待审核。
- AI 是否参与：是。
- 是否需要 LLM：需要。
- 是否需要规则引擎：需要，长度、必填项和事实约束。
- 是否需要 RAG：复用 P1 商品知识库检索。
- 是否需要 Agent：不需要。
- 是否需要定时任务：不需要，按需任务。
- P0 / P1 / P2：P1 草稿；自动发布 P2。

## 5.10 FAQ 分析

- 模块名称：FAQ 分析。
- 用户：四角色。
- 业务目标：找出频繁重复的客户问题。
- 输入数据：脱敏 CustomerMessage、时间、关联 SKU。
- 处理逻辑：去重后按有限标签分类并聚合近似问法，保留原样本和未分类项。
- 输出数据：问题组、消息数、趋势、脱敏证据和人工标签。
- 页面展示：客服中心 FAQ Tab、首页高频问题。
- AI 是否参与：是，分类和问题归纳。
- 是否需要 LLM：需要，失败样本保持待分类。
- 是否需要规则引擎：需要，去重、频次及样本下限。
- 是否需要 RAG：不需要，P0 不生成知识库答案。
- 是否需要 Agent：不需要。
- 是否需要定时任务：需要，导入后批处理；汇总复用每日任务。
- P0 / P1 / P2：P0。

## 5.11 回复建议

- 模块名称：回复建议。
- 用户：Admin、Operator、CustomerService。
- 业务目标：依据企业政策准备可审核的回复。
- 输入数据：脱敏客户问题、已审核 FAQ、售后规则、商品知识。
- 处理逻辑：权限内检索、引用生成；无政策依据时建议人工确认，不自创承诺。
- 输出数据：回复草稿、引用、缺失信息提示。
- 页面展示：P1 回复建议页，编辑/复制按钮。
- AI 是否参与：是。
- 是否需要 LLM：需要。
- 是否需要规则引擎：需要，敏感信息和承诺约束。
- 是否需要 RAG：需要，只检索有效审核版本。
- 是否需要 Agent：不需要，检索生成 Workflow。
- 是否需要定时任务：不需要，按需生成。
- P0 / P1 / P2：P1；自动发送 P2。

## 5.12 售后分类

- 模块名称：售后分类。
- 用户：四角色，CustomerService 无退款金额。
- 业务目标：发现售后原因和投诉集中变化。
- 输入数据：AfterSaleRecord（case）、RefundEvent（refund）、关联订单行、脱敏原因文字、覆盖。
- 处理逻辑：按标准原因码映射并确定性聚合；不明确原因为unknown，用户更正来源映射后重导。LLM仅解释聚合和已知样本，金额/成功状态保持来源事实。
- 输出数据：原因计数、趋势、样本、未知原因数及关联 VOC。
- 页面展示：客服售后 Tab、首页、SKU 详情。
- AI 是否参与：是，仅解释已知原因与样本的摘要。
- 是否需要 LLM：原因映射和计数不需要；可复用统一洞察摘要。
- 是否需要规则引擎：需要，事件去重、类型映射与统计。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：需要，导入后处理。
- P0 / P1 / P2：P0，不含售后审批执行。

## 5.13 VOC 分析

- 模块名称：VOC 分析。
- 用户：四角色。
- 业务目标：把分散反馈归纳成可追溯的主题。
- 输入数据：脱敏客户消息、售后原因、SKU 关联及覆盖。
- 处理逻辑：有限分类/情感标签、主题聚合，频率与异常由规则计算；人工标签优先并保留审计。
- 输出数据：主题/情感、数量/趋势、关键词、证据、分类状态。
- 页面展示：VOC Tab、首页、SKU 详情。
- AI 是否参与：是。
- 是否需要 LLM：需要；禁止把文本指令当系统指令。
- 是否需要规则引擎：需要，样本/频次/变化判断。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：需要，导入批次处理和每日聚合。
- P0 / P1 / P2：P0，VOC 周报 P1。

## 5.14 今日重点

- 模块名称：今日重点。
- 用户：四角色，按证据权限各自展示。
- 业务目标：明确当天先复核的至多三件事。
- 输入数据：已授权的当前 Alert/VOC/Metric 证据及合格建议。
- 处理逻辑：规则排序后选前三项，LLM 用短句解释；无足够证据允许少于三项或空列表。
- 输出数据：重点卡、证据、动作与本人状态。
- 页面展示：首页与 AI 工作台 focus Tab。
- AI 是否参与：是。
- 是否需要 LLM：需要，复用建议结果不二次生成。
- 是否需要规则引擎：需要，确定优先级和候选集。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：复用日报任务。
- P0 / P1 / P2：P0，同一 AIInsight 视图。

## 5.15 经营诊断

- 模块名称：经营诊断。
- 用户：四角色，仅各自可见业务范围。
- 业务目标：解释值得核查的关联现象和假设。
- 输入数据：异常、关联指标、VOC 样本和覆盖。
- 处理逻辑：先列事实再列可能原因与验证办法；不得把相关性写成因果。
- 输出数据：问题、证据、可能原因、验证动作。
- 页面展示：AI 工作台 diagnosis Tab 和建议详情。
- AI 是否参与：是。
- 是否需要 LLM：需要，复用结构化建议字段。
- 是否需要规则引擎：需要，事实候选与证据完整度。
- 是否需要 RAG：不需要，结构化证据直供。
- 是否需要 Agent：不需要。
- 是否需要定时任务：复用日报/导入分析任务。
- P0 / P1 / P2：P0 有限解释，不做自动根因分析系统。

## 5.16 问题发现

- 模块名称：问题发现。
- 用户：四角色，按权限过滤。
- 业务目标：汇集规则发现与反馈主题变化。
- 输入数据：当前 Alert、VOC 趋势、DataCoverage。
- 处理逻辑：规则事实先展示，按对象关联已验证 AI 输出；数据缺失另列，不把未知当正常。
- 输出数据：分类问题清单、来源、是否有建议。
- 页面展示：AI 工作台 issues Tab，与异常页互链。
- AI 是否参与：可参与解释，不发现任意未有依据的“问题”。
- 是否需要 LLM：清单不需要，解读复用已有结果。
- 是否需要规则引擎：需要。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：复用异常和 VOC 任务。
- P0 / P1 / P2：P0。

## 5.17 AI 建议

- 模块名称：AI 建议。
- 用户：四角色，按证据范围生成与展示。
- 业务目标：给出可执行、可检查的人工动作。
- 输入数据：授权证据白名单、异常等级、业务背景配置。
- 处理逻辑：固定 Prompt→JSON→Ajv 校验→引用/数值/权限复核→持久化；失败不影响业务数据。
- 输出数据：PART 9 合格 AIInsight、生成状态与服务端版本外壳。
- 页面展示：actions Tab、详情及相关业务卡片。
- AI 是否参与：是。
- 是否需要 LLM：需要。
- 是否需要规则引擎：需要，引用、范围、优先级和证据完整度校验。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要，无外部写操作。
- 是否需要定时任务：需要，复用每日/快照分析任务；允许幂等重试。
- P0 / P1 / P2：P0，仅记录本人处理状态。

## 5.18 行动优先级

- 模块名称：行动优先级。
- 用户：四角色，按自身可见建议排序。
- 业务目标：解释为什么先处理这条建议。
- 输入数据：规则 severity、可比变化/影响范围、证据完整度、建议状态。
- 处理逻辑：使用 PART 7/9 固定映射及稳定排序；未定义影响值不伪造损失金额；低证据优先建议补数核查。
- 输出数据：priority、排序依据、建议观察时间窗。
- 页面展示：priority Tab、首页前三项。
- AI 是否参与：可解释排序，不独立计算风险等级。
- 是否需要 LLM：排序不需要。
- 是否需要规则引擎：需要。
- 是否需要 RAG：不需要。
- 是否需要 Agent：不需要。
- 是否需要定时任务：复用建议生成任务，状态变化后即时刷新视图。
- P0 / P1 / P2：P0，不做自定义打分器或多人排期。


# PART 18｜页面路由

本表业务 API 均省略统一前缀 `/api/v1`，Better Auth 原生路由使用完整 `/api/auth/*`；以 PART 17 为实施契约。所有数据路由要求 session 和服务端组织/店铺校验。业务查询统一携带 `store_id/from/to`；AI/历史数据同时核验快照版本。表中的 P1/P2 API 只是能力接口预留，不在 P0 创建 handler。

| 路由 | 阶段/页面目标 | 核心组件 | API |
|---|---|---|---|
| `/login` | P0 登录 | 登录表单、会话错误 | Better Auth `/api/auth/*` |
| `/invite/[token]` | P0 接受有效邀请 | 邀请说明、设密/登录、确认 | GET `/invitations/{token}`；POST `/invitations/{token}/accept`；`/api/auth/*` |
| `/dashboard` | P0 单店晨报 | 六指标、AI 结论、异常、SKU、VOC、行动 | GET `/dashboard`；PATCH `/ai-insights/{id}/actions/{action_id}` |
| `/data/reports` | P0 日报列表 | 日期、状态、版本列表 | GET `/reports`；POST `/reports/generate` |
| `/data/reports/[reportId]` | P0 历史日报 | 快照、摘要、证据 | GET `/reports/{id}` |
| `/data/metrics` | P0 指标趋势 | 卡片、趋势、口径/覆盖 | GET `/metrics` |
| `/alerts` | P0 异常复核 | 分类、等级、基准、证据抽屉 | GET `/alerts`（含详情所需完整证据） |
| `/data/roi` | P1 成本收益 | 成本完整度、ROI 拆分 | 预留 GET `/profitability` |
| `/products/skus` | P0 SKU/产品聚合对照 | SKU 表、榜单、产品分组 | GET `/skus` |
| `/products/skus/[skuId]` | P0 SKU 诊断 | 身份、趋势、退款、VOC、建议 | GET `/skus/{id}`；GET `/voc`；GET `/ai-insights` |
| `/products/analysis` | P1 产品组合 | 产品贡献、规格对照 | 预留 GET `/product-analysis` |
| `/products/competitors` | P2 竞品变化 | 快照表、差异详情 | 预留 GET/POST `/competitors` |
| `/products/selling-points` | P1 有依据卖点 | 事实卡、草稿 | 预留 POST `/selling-points/generate` |
| `/products/content` | P1 内容草稿 | 模板、编辑、事实引用 | 预留 POST `/content/generate` |
| `/customer-service?tab=faq` | P0 高频问题 | 聚类/趋势/证据 | GET `/voc?tab=faq`；GET `/customer-messages`；PATCH `/customer-messages/{id}/classification` |
| `/customer-service?tab=voc` | P0 客户主题 | 主题/负面词/未分类/样本 | GET `/voc?tab=voc`；GET `/customer-messages`；PATCH `/customer-messages/{id}/classification` |
| `/customer-service?tab=after-sales` | P0 售后原因 | 类型、计数、脱敏证据 | GET `/voc?tab=after-sales`；GET `/after-sales` |
| `/customer-service/replies` | P1 回复草稿 | 问题、检索引用、编辑 | 预留 POST `/replies/generate` |
| `/customer-service/knowledge` | P1 审核企业知识 | 文档、版本、有效状态 | 预留 GET/POST `/knowledge` |
| `/ai-insights?tab=focus` | P0 今日重点 | 最多三条建议 | GET `/ai-insights`（按同一已授权结果呈现 focus 视图） |
| `/ai-insights?tab=diagnosis` | P0 原因假设 | 事实/假设/验证方法 | GET `/ai-insights`（按同一已授权结果呈现 diagnosis 视图） |
| `/ai-insights?tab=issues` | P0 问题发现 | 规则/VOC 来源与建议 | GET `/alerts`；GET `/ai-insights`（按同一已授权结果呈现 issues 视图） |
| `/ai-insights?tab=actions` | P0 本人行动 | 建议及状态筛选 | GET `/ai-insights`（按同一已授权结果呈现 actions 视图）；PATCH `/ai-insights/{id}/actions/{action_id}` |
| `/ai-insights?tab=priority` | P0 行动排序 | 紧急度与排序说明 | GET `/ai-insights`（按同一已授权结果呈现 priority 视图） |
| `/ai-insights/[insightId]` | P0 建议详情 | schema 字段、证据、处理记录 | GET `/ai-insights/{id}`；PATCH `/ai-insights/{id}/actions/{action_id}` |
| `/import` | P0 上传及历史 | CSV 类型、模板、任务表 | GET/POST `/imports`；GET `/import-templates/{entity_type}` |
| `/import/[importId]` | P0 映射/预览/确认 | 校验表、覆盖声明、错误下载 | GET `/imports/{id}`；PUT `/imports/{id}/mapping`；GET `/imports/{id}/preview`；POST `/imports/{id}/commit`；POST `/imports/{id}/retry`；GET `/imports/{id}/error-file` |
| `/settings?tab=organization` | P0 组织基础信息 | 名称表单 | GET/PATCH `/organization` |
| `/settings?tab=stores` | P0 店铺基础设置 | 币种/时区/名称 | GET/POST `/stores`；PATCH `/stores/{id}` |
| `/settings?tab=data-sources` | P0 来源与覆盖 | 来源卡、覆盖日历 | GET/POST `/data-sources`（含覆盖摘要） |
| `/settings?tab=ai` | P0 日报/规则配置 | 固定 08:00 说明、额度、阈值、健康 | GET/PATCH `/settings/ai`；GET `/alert-rules`；PATCH `/alert-rules/{rule_id}` |
| `/settings?tab=members` | P0 邀请/固定角色 | 成员表、邀请链接 | GET `/members`；POST `/invitations`；PATCH `/members/{id}`；DELETE `/invitations/{id}` |
| `/settings?tab=permissions` | P0 固定权限说明 | 只读角色矩阵 | GET `/me` |
| `/settings/access` | P1 自定义/店铺授权 | 授权编辑、审计 | 预留 GET/PATCH `/access-policies` |
| `/settings/automation` | P2 审批外部执行 | 待审计划、限额、执行记录 | 预留 GET `/automations`；POST `/automations/{id}/approve` |

规范化入口：`/` 按登录态和角色跳转；`/data`→`/data/metrics`，`/products`→`/products/skus`，`/voc`→`/customer-service?tab=voc`；`/customer-service` 默认 VOC，`/ai-insights` 默认 focus，`/settings` 默认 organization。重定向保留合法店铺/日期筛选并重新鉴权。CustomerService 登录落在客服中心；进入 Dashboard/Reports/SKU 页直接拒绝或跳转到无敏感信息的无权限页，不能短暂渲染财务内容。404、403、全局错误与加载界面用框架边界实现，不新增业务路由。
