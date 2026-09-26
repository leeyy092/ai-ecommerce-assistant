/**
 * TASK-009｜原子提交内核与商品主数据。
 *
 * 用户功能：用户确认预览后，整文件商品/覆盖在一个数据库事务中原子落库；
 * 重复提交复用结果不增版本；提交失败整文件回滚并回到可重试预览态。
 *
 * 合同：09_TASKS TASK-009；04 §10.5（ImportTask/状态/幂等键）、PART11.1 步骤6–7、
 * §11.3（dataset_version 语义）、PART12.1（跨文件 upsert 协议/无删除语义）、§12.8；
 * 08 §17.3（commit/sku-aliases）。禁止：订单/广告口径；无审计直接改原始记录；
 * 不实现 F17 恢复 UI/通用别名工作台（仅提供显式映射落库端点）。
 */
import { getPrismaClient } from "@/database/prisma";
import { AccessError, canImport, type Role } from "@/services/access";
import { writeAudit } from "@/services/audit";
import { getObjectText } from "@/storage";
import type { CoverageChannel, FileKind } from "@/adapters/contracts";
import type { CoverageChannel as AdapterCoverageChannel } from "@/adapters/contracts";
import type { CoverageChannel as DbCoverageChannel } from "@/generated/prisma/enums";

export interface CommitContext {
  orgId: string;
  userId: string;
  role: Role;
}

export interface CommitResult {
  id: string;
  status: "committed";
  committed_dataset_version: string;
  insert: number;
  update: number;
  unchanged: number;
  no_op: boolean;
  reused: boolean;
}

interface ManifestRow {
  row: number;
  action: "insert" | "update" | "unchanged";
  natural_key: Record<string, string>;
  row_hash: string;
  affected_dates: string[];
  sample: Record<string, unknown>;
}

interface Manifest {
  kind: FileKind;
  mapping_version: string;
  adapter_version: string;
  file_sha256: string;
  coverage_declaration: Array<{
    source_kind: string;
    channel: AdapterCoverageChannel;
    from: string;
    to: string;
    status: string;
    explicit_zero_dates: string[];
  }>;
  counts: { insert: number; update: number; unchanged: number; rejected: number };
  rows: ManifestRow[];
}

/** adapters 通道值（default/case/refund）→ Prisma 枚举成员（default_channel/...） */
function toDbChannel(c: AdapterCoverageChannel): DbCoverageChannel {
  return c === "case" ? "case_channel" : c === "refund" ? "refund_channel" : "default_channel";
}

function expandRange(from: string, to: string): string[] {
  const out: string[] = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let guard = 0;
  while (d < end && guard < 100000) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
    guard += 1;
  }
  return out;
}

export async function commitImportTask(
  ctx: CommitContext,
  taskId: string,
  body: { preview_version: number; confirmation: boolean },
): Promise<CommitResult> {
  const db = getPrismaClient();
  if (body.confirmation !== true) {
    throw new AccessError(422, "VALIDATION_ERROR", "缺少 confirmation=true 的用户确认");
  }
  const task = await db.importTask.findFirst({ where: { orgId: ctx.orgId, id: taskId } });
  if (!task) throw new AccessError(404, "NOT_FOUND", "导入任务不存在");
  if (!canImport(ctx.role, task.sourceKind)) {
    throw new AccessError(403, "FILE_KIND_FORBIDDEN", "当前角色不能提交该类型导入");
  }
  // 幂等重放：已提交任务复用既有结果（08 §17.3 同一 commit 结果）
  if (task.status === "committed") {
    return {
      id: task.id,
      status: "committed",
      committed_dataset_version: (task.committedDatasetVersion ?? 0n).toString(),
      insert: task.insertCount,
      update: task.updateCount,
      unchanged: task.unchangedCount,
      no_op: task.committedDatasetVersion === task.baseDatasetVersion,
      reused: true,
    };
  }
  if (task.status !== "preview_ready") {
    throw new AccessError(409, "IMPORT_CONFLICT", `当前状态 ${task.status} 不能提交`);
  }
  // 预览过期/变化：preview_version 不等于当前值 → 409（提交只接受当前预览）
  if (body.preview_version !== task.previewVersion) {
    throw new AccessError(409, "VERSION_CONFLICT", "预览已过期或已变化，请重新校验并确认");
  }
  if (!task.stagingObjectKey) {
    throw new AccessError(409, "IMPORT_CONFLICT", "缺少 staging 数据，请重新校验");
  }

  const store = await db.store.findUniqueOrThrow({
    where: { id: task.storeId },
    select: { externalStoreId: true, timezone: true },
  });
  const dataSource = await db.dataSource.findUniqueOrThrow({
    where: { id: task.dataSourceId },
    select: { sourceNamespace: true },
  });
  const manifest = JSON.parse(await getObjectText(task.stagingObjectKey)) as Manifest;

  // 原子认领：preview_ready → committing（并发/重复提交仅一方成功）
  const claimed = await db.importTask.updateMany({
    where: { id: task.id, status: "preview_ready", previewVersion: body.preview_version },
    data: { status: "committing" },
  });
  if (claimed.count === 0) {
    throw new AccessError(409, "IMPORT_CONFLICT", "该任务正在提交或状态已变化");
  }

  const kind = manifest.kind;
  const staged = manifest.rows.filter((r) => r.action !== "unchanged");

  try {
    const result = await db.$transaction(async (tx) => {
      // 按店铺串行化提交（PART11.1 步骤6：店铺事务锁）
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:${ctx.orgId}:${task.storeId}`}))`;
      const storeRow = await tx.store.findUniqueOrThrow({
        where: { id: task.storeId },
        select: { datasetVersion: true },
      });
      const baseVersion = storeRow.datasetVersion;

      let changed = 0;
      if (kind === "products") {
        for (const row of staged) {
          const s = row.sample as {
            externalProductId: string; name: string; category: string | null;
            productStatus: string; externalSkuId: string; skuCode: string;
            skuName: string; specification: string | null; skuStatus: string;
            sourceUpdatedAt: string;
          };
          // 提交前重验来源新旧（预览与提交间其他导入可能已推进）
          const existingSku = await tx.sKU.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalSkuId: s.externalSkuId },
            select: { id: true, sourceUpdatedAt: true, productId: true },
          });
          if (existingSku && existingSku.sourceUpdatedAt.getTime() > new Date(s.sourceUpdatedAt).getTime()) {
            continue; // 旧版本不覆盖
          }
          const product = await tx.product.upsert({
            where: { orgId_storeId_sourceNamespace_externalProductId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalProductId: s.externalProductId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              externalProductId: s.externalProductId, sourceUpdatedAt: new Date(s.sourceUpdatedAt),
              importTaskId: task.id, rowHash: row.row_hash,
              name: s.name, category: s.category, status: s.productStatus === "archived" ? "archived" : "active",
            },
            update: {
              name: s.name, category: s.category,
              status: s.productStatus === "archived" ? "archived" : "active",
              sourceUpdatedAt: new Date(s.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          await tx.sKU.upsert({
            where: { orgId_storeId_sourceNamespace_externalSkuId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalSkuId: s.externalSkuId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              externalSkuId: s.externalSkuId, skuCode: s.skuCode, name: s.skuName,
              specification: s.specification, status: s.skuStatus === "archived" ? "archived" : "active",
              productId: product.id, sourceUpdatedAt: new Date(s.sourceUpdatedAt),
              importTaskId: task.id, rowHash: row.row_hash,
            },
            update: {
              name: s.skuName, specification: s.specification,
              status: s.skuStatus === "archived" ? "archived" : "active",
              productId: product.id,
              sourceUpdatedAt: new Date(s.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          changed += 1;
        }
      } else {
        // TASK-010–012 落库其余五类；本 TASK 仅注册商品提交路径
        throw new AccessError(422, "VALIDATION_ERROR", `当前提交内核仅支持 products（${kind} 属后续 TASK 合同）`);
      }

      // 覆盖声明（用户确认制；非文件推断）：products 记录目录确认日
      const nowLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: store.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      console.log("COMMIT_DEBUG", JSON.stringify({ declared: manifest.coverage_declaration.length, changed, baseVersion: baseVersion.toString() }));
      const newVersion = changed > 0 || manifest.coverage_declaration.length > 0 ? baseVersion + 1n : baseVersion;
      for (const item of manifest.coverage_declaration) {
        if (item.source_kind !== kind) continue;
        const zero = new Set(item.explicit_zero_dates);
        const dates = kind === "products" ? [nowLocal] : expandRange(item.from, item.to);
        for (const date of dates) {
          console.log("COVERAGE_UPSERT", date, item.channel);
          const recordCount = manifest.rows.filter((r) => r.affected_dates.includes(date)).length;
          await tx.dataCoverage.upsert({
            where: {
              orgId_storeId_dataSourceId_sourceKind_channel_coverageDate_datasetVersion: {
                orgId: ctx.orgId, storeId: task.storeId, dataSourceId: task.dataSourceId,
                sourceKind: item.source_kind as "products",
                channel: toDbChannel(item.channel),
                coverageDate: new Date(`${date}T00:00:00Z`),
                datasetVersion: newVersion,
              },
            },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, dataSourceId: task.dataSourceId,
              sourceKind: item.source_kind as "products",
              channel: toDbChannel(item.channel),
              coverageDate: new Date(`${date}T00:00:00Z`),
              status: item.status === "partial" ? "partial" : "complete",
              explicitZero: zero.has(date),
              recordCount,
              datasetVersion: newVersion,
              importTaskId: task.id,
            },
            update: {
              status: item.status === "partial" ? "partial" : "complete",
              explicitZero: zero.has(date),
              recordCount,
              importTaskId: task.id,
            },
          });
        }
      }

      const committedVersion = newVersion;
      await tx.importTask.update({
        where: { id: task.id },
        data: {
          status: "committed",
          confirmedAt: new Date(),
          committedAt: new Date(),
          committedDatasetVersion: committedVersion,
          outboxStatus: "pending",
        },
      });
      if (committedVersion !== baseVersion) {
        await tx.store.update({
          where: { id: task.storeId },
          data: { datasetVersion: committedVersion },
        });
      }
      await writeAudit(tx, {
        orgId: ctx.orgId,
        storeId: task.storeId,
        actorUserId: ctx.userId,
        action: "import_commit",
        entityType: "import_task",
        entityId: task.id,
        afterSummary: {
          kind,
          dataset_version: committedVersion.toString(),
          insert: manifest.counts.insert,
          update: manifest.counts.update,
          unchanged: manifest.counts.unchanged,
          no_op: committedVersion === baseVersion,
        },
      });
      return { committedVersion, baseVersion };
    });

    const noOp = result.committedVersion === result.baseVersion;
    return {
      id: task.id,
      status: "committed",
      committed_dataset_version: result.committedVersion.toString(),
      insert: manifest.counts.insert,
      update: manifest.counts.update,
      unchanged: manifest.counts.unchanged,
      no_op: noOp || staged.length === 0,
      reused: false,
    };
  } catch (error) {
    // 整文件回滚后恢复预览态（可重试）；不产生半份业务数据/半份覆盖
    await db.importTask.updateMany({
      where: { id: task.id, status: "committing" },
      data: { status: "preview_ready" },
    });
    throw error;
  }
}
