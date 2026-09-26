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

/** 自由文本脱敏（与 importPreview.redactFreeText 同规则；预览与落库一致） */
function redactText(v: string): string {
  const masked = v
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "***@***")
    .replace(/(?:\+?86[- ]?)?1\d{10}/g, "***PHONE***")
    .replace(/\d{15,19}/g, "***NO***");
  return masked.length > 200 ? `${masked.slice(0, 200)}…` : masked;
}

function localDateInTz(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
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
      const partialDates = new Set<string>(); // 行遗漏强制 partial（PART12.4）
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
      } else if (kind === "orders") {
        for (const row of staged) {
          const o = row.sample as {
            externalOrderId: string; orderedAt: string; paidAt: string | null;
            paymentStatus: string; currency: string; expectedItemCount: number;
            sourceUpdatedAt: string;
          };
          const existingOrder = await tx.order.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalOrderId: o.externalOrderId },
            select: { id: true, sourceUpdatedAt: true, paymentStatus: true },
          });
          if (existingOrder && existingOrder.sourceUpdatedAt.getTime() > new Date(o.sourceUpdatedAt).getTime()) {
            continue; // 旧版本不覆盖
          }
          // 付款状态回退：已存 paid 改 unpaid/cancelled 且已有成功退款 → 拒绝
          if (
            existingOrder &&
            existingOrder.paymentStatus === "paid" &&
            o.paymentStatus !== "paid"
          ) {
            const items = await tx.orderItem.findMany({
              where: { orgId: ctx.orgId, storeId: task.storeId, orderId: existingOrder.id },
              select: { id: true },
            });
            const refundCount = items.length
              ? await tx.refundEvent.count({
                  where: { orgId: ctx.orgId, storeId: task.storeId, orderItemId: { in: items.map((i) => i.id) }, status: "succeeded" },
                })
              : 0;
            if (refundCount > 0) {
              throw new AccessError(409, "INVALID_PAYMENT_TRANSITION", `订单 ${o.externalOrderId} 存在成功退款，不能改为 ${o.paymentStatus}`);
            }
          }
          const itemCount = existingOrder
            ? await tx.orderItem.count({ where: { orgId: ctx.orgId, storeId: task.storeId, orderId: existingOrder.id } })
            : 0;
          if (itemCount > o.expectedItemCount) {
            throw new AccessError(409, "ITEM_COUNT_EXCEEDED", `订单 ${o.externalOrderId} 现存行数 ${itemCount} 超过 expected_item_count=${o.expectedItemCount}`);
          }
          await tx.order.upsert({
            where: { orgId_storeId_sourceNamespace_externalOrderId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalOrderId: o.externalOrderId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              externalOrderId: o.externalOrderId, sourceUpdatedAt: new Date(o.sourceUpdatedAt),
              importTaskId: task.id, rowHash: row.row_hash,
              orderedAt: new Date(o.orderedAt), paidAt: o.paidAt ? new Date(o.paidAt) : null,
              paymentStatus: o.paymentStatus as "paid",
              currency: o.currency, expectedItemCount: o.expectedItemCount,
            },
            update: {
              orderedAt: new Date(o.orderedAt), paidAt: o.paidAt ? new Date(o.paidAt) : null,
              paymentStatus: o.paymentStatus as "paid",
              currency: o.currency, expectedItemCount: o.expectedItemCount,
              sourceUpdatedAt: new Date(o.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          changed += 1;
        }
      } else if (kind === "order_items") {
        for (const row of staged) {
          const it = row.sample as {
            externalOrderId: string; externalOrderItemId: string; externalSkuId: string;
            quantity: number; itemPaidAmount: string; currency: string; sourceUpdatedAt: string;
          };
          const parentOrder = await tx.order.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalOrderId: it.externalOrderId },
            select: { id: true },
          });
          if (!parentOrder) {
            throw new AccessError(409, "MISSING_ORDER_REFERENCE", `订单 ${it.externalOrderId} 不存在，订单行不能提交`);
          }
          const sku = await tx.sKU.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalSkuId: it.externalSkuId },
            select: { id: true },
          });
          if (!sku) {
            throw new AccessError(409, "SKU_NOT_FOUND", `SKU ${it.externalSkuId} 不存在，订单行不能提交`);
          }
          const existingItem = await tx.orderItem.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, orderId: parentOrder.id, externalOrderItemId: it.externalOrderItemId },
            select: { id: true, sourceUpdatedAt: true },
          });
          if (existingItem && existingItem.sourceUpdatedAt.getTime() > new Date(it.sourceUpdatedAt).getTime()) {
            continue; // 旧版本不覆盖
          }
          await tx.orderItem.upsert({
            where: { orgId_storeId_sourceNamespace_orderId_externalOrderItemId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              orderId: parentOrder.id, externalOrderItemId: it.externalOrderItemId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              orderId: parentOrder.id, externalOrderItemId: it.externalOrderItemId,
              skuId: sku.id, quantity: it.quantity, itemPaidAmount: it.itemPaidAmount,
              currency: it.currency, sourceUpdatedAt: new Date(it.sourceUpdatedAt),
              importTaskId: task.id, rowHash: row.row_hash,
            },
            update: {
              skuId: sku.id, quantity: it.quantity, itemPaidAmount: it.itemPaidAmount,
              currency: it.currency, sourceUpdatedAt: new Date(it.sourceUpdatedAt),
              rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          // 缺行检查在 upsert 之后：present < expected → 该付款日强制 partial
          const orderRow = await tx.order.findUniqueOrThrow({ where: { id: parentOrder.id }, select: { expectedItemCount: true, paidAt: true, orderedAt: true } });
          const presentCount = await tx.orderItem.count({ where: { orgId: ctx.orgId, storeId: task.storeId, orderId: parentOrder.id } });
          if (presentCount < orderRow.expectedItemCount) {
            const baseDay = orderRow.paidAt ?? orderRow.orderedAt;
            partialDates.add(localDateInTz(store.timezone, baseDay));
          }
          changed += 1;
        }
      } else if (kind === "ads") {
        for (const row of staged) {
          const a = row.sample as {
            campaignId: string; campaignName: string; reportDate: string;
            attributionModel: string; attributionWindowDays: number;
            spend: string; attributedSales: string; currency: string; sourceUpdatedAt: string;
          };
          const existing = await tx.adMetric.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, campaignId: a.campaignId, reportDate: new Date(`${a.reportDate}T00:00:00Z`), attributionModel: a.attributionModel, attributionWindowDays: a.attributionWindowDays, currency: a.currency },
            select: { id: true, sourceUpdatedAt: true },
          });
          if (existing && existing.sourceUpdatedAt.getTime() > new Date(a.sourceUpdatedAt).getTime()) {
            continue; // 旧版本不覆盖
          }
          await tx.adMetric.upsert({
            where: { orgId_storeId_sourceNamespace_campaignId_reportDate_attributionModel_attributionWindowDays_currency: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              campaignId: a.campaignId, reportDate: new Date(`${a.reportDate}T00:00:00Z`),
              attributionModel: a.attributionModel, attributionWindowDays: a.attributionWindowDays, currency: a.currency,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              campaignId: a.campaignId, campaignName: a.campaignName,
              reportDate: new Date(`${a.reportDate}T00:00:00Z`),
              attributionModel: a.attributionModel, attributionWindowDays: a.attributionWindowDays,
              spend: a.spend, attributedSales: a.attributedSales, currency: a.currency,
              sourceUpdatedAt: new Date(a.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
            },
            update: {
              campaignName: a.campaignName, spend: a.spend, attributedSales: a.attributedSales,
              sourceUpdatedAt: new Date(a.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          changed += 1;
        }
      } else if (kind === "customer_messages") {
        for (const row of staged) {
          const m = row.sample as {
            externalMessageId: string; externalConversationId: string; messageAt: string;
            channel: string; message_text: string; language: string;
            externalSkuId: string | null; isComplaint: boolean | null; sourceUpdatedAt: string;
          };
          let skuId: string | null = null;
          if (m.externalSkuId) {
            skuId = (await tx.sKU.findFirstOrThrow({
              where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalSkuId: m.externalSkuId },
              select: { id: true },
            })).id;
          }
          await tx.customerMessage.upsert({
            where: { orgId_storeId_sourceNamespace_externalMessageId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalMessageId: m.externalMessageId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              externalMessageId: m.externalMessageId, externalConversationId: m.externalConversationId,
              messageAt: new Date(m.messageAt), channel: m.channel, language: m.language,
              redactedText: m.message_text, skuId, isComplaint: m.isComplaint,
              sourceUpdatedAt: new Date(m.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
            },
            update: {
              messageAt: new Date(m.messageAt), channel: m.channel, language: m.language,
              redactedText: m.message_text, skuId, isComplaint: m.isComplaint,
              sourceUpdatedAt: new Date(m.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          changed += 1;
        }
      } else if (kind === "after_sales") {
        for (const row of staged) {
          const a = row.sample as {
            recordType: "case" | "refund"; externalRecordId: string; externalOrderId: string;
            externalOrderItemId: string; relatedCaseId: string | null; occurredAt: string;
            status: string; completedAt: string | null; refundAmount: string | null;
            refundedQuantityCumulative: number | null; currency: string | null;
            reasonCode: string; reason_text: string | null; sourceUpdatedAt: string;
          };
          const parentOrder = await tx.order.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalOrderId: a.externalOrderId },
            select: { id: true },
          });
          const parentItem = parentOrder
            ? await tx.orderItem.findFirst({ where: { orgId: ctx.orgId, storeId: task.storeId, orderId: parentOrder.id, externalOrderItemId: a.externalOrderItemId }, select: { id: true } })
            : null;
          if (!parentOrder || !parentItem) {
            throw new AccessError(409, "MISSING_ORDER_REFERENCE", `售后行 ${a.externalRecordId} 引用的订单行不存在`);
          }
          if (a.recordType === "case") {
            await tx.afterSaleRecord.upsert({
              where: { orgId_storeId_sourceNamespace_externalRecordId: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: a.externalRecordId,
              } },
              create: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
                externalRecordId: a.externalRecordId, orderId: parentOrder.id, orderItemId: parentItem.id,
                occurredAt: new Date(a.occurredAt), status: a.status as "requested",
                reasonCode: a.reasonCode, reasonText: a.reason_text ? redactText(a.reason_text) : null,
                sourceUpdatedAt: new Date(a.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
              },
              update: {
                occurredAt: new Date(a.occurredAt), status: a.status as "requested",
                reasonCode: a.reasonCode, reasonText: a.reason_text ? redactText(a.reason_text) : null,
                sourceUpdatedAt: new Date(a.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
              },
            });
          } else {
            let caseId: string | null = null;
            if (a.relatedCaseId) {
              caseId = (await tx.afterSaleRecord.findFirstOrThrow({
                where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: a.relatedCaseId },
                select: { id: true },
              })).id;
            }
            await tx.refundEvent.upsert({
              where: { orgId_storeId_sourceNamespace_externalRecordId: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: a.externalRecordId,
              } },
              create: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
                externalRecordId: a.externalRecordId, orderId: parentOrder.id, orderItemId: parentItem.id,
                afterSaleRecordId: caseId, occurredAt: new Date(a.occurredAt),
                status: a.status as "succeeded",
                completedAt: a.completedAt ? new Date(a.completedAt) : null,
                refundAmount: a.refundAmount, refundedQuantityCumulative: a.refundedQuantityCumulative,
                currency: a.currency ?? "CNY", reasonCode: a.reasonCode,
                reasonText: a.reason_text ? redactText(a.reason_text) : null,
                sourceUpdatedAt: new Date(a.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
              },
              update: {
                afterSaleRecordId: caseId, occurredAt: new Date(a.occurredAt),
                status: a.status as "succeeded",
                completedAt: a.completedAt ? new Date(a.completedAt) : null,
                refundAmount: a.refundAmount, refundedQuantityCumulative: a.refundedQuantityCumulative,
                currency: a.currency ?? "CNY", reasonCode: a.reasonCode,
                reasonText: a.reason_text ? redactText(a.reason_text) : null,
                sourceUpdatedAt: new Date(a.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
              },
            });
          }
          changed += 1;
        }
      }

      // 覆盖声明（用户确认制；非文件推断）：products 记录目录确认日
      const nowLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: store.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const newVersion = changed > 0 || manifest.coverage_declaration.length > 0 ? baseVersion + 1n : baseVersion;
      for (const item of manifest.coverage_declaration) {
        if (item.source_kind !== kind) continue;
        const zero = new Set(item.explicit_zero_dates);
        const dates = kind === "products" ? [nowLocal] : expandRange(item.from, item.to);
        for (const date of dates) {
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
              status: partialDates.has(date) ? "partial" : item.status === "partial" ? "partial" : "complete",
              explicitZero: zero.has(date),
              recordCount,
              datasetVersion: newVersion,
              importTaskId: task.id,
            },
            update: {
              status: partialDates.has(date) ? "partial" : item.status === "partial" ? "partial" : "complete",
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
