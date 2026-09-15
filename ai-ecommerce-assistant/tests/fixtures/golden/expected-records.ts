/**
 * G2-H04｜黄金样本规范 oracle（04_DATA_MODEL §12.8 表格的手写标准记录形态）。
 *
 * 这是**独立于解析器**写出的期望值：测试必须先断言"CSV 解析 = oracle"、
 * 再断言"Mock 解析 = oracle"——两入口复用同一解析实现时，共享结果只有
 * 对照本 oracle 才能证明共同正确（不得把两个入口相等当作正确性证明）。
 * 时间为解析输出的 UTC ISO 字符串（12.8 统一 +08:00 → -8h）。
 */
import type { StandardRecords } from "@/adapters/contracts";

const TS = "2026-09-11T01:00:00.000Z"; // 2026-09-11T09:00:00+08:00
export const TS_SOURCE_UPDATED_AT = TS;

type Rec = StandardRecords[keyof StandardRecords];

const A_PRODUCTS: Rec[] = [
  { kind: "products", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalProductId: "P1", name: "保温杯", category: "杯具", productStatus: "active", externalSkuId: "S1", skuCode: "CUP-RED", skuName: "红杯", specification: null, skuStatus: "active" },
  { kind: "products", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalProductId: "P1", name: "保温杯", category: "杯具", productStatus: "active", externalSkuId: "S2", skuCode: "CUP-BLUE", skuName: "蓝杯", specification: null, skuStatus: "active" },
];
const A_ORDERS: Rec[] = [
  { kind: "orders", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O1", paymentStatus: "paid", orderedAt: "2026-09-01T01:55:00.000Z", paidAt: "2026-09-01T02:00:00.000Z", currency: "CNY", expectedItemCount: 2 },
  { kind: "orders", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O2", paymentStatus: "paid", orderedAt: "2026-09-01T03:55:00.000Z", paidAt: "2026-09-01T04:00:00.000Z", currency: "CNY", expectedItemCount: 1 },
  { kind: "orders", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O3", paymentStatus: "paid", orderedAt: "2026-09-10T01:55:00.000Z", paidAt: "2026-09-10T02:00:00.000Z", currency: "CNY", expectedItemCount: 1 },
];
const A_ORDER_ITEMS: Rec[] = [
  { kind: "order_items", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O1", externalOrderItemId: "L1", externalSkuId: "S1", quantity: 2, itemPaidAmount: "100.000000", currency: "CNY" },
  { kind: "order_items", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O1", externalOrderItemId: "L2", externalSkuId: "S2", quantity: 1, itemPaidAmount: "60.000000", currency: "CNY" },
  { kind: "order_items", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O2", externalOrderItemId: "L1", externalSkuId: "S1", quantity: 1, itemPaidAmount: "70.000000", currency: "CNY" },
  { kind: "order_items", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalOrderId: "O3", externalOrderItemId: "L1", externalSkuId: "S1", quantity: 1, itemPaidAmount: "50.000000", currency: "CNY" },
];
const A_ADS: Rec[] = [
  { kind: "ads", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, campaignId: "AD1", campaignName: "杯子搜索", reportDate: "2026-09-01", attributionModel: "last_click", attributionWindowDays: 7, spend: "40.000000", attributedSales: "100.000000", currency: "CNY" },
  { kind: "ads", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, campaignId: "AD1", campaignName: "杯子搜索", reportDate: "2026-09-02", attributionModel: "last_click", attributionWindowDays: 7, spend: "0.000000", attributedSales: "0.000000", currency: "CNY" },
];
// A M3 is_complaint=false（12.8 :686 明确 false；B M1 缺失保持 null——:687）
const A_MESSAGES: Rec[] = [
  { kind: "customer_messages", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalMessageId: "M1", externalConversationId: "C1", messageAt: "2026-09-01T03:00:00.000Z", externalSkuId: "S1", messageText: "杯盖漏水，想申请退款", isComplaint: true, channel: "platform_chat", language: "zh-CN" },
  { kind: "customer_messages", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalMessageId: "M2", externalConversationId: "C1", messageAt: "2026-09-01T03:05:00.000Z", externalSkuId: "S1", messageText: "退款什么时候到账", isComplaint: false, channel: "platform_chat", language: "zh-CN" },
  { kind: "customer_messages", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, externalMessageId: "M3", externalConversationId: "C2", messageAt: "2026-09-01T04:00:00.000Z", externalSkuId: "S2", messageText: "可以装热水吗", isComplaint: false, channel: "platform_chat", language: "zh-CN" },
];
const A_AFTER_SALES: Rec[] = [
  { kind: "after_sales", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, recordType: "case", externalRecordId: "AS1", externalOrderId: "O1", externalOrderItemId: "L1", relatedCaseId: null, occurredAt: "2026-09-02T01:00:00.000Z", status: "closed", completedAt: null, refundAmount: null, refundedQuantityCumulative: null, currency: null, reasonCode: "quality", reasonText: null },
  { kind: "after_sales", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, recordType: "refund", externalRecordId: "RF1", externalOrderId: "O1", externalOrderItemId: "L1", relatedCaseId: "AS1", occurredAt: "2026-09-03T02:00:00.000Z", status: "succeeded", completedAt: "2026-09-03T02:00:00.000Z", refundAmount: "25.000000", refundedQuantityCumulative: 1, currency: "CNY", reasonCode: "quality", reasonText: null },
  { kind: "after_sales", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, recordType: "refund", externalRecordId: "RF2", externalOrderId: "O1", externalOrderItemId: "L1", relatedCaseId: "AS1", occurredAt: "2026-09-04T02:00:00.000Z", status: "succeeded", completedAt: "2026-09-04T02:00:00.000Z", refundAmount: "25.000000", refundedQuantityCumulative: 1, currency: "CNY", reasonCode: "quality", reasonText: null },
  { kind: "after_sales", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, recordType: "refund", externalRecordId: "RF3", externalOrderId: "O1", externalOrderItemId: "L2", relatedCaseId: null, occurredAt: "2026-09-04T03:00:00.000Z", status: "succeeded", completedAt: "2026-09-04T03:00:00.000Z", refundAmount: "60.000000", refundedQuantityCumulative: 1, currency: "CNY", reasonCode: "wrong_item", reasonText: null },
  { kind: "after_sales", storeExternalId: "XM-DEMO-A", sourceUpdatedAt: TS, recordType: "refund", externalRecordId: "RF4", externalOrderId: "O2", externalOrderItemId: "L1", relatedCaseId: null, occurredAt: "2026-09-09T03:00:00.000Z", status: "succeeded", completedAt: "2026-09-09T03:00:00.000Z", refundAmount: "10.000000", refundedQuantityCumulative: 0, currency: "CNY", reasonCode: "other", reasonText: null },
];

const B_PRODUCTS: Rec[] = [
  { kind: "products", storeExternalId: "XM-DEMO-B", sourceUpdatedAt: TS, externalProductId: "P1", name: "保温杯", category: "杯具", productStatus: "active", externalSkuId: "S1", skuCode: "CUP-RED", skuName: "红杯", specification: null, skuStatus: "active" },
];
const B_ORDERS: Rec[] = [
  { kind: "orders", storeExternalId: "XM-DEMO-B", sourceUpdatedAt: TS, externalOrderId: "O1", paymentStatus: "paid", orderedAt: "2026-09-01T01:55:00.000Z", paidAt: "2026-09-01T02:00:00.000Z", currency: "CNY", expectedItemCount: 1 },
];
const B_ORDER_ITEMS: Rec[] = [
  { kind: "order_items", storeExternalId: "XM-DEMO-B", sourceUpdatedAt: TS, externalOrderId: "O1", externalOrderItemId: "L1", externalSkuId: "S1", quantity: 3, itemPaidAmount: "900.000000", currency: "CNY" },
];
const B_ADS: Rec[] = [
  { kind: "ads", storeExternalId: "XM-DEMO-B", sourceUpdatedAt: TS, campaignId: "AD1", campaignName: "杯子搜索", reportDate: "2026-09-01", attributionModel: "last_click", attributionWindowDays: 7, spend: "100.000000", attributedSales: "500.000000", currency: "CNY" },
];
const B_MESSAGES: Rec[] = [
  { kind: "customer_messages", storeExternalId: "XM-DEMO-B", sourceUpdatedAt: TS, externalMessageId: "M1", externalConversationId: "C1", messageAt: "2026-09-01T03:00:00.000Z", externalSkuId: "S1", messageText: "请问什么时候发货", isComplaint: null, channel: "platform_chat", language: "zh-CN" },
];
const B_AFTER_SALES: Rec[] = [];

/** 规范期望：store → kind → 标准记录数组（手写，独立于解析实现） */
export const GOLDEN_EXPECTED: Record<"A" | "B", Record<keyof StandardRecords, Rec[]>> = {
  A: {
    products: A_PRODUCTS,
    orders: A_ORDERS,
    order_items: A_ORDER_ITEMS,
    ads: A_ADS,
    customer_messages: A_MESSAGES,
    after_sales: A_AFTER_SALES,
  },
  B: {
    products: B_PRODUCTS,
    orders: B_ORDERS,
    order_items: B_ORDER_ITEMS,
    ads: B_ADS,
    customer_messages: B_MESSAGES,
    after_sales: B_AFTER_SALES,
  },
};
