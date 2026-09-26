/**
 * POST /api/v1/imports/{id}/commit（TASK-009；08 §17.3）
 * 用户确认预览后原子提交：preview_version CAS + confirmation=true；
 * 任一错误行任务已 failed 不能到本路由；中途异常整文件回滚恢复 preview_ready；
 * 已提交任务重放返回既有结果（200）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import { commitImportTask } from "@/services/imports/commitTask";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    preview_version: z.number().int().nonnegative(),
    confirmation: z.literal(true),
  })
  .strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const { id } = await params;
    const db = getPrismaClient();
    const task = await db.importTask.findFirst({ where: { orgId: ctx.orgId, id } });
    if (!task) return fail(404, "导入任务不存在", { code: "NOT_FOUND" });
    if (!canImport(ctx.role, task.sourceKind)) {
      return fail(403, "当前角色不能提交该类型导入", { code: "FILE_KIND_FORBIDDEN" });
    }
    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return fail(422, "需要 preview_version 与 confirmation=true", { code: "VALIDATION_ERROR" });
    }
    const result = await commitImportTask(
      { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role },
      id,
      parsedBody.data,
    );
    // 重放复用返回 200；首次提交返回 202
    return ok(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
