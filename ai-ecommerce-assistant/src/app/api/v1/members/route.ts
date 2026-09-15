/**
 * GET /api/v1/members（08 §17.2；TASK-004 起统一走 requirePermission）。
 */
import type { NextRequest } from "next/server";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { ok, serviceFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });

    const rows = await getPrismaClient().membership.findMany({
      where: { orgId: ctx.orgId },
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
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    throw error;
  }
}
