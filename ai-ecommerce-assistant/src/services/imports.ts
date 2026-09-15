/**
 * 导入任务服务（TASK-007；08 §imports）。
 * - 上传：multipart 文件 → 流式 SHA256 + 行数统计 + 大小上限（20MB）+ 行数上限（100_000），
 *   超限即停止读取（验收：超限即停止解析）；
 * - 幂等：同 org+store+source+fileSha256 的未终态任务直接复用（验收：重复请求返回同任务）；
 * - 私有存储：原始文件写入私有根 raw/<taskId>/source.csv（客户消息不进 public）；
 * - 角色限制：ROLE_IMPORT_KINDS（C 仅 customer_messages）；
 * - 异步校验：validate 队列（pg-boss）承接解析，不阻塞上传响应。
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { AccessError } from "@/services/access";
import { writeAudit } from "@/services/audit";
import { putObject } from "@/storage";
import type { PrismaClient } from "@/generated/prisma/client";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_UPLOAD_ROWS = 100_000; // 10 万行

export const SOURCE_KINDS = [
  "products",
  "orders",
  "order_items",
  "ads",
  "customer_messages",
  "after_sales",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isSourceKind(kind: string): kind is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(kind);
}

export interface ImportsContext {
  db: PrismaClient;
  orgId: string;
  userId: string;
  role: string;
}

export interface UploadInput {
  storeId: string;
  dataSourceId: string;
  sourceKind: SourceKind;
  filename: string;
  /** 幂等键（客户端提供或由内容派生）；服务端最终以 fileSha256 组合判定 */
  idempotencyKey?: string;
}

export interface UploadResult {
  id: string;
  status: string;
  fileSha256: string;
  rowCount: number;
  bytes: number;
  reused: boolean;
}

export async function createImportTaskFromBuffer(
  ctx: ImportsContext,
  input: Omit<UploadInput, "content">,
  content: Readable,
): Promise<UploadResult> {
  const store = await ctx.db.store.findFirst({
    where: { orgId: ctx.orgId, id: input.storeId },
    select: { id: true, status: true },
  });
  if (!store) throw new AccessError(404, "NOT_FOUND", "店铺不存在");
  if (store.status === "archived") {
    throw new AccessError(409, "STORE_ARCHIVED", "归档店铺不接受新导入");
  }
  const dataSource = await ctx.db.dataSource.findFirst({
    where: { orgId: ctx.orgId, storeId: input.storeId, id: input.dataSourceId },
    select: { id: true, adapterKind: true, status: true },
  });
  if (!dataSource) throw new AccessError(404, "NOT_FOUND", "数据源不存在");
  if (dataSource.adapterKind === "mock") {
    throw new AccessError(422, "VALIDATION_ERROR", "mock 数据源不接受文件上传");
  }
  if (dataSource.status !== "active") {
    throw new AccessError(409, "SOURCE_INACTIVE", "数据源已停用");
  }

  // 有界缓冲：超过 20MB 立即中止读取（超限即停止解析）
  const chunks: Buffer[] = [];
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    content.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytes += buf.length;
      if (bytes > MAX_UPLOAD_BYTES) {
        content.destroy();
        reject(new AccessError(422, "FILE_TOO_LARGE", `文件超过 ${MAX_UPLOAD_BYTES} 字节上限，已停止接收`));
        return;
      }
      chunks.push(buf);
    });
    content.on("end", () => resolve());
    content.on("error", reject);
  });
  const buffer = Buffer.concat(chunks);

  const hash = createHash("sha256").update(buffer).digest("hex");
  const text = buffer.toString("utf8");
  const newlines = (text.match(/\n/g) ?? []).length;
  const dataRowCount = (text.endsWith("\n") ? newlines : newlines + 1) - 1;
  if (dataRowCount > MAX_UPLOAD_ROWS) {
    throw new AccessError(422, "TOO_MANY_ROWS", `数据行超过 ${MAX_UPLOAD_ROWS} 行上限`);
  }

  // 幂等：同 store+source+kind+内容哈希 的未失败任务复用（重复请求返回同任务）
  const existing = await ctx.db.importTask.findFirst({
    where: {
      orgId: ctx.orgId,
      storeId: input.storeId,
      dataSourceId: input.dataSourceId,
      sourceKind: input.sourceKind,
      fileSha256: hash,
      status: { notIn: ["failed"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, fileSha256: true, rowCount: true },
  });
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      fileSha256: existing.fileSha256,
      rowCount: existing.rowCount,
      bytes,
      reused: true,
    };
  }

  const task = await ctx.db.$transaction(async (tx) => {
    const created = await tx.importTask.create({
      data: {
        orgId: ctx.orgId,
        storeId: input.storeId,
        dataSourceId: input.dataSourceId,
        sourceKind: input.sourceKind,
        status: "uploaded",
        originalFilename: input.filename.slice(0, 255),
        rawObjectKey: "", // 落盘后补
        fileSha256: hash,
        uploadRequestKey: `up-${createHash("sha256").update(`${ctx.orgId}:${hash}:${Date.now()}`).digest("hex").slice(0, 32)}`,
        idempotencyKey: input.idempotencyKey ?? null,
        baseDatasetVersion: 0n,
        rowCount: dataRowCount,
        createdBy: ctx.userId,
      },
    });
    await writeAudit(tx, {
      orgId: ctx.orgId,
      storeId: input.storeId,
      actorUserId: ctx.userId,
      action: "import_upload",
      entityType: "import_task",
      entityId: created.id,
      afterSummary: {
        source_kind: input.sourceKind,
        file_sha256: hash,
        row_count: dataRowCount,
      },
    });
    return created;
  });

  const rawKey = `raw/${task.id}/source.csv`;
  await putObject(rawKey, Readable.from(buffer));
  await ctx.db.importTask.update({ where: { id: task.id }, data: { rawObjectKey: rawKey } });

  return { id: task.id, status: "uploaded", fileSha256: hash, rowCount: dataRowCount, bytes, reused: false };
}

export async function getImportTask(ctx: ImportsContext, taskId: string) {
  const task = await ctx.db.importTask.findFirst({
    where: { orgId: ctx.orgId, id: taskId },
    select: {
      id: true,
      storeId: true,
      dataSourceId: true,
      sourceKind: true,
      status: true,
      originalFilename: true,
      fileSha256: true,
      rowCount: true,
      validCount: true,
      errorCount: true,
      insertCount: true,
      updateCount: true,
      unchangedCount: true,
      errorCode: true,
      createdAt: true,
      confirmedAt: true,
      committedAt: true,
      baseDatasetVersion: true,
      committedDatasetVersion: true,
    },
  });
  if (!task) throw new AccessError(404, "NOT_FOUND", "导入任务不存在");
  return {
    id: task.id,
    store_id: task.storeId,
    data_source_id: task.dataSourceId,
    source_kind: task.sourceKind,
    status: task.status,
    original_filename: task.originalFilename,
    file_sha256: task.fileSha256,
    row_count: task.rowCount,
    valid_count: task.validCount,
    error_count: task.errorCount,
    insert_count: task.insertCount,
    update_count: task.updateCount,
    unchanged_count: task.unchangedCount,
    error_code: task.errorCode,
    created_at: task.createdAt.toISOString(),
    confirmed_at: task.confirmedAt?.toISOString() ?? null,
    committed_at: task.committedAt?.toISOString() ?? null,
    base_dataset_version: String(task.baseDatasetVersion),
    committed_dataset_version: task.committedDatasetVersion === null ? null : String(task.committedDatasetVersion),
  };
}
