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
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  FILE_HEADERS,
  parseCsv,
  createCanonicalBatch,
  getAdapter,
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

/** 自由文本脱敏：邮箱/电话/地址掩码；不截断业务正文（列限长由输入校验保证） */
export function redactFreeText(v: string): string {
  return v
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "***@***")
    .replace(/(?:\+?86[- ]?)?1\d{10}/g, "***PHONE***")
    .replace(/\d{15,19}/g, "***NO***")
    .replace(/[\u4e00-\u9fa5]{2,8}(?:省|自治区)[\u4e00-\u9fa5]{2,8}(?:市|州|盟)[\u4e00-\u9fa5]{2,8}(?:区|县|旗)[^，。；\s]*?(?:号|栋|室|院|座)/g, "***ADDRESS***");
}

/** 预览摘录有界展示；完整脱敏正文由提交侧从 record 取（H08：摘录与正文分离） */
function excerptOf(v: string): string {
  return v.length > 200 ? `${v.slice(0, 200)}…` : v;
}

function sampleOf(kind: FileKind, r: AnyRecord): Record<string, unknown> {
  const base: Record<string, unknown> = { ...r };
  if (kind === "customer_messages") {
    const m = r as StandardRecords["customer_messages"];
    base.message_text = excerptOf(redactFreeText(m.messageText));
    delete base.messageText; // 预览不回显客户原文
  }
  if (kind === "after_sales") {
    const a = r as StandardRecords["after_sales"];
    if (typeof a.reasonText === "string") base.reason_text = excerptOf(redactFreeText(a.reasonText));
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
  /** 完整规范化记录（提交侧业务字段与完整正文的唯一来源；sample 仅预览摘录） */
  record: AnyRecord;
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
  db: Prisma.TransactionClient | PrismaClient;
  kind: FileKind;
  orgId: string;
  storeId: string;
  namespace: string;
  timezone: string;
  storeCurrency: string;
  records: StandardRecords[FileKind][];
  coverage: CoverageDeclarationItem[];
}): Promise<StageOutcome> {
  const { db, kind, orgId, storeId, namespace, timezone, storeCurrency } = args;
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

  // 文件内折叠：同自然键且规范化内容完全相同 → 折叠重复并记录行号；
  // 同键内容不同（无论时间先后）→ DUPLICATE_KEY_CONFLICT 整文件失败
  // （PART12.1：不采用最后一行胜出；更正以更晚 source_updated_at 重新上传）。
  const pending = new Map<string, PendingRow>();
  const productsById = new Map<string, { name: string; category: string | null; status: string; row: number }>();
  const caseIds = new Set<string>();
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
    if (existing.hash === hash) {
      outcome.duplicatesFolded += 1; // 同键同内容：预览折叠重复并保留行号
    } else {
      flagError({ row: rowNo, key }, {
        row: rowNo,
        column: "source_updated_at",
        code: "DUPLICATE_KEY_CONFLICT",
        message: `自然键 ${key} 在文件内出现不同内容（第 ${existing.row} 行与本行），整文件拒绝；更正请以更晚 source_updated_at 重新上传`,
      });
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
  const itemById = new Map(items.map((it) => [it.id, it]));
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
  // H02：本文件最终退款集合（带行号）与既有成功退款全历史（排除将被本文件替换的行）
  const inFileRefunds =
    kind === "after_sales"
      ? keys
          .filter((k) => (k.record as StandardRecords["after_sales"]).recordType === "refund")
          .map((k) => ({ ...(k.record as StandardRecords["after_sales"]), __row: k.row }))
      : [];
  const affectedItemIds = [...new Set(items.map((it) => it.id))];
  const historyRefunds = affectedItemIds.length
    ? await db.refundEvent.findMany({
        where: { orgId, storeId, orderItemId: { in: affectedItemIds }, status: "succeeded" },
        select: { externalRecordId: true, orderItemId: true, refundAmount: true, refundedQuantityCumulative: true, completedAt: true, occurredAt: true },
      })
    : [];
  const decOf = (v: unknown): Prisma.Decimal => new Prisma.Decimal(v == null ? 0 : String(v));
  const historyByItem = new Map<string, Array<{ amount: Prisma.Decimal; qty: number; completedAt: string; externalRecordId: string }>>();
  for (const r of historyRefunds) {
    if (refundExtIds.includes(r.externalRecordId)) continue; // 本文件将替换的同自然键行不重复计入
    const arr = historyByItem.get(r.orderItemId) ?? [];
    arr.push({ amount: decOf(r.refundAmount), qty: r.refundedQuantityCumulative ?? 0, completedAt: (r.completedAt ?? r.occurredAt ?? new Date(0)).toISOString(), externalRecordId: r.externalRecordId });
    historyByItem.set(r.orderItemId, arr);
  }
  const pendingRowOf = (event: string): number =>
    inFileRefunds.find((a) => a.externalRecordId === event)?.__row ?? 1;

  // H02c：订单行金额/件数更正不得突破既有成功退款上界（预览侧全历史校验）
  const priorRefundsByItem = new Map<string, { total: Prisma.Decimal; maxQty: number }>();
  if (kind === "order_items") {
    for (const r of historyRefunds) {
      if (refundExtIds.includes(r.externalRecordId)) continue;
      const acc = priorRefundsByItem.get(r.orderItemId) ?? { total: new Prisma.Decimal(0), maxQty: 0 };
      acc.total = acc.total.add(decOf(r.refundAmount));
      acc.maxQty = Math.max(acc.maxQty, r.refundedQuantityCumulative ?? 0);
      priorRefundsByItem.set(r.orderItemId, acc);
    }
  }

  const knownAliases = new Map<string, string>(); // external_sku_id(别名) → canonical external_sku_id
  if (skuExtIds.length) {
    const aliases = await db.skuAlias.findMany({
      where: { orgId, storeId, sourceNamespace: namespace, externalSkuId: { in: skuExtIds } },
      select: { externalSkuId: true, skuId: true },
    });
    const canonicalIds = aliases.map((a) => a.skuId);
    if (canonicalIds.length) {
      const canonicalRows = await db.sKU.findMany({
        where: { orgId, storeId, id: { in: canonicalIds } },
        select: { id: true, externalSkuId: true },
      });
      const idToExt = new Map(canonicalRows.map((r) => [r.id, r.externalSkuId]));
      for (const a of aliases) {
        const ext = idToExt.get(a.skuId);
        if (ext) knownAliases.set(a.externalSkuId, ext);
      }
    }
  }
  const resolvable = (extId: string): boolean => knownSkus.has(extId) || knownAliases.has(extId);

  for (const p of pending.values()) {
    const r = p.record;
    // H01b：行币种必须与店铺币种一致（products 无币种列）
    const rowCurrency = (r as { currency?: string | null }).currency ?? null;
    if (rowCurrency !== null && rowCurrency !== undefined && rowCurrency !== storeCurrency) {
      flagError(p, {
        row: p.row,
        column: "currency",
        code: "CURRENCY_MISMATCH",
        message: `行币种 ${rowCurrency} 与店铺币种 ${storeCurrency} 不一致`,
      });
      continue;
    }
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
      if (skuId && !resolvable(skuId)) {
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
      } else {
        const dbItem = itemMap.get(`${dbOrder.id}\u0000${it.externalOrderItemId}`);
        if (dbItem) {
          const prior = priorRefundsByItem.get(dbItem.id);
          if (prior && prior.total.gt(new Prisma.Decimal(it.itemPaidAmount))) {
            flagError(p, {
              row: p.row,
              column: "item_paid_amount",
              code: "REFUND_AMOUNT_EXCEEDS_PAID",
              message: `订单行 ${it.externalOrderId}/${it.externalOrderItemId} 已有成功退款合计 ${prior.total.toString()}，更正后实付 ${it.itemPaidAmount} 将低于退款上界`,
            });
          }
          if (prior && prior.maxQty > it.quantity) {
            flagError(p, {
              row: p.row,
              column: "quantity",
              code: "REFUND_QUANTITY_CONFLICT",
              message: `订单行 ${it.externalOrderId}/${it.externalOrderItemId} 已有累计退件 ${prior.maxQty}，更正后数量 ${it.quantity} 低于累计退件上界`,
            });
          }
        }
      }
    }
    if (kind === "customer_messages") {
      const m = r as StandardRecords["customer_messages"];
      // H08：脱敏后无有效业务内容则明确报错，不静默丢行（04 §12.6）
      const redacted = redactFreeText(m.messageText);
      if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(redacted.replace(/\*+/g, ""))) {
        flagError(p, {
          row: p.row,
          column: "message_text",
          code: "REDACTED_TEXT_EMPTY",
          message: "message_text 脱敏后无有效业务内容，请补充业务描述",
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
          // 金额/累计件数/同刻一致性：由行循环后的“历史+整批”总账统一校验（H02）
          void orderItem;
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
    let affected = affectedDateOf(timezone, kind, r);
    if (kind === "order_items" && !affected) {
      // 订单行归订单付款日（未付款按下单日）（PART12.1）
      const it = r as StandardRecords["order_items"];
      const o = orderMap.get(it.externalOrderId);
      if (o) affected = localDateIn(timezone, o.paidAt ?? o.orderedAt);
    }
    outcome.rows.push({
      row: p.row,
      action,
      reason,
      natural_key: naturalKeyOf(kind, r),
      row_hash: p.hash,
      affected_dates: affected ? [affected] : [],
      sample: sampleOf(kind, r),
      record: r,
    });
  }
  // H02：按订单行合并“全部既有成功退款 + 本文件最终集合”的退款总账（Decimal 精确整数运算）
  if (kind === "after_sales" && inFileRefunds.length > 0) {
    const finalByItem = new Map<string, Array<{ event: string; amount: Prisma.Decimal; qty: number; completedAt: string }>>();
    for (const a of inFileRefunds) {
      if (a.status !== "succeeded") continue;
      const parentOrder = orderMap.get(a.externalOrderId);
      const parentItem = parentOrder ? itemMap.get(`${parentOrder.id}\u0000${a.externalOrderItemId}`) : undefined;
      if (!parentItem) continue; // 引用缺失已在上方报错
      const arr = finalByItem.get(parentItem.id) ?? [];
      arr.push({ event: a.externalRecordId, amount: decOf(a.refundAmount), qty: a.refundedQuantityCumulative ?? 0, completedAt: new Date(a.completedAt ?? a.occurredAt).toISOString() });
      finalByItem.set(parentItem.id, arr);
    }
    for (const [itemId, finals] of finalByItem) {
      const orderItem = itemById.get(itemId);
      if (!orderItem) continue;
      const paid = orderItem.itemPaidAmount instanceof Prisma.Decimal ? orderItem.itemPaidAmount : decOf(orderItem.itemPaidAmount);
      const qtyCap = orderItem.quantity;
      // 最终集合 = 历史成功退款（排除本文件同自然键替换行）+ 本文件行
      const merged = [
        ...(historyByItem.get(itemId) ?? []),
        ...finals.map((f) => ({ amount: f.amount, qty: f.qty, completedAt: f.completedAt, externalRecordId: f.event })),
      ];
      const total = merged.reduce((sum, r) => sum.add(r.amount), new Prisma.Decimal(0));
      if (total.gt(paid)) {
        outcome.rowErrors.push({
          row: finals[0] ? pendingRowOf(finals[0].event) : 1,
          column: "refund_amount",
          code: "REFUND_AMOUNT_EXCEEDS_PAID",
          message: `订单行合计成功退款 ${total.toString()} 超过实付金额 ${paid.toString()}`,
        });
      }
      const sorted = [...merged].sort((x, y) => x.completedAt.localeCompare(y.completedAt));
      let prevQty = 0;
      const byStamp = new Map<string, number>();
      for (const r of sorted) {
        if (r.qty < prevQty) {
          outcome.rowErrors.push({
            row: pendingRowOf(r.externalRecordId),
            column: "refunded_quantity_cumulative",
            code: "REFUND_QUANTITY_CONFLICT",
            message: "累计退件数按完成时间必须非递减",
          });
          break;
        }
        prevQty = r.qty;
        const stamp = r.completedAt;
        if (byStamp.has(stamp) && byStamp.get(stamp) !== r.qty) {
          outcome.rowErrors.push({
            row: pendingRowOf(r.externalRecordId),
            column: "refunded_quantity_cumulative",
            code: "REFUND_QUANTITY_CONFLICT",
            message: "同一完成时刻存在不同累计退件数，顺序不确定",
          });
          break;
        }
        byStamp.set(stamp, r.qty);
      }
      if (prevQty > qtyCap) {
        outcome.rowErrors.push({
          row: finals[0] ? pendingRowOf(finals[0].event) : 1,
          column: "refunded_quantity_cumulative",
          code: "REFUND_QUANTITY_CONFLICT",
          message: `累计退件 ${prevQty} 超过订单行数量 ${qtyCap}`,
        });
      }
    }
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
  db: Prisma.TransactionClient | PrismaClient;
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
      // 自然键=（订单外部ID, 行外部ID）：先解析订单，再按订单+行号精确对照，
      // 避免不同订单的同名行号互相错配
      const recs = [...pending.values()];
      const orderExtIds = [...new Set(recs.map((k) => (k.record as StandardRecords["order_items"]).externalOrderId))];
      const orders = await db.order.findMany({
        where: { ...base, externalOrderId: { in: orderExtIds } },
        select: { id: true, externalOrderId: true },
      });
      const orderByExt = new Map(orders.map((o) => [o.externalOrderId, o.id] as const));
      const itemExtIds = [...new Set(recs.map((k) => (k.record as StandardRecords["order_items"]).externalOrderItemId))];
      const rows = await db.orderItem.findMany({
        where: { orgId, storeId, orderId: { in: [...orderByExt.values()] }, externalOrderItemId: { in: itemExtIds } },
        select: { ...pick, orderId: true, externalOrderItemId: true },
      });
      const out = new Map<string, { id: string; sourceUpdatedAt: Date; rowHash: string }>();
      for (const r of rows) {
        const orderExt = [...orderByExt.entries()].find(([, id]) => id === r.orderId)?.[0];
        const key = JSON.stringify({ external_order_id: orderExt, external_order_item_id: r.externalOrderItemId });
        const p = pending.get(key);
        if (p) out.set(p.key, r);
      }
      return out;
    }
    case "ads": {
      // 完整自然键（campaign/date/model/window/currency）精确对照（H07）
      const out = new Map<string, { id: string; sourceUpdatedAt: Date; rowHash: string }>();
      const recs = [...pending.values()];
      const campaignIds = [...new Set(recs.map((k) => (k.record as StandardRecords["ads"]).campaignId))];
      if (campaignIds.length === 0) return out;
      const rows = await db.adMetric.findMany({
        where: { ...base, campaignId: { in: campaignIds } },
        select: { ...pick, campaignId: true, reportDate: true, attributionModel: true, attributionWindowDays: true, currency: true },
      });
      for (const r of rows) {
        const iso = r.reportDate.toISOString().slice(0, 10);
        const match = recs.find((k) => {
          const a = k.record as StandardRecords["ads"];
          return (
            a.campaignId === r.campaignId &&
            a.reportDate === iso &&
            a.attributionModel === r.attributionModel &&
            String(a.attributionWindowDays) === String(r.attributionWindowDays) &&
            a.currency === r.currency
          );
        });
        if (match) out.set(match.key, r);
      }
      return out;
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

// ---------- 原始文件 → 分类的共享流水线（校验 handler 与提交前重验同源；H03） ----------

export interface RawStagingResult {
  ignoredColumns: string[];
  fatalMappingError: RowError | null;
  records: StandardRecords[FileKind][];
  batchRowErrors: RowError[];
  coverage: CoverageDeclarationItem[];
  rawChecksum: string;
  staged: StageOutcome;
}

export async function stageRawFile(args: {
  db: Prisma.TransactionClient | PrismaClient;
  rawText: string;
  kind: FileKind;
  mappingFields: Record<string, string>;
  orgId: string;
  storeId: string;
  namespace: string;
  storeExternalId: string;
  currency: string;
  timezone: string;
  coverageDeclaration: CoverageDeclarationItem[];
}): Promise<RawStagingResult> {
  const emptyOutcome: StageOutcome = {
    rows: [], counts: { insert: 0, update: 0, unchanged: 0, rejected: 0 },
    duplicatesFolded: 0, supersededInFile: 0, supersededByDb: 0, rowErrors: [],
    coverageGaps: [], coverageOnly: false, emptyFile: false,
  };
  const mapped = transformCsvWithMapping(args.kind, args.rawText, args.mappingFields);
  if ("error" in mapped) {
    return {
      ignoredColumns: [], fatalMappingError: mapped.error, records: [], batchRowErrors: [],
      coverage: args.coverageDeclaration,
      rawChecksum: createHash("sha256").update(args.rawText).digest("hex"),
      staged: { ...emptyOutcome, counts: { ...emptyOutcome.counts, rejected: 1 } },
    };
  }
  const parsed = getAdapter("csv").parse(args.kind, { storeExternalId: args.storeExternalId }, mapped.text);
  const batch = createCanonicalBatch({
    sourceKind: args.kind,
    sourceNamespace: args.namespace,
    storeId: args.storeId,
    adapterKind: "csv",
    rawChecksum: createHash("sha256").update(mapped.text).digest("hex"),
    parse: parsed,
    coverageDeclaration: args.coverageDeclaration,
  });
  const staged = await classifyAndStage({
    db: args.db,
    kind: args.kind,
    orgId: args.orgId,
    storeId: args.storeId,
    namespace: args.namespace,
    timezone: args.timezone,
    storeCurrency: args.currency,
    records: batch.records,
    coverage: batch.coverage_declaration,
  });
  return {
    ignoredColumns: mapped.ignoredColumns,
    fatalMappingError: null,
    records: batch.records,
    batchRowErrors: batch.row_errors,
    coverage: batch.coverage_declaration,
    rawChecksum: batch.raw_checksum,
    staged,
  };
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
