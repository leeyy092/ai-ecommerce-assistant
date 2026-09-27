/**
 * GET /api/v1/metrics（TASK-014；08 §17.4）
 * 指标读取：只读“已发布快照”同版本行（04 §11.1 步骤11——同次读取同一发布身份）；
 * 无已发布快照返回明确未准备好（503 SNAPSHOT_NOT_READY），不补零。
 * from/to 为店铺本地日期半开区间（≤90天）；金额十进制字符串、比率小数、计数安全整数。
 * P1 指标（ROI/转化率/库存等）恒 unavailable/null，reason 注明未接入，不造值。
 */
import type { NextRequest } from "next/server";
import { ok, fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";

export const runtime = "nodejs";

const AMOUNT_METRICS = new Set(["gmv", "average_order_value", "ad_spend", "ad_sales", "refund_amount", "sku_sales_amount"]);
const RATIO_METRICS = new Set(["roas", "order_refund_rate_d7", "sku_refund_rate_d7", "after_sale_rate_d7", "complaint_message_rate", "negative_voc_rate", "refund_event_amount_ratio"]);
const P1_UNAVAILABLE: Record<string, string> = {
  operating_roi: "cost_data_unavailable",
  conversion_rate: "traffic_data_unavailable",
  inventory_on_hand: "inventory_snapshot_unavailable",
  inventory_turnover_days: "cost_data_unavailable",
  negative_review_rate: "review_data_unavailable",
};

function parseLocalDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewBusinessData });
    const url = new URL(req.url);
    const storeId = url.searchParams.get("store_id") ?? "";
    const from = parseLocalDate(url.searchParams.get("from"));
    const to = parseLocalDate(url.searchParams.get("to"));
    const metricIds = (url.searchParams.get("metric_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!storeId) return fail(422, "缺少 store_id", { code: "VALIDATION_ERROR" });
    const db = getPrismaClient();
    const store = await db.store.findFirst({ where: { orgId: ctx.orgId, id: storeId }, select: { id: true, currency: true, timezone: true, currentSnapshotVersion: true, currentSnapshotRulesetVersion: true, currentSnapshotEvaluationAt: true, snapshotStatus: true } });
    if (!store) return fail(404, "店铺不存在", { code: "NOT_FOUND" });
    if (store.currentSnapshotVersion == null || !store.currentSnapshotRulesetVersion || !store.currentSnapshotEvaluationAt) {
      return fail(503, "指标尚未准备（无已发布快照）", { code: "SNAPSHOT_NOT_READY" });
    }
    // 默认昨日完整自然日（店铺本地）；from/to 半开区间，≤90 天
    let rangeFrom = from;
    let rangeTo = to;
    if (!rangeFrom || !rangeTo) {
      const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: store.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const yesterday = new Date(Date.parse(`${todayLocal}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      rangeFrom = from ?? yesterday;
      rangeTo = to ?? todayLocal;
    }
    if (rangeFrom >= rangeTo) return fail(422, "from 必须早于 to（本地日期半开区间）", { code: "VALIDATION_ERROR" });
    if ((Date.parse(`${rangeTo}T00:00:00Z`) - Date.parse(`${rangeFrom}T00:00:00Z`)) / 86400000 > 90) {
      return fail(422, "单次最大 90 天", { code: "VALIDATION_ERROR" });
    }

    const rows = await db.dailyMetric.findMany({
      where: {
        orgId: ctx.orgId, storeId,
        datasetVersion: store.currentSnapshotVersion,
        rulesetVersion: store.currentSnapshotRulesetVersion,
        evaluationAt: store.currentSnapshotEvaluationAt,
        periodStart: { gte: new Date(`${rangeFrom}T00:00:00Z`), lt: new Date(`${rangeTo}T00:00:00Z`) },
        ...(metricIds.length ? { metricId: { in: metricIds } } : {}),
      },
      orderBy: [{ periodStart: "asc" }, { metricId: "asc" }, { entityKey: "asc" }],
      take: 1000,
    });

    const items = rows.map((r) => {
      let value: string | number | null = null;
      if (r.status === "available") {
        if (AMOUNT_METRICS.has(r.metricId) && r.valueNumeric != null) value = r.valueNumeric.toString();
        else if (RATIO_METRICS.has(r.metricId) && r.valueNumeric != null) value = Number.parseFloat(r.valueNumeric.toString());
        else if (!AMOUNT_METRICS.has(r.metricId) && !RATIO_METRICS.has(r.metricId)) value = Number(r.sampleSize); // 计数类
      }
      return {
        metric_id: r.metricId,
        entity_key: r.entityKey,
        value,
        unit: AMOUNT_METRICS.has(r.metricId) ? "currency" : RATIO_METRICS.has(r.metricId) ? (r.metricId === "roas" ? "multiple" : "ratio") : "count",
        currency: AMOUNT_METRICS.has(r.metricId) ? r.currency : null,
        period_start: r.periodStart.toISOString().slice(0, 10),
        period_end: r.periodEnd.toISOString().slice(0, 10),
        status: r.status,
        coverage_status: r.coverageStatus,
        maturity: r.maturity,
        unavailable_reason: r.unavailableReason,
        numerator: r.numerator?.toString() ?? null,
        denominator: r.denominator?.toString() ?? null,
        sample_size: Number(r.sampleSize),
        metric_version: r.metricVersion,
      };
    });

    // P1 指标的固定“未接入”占位（不落库、不造值）
    for (const [mid, reason] of Object.entries(P1_UNAVAILABLE)) {
      if (!metricIds.length || metricIds.includes(mid)) {
        items.push({
          metric_id: mid, entity_key: "store", value: null,
          unit: mid === "roas" ? "multiple" : "ratio", currency: null,
          period_start: rangeFrom, period_end: new Date(Date.parse(`${rangeTo}T00:00:00Z`) - 86400000).toISOString().slice(0, 10),
          status: "unavailable", coverage_status: "missing", maturity: "not_applicable",
          unavailable_reason: reason, numerator: null, denominator: null, sample_size: 0,
          metric_version: "v1",
        });
      }
    }

    return ok(
      { items },
      {
        dataset_version: store.currentSnapshotVersion.toString(),
        latest_dataset_version: (await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { datasetVersion: true } })).datasetVersion.toString(),
        ruleset_version: store.currentSnapshotRulesetVersion,
        snapshot_status: store.snapshotStatus,
        timezone: store.timezone,
        currency: store.currency,
      },
    );
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
