/**
 * TASK-017｜AI 调用唯一入口（网关编排；T017R1 H01/H03/H06/M01 修复版）。
 *
 * - H01：缓存键由可信上下文派生（org/store/scope/dataset/ruleset/model/prompt/schema/inputHash），
 *   任一维度不匹配即不同运行，不复用旧 payload；
 * - H03：attempt 持久化于 ai_run.attempt_count（传输重试与格式修复共享总上限3，
 *   跨 Worker/重投递不重置）；同键在途等待复用；组织级 xact advisory lock 跨进程并发1；
 * - H04：每次 attempt 独立原子预留，有 usage 即结算实际并释放差额，超时保留未决预留；
 * - H06：失败只保存安全错误码/计量/脱敏摘要，不缓存不合法原文；修复请求只带错误码与
 *   原脱敏证据包，绝不回传原始模型输出；
 * - M01：每次请求（含修复）执行 12k 字符/16k 输入 token 先到者限制。
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  SCHEMA_VERSION, FIXED_MODEL_ID, PROMPT_VERSIONS, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS,
  MAX_FORMAT_REPAIRS, BACKOFF_MS, REQUEST_TIMEOUT_MS, validatorForKind,
} from "@/ai/schemas/validators";
import {
  ModelTransportError, getModelTransport, type ModelRequest, type ModelTransport,
} from "@/ai/providers/model-provider";
import {
  BudgetExceededError, createReservedRun, estimateReserveCost, claimAttempt, settleAttempt, releaseOutstanding, orgExecutionLockKey,
} from "@/ai/budget";
import {
  SemanticValidationError, validateInsightSemantics, validateVocBatchSemantics, validateDailyConclusionSemantics,
  type ReferenceWhitelist,
} from "@/ai/semantic";

export const AI_INPUT_MAX_CHARS = 12_000;

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
  /** 服务端可信语义上下文（所有 kind 强制；缺失即 fail-closed，B03） */
  semantic?: {
    whitelist?: ReferenceWhitelist;
    voc?: { batchMessageIds: Set<string>; normalizedTexts: Map<string, string>; taxonomyVersion: string };
  };
  transport?: ModelTransport;
  timeoutMs?: number;
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: Date;
  /** H03：在途等待上限（默认 70s ≈ 3×30s 超时） */
  inFlightWaitMs?: number;
}

function hashInput(args: { systemPrompt: string; userPrompt: string }): string {
  return createHash("sha256").update(JSON.stringify([args.systemPrompt, args.userPrompt])).digest("hex");
}

/** H01：业务缓存键 = 调用者键 × 可信上下文全维度（org/store/scope/dataset/ruleset/model/prompt/schema/inputHash） */
function deriveContextKey(args: RunGatewayArgs, promptVersion: string, inputHash: string): string {
  return createHash("sha256").update(JSON.stringify([
    args.idempotencyKey, args.orgId, args.storeId, args.visibilityScope,
    args.datasetVersion.toString(), args.rulesetVersion, FIXED_MODEL_ID, promptVersion, SCHEMA_VERSION, inputHash,
  ])).digest("hex").slice(0, 64);
}

/** 粗略 token 估算（预检；实际计费按 provider usage） */
function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 3.2);
}

/** M01：每次请求（含修复）输入预算——12k 字符 / 16k 输入 token 先到者 */
function inputWithinBudget(systemPrompt: string, userPrompt: string): boolean {
  const text = `${systemPrompt}\n${userPrompt}`;
  return text.length <= AI_INPUT_MAX_CHARS && estimateTokens(text) <= MAX_INPUT_TOKENS;
}

/** H06：修复提示只含错误码+安全摘要与原提示，绝不包含原始模型输出 */
function repairPrompt(original: ModelRequest, code: "SCHEMA_INVALID" | "SEMANTIC_INVALID", summary: string): ModelRequest {
  return {
    ...original,
    userPrompt: `${original.userPrompt}\n\n上一次输出未通过服务端校验（错误码 ${code}，摘要：${summary.slice(0, 200)}）。请仅依据原始证据重新输出完整合法的 JSON 对象。`,
  };
}

function jitter(base: number): number {
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

interface RunRow {
  id: string; status: string; attemptCount: number;
  requestContext: Prisma.JsonValue; errorCode: string | null; inputTokens: bigint | null; outputTokens: bigint | null;
}

async function waitForTerminal(db: PrismaClient, runId: string, waitMs: number): Promise<RunRow | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const row = await db.aIRun.findUnique({ where: { id: runId } }) as RunRow | null;
    if (!row) return null;
    if (["succeeded", "failed", "skipped", "superseded"].includes(row.status)) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

export async function runAiTask(args: RunGatewayArgs): Promise<GatewayResult> {
  const promptVersion = PROMPT_VERSIONS[args.kind === "daily_report" ? "daily_report" : args.kind === "voc_classification" ? "voc_classification" : "insight"];
  const inputHash = hashInput(args);
  const derivedKey = deriveContextKey(args, promptVersion, inputHash);
  const transport = args.transport ?? getModelTransport();
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = args.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const backoff = args.backoffMs ?? BACKOFF_MS;

  // H02/B03：所有 kind 强制语义上下文（缺失 fail-closed，不调用模型）
  const semanticError = buildSemanticValidator(args);
  if (typeof semanticError === "string") {
    return { runId: "", status: "failed", payload: null, errorCode: semanticError, attempts: 0 };
  }

  // H01：以派生键查找/建行（上下文任一维度不同 → 不同运行）
  const created = await createReservedRun(args.db, {
    orgId: args.orgId, storeId: args.storeId, kind: args.kind, idempotencyKey: derivedKey,
    datasetVersion: args.datasetVersion, rulesetVersion: args.rulesetVersion, visibilityScope: args.visibilityScope,
    modelId: FIXED_MODEL_ID, promptVersion, schemaVersion: SCHEMA_VERSION, inputHash,
    requestContext: { caller_key: args.idempotencyKey }, now: args.now,
  });
  const runId = created.id;

  const readRow = (): Promise<RunRow | null> => args.db.aIRun.findUnique({ where: { id: runId } }) as Promise<RunRow | null>;
  // 快路径：已成功 → 复用；已耗尽尝试的终态失败 → 直接返回（D02 不重置不重呼）
  let row = created.reused ? await readRow() : null;
  if (row && row.status === "succeeded") {
    return { runId, status: "reused", payload: (row.requestContext as { cached_payload?: unknown }).cached_payload ?? null, errorCode: null, attempts: row.attemptCount };
  }
  if (row && ["failed", "skipped", "superseded"].includes(row.status) && row.attemptCount >= 3) {
    return { runId, status: "failed", payload: null, errorCode: row.errorCode ?? "ATTEMPTS_EXHAUSTED", attempts: row.attemptCount };
  }
  if (row && row.status === "running") {
    // H03/A04：同键在途 → 等待终态后复用结果
    const terminal = await waitForTerminal(args.db, runId, args.inFlightWaitMs ?? 70_000);
    if (terminal) {
      if (terminal.status === "succeeded") {
        return { runId, status: "reused", payload: (terminal.requestContext as { cached_payload?: unknown }).cached_payload ?? null, errorCode: null, attempts: terminal.attemptCount };
      }
      return { runId, status: "failed", payload: null, errorCode: terminal.errorCode ?? "PROVIDER_UNAVAILABLE", attempts: terminal.attemptCount };
    }
    return { runId, status: "failed", payload: null, errorCode: "IN_FLIGHT_TIMEOUT", attempts: row.attemptCount };
  }

  // H03/H01：组织级 xact 锁串行化整个执行（跨进程并发 1；同组织同键自然去重）
  return args.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgExecutionLockKey(args.orgId)}))`;
    // 锁内再看一次终态（前一持有者可能已完成）
    const locked = await tx.aIRun.findUniqueOrThrow({ where: { id: runId } }) as RunRow;
    if (locked.status === "succeeded") {
      return { runId, status: "reused" as const, payload: (locked.requestContext as { cached_payload?: unknown }).cached_payload ?? null, errorCode: null, attempts: locked.attemptCount };
    }
    if (["failed", "skipped", "superseded"].includes(locked.status) && locked.attemptCount >= 3) {
      return { runId, status: "failed" as const, payload: null, errorCode: locked.errorCode ?? "ATTEMPTS_EXHAUSTED", attempts: locked.attemptCount };
    }

    const validate = validatorForKind(args.kind);
    const attemptsLog: Array<Record<string, unknown>> = [];
    let request: ModelRequest = { systemPrompt: args.systemPrompt, userPrompt: args.userPrompt };
    let formatRepairs = 0;
    let outstanding = new Prisma.Decimal(0);
    let lastErrorCode: string | null = null;

    const appendAttempt = async (entry: Record<string, unknown>): Promise<void> => {
      attemptsLog.push(entry);
      await tx.aIRun.update({ where: { id: runId }, data: { attempts: attemptsLog as unknown as Prisma.InputJsonValue } });
    };
    const finalize = async (status: "succeeded" | "failed" | "skipped", errorCode: string | null, payload?: unknown): Promise<void> => {
      const fresh = await tx.aIRun.findUniqueOrThrow({ where: { id: runId }, select: { reservedCost: true, actualCost: true } });
      const hasOutstanding = fresh.reservedCost.gt(0);
      const paid = (fresh.actualCost ?? new Prisma.Decimal(0)).gt(0);
      await tx.aIRun.update({
        where: { id: runId },
        data: {
          status, errorCode, finishedAt: new Date(),
          // 结算口径：成功或已产生实际消耗 → 计费保留（settled/unknown）；无消耗失败 → released
          billingStatus: status === "succeeded" ? "settled" : hasOutstanding ? "unknown" : paid ? "settled" : "released",
          ...(payload !== undefined ? { requestContext: { caller_key: args.idempotencyKey, cached_payload: payload as Prisma.InputJsonValue } } : {}),
        },
      });
    };

    for (;;) {
      // M01：每次请求（含修复）输入预算先到者；超限不发送
      if (!inputWithinBudget(request.systemPrompt, request.userPrompt)) {
        lastErrorCode = "INPUT_TOO_LARGE";
        await appendAttempt({ type: "input_too_large", at: attemptsLog.length + 1 });
        await finalize("failed", lastErrorCode);
        return { runId, status: "failed", payload: null, errorCode: lastErrorCode, attempts: attemptsLog.length };
      }
      // H03/H04：claim 持久化尝试 + 本 attempt 独立预算预留
      const claim = await claimAttempt(tx, { runId, orgId: args.orgId, inputTokens: estimateTokens(`${request.systemPrompt}\n${request.userPrompt}`), now: args.now });
      // 累计未决预留来自超时未知usage的attempt：保持持有（unknown），不得释放绕过预算
      if (claim.status === "attempts-exhausted") {
        lastErrorCode = lastErrorCode ?? "ATTEMPTS_EXHAUSTED";
        await finalize("failed", lastErrorCode);
        return { runId, status: "failed", payload: null, errorCode: lastErrorCode, attempts: attemptsLog.length };
      }
      if (claim.status === "budget-exceeded") {
        lastErrorCode = `AI_${claim.window === "daily" ? "DAILY" : "MONTHLY"}_BUDGET_EXCEEDED`;
        // 尚未发起过任何模型调用的运行：超额为 skipped（未执行）；已执行过的为 failed
        const outcome = attemptsLog.length === 0 ? "skipped" : "failed";
        await appendAttempt({ type: "budget_exceeded", window: claim.window });
        await finalize(outcome, lastErrorCode);
        return { runId, status: outcome, payload: null, errorCode: lastErrorCode, attempts: attemptsLog.length };
      }
      outstanding = outstanding.add(claim.claim.reserveCost);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await transport.call(request, controller.signal);
        // H04：有 usage 即结算实际并释放该次预留差额；token 累计（E04）
        await settleAttempt(tx, { runId, usage: response.usage, reserveCost: claim.claim.reserveCost });
        outstanding = outstanding.sub(claim.claim.reserveCost);
        let parsed: unknown = null;
        try { parsed = JSON.parse(response.content); } catch { parsed = null; }
        const schemaOk = parsed !== null && validate(parsed);
        if (!schemaOk) {
          const summary = parsed === null ? "输出不是合法JSON" : validate.errorsText();
          if (formatRepairs < MAX_FORMAT_REPAIRS) {
            formatRepairs += 1;
            await appendAttempt({ attempt: claim.claim.attemptNo, type: "format_repair", summary: summary.slice(0, 120) });
            request = repairPrompt(request, "SCHEMA_INVALID", summary); // H06：不含原始输出
            continue;
          }
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "schema_invalid", summary: summary.slice(0, 120) });
          await finalize("failed", "SCHEMA_INVALID"); // H06：不缓存不合法原文
          return { runId, status: "failed", payload: null, errorCode: "SCHEMA_INVALID", attempts: claim.claim.attemptNo };
        }
        // H02：强制语义校验（validator 已在入口保证存在）
        const sem = (semanticError as (parsed: unknown) => SemanticValidationError | null)(parsed);
        if (sem) {
          if (formatRepairs < MAX_FORMAT_REPAIRS) {
            formatRepairs += 1;
            await appendAttempt({ attempt: claim.claim.attemptNo, type: "semantic_repair", summary: sem.message.slice(0, 120) });
            request = repairPrompt(request, "SEMANTIC_INVALID", sem.message);
            continue;
          }
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "semantic_invalid", summary: sem.message.slice(0, 120) });
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
            // 已知终态失败：放弃本 attempt 未决预留（无消耗）；已付费消耗保留（H04）
            await releaseOutstanding(tx, { runId, reserveCost: claim.claim.reserveCost });
            outstanding = outstanding.sub(claim.claim.reserveCost);
            await finalize("failed", error.code);
            return { runId, status: "failed", payload: null, errorCode: error.code, attempts: claim.claim.attemptNo };
          }
          // 可重试（超时/限流/5xx）：超时且 usage 未知 → 保留该次预留（unknown，E03）
          if (error.code !== "TIMEOUT") {
            await releaseOutstanding(tx, { runId, reserveCost: claim.claim.reserveCost });
            outstanding = outstanding.sub(claim.claim.reserveCost);
          }
          lastErrorCode = error.code;
          await sleep(jitter(backoff[Math.min(claim.claim.attemptNo - 1, backoff.length - 1)]));
          continue; // 下一次 attempt 重新 claim（总次数持久共享，D01/D02）
        }
        if ((error as { name?: string })?.name === "AbortError") {
          await appendAttempt({ attempt: claim.claim.attemptNo, type: "transport", code: "TIMEOUT", retryable: true });
          lastErrorCode = "TIMEOUT";
          await sleep(jitter(backoff[Math.min(claim.claim.attemptNo - 1, backoff.length - 1)]));
          continue; // 保留未决预留（usage 未知）
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }, { timeout: (args.timeoutMs ?? REQUEST_TIMEOUT_MS) * 4 + 30_000 });
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
