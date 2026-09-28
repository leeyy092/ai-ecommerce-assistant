/**
 * TASK-017｜唯一服务端模型 Provider（06 §8.1/§8.2）。
 *
 * 合同：百炼北京 compatible-mode + 固定模型 qwen-flash-2025-07-28、非思考、json_object；
 * Key 只在服务端读取，绝不进入日志或响应。超时/限流/5xx 才退避重试（5s/20s+jitter），
 * 鉴权/未知模型/权限错误立即终止；总尝试≤3、格式修复≤1（修复在 gateway 层）。
 * transport 可注入 stub 供故障验证；不引入第二厂商、Agent 框架或前端直连。
 */
import { FIXED_MODEL_ID, REQUEST_TIMEOUT_MS, BACKOFF_MS } from "@/ai/schemas/validators";
import { loadEnv } from "@/lib/env";

export type ModelErrorCode =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_5XX"
  | "AUTH_ERROR"
  | "UNKNOWN_MODEL"
  | "PERMISSION_ERROR"
  | "NETWORK_ERROR"
  | "PROVIDER_UNAVAILABLE";

export class ModelTransportError extends Error {
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  constructor(code: ModelErrorCode, retryable: boolean, status?: number) {
    super(`model transport error: ${code}`);
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ModelResponse {
  content: string;
  usage: ModelUsage | null;
  finishReason?: string | null;
}

export interface ModelRequest {
  systemPrompt: string;
  userPrompt: string;
  /** 输出 token 上限（默认 6000，06 §24.2） */
  maxOutputTokens?: number;
}

export interface ModelTransport {
  call(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
}

export interface ModelProviderConfig {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  timeoutMs?: number;
  backoffMs?: number[];
  fetchImpl?: typeof fetch;
}

/** 固定模型核验：不允许私换模型/供应商（06 §8.1） */
export function assertFixedModel(modelId: string): void {
  if (modelId !== FIXED_MODEL_ID) {
    throw new ModelTransportError("UNKNOWN_MODEL", false);
  }
}

/** 分类供应商错误（仅依赖安全状态码，不解析正文里的秘密） */
export function classifyStatus(status: number): ModelTransportError | null {
  if (status === 401 || status === 403) return new ModelTransportError("AUTH_ERROR", false, status);
  if (status === 404) return new ModelTransportError("UNKNOWN_MODEL", false, status);
  if (status === 429) return new ModelTransportError("RATE_LIMITED", true, status);
  if (status >= 500) return new ModelTransportError("PROVIDER_5XX", true, status);
  return null;
}

function jitter(base: number): number {
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export class HttpModelTransport implements ModelTransport {
  private readonly cfg: Required<Pick<ModelProviderConfig, "apiKey" | "baseUrl" | "modelId">> & Pick<ModelProviderConfig, "timeoutMs" | "backoffMs" | "fetchImpl">;

  constructor(cfg: ModelProviderConfig) {
    assertFixedModel(cfg.modelId);
    this.cfg = cfg;
  }

  async call(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const fetchImpl = this.cfg.fetchImpl ?? fetch;
    const res = await fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        // Key 只出现在请求头，不进入任何日志/错误文本
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.modelId,
        // 非思考模式（qwen-flash 非思考档）
        enable_thinking: false,
        response_format: { type: "json_object" },
        max_tokens: req.maxOutputTokens ?? 6000,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      }),
    });
    const classified = classifyStatus(res.status);
    if (classified) throw classified;
    if (!res.ok) throw new ModelTransportError("PROVIDER_UNAVAILABLE", false, res.status);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new ModelTransportError("PROVIDER_UNAVAILABLE", false, res.status);
    return {
      content,
      usage: body.usage
        ? { input_tokens: body.usage.prompt_tokens ?? 0, output_tokens: body.usage.completion_tokens ?? 0 }
        : null,
      finishReason: body.choices?.[0]?.finish_reason ?? null,
    };
  }
}

/** 从环境构建真实 provider 配置；三配置任一为空即视为未配置（不打印任何值） */
export function realProviderConfigFromEnv(source: VarSource = process.env): ModelProviderConfig | null {
  const env = loadEnv(["ai"], source as NodeJS.ProcessEnv);
  if (!env.ai) return null;
  assertFixedModel(env.ai.modelId);
  return { apiKey: env.ai.apiKey, baseUrl: env.ai.baseUrl, modelId: env.ai.modelId };
}

type VarSource = Record<string, string | undefined>;

let transportOverride: ModelTransport | null = null;
/** 仅供测试注入 stub；生产代码不得调用 */
export function setModelTransportForTests(t: ModelTransport | null): void {
  transportOverride = t;
}

export function getModelTransport(cfg?: ModelProviderConfig | null): ModelTransport {
  if (transportOverride) return transportOverride;
  const config = cfg ?? realProviderConfigFromEnv();
  if (!config) throw new ModelTransportError("PROVIDER_UNAVAILABLE", false);
  return new HttpModelTransport(config);
}

export interface CallWithRetryOptions {
  timeoutMs?: number;
  backoffMs?: number[];
  maxAttempts?: number;
  /** 测试注入：跳过真实 sleep */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 单次模型调用 + 传输层重试（超时/限流/5xx 退避 5s/20s+jitter，尊重 Retry-After 类状态；
 * 鉴权/未知模型立即终止）。格式修复重试在 gateway 层，不计入传输重试次数语义。
 */
export async function callModelWithRetry(
  transport: ModelTransport,
  req: ModelRequest,
  opts: CallWithRetryOptions = {},
): Promise<{ response: ModelResponse; attempts: number }> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? BACKOFF_MS;
  const maxAttempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport.call(req, controller.signal);
      return { response, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (error instanceof ModelTransportError) {
        if (!error.retryable || attempt >= maxAttempts) throw error;
      } else if ((error as { name?: string })?.name === "AbortError") {
        const wrapped = new ModelTransportError("TIMEOUT", true);
        if (attempt >= maxAttempts) throw wrapped;
        lastError = wrapped;
      } else {
        const wrapped = new ModelTransportError("NETWORK_ERROR", true);
        if (attempt >= maxAttempts) throw wrapped;
        lastError = wrapped;
      }
      await sleep(jitter(backoff[Math.min(attempt - 1, backoff.length - 1)]));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
