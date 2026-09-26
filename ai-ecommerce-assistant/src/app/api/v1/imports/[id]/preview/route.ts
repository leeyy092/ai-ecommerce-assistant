/**
 * GET /api/v1/imports/{id}/preview（TASK-008；08 §17.3）
 * 脱敏样本（cursor/limit≤100）、insert/update/unchanged/rejected 计数、
 * 覆盖声明与缺口、文件 hash、preview_version；仅 preview_ready 可读（409 尚未校验）。
 * 样本来自 staging manifest 私有对象；自由文本脱敏，不回显客户原文。
 */
import type { NextRequest } from "next/server";
import { ok, fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import { getObjectText } from "@/storage";

export const runtime = "nodejs";

interface Manifest {
  kind: string;
  mapping_version: string;
  adapter_version: string;
  file_sha256: string;
  coverage_declaration: Array<{
    source_kind: string;
    channel: string;
    from: string;
    to: string;
    status: string;
    explicit_zero_dates: string[];
  }>;
  ignored_columns: string[];
  row_count: number;
  counts: {
    insert: number;
    update: number;
    unchanged: number;
    rejected: number;
    duplicates_folded: number;
    superseded_in_file: number;
    superseded_by_db: number;
  };
  coverage_gaps: string[];
  coverage_only: boolean;
  empty_file: boolean;
  rows: Array<{
    row: number;
    action: string;
    reason: string | null;
    natural_key: Record<string, string>;
    affected_dates: string[];
    sample: Record<string, unknown>;
  }>;
  generated_at: string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const { id } = await params;
    const db = getPrismaClient();
    const task = await db.importTask.findFirst({ where: { orgId: ctx.orgId, id } });
    if (!task) return fail(404, "导入任务不存在", { code: "NOT_FOUND" });
    if (!canImport(ctx.role, task.sourceKind)) {
      return fail(403, "当前角色不能查看该类型导入预览", { code: "FILE_KIND_FORBIDDEN" });
    }
    // 08：409 尚未校验（uploaded/validating/failed 均无可用预览）
    if (task.status !== "preview_ready" || !task.stagingObjectKey) {
      return fail(409, `当前状态 ${task.status} 尚无可确认预览`, { code: "PREVIEW_NOT_READY" });
    }
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 25);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 25;
    const cursorRaw = Number(url.searchParams.get("cursor") ?? "0");
    const cursor = Number.isFinite(cursorRaw) ? Math.max(Math.trunc(cursorRaw), 0) : 0;

    const manifest = JSON.parse(await getObjectText(task.stagingObjectKey)) as Manifest;
    const rows = manifest.rows;
    const page = rows.slice(cursor, cursor + limit);
    const nextCursor = cursor + page.length < rows.length ? cursor + page.length : null;

    return ok({
      id: task.id,
      status: task.status,
      preview_version: task.previewVersion,
      base_dataset_version: task.baseDatasetVersion.toString(),
      file_sha256: task.fileSha256,
      mapping_version: manifest.mapping_version,
      adapter_version: manifest.adapter_version,
      row_count: manifest.row_count,
      counts: {
        insert: manifest.counts.insert,
        update: manifest.counts.update,
        unchanged: manifest.counts.unchanged,
        rejected: manifest.counts.rejected,
        duplicates_folded: manifest.counts.duplicates_folded,
        superseded_in_file: manifest.counts.superseded_in_file,
        superseded_by_db: manifest.counts.superseded_by_db,
      },
      coverage: {
        declaration: manifest.coverage_declaration,
        gaps: manifest.coverage_gaps,
        coverage_only: manifest.coverage_only,
        empty_file: manifest.empty_file,
      },
      ignored_columns: manifest.ignored_columns,
      items: page,
      next_cursor: nextCursor,
    });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
