/**
 * Better Auth 原生路由（/api/auth/*，08 §17.2）。
 * Gate-01 H04：公开注册关闭——HTTP 层直接拒绝匿名 sign-up；
 * 受控创建路径（初始 Owner 脚本、邀请接受）走服务端 auth.api，不经本路由，不受影响。
 * 登录防爆破：sign-in/email 外层数据库持久限流（失败 10 次/IP/分钟 → 429；成功清零）。
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

const PUBLIC_SIGNUP_BLOCKED = Response.json(
  {
    error: {
      code: "PUBLIC_SIGNUP_DISABLED",
      message: "系统不提供公开注册；账号由部署初始化与管理员邀请建立",
      retryable: false,
      request_id: crypto.randomUUID(),
    },
  },
  { status: 403 },
);

async function withLoginRateLimit(
  handler: (req: NextRequest) => Promise<Response>,
  req: NextRequest,
): Promise<Response> {
  const path = req.nextUrl.pathname;
  if (path.endsWith("/sign-up/email")) {
    return PUBLIC_SIGNUP_BLOCKED;
  }
  if (!path.endsWith("/sign-in/email")) {
    return handler(req);
  }

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
