/**
 * PUT /api/v1/imports/{id}/mapping（TASK-008；08 §17.3）
 * 提交字段映射、时区确认与覆盖声明，CAS expected_preview_version 后重跑全量
 * 校验（202 validating）；合法表头+显式零事件可生成 coverage-only 预览。
 * C 仅 customer_messages（02_USER_ROLES）；任一错误行存在时任务 failed，
 * 不能进入提交（TASK-009）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import { validateFieldMapping, mappingVersion } from "@/services/importPreview";
import { createCanonicalBatch, isFileKind } from "@/adapters/contracts";
import { enqueueValidate } from "@/jobs/queue";

export const runtime = "nodejs";

const coverageItem = z.object({
  source_kind: z.string(),
  channel: z.enum(["default", "case", "refund"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["complete", "partial"]),
  explicit_zero_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

const bodySchema = z
  .object({
    field_mapping: z.record(z.string(), z.string()).optional().default({}),
    timezone: z.string().min(1),
    coverage_declaration: z.array(coverageItem),
    expected_preview_version: z.number().int().nonnegative(),
  })
  .strict();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const { id } = await params;
    const db = getPrismaClient();

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return fail(422, "请求体校验失败", {
        code: "VALIDATION_ERROR",
        fieldErrors: Object.fromEntries(
          Object.entries(parsedBody.error.flatten().fieldErrors).map(([k, v]) => [k, v.join("; ")]),
        ),
      });
    }
    const body = parsedBody.data;

    const task = await db.importTask.findFirst({ where: { orgId: ctx.orgId, id } });
    if (!task) return fail(404, "导入任务不存在", { code: "NOT_FOUND" });
    if (!isFileKind(task.sourceKind)) {
      return fail(422, "未知来源类型", { code: "VALIDATION_ERROR" });
    }
    if (!canImport(ctx.role, task.sourceKind)) {
      return fail(403, "当前角色不能操作该类型导入任务", { code: "FILE_KIND_FORBIDDEN" });
    }
    // 状态机：uploaded/preview_ready/failed 可重新映射；其余 409（08：409状态变化）
    if (!["uploaded", "preview_ready", "failed"].includes(task.status)) {
      return fail(409, `当前状态 ${task.status} 不允许重新映射`, { code: "IMPORT_CONFLICT" });
    }
    // CAS：预期预览版本不符 → 409 VERSION_CONFLICT（客户端刷新后重试）
    if (body.expected_preview_version !== task.previewVersion) {
      return fail(409, "预览版本已变化，请刷新后重试", { code: "VERSION_CONFLICT" });
    }
    // 时区确认：必须与店铺固定时区一致（店铺事实后时区已锁定）
    const store = await db.store.findUniqueOrThrow({
      where: { id: task.storeId },
      select: { timezone: true },
    });
    if (body.timezone !== store.timezone) {
      return fail(422, `时区确认与店铺时区不一致（店铺为 ${store.timezone}）`, { code: "VALIDATION_ERROR" });
    }
    // 字段映射校验（键=标准字段、值不重复、不映射服务端保留列）
    const mapping = validateFieldMapping(task.sourceKind, body.field_mapping);
    if (!mapping.ok) {
      return fail(422, mapping.message, { code: "VALIDATION_ERROR" });
    }
    // 覆盖声明结构校验（复用 CanonicalBatch 的声明校验；source_kind 必须与本任务一致）
    try {
      createCanonicalBatch({
        sourceKind: task.sourceKind,
        sourceNamespace: "mapping-validation",
        storeId: task.storeId,
        adapterKind: "csv",
        rawChecksum: task.fileSha256,
        parse: { kind: task.sourceKind, records: [], errors: [] },
        coverageDeclaration: body.coverage_declaration.map((c) => ({
          ...c,
          source_kind: task.sourceKind,
        })),
      });
    } catch (error) {
      return fail(422, error instanceof Error ? error.message : "coverage_declaration 非法", {
        code: "VALIDATION_ERROR",
      });
    }

    const version = mappingVersion(mapping.fields);
    const updated = await db.importTask.updateMany({
      where: { id: task.id, previewVersion: task.previewVersion },
      data: {
        mapping: { fields: mapping.fields, mapping_version: version, ignored_columns: [] },
        coverageDeclaration: body.coverage_declaration,
        status: "validating",
        errorCode: null,
      },
    });
    if (updated.count === 0) {
      return fail(409, "预览版本已变化，请刷新后重试", { code: "VERSION_CONFLICT" });
    }
    await enqueueValidate(task.id);
    return ok({ id: task.id, status: "validating" }, { status: 202 });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
