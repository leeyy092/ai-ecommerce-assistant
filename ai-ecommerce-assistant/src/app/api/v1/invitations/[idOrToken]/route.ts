/**
 * /api/v1/invitations/{idOrToken}（08 §17.2）
 * GET：公开按 token 预览（组织名/遮罩邮箱/到期时间；无内部数据；带防爆破限流）。
 * DELETE：O/A 在可管理范围内撤销（expected_version 乐观锁）。
 */
import type { NextRequest } from "next/server";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { fail, ok, serviceFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import {
  previewInvitationByToken,
  revokeInvitation,
} from "@/services/invitations";
import { consumeRateLimit } from "@/lib/rateLimit";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ idOrToken: string }> },
) {
  const { idOrToken } = await params;
  const db = getPrismaClient();

  // 未登录 token 枚举防爆破：60 次/IP/分钟
  const limit = await consumeRateLimit(db, `invite-preview:${clientIp(req)}`, 60, 60);
  if (!limit.allowed) {
    return fail(429, `请求过于频繁，请约 ${limit.retryAfterSeconds} 秒后重试`, {
      retryable: true,
    });
  }

  try {
    const preview = await previewInvitationByToken(db, idOrToken);
    // 公开响应只含组织名/遮罩邮箱/到期时间/角色，不返回原文 email
    return ok({
      org_name: preview.orgName,
      masked_email: preview.maskedEmail,
      expires_at: preview.expiresAt,
      role: preview.role,
    });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ idOrToken: string }> },
) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });

    let expectedVersion = Number(req.nextUrl.searchParams.get("expected_version"));
    if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
      return fail(422, "缺少合法的 expected_version");
    }

    const { idOrToken } = await params;
    await revokeInvitation(
      {
        db: getPrismaClient(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
      },
      idOrToken,
      expectedVersion,
    );
    return ok({ status: "revoked" });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    throw error;
  }
}
