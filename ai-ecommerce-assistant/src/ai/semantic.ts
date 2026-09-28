/**
 * TASK-017｜Schema 之后的语义校验（06 §9.3/§9.4；T017R1 H02/H06 修复版）。
 *
 * 合同：Ajv 通过不等于验收——所有 kind 的语义校验强制执行、缺失可信服务端语义上下文
 * 即 fail-closed；引用闭合覆盖 evidence/hypothesis/action 三层且标识唯一；
 * dailyConclusion 同样校验权限证据与文本安全；VOC span 限原文 code point 边界、
 * 无证据必须 unknown。文本安全先掩码 UUID/系统 ID 再扫描（避免误杀合法标识），
 * HTML 含属性形态必须识别；因果措辞与 P0 estimated_impact=null 约束保持。
 */
export type SemanticErrorCode =
  | "UNKNOWN_REFERENCE"
  | "EVIDENCE_MISMATCH"
  | "UNSUPPORTED_CLAIM"
  | "TEXT_SAFETY"
  | "TAXONOMY_MISMATCH"
  | "SEMANTIC_CONTEXT_MISSING";

export class SemanticValidationError extends Error {
  readonly code: SemanticErrorCode;
  constructor(code: SemanticErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

/** 服务端提供的引用白名单（本次证据包内合法 ID 集合；由可信上下文构建） */
export interface ReferenceWhitelist {
  evidenceIds: Set<string>;
  skuIds: Set<string>;
  metricIds: Set<string>;
}

/** 06 §9.3 因果措辞硬约束 */
const BANNED_CAUSAL_PHRASES = ["已证明", "必然导致", "必然造成", "证实导致", "一定导致", "guaranteed", "proven to cause"];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** H06/F03+F05：先掩码 UUID/系统ID，再扫描电话；HTML 识别含属性形态 */
const UUID_MASK_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const PHONE_RE = /(?:\+?86[-\s]?)?1[3-9]\d{9}|\d{3,4}-\d{7,8}/;
const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;
const KEY_LIKE_RE = /(?:sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|AKID[A-Za-z0-9]{12,})/;

/** 掩码合法 UUID/系统标识后再做联系方式扫描（F05） */
export function scanTextSafety(text: string): SemanticValidationError | null {
  const masked = text.replace(UUID_MASK_RE, "UUIDMASKED");
  if (EMAIL_RE.test(masked)) return new SemanticValidationError("TEXT_SAFETY", "输出包含未脱敏邮箱形态");
  if (PHONE_RE.test(masked)) return new SemanticValidationError("TEXT_SAFETY", "输出包含未脱敏电话形态");
  if (HTML_TAG_RE.test(masked)) return new SemanticValidationError("TEXT_SAFETY", "输出包含HTML标签");
  if (KEY_LIKE_RE.test(masked)) return new SemanticValidationError("TEXT_SAFETY", "输出包含密钥形态");
  return null;
}

/** insight 输出（llmPayload）语义校验：引用闭合/唯一标识/口径/因果/文本安全 */
export function validateInsightSemantics(
  payload: {
    related_skus?: string[];
    related_metrics?: string[];
    evidence_ids?: string[];
    possible_causes?: Array<{ hypothesis_id?: string; kind?: string; evidence_ids?: string[]; verification_step?: unknown }>;
    recommended_actions?: Array<{ action_id?: string; evidence_ids?: string[]; hypothesis_ids?: string[]; priority?: string }>;
    estimated_impact?: unknown;
    [k: string]: unknown;
  },
  whitelist: ReferenceWhitelist,
): SemanticValidationError | null {
  const evidenceOk = (ids: string[] | undefined, where: string): SemanticValidationError | null => {
    for (const id of ids ?? []) if (!whitelist.evidenceIds.has(id)) return new SemanticValidationError("UNKNOWN_REFERENCE", `${where} 存在未授权证据引用`);
    return null;
  };
  // 顶层证据引用闭合（B01）
  const topErr = evidenceOk(payload.evidence_ids, "evidence_ids");
  if (topErr) return topErr;
  // hypothesis 标识唯一 + 各自证据闭合 + kind/核验办法（B02 前置）
  const declaredHypotheses = new Set<string>();
  for (const cause of payload.possible_causes ?? []) {
    if (cause.hypothesis_id === undefined || declaredHypotheses.has(cause.hypothesis_id ?? "")) {
      return new SemanticValidationError("EVIDENCE_MISMATCH", "hypothesis_id 缺失或重复");
    }
    declaredHypotheses.add(cause.hypothesis_id);
    if (cause.kind !== "hypothesis") return new SemanticValidationError("UNSUPPORTED_CLAIM", "possible_causes.kind 必须为 hypothesis");
    const step = cause.verification_step;
    if (step === undefined || step === null || step === "") return new SemanticValidationError("UNSUPPORTED_CLAIM", "possible_cause 缺少核验办法（verification_step）");
    const err = evidenceOk(cause.evidence_ids, "possible_cause.evidence_ids");
    if (err) return err;
  }
  // action 标识唯一（B05）+ 证据闭合 + hypothesis 引用闭合（B02）+ 优先级
  const seenActions = new Set<string>();
  for (const action of payload.recommended_actions ?? []) {
    if (action.action_id === undefined || seenActions.has(action.action_id ?? "")) {
      return new SemanticValidationError("EVIDENCE_MISMATCH", "action_id 缺失或重复");
    }
    seenActions.add(action.action_id);
    const err = evidenceOk(action.evidence_ids, "action.evidence_ids");
    if (err) return err;
    for (const h of action.hypothesis_ids ?? []) {
      if (!declaredHypotheses.has(h)) return new SemanticValidationError("UNKNOWN_REFERENCE", `action 引用了未声明的 hypothesis`);
    }
    if (action.priority !== undefined && !allowedPriorities.has(action.priority)) {
      return new SemanticValidationError("UNSUPPORTED_CLAIM", `action 存在不允许的优先级`);
    }
  }
  for (const sku of payload.related_skus ?? []) {
    if (!whitelist.skuIds.has(sku)) return new SemanticValidationError("UNKNOWN_REFERENCE", `related_skus 存在未授权 SKU 引用`);
  }
  for (const metric of payload.related_metrics ?? []) {
    if (!whitelist.metricIds.has(metric)) return new SemanticValidationError("UNKNOWN_REFERENCE", `related_metrics 存在未授权指标引用`);
  }
  if (payload.estimated_impact !== undefined && payload.estimated_impact !== null) {
    return new SemanticValidationError("UNSUPPORTED_CLAIM", "P0 estimated_impact 必须为 null");
  }
  const json = JSON.stringify(payload);
  return scanTextSafety(json) ?? scanCausalPhrases(json);
}

/** 默认允许的模型建议优先级（服务端规则可进一步收紧） */
const allowedPriorities = new Set(["P0", "P1", "P2"]);

export function scanCausalPhrases(text: string): SemanticValidationError | null {
  for (const phrase of BANNED_CAUSAL_PHRASES) {
    if (text.includes(phrase)) return new SemanticValidationError("UNSUPPORTED_CLAIM", `不允许的因果断言: ${phrase}`);
  }
  return null;
}

interface ConclusionItem { text?: string; evidence_ids?: string[]; reason?: unknown }

/** dailyConclusion 语义校验（B04）：四条结论的证据引用闭合 + 文本安全 */
export function validateDailyConclusionSemantics(
  payload: { overall_state?: ConclusionItem; biggest_problem?: ConclusionItem; biggest_opportunity?: ConclusionItem; top_action?: ConclusionItem },
  whitelist: ReferenceWhitelist,
): SemanticValidationError | null {
  const items: Array<[string, ConclusionItem | undefined]> = [
    ["overall_state", payload.overall_state],
    ["biggest_problem", payload.biggest_problem],
    ["biggest_opportunity", payload.biggest_opportunity],
    ["top_action", payload.top_action],
  ];
  for (const [name, item] of items) {
    if (!item) continue;
    for (const id of item.evidence_ids ?? []) {
      if (!whitelist.evidenceIds.has(id)) return new SemanticValidationError("UNKNOWN_REFERENCE", `${name} 存在未授权证据引用`);
    }
    if (typeof item.text === "string") {
      const err = scanTextSafety(item.text);
      if (err) return err;
    }
  }
  return scanTextSafety(JSON.stringify(payload));
}

/** vocBatch 输出语义校验（06 §9.4；B06/B07/F05） */
export function validateVocBatchSemantics(
  payload: { taxonomy_version?: string; results?: Array<{ message_id?: string; label?: string; secondary_labels?: string[]; sentiment?: string; evidence_spans?: Array<{ start?: number; end?: number; text?: string }> }> },
  args: { batchMessageIds: Set<string>; normalizedTexts: Map<string, string>; taxonomyVersion: string },
): SemanticValidationError | null {
  if (payload.taxonomy_version !== args.taxonomyVersion) {
    return new SemanticValidationError("TAXONOMY_MISMATCH", `taxonomy_version 与本次任务字典版本不一致`);
  }
  const seen = new Set<string>();
  for (const r of payload.results ?? []) {
    const id = r.message_id ?? "";
    if (!args.batchMessageIds.has(id)) return new SemanticValidationError("UNKNOWN_REFERENCE", `message_id 存在不属于本批的引用`);
    if (seen.has(id)) return new SemanticValidationError("EVIDENCE_MISMATCH", `message_id 存在重复`);
    seen.add(id);
    if (r.label !== "unknown" && (r.secondary_labels ?? []).includes(r.label ?? "")) {
      return new SemanticValidationError("EVIDENCE_MISMATCH", "主标签不得再次出现在 secondary_labels");
    }
    if (r.label === "unknown" && (r.secondary_labels ?? []).some((s) => s !== "unknown")) {
      return new SemanticValidationError("EVIDENCE_MISMATCH", "unknown 不可和具体标签并列");
    }
    const text = args.normalizedTexts.get(id) ?? "";
    const cps = Array.from(text);
    const spans = r.evidence_spans ?? [];
    if (spans.length === 0) {
      // B07：无有效证据片段 → label 与 sentiment 必须为 unknown
      if (r.label !== "unknown" || r.sentiment !== "unknown") {
        return new SemanticValidationError("EVIDENCE_MISMATCH", "无 evidence_spans 时 label/sentiment 必须为 unknown");
      }
    }
    for (const span of spans) {
      const start = span.start ?? -1;
      const end = span.end ?? -1;
      // B06：end 不得超过原文 code point 长度（slice 会静默截断，必须显式判定）
      if (!(start >= 0) || !(end > start) || end > cps.length) return new SemanticValidationError("EVIDENCE_MISMATCH", "evidence_span 越界（0≤start<end≤原文code point数）");
      const slice = cps.slice(start, end).join("");
      if (slice !== (span.text ?? "")) return new SemanticValidationError("EVIDENCE_MISMATCH", "evidence_span.text 不是该范围子串");
    }
  }
  for (const id of args.batchMessageIds) {
    if (!seen.has(id)) return new SemanticValidationError("EVIDENCE_MISMATCH", `批次存在缺少结果的消息`);
  }
  return scanTextSafety(JSON.stringify(payload));
}
