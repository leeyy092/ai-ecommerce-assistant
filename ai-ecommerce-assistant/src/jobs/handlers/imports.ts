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
  ADAPTER_VERSION,
  isFileKind,
  type CoverageDeclarationItem,
  type RowError,
} from "@/adapters/contracts";
import {
  buildIdempotencyKey,
  mappingVersion as mappingVersionOf,
  stageRawFile,
} from "@/services/importPreview";
import { canImport } from "@/services/access";
import { getObjectText, putObject } from "@/storage";
import { Readable } from "node:stream";

/** 逐行错误 CSV（行号/列/错误码/安全说明；不回显未脱敏原文） */
function errorCsv(errors: RowError[]): string {
  const header = "row,column,code,message";
  const body = errors
    .map((e) => [e.row, e.column ?? "", e.code, `"${String(e.message).replace(/"/g, '""')}"`].join(","))
    .join("\r\n");
  return `${header}\r\n${body}\r\n`;
}

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

  // G2-H05：执行前重查发起人当前有效身份与类型权限（禁用/降权 → 终态拒绝）。
  // G2-R2-H05：与 HTTP 侧 src/lib/session.ts 同款边界——全局领域 User.status=disabled
  // （平台运维级禁用）同样视为失权，Membership active 也不能豁免；不改 D01 方案 A。
  const [membership, uploader] = await Promise.all([
    db.membership.findFirst({
      where: { orgId: task.orgId, userId: task.createdBy },
      select: { status: true, role: true },
    }),
    db.user.findUnique({ where: { id: task.createdBy }, select: { status: true } }),
  ]);
  const identityRevoked =
    !membership ||
    membership.status !== "active" ||
    !uploader ||
    uploader.status === "disabled" ||
    !canImport(membership.role, task.sourceKind);
  if (identityRevoked) {
    await db.importTask.updateMany({
      where: { id: task.id, status: { in: ["uploaded", "validating"] } },
      data: { status: "failed", errorCode: "UPLOAD_PERMISSION_REVOKED" },
    });
    return { status: "failed", valid: 0, errors: 0 };
  }

  const store = await db.store.findUniqueOrThrow({
    where: { id: task.storeId },
    select: { externalStoreId: true, currency: true, timezone: true, datasetVersion: true },
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
    const rawText = await getObjectText(task.rawObjectKey);
    // TASK-008：字段映射 + 统一解析 + 全量校验与预览分类（与提交前重验共用同一条流水线）
    const mappingFields =
      ((task.mapping as { fields?: Record<string, string> } | null)?.fields) ?? {};
    const coverageDeclaration = Array.isArray(task.coverageDeclaration)
      ? (task.coverageDeclaration as unknown as CoverageDeclarationItem[])
      : [];
    const stagedRun = await stageRawFile({
      db,
      rawText,
      kind: task.sourceKind,
      mappingFields,
      orgId: task.orgId,
      storeId: task.storeId,
      namespace: dataSource.sourceNamespace,
      storeExternalId: store.externalStoreId,
      currency: store.currency,
      timezone: store.timezone,
      coverageDeclaration,
    });
    const staged = stagedRun.staged;
    const ignoredColumns = stagedRun.ignoredColumns;
    const rowCount = stagedRun.records.length + stagedRun.batchRowErrors.length;

    if (stagedRun.fatalMappingError) {
      const rowErrors = [stagedRun.fatalMappingError];
      const errorObjectKey = `errors/${task.id}/errors.csv`;
      await putObject(errorObjectKey, Readable.from([errorCsv(rowErrors)]));
      await db.importTask.updateMany({
        where: { id: task.id, status: "validating" },
        data: {
          status: "failed",
          errorCount: rowErrors.length,
          errorObjectKey,
          errorCode: stagedRun.fatalMappingError.code,
          previewVersion: { increment: 1 },
        },
      });
      return { status: "failed", valid: 0, errors: rowErrors.length };
    }

    // H01：任何真实错误（非法时间/数值/枚举/覆盖/币种/引用/冲突等）阻断整文件；
    // IGNORED_COLUMN 是可展示的映射提示，不是错误，单独列示不计数。
    const allErrors: RowError[] = [
      ...stagedRun.batchRowErrors,
      ...staged.rowErrors,
    ];
    const ignoredNotices: RowError[] = ignoredColumns.map((c) => ({
      row: 1,
      column: c,
      code: "IGNORED_COLUMN",
      message: `未映射列 ${c} 已忽略（不导入）`,
    }));
    const failure = allErrors.length > 0 ? allErrors[0] : null;
    const rejected = allErrors.length;
    const success = !failure;

    let errorObjectKey: string | null = null;
    if (allErrors.length + ignoredNotices.length > 0) {
      errorObjectKey = `errors/${task.id}/errors.csv`;
      await putObject(errorObjectKey, Readable.from([errorCsv([...allErrors, ...ignoredNotices])]));
    }

    // staging manifest（私有对象；预览/提交边界都从这里读取）
    // H03：身份与完整性绑定——task_id/原文件sha/当前preview_version + 内容校验和，
    // 提交侧逐项核验，错任务/损坏/换版staging一律拒绝
    const mappingArchived = (task.mapping as { mapping_version?: string } | null) ?? {};
    const mappingVersion = mappingArchived.mapping_version ?? mappingVersionOf({});
    const stagingObjectKey = `staging/${task.id}/manifest.json`;
    const manifestBase = {
      kind: task.sourceKind,
      task_id: task.id,
      preview_version: task.previewVersion + 1,
      mapping_version: mappingVersion,
      adapter_version: ADAPTER_VERSION,
      file_sha256: task.fileSha256,
      coverage_declaration: stagedRun.coverage,
      ignored_columns: ignoredColumns,
      row_count: rowCount,
      counts: {
        insert: staged.counts.insert,
        update: staged.counts.update,
        unchanged: staged.counts.unchanged,
        rejected,
        duplicates_folded: staged.duplicatesFolded,
        superseded_in_file: staged.supersededInFile,
        superseded_by_db: staged.supersededByDb,
      },
      coverage_gaps: staged.coverageGaps,
      coverage_only: staged.coverageOnly,
      empty_file: staged.emptyFile,
      rows: staged.rows,
      generated_at: new Date().toISOString(),
    };
    const manifestChecksum = createHash("sha256").update(JSON.stringify(manifestBase)).digest("hex");
    const manifest = { ...manifestBase, checksum: manifestChecksum };
    await putObject(stagingObjectKey, Readable.from([JSON.stringify(manifest)]));

    const idempotencyKey = success
      ? buildIdempotencyKey({
          fileSha256: task.fileSha256,
          orgId: task.orgId,
          storeId: task.storeId,
          namespace: dataSource.sourceNamespace,
          kind: task.sourceKind,
          mappingVersion,
          coverage: stagedRun.coverage,
          adapterVersion: ADAPTER_VERSION,
        })
      : null;
    await db.importTask.updateMany({
      where: { id: task.id, status: "validating" },
      data: {
        status: failure ? "failed" : "preview_ready",
        validCount: staged.rows.length,
        errorCount: rejected,
        rowCount,
        insertCount: success ? staged.counts.insert : 0,
        updateCount: success ? staged.counts.update : 0,
        unchangedCount: success ? staged.counts.unchanged : 0,
        errorObjectKey,
        stagingObjectKey,
        errorCode: failure ? failure.code : null,
        idempotencyKey,
        previewVersion: { increment: 1 },
        baseDatasetVersion: store.datasetVersion,
      },
    });
    return { status: failure ? "failed" : "preview_ready", valid: staged.rows.length, errors: rejected };
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
