/**
 * /api/v1/invitations（08 §17.2）
 * POST：O/A 在可授予范围内创建一次性邀请（返回一次性 URL，不自动发送）。
 * GET：邀请列表（遮罩邮箱，不回原始 token）。
 */
import type { NextRequest } from "next/server";
import { getSessionContext } from "@/lib/session";
import { fail, ok, unauthorized } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import {
  createInvitation,
  InvitationError,
  listInvitations,
  type Role,
} from "@/services/invitations";
import { maskEmail } from "@/lib/email";
import { authBaseUrl } from "@/lib/auth";

const ROLES: Role[] = ["admin", "operator", "customer_service"];

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) return unauthorized();
  const membership = ctx.memberships[0];
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return fail(403, "只有 Owner/Admin 可以邀请成员");
  }

  let body: { email?: string; role?: string };
  try {
    body = (await req.json()) as { email?: string; role?: string };
  } catch {
    return fail(422, "请求体不是合法 JSON");
  }
  if (!body.email || !body.role || !ROLES.includes(body.role as Role)) {
    return fail(422, "email 与 role（admin/operator/customer_service）必填");
  }

  const baseUrl = authBaseUrl();
  try {
    const created = await createInvitation(
      {
        db: getPrismaClient(),
        orgId: membership.orgId,
        userId: ctx.user.id,
        role: membership.role,
      },
      { email: body.email, role: body.role as Role, baseUrl },
    );
    return ok(
      { id: created.id, url: created.url, expires_at: created.expiresAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InvitationError) {
      return fail(error.status, error.message, { code: error.code });
    }
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) return unauthorized();
  const membership = ctx.memberships[0];
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return fail(403, "只有 Owner/Admin 可以查看邀请");
  }
  const statusParam = req.nextUrl.searchParams.get("status");
  const status =
    statusParam === "pending" || statusParam === "expired" || statusParam === "revoked"
      ? statusParam
      : undefined;

  const invitations = await listInvitations(
    {
      db: getPrismaClient(),
      orgId: membership.orgId,
      userId: ctx.user.id,
      role: membership.role,
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
}
