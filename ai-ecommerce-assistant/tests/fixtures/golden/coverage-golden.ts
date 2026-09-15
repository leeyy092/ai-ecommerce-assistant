/**
 * G2-H04｜黄金覆盖声明 fixture（04_DATA_MODEL §12.8 :701 的独立展开）。
 *
 * 规范要求：两店必须**分别**展开声明，无事件日期逐日 explicit_zero；
 * 缺事件 ≠ 零事件——未经显式确认的日期保持 missing（不声明即可）。
 * 区间一律右开 [from, to)；日期为店铺本地日期（Asia/Shanghai）。
 *
 * 依据 12.8 数据分布：
 * - A 订单/订单行：09-01（O1,O2）、09-10（O3）→ 零事件日 09-02..09-09；
 * - B 订单/订单行：仅 09-01（O1）→ 零事件日 09-02..09-10；
 * - A 消息：仅 09-01；B 消息：仅 09-01；
 * - A 广告：09-01、09-02 有数据 → 声明 [09-01, 09-03)；B 广告仅 09-01 → [09-01, 09-02)；
 *   其余广告日期不声明（missing）；
 * - A 售后 case：仅 09-02（AS1）→ 零事件日 09-01、09-03..09-10；
 *   A 退款：09-03（RF1）、09-04（RF2,RF3）、09-09（RF4）
 *   → 零事件日 09-01、09-02、09-05..09-10；
 * - B case/refund：全区间明确零事件（B 的 after_sales.csv 为空文件+表头）；
 * - products 无事件期：仅记录目录确认日（评估日 2026-09-11）。
 */
import type { CoverageDeclarationItem } from "@/adapters/contracts";

export const GOLDEN_EVAL_FROM = "2026-09-01";
export const GOLDEN_EVAL_TO = "2026-09-11"; // 右开：覆盖 09-01..09-10 共 10 天

function days(from: string, to: string, exclude: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!exclude.has(iso)) out.push(iso);
  }
  return out;
}

const A_ORDER_DAYS = new Set(["2026-09-01", "2026-09-10"]);
const B_ORDER_DAYS = new Set(["2026-09-01"]);
const A_CASE_DAYS = new Set(["2026-09-02"]);
const A_REFUND_DAYS = new Set(["2026-09-03", "2026-09-04", "2026-09-09"]);
const A_MSG_DAYS = new Set(["2026-09-01"]);

/** A 店覆盖声明（12.8 :701：逐渠道独立展开，含逐日显式零事件） */
export const goldenCoverageA: CoverageDeclarationItem[] = [
  { source_kind: "orders", channel: "orders/default", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, A_ORDER_DAYS) },
  { source_kind: "order_items", channel: "order_items/default", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, A_ORDER_DAYS) },
  { source_kind: "customer_messages", channel: "customer_messages/default", from: "2026-09-01", to: "2026-09-02", status: "complete", explicit_zero_dates: [] },
  { source_kind: "ads", channel: "ads/default", from: "2026-09-01", to: "2026-09-03", status: "complete", explicit_zero_dates: [] },
  { source_kind: "after_sales", channel: "after_sales/case", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, A_CASE_DAYS) },
  { source_kind: "after_sales", channel: "after_sales/refund", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, A_REFUND_DAYS) },
  { source_kind: "products", channel: "products/catalog", from: "2026-09-11", to: "2026-09-12", status: "complete", explicit_zero_dates: [] },
];

/** B 店覆盖声明（case/refund 全区间明确零事件；广告/消息仅 09-01） */
export const goldenCoverageB: CoverageDeclarationItem[] = [
  { source_kind: "orders", channel: "orders/default", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, B_ORDER_DAYS) },
  { source_kind: "order_items", channel: "order_items/default", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, B_ORDER_DAYS) },
  { source_kind: "customer_messages", channel: "customer_messages/default", from: "2026-09-01", to: "2026-09-02", status: "complete", explicit_zero_dates: [] },
  { source_kind: "ads", channel: "ads/default", from: "2026-09-01", to: "2026-09-02", status: "complete", explicit_zero_dates: [] },
  { source_kind: "after_sales", channel: "after_sales/case", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, new Set()) },
  { source_kind: "after_sales", channel: "after_sales/refund", from: GOLDEN_EVAL_FROM, to: GOLDEN_EVAL_TO, status: "complete", explicit_zero_dates: days(GOLDEN_EVAL_FROM, GOLDEN_EVAL_TO, new Set()) },
  { source_kind: "products", channel: "products/catalog", from: "2026-09-11", to: "2026-09-12", status: "complete", explicit_zero_dates: [] },
];
