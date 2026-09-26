/**
 * TASK-008｜字段映射、全量校验、staging 与预览服务。
 *
 * 用户功能：上传的六类 CSV 在用户确认前，能看到哪些行将插入/更新/无变化/
 * 被拒绝，且错误清单可下载、覆盖声明不被文件行数推断。
 *
 * 合同：09_TASKS TASK-008；04_DATA_MODEL §10.5（ImportTask/staging/错误对象）、
 * PART11.1 步骤3–5、PART12（字段规范/自然键/同文件去重与跨文件 upsert 协议/
 * §12.8）；08_API_SPEC §17.3（mapping/preview/error-file）；F05/F15/F17。
 * 禁止：跳过错误行"尽量导入"；按名称模糊合并 SKU；此处不做业务入库
 * （原子提交属 TASK-009），也不实现 F17 恢复 UI/通用别名工作台。
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  FILE_HEADERS,
  parseCsv,
  type CoverageDeclarationItem,
  type FileKind,
  type RowError,
  type StandardRecords,
} from "@/adapters/contracts";

// ---------- 字段映射 ----------

/** PUT mapping 后存档形态（ImportTask.mapping jsonb） */
export interface TaskMapping {
  fields: Record<string, string>;
  mapping_version: string;
  ignored_columns: string[];
}

export function mappingVersion(fields: Record<string, string>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((k) => `${k}=>${fields[k]}`)
    .join("\u0001");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

const FORBIDDEN_TARGETS = new Set([
  "org_id",
  "org",
  "dataset_version",
  "created_by",
  "store_id",
  "id",
]);

/**
 * 校验字段映射（PUT /mapping 时调用，看不到文件内容）：
 * - 键必须是该类型标准字段；值必须是字符串且不得重复；
 * - 不得映射到 org_id/dataset_version/created_by 等服务端保留列（PART12.1）；
 * - 未映射的标准字段回退为同名原生列（缺失由校验期 MISSING_COLUMN 报告）。
 */
export function validateFieldMapping(
  kind: FileKind,
  fields: Record<string, string>,
): { ok: true; fields: Record<string, string>; ignored: string[] } | { ok: false; message: string } {
  const known = new Set<string>(FILE_HEADERS[kind]);
  const values = new Map<string, string>();
  for (const [field, column] of Object.entries(fields)) {
    if (!known.has(field)) {
      return { ok: false, message: `field_mapping 含未知标准字段 ${field}` };
    }
    if (typeof column !== "string" || column.trim() === "") {
      return { ok: false, message: `field_mapping.${field} 的目标列不能为空` };
    }
    if (FORBIDDEN_TARGETS.has(column.trim().toLowerCase())) {
      return { ok: false, message: `field_mapping.${field} 不得映射到服务端保留列 ${column}` };
    }
    const owner = values.get(column);
    if (owner) {
      return { ok: false, message: `field_mapping 列 ${column} 同时映射给 ${owner} 与 ${field}` };
    }
    values.set(column, field);
  }
  return { ok: true, fields, ignored: [] };
}

/**
 * 按映射把原始 CSV 重排为标准列表（不改写数据，只重排/丢弃列），
 * 随后复用 parseStandardFile 的全部既有校验。文件级 MAPPING_COLLISION
 * 指两个标准字段解析到同一 CSV 列（语义歧义，拒绝）。
 */
export function transformCsvWithMapping(
  kind: FileKind,
  content: string,
  fields: Record<string, string>,
): { text: string; ignoredColumns: string[] } | { error: RowError } {
  let rows: string[][];
  try {
    rows = parseCsv(content);
  } catch {
    return { text: content, ignoredColumns: [] }; // 语法错误交由 parseStandardFile 报 INVALID_CSV
  }
  if (rows.length === 0) return { text: content, ignoredColumns: [] };
  const headers = rows[0].map((h) => h.trim());
  const index = new Map<string, number>();
  headers.forEach((h, i) => index.set(h, i));
  const resolution: Array<{ std: string; col: number | null }> = [];
  const used = new Set<number>();
  for (const std of FILE_HEADERS[kind]) {
    const colName = fields[std] ?? std;
    const col = index.has(colName) ? (index.get(colName) as number) : null;
    resolution.push({ std, col });
  }
  for (const { col } of resolution) {
    if (col !== null) {
      if (used.has(col)) {
        return {
          error: {
            row: 1,
            code: "MAPPING_COLLISION",
            message: `字段映射冲突：多个标准字段解析到同一 CSV 列 ${headers[col]}`,
          },
        };
      }
      used.add(col);
    }
  }
  const kept = resolution.filter((r): r is { std: string; col: number } => r.col !== null);
  const ignoredColumns = headers.filter((_, i) => !used.has(i));
  const escape = (v: string | null) => {
    if (v === null) return "";
    if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const out = [
    kept.map((r) => r.std).join(","),
    ...rows.slice(1).map((row) => kept.map((r) => escape(row[r.col] ?? null)).join(",")),
  ].join("\r\n");
  return { text: out, ignoredColumns };
}

// ---------- 自然键、规范化哈希与影响日期 ----------

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, stableReplacer)).digest("hex");
}

/** 受控字段规范化行哈希（预览分类与 TASK-009 提交 rowHash 同源） */
export function recordRowHash(record: StandardRecords[FileKind]): string {
  return stableHash(record);
}

/** 键序稳定化：仅保留受控业务字段（排除共同列 store_external_id） */
function stableReplacer(key: string, value: unknown): unknown {
  if (key === "storeExternalId" || key === "kind") return undefined;
  return value;
}

export function localDateIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

type AnyRecord = StandardRecords[FileKind];

function naturalKeyOf(kind: FileKind, r: AnyRecord): Record<string, string> {
  switch (kind) {
    case "products":
      return { external_sku_id: (r as StandardRecords["products"]).externalSkuId };
    case "orders":
      return { external_order_id: (r as StandardRecords["orders"]).externalOrderId };
    case "order_items":
      return {
        external_order_id: (r as StandardRecords["order_items"]).externalOrderId,
        external_order_item_id: (r as StandardRecords["order_items"]).externalOrderItemId,
      };
    case "ads": {
      const a = r as StandardRecords["ads"];
      return {
        campaign_id: a.campaignId,
        report_date: a.reportDate,
        attribution_model: a.attributionModel,
        attribution_window_days: String(a.attributionWindowDays),
      };
    }
    case "customer_messages":
      return { external_message_id: (r as StandardRecords["customer_messages"]).externalMessageId };
    case "after_sales": {
      const a = r as StandardRecords["after_sales"];
      return { record_type: a.recordType, external_record_id: a.externalRecordId };
    }
  }
}

function affectedDateOf(tz: string, kind: FileKind, r: AnyRecord): string | null {
  const iso = ((): string | null => {
    switch (kind) {
      case "orders": {
        const o = r as StandardRecords["orders"];
        return o.paidAt ?? o.orderedAt ?? null;
      }
      case "ads":
        return `${(r as StandardRecords["ads"]).reportDate}T00:00:00Z`;
      case "customer_messages":
        return (r as StandardRecords["customer_messages"]).messageAt;
      case "after_sales": {
        const a = r as StandardRecords["after_sales"];
        return a.recordType === "refund" && a.status === "succeeded" && a.completedAt
          ? a.completedAt
          : a.occurredAt;
      }
      default:
        return null; // products 无事件期（覆盖只记录目录确认，不按日报到）
    }
  })();
  return iso ? localDateIn(tz, new Date(iso)) : null;
}

/** 预览样本受控字段子集（自由文本脱敏；不含客户原文/经营金额以外的敏感串） */
export function redactFreeText(v: string): string {
  const masked = v
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "***@***")
    .replace(/(?:\+?86[- ]?)?1\d{10}/g, "***PHONE***")
    .replace(/\d{15,19}/g, "***NO***");
  return masked.length > 200 ? `${masked.slice(0, 200)}…` : masked;
}

function sampleOf(kind: FileKind, r: AnyRecord): Record<string, unknown> {
  const base: Record<string, unknown> = { ...r };
  if (kind === "customer_messages") {
    const m = r as StandardRecords["customer_messages"];
    base.message_text = redactFreeText(m.messageText);
    delete base.messageText; // 预览不回显客户原文
  }
  if (kind === "after_sales") {
    const a = r as StandardRecords["after_sales"];
    if (typeof a.reasonText === "string") base.reason_text = redactFreeText(a.reasonText);
    delete base.reasonText;
  }
  delete base.storeExternalId;
  return base;
}

// ---------- 分类与 staging ----------

export interface StagedRow {
  row: number;
  action: "insert" | "update" | "unchanged";
  reason: string | null;
  natural_key: Record<string, string>;
  row_hash: string;
  affected_dates: string[];
  sample: Record<string, unknown>;
}

export interface StageOutcome {
  rows: StagedRow[];
  counts: { insert: number; update: number; unchanged: number; rejected: number };
  duplicatesFolded: number;
  supersededInFile: number;
  supersededByDb: number;
  rowErrors: RowError[];
  coverageGaps: string[];
  coverageOnly: boolean;
  emptyFile: boolean;
}

interface PendingRow {
  row: number;
  record: AnyRecord;
  key: string;
  hash: string;
}

export async function classifyAndStage(args: {
  db: PrismaClient;
  kind: FileKind;
  orgId: string;
  storeId: string;
  namespace: string;
  timezone: string;
  records: StandardRecords[FileKind][];
  coverage: CoverageDeclarationItem[];
}): Promise<StageOutcome> {
  const { db, kind, orgId, storeId, namespace, timezone } = args;
  const outcome: StageOutcome = {
    rows: [],
    counts: { insert: 0, update: 0, unchanged: 0, rejected: 0 },
    duplicatesFolded: 0,
    supersededInFile: 0,
    supersededByDb: 0,
    rowErrors: [],
    coverageGaps: [],
    coverageOnly: false,
    emptyFile: false,
  };
  if (args.records.length === 0) {
    const declaredZero = args.coverage.some((c) => c.explicit_zero_dates.length > 0);
    outcome.emptyFile = true;
    outcome.coverageOnly = declaredZero;
    return outcome;
  }

  // 文件内折叠：同自然键按 source_updated_at 取最新；同刻同内容折叠；
  // 同刻不同内容 → DUPLICATE_KEY_CONFLICT（整文件失败，不"最后一行胜出"）。
  const pending = new Map<string, PendingRow>();
  const productsById = new Map<string, { name: string; category: string | null; status: string; row: number }>();
  const caseIds = new Set<string>();
  const stagedItemKeys = new Set<string>();
  const refundBoundsByItem = new Map<string, { total: number; byCompletedAt: Map<string, number> }>();
  const errorRows = new Set<string>();
  const flagError = (p: { row: number; key: string }, e: RowError) => {
    errorRows.add(p.key);
    outcome.rowErrors.push(e);
  };
  for (let i = 0; i < args.records.length; i++) {
    const record = args.records[i] as AnyRecord;
    const keyObj = naturalKeyOf(kind, record);
    const key = JSON.stringify(keyObj);
    const hash = stableHash(record);
    const rowNo = i + 2; // 与 parseStandardFile 行号一致（表头为第 1 行）
    if (kind === "after_sales") {
      const a = record as StandardRecords["after_sales"];
      if (a.recordType === "case") caseIds.add(a.externalRecordId);
      stagedItemKeys.add(`${a.externalOrderId}\u0000${a.externalOrderItemId}`);
    }
    if (kind === "products") {
      const p = record as StandardRecords["products"];
      const prev = productsById.get(p.externalProductId);
      if (prev && (prev.name !== p.name || prev.category !== (p.category ?? null) || prev.status !== p.productStatus)) {
        flagError({ row: rowNo, key: `__meta_${rowNo}` }, {
          row: rowNo,
          column: "external_product_id",
          code: "PRODUCT_METADATA_CONFLICT",
          message: `同一 external_product_id=${p.externalProductId} 的产品元信息在文件内不一致（第 ${prev.row} 行与本行）`,
        });
      }
      if (!prev) productsById.set(p.externalProductId, { name: p.name, category: p.category ?? null, status: p.productStatus, row: rowNo });
    }
    const existing = pending.get(key);
    if (!existing) {
      pending.set(key, { row: rowNo, record, key, hash });
      continue;
    }
    const a = Date.parse(existing.record.sourceUpdatedAt);
    const b = Date.parse(record.sourceUpdatedAt);
    if (b === a) {
      if (existing.hash === hash) {
        outcome.duplicatesFolded += 1; // 同刻同内容：预览折叠重复并保留行号
      } else {
        flagError({ row: rowNo, key }, {
          row: rowNo,
          column: "source_updated_at",
          code: "DUPLICATE_KEY_CONFLICT",
          message: `自然键 ${key} 在 ${record.sourceUpdatedAt} 出现不同内容（第 ${existing.row} 行与本行），整文件拒绝`,
        });
      }
    } else if (b > a) {
      pending.set(key, { row: rowNo, record, key, hash });
      outcome.supersededInFile += 1; // 文件内旧版本被新版本取代
    } else {
      outcome.supersededInFile += 1;
    }
  }

  // 跨文件/库存态分类：与既有事实的自然键对照（insert/update/unchanged/旧版本不覆盖）
  const keys = [...pending.values()];
  const existingRows = await loadExistingByNaturalKey({ db, kind, orgId, storeId, namespace, pending });
  const skuExtIds = collectSkuRefs(kind, keys.map((k) => k.record as AnyRecord));
  const knownSkus = skuExtIds.length
    ? new Set(
        (
          await db.sKU.findMany({
            where: { orgId, storeId, sourceNamespace: namespace, externalSkuId: { in: skuExtIds } },
            select: { externalSkuId: true },
          })
        ).map((s) => s.externalSkuId),
      )
    : new Set<string>();
  const orderExtIds = collectOrderRefs(kind, keys.map((k) => k.record as AnyRecord));
  const orders = orderExtIds.length
    ? await db.order.findMany({
        where: { orgId, storeId, sourceNamespace: namespace, externalOrderId: { in: orderExtIds } },
        select: { id: true, externalOrderId: true, paidAt: true, orderedAt: true },
      })
    : [];
  const orderMap = new Map(orders.map((o) => [o.externalOrderId, o]));
  const orderIds = orders.map((o) => o.id);
  const items = orderIds.length
    ? await db.orderItem.findMany({
        where: { orgId, storeId, orderId: { in: orderIds } },
        select: {
          id: true,
          orderId: true,
          externalOrderItemId: true,
          quantity: true,
          itemPaidAmount: true,
        },
      })
    : [];
  const itemMap = new Map(items.map((it) => [`${it.orderId}\u0000${it.externalOrderItemId}`, it]));
  const refundExtIds =
    kind === "after_sales"
      ? keys.map((k) => (k.record as StandardRecords["after_sales"])).filter((a) => a.recordType === "refund").map((a) => a.externalRecordId)
      : [];
  const dbRefunds = refundExtIds.length
    ? await db.refundEvent.findMany({
        where: { orgId, storeId, sourceNamespace: namespace, externalRecordId: { in: refundExtIds } },
        select: {
          externalRecordId: true,
          orderId: true,
          orderItemId: true,
          refundAmount: true,
          refundedQuantityCumulative: true,
          status: true,
          completedAt: true,
        },
      })
    : [];
  const dbRefundByKey = new Map(dbRefunds.map((r) => [r.externalRecordId, r]));
  const succeededByItem = new Map<string, { amount: number; quantity: number }>();
  for (const r of dbRefunds) {
    if (r.status !== "succeeded") continue;
    const acc = succeededByItem.get(r.orderItemId) ?? { amount: 0, quantity: 0 };
    acc.amount += Number(r.refundAmount);
    acc.quantity = Math.max(acc.quantity, r.refundedQuantityCumulative ?? 0);
    succeededByItem.set(r.orderItemId, acc);
  }

  for (const p of pending.values()) {
    const r = p.record;
    const existing = existingRows.get(p.key);
    const existingTs = existing ? existing.sourceUpdatedAt.getTime() : null;
    let action: StagedRow["action"] = "insert";
    let reason: string | null = null;
    if (existing) {
      if (existingTs !== null && existingTs > Date.parse(p.record.sourceUpdatedAt)) {
        action = "unchanged";
        reason = "superseded_by_db"; // 旧版本不覆盖（PART12.1 跨文件 upsert 协议）
        outcome.supersededByDb += 1;
      } else if (existing.rowHash && existing.rowHash === p.hash) {
        action = "unchanged";
        reason = "identical";
      } else if (existingTs === Date.parse(p.record.sourceUpdatedAt)) {
        flagError(p, {
          row: p.row,
          column: "source_updated_at",
          code: "VERSION_CONFLICT",
          message: `自然键 ${p.key} 与既有记录同更新时间但内容不同；请更正后以更晚 source_updated_at 重导`,
        });
        continue;
      } else {
        action = "update";
      }
    }

    // 行级跨引用校验（按原合同；找不到一律整文件失败的行级错误）
    if (kind === "products") {
      const pRec = r as StandardRecords["products"];
      const codeOwner = await db.sKU.findFirst({
        where: { orgId, storeId, skuCode: pRec.skuCode, sourceNamespace: namespace, externalSkuId: { not: pRec.externalSkuId } },
        select: { externalSkuId: true },
      });
      if (codeOwner) {
        flagError(p, {
          row: p.row,
          column: "sku_code",
          code: "SKU_CODE_CONFLICT",
          message: `sku_code=${pRec.skuCode} 已被 external_sku_id=${codeOwner.externalSkuId} 使用`,
        });
      }
    }
    if (kind === "orders") {
      const o = r as StandardRecords["orders"];
      const dbOrder = orderMap.get(o.externalOrderId);
      if (dbOrder) {
        const count = await db.orderItem.count({ where: { orgId, storeId, orderId: dbOrder.id } });
        if (count > o.expectedItemCount) {
          flagError(p, {
            row: p.row,
            column: "expected_item_count",
            code: "ITEM_COUNT_EXCEEDED",
            message: `订单 ${o.externalOrderId} 现存行数 ${count} 已超过 expected_item_count=${o.expectedItemCount}`,
          });
        }
      }
    }
    if (kind === "order_items" || (kind === "customer_messages" && (r as StandardRecords["customer_messages"]).externalSkuId)) {
      const skuId =
        kind === "order_items"
          ? (r as StandardRecords["order_items"]).externalSkuId
          : (r as StandardRecords["customer_messages"]).externalSkuId;
      if (skuId && !knownSkus.has(skuId)) {
        flagError(p, {
          row: p.row,
          column: "external_sku_id",
          code: "SKU_NOT_FOUND",
          message: `external_sku_id=${skuId} 未在当前店铺/来源中找到；请先导入商品或建立明确映射（不做名称模糊合并）`,
        });
      }
    }
    if (kind === "order_items") {
      const it = r as StandardRecords["order_items"];
      const dbOrder = orderMap.get(it.externalOrderId);
      if (!dbOrder) {
        flagError(p, {
          row: p.row,
          column: "external_order_id",
          code: "MISSING_ORDER_REFERENCE",
          message: `订单 ${it.externalOrderId} 尚未导入（订单行须引用已存同店同来源订单）`,
        });
      }
    }
    if (kind === "after_sales") {
      const a = r as StandardRecords["after_sales"];
      const dbOrder = orderMap.get(a.externalOrderId);
      const orderItem = dbOrder ? itemMap.get(`${dbOrder.id}\u0000${a.externalOrderItemId}`) : undefined;
      if (!dbOrder || !orderItem) {
        flagError(p, {
          row: p.row,
          column: "external_order_id",
          code: "MISSING_ORDER_REFERENCE",
          message: `售后行引用的订单行 ${a.externalOrderId}/${a.externalOrderItemId} 不存在（须已存同店同来源订单行）`,
        });
      } else if (a.recordType === "refund") {
        if (a.status === "succeeded") {
          const prior = succeededByItem.get(orderItem.id);
          const priorAmount = prior?.amount ?? 0;
          const self = dbRefundByKey.get(a.externalRecordId);
          const selfAmount = self && self.status === "succeeded" ? Number(self.refundAmount) : 0;
          if (a.refundAmount === null) {
            outcome.rowErrors.push({ row: p.row, column: "refund_amount", code: "VALIDATION_ERROR", message: "成功退款必填 refund_amount" });
          } else if (priorAmount - selfAmount + Number(a.refundAmount) > Number(orderItem.itemPaidAmount)) {
            flagError(p, {
              row: p.row,
              column: "refund_amount",
              code: "REFUND_AMOUNT_EXCEEDS_PAID",
              message: `订单行 ${a.externalOrderId}/${a.externalOrderItemId} 累计成功退款将超过实付金额`,
            });
          }
          if (a.refundedQuantityCumulative === null) {
            outcome.rowErrors.push({ row: p.row, column: "refunded_quantity_cumulative", code: "VALIDATION_ERROR", message: "成功退款必填累计退件数" });
          } else if (a.refundedQuantityCumulative !== null && a.refundedQuantityCumulative > orderItem.quantity) {
            flagError(p, {
              row: p.row,
              column: "refunded_quantity_cumulative",
              code: "REFUND_QUANTITY_CONFLICT",
              message: `累计退件 ${a.refundedQuantityCumulative} 超过订单行数量 ${orderItem.quantity}`,
            });
          }
          const acc = refundBoundsByItem.get(orderItem.id) ?? { total: 0, byCompletedAt: new Map<string, number>() };
          acc.total += Number(a.refundAmount ?? 0);
          const stamp = new Date(a.completedAt ?? a.occurredAt).toISOString();
          const prevQty = acc.byCompletedAt.get(stamp);
          if (prevQty !== undefined && prevQty !== a.refundedQuantityCumulative) {
            flagError(p, {
              row: p.row,
              column: "refunded_quantity_cumulative",
              code: "REFUND_QUANTITY_CONFLICT",
              message: `同一完成时刻存在不同累计退件数，顺序不确定`,
            });
          }
          acc.byCompletedAt.set(stamp, a.refundedQuantityCumulative ?? 0);
          refundBoundsByItem.set(orderItem.id, acc);
          if (a.relatedCaseId && !caseIds.has(a.relatedCaseId)) {
            const dbCase = await db.afterSaleRecord.findFirst({
              where: { orgId, storeId, sourceNamespace: namespace, externalRecordId: a.relatedCaseId },
              select: { id: true },
            });
            if (!dbCase) {
              flagError(p, {
                row: p.row,
                column: "related_case_id",
                code: "RELATED_CASE_NOT_FOUND",
                message: `related_case_id=${a.relatedCaseId} 不在同文件或既有 case 中`,
              });
            }
          }
          if (a.completedAt && a.completedAt < a.occurredAt) {
            outcome.rowErrors.push({ row: p.row, column: "completed_at", code: "OUT_OF_RANGE", message: "completed_at 不得早于 occurred_at" });
          }
        } else if (a.refundAmount !== null || a.refundedQuantityCumulative !== null || a.completedAt !== null) {
          outcome.rowErrors.push({ row: p.row, column: "status", code: "VALIDATION_ERROR", message: "仅成功退款可携带 completed_at/金额/累计件数" });
        }
        if (a.currency === null) {
          outcome.rowErrors.push({ row: p.row, column: "currency", code: "VALIDATION_ERROR", message: "refund 必填 currency" });
        }
      } else if (a.recordType === "case") {
        if (a.currency !== null || a.refundAmount !== null || a.refundedQuantityCumulative !== null || a.completedAt !== null) {
          outcome.rowErrors.push({ row: p.row, column: "record_type", code: "VALIDATION_ERROR", message: "case 行不得携带退款/金额/完成时间字段" });
        }
      }
    }

    if (errorRows.has(p.key)) {
      outcome.counts.rejected += 1;
      continue;
    }
    outcome.counts[action] += 1;
    const affected = affectedDateOf(timezone, kind, r);
    outcome.rows.push({
      row: p.row,
      action,
      reason,
      natural_key: naturalKeyOf(kind, r),
      row_hash: p.hash,
      affected_dates: affected ? [affected] : [],
      sample: sampleOf(kind, r),
    });
  }
  outcome.counts.rejected = outcome.rowErrors.length;
  outcome.coverageGaps = computeCoverageGaps(outcome.rows, args.coverage);
  return outcome;
}

function computeCoverageGaps(rows: StagedRow[], coverage: CoverageDeclarationItem[]): string[] {
  const gaps: string[] = [];
  const covered = new Set<string>();
  for (const r of rows) for (const d of r.affected_dates) covered.add(d);
  for (const c of coverage) {
    const zero = new Set(c.explicit_zero_dates);
    let d = new Date(`${c.from}T00:00:00Z`);
    const end = new Date(`${c.to}T00:00:00Z`);
    let guard = 0;
    while (d < end && guard < 100000) {
      const iso = d.toISOString().slice(0, 10);
      if (!covered.has(iso) && !zero.has(iso) && gaps.length < 100) gaps.push(iso);
      d = new Date(d.getTime() + 86400000);
      guard += 1;
    }
  }
  return gaps;
}

function collectSkuRefs(kind: FileKind, records: AnyRecord[]): string[] {
  const out = new Set<string>();
  for (const r of records) {
    if (kind === "order_items") out.add((r as StandardRecords["order_items"]).externalSkuId);
    if (kind === "customer_messages") {
      const s = (r as StandardRecords["customer_messages"]).externalSkuId;
      if (s) out.add(s);
    }
  }
  return [...out];
}

function collectOrderRefs(kind: FileKind, records: AnyRecord[]): string[] {
  const out = new Set<string>();
  for (const r of records) {
    if (kind === "order_items") out.add((r as StandardRecords["order_items"]).externalOrderId);
    if (kind === "after_sales") out.add((r as StandardRecords["after_sales"]).externalOrderId);
    if (kind === "orders") out.add((r as StandardRecords["orders"]).externalOrderId);
  }
  return [...out];
}

/** 按自然键载入既有事实（仅取分类所需列；空 rowHash 视为从未提交） */
async function loadExistingByNaturalKey(args: {
  db: PrismaClient;
  kind: FileKind;
  orgId: string;
  storeId: string;
  namespace: string;
  pending: Map<string, PendingRow>;
}): Promise<Map<string, { id: string; sourceUpdatedAt: Date; rowHash: string }>> {
  const { db, kind, orgId, storeId, namespace, pending } = args;
  const base = { orgId, storeId, sourceNamespace: namespace };
  const pick = { id: true, sourceUpdatedAt: true, rowHash: true } as const;
  const ext = (keys: PendingRow[], build: (r: AnyRecord) => string): Map<string, PendingRow> => {
    const m = new Map<string, PendingRow>();
    for (const k of keys) m.set(build(k.record), k);
    return m;
  };
  switch (kind) {
    case "products": {
      const bySku = ext([...pending.values()], (r) => (r as StandardRecords["products"]).externalSkuId);
      const rows = await db.sKU.findMany({
        where: { ...base, externalSkuId: { in: [...bySku.keys()] } },
        select: { ...pick, externalSkuId: true },
      });
      return indexBy(rows, (r) => bySku.get(r.externalSkuId)?.key);
    }
    case "orders": {
      const byOrder = ext([...pending.values()], (r) => (r as StandardRecords["orders"]).externalOrderId);
      const rows = await db.order.findMany({
        where: { ...base, externalOrderId: { in: [...byOrder.keys()] } },
        select: { ...pick, externalOrderId: true },
      });
      return indexBy(rows, (r) => byOrder.get(r.externalOrderId)?.key);
    }
    case "order_items": {
      const recs = [...pending.values()];
      const byItem = new Map(recs.map((k) => [(k.record as StandardRecords["order_items"]).externalOrderItemId, k]));
      const rows = await db.orderItem.findMany({
        where: { ...base, externalOrderItemId: { in: [...byItem.keys()] } },
        select: { ...pick, id: true, orderId: true, externalOrderItemId: true },
      });
      const orders = await db.order.findMany({
        where: { orgId, storeId, id: { in: rows.map((r) => r.orderId) } },
        select: { id: true, sourceNamespace: true, externalOrderId: true },
      });
      const extByOrderId = new Map(orders.map((o) => [o.id, o.externalOrderId]));
      return indexBy(
        rows,
        (r) => byItem.get(r.externalOrderItemId)?.key,
        (r) => `${extByOrderId.get(r.orderId) ?? "?"}\u0000${r.externalOrderItemId}`,
      );
    }
    case "ads": {
      const recs = [...pending.values()];
      const byCampaign = new Map(recs.map((k) => [(k.record as StandardRecords["ads"]).campaignId, k]));
      const rows = await db.adMetric.findMany({
        where: { ...base, campaignId: { in: [...byCampaign.keys()] } },
        select: {
          ...pick,
          campaignId: true,
          reportDate: true,
          attributionModel: true,
          attributionWindowDays: true,
          currency: true,
          spend: true,
          attributedSales: true,
        },
      });
      return indexBy(
        rows,
        (r) =>
          byCampaign.get(r.campaignId)?.key ??
          "",
        (r) => {
          const iso = r.reportDate.toISOString().slice(0, 10);
          for (const k of pending.values()) {
            const a = k.record as StandardRecords["ads"];
            if (
              a.campaignId === r.campaignId &&
              a.reportDate === iso &&
              a.attributionModel === r.attributionModel &&
              String(a.attributionWindowDays) === String(r.attributionWindowDays) &&
              a.currency === r.currency
            ) {
              return k.key;
            }
          }
          return "";
        },
      );
    }
    case "customer_messages": {
      const byMsg = ext([...pending.values()], (r) => (r as StandardRecords["customer_messages"]).externalMessageId);
      const rows = await db.customerMessage.findMany({
        where: { ...base, externalMessageId: { in: [...byMsg.keys()] } },
        select: { ...pick, externalMessageId: true },
      });
      return indexBy(rows, (r) => byMsg.get(r.externalMessageId)?.key);
    }
    case "after_sales": {
      const recs = [...pending.values()];
      const cases = recs.filter((k) => (k.record as StandardRecords["after_sales"]).recordType === "case");
      const refunds = recs.filter((k) => (k.record as StandardRecords["after_sales"]).recordType === "refund");
      const out = new Map<string, { id: string; sourceUpdatedAt: Date; rowHash: string }>();
      if (cases.length) {
        const ids = [...new Set(cases.map((k) => (k.record as StandardRecords["after_sales"]).externalRecordId))];
        const rows = await db.afterSaleRecord.findMany({
          where: { ...base, externalRecordId: { in: ids } },
          select: { ...pick, externalRecordId: true },
        });
        for (const r of rows) {
          const k = cases.find((k) => (k.record as StandardRecords["after_sales"]).externalRecordId === r.externalRecordId);
          if (k) out.set(k.key, r);
        }
      }
      if (refunds.length) {
        const ids = [...new Set(refunds.map((k) => (k.record as StandardRecords["after_sales"]).externalRecordId))];
        const rows = await db.refundEvent.findMany({
          where: { ...base, externalRecordId: { in: ids } },
          select: { ...pick, externalRecordId: true },
        });
        for (const r of rows) {
          const k = refunds.find((k) => (k.record as StandardRecords["after_sales"]).externalRecordId === r.externalRecordId);
          if (k) out.set(k.key, r);
        }
      }
      return out;
    }
  }
}

function indexBy<T extends { id: string; sourceUpdatedAt: Date; rowHash: string }>(
  rows: T[],
  keyOf: (r: T) => string | undefined,
  altKeyOf?: (r: T) => string,
): Map<string, { id: string; sourceUpdatedAt: Date; rowHash: string }> {
  const out = new Map<string, { id: string; sourceUpdatedAt: Date; rowHash: string }>();
  for (const r of rows) {
    const key = keyOf(r) ?? (altKeyOf ? altKeyOf(r) : undefined);
    if (key) out.set(key, { id: r.id, sourceUpdatedAt: r.sourceUpdatedAt, rowHash: r.rowHash });
  }
  return out;
}

/** 幂等键（04 §10.5）：文件hash+来源/店铺+映射+范围声明+adapter版本 */
export function buildIdempotencyKey(args: {
  fileSha256: string;
  orgId: string;
  storeId: string;
  namespace: string;
  kind: FileKind;
  mappingVersion: string;
  coverage: CoverageDeclarationItem[];
  adapterVersion: string;
}): string {
  const canonical = JSON.stringify(
    [
      args.fileSha256,
      args.orgId,
      args.storeId,
      args.namespace,
      args.kind,
      args.mappingVersion,
      [...args.coverage]
        .sort((a, b) => `${a.channel}${a.from}`.localeCompare(`${b.channel}${b.from}`))
        .map((c) => [c.source_kind, c.channel, c.from, c.to, c.status, [...c.explicit_zero_dates].sort()]),
      args.adapterVersion,
    ],
    stableKeySort,
  );
  return createHash("sha256").update(canonical).digest("hex");
}

function stableKeySort(_key: string, value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
}
