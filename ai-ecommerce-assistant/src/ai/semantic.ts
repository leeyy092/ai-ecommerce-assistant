/**
 * TASK-017｜Schema 之后的语义校验（06 §9.3）。
 *
 * 合同：Ajv 通过不等于验收——服务端必须做租户/快照/引用闭合/数据口径/覆盖样本/
 * 因果措辞/行动状态/文本安全语义校验；关键项失败不得落 succeeded。017 提供统一
 * 语义门禁入口供 018–020 的各生成 kind 复用；租户与快照一致性由 gateway 的
 * envelope 组装保证，本模块校验模型输出对服务端白名单的引用闭合与措辞约束。
 */
export type SemanticErrorCode =
  | "UNKNOWN_REFERENCE"
  | "EVIDENCE_MISMATCH"
  | "UNSUPPORTED_CLAIM"
  | "TEXT_SAFETY"
  | "TAXONOMY_MISMATCH";

export class SemanticValidationError extends Error {
  readonly code: SemanticErrorCode;
  constructor(code: SemanticErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

/** 服务端提供的引用白名单（本次证据包内合法 ID 集合） */
export interface ReferenceWhitelist {
  evidenceIds: Set<string>;
  skuIds: Set<string>;
  metricIds: Set<string>;
}

/** 06 §9.3 因果措辞硬约束：不允许“已证明/必然导致”一类断言 */
const BANNED_CAUSAL_PHRASES = ["已证明", "必然导致", "必然造成", "证实导致", "一定导致", "guaranteed", "proven to cause"];

/** 06 §9.3 文本安全：未脱敏联系方式/密钥形态/HTML 标签不得出现在模型输出 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?86[-\s]?)?1[3-9]\d{9}|\d{3,4}-\d{7,8}/;
const HTML_TAG_RE = /<\/?[a-z][^>\s]{0,100}>/i;
const KEY_LIKE_RE = /(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|AKID[A-Za-z0-9]{12,})/;

export function scanTextSafety(text: string): SemanticValidationError | null {
  if (EMAIL_RE.test(text)) return new SemanticValidationError("TEXT_SAFETY", "输出包含未脱敏邮箱形态");
  if (PHONE_RE.test(text)) return new SemanticValidationError("TEXT_SAFETY", "输出包含未脱敏电话形态");
  if (HTML_TAG_RE.test(text)) return new SemanticValidationError("TEXT_SAFETY", "输出包含HTML标签");
  if (KEY_LIKE_RE.test(text)) return new SemanticValidationError("TEXT_SAFETY", "输出包含密钥形态");
  return null;
}

/** insight 输出（llmPayload）的语义校验 */
export function validateInsightSemantics(
  payload: {
    related_skus?: string[];
    related_metrics?: string[];
    possible_causes?: Array<{ kind?: string; verification?: unknown }>;
    recommended_actions?: Array<{ priority?: string }>;
    estimated_impact?: unknown;
    [k: string]: unknown;
  },
  whitelist: ReferenceWhitelist,
): SemanticValidationError | null {
  for (const sku of payload.related_skus ?? []) {
    if (!whitelist.skuIds.has(sku)) return new SemanticValidationError("UNKNOWN_REFERENCE", `related_skus 引用未授权 SKU: ${sku}`);
  }
  for (const metric of payload.related_metrics ?? []) {
    if (!whitelist.metricIds.has(metric)) return new SemanticValidationError("UNKNOWN_REFERENCE", `related_metrics 引用未授权指标: ${metric}`);
  }
  for (const cause of payload.possible_causes ?? []) {
    if (cause.kind !== "hypothesis") return new SemanticValidationError("UNSUPPORTED_CLAIM", "possible_causes.kind 必须为 hypothesis");
    const step = (cause as { verification_step?: unknown }).verification_step;
    if (step === undefined || step === null || step === "") {
      return new SemanticValidationError("UNSUPPORTED_CLAIM", "possible_cause 缺少核验办法（verification_step）");
    }
  }
  // P0：estimated_impact 必须为 null（06 §9.1）
  if (payload.estimated_impact !== undefined && payload.estimated_impact !== null) {
    return new SemanticValidationError("UNSUPPORTED_CLAIM", "P0 estimated_impact 必须为 null");
  }
  for (const action of payload.recommended_actions ?? []) {
    // 模型建议优先级为候选：纯 VOC 候选未经规则命中不得升为 critical/P0（由调用方传入 allowedPriorities）
    if (action.priority !== undefined && !allowedPriorities.has(action.priority)) {
      return new SemanticValidationError("UNSUPPORTED_CLAIM", `不允许的优先级: ${action.priority}`);
    }
  }
  return scanTextSafety(JSON.stringify(payload)) ?? scanCausalPhrases(JSON.stringify(payload));
}

/** 默认允许的模型建议优先级（服务端规则可进一步收紧） */
const allowedPriorities = new Set(["P0", "P1", "P2"]);

export function scanCausalPhrases(text: string): SemanticValidationError | null {
  for (const phrase of BANNED_CAUSAL_PHRASES) {
    if (text.includes(phrase)) return new SemanticValidationError("UNSUPPORTED_CLAIM", `不允许的因果断言: ${phrase}`);
  }
  return null;
}

/** vocBatch 输出语义校验（06 §9.4） */
export function validateVocBatchSemantics(
  payload: { taxonomy_version?: string; results?: Array<{ message_id?: string; label?: string; secondary_labels?: string[]; sentiment?: string; evidence_spans?: Array<{ start?: number; end?: number; text?: string }> }> },
  args: { batchMessageIds: Set<string>; normalizedTexts: Map<string, string>; taxonomyVersion: string },
): SemanticValidationError | null {
  if (payload.taxonomy_version !== args.taxonomyVersion) {
    return new SemanticValidationError("TAXONOMY_MISMATCH", `taxonomy_version 必须为 ${args.taxonomyVersion}`);
  }
  const seen = new Set<string>();
  for (const r of payload.results ?? []) {
    const id = r.message_id ?? "";
    if (!args.batchMessageIds.has(id)) return new SemanticValidationError("UNKNOWN_REFERENCE", `message_id 不属于本批: ${id}`);
    if (seen.has(id)) return new SemanticValidationError("EVIDENCE_MISMATCH", `message_id 重复: ${id}`);
    seen.add(id);
    if (r.label !== "unknown" && (r.secondary_labels ?? []).includes(r.label ?? "")) {
      return new SemanticValidationError("EVIDENCE_MISMATCH", "主标签不得再次出现在 secondary_labels");
    }
    if (r.label === "unknown" && (r.secondary_labels ?? []).length > 0 && (r.secondary_labels ?? []).some((s) => s !== "unknown")) {
      return new SemanticValidationError("EVIDENCE_MISMATCH", "unknown 不可和具体标签并列");
    }
    const text = args.normalizedTexts.get(id) ?? "";
    for (const span of r.evidence_spans ?? []) {
      const start = span.start ?? -1;
      const end = span.end ?? -1;
      if (!(start >= 0) || !(end > start)) return new SemanticValidationError("EVIDENCE_MISMATCH", "evidence_span 必须 start<end");
      // 按 Unicode code point 计数（Array.from 处理代理对）
      const cps = Array.from(text);
      const slice = cps.slice(start, end).join("");
      if (slice !== (span.text ?? "")) return new SemanticValidationError("EVIDENCE_MISMATCH", "evidence_span.text 不是该范围子串");
    }
  }
  for (const id of args.batchMessageIds) {
    if (!seen.has(id)) return new SemanticValidationError("EVIDENCE_MISMATCH", `批次缺少消息结果: ${id}`);
  }
  return scanTextSafety(JSON.stringify(payload));
}
