/**
 * POST /api/v1/invitations/{token}/accept（08 §17.2）
 * 新用户：name+password 建立 Auth 身份（库哈希）并接受邀请（返回登录态 Cookie）。
 * 已有用户：须已登录且邮箱与受邀邮箱一致；原子消费 token（并发仅一次成功）。
 */
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getSessionContext } from "@/lib/session";
import { fail, ok } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { acceptInvitation, InvitationError } from "@/services/invitations";
import { consumeRateLimit } from "@/lib/rateLimit";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ idOrToken: string }> },
) {
  const { idOrToken } = await params;
  const db = getPrismaClient();

  // 接受端点防爆破：20 次/IP/分钟
  const limit = await consumeRateLimit(db, `invite-accept:${clientIp(req)}`, 20, 60);
  if (!limit.allowed) {
    return fail(429, `请求过于频繁，请约 ${limit.retryAfterSeconds} 秒后重试`, {
      retryable: true,
    });
  }

  let body: { name?: string; password?: string } = {};
  try {
    body = (await req.json()) as { name?: string; password?: string };
  } catch {
    // 允许空 body（已登录用户直接接受）
  }

  const sessionCtx = await getSessionContext(req);

  // 新用户接受成功后需携带登录态：记录 signUpEmail 返回的 token 并以 HttpOnly Cookie 下发
  let sessionToken: string | null = null;
  try {
    await acceptInvitation(db, {
      token: idOrToken,
      displayName: body.name,
      password: body.password,
      sessionUser: sessionCtx
        ? { id: sessionCtx.user.id, email: sessionCtx.user.email }
        : undefined,
      signUpNewUser: async (email, password, name) => {
        const result = await auth.api.signUpEmail({
          body: { email, password, name },
          asResponse: false,
        });
        sessionToken = result.token;
        return { authUserId: result.user.id };
      },
    });
  } catch (error) {
    if (error instanceof InvitationError) {
      return fail(error.status, error.message, { code: error.code });
    }
    throw error;
  }

  const response = ok({ status: "accepted" });
  if (sessionToken) {
    response.cookies.set("better-auth.session_token", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return response;
}
