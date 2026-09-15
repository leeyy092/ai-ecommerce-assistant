/**
 * 统一 Adapter 契约与标准记录（TASK-006；09_TASKS：CSV 和 Mock 产生同一种标准记录）。
 *
 * 设计约束：
 * - Adapter 是**纯解析与校验函数**：输入文件文本/合成数据，输出标准记录与行级错误；
 *   不触数据库、不写页面、不做导入提交（那些属于 TASK-007/008+ 的导入流程）。
 * - external_*_id 一律按字符串解析（保留前导零），长度上限 128（04_DATA_MODEL 10.1）。
 * - 金额以字符串保留原精度（numeric(20,6)：整数部分 ≤14 位、小数 ≤6 位、≥0），
 *   不在解析层转 float；整数列在 Number 转换前做安全整数校验（防 2^53 精度丢失）。
 * - 时间统一转为 UTC ISO 字符串；必须为 RFC3339 且带时区（Z 或 ±hh:mm），
 *   日期做真实日历校验（2026-02-30 拒绝）；日期为 YYYY-MM-DD。
 * - source_updated_at 是每行必填列：缺失/空即报错，服务端**不得补造**来源时间
 *   （04_DATA_MODEL:521）。
 * - CSV 解析采用既定选型 csv-parse（11_DEVELOPMENT_RULES:88，RFC4180）：
 *   BOM 剥离、CRLF/LF、引号包裹的逗号/换行/双引号转义；未闭合引号/列数不匹配
 *   属语法错误，整文件拒绝。
 * - 表头分"必填/可选"两级（04 §12.2–12.7）：必填列缺失 → MISSING_COLUMN；
 *   可选列缺列或空单元格 → null；重复表头拒绝；未登记列忽略（字段映射归 TASK-008）。
 * - CanonicalBatch（04 §11.2/§12.8）：统一元数据合同——store_id 由服务端赋值、
 *   namespace/adapter_version/raw_checksum/coverage_declaration 服务端提供，
 *   不信任文件内容或调用方声明。
 */
import { parse as csvParse } from "csv-parse/sync";

export const FILE_KINDS = [
  "products",
  "orders",
  "order_items",
  "ads",
  "customer_messages",
  "after_sales",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export function isFileKind(kind: string): kind is FileKind {
  return (FILE_KINDS as readonly string[]).includes(kind);
}

/** 行级错误（携带 1-based 行号；表头为第 1 行） */
export interface RowError {
  row: number;
  column?: string;
  code: string;
  message: string;
}

export interface ParseResult<K extends FileKind = FileKind> {
  kind: K;
  /** 解析+校验通过的记录（不含任何服务端字段：org/store/importTask 由导入流程补齐） */
  records: StandardRecords[K][];
  errors: RowError[];
}

/** 六类标准记录（解析后形态；金额 string 保留精度、时间为 UTC ISO 字符串） */
export interface ProductRecord {
  kind: "products";
  storeExternalId: string;
  sourceUpdatedAt: string;
  externalProductId: string;
  name: string;
  category: string | null;
  productStatus: "active" | "archived";
  externalSkuId: string;
  skuCode: string;
  skuName: string;
  specification: string | null;
  skuStatus: "active" | "archived";
}
export interface OrderRecord {
  kind: "orders";
  storeExternalId: string;
  sourceUpdatedAt: string;
  externalOrderId: string;
  paymentStatus: "unpaid" | "paid" | "cancelled";
  orderedAt: string;
  paidAt: string | null;
  currency: string;
  expectedItemCount: number;
}
export interface OrderItemRecord {
  kind: "order_items";
  storeExternalId: string;
  sourceUpdatedAt: string;
  externalOrderId: string;
  externalOrderItemId: string;
  externalSkuId: string;
  quantity: number;
  itemPaidAmount: string;
  currency: string;
}
export interface AdRecord {
  kind: "ads";
  storeExternalId: string;
  sourceUpdatedAt: string;
  campaignId: string;
  campaignName: string;
  reportDate: string;
  attributionModel: string;
  attributionWindowDays: number;
  spend: string;
  attributedSales: string;
  currency: string;
}
export interface CustomerMessageRecord {
  kind: "customer_messages";
  storeExternalId: string;
  sourceUpdatedAt: string;
  externalMessageId: string;
  externalConversationId: string;
  messageAt: string;
  externalSkuId: string | null;
  messageText: string;
  isComplaint: boolean | null;
  channel: string;
  language: string;
}
export interface AfterSaleRecord {
  kind: "after_sales";
  storeExternalId: string;
  sourceUpdatedAt: string;
  recordType: "case" | "refund";
  externalRecordId: string;
  externalOrderId: string;
  externalOrderItemId: string;
  relatedCaseId: string | null;
  occurredAt: string;
  status: string;
  completedAt: string | null;
  refundAmount: string | null;
  refundedQuantityCumulative: number | null;
  currency: string | null;
  reasonCode: string;
  reasonText: string | null;
}

export interface StandardRecords {
  products: ProductRecord;
  orders: OrderRecord;
  order_items: OrderItemRecord;
  ads: AdRecord;
  customer_messages: CustomerMessageRecord;
  after_sales: AfterSaleRecord;
}

/** 六类标准文件的固定表头（模板与校验同源；顺序即模板列顺序） */
export const FILE_HEADERS: Record<FileKind, readonly string[]> = {
  products: [
    "store_external_id", "source_updated_at",
    "external_product_id", "product_name", "category", "product_status",
    "external_sku_id", "sku_code", "sku_name", "specification", "sku_status",
  ],
  orders: [
    "store_external_id", "source_updated_at",
    "external_order_id", "payment_status", "ordered_at", "paid_at", "currency", "expected_item_count",
  ],
  order_items: [
    "store_external_id", "source_updated_at",
    "external_order_id", "external_order_item_id", "external_sku_id", "quantity", "item_paid_amount", "currency",
  ],
  ads: [
    "store_external_id", "source_updated_at",
    "campaign_id", "campaign_name", "report_date", "attribution_model",
    "attribution_window_days", "spend", "attributed_sales", "currency",
  ],
  customer_messages: [
    "store_external_id", "source_updated_at",
    "external_message_id", "external_conversation_id", "message_at", "external_sku_id",
    "message_text", "is_complaint", "channel", "language",
  ],
  after_sales: [
    "store_external_id", "source_updated_at",
    "record_type", "external_record_id", "external_order_id", "external_order_item_id",
    "related_case_id", "occurred_at", "status", "completed_at",
    "refund_amount", "refunded_quantity_cumulative", "currency", "reason_code", "reason_text",
  ],
};

/** 必填列（04 §12.2–12.7 中"必填=是"的列；缺失 → MISSING_COLUMN 整文件拒绝） */
export const REQUIRED_HEADERS: Record<FileKind, readonly string[]> = {
  products: [
    "store_external_id", "source_updated_at", "external_product_id", "product_name",
    "product_status", "external_sku_id", "sku_code", "sku_name", "sku_status",
  ],
  orders: [
    "store_external_id", "source_updated_at", "external_order_id", "payment_status",
    "ordered_at", "currency", "expected_item_count",
  ],
  order_items: [...FILE_HEADERS.order_items],
  ads: [...FILE_HEADERS.ads],
  customer_messages: [
    "store_external_id", "source_updated_at", "external_message_id", "external_conversation_id",
    "message_at", "message_text", "channel", "language",
  ],
  after_sales: [
    "store_external_id", "source_updated_at", "record_type", "external_record_id",
    "external_order_id", "external_order_item_id", "occurred_at", "status", "reason_code",
  ],
};

// ---------- 纯校验函数（导入边界一致语义；供 CSV 行与 Mock 数据复用） ----------

export function validateExternalId(value: unknown, column: string, row: number, errors: RowError[]): string | null {
  if (typeof value !== "string" || value.length === 0) {
    errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  if (value.length > 128) {
    errors.push({ row, column, code: "TOO_LONG", message: `${column} 超过 128 字符` });
    return null;
  }
  return value; // 原样保留（含前导零）
}

export function validateText(
  value: unknown,
  column: string,
  row: number,
  errors: RowError[],
  opts: { required: boolean; max: number },
): string | null {
  if (value === null || value === undefined || value === "") {
    if (opts.required) errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  const text = String(value);
  if (text.length > opts.max) {
    errors.push({ row, column, code: "TOO_LONG", message: `${column} 超过 ${opts.max} 字符` });
    return null;
  }
  return text;
}

/** 必填枚举：空值即 REQUIRED 错误（G2-H03：不得给 product_status 等默认兜底值） */
export function validateEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  column: string,
  row: number,
  errors: RowError[],
): T[number] | null {
  const text = value === null || value === undefined || value === "" ? "" : String(value).trim();
  if (text === "") {
    errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  if ((allowed as readonly string[]).includes(text)) return text as T[number];
  errors.push({ row, column, code: "UNSUPPORTED_VALUE", message: `${column} 不支持：${text}` });
  return null;
}

/**
 * numeric(20,6) 语义：十进制字符串、非负、整数部分 ≤14 位、小数 ≤6 位
 * （G2-H03：100000000000000.000000 超出精度必须拒绝，等不到数据库写入）。
 */
export function validateAmount(
  value: unknown,
  column: string,
  row: number,
  errors: RowError[],
  opts: { required: boolean; min?: number },
): string | null {
  if (value === null || value === undefined || value === "") {
    if (opts.required) errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  const text = String(value).trim();
  if (!/^\d{1,14}(\.\d{1,6})?$/.test(text)) {
    errors.push({ row, column, code: "INVALID_AMOUNT", message: `${column} 必须为非负十进制、整数部分≤14位且最多 6 位小数：${text}` });
    return null;
  }
  if (opts.min !== undefined && Number(text) < opts.min) {
    errors.push({ row, column, code: "OUT_OF_RANGE", message: `${column} 不能小于 ${opts.min}` });
    return null;
  }
  return text;
}

/**
 * 安全整数（G2-H03）：Number 转换后必须为安全整数——9007199254740993 一类
 * 输入会被二进制舍入为 ...992，必须在转换前拒绝。
 */
export function validateInteger(
  value: unknown,
  column: string,
  row: number,
  errors: RowError[],
  opts: { required: boolean; min?: number; max?: number },
): number | null {
  if (value === null || value === undefined || value === "") {
    if (opts.required) errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    errors.push({ row, column, code: "INVALID_INTEGER", message: `${column} 必须为整数：${text}` });
    return null;
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    errors.push({ row, column, code: "OUT_OF_RANGE", message: `${column} 超出安全整数范围：${text}` });
    return null;
  }
  if (opts.min !== undefined && n < opts.min) {
    errors.push({ row, column, code: "OUT_OF_RANGE", message: `${column} 不能小于 ${opts.min}` });
    return null;
  }
  if (opts.max !== undefined && n > opts.max) {
    errors.push({ row, column, code: "OUT_OF_RANGE", message: `${column} 不能大于 ${opts.max}` });
    return null;
  }
  return n;
}

/**
 * timestamptz（G2-H03）：必须为 RFC3339 且带时区（Z 或 ±hh:mm），
 * 并做真实日历校验——无时区的含糊时间与 2026-02-30 一类日期拒绝。
 */
const RFC3339_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export function validateTimestamp(
  value: unknown,
  column: string,
  row: number,
  errors: RowError[],
  opts: { required: boolean },
): string | null {
  if (value === null || value === undefined || value === "") {
    if (opts.required) errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  const text = String(value).trim();
  const m = RFC3339_RE.exec(text);
  if (!m || !isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))) {
    errors.push({ row, column, code: "INVALID_DATETIME", message: `${column} 必须为 RFC3339 且带时区（如 2026-09-01T10:00:00+08:00）：${text}` });
    return null;
  }
  return new Date(text).toISOString();
}

function isRealCalendarDate(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** date：YYYY-MM-DD 且真实日历（2026-02-30 拒绝） */
export function validateDate(
  value: unknown,
  column: string,
  row: number,
  errors: RowError[],
  opts: { required: boolean },
): string | null {
  if (value === null || value === undefined || value === "") {
    if (opts.required) errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  const text = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m || !isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0)) {
    errors.push({ row, column, code: "INVALID_DATE", message: `${column} 必须为 YYYY-MM-DD：${text}` });
    return null;
  }
  return text;
}

export function validateCurrency(value: unknown, column: string, row: number, errors: RowError[]): string | null {
  if (value === null || value === undefined || value === "") {
    errors.push({ row, column, code: "REQUIRED", message: `${column} 必填` });
    return null;
  }
  const text = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) {
    errors.push({ row, column, code: "INVALID_CURRENCY", message: `${column} 必须为 3 位字母：${text}` });
    return null;
  }
  return text;
}

export function validateBooleanTri(value: unknown, column: string, row: number, errors: RowError[]): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  errors.push({ row, column, code: "INVALID_BOOLEAN", message: `${column} 必须为 true/false/空：${text}` });
  return null;
}

// ---------- CSV 解析（既定选型 csv-parse；RFC4180 严格语法） ----------

/**
 * 解析为二维单元格数组；BOM 剥离、CRLF/LF、quoted 逗号/换行/双引号转义。
 * 未闭合引号、引号后残留字符、列数不匹配 → 抛出语法错误（调用方整文件拒绝）。
 */
export function parseCsv(content: string): string[][] {
  return csvParse(content, {
    bom: true,
    relax_column_count: false,
    skip_empty_lines: true,
    trim: false,
  }) as string[][];
}

// ---------- 标准文件解析（表头映射 + 行级校验；不含任何 DB 访问） ----------

export interface ParseStandardOptions {
  /** 声明的店铺外部标识：行值不一致 → 整文件 STORE_MISMATCH */
  storeExternalId: string;
}

type Cell = string | null;

function cell(row: Record<string, Cell>, header: string): Cell {
  return row[header] ?? null;
}

export function parseStandardFile(
  kind: FileKind,
  content: string,
  opts: ParseStandardOptions,
): ParseResult {
  let rows: string[][];
  try {
    rows = parseCsv(content);
  } catch (error) {
    return {
      kind,
      records: [],
      errors: [
        {
          row: 1,
          code: "INVALID_CSV",
          message: `CSV 语法错误（RFC4180）：${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const errors: RowError[] = [];
  if (rows.length === 0) {
    return { kind, records: [], errors: [{ row: 1, code: "EMPTY_FILE", message: "文件为空" }] };
  }
  const headers = rows[0].map((h) => h.trim());
  // G2-H03：重复表头拒绝（列语义歧义，不允许"后者覆盖前者"）
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) {
      return {
        kind,
        records: [],
        errors: [{ row: 1, column: h, code: "DUPLICATE_COLUMN", message: `重复表头列 ${h}` }],
      };
    }
    seen.add(h);
  }
  // G2-H03：只要求必填列存在；可选列（category/specification/paid_at/external_sku_id/
  // is_complaint/related_case_id/completed_at/refund_amount/...）缺列按全空处理
  for (const h of REQUIRED_HEADERS[kind]) {
    if (!headers.includes(h)) {
      return {
        kind,
        records: [],
        errors: [{ row: 1, column: h, code: "MISSING_COLUMN", message: `缺少必需列 ${h}` }],
      };
    }
  }
  const records: StandardRecords[FileKind][] = [];
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    const record: Record<string, Cell> = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] === undefined || values[idx] === "" ? null : values[idx];
    });
    const rowNo = r + 1;
    // 店铺一致性：任何行店铺不符 → 整文件拒绝（STORE_MISMATCH）
    const rowStore = cell(record, "store_external_id");
    if (rowStore !== opts.storeExternalId) {
      return {
        kind,
        records: [],
        errors: [
          {
            row: rowNo,
            column: "store_external_id",
            code: "STORE_MISMATCH",
            message: `文件店铺声明不一致：期望 ${opts.storeExternalId}，第 ${rowNo} 行为 ${rowStore ?? "(空)"}`,
          },
        ],
      };
    }
    const recordErrors: RowError[] = [];
    const mapped = mapRow(kind, record, rowNo, recordErrors);
    errors.push(...recordErrors);
    if (recordErrors.length === 0 && mapped) records.push(mapped);
  }
  return { kind, records, errors };
}

function mapRow(
  kind: FileKind,
  record: Record<string, Cell>,
  row: number,
  errors: RowError[],
): StandardRecords[FileKind] | null {
  const storeExternalId = String(optsStore(record));
  // G2-H03：source_updated_at 每行必填，缺失报错——服务端不补造来源时间
  const sourceUpdatedAt = validateTimestamp(cell(record, "source_updated_at"), "source_updated_at", row, errors, { required: true });
  switch (kind) {
    case "products": {
      const externalProductId = validateExternalId(cell(record, "external_product_id"), "external_product_id", row, errors);
      const externalSkuId = validateExternalId(cell(record, "external_sku_id"), "external_sku_id", row, errors);
      const name = validateText(cell(record, "product_name"), "product_name", row, errors, { required: true, max: 300 });
      const skuCode = validateText(cell(record, "sku_code"), "sku_code", row, errors, { required: true, max: 128 });
      const skuName = validateText(cell(record, "sku_name"), "sku_name", row, errors, { required: true, max: 300 });
      const category = validateText(cell(record, "category"), "category", row, errors, { required: false, max: 100 });
      const specification = validateText(cell(record, "specification"), "specification", row, errors, { required: false, max: 500 });
      const productStatus = validateEnum(cell(record, "product_status"), ["active", "archived"] as const, "product_status", row, errors);
      const skuStatus = validateEnum(cell(record, "sku_status"), ["active", "archived"] as const, "sku_status", row, errors);
      if (errors.length) return null;
      return {
        kind,
        storeExternalId,
        sourceUpdatedAt: sourceUpdatedAt!,
        externalProductId: externalProductId!,
        name: name!,
        category,
        productStatus: productStatus!,
        externalSkuId: externalSkuId!,
        skuCode: skuCode!,
        skuName: skuName!,
        specification,
        skuStatus: skuStatus!,
      };
    }
    case "orders": {
      const externalOrderId = validateExternalId(cell(record, "external_order_id"), "external_order_id", row, errors);
      const paymentStatus = validateEnum(cell(record, "payment_status"), ["unpaid", "paid", "cancelled"] as const, "payment_status", row, errors);
      const orderedAt = validateTimestamp(cell(record, "ordered_at"), "ordered_at", row, errors, { required: true });
      const paidAtRaw = cell(record, "paid_at");
      const paidAt = validateTimestamp(paidAtRaw, "paid_at", row, errors, { required: paymentStatus === "paid" });
      const currency = validateCurrency(cell(record, "currency"), "currency", row, errors);
      const expectedItemCount = validateInteger(cell(record, "expected_item_count"), "expected_item_count", row, errors, { required: true, min: 1 });
      if (errors.length) return null;
      if (paymentStatus === "paid" && orderedAt && paidAt && paidAt < orderedAt) {
        errors.push({ row, column: "paid_at", code: "OUT_OF_RANGE", message: "paid_at 不得早于 ordered_at" });
        return null;
      }
      if (paymentStatus !== "paid" && paidAt) {
        errors.push({ row, column: "paid_at", code: "OUT_OF_RANGE", message: "非 paid 订单不得携带 paid_at" });
        return null;
      }
      return {
        kind,
        storeExternalId,
        sourceUpdatedAt: sourceUpdatedAt!,
        externalOrderId: externalOrderId!,
        paymentStatus: paymentStatus!,
        orderedAt: orderedAt!,
        paidAt,
        currency: currency!,
        expectedItemCount: expectedItemCount!,
      };
    }
    case "order_items": {
      const externalOrderId = validateExternalId(cell(record, "external_order_id"), "external_order_id", row, errors);
      const externalOrderItemId = validateExternalId(cell(record, "external_order_item_id"), "external_order_item_id", row, errors);
      const externalSkuId = validateExternalId(cell(record, "external_sku_id"), "external_sku_id", row, errors);
      const quantity = validateInteger(cell(record, "quantity"), "quantity", row, errors, { required: true, min: 1, max: 100_000_000 });
      const itemPaidAmount = validateAmount(cell(record, "item_paid_amount"), "item_paid_amount", row, errors, { required: true, min: 0 });
      const currency = validateCurrency(cell(record, "currency"), "currency", row, errors);
      if (errors.length) return null;
      return {
        kind,
        storeExternalId,
        sourceUpdatedAt: sourceUpdatedAt!,
        externalOrderId: externalOrderId!,
        externalOrderItemId: externalOrderItemId!,
        externalSkuId: externalSkuId!,
        quantity: quantity!,
        itemPaidAmount: itemPaidAmount!,
        currency: currency!,
      };
    }
    case "ads": {
      const campaignId = validateExternalId(cell(record, "campaign_id"), "campaign_id", row, errors);
      const campaignName = validateText(cell(record, "campaign_name"), "campaign_name", row, errors, { required: true, max: 300 });
      const reportDate = validateDate(cell(record, "report_date"), "report_date", row, errors, { required: true });
      const attributionModel = validateText(cell(record, "attribution_model"), "attribution_model", row, errors, { required: true, max: 64 });
      const attributionWindowDays = validateInteger(cell(record, "attribution_window_days"), "attribution_window_days", row, errors, { required: true, min: 0, max: 90 });
      const spend = validateAmount(cell(record, "spend"), "spend", row, errors, { required: true, min: 0 });
      const attributedSales = validateAmount(cell(record, "attributed_sales"), "attributed_sales", row, errors, { required: true, min: 0 });
      const currency = validateCurrency(cell(record, "currency"), "currency", row, errors);
      if (errors.length) return null;
      return {
        kind,
        storeExternalId,
        sourceUpdatedAt: sourceUpdatedAt!,
        campaignId: campaignId!,
        campaignName: campaignName!,
        reportDate: reportDate!,
        attributionModel: attributionModel!,
        attributionWindowDays: attributionWindowDays!,
        spend: spend!,
        attributedSales: attributedSales!,
        currency: currency!,
      };
    }
    case "customer_messages": {
      const externalMessageId = validateExternalId(cell(record, "external_message_id"), "external_message_id", row, errors);
      const externalConversationId = validateExternalId(cell(record, "external_conversation_id"), "external_conversation_id", row, errors);
      const messageAt = validateTimestamp(cell(record, "message_at"), "message_at", row, errors, { required: true });
      const externalSkuId = cell(record, "external_sku_id")
        ? validateExternalId(cell(record, "external_sku_id"), "external_sku_id", row, errors)
        : null;
      const messageText = validateText(cell(record, "message_text"), "message_text", row, errors, { required: true, max: 10000 });
      const isComplaint = validateBooleanTri(cell(record, "is_complaint"), "is_complaint", row, errors);
      const channel = validateText(cell(record, "channel"), "channel", row, errors, { required: true, max: 32 });
      const language = validateText(cell(record, "language"), "language", row, errors, { required: true, max: 16 });
      if (errors.length) return null;
      return {
        kind,
        storeExternalId,
        sourceUpdatedAt: sourceUpdatedAt!,
        externalMessageId: externalMessageId!,
        externalConversationId: externalConversationId!,
        messageAt: messageAt!,
        externalSkuId,
        messageText: messageText!,
        isComplaint,
        channel: channel!,
        language: language!,
      };
    }
    case "after_sales": {
      const recordType = validateEnum(cell(record, "record_type"), ["case", "refund"] as const, "record_type", row, errors);
      const externalRecordId = validateExternalId(cell(record, "external_record_id"), "external_record_id", row, errors);
      const externalOrderId = validateExternalId(cell(record, "external_order_id"), "external_order_id", row, errors);
      const externalOrderItemId = validateExternalId(cell(record, "external_order_item_id"), "external_order_item_id", row, errors);
      const relatedCaseId = cell(record, "related_case_id")
        ? validateExternalId(cell(record, "related_case_id"), "related_case_id", row, errors)
        : null;
      const occurredAt = validateTimestamp(cell(record, "occurred_at"), "occurred_at", row, errors, { required: true });
      const reasonCode = validateText(cell(record, "reason_code"), "reason_code", row, errors, { required: true, max: 64 });
      const reasonText = validateText(cell(record, "reason_text"), "reason_text", row, errors, { required: false, max: 2000 });
      let status: string | null;
      let completedAt: string | null = null;
      let refundAmount: string | null = null;
      let refundedQuantityCumulative: number | null = null;
      let currency: string | null = null;
      if (recordType === "case") {
        status = validateEnum(cell(record, "status"), ["requested", "processing", "closed", "rejected"] as const, "status", row, errors);
        if (cell(record, "completed_at")) {
          errors.push({ row, column: "completed_at", code: "OUT_OF_RANGE", message: "case 行不得携带 completed_at" });
        }
        if (cell(record, "refund_amount")) {
          errors.push({ row, column: "refund_amount", code: "OUT_OF_RANGE", message: "case 行不得携带 refund_amount" });
        }
        if (cell(record, "refunded_quantity_cumulative")) {
          errors.push({ row, column: "refunded_quantity_cumulative", code: "OUT_OF_RANGE", message: "case 行不得携带累计退件数" });
        }
        if (cell(record, "currency")) {
          errors.push({ row, column: "currency", code: "OUT_OF_RANGE", message: "case 行 currency 应为空" });
        }
      } else if (recordType === "refund") {
        status = validateEnum(cell(record, "status"), ["pending", "succeeded", "failed"] as const, "status", row, errors);
        currency = validateCurrency(cell(record, "currency"), "currency", row, errors);
        if (status === "succeeded") {
          completedAt = validateTimestamp(cell(record, "completed_at"), "completed_at", row, errors, { required: true });
          refundAmount = validateAmount(cell(record, "refund_amount"), "refund_amount", row, errors, { required: true, min: 0.000001 });
          refundedQuantityCumulative = validateInteger(cell(record, "refunded_quantity_cumulative"), "refunded_quantity_cumulative", row, errors, { required: true, min: 0 });
          if (!errors.length && completedAt && occurredAt && completedAt < occurredAt) {
            // G2-H03：退款完成时间早于发生时间是行级矛盾，直接拒绝
            errors.push({ row, column: "completed_at", code: "OUT_OF_RANGE", message: "completed_at 不得早于 occurred_at" });
          }
        } else {
          if (cell(record, "completed_at")) {
            errors.push({ row, column: "completed_at", code: "OUT_OF_RANGE", message: "非 succeeded 退款不得携带 completed_at" });
          }
          if (cell(record, "refund_amount")) {
            errors.push({ row, column: "refund_amount", code: "OUT_OF_RANGE", message: "非 succeeded 退款不得携带 refund_amount" });
          }
          if (cell(record, "refunded_quantity_cumulative")) {
            errors.push({ row, column: "refunded_quantity_cumulative", code: "OUT_OF_RANGE", message: "非 succeeded 退款不得携带累计退件数" });
          }
        }
      } else {
        // record_type 缺失/非法：validateEnum 已记错误，保证 status 也有错误占位
        status = null;
      }
      if (errors.length) return null;
      return {
        kind,
        storeExternalId,
        sourceUpdatedAt: sourceUpdatedAt!,
        recordType: recordType!,
        externalRecordId: externalRecordId!,
        externalOrderId: externalOrderId!,
        externalOrderItemId: externalOrderItemId!,
        relatedCaseId,
        occurredAt: occurredAt!,
        status: status!,
        completedAt,
        refundAmount,
        refundedQuantityCumulative,
        currency,
        reasonCode: reasonCode!,
        reasonText,
      };
    }
  }
}

function optsStore(record: Record<string, Cell>): Cell {
  return record["store_external_id"];
}

// ---------- CanonicalBatch 合同（04 §11.2 / §12.8；G2-H04） ----------

/** 固定 adapter 版本（解析行为变更时递增；mapping_version 之外的第二稳定标识） */
export const ADAPTER_VERSION = "adapter-v1";

/**
 * 覆盖声明单项（04 §12.1：source_kind/channel/from/to/status/explicit_zero_dates）。
 * status 仅允许用户声明 complete/partial；missing 是"没有声明"的系统状态。
 * after_sales 需按 case/refund 分别声明（channel 承载子通道）。
 */
export interface CoverageDeclarationItem {
  source_kind: FileKind;
  /** orders/default、after_sales/case 等（04 §10.7 渠道命名） */
  channel: string;
  /** 本地日期（含） */
  from: string;
  /** 本地日期（不含，右开） */
  to: string;
  status: "complete" | "partial";
  /** 显式零事件日期（本地日期逐日展开；缺事件 ≠ 零事件） */
  explicit_zero_dates: string[];
}

/**
 * 统一批次（04 §11.2）：records 之外的元数据全部由服务端赋值——
 * store_id 是服务端解析出的 UUID；namespace 来自 DataSource；checksum 来自原始文件；
 * coverage_declaration 来自用户的映射/预览确认（不来自 CSV 文件内容）。
 */
export interface CanonicalBatch<K extends FileKind = FileKind> {
  source_kind: K;
  source_namespace: string;
  store_id: string;
  adapter_kind: "csv" | "mock";
  adapter_version: string;
  raw_checksum: string;
  records: StandardRecords[K][];
  row_errors: RowError[];
  coverage_declaration: CoverageDeclarationItem[];
}

function assertLocalDate(value: string, field: string): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (
    !m ||
    !isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0)
  ) {
    throw new Error(`coverage_declaration.${field} 必须为合法本地日期（YYYY-MM-DD）：${value}`);
  }
}

/**
 * 组装 typed CanonicalBatch（纯函数）：校验覆盖声明结构与日期边界，
 * 拒绝 from>=to（右开）与未登记 source_kind/channel 形态。
 */
export function createCanonicalBatch<K extends FileKind>(args: {
  sourceKind: K;
  sourceNamespace: string;
  storeId: string;
  adapterKind: "csv" | "mock";
  rawChecksum: string;
  parse: ParseResult<K>;
  coverageDeclaration?: CoverageDeclarationItem[];
}): CanonicalBatch<K> {
  if (!isFileKind(args.sourceKind)) {
    throw new Error(`未知来源类型：${String(args.sourceKind)}`);
  }
  if (!args.storeId) {
    throw new Error("CanonicalBatch.store_id 必须由服务端赋值");
  }
  if (!/^[0-9a-f]{64}$/i.test(args.rawChecksum)) {
    throw new Error("CanonicalBatch.raw_checksum 必须为 sha256 hex");
  }
  const declaration = (args.coverageDeclaration ?? []).map((item) => {
    if (!isFileKind(item.source_kind)) {
      throw new Error(`coverage_declaration.source_kind 非法：${String(item.source_kind)}`);
    }
    if (!item.channel || item.channel.length > 64) {
      throw new Error(`coverage_declaration.channel 非法：${String(item.channel)}`);
    }
    if (item.status !== "complete" && item.status !== "partial") {
      throw new Error(`coverage_declaration.status 仅允许 complete/partial：${String(item.status)}`);
    }
    assertLocalDate(item.from, "from");
    assertLocalDate(item.to, "to");
    if (Date.parse(`${item.to}T00:00:00Z`) <= Date.parse(`${item.from}T00:00:00Z`)) {
      throw new Error(`coverage_declaration [${item.from}, ${item.to}) 为空区间（to 必须晚于 from）`);
    }
    for (const zero of item.explicit_zero_dates) {
      assertLocalDate(zero, "explicit_zero_dates");
    }
    return { ...item, explicit_zero_dates: [...item.explicit_zero_dates] };
  });
  return {
    source_kind: args.sourceKind,
    source_namespace: args.sourceNamespace,
    store_id: args.storeId,
    adapter_kind: args.adapterKind,
    adapter_version: ADAPTER_VERSION,
    raw_checksum: args.rawChecksum,
    records: args.parse.records,
    row_errors: args.parse.errors,
    coverage_declaration: declaration,
  };
}

// ---------- DataAdapter 契约 ----------

export interface AdapterContext {
  storeExternalId: string;
}

export interface DataAdapter {
  readonly kind: "csv" | "mock";
  /** CSV：content 为文件文本；Mock：content 为合成数据集（与 CSV 同一逻辑数据的对象形态） */
  parse(kind: FileKind, ctx: AdapterContext, content: string): ParseResult;
}

export const csvAdapter: DataAdapter = {
  kind: "csv",
  parse(kind, ctx, content) {
    return parseStandardFile(kind, content, { storeExternalId: ctx.storeExternalId });
  },
};

/** Mock 合成数据集：与 CSV 同一逻辑数据的对象形态（value 语义同 CSV 单元格） */
export type MockDataset = Record<FileKind, Record<string, string | null>[]>;

export const mockAdapter: DataAdapter = {
  kind: "mock",
  parse(kind, ctx, content) {
    let dataset: MockDataset;
    try {
      dataset = JSON.parse(content) as MockDataset;
    } catch {
      return { kind, records: [], errors: [{ row: 0, code: "INVALID_MOCK_DATASET", message: "mock 数据集不是合法 JSON" }] };
    }
    const rows = dataset[kind];
    if (!Array.isArray(rows)) {
      return { kind, records: [], errors: [{ row: 0, code: "INVALID_MOCK_DATASET", message: `mock 数据集缺少 ${kind}` }] };
    }
    // 与 CSV 完全同一解析/校验路径：把对象行序列化为 CSV 文本后复用 parseStandardFile，
    // 保证“同一逻辑数据经 CSV 和 Mock 所得标准记录一致”。
    const headers = FILE_HEADERS[kind];
    const escape = (v: string | null) => {
      if (v === null) return "";
      if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const text = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h] ?? null)).join(","))].join("\r\n");
    return parseStandardFile(kind, text, { storeExternalId: ctx.storeExternalId });
  },
};

export function getAdapter(kind: "csv" | "mock"): DataAdapter {
  if (kind !== "csv" && kind !== "mock") {
    // P0 仅 csv/mock；Excel 等类型明确不支持（09_TASKS 禁止项）
    throw new AccessErrorLike(`不支持的适配器类型：${String(kind)}`);
  }
  return kind === "csv" ? csvAdapter : mockAdapter;
}

/** 轻量错误（避免 adapters 依赖 services 层） */
class AccessErrorLike extends Error {}
