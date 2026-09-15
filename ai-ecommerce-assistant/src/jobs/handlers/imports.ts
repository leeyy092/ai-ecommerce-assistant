/**
 * 导入校验 handler（TASK-007 队列边界；正式校验编排属 TASK-008+）。
 *
 * G2-H05：执行前重查发起人当前有效 Membership 与当前角色类型权限——
 *   禁用/降权后遗留任务以 failed+UPLOAD_PERMISSION_REVOKED 终态拒绝，不再解析。
 * G2-H08：状态机修复——uploaded/validating → validating 原子推进（重投安全）；
 *   文件缺失等持久错误给出失败终态（不把 validating 当成功完成）；
 *   暂时性错误交还队列重试，重试耗尽由调用方/清理器落终态。
 * 解析经 TASK-006 统一 Adapter 并组装 typed CanonicalBatch（G2-H04 合同消费点）。
 * 不做：业务入库、dataset_version 递增、快照评估（TASK-008/013 边界）。
 */
import { createHash } from "node:crypto";
import { getPrismaClient } from "@/database/prisma";
import {
  createCanonicalBatch,
  getAdapter,
  isFileKind,
  type CanonicalBatch,
  type CoverageDeclarationItem,
} from "@/adapters/contracts";
import { canImport } from "@/services/access";
import { getObjectText, putObject } from "@/storage";
import { Readable } from "node:stream";

export interface ValidateJobData {
  taskId: string;
}

export interface ValidateHandlerOpts {
  /** pg-boss 作业当前重试次数/上限（用于判断重试耗尽，落失败终态） */
  retryCount?: number;
  retryLimit?: number;
}

export interface ValidateOutcome {
  status: string;
  valid: number;
  errors: number;
}

/** 终态集合：重投到已终态任务时直接幂等跳过 */
const TERMINAL_STATUSES = new Set(["preview_ready", "failed", "committing", "committed", "expired"]);

export async function handleValidateTask(
  data: ValidateJobData,
  opts: ValidateHandlerOpts = {},
): Promise<ValidateOutcome> {
  const db = getPrismaClient();
  const task = await db.importTask.findUnique({ where: { id: data.taskId } });
  if (!task) return { status: "missing", valid: 0, errors: 0 };
  if (!isFileKind(task.sourceKind)) return { status: task.status, valid: 0, errors: 0 };
  if (TERMINAL_STATUSES.has(task.status)) {
    // 幂等重投：终态任务不重复处理（如 dispatcher 与路由补投竞争产生的重复作业）
    return { status: task.status, valid: task.validCount, errors: task.errorCount };
  }
  if (!task.rawObjectKey) {
    // 防御：建账即带文件（G2-H08 窗口1），空键属于不变量破坏 → 明确失败
    await db.importTask.updateMany({
      where: { id: task.id, status: { in: ["uploaded", "validating"] } },
      data: { status: "failed", errorCode: "SOURCE_FILE_MISSING" },
    });
    return { status: "failed", valid: 0, errors: 0 };
  }

  // G2-H05：执行前重查发起人当前有效身份与类型权限（禁用/降权 → 终态拒绝）
  const membership = await db.membership.findFirst({
    where: { orgId: task.orgId, userId: task.createdBy },
    select: { status: true, role: true },
  });
  if (!membership || membership.status !== "active" || !canImport(membership.role, task.sourceKind)) {
    await db.importTask.updateMany({
      where: { id: task.id, status: { in: ["uploaded", "validating"] } },
      data: { status: "failed", errorCode: "UPLOAD_PERMISSION_REVOKED" },
    });
    return { status: "failed", valid: 0, errors: 0 };
  }

  const store = await db.store.findUniqueOrThrow({
    where: { id: task.storeId },
    select: { externalStoreId: true },
  });
  const dataSource = await db.dataSource.findUniqueOrThrow({
    where: { id: task.dataSourceId },
    select: { sourceNamespace: true },
  });

  // uploaded/validating → validating（原子推进；并发重投安全）
  await db.importTask.updateMany({
    where: { id: task.id, status: { in: ["uploaded", "validating"] } },
    data: { status: "validating" },
  });

  try {
    const text = await getObjectText(task.rawObjectKey);
    // G2-H03：来源更新时间必须来自文件本身，缺失即行级错误（不补造）
    const parsed = getAdapter("csv").parse(task.sourceKind, { storeExternalId: store.externalStoreId }, text);
    // G2-H04：统一 CanonicalBatch 合同——服务端赋值店铺/namespace/checksum，
    // 覆盖声明来自任务存档（用户映射确认），不来自文件内容
    const batch: CanonicalBatch = createCanonicalBatch({
      sourceKind: task.sourceKind,
      sourceNamespace: dataSource.sourceNamespace,
      storeId: task.storeId,
      adapterKind: "csv",
      rawChecksum: createHash("sha256").update(text).digest("hex"),
      parse: parsed,
      coverageDeclaration: Array.isArray(task.coverageDeclaration)
        ? (task.coverageDeclaration as unknown as CoverageDeclarationItem[])
        : [],
    });

    const valid = batch.records.length;
    const errors = batch.row_errors.length;
    let errorObjectKey: string | null = null;
    if (errors > 0) {
      errorObjectKey = `errors/${task.id}/errors.csv`;
      const header = "row,column,code,message";
      const body = batch.row_errors
        .map((e) => [e.row, e.column ?? "", e.code, `"${String(e.message).replace(/"/g, '""')}"`].join(","))
        .join("\r\n");
      await putObject(errorObjectKey, Readable.from([`${header}\r\n${body}\r\n`]));
    }

    const failure = batch.row_errors.find((e) =>
      ["STORE_MISMATCH", "MISSING_COLUMN", "EMPTY_FILE", "INVALID_CSV", "DUPLICATE_COLUMN"].includes(e.code),
    );
    await db.importTask.updateMany({
      where: { id: task.id, status: "validating" },
      data: {
        status: failure ? "failed" : "preview_ready",
        validCount: valid,
        errorCount: errors,
        errorObjectKey,
        errorCode: failure ? failure.code : null,
        previewVersion: { increment: 1 },
      },
    });
    return { status: failure ? "failed" : "preview_ready", valid, errors };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const exhausted =
      opts.retryCount !== undefined && opts.retryLimit !== undefined && opts.retryCount >= opts.retryLimit;
    if (code === "ENOENT" || code === "ENOTDIR" || exhausted) {
      // G2-H08：持久失败给明确终态（文件缺失/对象损坏/重试耗尽），不留悬挂 validating
      await db.importTask.updateMany({
        where: { id: task.id, status: "validating" },
        data: { status: "failed", errorCode: code === "ENOENT" || code === "ENOTDIR" ? "SOURCE_FILE_MISSING" : "VALIDATE_FAILED" },
      });
      return { status: "failed", valid: 0, errors: 0 };
    }
    // 暂时性错误：交还队列重试（pg-boss 按 retryLimit 重投）
    throw error;
  }
}

/**
 * 提交 handler 边界（TASK-008 实现业务提交；此处仅注册占位并显式拒绝，
 * 防止误用冒充已提交）。
 */
export async function handleCommitTask(_data: { taskId: string }): Promise<never> {
  throw new Error("commit 编排尚未实现：属 TASK-008（预览确认与原子提交）边界");
}
