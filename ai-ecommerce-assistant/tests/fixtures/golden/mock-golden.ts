/**
 * TASK-006｜黄金合成样本（Mock 形态）：与 tests/fixtures/golden/store-a|b 的 CSV
 * 是同一逻辑数据的对象形态（值语义与 CSV 单元格一致），供 Mock Adapter 契约测试
 * 验证“同一逻辑数据经 CSV 和 Mock 所得标准记录一致”。
 * 规范来源：04_DATA_MODEL §12.8 可手算黄金 fixture。
 * 注意：两店必须分别成集（导入时分别建任务，禁止一个 CSV 混店）。
 */
import type { MockDataset } from "@/adapters/contracts";

const TS = "2026-09-11T09:00:00+08:00";

export const GOLDEN_STORE_A_EXTERNAL_ID = "XM-DEMO-A";
export const GOLDEN_STORE_B_EXTERNAL_ID = "XM-DEMO-B";

export const mockGoldenA: MockDataset = {
  products: [
    {
      store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS,
      external_product_id: "P1", product_name: "保温杯", category: "杯具", product_status: "active",
      external_sku_id: "S1", sku_code: "CUP-RED", sku_name: "红杯", specification: null, sku_status: "active",
    },
    {
      store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS,
      external_product_id: "P1", product_name: "保温杯", category: "杯具", product_status: "active",
      external_sku_id: "S2", sku_code: "CUP-BLUE", sku_name: "蓝杯", specification: null, sku_status: "active",
    },
  ],
  orders: [
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O1", payment_status: "paid", ordered_at: "2026-09-01T09:55:00+08:00", paid_at: "2026-09-01T10:00:00+08:00", currency: "CNY", expected_item_count: "2" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O2", payment_status: "paid", ordered_at: "2026-09-01T11:55:00+08:00", paid_at: "2026-09-01T12:00:00+08:00", currency: "CNY", expected_item_count: "1" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O3", payment_status: "paid", ordered_at: "2026-09-10T09:55:00+08:00", paid_at: "2026-09-10T10:00:00+08:00", currency: "CNY", expected_item_count: "1" },
  ],
  order_items: [
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O1", external_order_item_id: "L1", external_sku_id: "S1", quantity: "2", item_paid_amount: "100.000000", currency: "CNY" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O1", external_order_item_id: "L2", external_sku_id: "S2", quantity: "1", item_paid_amount: "60.000000", currency: "CNY" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O2", external_order_item_id: "L1", external_sku_id: "S1", quantity: "1", item_paid_amount: "70.000000", currency: "CNY" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O3", external_order_item_id: "L1", external_sku_id: "S1", quantity: "1", item_paid_amount: "50.000000", currency: "CNY" },
  ],
  ads: [
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, campaign_id: "AD1", campaign_name: "杯子搜索", report_date: "2026-09-01", attribution_model: "last_click", attribution_window_days: "7", spend: "40.000000", attributed_sales: "100.000000", currency: "CNY" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, campaign_id: "AD1", campaign_name: "杯子搜索", report_date: "2026-09-02", attribution_model: "last_click", attribution_window_days: "7", spend: "0.000000", attributed_sales: "0.000000", currency: "CNY" },
  ],
  customer_messages: [
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_message_id: "M1", external_conversation_id: "C1", message_at: "2026-09-01T11:00:00+08:00", external_sku_id: "S1", message_text: "杯盖漏水，想申请退款", is_complaint: "true", channel: "platform_chat", language: "zh-CN" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_message_id: "M2", external_conversation_id: "C1", message_at: "2026-09-01T11:05:00+08:00", external_sku_id: "S1", message_text: "退款什么时候到账", is_complaint: "false", channel: "platform_chat", language: "zh-CN" },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, external_message_id: "M3", external_conversation_id: "C2", message_at: "2026-09-01T12:00:00+08:00", external_sku_id: "S2", message_text: "可以装热水吗", is_complaint: "false", channel: "platform_chat", language: "zh-CN" },
  ],
  after_sales: [
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, record_type: "case", external_record_id: "AS1", external_order_id: "O1", external_order_item_id: "L1", related_case_id: null, occurred_at: "2026-09-02T09:00:00+08:00", status: "closed", completed_at: null, refund_amount: null, refunded_quantity_cumulative: null, currency: null, reason_code: "quality", reason_text: null },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, record_type: "refund", external_record_id: "RF1", external_order_id: "O1", external_order_item_id: "L1", related_case_id: "AS1", occurred_at: "2026-09-03T10:00:00+08:00", status: "succeeded", completed_at: "2026-09-03T10:00:00+08:00", refund_amount: "25.000000", refunded_quantity_cumulative: "1", currency: "CNY", reason_code: "quality", reason_text: null },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, record_type: "refund", external_record_id: "RF2", external_order_id: "O1", external_order_item_id: "L1", related_case_id: "AS1", occurred_at: "2026-09-04T10:00:00+08:00", status: "succeeded", completed_at: "2026-09-04T10:00:00+08:00", refund_amount: "25.000000", refunded_quantity_cumulative: "1", currency: "CNY", reason_code: "quality", reason_text: null },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, record_type: "refund", external_record_id: "RF3", external_order_id: "O1", external_order_item_id: "L2", related_case_id: null, occurred_at: "2026-09-04T11:00:00+08:00", status: "succeeded", completed_at: "2026-09-04T11:00:00+08:00", refund_amount: "60.000000", refunded_quantity_cumulative: "1", currency: "CNY", reason_code: "wrong_item", reason_text: null },
    { store_external_id: GOLDEN_STORE_A_EXTERNAL_ID, source_updated_at: TS, record_type: "refund", external_record_id: "RF4", external_order_id: "O2", external_order_item_id: "L1", related_case_id: null, occurred_at: "2026-09-09T11:00:00+08:00", status: "succeeded", completed_at: "2026-09-09T11:00:00+08:00", refund_amount: "10.000000", refunded_quantity_cumulative: "0", currency: "CNY", reason_code: "other", reason_text: null },
  ],
};

export const mockGoldenB: MockDataset = {
  products: [
    {
      store_external_id: GOLDEN_STORE_B_EXTERNAL_ID, source_updated_at: TS,
      external_product_id: "P1", product_name: "保温杯", category: "杯具", product_status: "active",
      external_sku_id: "S1", sku_code: "CUP-RED", sku_name: "红杯", specification: null, sku_status: "active",
    },
  ],
  orders: [
    { store_external_id: GOLDEN_STORE_B_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O1", payment_status: "paid", ordered_at: "2026-09-01T09:55:00+08:00", paid_at: "2026-09-01T10:00:00+08:00", currency: "CNY", expected_item_count: "1" },
  ],
  order_items: [
    { store_external_id: GOLDEN_STORE_B_EXTERNAL_ID, source_updated_at: TS, external_order_id: "O1", external_order_item_id: "L1", external_sku_id: "S1", quantity: "3", item_paid_amount: "900.000000", currency: "CNY" },
  ],
  ads: [
    { store_external_id: GOLDEN_STORE_B_EXTERNAL_ID, source_updated_at: TS, campaign_id: "AD1", campaign_name: "杯子搜索", report_date: "2026-09-01", attribution_model: "last_click", attribution_window_days: "7", spend: "100.000000", attributed_sales: "500.000000", currency: "CNY" },
  ],
  customer_messages: [
    { store_external_id: GOLDEN_STORE_B_EXTERNAL_ID, source_updated_at: TS, external_message_id: "M1", external_conversation_id: "C1", message_at: "2026-09-01T11:00:00+08:00", external_sku_id: "S1", message_text: "请问什么时候发货", is_complaint: null, channel: "platform_chat", language: "zh-CN" },
  ],
  after_sales: [],
};
