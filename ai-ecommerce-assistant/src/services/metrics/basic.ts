/**
 * TASK-014｜基础经营与广告指标（确定性，05_METRIC_DEFINITIONS 唯一口径）。
 *
 * 用户功能：老板/经营页看到与已确认事实同版本的 GMV、付款订单数、销量、客单价、
 * 广告花费/归因销售额/ROAS——金额 Decimal 逐分可核算、缺源真零不混淆、
 * 归因组禁止跨组合并、零分母 unavailable 而非 0/Infinity。
 *
 * 合同：09_TASKS TASK-014；05 §6.1/6.2（gmv/paid_order_count/units_sold/
 * average_order_value/ad_spend/ad_sales/roas）；04 §11.3（按店铺完整重算现有覆盖期间、
 * 历史版本不可变）；12.8 黄金fixture为期望来源。P1 指标（ROI/转化率/库存等）不造值。
 * 作为 TASK-013 快照构建器的 metrics 完成标记注册方。
 */
import { Prisma } from "@/generated/prisma/client";
import { registerSnapshotBuilder, localDateOf, localInstantOf } from "@/services/snapshot";
import { upsertDailyMetric } from "./basic_out";

type Tx = Prisma.TransactionClient;

const METRIC_VERSION = "v1";
const MAX_AMOUNT = new Prisma.Decimal("99999999999999.999999");
const MAX_COUNT = 9007199254740991n;

function dayRange(tz: string, date: string): { start: Date; end: Date } {
  const start = localInstantOf(tz, date);
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start, end: localInstantOf(tz, next) };
}

function addDayStr(date: string, days = 1): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** 当前有效覆盖（≤目标版本的最新声明），04 §10.5 K5 读取口径 */
async function coverageByDate(
  tx: Tx,
  args: { orgId: string; storeId: string; dataSourceId: string; kind: "orders" | "ads"; channel: "default_channel" | "default"; date: string },
): Promise<"complete" | "partial" | "missing"> {
  const row = await tx.dataCoverage.findFirst({
    where: {
      orgId: args.orgId, storeId: args.storeId, dataSourceId: args.dataSourceId,
      sourceKind: args.kind, channel: "default_channel", coverageDate: new Date(`${args.date}T00:00:00Z`),
    },
    orderBy: { datasetVersion: "desc" },
    select: { status: true },
  });
  if (!row) return "missing";
  return row.status as "complete" | "partial" | "missing";
}

interface BasicMetricRow {
  metricId: string;
  entityKey: string;
  periodStart: string;
  valueNumeric: Prisma.Decimal | null;
  numerator: Prisma.Decimal | null;
  denominator: Prisma.Decimal | null;
  sampleSize: bigint;
  status: "available" | "unavailable";
  coverageStatus: "complete" | "partial" | "missing";
  unavailableReason: string | null;
  currency: string | null;
}

/**
 * 计算并写入一个店铺在目标事实版本下的全部基础经营/广告指标。
 * 按“现有覆盖期间”完整重算：订单付款日（含未付款下单日的缺失不计）与广告报告日。
 * 金额 Decimal 精确累加；越界 numeric_overflow 暂停该指标行（不截断、不中断整轮）。
 */
async function buildBasicMetrics(input: {
  orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string;
  evaluationAt: Date; tx: Tx;
}): Promise<void> {
  const { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, tx } = input;
  const store = await tx.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { timezone: true, currency: true },
  });
  const sources = await tx.dataSource.findMany({
    where: { orgId, storeId },
    select: { id: true, sourceNamespace: true },
  });

  const rows: BasicMetricRow[] = [];

  // ---- 经营：按订单付款本地日归期（unpaid/cancelled 无付款不计） ----
  const orders = await tx.order.findMany({
    where: { orgId, storeId },
    select: { id: true, paidAt: true, expectedItemCount: true, orderItems: { select: { quantity: true, itemPaidAmount: true } } },
  });
  const orderDays = new Map<string, {
    orderCount: bigint;
    gmv: Prisma.Decimal;
    units: bigint;
    incomplete: boolean;
  }>();
  for (const o of orders) {
    if (!o.paidAt) continue; // unpaid/cancelled 未付款不计入经营期
    const day = localDateOf(store.timezone, o.paidAt);
    const agg = orderDays.get(day) ?? { orderCount: 0n, gmv: new Prisma.Decimal(0), units: 0n, incomplete: false };
    agg.orderCount += 1n;
    for (const it of o.orderItems) {
      agg.gmv = agg.gmv.add(new Prisma.Decimal(it.itemPaidAmount.toString()));
      agg.units += BigInt(it.quantity);
    }
    if (o.orderItems.length < o.expectedItemCount) agg.incomplete = true; // 缺行：金额按已知行展示、覆盖partial
    orderDays.set(day, agg);
  }
  // H02：覆盖声明日历驱动——显式零/完整覆盖日也生成指标行（含真零GMV/数量/客单价）
  const declaredOrderDays = new Set<string>();
  for (const src of sources) {
    const covs = await tx.dataCoverage.findMany({
      where: {
        orgId, storeId, dataSourceId: src.id, sourceKind: "orders", channel: "default_channel",
      },
      select: { coverageDate: true, status: true },
      orderBy: { datasetVersion: "desc" },
    });
    const seen = new Set<string>();
    for (const c of covs) {
      const d = c.coverageDate.toISOString().slice(0, 10);
      if (!seen.has(d)) { seen.add(d); declaredOrderDays.add(d); }
    }
  }
  for (const day of declaredOrderDays) {
    if (!orderDays.has(day)) {
      orderDays.set(day, { orderCount: 0n, gmv: new Prisma.Decimal(0), units: 0n, incomplete: false });
    }
  }

  for (const [day, agg] of orderDays) {
    let coverage: "complete" | "partial" | "missing" = "missing";
    for (const src of sources) {
      const c = await coverageByDate(tx, { orgId, storeId, dataSourceId: src.id, kind: "orders", channel: "default_channel", date: day });
      if (c === "complete") { coverage = "complete"; break; }
      if (c === "partial") coverage = "partial";
    }
    if (agg.incomplete && coverage === "complete") coverage = "partial"; // 缺行强制partial（不能把部分行当完整GMV）
    const overflow = agg.gmv.gt(MAX_AMOUNT) || agg.units > MAX_COUNT;
    rows.push({
      metricId: "gmv", entityKey: "store", periodStart: day,
      valueNumeric: overflow ? null : agg.gmv, numerator: null, denominator: null,
      sampleSize: agg.orderCount, status: overflow ? "unavailable" : "available",
      coverageStatus: coverage, unavailableReason: overflow ? "numeric_overflow" : null, currency: store.currency,
    });
    rows.push({
      metricId: "paid_order_count", entityKey: "store", periodStart: day,
      valueNumeric: null, numerator: null, denominator: null,
      sampleSize: agg.orderCount, status: "available", coverageStatus: coverage,
      unavailableReason: null, currency: null,
    });
    rows.push({
      metricId: "units_sold", entityKey: "store", periodStart: day,
      valueNumeric: null, numerator: null, denominator: null,
      sampleSize: agg.units, status: agg.units > MAX_COUNT ? "unavailable" : "available",
      coverageStatus: coverage, unavailableReason: agg.units > MAX_COUNT ? "numeric_overflow" : null, currency: null,
    });
    const aov = agg.orderCount === 0n
      ? null
      : agg.gmv.div(new Prisma.Decimal(agg.orderCount.toString()));
    rows.push({
      metricId: "average_order_value", entityKey: "store", periodStart: day,
      valueNumeric: aov, numerator: agg.orderCount === 0n ? null : agg.gmv,
      denominator: agg.orderCount === 0n ? null : new Prisma.Decimal(agg.orderCount.toString()),
      sampleSize: agg.orderCount,
      status: agg.orderCount === 0n ? "unavailable" : "available",
      coverageStatus: coverage,
      unavailableReason: agg.orderCount === 0n ? "zero_denominator" : null, currency: store.currency,
    });
  }

  // ---- 广告：按 report_date×归因组（model/window）分列，禁止跨组合并 ----
  const ads = await tx.adMetric.findMany({
    where: { orgId, storeId },
    select: { reportDate: true, attributionModel: true, attributionWindowDays: true, spend: true, attributedSales: true, currency: true },
  });
  const adGroups = new Map<string, { day: string; model: string; window: number; spend: Prisma.Decimal; sales: Prisma.Decimal }>();
  for (const a of ads) {
    const day = a.reportDate.toISOString().slice(0, 10);
    const key = `${day}\u0000${a.attributionModel}\u0000${a.attributionWindowDays}`;
    const agg = adGroups.get(key) ?? {
      day, model: a.attributionModel, window: a.attributionWindowDays,
      spend: new Prisma.Decimal(0), sales: new Prisma.Decimal(0),
    };
    agg.spend = agg.spend.add(new Prisma.Decimal(a.spend.toString()));
    agg.sales = agg.sales.add(new Prisma.Decimal(a.attributedSales.toString()));
    adGroups.set(key, agg);
  }
  // H02：广告声明日历驱动（显式零/完整覆盖日也生成行）
  const declaredAdDays = new Map<string, Set<string>>(); // day -> entityKeys
  for (const src of sources) {
    const covs = await tx.dataCoverage.findMany({
      where: { orgId, storeId, dataSourceId: src.id, sourceKind: "ads", channel: "default_channel" },
      select: { coverageDate: true, status: true },
      orderBy: { datasetVersion: "desc" },
    });
    const seen = new Set<string>();
    for (const c of covs) {
      const d = c.coverageDate.toISOString().slice(0, 10);
      if (!seen.has(d)) { seen.add(d); declaredAdDays.set(d, new Set()); }
    }
  }
  // 为声明日但无事实的日：沿用最近归因组的entityKey（或"ads:default"占位）——只对已有组生成零行
  for (const g of adGroups.values()) {
    for (const [day] of declaredAdDays) {
      const key = `${day}\u0000${g.model}\u0000${g.window}`;
      if (!adGroups.has(key)) {
        adGroups.set(key, { day, model: g.model, window: g.window, spend: new Prisma.Decimal(0), sales: new Prisma.Decimal(0) });
      }
    }
  }

  for (const g of adGroups.values()) {
    let coverage: "complete" | "partial" | "missing" = "missing";
    for (const src of sources) {
      const c = await coverageByDate(tx, { orgId, storeId, dataSourceId: src.id, kind: "ads", channel: "default_channel", date: g.day });
      if (c === "complete") { coverage = "complete"; break; }
      if (c === "partial") coverage = "partial";
    }
    const entityKey = `ads:${g.model}:${g.window}`;
    const spendOver = g.spend.gt(MAX_AMOUNT);
    const salesOver = g.sales.gt(MAX_AMOUNT);
    rows.push({
      metricId: "ad_spend", entityKey, periodStart: g.day,
      valueNumeric: spendOver ? null : g.spend, numerator: null, denominator: null,
      sampleSize: 0n, status: spendOver ? "unavailable" : "available",
      coverageStatus: coverage, unavailableReason: spendOver ? "numeric_overflow" : null, currency: store.currency,
    });
    rows.push({
      metricId: "ad_sales", entityKey, periodStart: g.day,
      valueNumeric: salesOver ? null : g.sales, numerator: null, denominator: null,
      sampleSize: 0n, status: salesOver ? "unavailable" : "available",
      coverageStatus: coverage, unavailableReason: salesOver ? "numeric_overflow" : null, currency: store.currency,
    });
    const zeroSpend = g.spend.isZero();
    rows.push({
      metricId: "roas", entityKey, periodStart: g.day,
      valueNumeric: zeroSpend ? null : g.sales.div(g.spend),
      numerator: zeroSpend ? null : g.sales, denominator: zeroSpend ? null : g.spend,
      sampleSize: 0n, status: zeroSpend ? "unavailable" : "available",
      coverageStatus: coverage, unavailableReason: zeroSpend ? "zero_denominator" : null, currency: null,
    });
  }

  // ---- 写入：共享版本化 upsert（同版本幂等；历史版本不可变） ----
  for (const r of rows) {
    await upsertDailyMetric(tx, {
      orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, metricVersion: METRIC_VERSION,
      metricId: r.metricId, entityKey: r.entityKey, periodStart: r.periodStart,
      valueNumeric: r.valueNumeric, numerator: r.numerator, denominator: r.denominator,
      sampleSize: r.sampleSize, status: r.status, coverageStatus: r.coverageStatus,
      unavailableReason: r.unavailableReason, currency: r.currency,
    });
  }
}

/** TASK-013 完成标记注册：metrics 构建器 */
export function registerBasicMetricsBuilder(): void {
  registerSnapshotBuilder("metrics", {
    build: async (input) => {
      await buildBasicMetrics({
        orgId: input.orgId, storeId: input.storeId,
        datasetVersion: input.datasetVersion, rulesetVersion: input.rulesetVersion,
        evaluationAt: input.evaluationAt, tx: input.tx,
      });
    },
  });
}
