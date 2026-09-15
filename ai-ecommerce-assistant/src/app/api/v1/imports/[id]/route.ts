/**
 * GET /api/v1/imports/{id}（TASK-007）：导入任务查询（状态/计数/版本）。
 */
import type { NextRequest } from "next/server";
import { ok, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { getImportTask } from "@/services/imports";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.manageSettings });
    const { id } = await params;
    const task = await getImportTask({ db: getPrismaClient(), orgId: ctx.orgId, userId: ctx.userId, role: ctx.role }, id);
    return ok(task);
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
