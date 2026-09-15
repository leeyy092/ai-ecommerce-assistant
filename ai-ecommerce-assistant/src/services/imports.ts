/**
 * 导入任务服务（TASK-007；08 §imports）。
 *
 * G2-H06：上传走真实流式接收——字节上限/CSV 逻辑记录（csv-parse 流）增量统计，
 *   超限立即中止上游并清理半截文件；quoted 换行按单条逻辑记录计数（不按物理行）。
 * G2-H07：内容幂等由数据库部分唯一索引原子认领（并发同内容恰一任务，败者复用）；
 *   HTTP Idempotency-Key 按 org/user/endpoint 隔离存档 24h，同 key 异 body 409，
 *   与业务自然键幂等（TASK-008 起）分属两层。
 * G2-H08：文件先落位、任务后建账（rawObjectKey 非空恒成立）；投递失败保持
 *   uploaded+outbox=pending 由 Worker dispatcher 兜底补投；落位后建账失败清理孤儿对象。
 * G2-H05：查询/下载按当前角色可导入类型鉴权（C 仅消息，订单 403）。
 */
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { Readable } from "node:stream";
import { parse as csvParseStream } from "csv-parse";
import { AccessError, canImport, type Role } from "@/services/access";
import { writeAudit } from "@/services/audit";
import { deleteObject, getObjectStream, moveObject, storageRoot } from "@/storage";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_UPLOAD_ROWS = 100_000; // 10 万数据行（CSV 逻辑记录）
/** F10：上传限流沿用既有数据库限流设施（阈值与邀请接受同量级；测试可经环境变量放宽） */
export const UPLOAD_RATE_LIMIT_PER_MIN = Number(process.env.UPLOAD_RATE_LIMIT_PER_MIN ?? 20);

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
  role: Role;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** 唯一冲突判别（driver-adapter 形态：constraint.index / meta.target） */
function isUniqueViolation(error: unknown, indexName: string): boolean {
  const err = error as { code?: unknown; meta?: Record<string, unknown> } | null;
  if (err?.code !== "P2002") return false;
  const meta = err.meta ?? {};
  const index = (meta.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined)?.cause?.constraint?.index;
  if (index === indexName) return true;
  const target = meta.target !== undefined ? String(meta.target) : "";
  return target.includes(indexName);
}

// ---------- G2-H06：流式 spool（字节 + 逻辑行上限，超限即中止） ----------

export interface SpooledUpload {
  tempKey: string;
  bytes: number;
  sha256: string;
  dataRows: number;
}

/**
 * 把上传文件流落入私有存储临时对象，同时增量计算 SHA256 与 CSV 逻辑记录数。
 * 超出字节/行上限：销毁上游流（HTTP 层立即响应，不等 multipart 结束）并清理半截文件。
 * onAbort 在任何中止路径被调用（调用方用于销毁请求流，防止 busboy 等待剩余输入）。
 * csv-parse 语法错误在解析阶段（Worker）细报；此处仅按逻辑记录计数，错误后停止计数
 * （低估不放过超限文件，最终由校验失败兜底）。
 */
export async function spoolUpload(
  fileStream: NodeJS.ReadableStream,
  onAbort?: () => void,
): Promise<SpooledUpload> {
  const tempKey = `tmp/upload-${randomUUID()}.csv`;
  const root = storageRoot();
  const tempPath = path.resolve(root, tempKey);
  try {
    await mkdir(path.dirname(tempPath), { recursive: true });
  } catch {
    // 早期失败同样必须终止文件流，否则 busboy 等待文件数据造成请求悬挂
    (fileStream as Readable).destroy?.();
    onAbort?.();
    throw new AccessError(503, "STORAGE_WRITE_FAILED", "私有存储写入失败");
  }

  return new Promise<SpooledUpload>((resolve, reject) => {
    let settled = false;
    const hash = createHash("sha256");
    let bytes = 0;
    let records = 0;

    const parser = csvParseStream();
    const writeStream = createWriteStream(tempPath);
    let countingAlive = true;

    const cleanup = () => {
      writeStream.destroy();
      parser.destroy?.();
      void deleteObject(tempKey).catch(() => undefined);
    };
    const fail = (error: AccessError) => {
      if (settled) return;
      settled = true;
      countingAlive = false;
      // G2-H06：立即销毁上游（HTTP 响应先于 multipart 结束）
      (fileStream as Readable).destroy?.(error);
      onAbort?.();
      cleanup();
      reject(error);
    };

    parser.on("data", () => {
      records += 1;
      if (records - 1 > MAX_UPLOAD_ROWS) {
        fail(new AccessError(422, "TOO_MANY_ROWS", `数据行超过 ${MAX_UPLOAD_ROWS} 行上限`));
      }
    });
    parser.on("error", () => {
      // 语法错误交由 Worker 校验阶段给出逐行明细；此处仅停止计数
      countingAlive = false;
    });

    fileStream.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      bytes += buf.length;
      hash.update(buf);
      if (bytes > MAX_UPLOAD_BYTES) {
        fail(new AccessError(422, "FILE_TOO_LARGE", `文件超过 ${MAX_UPLOAD_BYTES} 字节上限，已停止接收`));
        return;
      }
      // 逻辑记录计数：手动喂给 csv-parse（quoted 换行按单条记录）；不再 pipe，
      // 避免 busboy 文件流销毁时与 pipe 管线交互产生跨流错误
      if (countingAlive) parser.write(buf);
    });
    fileStream.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new AccessError(400, "UPLOAD_INTERRUPTED", `上传中断：${error.message}`));
      }
    });
    fileStream.on("end", () => {
      void (async () => {
        if (settled) return;
        try {
          if (countingAlive) parser.end();
          await once(writeStream, "finish");
          settled = true;
          resolve({
            tempKey,
            bytes,
            sha256: hash.digest("hex"),
            dataRows: Math.max(0, records - 1), // 首条为表头
          });
        } catch (error) {
          settled = true;
          cleanup();
          reject(error instanceof AccessError ? error : new AccessError(500, "INTERNAL_ERROR", "写入临时存储失败"));
        }
      })();
    });

    fileStream.pipe(writeStream);
  });
}

// ---------- 上传上下文与建账 ----------

export interface UploadInput {
  storeId: string;
  dataSourceId: string;
  sourceKind: SourceKind;
  filename: string;
  /** 上传请求结束时声明的字节数/内容哈希/逻辑数据行数（spoolUpload 产出） */
  bytes: number;
  sha256: string;
  dataRows: number;
  /** HTTP Idempotency-Key 头（可选；08 §17.5） */
  httpKey?: string;
  endpoint: string;
}

export interface UploadResult {
  id: string;
  status: string;
  fileSha256: string;
  rowCount: number;
  bytes: number;
  reused: boolean;
  /** HTTP Idempotency-Key 重放（返回首次响应，状态码保持 201） */
  replayed?: boolean;
}

async function assertUploadContext(ctx: ImportsContext, input: UploadInput): Promise<void> {
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
}

/** 查找可复用的同内容未失败任务（重复请求返回同任务） */
async function findReusableTask(ctx: ImportsContext, input: UploadInput) {
  return ctx.db.importTask.findFirst({
    where: {
      orgId: ctx.orgId,
      storeId: input.storeId,
      dataSourceId: input.dataSourceId,
      sourceKind: input.sourceKind,
      fileSha256: input.sha256,
      status: { not: "failed" },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, fileSha256: true, rowCount: true },
  });
}

/**
 * G2-H07：HTTP 请求幂等——同 key 同 body 返回首次响应；同 key 异 body 409。
 * 与内容幂等（部分唯一索引认领）分属两层；存档 24 小时（过期行惰性清理）。
 */
async function checkHttpIdempotency(
  ctx: ImportsContext,
  input: UploadInput,
  requestKey: string | null,
  requestHash: string,
): Promise<UploadResult | null> {
  if (!requestKey) return null;
  const existing = await ctx.db.httpIdempotency.findUnique({
    where: {
      orgId_userId_endpoint_requestKey: {
        orgId: ctx.orgId,
        userId: ctx.userId,
        endpoint: input.endpoint,
        requestKey,
      },
    },
  });
  if (!existing) return null;
  if (Date.now() - existing.createdAt.getTime() > 24 * 3600 * 1000) {
    await ctx.db.httpIdempotency.delete({ where: { id: existing.id } }).catch(() => undefined);
    return null;
  }
  if (existing.requestHash !== requestHash) {
    throw new AccessError(409, "IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已绑定不同请求内容");
  }
  const body = existing.responseBody as unknown as { data: UploadResult };
  return { ...body.data, reused: true, replayed: true };
}

async function recordHttpIdempotency(
  ctx: ImportsContext,
  input: UploadInput,
  requestKey: string | null,
  requestHash: string,
  result: UploadResult,
): Promise<void> {
  if (!requestKey) return;
  try {
    await ctx.db.httpIdempotency.create({
      data: {
        id: randomUUID(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        endpoint: input.endpoint,
        requestKey,
        requestHash,
        responseStatus: 201,
        responseBody: { data: result } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error, "http_idempotency_scope_key")) {
      // 并发同 key 异 body：以数据库裁决为准
      throw new AccessError(409, "IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已绑定不同请求内容");
    }
    // 存档失败不阻断主流程（幂等档是加速与防重试手段，非任务存在性依据）
  }
}

/**
 * 从 spool 临时对象建账：上下文校验 → HTTP 幂等 → 内容认领（原子）→
 * moveObject 落位 → 任务+审计同事务。任何失败路径不产生"空文件可复用任务"。
 */
export async function createImportTaskFromSpool(
  ctx: ImportsContext,
  input: UploadInput,
  tempKey: string,
): Promise<UploadResult> {
  await assertUploadContext(ctx, input);

  const requestKey = input.httpKey
    ? sha256(`${ctx.orgId}:${ctx.userId}:${input.endpoint}:${input.httpKey}`).slice(0, 48)
    : null;
  const requestHash = sha256(
    `${ctx.orgId}:${ctx.userId}:${input.endpoint}:${input.storeId}:${input.dataSourceId}:${input.sourceKind}:${input.filename}:${input.sha256}`,
  );

  const replay = await checkHttpIdempotency(ctx, input, requestKey, requestHash);
  if (replay) {
    await deleteObject(tempKey).catch(() => undefined);
    return replay;
  }

  const existing = await findReusableTask(ctx, input);
  if (existing) {
    await deleteObject(tempKey).catch(() => undefined);
    return {
      id: existing.id,
      status: existing.status,
      fileSha256: existing.fileSha256,
      rowCount: existing.rowCount,
      bytes: input.bytes,
      reused: true,
    };
  }

  // G2-H08 窗口1 修复：文件先落位到最终键，任务建账带完整 rawObjectKey
  const taskId = randomUUID();
  const rawKey = `raw/${taskId}/source.csv`;
  await moveObject(tempKey, rawKey);
  try {
    const created = await ctx.db.$transaction(async (tx) => {
      const task = await tx.importTask.create({
        data: {
          id: taskId,
          orgId: ctx.orgId,
          storeId: input.storeId,
          dataSourceId: input.dataSourceId,
          sourceKind: input.sourceKind,
          status: "uploaded",
          originalFilename: input.filename.slice(0, 255),
          rawObjectKey: rawKey,
          fileSha256: input.sha256,
          uploadRequestKey: randomUUID().replace(/-/g, ""),
          idempotencyKey: input.httpKey && input.httpKey.length <= 64 ? input.httpKey : null,
          baseDatasetVersion: 0n,
          rowCount: input.dataRows,
          outboxStatus: "pending",
          createdBy: ctx.userId,
        },
      });
      await writeAudit(tx, {
        orgId: ctx.orgId,
        storeId: input.storeId,
        actorUserId: ctx.userId,
        action: "import_upload",
        entityType: "import_task",
        entityId: task.id,
        afterSummary: {
          source_kind: input.sourceKind,
          file_sha256: input.sha256,
          row_count: input.dataRows,
        },
      });
      return task;
    });
    const result: UploadResult = {
      id: created.id,
      status: created.status,
      fileSha256: input.sha256,
      rowCount: input.dataRows,
      bytes: input.bytes,
      reused: false,
    };
    await recordHttpIdempotency(ctx, input, requestKey, requestHash, result);
    return result;
  } catch (error) {
    if (isUniqueViolation(error, "import_task_active_content_key")) {
      // G2-H07：并发同内容——败者复用胜者任务，清理自己落位的对象
      const winner = await findReusableTask(ctx, input);
      await deleteObject(rawKey).catch(() => undefined);
      if (winner) {
        return {
          id: winner.id,
          status: winner.status,
          fileSha256: winner.fileSha256,
          rowCount: winner.rowCount,
          bytes: input.bytes,
          reused: true,
        };
      }
    } else {
      // 建账失败：不留孤儿对象（G2-H08）
      await deleteObject(rawKey).catch(() => undefined);
    }
    throw error;
  }
}

/** 清理临时对象（幂等；不存在时静默） */
export async function deleteObjectSafe(key: string): Promise<void> {
  await deleteObject(key).catch(() => undefined);
}

/** 读取已 spool 的对象并做严格 UTF-8 校验（M03：非法字节 422，不静默替换） */
export async function readSpooledTextStrict(tempKey: string): Promise<string> {
  const stream = getObjectStream(tempKey);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  const buffer = Buffer.concat(chunks);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AccessError(422, "INVALID_ENCODING", "文件不是合法的 UTF-8 编码");
  }
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
  // G2-H05：按当前角色可导入类型鉴权（C 仅消息；类型失权后旧任务拒绝）
  if (!canImport(ctx.role, task.sourceKind)) {
    throw new AccessError(403, "FILE_KIND_FORBIDDEN", "当前角色不能访问该类型导入任务");
  }
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

/** 测试辅助：供路由/测试组装 Node 可读流 */
export function streamFromWeb(body: unknown): Readable {
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
}
