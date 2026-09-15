/**
 * 导入校验 handler（TASK-007 队列边界；正式校验编排属 TASK-008+）。
 * 职责：读取私有存储原始文件 → TASK-006 统一 Adapter 纯解析 →
 *       统计 valid/error 行数与错误明细（错误明细写私有 errors 对象）→
 *       更新任务 status=validated / failed（含 errorCode）。
 * 不做：业务入库、dataset_version 递增、快照评估（TASK-008/013 边界）。
 */
import { randomUUID } from "node:crypto";
import { getPrismaClient } from "@/database/prisma";
import { getAdapter, isFileKind } from "@/adapters/contracts";
import { getObjectText, putObject } from "@/storage";
import { Readable } from "node:stream";

export interface ValidateJobData {
  taskId: string;
}

export async function handleValidateTask(data: ValidateJobData): Promise<{ status: string; valid: number; errors: number }> {
  const db = getPrismaClient();
  const task = await db.importTask.findUnique({ where: { id: data.taskId } });
  if (!task) return { status: "missing", valid: 0, errors: 0 };
  if (task.status !== "uploaded" || !isFileKind(task.sourceKind)) {
    return { status: task.status, valid: 0, errors: 0 };
  }

  const store = await db.store.findUniqueOrThrow({
    where: { id: task.storeId },
    select: { externalStoreId: true },
  });

  await db.importTask.update({ where: { id: task.id }, data: { status: "validating" } });

  const text = await getObjectText(task.rawObjectKey);
  // G2-H03：来源更新时间必须来自文件本身；缺失即行级错误，服务端不补造默认时间
  const result = getAdapter("csv").parse(task.sourceKind, { storeExternalId: store.externalStoreId }, text);

  const valid = result.records.length;
  const errors = result.errors.length;
  let errorObjectKey: string | null = null;
  if (errors > 0) {
    errorObjectKey = `errors/${task.id}/errors.csv`;
    const header = "row,column,code,message";
    const body = result.errors
      .map((e) => [e.row, e.column ?? "", e.code, `"${String(e.message).replace(/"/g, '""')}"`].join(","))
      .join("\r\n");
    await putObject(errorObjectKey, Readable.from([`${header}\r\n${body}\r\n`]));
  }

  const failure = result.errors.find((e) => ["STORE_MISMATCH", "MISSING_COLUMN", "EMPTY_FILE"].includes(e.code));
  await db.importTask.update({
    where: { id: task.id },
    data: {
      status: failure ? "failed" : "preview_ready",
      validCount: valid,
      errorCount: errors,
      errorObjectKey,
      errorCode: failure ? failure.code : null,
      previewVersion: { increment: 1 },
    },
  });
  void randomUUID;
  return { status: failure ? "failed" : "preview_ready", valid, errors };
}

/**
 * 提交 handler 边界（TASK-008 实现业务提交；此处仅注册占位并显式拒绝，
 * 防止误用冒充已提交）。
 */
export async function handleCommitTask(_data: { taskId: string }): Promise<never> {
  throw new Error("commit 编排尚未实现：属 TASK-008（预览确认与原子提交）边界");
}
