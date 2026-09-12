/**
 * Better Auth 原生路由（/api/auth/*，08 §17.2）。
 * 在登录端点外包裹数据库持久限流：登录失败 10 次/IP/分钟 → 429（含等待秒数）；
 * 登录成功清除失败计数。公开注册未启用（账号仅经初始化与受控邀请建立）。
 */
import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getPrismaClient } from "@/database/prisma";
import { consumeRateLimit, resetRateLimit } from "@/lib/rateLimit";

const LOGIN_FAIL_MAX = 10;
const WINDOW_SECONDS = 60;

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}

async function withLoginRateLimit(
  handler: (req: NextRequest) => Promise<Response>,
  req: NextRequest,
): Promise<Response> {
  const isSignIn = req.nextUrl.pathname.endsWith("/sign-in/email");
  if (!isSignIn) return handler(req);

  const db = getPrismaClient();
  const key = `login-fail:${clientIp(req)}`;
  const check = await consumeRateLimit(db, key, LOGIN_FAIL_MAX, WINDOW_SECONDS);
  if (!check.allowed) {
    return Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: `登录失败次数过多，请约 ${check.retryAfterSeconds} 秒后重试`,
          retryable: true,
          request_id: crypto.randomUUID(),
        },
      },
      { status: 429, headers: { "Retry-After": String(check.retryAfterSeconds) } },
    );
  }

  const response = await handler(req);
  if (response.status === 401) {
    // 计入失败（consume 已 +1）；成功则清零
    return response;
  }
  await resetRateLimit(db, key);
  return response;
}

const handlers = toNextJsHandler(auth);

export async function GET(req: NextRequest): Promise<Response> {
  return handlers.GET(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return withLoginRateLimit(handlers.POST, req);
}
