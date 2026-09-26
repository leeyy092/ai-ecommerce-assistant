/**
 * GET /api/v1/imports/{id}/file?expires=...&signature=...（TASK-007；G2-H05 修复版）
 * 三重门槛：会话（全员基础权限）→ 当前角色可导入类型（C 仅消息，订单 403）
 * → HMAC 签名（对象键+过期，恒时比较）。原文件只存私有根，不经 public 暴露。
 */
import type { NextRequest } from "next/server";
import { fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import { getObjectStream, verifyDownload } from "@/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const { id } = await params;
    const db = getPrismaClient();
    const task = await db.importTask.findFirst({
      where: { orgId: ctx.orgId, id },
      select: { rawObjectKey: true, originalFilename: true, sourceKind: true },
    });
    if (!task || !task.rawObjectKey) {
      return fail(404, "导入任务或其文件不存在");
    }
    // G2-H05：下载签发与读取都按当前能力重新鉴权（降权后旧链接随会话拒绝）
    if (!canImport(ctx.role, task.sourceKind)) {
      return fail(403, "当前角色不能下载该类型文件", { code: "FILE_KIND_FORBIDDEN" });
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
