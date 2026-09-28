/**
 * TASK-017｜AI Schema 唯一真源与 Ajv 编译（06 §9.1）。
 *
 * 合同：Draft 2020-12 完整 Schema 从 06_AI_CAPABILITIES §9.1 原文提取，禁止手写第二份
 * AI 输出结构；llmPayload 校验模型原始输出，根节点校验服务端组装后的最终 API 对象，
 * vocBatch / dailyConclusion 是另两类 P0 LLM 输出入口。format 必须真实启用
 * uuid / date / date-time（不引第二格式库，注册精确校验实现）。
 */
import Ajv2020 from "ajv/dist/2020";
import insightSchemaJson from "./ai-insight-v1.schema.json";

export const AI_SCHEMA = insightSchemaJson as unknown as import("ajv").SchemaObject;
export const SCHEMA_VERSION = "1.0";
export const FIXED_MODEL_ID = "qwen-flash-2025-07-28";
export const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
/** 06 §24.2：qwen-flash 输入0.15元/百万Token、输出1.5元/百万Token（2026-09-11核验价） */
export const PRICE_INPUT_PER_MTOK = 0.15;
export const PRICE_OUTPUT_PER_MTOK = 1.5;
/** 06 §8.2/§24.2：单次输入≤16k、输出≤6k Token */
export const MAX_INPUT_TOKENS = 16_000;
export const MAX_OUTPUT_TOKENS = 6_000;
/** 06 §8.2：默认单次超时30秒、总尝试≤3、格式修复≤1；重试退避5s/20s */
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 3;
export const MAX_FORMAT_REPAIRS = 1;
export const BACKOFF_MS = [5_000, 20_000];
/** 队列并发：全局2、单组织1（06 §8.2） */
export const GLOBAL_CONCURRENCY = 2;
export const ORG_CONCURRENCY = 1;

/** Prompt 版本（018–020 复用；017 仅登记版本化入口） */
export const PROMPT_VERSIONS = {
  insight: "insight-v1",
  voc_classification: "voc-classification-v1",
  daily_report: "daily-report-v1",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;
const isValidDate = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** M02/G01：date-time 分量级真实校验——日期（含闰年）、时分秒、时区偏移 ≤±14:00 */
const isValidDateTime = (s: string): boolean => {
  const m = DATE_TIME_RE.exec(s);
  if (!m) return false;
  const [, ys, ms, ds, hh, mm, ss, , zone] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds);
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > daysInMonth(y, mo)) return false;
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return false;
  if (zone.toUpperCase() !== "Z") {
    const oh = Number(zone.slice(1, 3)), om = Number(zone.slice(4, 6));
    if (oh > 14 || om > 59) return false;
    if (oh === 14 && om > 0) return false;
  }
  return true;
};

function buildAjv(): InstanceType<typeof Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // format 真实验证（06 §9.1：UUID、date、date-time 不能只当注释）
  ajv.addFormat("uuid", (d) => typeof d !== "string" || UUID_RE.test(d));
  ajv.addFormat("date", (d) => typeof d !== "string" || isValidDate(d));
  ajv.addFormat("date-time", (d) => typeof d !== "string" || isValidDateTime(d));
  return ajv;
}

const ajv = buildAjv();

export interface CompiledValidator {
  (data: unknown): boolean;
  errorsText(): string;
}

function compile(ref?: string): CompiledValidator {
  let schema: import("ajv").SchemaObject;
  if (ref) {
    // 子入口：仅 $ref + $defs 的新匿名 schema——Draft 2020-12 中 $ref 兄弟关键字仍生效，
    // 不能沿用根级 required/properties；匿名（无 $id）避免按 $id 去重冲突
    schema = { $ref: `#/$defs/${ref}`, $defs: JSON.parse(JSON.stringify(AI_SCHEMA.$defs ?? {})) } as import("ajv").SchemaObject;
  } else {
    schema = AI_SCHEMA;
  }
  const v = ajv.compile(schema);
  const wrapped = ((data: unknown) => v(data)) as CompiledValidator;
  wrapped.errorsText = () => v.errors?.map((e) => `${e.instancePath} ${e.message ?? ""}`).join("; ") ?? "";
  return wrapped;
}

/** 根节点：服务端组装后的最终 AIInsight / AIReport API 对象 */
export const validateRoot: CompiledValidator = compile();
/** 模型原始输出（不含服务端 envelope 字段） */
export const validateLlmPayload: CompiledValidator = compile("llmPayload");
/** VOC 批分类输出 */
export const validateVocBatch: CompiledValidator = compile("vocBatch");
/** 首页四条结论输出 */
export const validateDailyConclusion: CompiledValidator = compile("dailyConclusion");

/** 按 schema 分派模型输出校验器 */
export function validatorForKind(kind: "insight" | "voc_classification" | "daily_report"): CompiledValidator {
  if (kind === "voc_classification") return validateVocBatch;
  if (kind === "daily_report") return validateDailyConclusion;
  return validateLlmPayload;
}
