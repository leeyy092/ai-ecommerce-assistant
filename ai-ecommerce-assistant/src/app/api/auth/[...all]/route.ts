/**
 * Better Auth 原生路由（/api/auth/*，08 §17.2）。
 * Gate-01 H04：公开注册关闭——HTTP 层直接拒绝匿名 sign-up；
 * 受控创建路径（初始 Owner 脚本、邀请接受）走服务端 getAuth().api，不经本路由，不受影响。
 * 登录防爆破：sign-in/email 外层数据库持久限流（失败 10 次/IP/分钟 → 429；成功清零）。
 */
import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";
import { getPrismaClient } from "@/database/prisma";
import { clientIpFromRequest, consumeRateLimit, peekRateLimit, resetRateLimit } from "@/lib/rateLimit";

const LOGIN_FAIL_MAX = 10;
const WINDOW_SECONDS = 60;

// M03：每次拒绝都创建新 Response（复用同一 Response 会导致 body 被消费后丢失）
function publicSignupBlocked(): Response {
  return Response.json(
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
}

async function withLoginRateLimit(
  handler: (req: NextRequest) => Promise<Response>,
  req: NextRequest,
): Promise<Response> {
  const path = req.nextUrl.pathname;
  if (path.endsWith("/sign-up/email")) {
    return publicSignupBlocked();
  }
  if (!path.endsWith("/sign-in/email")) {
    return handler(req);
  }

  // M02：只在明确结果后计数——401 计入失败、200 清零、其他（400/429/503…）不变更计数
  const db = getPrismaClient();
  const key = `login-fail:${clientIpFromRequest(req)}`;
  const check = await peekRateLimit(db, key, LOGIN_FAIL_MAX, WINDOW_SECONDS);
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
    await consumeRateLimit(db, key, LOGIN_FAIL_MAX, WINDOW_SECONDS); // 计入失败
    return response;
  }
  if (response.status === 200) {
    await resetRateLimit(db, key); // 仅明确认证成功清零
  }
  return response;
}

// H10：处理器懒创建——next build 收集路由时不初始化认证，运行时首请求强校验环境
let handlers: ReturnType<typeof toNextJsHandler> | null = null;
function lazyHandlers(): ReturnType<typeof toNextJsHandler> {
  handlers ??= toNextJsHandler(getAuth());
  return handlers;
}

export async function GET(req: NextRequest): Promise<Response> {
  return lazyHandlers().GET(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return withLoginRateLimit(lazyHandlers().POST, req);
}
