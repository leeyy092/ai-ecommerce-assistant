/**
 * POST /api/v1/invitations/{token}/accept（08 §17.2；Gate-01 H05/H06 修复版）
 * 新用户：输入完整校验后创建 Auth 身份（库哈希）；登录态采用框架返回的完整
 * Set-Cookie（签名/命名/安全属性由 Better Auth 决定），路由只转发，不手工伪造。
 * 已有用户：须已登录且邮箱与受邀邮箱一致；token CAS 原子消费（并发仅一次成功）。
 * M03：区分合法空 body（已登录直接接受）与非法 JSON/多余字段（422）；
 * M02：限流键走统一代理信任边界（伪造 X-Forwarded-For 不能更换计数桶）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { getSessionContext } from "@/lib/session";
import { fail, ok, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { acceptInvitation, InvitationError } from "@/services/invitations";
import { clientIpFromRequest, consumeRateLimit } from "@/lib/rateLimit";

// M03：接受请求体为严格对象——仅 name/password 可选字段，拒绝未知字段；
// 具体语义校验（name 长度、password 强度/一致性）由服务层负责并返回 422
const acceptSchema = z
  .object({
    name: z.string().max(200).optional(),
    password: z.string().max(200).optional(),
  })
  .strict();

async function parseAcceptBody(req: NextRequest): Promise<{ ok: true; body: z.infer<typeof acceptSchema> } | { ok: false }> {
  const raw = await req.text();
  if (raw.trim() === "") return { ok: true, body: {} }; // 合法空 body：已登录用户直接接受
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { ok: false }; // 携带了请求体但不是合法 JSON
  }
  const parsed = acceptSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false };
  return { ok: true, body: parsed.data };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ idOrToken: string }> },
) {
  const { idOrToken } = await params;
  const blocked = guardWrite(req);
  if (blocked) return blocked;
  const db = getPrismaClient();

  const bodyOrError = await parseAcceptBody(req);
  if (!bodyOrError.ok) {
    return fail(422, "请求体须为可选 name/password 的 JSON 对象", { code: "VALIDATION_ERROR" });
  }
  const body = bodyOrError.body;

  // 接受端点防爆破：20 次/IP/分钟（M02：统一代理信任边界）
  const limit = await consumeRateLimit(db, `invite-accept:${clientIpFromRequest(req)}`, 20, 60);
  if (!limit.allowed) {
    return fail(429, `请求过于频繁，请约 ${limit.retryAfterSeconds} 秒后重试`, {
      retryable: true,
    });
  }

  const sessionCtx = await getSessionContext(req);

  // H05：保留框架 signUpEmail 的完整 Set-Cookie（含签名/安全属性），原样转发
  let frameworkCookies: string[] = [];
  try {
    await acceptInvitation(db, {
      token: idOrToken,
      displayName: body.name,
      password: body.password,
      sessionUser: sessionCtx
        ? { id: sessionCtx.user.id, email: sessionCtx.user.email }
        : undefined,
      signUpNewUser: async (email, password, name) => {
        const response = await getAuth().api.signUpEmail({
          body: { email, password, name },
          asResponse: true,
        });
        if (!response.ok) {
          throw new InvitationError(
            409,
            "IMPORT_CONFLICT",
            "该邮箱已存在账号，请直接登录后接受邀请",
          );
        }
        const created = (await response.json()) as { user?: { id?: string } };
        if (!created.user?.id) {
          throw new InvitationError(502, "AI_UNAVAILABLE", "认证服务返回异常，请重试");
        }
        frameworkCookies = response.headers.getSetCookie();
        return { authUserId: created.user.id };
      },
    });
  } catch (error) {
    if (error instanceof InvitationError) {
      return fail(error.status, error.message, { code: error.code });
    }
    const mapped = serviceFailureOf(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }

  const response = ok({ status: "accepted" });
  for (const cookie of frameworkCookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/** 服务层 {status,code,message} 错误 → API 信封（与 http.serviceFailure 同语义） */
function serviceFailureOf(error: unknown): Response | null {
  if (
    error instanceof Error &&
    "status" in error &&
    "code" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const typed = error as { status: number; code: string; message: string };
    return Response.json(
      {
        error: {
          code: typed.code,
          message: typed.message,
          retryable: false,
          request_id: crypto.randomUUID(),
        },
      },
      { status: typed.status },
    );
  }
  return null;
}
