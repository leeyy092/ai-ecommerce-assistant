/**
 * POST /api/v1/imports（08 §17；TASK-007）
 * multipart 上传：store_id、data_source_id、source_kind（六类）、idempotency_key?、file。
 * 角色文件类型限制（C 仅 customer_messages）；20MB/10 万行上限；重复请求返回同任务。
 * 上传即返回任务（异步校验走 pg-boss validate 队列，不阻塞浏览器）。
 */
import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import { createImportTaskFromBuffer, isSourceKind, SOURCE_KINDS } from "@/services/imports";
import { enqueueValidate } from "@/jobs/queue";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    // 上传能力：全员基础权限 + 角色文件类型限制（C 仅客户消息，见 canImport）
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(422, "请求须为 multipart/form-data");
    }
    const storeId = String(form.get("store_id") ?? "");
    const dataSourceId = String(form.get("data_source_id") ?? "");
    const sourceKindRaw = String(form.get("source_kind") ?? "");
    const idempotencyKey = form.get("idempotency_key") ? String(form.get("idempotency_key")) : undefined;
    const file = form.get("file");

    if (!storeId || !dataSourceId || !sourceKindRaw) {
      return fail(422, "store_id、data_source_id、source_kind 必填");
    }
    if (!isSourceKind(sourceKindRaw)) {
      return fail(422, `source_kind 不支持：${sourceKindRaw}`, {
        fieldErrors: { source_kind: `仅支持 ${SOURCE_KINDS.join("/")}` },
      });
    }
    // 角色文件类型限制（02_USER_ROLES：C 仅客户消息）
    if (!canImport(ctx.role, sourceKindRaw)) {
      return fail(403, "当前角色不能上传该类型文件", { code: "FILE_KIND_FORBIDDEN" });
    }
    if (!(file instanceof File) || file.size === 0) {
      return fail(422, "缺少上传文件 file");
    }

    const result = await createImportTaskFromBuffer(
      { db: getPrismaClient(), orgId: ctx.orgId, userId: ctx.userId, role: ctx.role },
      {
        storeId,
        dataSourceId,
        sourceKind: sourceKindRaw,
        filename: file.name || "upload.csv",
        idempotencyKey,
      },
      Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
    );

    // 已入库的新任务异步投递校验（复用任务不重复入队）
    if (!result.reused) {
      await enqueueValidate(result.id).catch(() => undefined);
    }
    return ok(
      {
        id: result.id,
        status: result.status,
        file_sha256: result.fileSha256,
        row_count: result.rowCount,
        reused: result.reused,
      },
      { status: result.reused ? 200 : 201 },
    );
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
