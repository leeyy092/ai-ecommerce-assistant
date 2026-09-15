/**
 * POST /api/v1/imports（08 §17.3；TASK-007；G2-H06/07/M01/M03 修复版）
 * - 流式 multipart（busboy）：20MB / 10 万 CSV 逻辑记录上限在接收链路即时生效，
 *   超限立即中止上游并响应，不等待 multipart 结束；quoted 换行按逻辑记录计数；
 * - entity_type 为合同字段（source_kind 作为内部别名兼容）；响应含 filename/bytes；
 * - Idempotency-Key 从请求头读取（org/user/endpoint 隔离 24h，同 key 异 body 409）；
 * - C 仅 customer_messages；角色类型失权后旧任务/链接同样拒绝（见查询/下载路由）。
 */
import type { NextRequest } from "next/server";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission, canImport } from "@/services/access";
import {
  createImportTaskFromSpool,
  deleteObjectSafe,
  isSourceKind,
  SOURCE_KINDS,
  spoolUpload,
  readSpooledTextStrict,
  UPLOAD_RATE_LIMIT_PER_MIN,
  type SpooledUpload,
} from "@/services/imports";
import { consumeRateLimit } from "@/lib/rateLimit";
import { enqueueValidate } from "@/jobs/queue";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let spooled: SpooledUpload | null = null;
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    // 上传能力：全员基础权限；具体类型按 canImport 在字段齐备后立即判定
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const db = getPrismaClient();

    // F10：上传入口限流（数据库固定窗口，20 次/分钟/用户桶）
    const limit = await consumeRateLimit(db, `upload:${ctx.orgId}:${ctx.userId}`, UPLOAD_RATE_LIMIT_PER_MIN, 60);
    if (!limit.allowed) {
      return fail(429, "上传过于频繁，请稍后重试", {
        code: "RATE_LIMITED",
        extraMeta: { retry_after: limit.retryAfterSeconds },
      });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return fail(422, "请求须为 multipart/form-data");
    }
    // G2-H07：HTTP Idempotency-Key 只从请求头读取（multipart 字段不冒充请求幂等）
    const httpKey = req.headers.get("idempotency-key")?.trim() || undefined;
    if (httpKey && (httpKey.length < 8 || httpKey.length > 128)) {
      return fail(422, "Idempotency-Key 长度须在 8–128 字符", {
        fieldErrors: { "idempotency-key": "长度须在 8–128 字符" },
      });
    }
    if (!req.body) {
      return fail(422, "缺少请求体");
    }

    // G2-H06：真实请求流 → busboy 流式解析（不整体缓冲）
    const nodeReq = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]);
    const bb = Busboy({
      headers: { "content-type": contentType },
      limits: { files: 1, fileSize: Infinity },
    });

    const fields: Record<string, string> = {};
    const received: { fileMeta?: { filename: string }; fileStream?: Readable; spoolPromise?: Promise<SpooledUpload> } = {};
    let spoolError: unknown = null;

    bb.on("field", (name: string, value: string) => {
      fields[name] = value;
    });
    bb.on("file", (name: string, stream: Readable, info: { filename: string }) => {
      if (name === "file" && !received.spoolPromise) {
        received.fileMeta = { filename: info.filename || "upload.csv" };
        received.fileStream = stream;
        // 接收链路内完成字节/逻辑行限额：超限销毁上游并立即响应；
        // onAbort 销毁请求流，防止 busboy 继续等待剩余 multipart 输入
        received.spoolPromise = spoolUpload(stream, () => nodeReq.destroy()).catch((error) => {
          spoolError = error;
          throw error;
        });
        notifySpool(received.spoolPromise);
      } else {
        stream.resume();
      }
    });
    // 文件部分可能排在字段之后：spoolSeen 在 file 事件出现时立即带出 spool promise，
    // 使限额/存储中止能即时传播到响应（不等 multipart 结束）
    let notifySpool: (p: Promise<SpooledUpload> | null) => void = () => undefined;
    const spoolSeen = new Promise<Promise<SpooledUpload> | null>((resolve) => {
      notifySpool = resolve;
    });
    const finished = new Promise<void>((resolve, reject) => {
      bb.on("close", () => {
        notifySpool(received.spoolPromise ?? null);
        resolve();
      });
      bb.on("error", reject);
    });
    // 中止路径下 finished 可能永不落定，防止未处理拒绝
    finished.catch(() => undefined);
    nodeReq.pipe(bb);
    try {
      const seen = await Promise.race([
        spoolSeen,
        finished.then(() => received.spoolPromise ?? null),
      ]);
      if (!seen) {
        // multipart 已接收完毕且没有文件部分
        return fail(422, "缺少上传文件 file");
      }
      spooled = await seen;
      await finished;
    } catch {
      nodeReq.destroy();
      const mapped = spoolError ? serviceFailure(spoolError) : null;
      return mapped ?? fail(422, "multipart 解析失败");
    }

    // ---- multipart 结束后的合同校验 ----
    const storeId = fields["store_id"] ?? "";
    const dataSourceId = fields["data_source_id"] ?? "";
    // M01：entity_type 为合同输入字段；source_kind 作为内部别名兼容
    const kindRaw = fields["entity_type"] ?? fields["source_kind"] ?? "";
    if (!storeId || !dataSourceId || !kindRaw) {
      return fail(422, "store_id、data_source_id、entity_type 必填");
    }
    if (!received.fileMeta) {
      return fail(422, "缺少上传文件 file");
    }
    const fileMeta = received.fileMeta;
    if (!isSourceKind(kindRaw)) {
      return fail(422, `entity_type 不支持：${kindRaw}`, {
        fieldErrors: { entity_type: `仅支持 ${SOURCE_KINDS.join("/")}` },
      });
    }
    // 角色文件类型限制（02_USER_ROLES：C 仅客户消息）
    if (!canImport(ctx.role, kindRaw)) {
      return fail(403, "当前角色不能上传该类型文件", { code: "FILE_KIND_FORBIDDEN" });
    }
    // M03：明确文件类型策略——仅 CSV（.csv 扩展名），不带 Excel 解析器
    if (!/\.csv$/i.test(fileMeta.filename)) {
      return fail(415, "仅支持 CSV 文件（.csv 扩展名）", { code: "UNSUPPORTED_FILE_TYPE" });
    }

    // M03：严格 UTF-8（非法字节 422，不做静默替换）
    await readSpooledTextStrict(spooled.tempKey);

    const result = await createImportTaskFromSpool(
      { db, orgId: ctx.orgId, userId: ctx.userId, role: ctx.role },
      {
        storeId,
        dataSourceId,
        sourceKind: kindRaw,
        filename: fileMeta.filename,
        bytes: spooled.bytes,
        sha256: spooled.sha256,
        dataRows: spooled.dataRows,
        httpKey,
        endpoint: "/api/v1/imports",
      },
      spooled.tempKey,
    );

    // G2-H08 窗口2：投递失败不冒充成功——任务保持 uploaded+pending，dispatcher 兜底补投；
    // 复用且从未执行的 uploaded 任务也补投（先失败上传的重试路径）
    try {
      const jobId = await enqueueValidate(result.id);
      if (jobId) {
        await db.importTask.updateMany({
          where: { id: result.id, outboxStatus: "pending" },
          data: { outboxStatus: "dispatched" },
        });
      }
    } catch {
      // 投递暂不可用：任务保持 uploaded+outbox=pending，Worker dispatcher 兜底补投
    }
    return ok(
      {
        id: result.id,
        status: result.status,
        file_sha256: result.fileSha256,
        row_count: result.rowCount,
        reused: result.reused,
        filename: fileMeta.filename,
        bytes: spooled.bytes,
      },
      // 重放保持首次响应状态（201）；无 Idempotency-Key 的内容复用返回 200
      { status: result.replayed || !result.reused ? 201 : 200 },
    );
  } catch (error) {
    // 校验/建账失败：清理已 spool 的临时对象（落位成功后 delete 无副作用）
    if (spooled) await deleteObjectSafe(spooled.tempKey);
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
