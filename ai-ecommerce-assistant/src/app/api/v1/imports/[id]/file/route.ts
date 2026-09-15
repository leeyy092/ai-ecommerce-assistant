/**
 * GET /api/v1/imports/{id}/file?expires=...&signature=...（TASK-007）
 * 私有原文件的签名下载：HMAC（对象键+过期时间）校验 + 会话权限双重门槛；
 * 原始文件只存私有根，绝不经 public 静态路径暴露。
 */
import type { NextRequest } from "next/server";
import { fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { getObjectStream, verifyDownload } from "@/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.manageSettings });
    const { id } = await params;
    const db = getPrismaClient();
    const task = await db.importTask.findFirst({
      where: { orgId: ctx.orgId, id },
      select: { rawObjectKey: true, originalFilename: true },
    });
    if (!task || !task.rawObjectKey) {
      return fail(404, "导入任务或其文件不存在");
    }
    const url = new URL(req.url);
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    if (!verifyDownload({ key: task.rawObjectKey, expiresAt: expires, signature })) {
      return fail(403, "下载签名无效或已过期");
    }
    const stream = getObjectStream(task.rawObjectKey);
    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="import-${id}.csv"`,
        "cache-control": "private, no-store",
        "x-original-filename": encodeURIComponent(task.originalFilename),
      },
    });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
