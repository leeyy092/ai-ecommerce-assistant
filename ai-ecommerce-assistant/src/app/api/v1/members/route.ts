/**
 * GET /api/v1/members（08 §17.2）：O/A 查看组织成员（id/name/email/role/status）。
 */
import type { NextRequest } from "next/server";
import { getSessionContext } from "@/lib/session";
import { fail, ok, unauthorized } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";

export async function GET(req: NextRequest) {
  const ctx = await getSessionContext(req);
  if (!ctx) return unauthorized();
  const membership = ctx.memberships[0];
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    return fail(403, "只有 Owner/Admin 可以查看成员");
  }

  const rows = await getPrismaClient().membership.findMany({
    where: { orgId: membership.orgId },
    include: { user: { select: { id: true, displayName: true, email: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });

  return ok({
    items: rows.map((m) => ({
      id: m.id,
      user_id: m.user.id,
      name: m.user.displayName,
      email: m.user.email,
      role: m.role,
      status: m.status,
      user_status: m.user.status,
      row_version: m.rowVersion,
    })),
  });
}
