/**
 * /api/v1/invitations（08 §17.2；TASK-004 起统一走 requirePermission）
 * POST：O/A 在可授予范围内创建一次性邀请（返回一次性 URL，不自动发送）。
 * GET：邀请列表（遮罩邮箱，不回原始 token）。
 */
import type { NextRequest } from "next/server";
import { ok, fail, serviceFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, type Role } from "@/services/access";
import { createInvitation, listInvitations } from "@/services/invitations";
import { maskEmail } from "@/lib/email";
import { authBaseUrl } from "@/lib/auth";

const ROLES: Role[] = ["admin", "operator", "customer_service"];

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });

    let body: { email?: string; role?: string };
    try {
      body = (await req.json()) as { email?: string; role?: string };
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    if (!body.email || !body.role || !ROLES.includes(body.role as Role)) {
      return fail(422, "email 与 role（admin/operator/customer_service）必填");
    }

    const created = await createInvitation(
      {
        db: getPrismaClient(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
      },
      { email: body.email, role: body.role as Role, baseUrl: authBaseUrl() },
    );
    return ok(
      { id: created.id, url: created.url, expires_at: created.expiresAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    throw error;
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
    throw error;
  }
}
