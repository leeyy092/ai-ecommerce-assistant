/**
 * TASK-006｜统一 Adapter 契约测试（纯解析层，无 DB）。
 * 验收：同一逻辑数据经 CSV 和 Mock 所得标准记录一致；ID 前导零保留；
 *       Mock 不直接写页面（Adapter 为纯函数，无 DB/HTTP 依赖）。
 * 测试：quoted 逗号/换行、BOM、空值、日期/金额边界、unsupported 类型、STORE_MISMATCH。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  csvAdapter,
  FILE_HEADERS,
  FILE_KINDS,
  getAdapter,
  isFileKind,
  mockAdapter,
  parseCsv,
  parseStandardFile,
} from "@/adapters/contracts";
import {
  GOLDEN_STORE_A_EXTERNAL_ID,
  GOLDEN_STORE_B_EXTERNAL_ID,
  mockGoldenA,
  mockGoldenB,
} from "../fixtures/golden/mock-golden";

const goldenDir = (store: "store-a" | "store-b") =>
  join(import.meta.dirname, "..", "fixtures", "golden", store);
const readGolden = (store: "store-a" | "store-b", kind: string) =>
  readFileSync(join(goldenDir(store), `${kind}.csv`), "utf8");

const ctxA = { storeExternalId: GOLDEN_STORE_A_EXTERNAL_ID, sourceUpdatedAt: "2026-09-11T01:00:00.000Z" };

describe("TASK-006｜CSV 解析基础（RFC4180）", () => {
  it("quoted 逗号/换行/双引号转义；BOM 剥离；CRLF/LF", () => {
    const text =
      "\uFEFFa,b\r\n\"x,1\",\"line1\nline2\",\"say \"\"hi\"\"\"\r\nplain,,\r\n";
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["x,1", "line1\nline2", 'say "hi"']);
    expect(rows[2]).toEqual(["plain", "", ""]); // 空单元格保留空串语义
  });

  it("unsupported 类型被拒绝（六类之外）", () => {
    expect(isFileKind("excel")).toBe(false);
    expect(isFileKind("products")).toBe(true);
    expect(FILE_KINDS).toHaveLength(6);
    // Excel 解析器明确不在 P0 范围（09_TASKS 禁止项）
    expect(() => getAdapter("excel" as never)).toThrow();
  });
});

describe("TASK-006｜黄金样本解析（store A）", () => {
  it.each([
    ["products", 2],
    ["orders", 3],
    ["order_items", 4],
    ["ads", 2],
    ["customer_messages", 3],
    ["after_sales", 5],
  ])("%s：%i 条标准记录、零错误", (kind, count) => {
    const result = parseStandardFile(kind as never, readGolden("store-a", kind), {
      storeExternalId: GOLDEN_STORE_A_EXTERNAL_ID,
      defaultSourceUpdatedAt: "2026-09-11T01:00:00.000Z",
    });
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(count);
  });

  it("ID 前导零保留（external id 为字符串原样）", () => {
    const csv = [
      FILE_HEADERS.products.join(","),
      `XM-DEMO-A,2026-09-11T01:00:00Z,007,杯子,,active,000-SKU,CUP-007,七号杯,,active`,
    ].join("\n");
    const result = parseStandardFile("products", csv, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(result.errors).toEqual([]);
    expect(result.records[0]).toMatchObject({
      externalProductId: "007",
      externalSkuId: "000-SKU",
    });
  });

  it("空值语义：空单元格 → null（is_complaint 三态、category/specification 可空）", () => {
    const result = parseStandardFile("customer_messages", readGolden("store-a", "customer_messages"), {
      storeExternalId: GOLDEN_STORE_A_EXTERNAL_ID,
      defaultSourceUpdatedAt: "2026-09-11T01:00:00.000Z",
    });
    expect(result.errors).toEqual([]);
    const m3 = result.records[2] as { isComplaint: boolean | null; messageText: string };
    expect(m3.isComplaint).toBeNull(); // 缺失 ≠ false
  });

  it("时间统一转 UTC ISO；+08:00 偏移正确换算", () => {
    const result = parseStandardFile("orders", readGolden("store-a", "orders"), {
      storeExternalId: GOLDEN_STORE_A_EXTERNAL_ID,
      defaultSourceUpdatedAt: "2026-09-11T01:00:00.000Z",
    });
    const o1 = result.records[0] as { paidAt: string | null };
    expect(o1.paidAt).toBe("2026-09-01T02:00:00.000Z");
  });
});

describe("TASK-006｜CSV 与 Mock 一致性（同一逻辑数据 → 同一标准记录）", () => {
  const cases: [string, "store-a" | "store-b", typeof mockGoldenA, string][] = [
    ["products", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["orders", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["order_items", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["ads", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["customer_messages", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["after_sales", "store-a", mockGoldenA, GOLDEN_STORE_A_EXTERNAL_ID],
    ["products", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["orders", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["order_items", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["ads", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
    ["customer_messages", "store-b", mockGoldenB, GOLDEN_STORE_B_EXTERNAL_ID],
  ];

  it.each(cases)("%s（%s）：CSV 与 Mock 标准记录逐字段一致", (kind, dir, dataset, storeExternalId) => {
    const csvResult = parseStandardFile(kind as never, readGolden(dir, kind), {
      storeExternalId,
      defaultSourceUpdatedAt: "2026-09-11T01:00:00.000Z",
    });
    const mockResult = mockAdapter.parse(kind as never, { storeExternalId, sourceUpdatedAt: "2026-09-11T01:00:00.000Z" }, JSON.stringify(dataset));
    expect(mockResult.errors).toEqual(csvResult.errors);
    expect(mockResult.records).toEqual(csvResult.records);
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
      FILE_HEADERS.orders.join(","),
      `XM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`,
      `XM-DEMO-B,2026-09-11T01:00:00Z,O2,paid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`,
    ].join("\n");
    const result = parseStandardFile("orders", csv, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(result.records).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("STORE_MISMATCH");
  });

  it("金额边界：负数/超过 6 位小数拒绝；金额按字符串保留精度", () => {
    const base = `XM-DEMO-A,2026-09-11T01:00:00Z,O1,L1,S1,1,AMOUNT,CNY`;
    const bad = parseStandardFile("order_items", `${FILE_HEADERS.order_items.join(",")}\n${base.replace("AMOUNT", "-5.000000")}`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(bad.errors[0].code).toBe("INVALID_AMOUNT");
    const precision = parseStandardFile("order_items", `${FILE_HEADERS.order_items.join(",")}\n${base.replace("AMOUNT", "1.0000001")}`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(precision.errors[0].code).toBe("INVALID_AMOUNT");
    const ok = parseStandardFile("order_items", `${FILE_HEADERS.order_items.join(",")}\n${base.replace("AMOUNT", "100.000000")}`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect((ok.records[0] as { itemPaidAmount: string }).itemPaidAmount).toBe("100.000000");
  });

  it("数量边界：0/负数/非整数拒绝", () => {
    for (const q of ["0", "-1", "1.5"]) {
      const csv = `${FILE_HEADERS.order_items.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,L1,S1,${q},10.000000,CNY`;
      const result = parseStandardFile("order_items", csv, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("日期边界：非法时间/缺失必填时间拒绝", () => {
    const bad = parseStandardFile("orders", `${FILE_HEADERS.orders.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,not-a-date,2026-09-01T10:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(bad.errors[0].code).toBe("INVALID_DATETIME");
    const missing = parseStandardFile("orders", `${FILE_HEADERS.orders.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,,2026-09-01T10:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(missing.errors[0].code).toBe("REQUIRED");
  });

  it("paid_at 不得早于 ordered_at；非 paid 不得携带 paid_at", () => {
    const early = parseStandardFile("orders", `${FILE_HEADERS.orders.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,paid,2026-09-01T10:00:00Z,2026-09-01T09:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(early.errors[0].code).toBe("OUT_OF_RANGE");
    const unpaidWithPaid = parseStandardFile("orders", `${FILE_HEADERS.orders.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,O1,unpaid,2026-09-01T09:55:00Z,2026-09-01T10:00:00Z,CNY,1`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(unpaidWithPaid.errors[0].code).toBe("OUT_OF_RANGE");
  });

  it("after_sales 语义：case 不得带退款字段；succeeded 退款必填 completed_at/金额/累计件数", () => {
    const caseWithRefund = parseStandardFile("after_sales", `${FILE_HEADERS.after_sales.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,case,AS1,O1,L1,,2026-09-02T09:00:00Z,closed,2026-09-02T09:00:00Z,25.000000,1,CNY,quality,`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(caseWithRefund.errors.filter((e) => e.code === "OUT_OF_RANGE").length).toBeGreaterThanOrEqual(3);

    const succeededMissing = parseStandardFile("after_sales", `${FILE_HEADERS.after_sales.join(",")}\nXM-DEMO-A,2026-09-11T01:00:00Z,refund,RF1,O1,L1,,2026-09-03T10:00:00Z,succeeded,,,,CNY,quality,`, { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(succeededMissing.errors.filter((e) => e.code === "REQUIRED").length).toBeGreaterThanOrEqual(2);
  });

  it("缺列/空文件明确报错", () => {
    const missingColumn = parseStandardFile("orders", "store_external_id,external_order_id\nXM-DEMO-A,O1", { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(missingColumn.errors[0].code).toBe("MISSING_COLUMN");
    const empty = parseStandardFile("orders", "", { storeExternalId: "XM-DEMO-A", defaultSourceUpdatedAt: "2026-09-11T01:00:00Z" });
    expect(empty.errors[0].code).toBe("EMPTY_FILE");
  });

  it("getAdapter：csv/mock 返回对应适配器（Mock 不直接写页面——仅返回标准记录）", () => {
    expect(getAdapter("csv").kind).toBe("csv");
    expect(getAdapter("mock").kind).toBe("mock");
  });
});
