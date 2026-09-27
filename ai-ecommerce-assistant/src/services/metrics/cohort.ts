/**
 * TASK-015｜退款与售后队列指标（确定性，05 §6.1/6.2 唯一口径）。
 *
 * 用户功能：老板看到“哪个付款批次的退款/售后真的高”——事件日退款金额、
 * D+7 成熟队列订单退款率/SKU 退件率/售后率（provisional 未成熟不参与报警）、
 * 退款事件金额比（现金事件观察值，禁止标成退款率）。
 *
 * 口径要点：队列=同一付款本地日的订单集合；每笔订单观察窗 [paid_at, paid_at+7d)；
 * 窗外退款计入事件日金额但不倒灌 D+7 分子；SKU 退件按订单行取窗内成功事件
 * refunded_quantity_cumulative 最大值（每行最多销售 quantity）；case 以 occurred_at
 * 入窗（状态含申请中/结案/驳回）；成熟=队列最晚一笔的窗已结束且相关渠道覆盖完整；
 * 分母 0 → unavailable/zero_denominator；金额 Decimal。
 * 注册为 TASK-013 快照构建器的 cohort 完成标记。
 */
import { Prisma } from "@/generated/prisma/client";
import { registerSnapshotBuilder, localDateOf } from "@/services/snapshot";
import { upsertDailyMetric } from "./basic_out";

type Tx = Prisma.TransactionClient;

const METRIC_VERSION = "v1";
const WINDOW_DAYS = 7;

function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86400000);
}

/** 渠道在 [from,to) 每日均有 complete 覆盖声明（04 §10.5：D7 需窗内全部日覆盖） */
async function channelCoveredEveryDay(
  tx: Tx,
  args: { orgId: string; storeId: string; kind: "after_sales"; channelKey: "refund_channel" | "case_channel"; from: string; to: string },
): Promise<"complete" | "partial" | "missing"> {
  const rows = await tx.dataCoverage.findMany({
    where: {
      orgId: args.orgId, storeId: args.storeId,
      sourceKind: args.kind, channel: args.channelKey,
      coverageDate: { gte: new Date(`${args.from}T00:00:00Z`), lt: new Date(`${args.to}T00:00:00Z`) },
    },
    select: { coverageDate: true, status: true, datasetVersion: true },
    orderBy: { datasetVersion: "desc" },
  });
  const byDate = new Map<string, "complete" | "partial">();
  for (const r of rows) {
    const d = r.coverageDate.toISOString().slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, r.status as "complete" | "partial");
  }
  const totalDays = Math.round((Date.parse(`${args.to}T00:00:00Z`) - Date.parse(`${args.from}T00:00:00Z`)) / 86400000);
  let any = false;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(Date.parse(`${args.from}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    const st = byDate.get(d);
    if (st === "complete") { any = true; continue; }
    if (st === "partial") return "partial";
    return "partial"; // 窗内某日缺声明 → 不能算完整（missing 与 partial 都不允许报警）
  }
  return any ? "complete" : "partial";
}

async function ordersCoverage(tx: Tx, args: { orgId: string; storeId: string; dataSourceIds: string[]; date: string }): Promise<"complete" | "partial" | "missing"> {
  let result: "complete" | "partial" | "missing" = "missing";
  for (const dsId of args.dataSourceIds) {
    const row = await tx.dataCoverage.findFirst({
      where: { orgId: args.orgId, storeId: args.storeId, dataSourceId: dsId, sourceKind: "orders", channel: "default_channel", coverageDate: new Date(`${args.date}T00:00:00Z`) },
      orderBy: { datasetVersion: "desc" },
      select: { status: true },
    });
    if (row?.status === "complete") return "complete";
    if (row?.status === "partial") result = "partial";
  }
  return result;
}

export async function buildCohortMetrics(input: {
  orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string;
  evaluationAt: Date; tx: Tx;
}): Promise<void> {
  const { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, tx } = input;
  const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { timezone: true, currency: true } });
  const sources = await tx.dataSource.findMany({ where: { orgId, storeId }, select: { id: true } });
  const dataSourceIds = sources.map((s) => s.id);

  const orders = await tx.order.findMany({
    where: { orgId, storeId },
    select: {
      id: true, paidAt: true,
      orderItems: { select: { id: true, quantity: true } },
    },
  });
  const paidOrders = orders.filter((o) => o.paidAt);
  const refunds = await tx.refundEvent.findMany({
    where: { orgId, storeId, status: "succeeded" },
    select: { orderItemId: true, orderId: true, refundAmount: true, refundedQuantityCumulative: true, completedAt: true, occurredAt: true },
  });
  const cases = await tx.afterSaleRecord.findMany({
    where: { orgId, storeId },
    select: { orderId: true, occurredAt: true },
  });
  const gmvByDay = new Map<string, Prisma.Decimal>();
  const gmvRows = await tx.order.findMany({
    where: { orgId, storeId },
    select: { paidAt: true, orderItems: { select: { itemPaidAmount: true } } },
  });
  for (const o of gmvRows) {
    if (!o.paidAt) continue;
    const d = localDateOf(store.timezone, o.paidAt);
    const acc = gmvByDay.get(d) ?? new Prisma.Decimal(0);
    gmvByDay.set(d, o.orderItems.reduce((s, it) => s.add(new Prisma.Decimal(it.itemPaidAmount.toString())), acc));
  }

  // ---- 事件日退款金额（succeeded 按 completedAt 本地日） + 退款事件金额比 ----
  const refundByDay = new Map<string, Prisma.Decimal>();
  for (const r of refunds) {
    const at = r.completedAt ?? r.occurredAt;
    if (!at) continue;
    const d = localDateOf(store.timezone, at);
    const acc = refundByDay.get(d) ?? new Prisma.Decimal(0);
    refundByDay.set(d, acc.add(new Prisma.Decimal(r.refundAmount?.toString() ?? "0")));
  }
  for (const [day, amount] of refundByDay) {
    let coverage: "complete" | "partial" | "missing" = "missing";
    for (const dsId of dataSourceIds) {
      const row = await tx.dataCoverage.findFirst({
        where: { orgId, storeId, dataSourceId: dsId, sourceKind: "after_sales", channel: "refund_channel", coverageDate: new Date(`${day}T00:00:00Z`) },
        orderBy: { datasetVersion: "desc" }, select: { status: true },
      });
      if (row?.status === "complete") { coverage = "complete"; break; }
      if (row?.status === "partial") coverage = "partial";
    }
    await upsertDailyMetric(tx, {
      orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, metricVersion: METRIC_VERSION,
      metricId: "refund_amount", entityKey: "store", periodStart: day,
      valueNumeric: amount, numerator: null, denominator: null, sampleSize: 0n,
      status: "available", coverageStatus: coverage, unavailableReason: null, currency: store.currency,
    });
    const gmv = gmvByDay.get(day) ?? new Prisma.Decimal(0);
    const zero = gmv.isZero();
    await upsertDailyMetric(tx, {
      orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, metricVersion: METRIC_VERSION,
      metricId: "refund_event_amount_ratio", entityKey: "store", periodStart: day,
      valueNumeric: zero ? null : amount.div(gmv),
      numerator: zero ? null : amount, denominator: zero ? null : gmv, sampleSize: 0n,
      status: zero ? "unavailable" : "available", coverageStatus: coverage,
      unavailableReason: zero ? "zero_denominator" : null, currency: null,
    });
  }

  // ---- D+7 队列指标：按付款本地日分队列 ----
  const cohorts = new Map<string, typeof paidOrders>();
  for (const o of paidOrders) {
    const d = localDateOf(store.timezone, o.paidAt!);
    const arr = cohorts.get(d) ?? [];
    arr.push(o);
    cohorts.set(d, arr);
  }
  for (const [day, cohort] of cohorts) {
    const ordersCov = await ordersCoverage(tx, { orgId, storeId, dataSourceIds, date: day });
    // 成熟：队列最晚一笔的观察窗在评估时点前已结束（不依赖覆盖；覆盖只影响 complete/partial）
    const latestPaid = cohort.reduce((m, o) => (o.paidAt! > m ? o.paidAt! : m), cohort[0].paidAt!);
    const windowEnd = addDays(latestPaid, WINDOW_DAYS);
    const maturity = evaluationAt >= windowEnd ? "mature" : "provisional";

    let refundCov: "complete" | "partial" | "missing" = "complete";
    if (maturity === "mature") {
      refundCov = await channelCoveredEveryDay(tx, { orgId, storeId, kind: "after_sales", channelKey: "refund_channel", from: day, to: new Date(Date.parse(`${day}T00:00:00Z`) + (WINDOW_DAYS + 1) * 86400000).toISOString().slice(0, 10) });
    }
    let caseCov: "complete" | "partial" | "missing" = "complete";
    if (maturity === "mature") {
      caseCov = await channelCoveredEveryDay(tx, { orgId, storeId, kind: "after_sales", channelKey: "case_channel", from: day, to: new Date(Date.parse(`${day}T00:00:00Z`) + (WINDOW_DAYS + 1) * 86400000).toISOString().slice(0, 10) });
    }
    const rateCoverage = (c: "complete" | "partial" | "missing") =>
      ordersCov === "complete" && c === "complete" ? "complete" : (ordersCov === "missing" && c !== "complete" ? "missing" : "partial");

    // 订单退款率：窗内至少一次成功退款的去重订单数 / 队列付款订单数
    let refundedOrders = 0;
    for (const o of cohort) {
      const end = addDays(o.paidAt!, WINDOW_DAYS);
      const hit = refunds.some((r) => r.orderId === o.id && r.completedAt && r.completedAt >= o.paidAt! && r.completedAt < end);
      if (hit) refundedOrders += 1;
    }
    const denomOrders = BigInt(cohort.length);
    const zeroOrders = denomOrders === 0n;
    await upsertDailyMetric(tx, {
      orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, metricVersion: METRIC_VERSION,
      metricId: "order_refund_rate_d7", entityKey: "store", periodStart: day,
      valueNumeric: zeroOrders ? null : new Prisma.Decimal(refundedOrders).div(new Prisma.Decimal(denomOrders.toString())),
      numerator: zeroOrders ? null : new Prisma.Decimal(refundedOrders),
      denominator: zeroOrders ? null : new Prisma.Decimal(denomOrders.toString()),
      sampleSize: denomOrders,
      status: zeroOrders ? "unavailable" : "available",
      coverageStatus: rateCoverage(refundCov),
      unavailableReason: zeroOrders ? "zero_denominator" : null, currency: null,
      maturity,
    });

    // SKU 退件率（店铺级=分子分母重新汇总）：Σ行窗内 max(累计退件) / Σ行销量
    let qtyNumerator = 0;
    let qtyDenominator = 0;
    for (const o of cohort) {
      const end = addDays(o.paidAt!, WINDOW_DAYS);
      for (const item of o.orderItems) {
        qtyDenominator += item.quantity;
        let maxCum = 0;
        for (const r of refunds) {
          if (r.orderItemId !== item.id || !r.completedAt || r.completedAt < o.paidAt! || r.completedAt >= end) continue;
          maxCum = Math.max(maxCum, r.refundedQuantityCumulative ?? 0);
        }
        qtyNumerator += Math.min(maxCum, item.quantity); // 每行最多销售 quantity
      }
    }
    const zeroQty = qtyDenominator === 0;
    await upsertDailyMetric(tx, {
      orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, metricVersion: METRIC_VERSION,
      metricId: "sku_refund_rate_d7", entityKey: "store", periodStart: day,
      valueNumeric: zeroQty ? null : new Prisma.Decimal(qtyNumerator).div(new Prisma.Decimal(qtyDenominator)),
      numerator: zeroQty ? null : new Prisma.Decimal(qtyNumerator),
      denominator: zeroQty ? null : new Prisma.Decimal(qtyDenominator),
      sampleSize: BigInt(qtyDenominator),
      status: zeroQty ? "unavailable" : "available",
      coverageStatus: rateCoverage(refundCov),
      unavailableReason: zeroQty ? "zero_denominator" : null, currency: null,
      maturity,
    });

    // 售后率：窗内至少一条 case 的去重订单数 / 队列付款订单数
    let caseOrders = 0;
    for (const o of cohort) {
      const end = addDays(o.paidAt!, WINDOW_DAYS);
      const hit = cases.some((c) => c.orderId === o.id && c.occurredAt >= o.paidAt! && c.occurredAt < end);
      if (hit) caseOrders += 1;
    }
    await upsertDailyMetric(tx, {
      orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, metricVersion: METRIC_VERSION,
      metricId: "after_sale_rate_d7", entityKey: "store", periodStart: day,
      valueNumeric: zeroOrders ? null : new Prisma.Decimal(caseOrders).div(new Prisma.Decimal(denomOrders.toString())),
      numerator: zeroOrders ? null : new Prisma.Decimal(caseOrders),
      denominator: zeroOrders ? null : new Prisma.Decimal(denomOrders.toString()),
      sampleSize: denomOrders,
      status: zeroOrders ? "unavailable" : "available",
      coverageStatus: rateCoverage(caseCov),
      unavailableReason: zeroOrders ? "zero_denominator" : null, currency: null,
      maturity,
    });
  }
}

export function registerCohortMetricsBuilder(): void {
  registerSnapshotBuilder("cohort", {
    build: async (input) => {
      await buildCohortMetrics({
        orgId: input.orgId, storeId: input.storeId,
        datasetVersion: input.datasetVersion, rulesetVersion: input.rulesetVersion,
        evaluationAt: input.evaluationAt, tx: input.tx,
      });
    },
  });
}
