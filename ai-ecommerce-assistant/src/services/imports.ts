/**
 * 导入任务服务（TASK-007；08 §imports）。
 *
 * G2-H06：上传走真实流式接收——字节上限/CSV 逻辑记录（csv-parse 流）增量统计，
 *   超限立即中止上游并清理半截文件；quoted 换行按单条逻辑记录计数；空行按
 *   Worker 同款语义跳过；计数一旦不可信（解析错误）即中止，不接受未计数的余流。
 * G2-H07：内容幂等由数据库部分唯一索引原子认领（并发同内容恰一任务，败者复用）；
 *   HTTP Idempotency-Key 按 org/user/endpoint 隔离，存档与任务建账同事务原子提交
 *   （并发冲突整体回滚，按已存档请求裁决），同 key 异 body 409，重放返回首次响应；
 *   业务幂等键（04 §12.5）在 mapping/提交阶段生成，不复制 HTTP Key。
 * G2-H08：文件先落位、任务后建账（rawObjectKey 非空恒成立）；任何失败路径只清理
 *   尚未被有效任务拥有的文件；投递失败保持 uploaded+outbox=pending 由 Worker
 *   dispatcher 兜底补投。
 * G2-H05：查询/下载按当前角色可导入类型鉴权（C 仅消息，订单 403）。
 * G2-R2-M04：本地 spool 是独立临时域——写入/严格读取/清理都只发生在本地磁盘，
 *   只有提升（promoteSpoolObject）进入当前驱动对象域（local rename / oss put）。
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { Readable } from "node:stream";
import { parse as csvParseStream } from "csv-parse";
import { AccessError, canImport, type Role } from "@/services/access";
import { writeAudit } from "@/services/audit";
import { deleteLocalTemp, localTempPath, promoteSpoolObject } from "@/storage";
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

/** 数据库唯一索引名（G2-R2-H07/H08：冲突裁决与所有权清理的依据） */
const IDX_ACTIVE_CONTENT = "import_task_active_content_key";
const IDX_HTTP_IDEM = "http_idempotency_org_id_user_id_endpoint_request_key_key";

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
 * 把上传文件流落入本地 spool 临时文件，同时增量计算 SHA256 与 CSV 逻辑记录数。
 * - 字节/行上限：立即销毁上游（HTTP 先于 multipart 结束响应）并清理半截文件；
 * - 解析选项与 Worker parseCsv 一致（空行跳过；quoted 换行按单条记录）；
 * - 解析错误 = 计数不可信 → 直接中止（G2-R2-H06：不接受未计数的余流）；
 * - 写流错误（EACCES/ENOSPC 等）在创建时即接管（G2-R2-H08），可控返回不逃逸进程。
 * onAbort 在任何中止路径被调用（调用方用于销毁请求流，防止 busboy 等待剩余输入）。
 */
export async function spoolUpload(
  fileStream: NodeJS.ReadableStream,
  onAbort?: () => void,
): Promise<SpooledUpload> {
  const tempKey = `tmp/upload-${randomUUID()}.csv`;
  const tempPath = localTempPath(tempKey);
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

    const parser = csvParseStream({ skip_empty_lines: true });
    const writeStream = createWriteStream(tempPath);

    const cleanup = () => {
      writeStream.destroy();
      parser.destroy?.();
    };
    const fail = (error: AccessError) => {
      if (settled) return;
      settled = true;
      // G2-H06：立即销毁上游（HTTP 响应先于 multipart 结束）
      (fileStream as Readable).destroy?.(error);
      onAbort?.();
      cleanup();
      // G2-R2-H06：清理完成后再响应，保证拒绝路径不留临时文件
      void deleteLocalTemp(tempKey).finally(() => reject(error));
    };

    // G2-R2-H08：写流错误在创建时即接管——EACCES/ENOSPC 可控返回，不逃逸进程
    writeStream.on("error", (error: Error) => {
      fail(new AccessError(503, "STORAGE_WRITE_FAILED", `写入临时存储失败：${error.message}`));
    });
    // G2-R2-H06：解析错误 = 逻辑行计数不可信 → 中止上传，而非停止计数继续接收
    parser.on("error", (error: Error) => {
      fail(new AccessError(422, "INVALID_CSV", `CSV 解析错误，已停止接收：${error.message}`));
    });

    parser.on("data", () => {
      records += 1;
      if (records - 1 > MAX_UPLOAD_ROWS) {
        fail(new AccessError(422, "TOO_MANY_ROWS", `数据行超过 ${MAX_UPLOAD_ROWS} 行上限`));
      }
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
      // 逻辑记录计数：手动喂给 csv-parse（quoted 换行按单条记录）
      parser.write(buf);
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
          parser.end();
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
  /** HTTP Idempotency-Key 重放：按存档的首次响应状态返回 */
  replayed?: boolean;
  replayStatus?: number;
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

interface HttpArchive {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

async function readHttpArchive(ctx: ImportsContext, input: UploadInput, requestKey: string): Promise<HttpArchive | null> {
  const row = await ctx.db.httpIdempotency.findUnique({
    where: {
      orgId_userId_endpoint_requestKey: {
        orgId: ctx.orgId,
        userId: ctx.userId,
        endpoint: input.endpoint,
        requestKey,
      },
    },
  });
  if (!row) return null;
  if (Date.now() - row.createdAt.getTime() > 24 * 3600 * 1000) {
    // 24 小时语义：过期存档即时清理并可复用（08 §17.5）
    await ctx.db.httpIdempotency.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  return { requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody };
}

/** 把本请求响应写入 HTTP 幂等存档；唯一冲突交调用方按已存档请求裁决 */
async function insertHttpArchive(
  db: Prisma.TransactionClient | PrismaClient,
  ctx: ImportsContext,
  input: UploadInput,
  requestKey: string,
  requestHash: string,
  status: number,
  result: UploadResult,
): Promise<void> {
  await db.httpIdempotency.create({
    data: {
      id: randomUUID(),
      orgId: ctx.orgId,
      userId: ctx.userId,
      endpoint: input.endpoint,
      requestKey,
      requestHash,
      responseStatus: status,
      responseBody: { data: result } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * G2-R2-H07：内容复用时同样绑定本 key 的存档（否则后续同 key 异 body 无法 409）。
 * 冲突：hash 相同 → 静默（同一语义请求）；不同 → 409。
 * 非冲突写入失败 → 抛出（存档失败不得无保护地成功返回）。
 */
async function bindHttpArchiveForReuse(
  ctx: ImportsContext,
  input: UploadInput,
  requestKey: string,
  requestHash: string,
  result: UploadResult,
): Promise<void> {
  try {
    await insertHttpArchive(ctx.db, ctx, input, requestKey, requestHash, 200, result);
  } catch (error) {
    if (isUniqueViolation(error, IDX_HTTP_IDEM)) {
      const archived = await readHttpArchive(ctx, input, requestKey);
      if (archived && archived.requestHash === requestHash) return;
      throw new AccessError(409, "IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已绑定不同请求内容");
    }
    throw error;
  }
}

/**
 * 从 spool 临时文件建账：上下文校验 → HTTP 幂等重放 → 内容认领（原子）→
 * 本地 spool 提升为正式对象 → 任务+审计+HTTP 存档同一事务。
 * 任何失败路径不产生"无文件任务"，只清理尚未被有效任务拥有的文件。
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

  // 快速路径：已有存档（同 hash 重放；异 hash 409；过期视为无存档）
  if (requestKey) {
    const archived = await readHttpArchive(ctx, input, requestKey);
    if (archived) {
      if (archived.requestHash !== requestHash) {
        throw new AccessError(409, "IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已绑定不同请求内容");
      }
      const body = archived.responseBody as { data: UploadResult };
      await deleteLocalTemp(tempKey);
      return { ...body.data, reused: true, replayed: true, replayStatus: archived.responseStatus };
    }
  }

  const existing = await findReusableTask(ctx, input);
  if (existing) {
    // 内容复用：绑定本 key 存档（G2-R2-H07），失败/冲突按存档语义处理
    const result: UploadResult = {
      id: existing.id,
      status: existing.status,
      fileSha256: existing.fileSha256,
      rowCount: existing.rowCount,
      bytes: input.bytes,
      reused: true,
    };
    if (requestKey) {
      await bindHttpArchiveForReuse(ctx, input, requestKey, requestHash, result);
    }
    await deleteLocalTemp(tempKey);
    return result;
  }

  // G2-H08 窗口1 修复：本地 spool 先提升为正式对象，任务建账带完整 rawObjectKey
  const taskId = randomUUID();
  const rawKey = `raw/${taskId}/source.csv`;
  await promoteSpoolObject(tempKey, rawKey);
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
          // G2-R2-H07：业务幂等键（org/store/source/kind/sha/mapping/adapter/coverage
          // 规范化哈希）属 mapping/提交阶段（04 §12.5），不复制 HTTP Key，
          // 避免借 org/store 唯一约束长期占用并使跨用户同 key 误 503
          idempotencyKey: null,
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
      if (requestKey) {
        // G2-R2-H07/H08：HTTP 存档与任务建账同事务——并发冲突整体回滚，
        // 不产生"已建任务但存档失败/409"的不一致
        await insertHttpArchive(tx, ctx, input, requestKey, requestHash, 201, {
          id: task.id,
          status: task.status,
          fileSha256: input.sha256,
          rowCount: input.dataRows,
          bytes: input.bytes,
          reused: false,
        });
      }
      return task;
    });
    return {
      id: created.id,
      status: created.status,
      fileSha256: input.sha256,
      rowCount: input.dataRows,
      bytes: input.bytes,
      reused: false,
    };
  } catch (error) {
    // 此时 rawKey 尚未被任何已提交任务拥有（事务失败/回滚）：删除安全且必须执行，
    // 否则恢复器/重试会接手一个无文件任务（G2-R2-H08）
    const { deleteObject } = await import("@/storage");
    await deleteObject(rawKey).catch(() => undefined);
    await deleteLocalTemp(tempKey);
    if (isUniqueViolation(error, IDX_ACTIVE_CONTENT)) {
      // G2-H07：并发同内容——败者复用胜者任务（并按存档语义绑定本 key）
      const winner = await findReusableTask(ctx, input);
      if (winner) {
        const result: UploadResult = {
          id: winner.id,
          status: winner.status,
          fileSha256: winner.fileSha256,
          rowCount: winner.rowCount,
          bytes: input.bytes,
          reused: true,
        };
        if (requestKey) {
          await bindHttpArchiveForReuse(ctx, input, requestKey, requestHash, result);
        }
        return result;
      }
      throw error;
    }
    if (requestKey && isUniqueViolation(error, IDX_HTTP_IDEM)) {
      // G2-R2-H07：并发同 key 异 body——本事务已回滚（无任务残留），按已存档请求裁决
      const archived = await readHttpArchive(ctx, input, requestKey);
      if (archived && archived.requestHash === requestHash) {
        const body = archived.responseBody as { data: UploadResult };
        return { ...body.data, reused: true, replayed: true, replayStatus: archived.responseStatus };
      }
      throw new AccessError(409, "IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 已绑定不同请求内容");
    }
    throw error;
  }
}

/** 清理本地 spool 临时文件（幂等；不影响驱动对象域） */
export async function deleteObjectSafe(key: string): Promise<void> {
  await deleteLocalTemp(key);
}

/** 读取本地 spool 临时文件并做严格 UTF-8 校验（M03：非法字节 422，不静默替换）。
 *  G2-R2-M04：spool 属本地临时域，直读本地文件，不经驱动对象域。 */
export async function readSpooledTextStrict(tempKey: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(localTempPath(tempKey)) as AsyncIterable<Buffer>) {
    chunks.push(chunk);
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
