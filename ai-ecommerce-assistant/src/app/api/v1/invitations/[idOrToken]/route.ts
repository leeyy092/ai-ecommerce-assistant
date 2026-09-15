/**
 * /api/v1/invitations/{idOrToken}（08 §17.2）
 * GET：公开按 token 预览（组织名/遮罩邮箱/到期时间；无内部数据；带防爆破限流）。
 * DELETE：O/A 在可管理范围内撤销（expected_version 正整数乐观锁；M01 来源守卫）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { fail, ok, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import {
  previewInvitationByToken,
  revokeInvitation,
} from "@/services/invitations";
import { clientIpFromRequest, consumeRateLimit } from "@/lib/rateLimit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ idOrToken: string }> },
) {
  const { idOrToken } = await params;
  const db = getPrismaClient();

  try {
    // 未登录 token 枚举防爆破：60 次/IP/分钟（M02：限流键走统一代理信任边界；
    // M03：限流属于可能失败的 DB 访问，纳入稳定异常边界）
    const limit = await consumeRateLimit(db, `invite-preview:${clientIpFromRequest(req)}`, 60, 60);
    if (!limit.allowed) {
      return fail(429, `请求过于频繁，请约 ${limit.retryAfterSeconds} 秒后重试`, {
        retryable: true,
      });
    }

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
    return internalFailure(error);
  }
}

// M03：DELETE 版本参数为正整数（拒绝 0/负数/小数/非数字）
const revokeSchema = z
  .object({ expected_version: z.number().int().positive() })
  .strict();

function parseRevokeVersion(req: NextRequest): { version: number } | { error: string } {
  const raw = req.nextUrl.searchParams.get("expected_version");
  if (raw === null || raw.trim() === "") {
    return { error: "缺少 expected_version" };
  }
  const parsed = revokeSchema.safeParse({ expected_version: Number(raw) });
  if (!parsed.success || !Number.isFinite(Number(raw))) {
    return { error: "expected_version 必须为正整数" };
  }
  return { version: parsed.data.expected_version };
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ idOrToken: string }> },
) {
  // M01：撤销属于业务写入口，纳入与创建/接受一致的可信来源守卫
  //（无请求体 DELETE 不做 MIME 检查；无 Origin 的服务端/脚本调用放行，Cookie 仍需有效）
  const blocked = guardWrite(req);
  if (blocked) return blocked;

  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });

    const versionOrError = parseRevokeVersion(req);
    if ("error" in versionOrError) {
      return fail(422, versionOrError.error);
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
      versionOrError.version,
    );
    return ok({ status: "revoked" });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
