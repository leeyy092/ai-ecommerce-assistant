/**
 * TASK-006｜统一 Adapter 契约测试（纯解析层，无 DB）。
 * 验收：同一逻辑数据经 CSV 和 Mock 所得标准记录一致且等于规范 oracle；
 *       ID 前导零保留；Mock 不直接写页面（Adapter 为纯函数，无 DB/HTTP 依赖）。
 * G2-H03 回归：数值上界/精度、严格时间/日历、必填/可选列、来源时间不补造、
 *              csv-parse 严格语法（未闭合引号/重复表头）。
 * G2-H04 回归：CanonicalBatch 元数据合同、两店覆盖声明独立展开、
 *              A M3=false、B M1=null，规范 oracle 与 CSV/Mock 两层校验。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADAPTER_VERSION,
  csvAdapter,
  createCanonicalBatch,
  FILE_KINDS,
  getAdapter,
  isFileKind,
  mockAdapter,
  parseCsv,
  parseStandardFile,
  type CanonicalBatch,
  type CoverageDeclarationItem,
  type FileKind,
  type ParseResult,
  type StandardRecords,
} from "@/adapters/contracts";
import {
  GOLDEN_STORE_A_EXTERNAL_ID,
  GOLDEN_STORE_B_EXTERNAL_ID,
  mockGoldenA,
  mockGoldenB,
} from "../fixtures/golden/mock-golden";
import { goldenCoverageA, goldenCoverageB } from "../fixtures/golden/coverage-golden";
import { GOLDEN_EXPECTED } from "../fixtures/golden/expected-records";

const goldenDir = (store: "store-a" | "store-b") =>
  join(import.meta.dirname, "..", "fixtures", "golden", store);
const readGolden = (store: "store-a" | "store-b", kind: string) =>
  readFileSync(join(goldenDir(store), `${kind}.csv`), "utf8");

const ctxA = { storeExternalId: GOLDEN_STORE_A_EXTERNAL_ID };
const ctxB = { storeExternalId: GOLDEN_STORE_B_EXTERNAL_ID };

type Rec = StandardRecords[keyof StandardRecords];

describe("TASK-006｜CSV 解析基础（RFC4180，csv-parse）", () => {
  it("quoted 逗号/换行/双引号转义；BOM 剥离；CRLF/LF", () => {
    const text =
      "\uFEFFa,b,c\r\n\"x,1\",\"line1\nline2\",\"say \"\"hi\"\"\"\r\nplain,,\r\n";
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(["a", "b", "c"]);
    expect(rows[1]).toEqual(["x,1", "line1\nline2", 'say "hi"']);
    expect(rows[2]).toEqual(["plain", "", ""]); // 空单元格保留空串语义
  });

  it("G2-H03：列数与表头不匹配整文件拒绝（csv-parse 严格列数）", () => {
    const text = "a,b\r\n1,2,3\r\n";
    expect(() => parseCsv(text)).toThrow(/Invalid Record Length/);
  });

  it("G2-H03：未闭合 quoted 字段整文件拒绝（INVALID_CSV）", () => {
    const bad = parseStandardFile("products", [
      FILE_LINE.products,
      "XM-DEMO-A,2026-09-11T01:00:00Z,P1,\"未闭合,active,S1,C1,杯,,active",
    ].join("\n"), { storeExternalId: "XM-DEMO-A" });
    expect(bad.records).toEqual([]);
    expect(bad.errors[0].code).toBe("INVALID_CSV");
  });

  it("G2-H03：重复表头拒绝（DUPLICATE_COLUMN）", () => {
    const line = FILE_LINE.orders;
    const dup = parseStandardFile("orders", `${line},currency\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1,USD`, { storeExternalId: "XM-DEMO-A" });
    expect(dup.records).toEqual([]);
    expect(dup.errors[0].code).toBe("DUPLICATE_COLUMN");
  });

  it("unsupported 类型被拒绝（六类之外）", () => {
    expect(isFileKind("excel")).toBe(false);
    expect(isFileKind("products")).toBe(true);
    expect(FILE_KINDS).toHaveLength(6);
    // Excel 解析器明确不在 P0 范围（09_TASKS 禁止项）
    expect(() => getAdapter("excel" as never)).toThrow();
  });
});

const FILE_LINE: Record<FileKind, string> = {
  products: "store_external_id,source_updated_at,external_product_id,product_name,category,product_status,external_sku_id,sku_code,sku_name,specification,sku_status",
  orders: "store_external_id,source_updated_at,external_order_id,payment_status,ordered_at,paid_at,currency,expected_item_count",
  order_items: "store_external_id,source_updated_at,external_order_id,external_order_item_id,external_sku_id,quantity,item_paid_amount,currency",
  ads: "store_external_id,source_updated_at,campaign_id,campaign_name,report_date,attribution_model,attribution_window_days,spend,attributed_sales,currency",
  customer_messages: "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,external_sku_id,message_text,is_complaint,channel,language",
  after_sales: "store_external_id,source_updated_at,record_type,external_record_id,external_order_id,external_order_item_id,related_case_id,occurred_at,status,completed_at,refund_amount,refunded_quantity_cumulative,currency,reason_code,reason_text",
};

describe("TASK-006｜黄金样本解析（store A）", () => {
  it.each([
    ["products", 2],
    ["orders", 3],
    ["order_items", 4],
    ["ads", 2],
    ["customer_messages", 3],
    ["after_sales", 5],
  ])("%s：%i 条标准记录、零错误", (kind, count) => {
    const result = parseStandardFile(kind as never, readGolden("store-a", kind), { storeExternalId: GOLDEN_STORE_A_EXTERNAL_ID });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(count);
  });

  it("ID 前导零保留（external id 为字符串原样）", () => {
    const csv = [
      FILE_LINE.products,
      `XM-DEMO-A,2026-09-11T01:00:00Z,007,杯子,,active,000-SKU,CUP-007,七号杯,,active`,
    ].join("\n");
    const result = parseStandardFile("products", csv, { storeExternalId: "XM-DEMO-A" });
    expect(result.errors).toEqual([]);
    expect(result.records[0]).toMatchObject({
      externalProductId: "007",
      externalSkuId: "000-SKU",
    });
  });

  it("G2-H04：A M3 is_complaint=false（12.8 :686）；B M1 缺失保持 null（:687）", () => {
    const a = parseStandardFile("customer_messages", readGolden("store-a", "customer_messages"), ctxA);
    const aM3 = a.records[2] as { isComplaint: boolean | null };
    expect(aM3.isComplaint).toBe(false); // 规范值 false，不是缺失

    const b = parseStandardFile("customer_messages", readGolden("store-b", "customer_messages"), ctxB);
    const bM1 = b.records[0] as { isComplaint: boolean | null };
    expect(bM1.isComplaint).toBeNull(); // 缺失 ≠ false（投诉率 unavailable 的前提）
  });

  it("时间统一转 UTC ISO；+08:00 偏移正确换算", () => {
    const result = parseStandardFile("orders", readGolden("store-a", "orders"), ctxA);
    const o1 = result.records[0] as { paidAt: string | null };
    expect(o1.paidAt).toBe("2026-09-01T02:00:00.000Z");
  });
});

describe("TASK-006｜CSV 与 Mock 一致性，且均等于规范 oracle（G2-H04）", () => {
  const cases: [FileKind, "A" | "B", "store-a" | "store-b", typeof mockGoldenA | typeof mockGoldenB, string][] = [
    ["products", "A", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["orders", "A", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["order_items", "A", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["ads", "A", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["customer_messages", "A", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["after_sales", "A", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["products", "B", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["orders", "B", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["order_items", "B", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["ads", "B", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["customer_messages", "B", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["after_sales", "B", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
  ];

  it.each(cases)("%s（%s）：CSV ≡ oracle 且 Mock ≡ oracle（三层独立校验）", (kind, storeKey, dir, dataset, storeExternalId) => {
    const ctx = { storeExternalId };
    const csvResult = parseStandardFile(kind, readGolden(dir, kind), ctx) as ParseResult;
    const mockResult = mockAdapter.parse(kind, ctx, JSON.stringify(dataset));
    // 两入口一致（构造保证）
    expect(mockResult.errors).toEqual(csvResult.errors);
    expect(mockResult.records).toEqual(csvResult.records);
    // 共同结果必须等于规范 oracle（手写期望，独立于解析实现）
    expect(csvResult.errors).toEqual([]);
    expect(csvResult.records).toEqual(GOLDEN_EXPECTED[storeKey][kind]);
  });

  it("Mock adapter 复用同一解析路径（不直接写页面/库：纯函数输出标准记录）", () => {
    const result = mockAdapter.parse("orders", ctxA, JSON.stringify(mockGoldenA));
    expect(result.records.every((r) => r.kind === "orders")).toBe(true);
    // 纯函数：重复调用结果一致、无副作用载体
    const again = mockAdapter.parse("orders", ctxA, JSON.stringify(mockGoldenA));
    expect(again).toEqual(result);
  });
});

describe("TASK-006｜边界与拒绝", () => {
  it("STORE_MISMATCH：任一行店铺不符 → 整文件拒绝", () => {
    const csv = [
      FILE_LINE.orders,
      `XM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`,
      `XM-DEMO-B,2026-09-11T01:00:00Z,O2,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`,
    ].join("\n");
    const result = parseStandardFile("orders", csv, { storeExternalId: "XM-DEMO-A" });
    expect(result.records).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("STORE_MISMATCH");
  });

  it("金额边界：负数/超过 6 位小数拒绝；金额按字符串保留精度", () => {
    const base = `XM-DEMO-A,2026-09-11T01:00:00Z,O1,L1,S1,1,AMOUNT,CNY`;
    const bad = parseStandardFile("order_items", `${FILE_LINE.order_items}\n${base.replace("AMOUNT", "-5.000000")}`, { storeExternalId: "XM-DEMO-A" });
    expect(bad.errors[0].code).toBe("INVALID_AMOUNT");
    const precision = parseStandardFile("order_items", `${FILE_LINE.order_items}\n${base.replace("AMOUNT", "1.0000001")}`, { storeExternalId: "XM-DEMO-A" });
    expect(precision.errors[0].code).toBe("INVALID_AMOUNT");
    const ok = parseStandardFile("order_items", `${FILE_LINE.order_items}\n${base.replace("AMOUNT", "100.000000")}`, { storeExternalId: "XM-DEMO-A" });
    expect((ok.records[0] as { itemPaidAmount: string }).itemPaidAmount).toBe("100.000000");
  });

  it("G2-H03：numeric(20,6) 整数部分 ≤14 位——15 位整数金额拒绝、14 位边界接受", () => {
    const base = `XM-DEMO-A,2026-09-11T01:00:00Z,O1,L1,S1,1,AMOUNT,CNY`;
    const over = parseStandardFile("order_items", `${FILE_LINE.order_items}\n${base.replace("AMOUNT", "100000000000000.000000")}`, { storeExternalId: "XM-DEMO-A" });
    expect(over.errors[0].code).toBe("INVALID_AMOUNT");
    expect(over.records).toEqual([]);
    const edge = parseStandardFile("order_items", `${FILE_LINE.order_items}\n${base.replace("AMOUNT", "99999999999999.999999")}`, { storeExternalId: "XM-DEMO-A" });
    expect(edge.errors).toEqual([]);
    expect((edge.records[0] as { itemPaidAmount: string }).itemPaidAmount).toBe("99999999999999.999999");
  });

  it("G2-H03：超过安全整数的数量在转换前拒绝（9007199254740993 不得变成 ...992）", () => {
    const line = FILE_LINE.orders;
    const unsafe = parseStandardFile("orders", `${line}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,9007199254740993`, { storeExternalId: "XM-DEMO-A" });
    expect(unsafe.records).toEqual([]);
    expect(unsafe.errors[0].code).toBe("OUT_OF_RANGE");
    const pow53 = parseStandardFile("orders", `${line}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,9007199254740992`, { storeExternalId: "XM-DEMO-A" });
    expect(pow53.errors[0].code).toBe("OUT_OF_RANGE");
  });

  it("数量边界：0/负数/非整数拒绝", () => {
    for (const q of ["0", "-1", "1.5"]) {
      const csv = `${FILE_LINE.order_items}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,L1,S1,${q},10.000000,CNY`;
      const result = parseStandardFile("order_items", csv, { storeExternalId: "XM-DEMO-A" });
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("G2-H03：时间必须为 RFC3339 带时区——无时区/含糊格式/不存在日历日期拒绝", () => {
    const line = FILE_LINE.orders;
    for (const bad of ["2026-09-01T10:00:00", "09/01/26", "2026-02-30T00:00:00Z", "2026-09-01"]) {
      const result = parseStandardFile("orders", `${line}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,${bad},2026-09-01T10:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A" });
      expect(result.errors[0].code).toBe("INVALID_DATETIME");
    }
    // 合法：Z 与 +08:00 均接受
    for (const good of ["2026-09-01T10:00:00Z", "2026-09-01T18:00:00+08:00", "2026-02-28T23:59:59Z"]) {
      const result = parseStandardFile("orders", `${line}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,${good},2026-09-01T10:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A" });
      expect(result.errors).toEqual([]);
    }
  });

  it("G2-H03：report_date 不存在日历日期拒绝（2026-02-30）", () => {
    const csv = `${FILE_LINE.ads}\nXM-DEMO-A,2026-09-11T01:00:00Z,AD1,杯子搜索,2026-02-30,last_click,7,40.000000,100.000000,CNY`;
    const result = parseStandardFile("ads", csv, { storeExternalId: "XM-DEMO-A" });
    expect(result.records).toEqual([]);
    expect(result.errors[0].code).toBe("INVALID_DATE");
  });

  it("G2-H03：source_updated_at 缺失报 REQUIRED，不补造来源时间", () => {
    const csv = `${FILE_LINE.orders}\nXM-DEMO-A,,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`;
    const result = parseStandardFile("orders", csv, { storeExternalId: "XM-DEMO-A" });
    expect(result.records).toEqual([]);
    const err = result.errors.find((e) => e.column === "source_updated_at");
    expect(err?.code).toBe("REQUIRED");
  });

  it("G2-H03：必填枚举空值拒绝（product_status/sku_status 不再默认 active）", () => {
    const csv = `${FILE_LINE.products}\nXM-DEMO-A,2026-09-11T01:00:00Z,P1,保温杯,杯具,,S1,CUP-RED,红杯,,`;
    const result = parseStandardFile("products", csv, { storeExternalId: "XM-DEMO-A" });
    expect(result.records).toEqual([]);
    const codes = result.errors.filter((e) => e.code === "REQUIRED").map((e) => e.column);
    expect(codes).toContain("product_status");
    expect(codes).toContain("sku_status");
  });

  it("G2-H03：可选列缺列不报 MISSING_COLUMN（字段为 null）", () => {
    // products 缺 category/specification 两可选列
    const noOptional = parseStandardFile("products", "store_external_id,source_updated_at,external_product_id,product_name,product_status,external_sku_id,sku_code,sku_name,sku_status\nXM-DEMO-A,2026-09-11T01:00:00Z,P1,保温杯,active,S1,CUP-RED,红杯,active", { storeExternalId: "XM-DEMO-A" });
    expect(noOptional.errors).toEqual([]);
    expect(noOptional.records[0]).toMatchObject({ category: null, specification: null });
    // 消息缺 external_sku_id/is_complaint 可选列
    const noMsgOptional = parseStandardFile("customer_messages", "store_external_id,source_updated_at,external_message_id,external_conversation_id,message_at,message_text,channel,language\nXM-DEMO-A,2026-09-11T01:00:00Z,M1,C1,2026-09-01T11:00:00Z,你好,platform_chat,zh-CN", { storeExternalId: "XM-DEMO-A" });
    expect(noMsgOptional.errors).toEqual([]);
    expect(noMsgOptional.records[0]).toMatchObject({ externalSkuId: null, isComplaint: null });
  });

  it("G2-H03：退款 completed_at 早于 occurred_at 行级矛盾拒绝", () => {
    const csv = `${FILE_LINE.after_sales}\nXM-DEMO-A,2026-09-11T01:00:00Z,refund,RF1,O1,L1,,2026-09-03T02:00:00Z,succeeded,2026-09-01T00:00:00Z,25.000000,1,CNY,quality,`;
    const result = parseStandardFile("after_sales", csv, { storeExternalId: "XM-DEMO-A" });
    expect(result.records).toEqual([]);
    expect(result.errors[0].code).toBe("OUT_OF_RANGE");
    expect(result.errors[0].column).toBe("completed_at");
  });

  it("paid_at 不得早于 ordered_at；非 paid 不得携带 paid_at", () => {
    const early = parseStandardFile("orders", `${FILE_LINE.orders}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T10:00:00Z,2026-09-01T09:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A" });
    expect(early.errors[0].code).toBe("OUT_OF_RANGE");
    const unpaidWithPaid = parseStandardFile("orders", `${FILE_LINE.orders}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,unpaid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A" });
    expect(unpaidWithPaid.errors[0].code).toBe("OUT_OF_RANGE");
  });

  it("after_sales 语义：case 不得带退款字段；succeeded 退款必填 completed_at/金额/累计件数", () => {
    const caseWithRefund = parseStandardFile("after_sales", `${FILE_LINE.after_sales}\nXM-DEMO-A,2026-09-11T01:00:00Z,case,AS1,O1,L1,,2026-09-02T09:00:00Z,closed,2026-09-02T09:00:00Z,25.000000,1,CNY,quality,`, { storeExternalId: "XM-DEMO-A" });
    expect(caseWithRefund.errors.filter((e) => e.code === "OUT_OF_RANGE").length).toBeGreaterThanOrEqual(3);

    const succeededMissing = parseStandardFile("after_sales", `${FILE_LINE.after_sales}\nXM-DEMO-A,2026-09-11T01:00:00Z,refund,RF1,O1,L1,,2026-09-03T10:00:00Z,succeeded,,,,CNY,quality,`, { storeExternalId: "XM-DEMO-A" });
    expect(succeededMissing.errors.filter((e) => e.code === "REQUIRED").length).toBeGreaterThanOrEqual(2);
  });

  it("缺列/空文件明确报错", () => {
    const missingColumn = parseStandardFile("orders", "store_external_id,external_order_id\nXM-DEMO-A,O1", { storeExternalId: "XM-DEMO-A" });
    expect(missingColumn.errors[0].code).toBe("MISSING_COLUMN");
    const empty = parseStandardFile("orders", "", { storeExternalId: "XM-DEMO-A" });
    expect(empty.errors[0].code).toBe("EMPTY_FILE");
  });

  it("getAdapter：csv/mock 返回对应适配器（Mock 不直接写页面——仅返回标准记录）", () => {
    expect(getAdapter("csv").kind).toBe("csv");
    expect(getAdapter("mock").kind).toBe("mock");
  });
});

describe("G2-H04｜CanonicalBatch 合同与覆盖声明", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  function batchFor(store: "A" | "B"): CanonicalBatch<"customer_messages"> {
    const ctx = store === "A" ? ctxA : ctxB;
    const parsed = parseStandardFile("customer_messages", readGolden(store === "A" ? "store-a" : "store-b", "customer_messages"), ctx) as ParseResult<"customer_messages">;
    return createCanonicalBatch({
      sourceKind: "customer_messages",
      sourceNamespace: "mock_demo",
      storeId: `uuid-${store}`, // 服务端赋值（真实链路为 Store UUID）
      adapterKind: "csv",
      rawChecksum: sha(readGolden(store === "A" ? "store-a" : "store-b", "customer_messages")),
      parse: parsed,
      coverageDeclaration: store === "A" ? goldenCoverageA : goldenCoverageB,
    });
  }

  it("批次元数据齐备：store_id 服务端赋值、namespace/adapter_version/checksum/records/row_errors/coverage", () => {
    const batch = batchFor("A");
    expect(batch.source_kind).toBe("customer_messages");
    expect(batch.source_namespace).toBe("mock_demo");
    expect(batch.store_id).toBe("uuid-A");
    expect(batch.adapter_kind).toBe("csv");
    expect(batch.adapter_version).toBe(ADAPTER_VERSION);
    expect(batch.raw_checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(batch.records).toHaveLength(3);
    expect(batch.row_errors).toEqual([]);
    expect(batch.coverage_declaration.length).toBeGreaterThan(0);
    // 无 storeId 时拒绝构造（不信任文件/调用方声明）
    expect(() => createCanonicalBatch({ sourceKind: "customer_messages", sourceNamespace: "ns", storeId: "", adapterKind: "csv", rawChecksum: sha("x"), parse: { kind: "customer_messages", records: [], errors: [] } })).toThrow();
    // 坏 checksum / 坏声明区间同样拒绝
    expect(() => createCanonicalBatch({ sourceKind: "customer_messages", sourceNamespace: "ns", storeId: "s", adapterKind: "csv", rawChecksum: "not-sha", parse: { kind: "customer_messages", records: [], errors: [] } })).toThrow();
    expect(() => createCanonicalBatch({ sourceKind: "customer_messages", sourceNamespace: "ns", storeId: "s", adapterKind: "csv", rawChecksum: sha("x"), parse: { kind: "customer_messages", records: [], errors: [] }, coverageDeclaration: [{ source_kind: "customer_messages", channel: "c", from: "2026-09-02", to: "2026-09-02", status: "complete", explicit_zero_dates: [] }] })).toThrow();
    expect(() => createCanonicalBatch({ sourceKind: "customer_messages", sourceNamespace: "ns", storeId: "s", adapterKind: "csv", rawChecksum: sha("x"), parse: { kind: "customer_messages", records: [], errors: [] }, coverageDeclaration: [{ source_kind: "customer_messages", channel: "c", from: "2026-02-30", to: "2026-03-01", status: "complete", explicit_zero_dates: [] }] })).toThrow();
  });

  it("两店覆盖声明独立展开：A 零事件日与事件日对应数据分布；B case/refund 全区间零事件", () => {
    const a = goldenCoverageA.find((c) => c.source_kind === "orders")!;
    expect(a.explicit_zero_dates).toEqual([
      "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
    ]); // 09-01/09-10 有订单，不声明零

    const bCase = goldenCoverageB.find((c) => c.channel === "after_sales/case")!;
    const bRefund = goldenCoverageB.find((c) => c.channel === "after_sales/refund")!;
    expect(bCase.explicit_zero_dates).toHaveLength(10); // 09-01..09-10 全部显式零
    expect(bRefund.explicit_zero_dates).toEqual(bCase.explicit_zero_dates);

    const aCase = goldenCoverageA.find((c) => c.channel === "after_sales/case")!;
    const aRefund = goldenCoverageA.find((c) => c.channel === "after_sales/refund")!;
    expect(aCase.explicit_zero_dates).toContain("2026-09-01");
    expect(aCase.explicit_zero_dates).not.toContain("2026-09-02"); // AS1 当日
    expect(aRefund.explicit_zero_dates).toContain("2026-09-02");
    expect(aRefund.explicit_zero_dates).not.toContain("2026-09-04"); // RF2/RF3 当日

    // after_sales case 与 refund 是两条独立声明（12.7/12.8）
    expect(goldenCoverageA.filter((c) => c.source_kind === "after_sales")).toHaveLength(2);

    // 广告范围：A [09-01,09-03)、B [09-01,09-02)；其余广告日期不声明（missing）
    const aAds = goldenCoverageA.find((c) => c.source_kind === "ads")!;
    const bAds = goldenCoverageB.find((c) => c.source_kind === "ads")!;
    expect([aAds.from, aAds.to]).toEqual(["2026-09-01", "2026-09-03"]);
    expect([bAds.from, bAds.to]).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("黄金批次：A M3=false 与 B M1=null 进入批次 records（不得自动 false）", () => {
    const a = batchFor("A").records;
    expect(a[2].isComplaint).toBe(false);
    const b = batchFor("B").records;
    expect(b[0].isComplaint).toBeNull();
  });
});
