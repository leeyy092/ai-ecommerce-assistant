/**
 * TASK-017｜AI 调用唯一入口（网关编排；T017R2 H03/H06 修复版）。
 *
 * - H03/J02：claim/预留/结算/审计全部为独立提交的短事务——网络调用前 claim 已落盘，
 *   崩溃后 attemptCount 与未决 reserved 不回滚；恢复重投递不重置计数；
 * - H03/J01/J06：跨进程执行闸（全局2/组织1，会话级 advisory lock，崩溃自动释放）；
 *   不可重试错误（鉴权/未知模型/权限）终态幂等，重投递直接返回不再调用；
 * - H04：每次 attempt 独立原子预留，有 usage 即结算实际；统计=Σactual+Σ未决reserve（budget.ts）；
 * - H06：语义/Schema 错误摘要只含错误码与字段路径，不含任何未可信模型字段值；
 *   修复请求仅错误码+原脱敏证据包；失败不缓存原文；
 * - M01：输入预算 12k 字符先到者强制；token 计数为 char-approx 近似（无离线 qwen
 *   tokenizer 证据，按合同如实 BLOCKED，见 12_PROGRESS 记录）。
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  SCHEMA_VERSION, FIXED_MODEL_ID, PROMPT_VERSIONS, MAX_INPUT_TOKENS,
  MAX_FORMAT_REPAIRS, BACKOFF_MS, REQUEST_TIMEOUT_MS, validatorForKind,
} from "@/ai/schemas/validators";
import {
  ModelTransportError, getModelTransport, type ModelRequest, type ModelTransport,
} from "@/ai/providers/model-provider";
import {
  claimAttempt, settleAttempt, releaseOutstanding, createReservedRun,
} from "@/ai/budget";
import { acquireExecutionSlots } from "@/ai/slots";
import {
  SemanticValidationError, validateInsightSemantics, validateVocBatchSemantics, validateDailyConclusionSemantics,
  type ReferenceWhitelist,
} from "@/ai/semantic";

export const AI_INPUT_MAX_CHARS = 12_000;
/** M01：token 计数器版本——char-approx 为近似实现，真实 qwen tokenizer 待离线证据（BLOCKED 项） */
export const TOKEN_COUNTER_VERSION = "char-approx-v1";

/** H03/J06：不可重试传输错误——同任务保持终态，重投递不再调用 */
const TERMINAL_TRANSPORT_CODES = new Set(["AUTH_ERROR", "UNKNOWN_MODEL", "PERMISSION_ERROR"]);
/** H03/J02：在途等待上限——短等待后按崩溃恢复处理（claim 不重置计数） */
const IN_FLIGHT_WAIT_MS = 3_000;

export interface GatewayResult {
  runId: string;
  status: "succeeded" | "failed" | "skipped" | "reused";
  payload: unknown | null;
  errorCode: string | null;
  attempts: number;
}

export interface RunGatewayArgs {
  db: PrismaClient;
  orgId: string;
  storeId: string;
  kind: "voc_classification" | "insight" | "daily_report";
  idempotencyKey: string;
  datasetVersion: bigint;
  rulesetVersion: string;
  visibilityScope: "business" | "customer_service";
  systemPrompt: string;
  userPrompt: string;
  semantic?: {
    whitelist?: ReferenceWhitelist;
    voc?: { batchMessageIds: Set<string>; normalizedTexts: Map<string, string>; taxonomyVersion: string };
  };
  transport?: ModelTransport;
  timeoutMs?: number;
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
  inFlightWaitMs?: number;
}

function hashInput(args: { systemPrompt: string; userPrompt: string }): string {
  return createHash("sha256").update(JSON.stringify([args.systemPrompt, args.userPrompt])).digest("hex");
}

/** H01：业务缓存键 = 调用者键 × 可信上下文全维度 */
function deriveContextKey(args: RunGatewayArgs, promptVersion: string, inputHash: string): string {
  return createHash("sha256").update(JSON.stringify([
    args.idempotencyKey, args.orgId, args.storeId, args.visibilityScope,
    args.datasetVersion.toString(), args.rulesetVersion, FIXED_MODEL_ID, promptVersion, SCHEMA_VERSION, inputHash,
  ])).digest("hex").slice(0, 64);
}

/** M01：字符预算强制；token 为保守近似（计数器版本见 TOKEN_COUNTER_VERSION） */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 3.2);
}
function inputWithinBudget(systemPrompt: string, userPrompt: string): boolean {
  const text = `${systemPrompt}\n${userPrompt}`;
  return text.length <= AI_INPUT_MAX_CHARS && estimateTokens(text) <= MAX_INPUT_TOKENS;
}

/** H06：修复提示只含错误码+安全摘要（来自可信校验器，不含模型输出值）与原提示 */
function repairPrompt(original: ModelRequest, code: "SCHEMA_INVALID" | "SEMANTIC_INVALID", summary: string): ModelRequest {
  return {
    ...original,
    userPrompt: `${original.userPrompt}\n\n上一次输出未通过服务端校验（错误码 ${code}，摘要：${summary.slice(0, 200)}）。请仅依据原始证据重新输出完整合法的 JSON 对象。`,
  };
}

/** H06：兜底剥离任何 @ 形态（Ajv errorsText 不含实例值，防御性处理） */
function safeSummary(summary: string): string {
  return summary.replace(/[^\s]*@[^\s]*/g, "[redacted]");
}

function jitter(base: number): number {
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

interface RunRow {
  id: string; status: string; attemptCount: number; errorCode: string | null;
  requestContext: Prisma.JsonValue; reservedCost: Prisma.Decimal; actualCost: Prisma.Decimal | null;
  attempts?: Prisma.JsonValue;
}

function isTerminal(row: RunRow): boolean {
  if (row.status === "succeeded" || row.status === "skipped" || row.status === "superseded") return true;
  // L01：failed 一律终态——已提交的失败结论（含SCHEMA_INVALID等普通失败）同键重投不得再调用；
  // 只有未终态的 running 行才可恢复（崩溃恢复走claim，不重置计数）
  return row.status === "failed";
}

export async function runAiTask(args: RunGatewayArgs): Promise<GatewayResult> {
  const promptVersion = PROMPT_VERSIONS[args.kind === "daily_report" ? "daily_report" : args.kind === "voc_classification" ? "voc_classification" : "insight"];
  const inputHash = hashInput(args);
  const derivedKey = deriveContextKey(args, promptVersion, inputHash);
  const transport = args.transport ?? getModelTransport();
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = args.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const backoff = args.backoffMs ?? BACKOFF_MS;

  // H02：所有 kind 强制语义上下文（缺失 fail-closed，不调用模型）
  const semanticValidator = buildSemanticValidator(args);
  if (typeof semanticValidator === "string") {
    return { runId: "", status: "failed", payload: null, errorCode: semanticValidator, attempts: 0 };
  }
  const runSemantic = semanticValidator as (parsed: unknown) => SemanticValidationError | null;

  const created = await createReservedRun(args.db, {
    orgId: args.orgId, storeId: args.storeId, kind: args.kind, idempotencyKey: derivedKey,
    datasetVersion: args.datasetVersion, rulesetVersion: args.rulesetVersion, visibilityScope: args.visibilityScope,
    modelId: FIXED_MODEL_ID, promptVersion, schemaVersion: SCHEMA_VERSION, inputHash,
    requestContext: { caller_key: args.idempotencyKey }, now: args.now,
  });
  const runId = created.id;
  const readRow = (): Promise<RunRow | null> => args.db.aIRun.findUnique({ where: { id: runId } }) as Promise<RunRow | null>;

  // 快路径：终态（成功/尝试耗尽/不可重试错误）直接返回，重投递不再调用（J06/D02）
  if (created.reused) {
    const row = await readRow();
    if (row && row.status === "succeeded") {
      return { runId, status: "reused", payload: (row.requestContext as { cached_payload?: unknown }).cached_payload ?? null, errorCode: null, attempts: row.attemptCount };
    }
    if (row && isTerminal(row)) {
      return { runId, status: "failed", payload: null, errorCode: row.errorCode ?? "ATTEMPTS_EXHAUSTED", attempts: row.attemptCount };
    }
    if (row && row.status === "running") {
      // 在途短等待：正常并发下等到终态复用（A04）；等待超时按崩溃恢复走 claim（J02）
      const deadline = Date.now() + (args.inFlightWaitMs ?? IN_FLIGHT_WAIT_MS);
      while (Date.now() < deadline) {
        const cur = await readRow();
        if (!cur) break;
        if (cur.status === "succeeded") return { runId, status: "reused", payload: (cur.requestContext as { cached_payload?: unknown }).cached_payload ?? null, errorCode: null, attempts: cur.attemptCount };
        if (isTerminal(cur)) return { runId, status: "failed", payload: null, errorCode: cur.errorCode ?? "ATTEMPTS_EXHAUSTED", attempts: cur.attemptCount };
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  }

  // H03：跨进程执行闸（全局2/组织1；会话锁崩溃自动释放）
  const slots = await acquireExecutionSlots(args.orgId);
  try {
    // 锁内终态复核
    const locked = await readRow();
    if (locked && locked.status === "succeeded") {
      return { runId, status: "reused", payload: (locked.requestContext as { cached_payload?: unknown }).cached_payload ?? null, errorCode: null, attempts: locked.attemptCount };
    }
    if (locked && isTerminal(locked)) {
      return { runId, status: "failed", payload: null, errorCode: locked.errorCode ?? "ATTEMPTS_EXHAUSTED", attempts: locked.attemptCount };
    }

    const validate = validatorForKind(args.kind);
    // L02：恢复不得覆盖历史审计或重置已消费修复状态——从持久行初始化追加式审计
    const persisted = (locked && Array.isArray(locked.attempts) ? locked.attempts : []) as unknown as Array<Record<string, unknown>>;
    const attemptsLog: Array<Record<string, unknown>> = [...persisted];
    let formatRepairs = persisted.filter((e) => e.type === "format_repair" || e.type === "semantic_repair").length;
    let request: ModelRequest = { systemPrompt: args.systemPrompt, userPrompt: args.userPrompt };
    let lastErrorCode: string | null = locked?.errorCode ?? null;

    const appendAttempt = async (entry: Record<string, unknown>): Promise<void> => {
      // 追加式：重读持久数组再追加，跨进程/恢复不覆盖历史
      const rowNow = await readRow();
      const current = (rowNow && Array.isArray(rowNow.attempts) ? rowNow.attempts : []) as unknown as Array<Record<string, unknown>>;
      current.push(entry);
      attemptsLog.length = 0;
      attemptsLog.push(...current);
      await args.db.aIRun.update({ where: { id: runId }, data: { attempts: current as unknown as Prisma.InputJsonValue } });
    };
    /** 独立提交的终态写（H03/J02：崩溃安全） */
    const finalize = async (status: "succeeded" | "failed" | "skipped", errorCode: string | null, payload?: unknown): Promise<void> => {
      const fresh = await readRow();
      const outstanding = fresh?.reservedCost ?? new Prisma.Decimal(0);
      const paid = (fresh?.actualCost ?? new Prisma.Decimal(0)).gt(0);
      await args.db.aIRun.update({
        where: { id: runId },
        data: {
          status, errorCode, finishedAt: new Date(),
          // 未决预留存在（超时/usage未知）→ unknown；成功且无未决 → settled；有付费消耗 → settled；否则 released
          billingStatus: outstanding.gt(0) ? "unknown" : status === "succeeded" || paid ? "settled" : "released",
          ...(payload !== undefined ? { requestContext: { caller_key: args.idempotencyKey, cached_payload: payload as Prisma.InputJsonValue } } : {}),
        },
      });
    };

    for (;;) {
      // M01：每次请求（含修复）字符/token 预算先到者；超限不发送
      if (!inputWithinBudget(request.systemPrompt, request.userPrompt)) {
        lastErrorCode = "INPUT_TOO_LARGE";
        await appendAttempt({ type: "input_too_large", at: attemptsLog.length + 1 });
        await finalize("failed", lastErrorCode);
        return { runId, status: "failed", payload: null, errorCode: lastErrorCode, attempts: attemptsLog.length };
      }
      // H03/J02：claim 独立提交（网络调用前落盘，崩溃不回滚）
      const claim = await args.db.$transaction((tx) => claimAttempt(tx, { runId, orgId: args.orgId, inputTokens: estimateTokens(`${request.systemPrompt}\n${request.userPrompt}`), now: args.now }));
      if (claim.status === "attempts-exhausted") {
        lastErrorCode = lastErrorCode ?? "ATTEMPTS_EXHAUSTED";
        await appendAttempt({ type: "attempts_exhausted" });
        await finalize("failed", lastErrorCode);
        return { runId, status: "failed", payload: null, errorCode: lastErrorCode, attempts: attemptsLog.length };
      }
      if (claim.status === "budget-exceeded") {
        lastErrorCode = `AI_${claim.window === "daily" ? "DAILY" : "MONTHLY"}_BUDGET_EXCEEDED`;
        const outcome = attemptsLog.length === 0 ? "skipped" : "failed";
        await appendAttempt({ type: "budget_exceeded", window: claim.window });
        await finalize(outcome, lastErrorCode);
        return { runId, status: outcome, payload: null, errorCode: lastErrorCode, attempts: attemptsLog.length };
      }
      const reserve = claim.claim.reserveCost;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await transport.call(request, controller.signal);
        // H04：有 usage 即结算实际（独立提交）
        await args.db.$transaction((tx) => settleAttempt(tx, { runId, usage: response.usage, reserveCost: reserve, attemptNo: claim.claim.attemptNo }));
        let parsed: unknown = null;
        try { parsed = JSON.parse(response.content); } catch { parsed = null; }
        const schemaOk = parsed !== null && validate(parsed);
        if (!schemaOk) {
          const summary = safeSummary(parsed === null ? "输出不是合法JSON" : validate.errorsText());
          if (formatRepairs < MAX_FORMAT_REPAIRS) {
            formatRepairs += 1;
            await appendAttempt({ attempt: claim.claim.attemptNo, type: "format_repair", summary: summary.slice(0, 120) });
            request = repairPrompt(request, "SCHEMA_INVALID", summary);
            continue;
          }
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "schema_invalid", summary: summary.slice(0, 120) });
          await finalize("failed", "SCHEMA_INVALID");
          return { runId, status: "failed", payload: null, errorCode: "SCHEMA_INVALID", attempts: claim.claim.attemptNo };
        }
        const sem = runSemantic(parsed);
        if (sem) {
          // H06/J07：摘要只用错误码+安全摘要（semantic 消息不含未授权字段值）
          const summary = safeSummary(sem.message);
          if (formatRepairs < MAX_FORMAT_REPAIRS) {
            formatRepairs += 1;
            await appendAttempt({ attempt: claim.claim.attemptNo, type: "semantic_repair", summary: summary.slice(0, 120) });
            request = repairPrompt(request, "SEMANTIC_INVALID", summary);
            continue;
          }
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "semantic_invalid", summary: summary.slice(0, 120) });
          await finalize("failed", "SEMANTIC_INVALID");
          return { runId, status: "failed", payload: null, errorCode: "SEMANTIC_INVALID", attempts: claim.claim.attemptNo };
        }
        await appendAttempt({ attempt: claim.claim.attemptNo, type: "success", input_tokens: response.usage?.input_tokens ?? null, output_tokens: response.usage?.output_tokens ?? null });
        await finalize("succeeded", null, parsed);
        return { runId, status: "succeeded", payload: parsed, errorCode: null, attempts: claim.claim.attemptNo };
      } catch (error) {
        if (error instanceof ModelTransportError) {
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "transport", code: error.code, retryable: error.retryable });
          if (!error.retryable) {
            // J06：不可重试错误同任务终态——放弃本 attempt 未决预留（无消耗），已付费消耗保留
            await args.db.$transaction((tx) => releaseOutstanding(tx, { runId, reserveCost: reserve, attemptNo: claim.claim.attemptNo }));
            await finalize("failed", error.code);
            return { runId, status: "failed", payload: null, errorCode: error.code, attempts: claim.claim.attemptNo };
          }
          if (error.code !== "TIMEOUT") {
            await args.db.$transaction((tx) => releaseOutstanding(tx, { runId, reserveCost: reserve, attemptNo: claim.claim.attemptNo }));
          } // TIMEOUT：usage 未知保留未决预留（H04）
          lastErrorCode = error.code;
          await sleep(jitter(backoff[Math.min(claim.claim.attemptNo - 1, backoff.length - 1)]));
          continue;
        }
        if ((error as { name?: string })?.name === "AbortError") {
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "transport", code: "TIMEOUT", retryable: true });
          lastErrorCode = "TIMEOUT";
          await sleep(jitter(backoff[Math.min(claim.claim.attemptNo - 1, backoff.length - 1)]));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    await slots.release();
  }
}

/** H02：构建语义校验闭包；返回 string = 上下文缺失错误码（fail-closed） */
function buildSemanticValidator(args: RunGatewayArgs): string | ((parsed: unknown) => SemanticValidationError | null) {
  if (args.kind === "voc_classification") {
    if (!args.semantic?.voc) return "SEMANTIC_CONTEXT_MISSING";
    const voc = args.semantic.voc;
    return (parsed) => validateVocBatchSemantics(parsed as Parameters<typeof validateVocBatchSemantics>[0], voc);
  }
  if (args.kind === "daily_report") {
    if (!args.semantic?.whitelist) return "SEMANTIC_CONTEXT_MISSING";
    const whitelist = args.semantic.whitelist;
    return (parsed) => validateDailyConclusionSemantics(parsed as Parameters<typeof validateDailyConclusionSemantics>[0], whitelist);
  }
  if (!args.semantic?.whitelist) return "SEMANTIC_CONTEXT_MISSING";
  const whitelist = args.semantic.whitelist;
  return (parsed) => validateInsightSemantics(parsed as Parameters<typeof validateInsightSemantics>[0], whitelist);
}
