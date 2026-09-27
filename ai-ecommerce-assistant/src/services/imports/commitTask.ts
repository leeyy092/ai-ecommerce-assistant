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
 *
 * G3R1-20260927-02 落实：H03 提交时效/导入者重查/当前数据重验；H04 按最终事实
 * 生成覆盖（行齐才 complete、record_count 为已接收事实数）；H05/F05 权威来源组
 * 原子绑定；H06 显式别名提交消费；H02 退款全历史提交重验与行更正上界；
 * H08 完整脱敏正文（与预览摘录分离）；M01 同语义重复不增版本。
 */
import { createHash } from "node:crypto";
import { getPrismaClient } from "@/database/prisma";
import { AccessError, canImport, type Role } from "@/services/access";
import { writeAudit } from "@/services/audit";
import { getObjectText } from "@/storage";
import { redactFreeText, stageRawFile } from "@/services/importPreview";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  CoverageChannel as AdapterCoverageChannel,
  CoverageDeclarationItem,
  FileKind,
} from "@/adapters/contracts";
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
  /** 完整规范化记录（新流水线写入；旧 manifest 缺省时回退 sample） */
  record?: Record<string, unknown>;
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
  generated_at?: string;
  /** H03：身份与完整性绑定字段（新流水线写入） */
  task_id?: string;
  preview_version?: number;
  checksum?: string;
}

/** adapters 通道值（default/case/refund）→ Prisma 枚举成员（default_channel/...） */
function toDbChannel(c: AdapterCoverageChannel): DbCoverageChannel {
  return c === "case" ? "case_channel" : c === "refund" ? "refund_channel" : "default_channel";
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

/** H06：直接 SKU 或同店同来源显式 SkuAlias → canonical SKU id（预览/提交共享口径） */
async function resolveSkuId(
  tx: Prisma.TransactionClient | PrismaClient,
  orgId: string,
  storeId: string,
  namespace: string,
  extId: string,
): Promise<string | null> {
  const direct = await tx.sKU.findFirst({
    where: { orgId, storeId, sourceNamespace: namespace, externalSkuId: extId },
    select: { id: true },
  });
  if (direct) return direct.id;
  const alias = await tx.skuAlias.findFirst({
    where: { orgId, storeId, sourceNamespace: namespace, externalSkuId: extId },
    select: { skuId: true },
  });
  return alias?.skuId ?? null;
}

function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** 店铺本地自然日的本地午夜对应 UTC 时刻（两遍逼近消除 DST 偏差） */
function localMidnightUtc(tz: string, date: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  let at = new Date(naive - tzOffsetMs(tz, new Date(naive)));
  at = new Date(naive - tzOffsetMs(tz, at));
  return at;
}

/** 店铺本地自然日 → UTC 窗口 [start, end)：起止各为相邻本地午夜，IANA 时区 DST 正确（H04） */
function localDayUtcRange(tz: string, date: string): { start: Date; end: Date } {
  const nextDate = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: localMidnightUtc(tz, date), end: localMidnightUtc(tz, nextDate) };
}

/** 该来源日已接收事实计数（G3R1-H04C01 合同口径：租户/店铺/来源namespace/类型/channel/业务日，
 *  整批提交后的最终事实，不只本文件、不跨来源混算；订单/行按付款日归日） */
async function countFactsForDate(
  tx: Prisma.TransactionClient | PrismaClient,
  args: {
    orgId: string; storeId: string; namespace: string; tz: string;
    kind: FileKind; channel: AdapterCoverageChannel; date: string;
  },
): Promise<bigint> {
  const { orgId, storeId, namespace, tz, kind, channel, date } = args;
  const ns = { sourceNamespace: namespace };
  if (kind === "products") return 0n; // 目录确认不按日计数（record_count 由调用方记确认行数）
  if (kind === "ads") {
    return BigInt(await tx.adMetric.count({
      where: { orgId, storeId, ...ns, reportDate: new Date(`${date}T00:00:00Z`) },
    }));
  }
  const { start, end } = localDayUtcRange(tz, date);
  if (kind === "orders") {
    const paid = await tx.order.count({ where: { orgId, storeId, ...ns, paidAt: { gte: start, lt: end } } });
    const noPaid = await tx.order.count({ where: { orgId, storeId, ...ns, paidAt: null, orderedAt: { gte: start, lt: end } } });
    return BigInt(paid + noPaid);
  }
  if (kind === "order_items") {
    return BigInt(await tx.orderItem.count({
      where: {
        orgId, storeId, ...ns,
        order: { OR: [{ paidAt: { gte: start, lt: end } }, { paidAt: null, orderedAt: { gte: start, lt: end } }] },
      },
    }));
  }
  if (kind === "customer_messages") {
    return BigInt(await tx.customerMessage.count({
      where: { orgId, storeId, ...ns, messageAt: { gte: start, lt: end } },
    }));
  }
  if (channel === "case") {
    return BigInt(await tx.afterSaleRecord.count({
      where: { orgId, storeId, ...ns, occurredAt: { gte: start, lt: end } },
    }));
  }
  return BigInt(await tx.refundEvent.count({
    where: { orgId, storeId, ...ns, status: "succeeded", completedAt: { gte: start, lt: end } },
  }));
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
    select: { externalStoreId: true, timezone: true, currency: true },
  });
  const dataSource = await db.dataSource.findUniqueOrThrow({
    where: { id: task.dataSourceId },
    select: { sourceNamespace: true },
  });
  const manifest = JSON.parse(await getObjectText(task.stagingObjectKey)) as Manifest;

  // H03：staging 身份与完整性绑定——与任务/原文件/当前预览逐项一致，校验和防错配与损坏；
  // 不一致一律 409 且零业务副作用（正常确认/幂等重放/时效与权限保护保持）
  const { checksum: manifestChecksum, ...manifestBody } = manifest as unknown as Record<string, unknown>;
  const identityOk =
    manifest.task_id === task.id &&
    manifest.file_sha256 === task.fileSha256 &&
    manifest.kind === task.sourceKind &&
    manifest.preview_version === task.previewVersion &&
    typeof manifestChecksum === "string" &&
    manifestChecksum === createHash("sha256").update(JSON.stringify(manifestBody)).digest("hex");
  if (!identityOk) {
    throw new AccessError(409, "PREVIEW_IDENTITY_MISMATCH", "staging 数据与任务/原文件/当前预览不一致，请重新校验后确认");
  }

  // H03b：staging 时效——预览 24 小时有效，过期必须重新校验（不接受确认）
  const generatedAt = Date.parse(manifest.generated_at ?? "");
  if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > 24 * 3600 * 1000) {
    throw new AccessError(409, "IMPORT_PREVIEW_STALE", "预览已超过 24 小时有效期，请重新校验后确认");
  }

  // H03c：提交前重查导入者（created_by）当前身份与类型权限——撤权后他人确认也不得提交
  const [creatorMembership, creatorUser] = await Promise.all([
    db.membership.findFirst({
      where: { orgId: task.orgId, userId: task.createdBy },
      select: { status: true, role: true },
    }),
    db.user.findUnique({ where: { id: task.createdBy }, select: { status: true } }),
  ]);
  if (
    !creatorMembership ||
    creatorMembership.status !== "active" ||
    !creatorUser ||
    creatorUser.status === "disabled" ||
    !canImport(creatorMembership.role as Role, task.sourceKind)
  ) {
    throw new AccessError(403, "UPLOAD_PERMISSION_REVOKED", "导入者身份已失效或无该类型导入权限，不能提交");
  }

  // 原子认领：preview_ready → committing（并发/重复提交仅一方成功）
  const claimed = await db.importTask.updateMany({
    where: { id: task.id, status: "preview_ready", previewVersion: body.preview_version },
    data: { status: "committing" },
  });
  if (claimed.count === 0) {
    throw new AccessError(409, "IMPORT_CONFLICT", "该任务正在提交或状态已变化");
  }

  const kind = manifest.kind;

  try {
    const result = await db.$transaction(async (tx) => {
      // 按店铺串行化提交（PART11.1 步骤6：店铺事务锁）
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`commit:${ctx.orgId}:${task.storeId}`}))`;
      const storeRow = await tx.store.findUniqueOrThrow({
        where: { id: task.storeId },
        select: { datasetVersion: true, settings: true },
      });
      const baseVersion = storeRow.datasetVersion;

      // H05/F05：权威来源检查——交易四通道共用同一来源组，其他来源写入拒绝（含并发首次，事务锁串行）
      const settings = (storeRow.settings ?? {}) as Record<string, unknown>;
      const authoritative = (settings.authoritative_source_ids ?? {}) as Record<string, string>;
      const isTrading = kind === "orders" || kind === "order_items" || kind === "after_sales";
      const channelsToBind: string[] = isTrading
        ? ["orders/default", "order_items/default", "after_sales/case", "after_sales/refund"]
        : kind === "ads"
          ? ["ads/default"]
          : kind === "customer_messages"
            ? ["customer_messages/default"]
            : []; // products 只记录目录确认，不绑定事件通道
      for (const ch of channelsToBind) {
        const bound = authoritative[ch];
        if (bound && bound !== task.dataSourceId) {
          throw new AccessError(409, "SOURCE_MIGRATION_REQUIRED", `channel ${ch} 已绑定权威来源 ${bound}；本任务来源为 ${task.dataSourceId}，不能写入（来源迁移属后续单独任务）`);
        }
      }

      // H03：预览依据版本与当前版本不一致 → 按当前数据重新分类校验；
      // 出现任何错误（引用变化/同刻冲突/退款越界等）则拒绝，需重新校验预览
      let effectiveRows: ManifestRow[] = manifest.rows;
      if (storeRow.datasetVersion !== task.baseDatasetVersion) {
        const rawText = await getObjectText(task.rawObjectKey ?? "");
        const restage = await stageRawFile({
          db: tx,
          rawText,
          kind,
          mappingFields: ((task.mapping as { fields?: Record<string, string> } | null)?.fields) ?? {},
          orgId: task.orgId,
          storeId: task.storeId,
          namespace: dataSource.sourceNamespace,
          storeExternalId: store.externalStoreId,
          currency: store.currency,
          timezone: store.timezone,
          coverageDeclaration: (Array.isArray(task.coverageDeclaration)
            ? (task.coverageDeclaration as unknown as CoverageDeclarationItem[])
            : []),
        });
        const errors: Array<{ code: string }> = [
          ...(restage.fatalMappingError ? [restage.fatalMappingError] : []),
          ...restage.batchRowErrors,
          ...restage.staged.rowErrors,
        ];
        if (errors.length > 0) {
          throw new AccessError(409, "IMPORT_PREVIEW_STALE", "预览后数据已变化，重新校验未通过；请重新校验并确认预览");
        }
        effectiveRows = restage.staged.rows as unknown as ManifestRow[];
      }
      const staged = effectiveRows.filter((r) => r.action !== "unchanged");

      let changed = 0;
      const affectedRefundItemIds = new Set<string>(); // after_sales 提交后退款总账重验（H02）
      if (kind === "products") {
        for (const row of staged) {
          const s = (row.record ?? row.sample) as {
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
          const o = (row.record ?? row.sample) as {
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
          const it = (row.record ?? row.sample) as {
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
          // H06：直接 SKU 或显式别名解析（与预览共享口径）
          const skuId = await resolveSkuId(tx, ctx.orgId, task.storeId, dataSource.sourceNamespace, it.externalSkuId);
          if (!skuId) {
            throw new AccessError(409, "SKU_NOT_FOUND", `SKU ${it.externalSkuId} 不存在（含显式别名解析），订单行不能提交`);
          }
          const existingItem = await tx.orderItem.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, orderId: parentOrder.id, externalOrderItemId: it.externalOrderItemId },
            select: { id: true, sourceUpdatedAt: true },
          });
          if (existingItem && existingItem.sourceUpdatedAt.getTime() > new Date(it.sourceUpdatedAt).getTime()) {
            continue; // 旧版本不覆盖
          }
          // H02c：金额/件数更正必须满足既有成功退款上界（全历史，提交侧重验）
          if (existingItem) {
            const refunds = await tx.refundEvent.findMany({
              where: { orderItemId: existingItem.id, status: "succeeded" },
              select: { refundAmount: true, refundedQuantityCumulative: true },
            });
            const total = refunds.reduce(
              (s, r) => s.add(new Prisma.Decimal(String(r.refundAmount ?? 0))),
              new Prisma.Decimal(0),
            );
            if (total.gt(new Prisma.Decimal(it.itemPaidAmount))) {
              throw new AccessError(409, "REFUND_AMOUNT_EXCEEDS_PAID", `订单行 ${it.externalOrderId}/${it.externalOrderItemId} 已有成功退款合计 ${total.toString()}，更正后实付 ${it.itemPaidAmount} 突破退款上界`);
            }
            const maxQty = refunds.reduce((m, r) => Math.max(m, r.refundedQuantityCumulative ?? 0), 0);
            if (maxQty > it.quantity) {
              throw new AccessError(409, "REFUND_QUANTITY_CONFLICT", `订单行 ${it.externalOrderId}/${it.externalOrderItemId} 已有累计退件 ${maxQty}，更正后数量 ${it.quantity} 低于上界`);
            }
          }
          await tx.orderItem.upsert({
            where: { orgId_storeId_sourceNamespace_orderId_externalOrderItemId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              orderId: parentOrder.id, externalOrderItemId: it.externalOrderItemId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              orderId: parentOrder.id, externalOrderItemId: it.externalOrderItemId,
              skuId, quantity: it.quantity, itemPaidAmount: it.itemPaidAmount,
              currency: it.currency, sourceUpdatedAt: new Date(it.sourceUpdatedAt),
              importTaskId: task.id, rowHash: row.row_hash,
            },
            update: {
              skuId, quantity: it.quantity, itemPaidAmount: it.itemPaidAmount,
              currency: it.currency, sourceUpdatedAt: new Date(it.sourceUpdatedAt),
              rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          changed += 1;
        }
      } else if (kind === "ads") {
        for (const row of staged) {
          const a = (row.record ?? row.sample) as {
            campaignId: string; campaignName: string; reportDate: string;
            attributionModel: string; attributionWindowDays: number;
            spend: string; attributedSales: string; currency: string; sourceUpdatedAt: string;
          };
          // H07：完整自然键（campaign/date/model/window/currency）精确对照
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
          const rec = (row.record ?? row.sample) as {
            externalMessageId: string; externalConversationId: string; messageAt: string;
            channel: string; messageText?: string; language: string;
            externalSkuId: string | null; isComplaint: boolean | null; sourceUpdatedAt: string;
          };
          // H08：完整业务正文取自规范化 record（sample 仅为有界预览摘录；旧 manifest 回退）
          const messageText = rec.messageText ?? (row.sample as { message_text?: string }).message_text ?? "";
          // H03a：旧版本不覆盖——预览与提交间已有更新时跳过该行（其余行照常提交）
          const existingMsg = await tx.customerMessage.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalMessageId: rec.externalMessageId },
            select: { id: true, sourceUpdatedAt: true },
          });
          if (existingMsg && existingMsg.sourceUpdatedAt.getTime() > new Date(rec.sourceUpdatedAt).getTime()) {
            continue;
          }
          let skuId: string | null = null;
          if (rec.externalSkuId) {
            skuId = await resolveSkuId(tx, ctx.orgId, task.storeId, dataSource.sourceNamespace, rec.externalSkuId);
            if (!skuId) {
              throw new AccessError(409, "SKU_NOT_FOUND", `SKU ${rec.externalSkuId} 不存在（含显式别名解析），消息不能提交`);
            }
          }
          await tx.customerMessage.upsert({
            where: { orgId_storeId_sourceNamespace_externalMessageId: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalMessageId: rec.externalMessageId,
            } },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
              externalMessageId: rec.externalMessageId, externalConversationId: rec.externalConversationId,
              messageAt: new Date(rec.messageAt), channel: rec.channel, language: rec.language,
              redactedText: redactFreeText(messageText), skuId, isComplaint: rec.isComplaint,
              sourceUpdatedAt: new Date(rec.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
            },
            update: {
              messageAt: new Date(rec.messageAt), channel: rec.channel, language: rec.language,
              redactedText: redactFreeText(messageText), skuId, isComplaint: rec.isComplaint,
              sourceUpdatedAt: new Date(rec.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
            },
          });
          changed += 1;
        }
      } else if (kind === "after_sales") {
        for (const row of staged) {
          const rec = (row.record ?? row.sample) as {
            recordType: "case" | "refund"; externalRecordId: string; externalOrderId: string;
            externalOrderItemId: string; relatedCaseId: string | null; occurredAt: string;
            status: string; completedAt: string | null; refundAmount: string | null;
            refundedQuantityCumulative: number | null; currency: string | null;
            reasonCode: string; reasonText?: string | null; sourceUpdatedAt: string;
          };
          // H08：完整脱敏正文取自规范化 record（旧 manifest 回退 sample 摘录列）
          const reasonFull = rec.reasonText ?? (row.sample as { reason_text?: string | null }).reason_text ?? null;
          const parentOrder = await tx.order.findFirst({
            where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalOrderId: rec.externalOrderId },
            select: { id: true },
          });
          const parentItem = parentOrder
            ? await tx.orderItem.findFirst({ where: { orgId: ctx.orgId, storeId: task.storeId, orderId: parentOrder.id, externalOrderItemId: rec.externalOrderItemId }, select: { id: true } })
            : null;
          if (!parentOrder || !parentItem) {
            throw new AccessError(409, "MISSING_ORDER_REFERENCE", `售后行 ${rec.externalRecordId} 引用的订单行不存在`);
          }
          if (rec.recordType === "case") {
            const existingCase = await tx.afterSaleRecord.findFirst({
              where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: rec.externalRecordId },
              select: { id: true, sourceUpdatedAt: true },
            });
            if (existingCase && existingCase.sourceUpdatedAt.getTime() > new Date(rec.sourceUpdatedAt).getTime()) {
              continue; // 旧版本不覆盖（H03）
            }
            await tx.afterSaleRecord.upsert({
              where: { orgId_storeId_sourceNamespace_externalRecordId: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: rec.externalRecordId,
              } },
              create: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
                externalRecordId: rec.externalRecordId, orderId: parentOrder.id, orderItemId: parentItem.id,
                occurredAt: new Date(rec.occurredAt), status: rec.status as "requested",
                reasonCode: rec.reasonCode, reasonText: reasonFull ? redactFreeText(reasonFull) : null,
                sourceUpdatedAt: new Date(rec.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
              },
              update: {
                occurredAt: new Date(rec.occurredAt), status: rec.status as "requested",
                reasonCode: rec.reasonCode, reasonText: reasonFull ? redactFreeText(reasonFull) : null,
                sourceUpdatedAt: new Date(rec.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
              },
            });
          } else {
            const existingRefund = await tx.refundEvent.findFirst({
              where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: rec.externalRecordId },
              select: { id: true, sourceUpdatedAt: true },
            });
            if (existingRefund && existingRefund.sourceUpdatedAt.getTime() > new Date(rec.sourceUpdatedAt).getTime()) {
              continue; // 旧版本不覆盖（H03）
            }
            let caseId: string | null = null;
            if (rec.relatedCaseId) {
              caseId = (await tx.afterSaleRecord.findFirstOrThrow({
                where: { orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: rec.relatedCaseId },
                select: { id: true },
              })).id;
            }
            await tx.refundEvent.upsert({
              where: { orgId_storeId_sourceNamespace_externalRecordId: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace, externalRecordId: rec.externalRecordId,
              } },
              create: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
                externalRecordId: rec.externalRecordId, orderId: parentOrder.id, orderItemId: parentItem.id,
                afterSaleRecordId: caseId, occurredAt: new Date(rec.occurredAt),
                status: rec.status as "succeeded",
                completedAt: rec.completedAt ? new Date(rec.completedAt) : null,
                refundAmount: rec.refundAmount, refundedQuantityCumulative: rec.refundedQuantityCumulative,
                currency: rec.currency ?? "CNY", reasonCode: rec.reasonCode,
                reasonText: reasonFull ? redactFreeText(reasonFull) : null,
                sourceUpdatedAt: new Date(rec.sourceUpdatedAt), importTaskId: task.id, rowHash: row.row_hash,
              },
              update: {
                afterSaleRecordId: caseId, occurredAt: new Date(rec.occurredAt),
                status: rec.status as "succeeded",
                completedAt: rec.completedAt ? new Date(rec.completedAt) : null,
                refundAmount: rec.refundAmount, refundedQuantityCumulative: rec.refundedQuantityCumulative,
                currency: rec.currency ?? "CNY", reasonCode: rec.reasonCode,
                reasonText: reasonFull ? redactFreeText(reasonFull) : null,
                sourceUpdatedAt: new Date(rec.sourceUpdatedAt), rowHash: row.row_hash, importTaskId: task.id,
              },
            });
            affectedRefundItemIds.add(parentItem.id);
          }
          changed += 1;
        }
        // H02：提交后按受影响订单行重验“全部成功退款”总账（全历史 + 整批；Decimal）
        for (const itemId of affectedRefundItemIds) {
          const item = await tx.orderItem.findUniqueOrThrow({
            where: { id: itemId },
            select: { itemPaidAmount: true, quantity: true },
          });
          const refunds = await tx.refundEvent.findMany({
            where: { orderItemId: itemId, status: "succeeded" },
            select: { refundAmount: true, refundedQuantityCumulative: true, completedAt: true },
            orderBy: { completedAt: "asc" },
          });
          const total = refunds.reduce(
            (s, r) => s.add(new Prisma.Decimal(String(r.refundAmount ?? 0))),
            new Prisma.Decimal(0),
          );
          if (total.gt(item.itemPaidAmount)) {
            throw new AccessError(409, "REFUND_AMOUNT_EXCEEDS_PAID", `订单行成功退款合计 ${total.toString()} 超过实付金额 ${item.itemPaidAmount.toString()}`);
          }
          let prevQty = 0;
          const byStamp = new Map<string, number>();
          for (const r of refunds) {
            const qty = r.refundedQuantityCumulative ?? 0;
            if (qty < prevQty) {
              throw new AccessError(409, "REFUND_QUANTITY_CONFLICT", "累计退件数按完成时间必须非递减");
            }
            const stamp = (r.completedAt ?? new Date(0)).toISOString();
            if (byStamp.has(stamp) && byStamp.get(stamp) !== qty) {
              throw new AccessError(409, "REFUND_QUANTITY_CONFLICT", "同一完成时刻存在不同累计退件数，顺序不确定");
            }
            byStamp.set(stamp, qty);
            prevQty = qty;
          }
          if (prevQty > item.quantity) {
            throw new AccessError(409, "REFUND_QUANTITY_CONFLICT", `累计退件 ${prevQty} 超过订单行数量 ${item.quantity}`);
          }
        }
      }

      // H04（R2）：行齐按所声明来源日的全部相关最终订单判断——含历史与 unchanged，
      // 不只本任务发生变更的订单；任一订单缺行即该来源日保持 partial
      const partialDates = new Set<string>();
      if (kind === "order_items") {
        for (const item of manifest.coverage_declaration) {
          if (item.source_kind !== kind) continue;
          for (const date of expandRange(item.from, item.to)) {
            const { start, end } = localDayUtcRange(store.timezone, date);
            const ordersOnDay = await tx.order.findMany({
              where: {
                orgId: ctx.orgId, storeId: task.storeId, sourceNamespace: dataSource.sourceNamespace,
                OR: [{ paidAt: { gte: start, lt: end } }, { paidAt: null, orderedAt: { gte: start, lt: end } }],
              },
              select: { id: true, expectedItemCount: true },
            });
            for (const o of ordersOnDay) {
              const present = await tx.orderItem.count({ where: { orgId: ctx.orgId, storeId: task.storeId, orderId: o.id } });
              if (present < o.expectedItemCount) {
                partialDates.add(date);
                break;
              }
            }
          }
        }
      }

      // 覆盖声明（用户确认制；非文件推断）：products 记录目录确认日
      const nowLocal = localDateInTz(store.timezone, new Date());
      interface WouldCoverage {
        sourceKind: string; channel: AdapterCoverageChannel; date: string;
        status: "complete" | "partial"; explicitZero: boolean; recordCount: bigint;
      }
      const wouldCoverage: WouldCoverage[] = [];
      for (const item of manifest.coverage_declaration) {
        if (item.source_kind !== kind) continue;
        const zero = new Set(item.explicit_zero_dates);
        const dates = kind === "products" ? [nowLocal] : expandRange(item.from, item.to);
        for (const date of dates) {
          // G3R1-H04C01：已接收事实数 = 整批提交后该来源日的最终事实计数（不只本文件、不跨来源）
          const recordCount = kind === "products"
            ? BigInt(effectiveRows.length)
            : await countFactsForDate(tx, {
                orgId: ctx.orgId, storeId: task.storeId, namespace: dataSource.sourceNamespace,
                tz: store.timezone, kind, channel: item.channel, date,
              });
          if (zero.has(date) && recordCount > 0n) {
            throw new AccessError(409, "EXPLICIT_ZERO_CONFLICT", `显式零事件声明与既有事实冲突：${item.source_kind}/${item.channel}/${date}`);
          }
          // H04：无接收事实且未显式声明零事件的空缺日不写完整（0 不能自动升级 complete）
          const status: "complete" | "partial" =
            partialDates.has(date) || (kind !== "products" && recordCount === 0n && !zero.has(date))
              ? "partial"
              : item.status === "partial"
                ? "partial"
                : "complete";
          wouldCoverage.push({ sourceKind: item.source_kind, channel: item.channel, date, status, explicitZero: zero.has(date), recordCount });
        }
      }

      // M01：版本只随“最终事实或有效覆盖”的实际变化递增；同语义重复不增版本
      let coverageChanged = false;
      for (const w of wouldCoverage) {
        const existing = await tx.dataCoverage.findFirst({
          where: {
            orgId: ctx.orgId, storeId: task.storeId, dataSourceId: task.dataSourceId,
            sourceKind: w.sourceKind as "products", channel: toDbChannel(w.channel),
            coverageDate: new Date(`${w.date}T00:00:00Z`),
          },
          orderBy: { datasetVersion: "desc" },
        });
        if (!existing || existing.status !== w.status || existing.explicitZero !== w.explicitZero || existing.recordCount !== w.recordCount) {
          coverageChanged = true;
          break;
        }
      }
      const versionBump = changed > 0 || (wouldCoverage.length > 0 && coverageChanged);
      const newVersion = versionBump ? baseVersion + 1n : baseVersion;

      if (versionBump) {
        for (const w of wouldCoverage) {
          await tx.dataCoverage.upsert({
            where: {
              orgId_storeId_dataSourceId_sourceKind_channel_coverageDate_datasetVersion: {
                orgId: ctx.orgId, storeId: task.storeId, dataSourceId: task.dataSourceId,
                sourceKind: w.sourceKind as "products", channel: toDbChannel(w.channel),
                coverageDate: new Date(`${w.date}T00:00:00Z`), datasetVersion: newVersion,
              },
            },
            create: {
              orgId: ctx.orgId, storeId: task.storeId, dataSourceId: task.dataSourceId,
              sourceKind: w.sourceKind as "products", channel: toDbChannel(w.channel),
              coverageDate: new Date(`${w.date}T00:00:00Z`),
              status: w.status, explicitZero: w.explicitZero, recordCount: w.recordCount,
              datasetVersion: newVersion, importTaskId: task.id,
            },
            update: {
              status: w.status, explicitZero: w.explicitZero, recordCount: w.recordCount,
              importTaskId: task.id,
            },
          });
        }
        // H05/F05：首次事实或覆盖确认时，与事实/coverage/版本同事务绑定权威来源组
        if (channelsToBind.length > 0) {
          const nextAuth = { ...authoritative };
          let dirty = false;
          for (const ch of channelsToBind) {
            if (!nextAuth[ch]) {
              nextAuth[ch] = task.dataSourceId;
              dirty = true;
            }
          }
          if (dirty) {
            await tx.store.update({
              where: { id: task.storeId },
              data: { settings: { ...settings, authoritative_source_ids: nextAuth } },
            });
          }
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
          outboxStatus: versionBump ? "pending" : "none",
        },
      });
      if (versionBump) {
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
      return { committedVersion, baseVersion, stagedCount: staged.length };
    });

    const noOp = result.committedVersion === result.baseVersion;
    return {
      id: task.id,
      status: "committed",
      committed_dataset_version: result.committedVersion.toString(),
      insert: manifest.counts.insert,
      update: manifest.counts.update,
      unchanged: manifest.counts.unchanged,
      no_op: noOp || result.stagedCount === 0,
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
