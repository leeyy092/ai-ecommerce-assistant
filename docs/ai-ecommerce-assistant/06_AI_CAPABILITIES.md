# AI能力、输出标准与成本

版本：v1.0 · 2026-09-11。状态：产品与工程规格；应用尚未开发。P0为本次定义的开发范围，P1/P2只作规划。

# PART 8｜AI 能力设计

## 8.1 能力边界与技术选择

P0 的指标、异常、事实计数和权限均由服务端确定。LLM 负责把已计算且可追溯的事实解释成短摘要、可能原因和可执行建议；AI 不成为事实数据库，也不直接修改业务记录或操作外部平台。模型使用百炼北京地域 `qwen-flash` 系列，部署配置固定到经验证的快照 `qwen-flash-2025-07-28`，非思考模式、`json_object` 输出；开工时验证模型可调用，后续升级必须重新跑评测。模型切换只允许通过已有 Adapter 配置并完成回归，不由 Coding Agent 临时选择供应商。

| 功能 | 阶段 / 技术方式 | 输入 | 输出 | 为什么这样设计 | 失败时如何处理 |
|---|---|---|---|---|---|
| 指标计算 | P0 / Decimal + 确定性聚合 | 已提交事实、覆盖记录、店铺时区、指标版本 | DailyMetric 快照和缺失原因 | 同一份数据必须有同一个答案 | 保留上一完整快照并标记更新失败；不发布半成品 |
| 异常与等级 | P0 / 版本化规则 | 同版指标、基线、覆盖、最小样本 | Alert、规则命中依据和固定建议 | 阈值与原因可检查，不交给 LLM 打分 | 单条规则错误记失败，不把未计算写为零异常；必需规则全部完成后发布快照 |
| 经营日报摘要 | P0 / LLM | 授权后的指标、Alert、VOC 证据包 | 整体状态、最大问题、候选机会、优先行动的短摘要 | 减少人工阅读；每个判断能回到证据 | 展示规则摘要、数据卡片与“AI 暂未生成”，不得把模板标为 AI |
| 问题诊断与今日建议 | P0 / LLM + 服务端约束 | 规则发现、证据 ID、可用 SKU 和指标 ID | 结构化问题、假设、动作、优先级 | 允许解释不确定性，不把相关性说成因果 | 无效建议拒收；原规则异常仍可处理 |
| VOC 单条分类 | P0 / LLM 批分类 + 人工修正 | 脱敏消息 ID、截断后的文本、固定标签字典 | 每条消息的标签、是否负面、原文片段位置；可为 unknown | 精确计数必须由逐条标签聚合而来 | 失败项保留 unknown，可人工分类；不得用成功部分推算全量 |
| VOC / FAQ 汇总 | P0 / SQL 计数 + LLM 摘要 | 标签记录、总量、已分类量、人工修正、脱敏样例 | 主题排行、已分类样本占比、摘要和样例引用 | “高频”要有计数分母；文字摘要不决定频数 | 数量与样例继续显示，AI 摘要单独失败 |
| 新增负面关键词 | P0 / 规则提取 + 人工确认 | 两个可比较期间已分类负面文本 | 新出现词项及包含该词的去重消息数 | 新词只作为查看入口，不能自动认定新的投诉问题 | 无可比历史标“暂无基线”，不标暴增 |
| 售后原因分析 | P0 / 标准原因映射、SQL计数、统一洞察摘要 | 售后case标准原因及脱敏描述 | 原因计数、未知原因、样本、结构化摘要 | 未知原因由用户更正来源映射后重导；不扩展第二套逐条分类协议，refund不冒充case | 保留确定性计数，缺失项unknown；AI摘要可单独失败 |
| 企业 FAQ、售后规则、产品知识、运营 SOP 检索 | P1 / RAG | 经授权文档、有效期、来源版本、问题 | 带文档片段引用的回答草稿 | 需要企业事实检索的回答才引入 RAG | 无依据则不回答企业政策，提示补充知识 |
| 客服回复建议 | P1 / RAG + LLM | 单条客户问题、授权产品与售后知识 | 回复草稿、引用、待确认信息 | 先确保政策正确；P0 不进入对话发送流程 | 人工处理，不自动承诺退款、不自动发送 |
| 卖点分析与内容生成 | P1 / LLM，必要时检索商品资料 | 已证实规格、VOC、目标渠道限制 | 待审核卖点与文案 | 不能从投诉的反面编造性能或卖点 | 保留原资料，无证据的主张不生成 |
| 竞品变化摘要 | P2 / Connector + 规则差异 + LLM | 合法取得的竞品快照及时间戳 | 变化事实与推测分列 | 必须先有持续数据源；第一版未接入 | 无新采样显示“未更新”，不伪造监控 |
| 自动执行运营任务 | P2 / 有限 Agent + 审批 Workflow | 明确目标、工具白名单、预算、授权 | 执行预览、审批和审计 | 只有需要多步工具选择且可回滚的场景才考虑 Agent | 中止执行、保留状态、交给人工；P0 无执行工具 |
| 导入后分析 | P0 / 普通 Workflow | 已提交 ImportTask 与 Outbox 事件 | 同版指标、异常、VOC、AI 生成任务 | 依赖明确，不需要 Agent 规划 | 按步骤重试，业务幂等，已完成步骤可复用 |
| 每日晨报 | P0 / pg-boss 定时任务 | 店铺时区、昨日范围、当前完整快照 | 日报记录或缺数据状态 | 明确自然日边界，可重复执行 | 缺覆盖先显示缺源；暂时失败按限定策略重试 |
| 每日异常检测 | P0 / pg-boss + 规则服务 | 当前完整快照与尚未处理期间 | 新版规则结果 | 定时与导入事件共用同一规则入口 | 不重复告警；记录任务失败和上次成功时间 |
| 每周 VOC 周报 | P1 / 定时聚合 + LLM | 完整周覆盖和逐条标签 | 周变化与样例 | 不把日粒度 P0 扩成报表系统 | 按真实覆盖显示缺口；P0 仅保留任务类型接口 |

P0 不使用 Embedding、向量数据库、Agent 框架或任意工具调用。真实数据、Mock 数据都先经过统一 Adapter 写入同一领域模型，Mock 组织和页面明显标记“演示数据”，不把模拟结果当客户试用证据。

## 8.2 生成流程、证据和降级

1. 人工请求由服务端从 session 确认组织、actor 和固定角色，选定一个店铺、一个已发布的 `current_snapshot_version` 和 `[from,to)` 期间。每日 system 任务从持久化 Store / Organization 及启用配置取得系统处理范围，不要求浏览器 session；固定为 business scope，只能读写任务绑定的本组织本店。人工请求入队后 worker 重新检查 actor 当前权限；system 任务校验组织/店铺有效及配置启用。所有结果被用户读取时仍从 session 鉴权，客服不能读取 system 经营结果。若最新有效数据 `dataset_version` 更高，返回 `updating=true`；整页继续读取上一完整快照。
2. EvidenceBuilder 读取同版本 Metric / Alert / VOC 及来源关系。经营范围与 `customer_service` 范围分别构建白名单；客服包只含脱敏消息、客服标签、允许的售后问题计数及其样例，不含金额、GMV、ROAS、销量、退款金额或经营推断。
3. 先检查数据覆盖、样本和规则结果。无有效证据则 `skipped`；无异常时仍可总结已证实的平稳事实，但不可强造“最大问题”或“最大机会”。最大机会可以明确为“现有数据不足以确认机会”。
4. 证据包传模型前再脱敏和限长。建议默认每次最多 30 条证据、10 个重点 SKU、20 条短样例，每条文本最多 500 字，合计输入文本最多 12,000 字；这些是产品预算上限，开工用实际 tokenizer 和模型限制复核。模型请求额外设输入最多 16,000 tokens、输出最多 6,000 tokens；按实际 tokenizer 预检，字数和 token 上限取先达到者。超限按确定性的严重等级、样本量和新近程度选择，保留 omitted_count，并在完整性说明中体现。
5. 模型仅返回 `llmPayload`。服务端先做 JSON 解析及 Ajv Schema 校验，再做引用、数值、范围、因果措辞和权限语义校验。仅语法正确不构成验收通过。
6. 通过后由服务端补入真实租户、快照、证据、生成时间、证据充分性、状态及审计信息，保存为不可变内容版本。前端从结构化字段渲染，不显示模型原始响应。
7. 业务去重键建议为 `(org_id,store_id,period,visibility_scope,current_snapshot_version,ruleset_version,prompt_version,model_id,generation_kind)`。调度重投不会重复生成；仅失败/跳过结果在用户显式retry_failed=true时允许建立新attempt_revision，保留旧运行记录；同版本已有成功结果直接复用。LLM 输出、action_id 和旧行动状态不能互相自动覆盖。

队列最多并行 2 个 LLM 请求，单组织同时 1 个；默认单次超时 30 秒，总尝试不超过 3 次，只有超时、限流或供应商 5xx 使用退避和 jitter（建议 5 秒、20 秒，尊重 Retry-After）。同一生成任务跨恢复过程共用计数，不能每次 worker 重启清零。格式错误最多一次修复请求且计入总尝试上限；将校验错误码和原证据包交回模型，不把任意原始响应作为系统指令。鉴权失败、未知模型、权限错误立即停止并提示管理员处理。所有这些数值是首版建议默认，须在配置表和测试中保持唯一。

AI 与确定性页面独立加载：LLM 失败时 Dashboard、SKU、VOC 计数、Alerts、导入历史仍可使用。可用的上一版 AI 显示“基于旧数据生成”及数据日期，不能伪装成当前结论。新完整快照发布时旧 AI 标 `stale=true`，旧内容保留；最新有效数据尚未发布只标更新中。规则实现或配置变更产生新的服务端 `ruleset_version`，旧 AI 也标 stale；新规则结果未完整发布时不生成冒充当前的 AI。`stale` 在读取时同时比较当前发布的数据版本与当前生效 ruleset_version，不能信任历史存储的布尔值。

## 8.3 VOC 的可核验分类

标签字典 P0 固定为 product_quality、size_fit、logistics、usage_question、refund_process、service_experience、price_promotion、other、unknown，并另存 `sentiment=negative|neutral|positive|unknown`。一个消息只取一个主标签，最多两个辅助标签；主标签数量可相加，辅助标签计数不可相加当总量。客服用户可人工修正最终标签，保留原模型标签、修正前后、操作者、时间和理由；聚合按最终标签重新计算。

每条分类结果至少保存 `message_id、source_revision、taxonomy_version、label、secondary_labels、sentiment、evidence_spans、classification_source、model_id、prompt_version、review_status`。`evidence_spans` 为脱敏规范化文本中的 `[start,end)` 位置和对应短句，服务端检查确实是原文子串；没有支持片段就 unknown，不允许编造引语。模型结果不能传入组织字段；message_id 必须属于本次批次和授权范围，批次中的每个 ID 恰好出现一次。重复 ID、缺失 ID、越界位置或未知标签按整批结构失败处理；重试后仍失败，该批逐条记录 unknown 和错误原因，不丢消息。

每批最多 20 条、每条最多 500 字，并受 12,000 字总输入预算约束；按稳定 ID 分批。消息导入 100,000 行不意味着必须即时完成 100,000 次分类：先发布未分类消息与计数，标“分类处理中 n/N”，建议每组织每日最多自动分类 2,000 条待处理消息，剩余等待下一配额或管理员明确增加预算。仅按有效模型或人工情感标签聚合；投诉标记不自动转成负面，不能把未分类当中性。跨日处理保留已完成进度，不能每天只扫描前 2,000 条。覆盖不足时显示“负面消息23/情感已知120，总导入500”，另显示已完成分类数、classification_coverage与sentiment_coverage。unknown不进入情感已知分母，即使其分类任务已完成；不得只写“负面率19.2%”而隐藏未识别情感的样本。

P0负面关键词采用版本化固定词表voc-keywords-v1，与标签规则一起存放：漏水/leak、破损/broken、尺寸不符/wrong size、色差/color mismatch、发错货/wrong item、少件/missing item、延迟发货/shipping delay、退款未到账/refund not received、态度差/rude。匹配脱敏文本采用NFKC、英文小写和词边界（中文子串），每个关键词每条负面消息最多计1次。比较所选完整期间与等长前期，双方sentiment_coverage≥80%且情感已知消息≥30；当前词项≥3条且前期为0才标“新增”，否则显示“本期关键词”或“暂无符合条件的新增词”。这是固定词表中的新增出现，不宣称开放发现全部新词；P0不另增分词/关键词模型，用户确认只表示查看证据，不产生第二套人工标签表。

AI 可建议合并相近主题，但 P0 展示精确频数只来自可回溯的逐条主标签。自由文本“大家都在抱怨尺码”只能作为待核验摘要，不能产生 37 次之类精确数字。统一 `dataset_version` 在成功导入，以及有效 VOC 标签提交变化时递增：每批 accepted 分类或人工修正事务只递增一次，并写 Outbox 触发完整快照重算与发布；ImportTask 保留当次原始导入版本。原始消息和历史结论不改写。分类结果缓存按 (message_id,source_revision,taxonomy_version,model_id,prompt_version) 去重；相同有效标签不递增版本，人工最终标签不被重跑覆盖，防止“分类触发重算又触发相同分类”的循环。新发布快照使相关旧 AI 失效。


# PART 9｜AI 输出标准

## 9.1 字段归属和校验真源

一个最终 `AIInsight` 使用 `envelope + payload`：用户要求的 `title、category、severity、summary、possible_causes、recommended_actions、priority、related_skus、related_metrics` 位于 `payload`；`evidence、confidence、generated_at` 位于服务端 envelope。接口与页面均保持这个结构，不另造扁平字段副本。`ruleset_version` 是服务端对规则实现版本与有效配置生成的稳定版本标识，规则或配置变化必须更新，用于 AI 失效和缓存区分。`status` 是洞察记录 active/archived；行动状态由服务端 `action_states[].status` 表示 pending/accepted/done/dismissed；生成状态由 `generation_status` 表示 succeeded/failed/skipped，排队和运行中由独立任务响应表示。

下面是一份完整 JSON Schema Draft 2020-12。Ajv 2020 + format 校验为唯一 AI Schema 真源；表单可以用 Zod，但不能再维护一份手写 AI 输出结构。构建时从 Schema 生成 TypeScript 类型。校验 LLM 原始输出时编译该 Schema 的 `#/$defs/llmPayload`；校验最终 API 对象时编译根节点。`format` 必须启用 UUID、date 和 date-time 验证，不能只当注释。

LLM 不得生成 `org_id、store_id、dataset_version、ruleset_version、visibility_scope、confidence、evidence` 的事实值、权限或状态；这些值由服务端以数据库查询和固定规则组装。模型可以引用证据 ID、SKU ID、指标 ID，但服务端必须逐个验证来自本次白名单。事实数值只从 `evidence` 渲染，正文数字必须能映射到同一证据；不允许凭空生成利润率、预计增收或客户原话。

证据使用统一指标契约：`status=available|unavailable`、`coverage_status=complete|partial|missing`、`maturity=mature|provisional|not_applicable`、`unavailable_reason` 可空。coverage_status 放在 evidence 层，metricEvidence 复用这一覆盖状态，不再重复定义。available 对应有效 value 且 unavailable_reason=null；unavailable 对应 value=null 且 unavailable_reason 说明不可用原因；provisional 不得作为成熟 D+7 队列异常证据。上述关联必须通过语义校验。

EvidenceSnapshot 的度量值（value、numerator、denominator）统一为十进制字符串或 null，全部由业务 MetricValue 无损序列化，禁止另一套计算或让 LLM 重算；业务 API 中 count/ratio 仍是数字，money 仍是十进制字符串。sample_size、VOC 消息计数等结构化数量仍保留安全整数类型；版本号、偏移量等控制字段也保持整数。

`expected_impact` 表示定性预期、衡量指标和观察天数；`estimated_impact` 是服务端保留的量化区间。P0 没有可验证的因果估计，所有 `estimated_impact` 必须为 null，UI 显示“待行动后观察”，不能把它填成销售提升承诺。Schema 定义区间结构是为了完整表达 null 与有证据估算的区别，启用非空值属于后续明确批准的范围，并需记录估算方法、假设、单位与支持证据。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.ai-ecommerce-assistant.example/ai-insight-v1.schema.json",
  "title": "AIInsight v1",
  "description": "Root validates the server assembled response; $defs.llmPayload validates model output.",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "const": "1.0"
    },
    "insight_id": {
      "type": "string",
      "format": "uuid"
    },
    "org_id": {
      "type": "string",
      "format": "uuid"
    },
    "store_id": {
      "type": "string",
      "format": "uuid"
    },
    "dataset_version": {
      "type": "integer",
      "minimum": 1
    },
    "metric_version": {
      "const": "v1"
    },
    "period": {
      "$ref": "#/$defs/period"
    },
    "stale": {
      "type": "boolean"
    },
    "updating": {
      "type": "boolean"
    },
    "visibility_scope": {
      "type": "string",
      "enum": [
        "business",
        "customer_service"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "active",
        "archived"
      ]
    },
    "generation_status": {
      "type": "string",
      "enum": [
        "succeeded",
        "failed",
        "skipped"
      ]
    },
    "generated_at": {
      "anyOf": [
        {
          "type": "string",
          "format": "date-time"
        },
        {
          "type": "null"
        }
      ]
    },
    "evidence": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/evidence"
      },
      "minItems": 0,
      "maxItems": 30
    },
    "confidence": {
      "$ref": "#/$defs/confidence"
    },
    "payload": {
      "anyOf": [
        {
          "$ref": "#/$defs/llmPayload"
        },
        {
          "type": "null"
        }
      ]
    },
    "action_states": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/actionState"
      },
      "minItems": 0,
      "maxItems": 5
    },
    "error": {
      "anyOf": [
        {
          "$ref": "#/$defs/error"
        },
        {
          "type": "null"
        }
      ]
    },
    "ruleset_version": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80
    }
  },
  "required": [
    "schema_version",
    "insight_id",
    "org_id",
    "store_id",
    "dataset_version",
    "metric_version",
    "period",
    "stale",
    "updating",
    "visibility_scope",
    "status",
    "generation_status",
    "generated_at",
    "evidence",
    "confidence",
    "payload",
    "action_states",
    "error",
    "ruleset_version"
  ],
  "$defs": {
    "period": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "from": {
          "type": "string",
          "format": "date"
        },
        "to": {
          "type": "string",
          "format": "date"
        },
        "timezone": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        }
      },
      "required": [
        "from",
        "to",
        "timezone"
      ]
    },
    "sourceRef": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "source_kind": {
          "type": "string",
          "enum": [
            "daily_metric",
            "alert",
            "voc_insight",
            "customer_message",
            "after_sale_record"
          ]
        },
        "record_id": {
          "type": "string",
          "format": "uuid"
        },
        "import_task_id": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "source_kind",
        "record_id",
        "import_task_id"
      ]
    },
    "metricEvidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "metric_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "value": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",
              "maxLength": 22
            },
            {
              "type": "null"
            }
          ]
        },
        "unit": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "currency": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^[A-Z]{3}$"
            },
            {
              "type": "null"
            }
          ]
        },
        "numerator": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",
              "maxLength": 22
            },
            {
              "type": "null"
            }
          ]
        },
        "denominator": {
          "anyOf": [
            {
              "type": "string",
              "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",
              "maxLength": 22
            },
            {
              "type": "null"
            }
          ]
        },
        "sample_size": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "status": {
          "type": "string",
          "enum": [
            "available",
            "unavailable"
          ]
        },
        "maturity": {
          "type": "string",
          "enum": [
            "mature",
            "provisional",
            "not_applicable"
          ]
        },
        "unavailable_reason": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "metric_id",
        "value",
        "unit",
        "currency",
        "numerator",
        "denominator",
        "sample_size",
        "status",
        "maturity",
        "unavailable_reason"
      ]
    },
    "vocEvidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "topic": {
          "type": "string",
          "enum": [
            "product_quality",
            "size_fit",
            "logistics",
            "usage_question",
            "refund_process",
            "service_experience",
            "price_promotion",
            "other",
            "unknown"
          ]
        },
        "message_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "classified_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "imported_count": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "count_scope": {
          "const": "classified_primary_label"
        },
        "sample_message_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid"
          },
          "minItems": 0,
          "maxItems": 20,
          "uniqueItems": true
        },
        "redacted_samples": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 500
          },
          "minItems": 0,
          "maxItems": 20
        }
      },
      "required": [
        "topic",
        "message_count",
        "classified_count",
        "imported_count",
        "count_scope",
        "sample_message_ids",
        "redacted_samples"
      ]
    },
    "alertEvidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "alert_id": {
          "type": "string",
          "format": "uuid"
        },
        "rule_id": {
          "type": "string",
          "pattern": "^R[0-9]{2,3}$"
        },
        "rule_version": {
          "type": "integer",
          "minimum": 1
        },
        "severity": {
          "type": "string",
          "enum": [
            "info",
            "warning",
            "critical"
          ]
        },
        "supporting_evidence_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 30,
          "uniqueItems": true
        }
      },
      "required": [
        "alert_id",
        "rule_id",
        "rule_version",
        "severity",
        "supporting_evidence_ids"
      ]
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "evidence_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "kind": {
          "type": "string",
          "enum": [
            "metric",
            "voc",
            "alert"
          ]
        },
        "date": {
          "type": "string",
          "format": "date"
        },
        "period": {
          "$ref": "#/$defs/period"
        },
        "dataset_version": {
          "type": "integer",
          "minimum": 1
        },
        "metric_version": {
          "const": "v1"
        },
        "source_refs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/sourceRef"
          },
          "minItems": 1,
          "maxItems": 30
        },
        "metric": {
          "anyOf": [
            {
              "$ref": "#/$defs/metricEvidence"
            },
            {
              "type": "null"
            }
          ]
        },
        "voc": {
          "anyOf": [
            {
              "$ref": "#/$defs/vocEvidence"
            },
            {
              "type": "null"
            }
          ]
        },
        "alert": {
          "anyOf": [
            {
              "$ref": "#/$defs/alertEvidence"
            },
            {
              "type": "null"
            }
          ]
        },
        "coverage_status": {
          "type": "string",
          "enum": [
            "complete",
            "partial",
            "missing"
          ]
        }
      },
      "required": [
        "evidence_id",
        "kind",
        "date",
        "period",
        "dataset_version",
        "metric_version",
        "source_refs",
        "metric",
        "voc",
        "alert",
        "coverage_status"
      ]
    },
    "hypothesis": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "hypothesis_id": {
          "type": "string",
          "pattern": "^H[1-9][0-9]?$"
        },
        "kind": {
          "const": "hypothesis"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 30,
          "uniqueItems": true
        },
        "verification_step": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300
        }
      },
      "required": [
        "hypothesis_id",
        "kind",
        "description",
        "evidence_ids",
        "verification_step"
      ]
    },
    "expectedImpact": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "qualitative": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240
        },
        "metric_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "observation_days": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        }
      },
      "required": [
        "qualitative",
        "metric_id",
        "observation_days"
      ]
    },
    "action": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action_id": {
          "type": "string",
          "pattern": "^A[1-9][0-9]?$"
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 400
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 30,
          "uniqueItems": true
        },
        "hypothesis_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^H[1-9][0-9]?$"
          },
          "maxItems": 10,
          "uniqueItems": true
        },
        "priority": {
          "type": "string",
          "enum": [
            "P0",
            "P1",
            "P2"
          ]
        },
        "expected_impact": {
          "$ref": "#/$defs/expectedImpact"
        }
      },
      "required": [
        "action_id",
        "title",
        "description",
        "evidence_ids",
        "hypothesis_ids",
        "priority",
        "expected_impact"
      ]
    },
    "llmPayload": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "category": {
          "type": "string",
          "enum": [
            "business",
            "sku",
            "advertising",
            "customer_service",
            "after_sales",
            "data_quality"
          ]
        },
        "severity": {
          "type": "string",
          "enum": [
            "info",
            "warning",
            "critical"
          ]
        },
        "summary": {
          "type": "string",
          "minLength": 1,
          "maxLength": 600
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 30,
          "uniqueItems": true
        },
        "possible_causes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/hypothesis"
          },
          "minItems": 0,
          "maxItems": 5
        },
        "recommended_actions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/action"
          },
          "minItems": 1,
          "maxItems": 5
        },
        "priority": {
          "type": "string",
          "enum": [
            "P0",
            "P1",
            "P2"
          ]
        },
        "related_skus": {
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid"
          },
          "maxItems": 10,
          "uniqueItems": true
        },
        "related_metrics": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 20,
          "uniqueItems": true
        }
      },
      "required": [
        "title",
        "category",
        "severity",
        "summary",
        "evidence_ids",
        "possible_causes",
        "recommended_actions",
        "priority",
        "related_skus",
        "related_metrics"
      ]
    },
    "confidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "meaning": {
          "const": "evidence_completeness_not_probability"
        },
        "level": {
          "type": "string",
          "enum": [
            "sufficient",
            "limited",
            "insufficient"
          ]
        },
        "met_checks": {
          "type": "integer",
          "minimum": 0,
          "maximum": 10
        },
        "total_checks": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10
        },
        "basis_codes": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "direct_source",
              "complete_coverage",
              "adequate_sample",
              "comparable_baseline",
              "closed_references",
              "baseline_not_applicable"
            ]
          },
          "maxItems": 6,
          "uniqueItems": true
        },
        "limitations": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "minItems": 0,
          "maxItems": 10
        }
      },
      "required": [
        "meaning",
        "level",
        "met_checks",
        "total_checks",
        "basis_codes",
        "limitations"
      ]
    },
    "impactRange": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "lower": {
          "type": "string",
          "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",
          "maxLength": 22
        },
        "upper": {
          "type": "string",
          "pattern": "^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$",
          "maxLength": 22
        },
        "unit": {
          "type": "string",
          "minLength": 1,
          "maxLength": 32
        },
        "estimation_method": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240
        },
        "assumptions": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "minItems": 1,
          "maxItems": 10
        },
        "supporting_evidence_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 1,
          "maxItems": 30,
          "uniqueItems": true
        },
        "confidence_meaning": {
          "const": "evidence_completeness_not_probability"
        }
      },
      "required": [
        "lower",
        "upper",
        "unit",
        "estimation_method",
        "assumptions",
        "supporting_evidence_ids",
        "confidence_meaning"
      ]
    },
    "actionState": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action_id": {
          "type": "string",
          "pattern": "^A[1-9][0-9]?$"
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "accepted",
            "done",
            "dismissed"
          ]
        },
        "updated_at": {
          "anyOf": [
            {
              "type": "string",
              "format": "date-time"
            },
            {
              "type": "null"
            }
          ]
        },
        "version": {
          "type": "integer",
          "minimum": 0
        },
        "estimated_impact": {
          "anyOf": [
            {
              "$ref": "#/$defs/impactRange"
            },
            {
              "type": "null"
            }
          ]
        },
        "user_id": {
          "type": "string",
          "format": "uuid"
        }
      },
      "required": [
        "action_id",
        "status",
        "updated_at",
        "version",
        "estimated_impact",
        "user_id"
      ]
    },
    "error": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "code": {
          "type": "string",
          "enum": [
            "AI_TIMEOUT",
            "AI_RATE_LIMIT",
            "AI_UNAVAILABLE",
            "AI_CONFIG_ERROR",
            "AI_SCHEMA_INVALID",
            "AI_SEMANTIC_INVALID",
            "NO_ELIGIBLE_EVIDENCE",
            "BUDGET_LIMIT"
          ]
        },
        "retryable": {
          "type": "boolean"
        },
        "message": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      },
      "required": [
        "code",
        "retryable",
        "message"
      ]
    },
    "vocEvidenceSpan": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "start": {
          "type": "integer",
          "minimum": 0,
          "maximum": 499
        },
        "end": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        },
        "text": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "start",
        "end",
        "text"
      ]
    },
    "vocClassificationResult": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "message_id": {
          "type": "string",
          "format": "uuid"
        },
        "label": {
          "type": "string",
          "enum": [
            "product_quality",
            "size_fit",
            "logistics",
            "usage_question",
            "refund_process",
            "service_experience",
            "price_promotion",
            "other",
            "unknown"
          ]
        },
        "secondary_labels": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "product_quality",
              "size_fit",
              "logistics",
              "usage_question",
              "refund_process",
              "service_experience",
              "price_promotion",
              "other",
              "unknown"
            ]
          },
          "minItems": 0,
          "maxItems": 2,
          "uniqueItems": true
        },
        "sentiment": {
          "type": "string",
          "enum": [
            "negative",
            "neutral",
            "positive",
            "unknown"
          ]
        },
        "evidence_spans": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/vocEvidenceSpan"
          },
          "minItems": 0,
          "maxItems": 3
        }
      },
      "required": [
        "message_id",
        "label",
        "secondary_labels",
        "sentiment",
        "evidence_spans"
      ]
    },
    "vocBatch": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "taxonomy_version": {
          "const": "voc-v1"
        },
        "results": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/vocClassificationResult"
          },
          "minItems": 1,
          "maxItems": 20
        }
      },
      "required": [
        "taxonomy_version",
        "results"
      ]
    },
    "dailyConclusionItem": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "text": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 160
            },
            {
              "type": "null"
            }
          ]
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "minItems": 0,
          "maxItems": 10,
          "uniqueItems": true
        },
        "reason": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "no_eligible_evidence",
                "no_problem_detected",
                "no_opportunity_supported",
                "no_action_needed"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "text",
        "evidence_ids",
        "reason"
      ],
      "allOf": [
        {
          "if": {
            "properties": {
              "text": {
                "type": "null"
              }
            },
            "required": [
              "text"
            ]
          },
          "then": {
            "properties": {
              "reason": {
                "type": "string"
              },
              "evidence_ids": {
                "type": "array",
                "maxItems": 0
              }
            }
          },
          "else": {
            "properties": {
              "reason": {
                "type": "null"
              },
              "evidence_ids": {
                "type": "array",
                "minItems": 1
              }
            }
          }
        }
      ]
    },
    "dailyConclusion": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "overall_state": {
          "$ref": "#/$defs/dailyConclusionItem"
        },
        "biggest_problem": {
          "$ref": "#/$defs/dailyConclusionItem"
        },
        "biggest_opportunity": {
          "$ref": "#/$defs/dailyConclusionItem"
        },
        "top_action": {
          "$ref": "#/$defs/dailyConclusionItem"
        }
      },
      "required": [
        "overall_state",
        "biggest_problem",
        "biggest_opportunity",
        "top_action"
      ]
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "generation_status": {
            "const": "succeeded"
          }
        },
        "required": [
          "generation_status"
        ]
      },
      "then": {
        "properties": {
          "payload": {
            "$ref": "#/$defs/llmPayload"
          },
          "generated_at": {
            "type": "string",
            "format": "date-time"
          },
          "error": {
            "type": "null"
          },
          "evidence": {
            "minItems": 1,
            "type": "array"
          },
          "action_states": {
            "minItems": 1,
            "type": "array"
          }
        }
      },
      "else": {
        "properties": {
          "payload": {
            "type": "null"
          },
          "generated_at": {
            "type": "null"
          },
          "action_states": {
            "maxItems": 0,
            "type": "array"
          },
          "error": {
            "$ref": "#/$defs/error"
          }
        }
      }
    }
  ]
}
```

## 9.2 完整有效示例

下例是独立演示组织的客服范围建议。2 条售后流程询问 / 20 条已分类消息来自已分类样本，不推断全体客户；示例使用演示 UUID，不对应真实客户。

```json
{
  "schema_version": "1.0",
  "insight_id": "10000000-0000-4000-8000-000000000001",
  "org_id": "20000000-0000-4000-8000-000000000001",
  "store_id": "30000000-0000-4000-8000-000000000001",
  "dataset_version": 7,
  "metric_version": "v1",
  "period": {
    "from": "2026-09-10",
    "to": "2026-09-11",
    "timezone": "Asia/Shanghai"
  },
  "stale": false,
  "updating": false,
  "visibility_scope": "customer_service",
  "status": "active",
  "generation_status": "succeeded",
  "generated_at": "2026-09-11T00:15:00Z",
  "evidence": [
    {
      "evidence_id": "E-VOC-1",
      "kind": "voc",
      "date": "2026-09-10",
      "period": {
        "from": "2026-09-10",
        "to": "2026-09-11",
        "timezone": "Asia/Shanghai"
      },
      "dataset_version": 7,
      "metric_version": "v1",
      "source_refs": [
        {
          "source_kind": "voc_insight",
          "record_id": "40000000-0000-4000-8000-000000000001",
          "import_task_id": "50000000-0000-4000-8000-000000000001"
        }
      ],
      "metric": null,
      "voc": {
        "topic": "refund_process",
        "message_count": 2,
        "classified_count": 20,
        "imported_count": 30,
        "count_scope": "classified_primary_label",
        "sample_message_ids": [
          "60000000-0000-4000-8000-000000000001",
          "60000000-0000-4000-8000-000000000002"
        ],
        "redacted_samples": [
          "提交申请后，在哪里查看处理进度？",
          "退回商品后，下一步需要做什么？"
        ]
      },
      "alert": null,
      "coverage_status": "partial"
    }
  ],
  "confidence": {
    "meaning": "evidence_completeness_not_probability",
    "level": "limited",
    "met_checks": 2,
    "total_checks": 4,
    "basis_codes": [
      "direct_source",
      "closed_references"
    ],
    "limitations": [
      "仅完成 20/30 条消息分类，不能代表全部导入消息。",
      "样本不足以判断该问题是否正在上升。"
    ]
  },
  "payload": {
    "title": "核对售后流程说明是否清楚",
    "category": "customer_service",
    "severity": "info",
    "summary": "已分类消息中出现售后进度与下一步操作的询问；现有样本不足以判断是否增加，建议先核对说明。",
    "evidence_ids": [
      "E-VOC-1"
    ],
    "possible_causes": [
      {
        "hypothesis_id": "H1",
        "kind": "hypothesis",
        "description": "客户可能不容易找到售后进度入口或下一步操作说明。",
        "evidence_ids": [
          "E-VOC-1"
        ],
        "verification_step": "人工查看两条完整会话及当前售后说明，确认入口是否已清楚告知。"
      }
    ],
    "recommended_actions": [
      {
        "action_id": "A1",
        "title": "核对售后说明和进度入口",
        "description": "客服负责人查看引用会话及现有说明，记录缺失信息；确认后由人工决定是否修改说明。",
        "evidence_ids": [
          "E-VOC-1"
        ],
        "hypothesis_ids": [
          "H1"
        ],
        "priority": "P2",
        "expected_impact": {
          "qualitative": "让客户更容易找到售后进度和下一步操作；是否减少询问需后续观察。",
          "metric_id": "voc_refund_process_message_count",
          "observation_days": 7
        }
      }
    ],
    "priority": "P2",
    "related_skus": [],
    "related_metrics": [
      "voc_refund_process_message_count"
    ]
  },
  "action_states": [
    {
      "action_id": "A1",
      "status": "pending",
      "updated_at": null,
      "version": 0,
      "estimated_impact": null,
      "user_id": "70000000-0000-4000-8000-000000000001"
    }
  ],
  "error": null,
  "ruleset_version": "rules-v1-default"
}
```

失败返回相同 envelope，`generation_status=failed、payload=null、generated_at=null、action_states=[]`，保留服务端可以安全提供的 evidence 和 evidence completeness，`error={code:"AI_TIMEOUT",retryable:true,message:"AI 分析暂未完成，可稍后重试"}`。跳过生成时为 `skipped`，error 可为 `NO_ELIGIBLE_EVIDENCE` 或 `BUDGET_LIMIT`。失败响应不能存在假摘要、假生成时间、默认高置信度或可误认成模型输出的推荐动作。

以下为相同授权证据包发生超时后的完整响应。证据来自服务端，因此 AI 失败不需要删除事实；规则与指标页仍可访问。

```json
{
  "schema_version": "1.0",
  "insight_id": "10000000-0000-4000-8000-000000000002",
  "org_id": "20000000-0000-4000-8000-000000000001",
  "store_id": "30000000-0000-4000-8000-000000000001",
  "dataset_version": 7,
  "metric_version": "v1",
  "period": {
    "from": "2026-09-10",
    "to": "2026-09-11",
    "timezone": "Asia/Shanghai"
  },
  "stale": false,
  "updating": false,
  "visibility_scope": "customer_service",
  "status": "active",
  "generation_status": "failed",
  "generated_at": null,
  "evidence": [
    {
      "evidence_id": "E-VOC-1",
      "kind": "voc",
      "date": "2026-09-10",
      "period": {
        "from": "2026-09-10",
        "to": "2026-09-11",
        "timezone": "Asia/Shanghai"
      },
      "dataset_version": 7,
      "metric_version": "v1",
      "source_refs": [
        {
          "source_kind": "voc_insight",
          "record_id": "40000000-0000-4000-8000-000000000001",
          "import_task_id": "50000000-0000-4000-8000-000000000001"
        }
      ],
      "metric": null,
      "voc": {
        "topic": "refund_process",
        "message_count": 2,
        "classified_count": 20,
        "imported_count": 30,
        "count_scope": "classified_primary_label",
        "sample_message_ids": [
          "60000000-0000-4000-8000-000000000001",
          "60000000-0000-4000-8000-000000000002"
        ],
        "redacted_samples": [
          "提交申请后，在哪里查看处理进度？",
          "退回商品后，下一步需要做什么？"
        ]
      },
      "alert": null,
      "coverage_status": "partial"
    }
  ],
  "confidence": {
    "meaning": "evidence_completeness_not_probability",
    "level": "limited",
    "met_checks": 2,
    "total_checks": 4,
    "basis_codes": [
      "direct_source",
      "closed_references"
    ],
    "limitations": [
      "仅完成 20/30 条消息分类，不能代表全部导入消息。",
      "样本不足以判断该问题是否正在上升。"
    ]
  },
  "payload": null,
  "action_states": [],
  "error": {
    "code": "AI_TIMEOUT",
    "retryable": true,
    "message": "AI 分析暂未完成，可稍后重试"
  },
  "ruleset_version": "rules-v1-default"
}
```

## 9.3 语义校验、置信度与状态

Schema 后必须执行以下语义校验，任何关键项失败不得落为 succeeded：

| 项目 | 硬约束 | 失败处理 |
|---|---|---|
| 租户与范围 | 人工请求 envelope 组织来自有效 session，system 任务来自持久化的有效组织/店铺和启用配置，店铺属于组织；证据、来源、SKU 均同租户同店；客服使用单独白名单投影 | 403 或拒绝生成并安全告警，禁止“删几个字段后继续使用” |
| 快照与日期 | 所有 evidence 同 dataset_version 和 metric_version，envelope.ruleset_version 与该次证据规则结果一致；from < to，date 在期间内；基准期另外保存在证据条目自身 period；顶层分析期间允许引用明确标注的基准期 | 拒收混版；重新取同一快照，不让 LLM 修正日期 |
| 引用闭合 | evidence_id、action_id、hypothesis_id 唯一；所有引用实际存在；related_skus 和 metrics 是证据关联集合的子集 | `UNKNOWN_REFERENCE`，最多一次修复 |
| 数据口径 | metric/voc/alert 三个分支恰有一个与 kind 对应；金额十进制字符串及币种与店铺相符；缺失 null 不得写为 0 | `EVIDENCE_MISMATCH`，从服务端证据重建 |
| 覆盖与样本 | coverage_status=partial / missing 不得表述为全量；D+7 退款队列成熟、销售及退款源覆盖完整才可作退款率判断；无分母不输出比率 | 限定措辞或拒绝；不能由模型猜缺失数据 |
| 因果和影响 | 每个 possible_cause 的 kind 固定 hypothesis 且写明核验办法；不允许“已证明/必然导致”；P0 estimated_impact 全 null | `UNSUPPORTED_CLAIM`，拒收无依据诊断 |
| 行动与状态 | 1—5 个动作，action_states 一对一对应；当前用户未操作默认为 pending；模型建议优先级为候选，经服务端规则上限校正 | 不允许模型 accept/done，也不允许无证据产生最高紧急级别 |
| 文本安全 | 客户文字只作数据；不得出现未脱敏联系方式、地址、密钥、外部执行指令或 HTML | 拒收并记录脱敏错误码；原文不进入日志 |

confidence 是证据完整度分级，禁止使用“90% 是真的”一类概率。服务端固定判断：`sufficient` 必须满足相关覆盖完整、规则所需样本达标、基线存在（不需要基线的事实汇总可标不适用）、引用完整且可比；`limited` 表示至少有直接事实但样本/覆盖/基线有缺项；`insufficient` 表示没有足够事实支持建议，此时跳过 AI 建议，仅展示缺失事项。`met_checks/total_checks` 是通过的适用检查数，`basis_codes` 和 `limitations` 说明结论；不能把比例换算成模型正确率。客服部分分类示例即 limited。

`priority=P0/P1/P2` 在此只表示行动紧急度，依次为当日、近期、观察，不是开发阶段。模型提出的 severity/priority 经服务端按证据中的规则严重度和固定映射限制；纯 VOC 候选未经规则命中不得升为 critical/P0。所有角色只记录本人对行动的 accepted/done/dismissed 状态，CustomerService 还受客服证据范围限制。以 (insight_id,action_id,user_id) 唯一保存；不同人的状态独立，没有认领、派单、代改或 Owner/Admin 跨人修改。`done` 只代表用户记录处理完成，不等于建议有效或业务改善。

`action_states[].user_id` 从当前 session 确认，API 仅返回当前用户状态。尚未操作时服务端组装 pending、version=0、updated_at=null 的默认状态；首次修改才建立本人记录，version=1。`updated_at` 由服务端写入；客户端仅提交 action_id、合法目标状态和版本号，同一用户并发版本冲突返回 409。从旧 AI 进入详情始终显示 stale 和来源日期，不因“接受”自动变成新版建议，也不将旧行动状态复制到新生成动作。新快照发布后可以处理旧建议，但需展示“请先核对新数据”；状态历史持续保留。

## 9.4 VOC 批分类与首页四条结论的 Schema

同一份 Schema 的 `$defs.vocBatch` 和 `$defs.dailyConclusion` 是另外两类 P0 LLM 输出的完整校验入口。分别编译 `#/$defs/vocBatch`、`#/$defs/dailyConclusion`，不能用 AIInsight 的动作数组套装所有结果，也不能另写无约束 JSON。每个 object 同样关闭额外属性并 required 全部声明字段。

`vocBatch` 的 taxonomy_version 只是模型回显的固定 `voc-v1`；服务端必须与本次任务字典版本完全比对，不能采信模型自行升级标签。message_id 只能取本批输入，results 与输入逐一对应；主标签不得再次出现在 secondary_labels，unknown 不可和具体标签并列。`evidence_spans` 以发送给模型的脱敏、规范化、截断文本为唯一坐标，按 Unicode code point 计数，不按 UTF-16 code unit；必须 start < end、text 恰为该范围子串。无有效证据时 label/sentiment 为 unknown，spans 可为空。分类 source_revision、组织、店铺、模型版本、生成时间、人工审核状态均由服务端保存，不放入模型结果。下面示例对应输入文本“如何查看退货的处理进度”。

```json
{
  "taxonomy_version": "voc-v1",
  "results": [
    {
      "message_id": "60000000-0000-4000-8000-000000000001",
      "label": "refund_process",
      "secondary_labels": [],
      "sentiment": "neutral",
      "evidence_spans": [
        {
          "start": 0,
          "end": 11,
          "text": "如何查看退货的处理进度"
        }
      ]
    }
  ]
}
```

`dailyConclusion` 固定返回 overall_state、biggest_problem、biggest_opportunity、top_action 四项。每项有短 text 与 evidence_ids；没有证据或没有符合条件的内容时 text=null、evidence_ids=[]，reason 必填具体枚举，前端显示“暂无足够依据”等对应文案，不凭空凑出问题、机会或动作。非空结论必须至少引用一条授权证据，reason=null。reason=no_problem_detected 只能用于规则正常完成且未发现达阈值异常的期间；不能在规则失败或覆盖不足时使用。客服范围同样使用客服独立包。

```json
{
  "overall_state": {
    "text": "已分类客服消息包含售后流程询问，覆盖尚不完整。",
    "evidence_ids": [
      "E-VOC-1"
    ],
    "reason": null
  },
  "biggest_problem": {
    "text": null,
    "evidence_ids": [],
    "reason": "no_eligible_evidence"
  },
  "biggest_opportunity": {
    "text": null,
    "evidence_ids": [],
    "reason": "no_opportunity_supported"
  },
  "top_action": {
    "text": "先核对售后说明及进度查询入口。",
    "evidence_ids": [
      "E-VOC-1"
    ],
    "reason": null
  }
}
```

日报由服务端 AIReport 包装组织、店铺、period、dataset_version、ruleset_version、visibility_scope、证据、生成状态和时间；每日四条结论不强制新建四个 AIInsight 或行动状态。服务端字段 `summary_source=ai|rules|null` 标明显示来源：成功模型结果为 ai；模型失败而使用版本化固定规则模板时为 rules，同时保留真实 generation_status=failed/skipped；无可用摘要为 null。不增加 fallback 生成状态，也不把规则模板写到模型成功结果。rules 摘要仍需同一证据授权和文字检查，不能向 CustomerService 显示经营摘要。

三个生成入口统一经过 JSON 解析 → 对应 Ajv 子 Schema → 引用与范围语义校验 → 服务端组装。VOC 分类再检查逐条覆盖与 span；日报再检查无依据结论和 reason；AIInsight 再检查动作、假设和个人状态。只有 Schema 合法、引用正确、权限正确的结果才能入成功记录。


# PART 24｜成本控制

## 24.1 计费边界与估算假设

估算单位为人民币。以下是本方案的容量预算，不能用作云厂商报价或已验证毛利。试点假设：每组织1店、每日1,000条待分析消息、30天、每天1份经营日报；只有新增或有效内容改变的消息分类。消息在批处理中平均分摊输入450 Token、输出120 Token（含模板开销）；日报每份输入12,000、输出2,000 Token。中文/英文长度、Schema冗余和批次大小都会改变实耗，上线记录真实usage校正。

2026-09-11核验，百炼北京 `qwen-flash-2025-07-28` 在单次输入≤128K档，输入0.15元/百万Token、输出1.5元/百万Token。下列预算不抵扣赠送额度、不假定缓存折扣或Batch优惠。正式使用前再次核验地域、模型ID和价格。[阿里云百炼模型调用价格](https://help.aliyun.com/zh/model-studio/model-pricing)。

| 成本项 | 1个试点组织的月度估算 | 10个同规模组织的月度估算 | 计算/说明 |
|---|---:|---:|---|
| VOC LLM | 7.43元 | 74.25元 | 30,000×450输入=13.5M，×120输出=3.6M；13.5×0.15+3.6×1.5=7.425 |
| 日报/建议LLM | 0.14元 | 1.44元 | 30×12k输入=0.36M、30×2k输出=0.06M；0.36×0.15+0.06×1.5=0.144 |
| LLM含20%重试/补生成余量 | 约9.1元 | 约91元 | (VOC+日报)×1.2，非额外在前两行之上再重复计费 |
| Embedding | 0 | 0 | P0未启用，不能先买向量服务 |
| Hosting与Database | 合计预算300—800元 | 合计预算300—800元起 | 单台4vCPU/8GB ECS与磁盘的预留预算，DB在同机，不再重复算托管库费用；不代表当前官网报价，容量是否可承载10家需压测 |
| Storage及备份 | 5—30元 | 10—60元 | 受CSV保留、每日备份量及外网下载影响；按实际OSS账单核算 |
| 调度 | 无单独SaaS账单 | 无单独SaaS账单 | pg-boss消耗已有CPU/数据库空间，包含在主机成本 |
| Monitoring/Logging | 0—30元预留 | 0—50元预留 | 优先主机基础监控和本地滚动日志；不用高量全文日志上报 |
| 合计预算 | 约315—870元/月 | 约401—1,001元/月起 | 不含域名、税费、人工接入、获客、客服支持、账单波动；基础资源价格需采购前核实 |

首次回灌90天消息、每天5,000条消息、频繁更正重导和管理员强制重跑会突破上述调用量；应先显示预计分析量，按组织额度排队，不能后台无限运行。定价讨论要把人工字段映射、数据解释、客户支持工时记入成本，不能仅凭LLM便宜判断SaaS有利润。

## 24.2 具体限额与降本行为

| 场景 | 是否调用LLM | 缓存/批处理与上限 | 达到上限后 |
|---|---|---|---|
| 指标计算、数值变化、异常等级、权限检查 | 不调用 | SQL/规则与已发布快照 | 正常计算 |
| 空消息、无变化重导、已有人工标签 | 不调用 | 按message_id/source_revision/taxonomy_version/model_id/prompt_version在组织内复用有效分类；P0不跨消息套用引用位置 | 复用有效分类；保留各消息计数 |
| 新消息分类 | 调用同一个Flash小模型 | 每批20条，单条≤500字、总文本≤12,000字；截断明确标识，未读部分不能视为已分析；单次输入≤16k、输出≤6k Token，取先达到上限；并发2；默认组织每日2000条 | 未处理量显示pending，下一预算窗继续 |
| 日报与建议 | 有新版本有效证据才调用 | 缓存键含org/store/scope/date/dataset_version/ruleset_version/model/prompt/schema；输入≤16k、输出≤6k | 规则摘要+明确AI未完成 |
| 用户重复点击生成 | 有相同在途或有效结果则不调用 | 10分钟相同请求防抖；业务运行键防重复 | 返回已有job/result |
| 数据库/权限错误或模型鉴权401 | 不调用或立即停止 | 不做无意义自动重试 | 系统配置提示 |
| 格式错误或网络超时 | 按PART8次数重试 | 总尝试最多3次，其中格式修复最多1次；跨Worker重启共享次数；实际次数计费 | 降级，保存错误类型与Token，不保存秘密正文 |

组织预算统一以Asia/Shanghai自然日/月重置（与单店报表时区分开，跨店共享），默认每组织每日模型预算3元、每月100元，O/A可降低或在允许范围内提高（每日0—20元、每月0—500元）；两者任何一个耗尽都暂停新LLM调用。额度检查须原子预留预计输入费用加最大允许输出费用，并在请求完成后按usage结算；超时且usage未知的attempt保留预留或按上限暂计，不立即释放，再次调用另做预留，供应商账单核对后才调整，不能只在请求前查询余额而被并发绕过。P0拒绝单次超16k输入的构造请求，先裁剪证据/分批，不跳到昂贵长上下文档。

小模型已经是默认，不追加“复杂问题自动调用更贵模型”。质量不达标时先修文本、标签定义、证据选择和Prompt，用固定评测集复验；确需换模型另作变更决定。不得跨组织共享包含私有文本的语义缓存。
