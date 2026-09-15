/**
 * /api/v1/invitations（08 §17.2；TASK-004 起统一走 requirePermission）
 * POST：O/A 在可授予范围内创建一次性邀请（返回一次性 URL，不自动发送）。
 * GET：邀请列表（遮罩邮箱，不回原始 token）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, type Role } from "@/services/access";
import { createInvitation, listInvitations } from "@/services/invitations";
import { maskEmail } from "@/lib/email";
import { authBaseUrl } from "@/lib/auth";

// M03：严格对象校验——仅 email/role 字段，拒绝额外字段与非字符串类型
const createSchema = z
  .object({
    email: z.string({ message: "email 必须为字符串" }).max(200),
    role: z.enum(["admin", "operator", "customer_service"]),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await req.text());
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const parsed = createSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.map(String).join(".") || "_"] = issue.message;
      }
      return fail(422, "email 与 role（admin/operator/customer_service）必填", { fieldErrors });
    }

    const created = await createInvitation(
      {
        db: getPrismaClient(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
      },
      { email: parsed.data.email, role: parsed.data.role as Role, baseUrl: authBaseUrl() },
    );
    return ok(
      { id: created.id, url: created.url, expires_at: created.expiresAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });
    const statusParam = req.nextUrl.searchParams.get("status");
    const status =
      statusParam === "pending" || statusParam === "expired" || statusParam === "revoked"
        ? statusParam
        : undefined;

    const invitations = await listInvitations(
      {
        db: getPrismaClient(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
      },
      { status },
    );

    return ok({
      items: invitations.map((i) => ({
        id: i.id,
        email: maskEmail(i.email),
        role: i.role,
        expires_at: i.expiresAt.toISOString(),
        status: i.status,
        row_version: i.rowVersion,
      })),
    });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
