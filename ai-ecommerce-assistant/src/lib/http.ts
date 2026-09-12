/**
 * 业务 API 统一信封（08_API_SPEC §17.1）。
 * 成功 {data, meta:{request_id,...}}；错误 {error:{code,message,retryable,request_id}}。
 * 不返回 SQL、堆栈、模型原始输出；业务响应不缓存。
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function requestId(): string {
  return randomUUID();
}

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function ok<T>(data: T, meta: Record<string, unknown> = {}): NextResponse {
  // meta.status 可选指定 HTTP 状态码（如 201），不进入响应体 meta
  const { status, ...rest } = meta as { status?: number };
  return NextResponse.json(
    { data, meta: { request_id: requestId(), ...rest } },
    { status: Number.isFinite(status) ? Number(status) : 200, headers: NO_STORE },
  );
}

export interface ApiErrorOptions {
  code?: string;
  retryable?: boolean;
  fieldErrors?: Record<string, string>;
  extraMeta?: Record<string, unknown>;
}

export function fail(status: number, message: string, options: ApiErrorOptions = {}): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: options.code ?? defaultCode(status),
        message,
        retryable: options.retryable ?? defaultRetryable(status),
        ...(options.fieldErrors ? { field_errors: options.fieldErrors } : {}),
        request_id: requestId(),
      },
    },
    { status, headers: NO_STORE },
  );
}

export const unauthorized = () => fail(401, "未登录或会话已过期", { code: "UNAUTHENTICATED" });
export const forbidden = (message = "没有访问权限") => fail(403, message, { code: "FORBIDDEN" });
export const notFound = (message = "记录不存在") => fail(404, message, { code: "NOT_FOUND" });

/**
 * 服务层错误（AccessError/InvitationError/OwnerInitError 等 {status,code,message} 形态）
 * 统一映射为 API 错误信封；不匹配返回 null 交由调用方继续抛出。
 */
export function serviceFailure(error: unknown): NextResponse | null {
  if (
    error instanceof Error &&
    "status" in error &&
    "code" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const typed = error as { status: number; code: string; message: string };
    return fail(typed.status, typed.message, { code: typed.code });
  }
  return null;
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "VERSION_CONFLICT";
    case 422:
      return "VALIDATION_ERROR";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_ERROR";
  }
}

function defaultRetryable(status: number): boolean {
  return status === 429 || status === 503;
}
