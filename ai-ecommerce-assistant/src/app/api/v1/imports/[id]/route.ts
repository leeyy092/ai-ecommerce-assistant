/**
 * GET /api/v1/imports/{id}（TASK-007；G2-H05 修复版）
 * 查询能力改为全员基础权限 + 按当前角色可导入类型鉴权：
 * O/A/P 可读各自授权类型；C 仅 customer_messages；类型失权后旧任务拒绝（403）；
 * 跨组织 404 不变。
 */
import type { NextRequest } from "next/server";
import { ok, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { getImportTask } from "@/services/imports";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const { id } = await params;
    const task = await getImportTask({ db: getPrismaClient(), orgId: ctx.orgId, userId: ctx.userId, role: ctx.role }, id);
    return ok(task);
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
