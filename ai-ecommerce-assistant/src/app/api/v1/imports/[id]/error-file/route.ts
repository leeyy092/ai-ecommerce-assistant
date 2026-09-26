/**
 * GET /api/v1/imports/{id}/error-file（TASK-008；08 §17.3）
 * 无签名参数：签发 5 分钟下载 URL（等同 300 秒签名）；404 无错误文件。
 * 带有效签名：流式返回逐行错误 CSV（行号/列/错误码/安全说明，已脱敏）。
 * C 仅 customer_messages；跨组织 404。
 */
import type { NextRequest } from "next/server";
import { ok, fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import { getObjectText, signDownload, verifyDownload } from "@/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const { id } = await params;
    const db = getPrismaClient();
    const task = await db.importTask.findFirst({ where: { orgId: ctx.orgId, id } });
    if (!task) return fail(404, "导入任务不存在", { code: "NOT_FOUND" });
    if (!canImport(ctx.role, task.sourceKind)) {
      return fail(403, "当前角色不能下载该类型错误文件", { code: "FILE_KIND_FORBIDDEN" });
    }
    if (!task.errorObjectKey) {
      return fail(404, "该任务没有错误文件", { code: "NO_ERROR_FILE" });
    }
    const url = new URL(req.url);
    const expires = url.searchParams.get("expires");
    const signature = url.searchParams.get("signature");
    if (expires && signature) {
      if (!verifyDownload({ key: task.errorObjectKey, expiresAt: Number(expires), signature })) {
        return fail(403, "下载签名无效或已过期", { code: "FORBIDDEN" });
      }
      const text = await getObjectText(task.errorObjectKey);
      return new Response(text, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="errors-${task.id}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }
    const sig = signDownload(task.errorObjectKey);
    return ok({
      url: `/api/v1/imports/${task.id}/error-file?expires=${sig.expiresAt}&signature=${sig.signature}`,
      expires_at: new Date(sig.expiresAt).toISOString(),
    });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
