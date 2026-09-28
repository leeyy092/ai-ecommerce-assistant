/**
 * GET /api/v1/metrics（TASK-014；08 §17.4；G4R2 M02/C12 修复版）
 * 指标读取：只读“已发布快照”同版本行（04 §11.1 步骤11——同次读取同一发布身份）；
 * 无已发布快照返回明确未准备好（503 SNAPSHOT_NOT_READY），不补零。
 * from/to 为店铺本地日期半开区间（≤90天）；grain 仅 day。
 * 响应含 metrics（范围汇总，比例按分子分母重新汇总，不平均日比率）与 series（日序列）；
 * 每项含 baseline（前等长窗口同版对比）；不同广告归因组/实体分行不混算。
 * 未知 metric_ids → 422；金额十进制字符串、比率小数、计数安全整数。
 * P1 指标（ROI/转化率/库存等）恒 unavailable/null，reason 注明未接入，不造值。
 */
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { ok, fail, serviceFailure, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";

export const runtime = "nodejs";

const AMOUNT_METRICS = new Set(["gmv", "average_order_value", "ad_spend", "ad_sales", "refund_amount", "sku_sales_amount"]);
const RATIO_METRICS = new Set(["roas", "order_refund_rate_d7", "sku_refund_rate_d7", "after_sale_rate_d7", "complaint_message_rate", "negative_voc_rate", "refund_event_amount_ratio"]);
const COUNT_METRICS = new Set(["units_sold", "paid_order_count"]);
const P1_UNAVAILABLE: Record<string, string> = {
  operating_roi: "cost_data_unavailable",
  conversion_rate: "traffic_data_unavailable",
  inventory_on_hand: "inventory_snapshot_unavailable",
  inventory_turnover_days: "cost_data_unavailable",
  negative_review_rate: "review_data_unavailable",
};
const KNOWN_METRICS = new Set([...AMOUNT_METRICS, ...RATIO_METRICS, ...COUNT_METRICS, ...Object.keys(P1_UNAVAILABLE)]);

const dec = Prisma.Decimal;

function unitOf(metricId: string): string {
  if (AMOUNT_METRICS.has(metricId)) return "currency";
  if (metricId === "roas") return "multiple";
  if (RATIO_METRICS.has(metricId)) return "ratio";
  return "count";
}

/** 真实本地日历日（YYYY-MM-DD 且确实存在，如 2026-02-30 拒绝） */
function parseLocalDate(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

function addDay(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

interface Agg {
  metricId: string;
  entityKey: string;
  availableDays: number;
  totalDays: number;
  value: Prisma.Decimal | null;
  numerator: Prisma.Decimal | null;
  denominator: Prisma.Decimal | null;
  sampleSize: bigint;
  status: "available" | "unavailable";
  unavailableReason: string | null;
  coverageStatus: "complete" | "partial" | "missing";
  maturity: "mature" | "provisional" | "not_applicable";
  currency: string | null;
  metricVersion: string;
  anyPartial: boolean;
  anyProvisional: boolean;
}

/** 范围聚合：金额/计数求和；比例与均值类（含客单价）重新汇总分子分母（不平均日比率）；实体间不合并 */
function aggregate(metricId: string, entityKey: string, rows: Array<{ status: string; coverageStatus: string; maturity: string; valueNumeric: Prisma.Decimal | null; numerator: Prisma.Decimal | null; denominator: Prisma.Decimal | null; sampleSize: bigint; unavailableReason: string | null; currency: string | null; metricVersion: string }>, rangeDays: number): Agg {
  const useNumDen = RATIO_METRICS.has(metricId) || metricId === "average_order_value";
  const isCount = COUNT_METRICS.has(metricId);
  let sum = new dec(0);
  let num = new dec(0);
  let den = new dec(0);
  let sample = 0n;
  let availableDays = 0;
  let anyPartial = false;
  let anyProvisional = false;
  let firstReason: string | null = null;
  let currency: string | null = null;
  let metricVersion = "v1";
  for (const r of rows) {
    metricVersion = r.metricVersion;
    if (r.currency) currency = r.currency;
    if (r.coverageStatus !== "complete") anyPartial = true;
    if (r.maturity === "provisional") anyProvisional = true;
    if (r.status !== "available") { firstReason ??= r.unavailableReason; continue; }
    availableDays += 1;
    if (useNumDen) {
      num = num.add(r.numerator ?? new dec(0));
      den = den.add(r.denominator ?? new dec(0));
    } else if (isCount) {
      sum = sum.add(new dec(r.sampleSize.toString()));
      sample += r.sampleSize;
    } else {
      sum = sum.add(r.valueNumeric ?? new dec(0));
      sample += r.sampleSize;
    }
  }
  let value: Prisma.Decimal | null = null;
  let status: "available" | "unavailable" = "unavailable";
  let reason: string | null = null;
  if (useNumDen) {
    if (availableDays > 0 && !den.isZero()) { value = num.div(den); status = "available"; }
    else { reason = availableDays > 0 ? "zero_denominator" : (firstReason ?? "no_available_data"); }
  } else {
    if (availableDays > 0) { value = sum; status = "available"; }
    else reason = firstReason ?? "no_available_data";
  }
  const completeCoverage = !anyPartial && rows.length === rangeDays && rows.length > 0;
  const coverageStatus: "complete" | "partial" | "missing" = completeCoverage ? "complete" : rows.length > 0 ? "partial" : "missing";
  const maturity: "mature" | "provisional" | "not_applicable" = rows.length === 0 ? "not_applicable" : anyProvisional ? "provisional" : "mature";
  return { metricId, entityKey, availableDays, totalDays: rows.length, value, numerator: useNumDen && status === "available" ? num : null, denominator: useNumDen && status === "available" ? den : null, sampleSize: sample, status, unavailableReason: reason, coverageStatus, maturity, currency, metricVersion, anyPartial, anyProvisional };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewBusinessData });
    const url = new URL(req.url);
    const storeId = url.searchParams.get("store_id") ?? "";
    const grain = url.searchParams.get("grain") ?? "day";
    const from = parseLocalDate(url.searchParams.get("from"));
    const to = parseLocalDate(url.searchParams.get("to"));
    const metricIds = (url.searchParams.get("metric_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!storeId) return fail(422, "缺少 store_id", { code: "VALIDATION_ERROR" });
    if (grain !== "day") return fail(422, "grain 仅支持 day", { code: "VALIDATION_ERROR" });
    // M02/C12：metric_ids 白名单校验，未知指标 422（不返回空 items 冒充成功）
    const unknown = metricIds.filter((m) => !KNOWN_METRICS.has(m));
    if (unknown.length > 0) {
      return fail(422, "未知 metric_ids", { code: "VALIDATION_ERROR", fieldErrors: Object.fromEntries(unknown.map((m) => ["metric_ids", `未知指标 ${m}`])) });
    }
    const db = getPrismaClient();
    const store = await db.store.findFirst({ where: { orgId: ctx.orgId, id: storeId }, select: { id: true, currency: true, timezone: true, datasetVersion: true, currentSnapshotVersion: true, currentSnapshotRulesetVersion: true, currentSnapshotEvaluationAt: true, snapshotStatus: true } });
    if (!store) return fail(404, "店铺不存在", { code: "NOT_FOUND" });
    if (store.currentSnapshotVersion == null || !store.currentSnapshotRulesetVersion || !store.currentSnapshotEvaluationAt) {
      return fail(503, "指标尚未准备（无已发布快照）", { code: "SNAPSHOT_NOT_READY" });
    }
    // 默认昨日完整自然日（店铺本地）；from/to 半开区间，≤90 天
    let rangeFrom = from;
    let rangeTo = to;
    if (!rangeFrom || !rangeTo) {
      const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: store.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const yesterday = addDay(todayLocal, -1);
      rangeFrom = from ?? yesterday;
      rangeTo = to ?? todayLocal;
    }
    if (rangeFrom >= rangeTo) return fail(422, "from 必须早于 to（本地日期半开区间）", { code: "VALIDATION_ERROR" });
    const rangeDays = Math.round((Date.parse(`${rangeTo}T00:00:00Z`) - Date.parse(`${rangeFrom}T00:00:00Z`)) / 86400000);
    if (rangeDays > 90) {
      return fail(422, "单次最大 90 天", { code: "VALIDATION_ERROR" });
    }

    // 同一发布身份一次读取（04 §11.1 步骤11）；请求窗口与等长前置基线窗口
    const published = { orgId: ctx.orgId, storeId, datasetVersion: store.currentSnapshotVersion, rulesetVersion: store.currentSnapshotRulesetVersion, evaluationAt: store.currentSnapshotEvaluationAt } as const;
    const windowWhere = {
      ...published,
      ...(metricIds.length ? { metricId: { in: metricIds } } : {}),
    };
    const currentRows = await db.dailyMetric.findMany({
      where: { ...windowWhere, periodStart: { gte: new Date(`${rangeFrom}T00:00:00Z`), lt: new Date(`${rangeTo}T00:00:00Z`) } },
      orderBy: [{ periodStart: "asc" }, { metricId: "asc" }, { entityKey: "asc" }],
      take: 2000,
    });
    const baselineFrom = addDay(rangeFrom, -rangeDays);
    const baselineRows = await db.dailyMetric.findMany({
      where: { ...windowWhere, periodStart: { gte: new Date(`${baselineFrom}T00:00:00Z`), lt: new Date(`${rangeFrom}T00:00:00Z`) } },
      orderBy: [{ periodStart: "asc" }, { metricId: "asc" }, { entityKey: "asc" }],
      take: 2000,
    });

    const groups = new Map<string, typeof currentRows>();
    for (const r of currentRows) {
      const key = `${r.metricId}\u0000${r.entityKey}`;
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    }
    const baseGroups = new Map<string, typeof baselineRows>();
    for (const r of baselineRows) {
      const key = `${r.metricId}\u0000${r.entityKey}`;
      const arr = baseGroups.get(key) ?? [];
      arr.push(r);
      baseGroups.set(key, arr);
    }

    const shapeValue = (metricId: string, v: Prisma.Decimal | null): string | number | null => {
      if (v == null) return null;
      if (AMOUNT_METRICS.has(metricId)) return v.toString();
      return Number.parseFloat(v.toString());
    };

    const metrics: Array<Record<string, unknown>> = [];
    for (const [key, rows] of groups) {
      const [metricId, entityKey] = key.split("\u0000");
      const agg = aggregate(metricId, entityKey, rows, rangeDays);
      const baseRows = baseGroups.get(key) ?? [];
      const baseAgg = aggregate(metricId, entityKey, baseRows, rangeDays);
      let baseline: Record<string, unknown> | null = null;
      if (baseRows.length > 0) {
        const comparable = baseAgg.status === "available" && agg.status === "available" && baseAgg.value !== null && !baseAgg.value.isZero();
        baseline = {
          value: shapeValue(metricId, baseAgg.value),
          change_ratio: comparable && agg.value !== null ? Number.parseFloat(agg.value.sub(baseAgg.value!).div(baseAgg.value!).toString()) : null,
          status: comparable ? "comparable" : baseAgg.value?.isZero() ? "zero_baseline" : "not_comparable",
          window: { from: baselineFrom, to: rangeFrom },
        };
      }
      metrics.push({
        metric_id: metricId,
        entity_key: entityKey,
        value: shapeValue(metricId, agg.value),
        unit: unitOf(metricId),
        currency: AMOUNT_METRICS.has(metricId) ? agg.currency : null,
        status: agg.status,
        coverage_status: agg.coverageStatus,
        maturity: agg.maturity,
        unavailable_reason: agg.unavailableReason,
        numerator: agg.numerator?.toString() ?? null,
        denominator: agg.denominator?.toString() ?? null,
        sample_size: Number(agg.sampleSize),
        available_days: agg.availableDays,
        metric_version: agg.metricVersion,
        baseline,
      });
    }

    // P1 指标的固定“未接入”占位（不落库、不造值）
    for (const [mid, reason] of Object.entries(P1_UNAVAILABLE)) {
      if (!metricIds.length || metricIds.includes(mid)) {
        metrics.push({
          metric_id: mid, entity_key: "store", value: null,
          unit: unitOf(mid), currency: null,
          status: "unavailable", coverage_status: "missing", maturity: "not_applicable",
          unavailable_reason: reason, numerator: null, denominator: null, sample_size: 0,
          available_days: 0, metric_version: "v1", baseline: null,
        });
      }
    }

    const series = currentRows.map((r) => ({
      metric_id: r.metricId,
      entity_key: r.entityKey,
      period_start: r.periodStart.toISOString().slice(0, 10),
      period_end: r.periodEnd.toISOString().slice(0, 10),
      value: r.status === "available" ? shapeValue(r.metricId, RATIO_METRICS.has(r.metricId) || AMOUNT_METRICS.has(r.metricId) ? r.valueNumeric : new dec(r.sampleSize.toString())) : null,
      unit: unitOf(r.metricId),
      currency: AMOUNT_METRICS.has(r.metricId) ? r.currency : null,
      status: r.status,
      coverage_status: r.coverageStatus,
      maturity: r.maturity,
      unavailable_reason: r.unavailableReason,
      numerator: r.numerator?.toString() ?? null,
      denominator: r.denominator?.toString() ?? null,
      sample_size: Number(r.sampleSize),
      metric_version: r.metricVersion,
    }));

    return ok(
      { metrics, series },
      {
        dataset_version: store.currentSnapshotVersion.toString(),
        latest_dataset_version: store.datasetVersion.toString(),
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
