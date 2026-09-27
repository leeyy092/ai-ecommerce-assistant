/**
 * TASK-016｜确定性异常规则引擎（G4R1修复版）。
 * H04：数量读sampleSize+真正同星期基准+7日回退≥7；H05：R03/R10全部门槛；
 * H06：恢复全部P0规则含SKU级R07、R05/R12有配置、R08双通道、R09用有效分类；
 * H07：按Store实际rulesetVersion/ruleVersion读写。
 */
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { registerSnapshotBuilder, localDateOf } from "@/services/snapshot";

type Tx = Prisma.TransactionClient;
export const RULE_VERSION = 1;
export const DEFAULT_RULE_PARAMS: Record<string, Prisma.InputJsonValue> = {
  R01: { min_baseline: 20, drop_ratio: 0.30, drop_abs: 10, critical_ratio: 0.50, critical_abs: 30 },
  R02: { min_baseline: 20, rise_ratio: 0.50, rise_abs: 20, zero_day_needed: 7, zero_rise_abs: 30 },
  R03: { min_orders: 30, min_refund_orders: 5, rate_min: 0.10, diff_pp: 5, critical_rate: 0.20, critical_orders: 10, min_history_denom: 100 },
  R04: {},
  R05: {},
  R06: {},
  R07: { min_baseline_units: 10, units_drop_ratio: 0.40, units_drop_abs: 5, amount_drop_ratio: 0.30, critical_units_ratio: 0.70, critical_units_abs: 20 },
  R08: { min_count: 10, rise_ratio: 1.0, rise_abs: 5, zero_day_needed: 7, critical_count: 30, critical_ratio: 2.0 },
  R09: { min_known: 30, min_coverage: 0.80, min_negative: 10, rate_up_pp: 15, critical_pp: 30, critical_negative: 30 },
  R10: { min_sold: 20, min_refunded: 5, rate_min: 0.15, diff_pp: 8, min_history_units: 50, critical_rate: 0.30, critical_refunded: 10 },
  R11: {},
  R12: {},
};
export const ALWAYS_DISABLED = new Set(["R04", "R06"]);

function fp(ev: unknown): string { return createHash("sha256").update(JSON.stringify(ev)).digest("hex"); }
function addDay(d: string, n: number): string { return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
function num(p: Record<string, unknown>, k: string, f: number): number { const v = p[k]; return typeof v === "number" ? v : f; }

/** H04：真正同星期——前28日同星期最多4个完整日；不足3→7日回退需≥7个完整日 */
export function medianBaseline(series: Array<{ date: string; value: Prisma.Decimal }>, targetDate: string): { baseline: Prisma.Decimal | null; samples: Array<{ date: string; value: Prisma.Decimal }> } {
  const targetDow = new Date(`${targetDate}T00:00:00Z`).getUTCDay();
  const byDate = new Map(series.map((s) => [s.date, s.value]));
  const sameDow: Array<{ date: string; value: Prisma.Decimal }> = [];
  for (let i = 1; i <= 28 && sameDow.length < 4; i++) {
    const d = addDay(targetDate, -i);
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === targetDow) { const v = byDate.get(d); if (v !== undefined) sameDow.push({ date: d, value: v }); }
  }
  if (sameDow.length >= 3) { const s = [...sameDow.map((x) => x.value)].sort((a, b) => a.comparedTo(b)); const m = Math.floor(s.length / 2); return { baseline: s.length % 2 ? s[m] : s[m - 1].add(s[m]).div(2), samples: sameDow }; }
  const recent: Array<{ date: string; value: Prisma.Decimal }> = [];
  for (let i = 1; i <= 7; i++) { const d = addDay(targetDate, -i); const v = byDate.get(d); if (v !== undefined) recent.push({ date: d, value: v }); }
  if (recent.length >= 7) { const s = [...recent.map((x) => x.value)].sort((a, b) => a.comparedTo(b)); const m = Math.floor(s.length / 2); return { baseline: s.length % 2 ? s[m] : s[m - 1].add(s[m]).div(2), samples: recent }; }
  return { baseline: null, samples: sameDow.length >= 3 ? sameDow : recent };
}

interface AlertInfo { severity: "info" | "warning" | "critical"; title: string; category: "data_quality" | "sku" | "advertising" | "customer_service" | "after_sales"; }

async function writeEval(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date; ruleId: string; ruleVersion: number; entityKey: string; subchannel: string; periodStart: string; status: "triggered" | "not_triggered" | "suppressed"; reasonCode?: string | null; sampleSize: bigint; threshold: unknown; evidence: unknown; alert?: AlertInfo | null; }): Promise<void> {
  const pd = new Date(`${a.periodStart}T00:00:00Z`);
  const th = a.threshold as Prisma.InputJsonValue; const ev = a.evidence as Prisma.InputJsonValue;
  const w = { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, ruleVersion: a.ruleVersion, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion };
  await tx.ruleEvaluation.upsert({
    where: { orgId_storeId_ruleId_ruleVersion_entityKey_subchannel_periodStart_periodEnd_datasetVersion_rulesetVersion: w },
    create: { ...w, status: a.status, reasonCode: a.reasonCode ?? null, sampleSize: a.sampleSize, threshold: th, evidence: ev, evaluationAt: a.evaluationAt },
    update: { status: a.status, reasonCode: a.reasonCode ?? null, sampleSize: a.sampleSize, threshold: th, evidence: ev, evaluationAt: a.evaluationAt },
  });
  if (a.status === "triggered" && a.alert) {
    await tx.alert.upsert({
      where: { orgId_storeId_ruleId_entityKey_subchannel_periodStart_periodEnd_ruleVersion_datasetVersion_rulesetVersion: { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, ruleVersion: a.ruleVersion, datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion } },
      create: { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, ruleVersion: a.ruleVersion, rulesetVersion: a.rulesetVersion, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, severity: a.alert.severity, title: a.alert.title, category: a.alert.category, evidence: ev, evidenceFingerprint: fp(a.evidence), datasetVersion: a.datasetVersion, evaluationAt: a.evaluationAt },
      update: { severity: a.alert.severity, title: a.alert.title, evidence: ev, evidenceFingerprint: fp(a.evidence), evaluationAt: a.evaluationAt },
    });
  }
}

async function mSeries(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string }, metricId: string, entityKey = "store"): Promise<Array<{ date: string; value: Prisma.Decimal; sampleSize: bigint; coverage: string; maturity: string; numerator: Prisma.Decimal | null }>> {
  const rows = await tx.dailyMetric.findMany({ where: { orgId: a.orgId, storeId: a.storeId, metricId, entityKey, datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion }, orderBy: { periodStart: "asc" } });
  return rows.map((r) => ({ date: r.periodStart.toISOString().slice(0, 10), value: r.valueNumeric ?? new Prisma.Decimal(0), sampleSize: r.sampleSize, coverage: r.coverageStatus, maturity: r.maturity, numerator: r.numerator }));
}

async function getConfigs(tx: Tx, orgId: string, storeId: string, rsv: string): Promise<Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>> {
  const result = new Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>();
  for (const rid of ["R01","R02","R03","R04","R05","R06","R07","R08","R09","R10","R11","R12"]) {
    const ex = await tx.ruleConfig.findFirst({ where: { orgId, storeId, rulesetVersion: rsv, ruleId: rid }, orderBy: { ruleVersion: "desc" } });
    if (ex) result.set(rid, { enabled: ex.enabled, parameters: ex.parameters as Record<string, unknown>, ruleVersion: ex.ruleVersion });
    else { const c = await tx.ruleConfig.create({ data: { orgId, storeId, ruleId: rid, ruleVersion: RULE_VERSION, rulesetVersion: rsv, enabled: !ALWAYS_DISABLED.has(rid), parameters: DEFAULT_RULE_PARAMS[rid] ?? {} } }); result.set(rid, { enabled: c.enabled, parameters: c.parameters as Record<string, unknown>, ruleVersion: c.ruleVersion }); }
  }
  return result;
}

// H04：R01/R02 数量读sampleSize
async function evalUnits(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>, ruleId: "R01" | "R02"): Promise<void> {
  const cfg = cfgs.get(ruleId); if (!cfg) return;
  const series = (await mSeries(tx, a, "units_sold")).filter((s) => s.coverage === "complete");
  const latest = series.at(-1); if (!latest) return;
  const latestCount = new Prisma.Decimal(latest.sampleSize.toString());
  if (!cfg.enabled) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: latest.date, status: "suppressed", reasonCode: "disabled_by_config", sampleSize: latest.sampleSize, threshold: cfg.parameters, evidence: { current: latest.sampleSize.toString() } }); return; }
  const { baseline, samples } = medianBaseline(series.map((s) => ({ date: s.date, value: new Prisma.Decimal(s.sampleSize.toString()) })), latest.date);
  if (baseline === null) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: latest.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: BigInt(samples.length), threshold: cfg.parameters, evidence: { current: latestCount.toString(), samples: samples.length } }); return; }
  const p = cfg.parameters;
  if (ruleId === "R01") {
    if (baseline.lt(new Prisma.Decimal(num(p, "min_baseline", 20)))) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: latest.date, status: "not_triggered", reasonCode: "baseline_below_min", sampleSize: latest.sampleSize, threshold: p, evidence: { baseline: baseline.toString(), current: latestCount.toString() } }); return; }
    const chg = latestCount.sub(baseline).div(baseline); const drop = baseline.sub(latestCount);
    const isDrop = chg.toNumber() <= -num(p, "drop_ratio", 0.30) && drop.gte(new Prisma.Decimal(num(p, "drop_abs", 10)));
    const isCrit = chg.toNumber() <= -num(p, "critical_ratio", 0.50) && drop.gte(new Prisma.Decimal(num(p, "critical_abs", 30)));
    await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: latest.date, status: isDrop ? "triggered" : "not_triggered", sampleSize: latest.sampleSize, threshold: p, evidence: { baseline: baseline.toString(), current: latestCount.toString(), change_ratio: chg.toString(), samples: samples.map((x) => ({ date: x.date, value: x.value.toString() })) }, alert: isDrop ? { severity: isCrit ? "critical" : "warning", title: `销量${isCrit ? "大幅" : ""}下降：${latest.sampleSize}件 vs 基准${baseline.toString()}件`, category: "sku" } : null });
  } else {
    const rise = latestCount.sub(baseline); let trig = false;
    if (baseline.isZero()) { const zd = samples.filter((x) => x.value.isZero()).length; trig = zd >= num(p, "zero_day_needed", 7) && rise.gte(new Prisma.Decimal(num(p, "zero_rise_abs", 30))); }
    else if (baseline.gte(new Prisma.Decimal(num(p, "min_baseline", 20)))) { trig = rise.div(baseline).toNumber() >= num(p, "rise_ratio", 0.50) && rise.gte(new Prisma.Decimal(num(p, "rise_abs", 20))); }
    await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: latest.date, status: trig ? "triggered" : "not_triggered", sampleSize: latest.sampleSize, threshold: p, evidence: { baseline: baseline.toString(), current: latestCount.toString(), rise_abs: rise.toString() }, alert: trig ? { severity: "info", title: `销量上涨：${latest.sampleSize}件 vs 基准${baseline.toString()}件`, category: "sku" } : null });
  }
}

// H06：R07 SKU级
async function evalSku(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R07"); if (!cfg?.enabled) return; const p = cfg.parameters;
  const skus = await tx.sKU.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { id: true, externalSkuId: true } });
  const orders = await tx.order.findMany({ where: { orgId: a.orgId, storeId: a.storeId, paidAt: { not: null } }, select: { id: true, paidAt: true } });
  const od = new Map(orders.map((o) => [o.id, o.paidAt!]));
  for (const sku of skus) {
    const items = await tx.orderItem.findMany({ where: { orgId: a.orgId, storeId: a.storeId, skuId: sku.id, order: { paidAt: { not: null } } }, select: { quantity: true, itemPaidAmount: true, orderId: true } });
    const byDay = new Map<string, { units: bigint; amount: Prisma.Decimal }>();
    for (const it of items) { const d = localDateOf("UTC", od.get(it.orderId)!); const g = byDay.get(d) ?? { units: 0n, amount: new Prisma.Decimal(0) }; g.units += BigInt(it.quantity); g.amount = g.amount.add(new Prisma.Decimal(it.itemPaidAmount.toString())); byDay.set(d, g); }
    const days = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y)); const latest = days.at(-1); if (!latest) continue;
    const [ld, la] = latest;
    const uS = days.map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v.units.toString()) }));
    const aS = days.map(([d, v]) => ({ date: d, value: v.amount }));
    const { baseline: ub } = medianBaseline(uS, ld); const { baseline: ab } = medianBaseline(aS, ld);
    if (ub === null || ab === null) { await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey: `sku:${sku.externalSkuId}`, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "insufficient_history", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId } }); continue; }
    if (ub.lt(new Prisma.Decimal(num(p, "min_baseline_units", 10)))) { await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey: `sku:${sku.externalSkuId}`, subchannel: "default", periodStart: ld, status: "not_triggered", reasonCode: "baseline_below_min", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId, baseline_units: ub.toString() } }); continue; }
    const ud = ub.sub(new Prisma.Decimal(la.units.toString())); const ad = ab.sub(la.amount);
    const udr = ud.div(ub).toNumber(); const adr = ab.isZero() ? 0 : ad.div(ab).toNumber();
    const trig = udr >= num(p, "units_drop_ratio", 0.40) && ud.gte(new Prisma.Decimal(num(p, "units_drop_abs", 5))) && adr >= num(p, "amount_drop_ratio", 0.30);
    const crit = udr >= num(p, "critical_units_ratio", 0.70) && ud.gte(new Prisma.Decimal(num(p, "critical_units_abs", 20)));
    await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey: `sku:${sku.externalSkuId}`, subchannel: "default", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId, baseline_units: ub.toString(), current_units: la.units.toString(), baseline_amount: ab.toString(), current_amount: la.amount.toString() }, alert: trig ? { severity: crit ? "critical" : "warning", title: `SKU ${sku.externalSkuId} 销量销售额双降`, category: "sku" } : null });
  }
}

// H05：R03/R10全部门槛
async function evalRefund(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const c3 = cfgs.get("R03");
  const mr = (await mSeries(tx, a, "order_refund_rate_d7")).filter((s) => s.maturity === "mature" && s.coverage === "complete");
  const lr = mr.at(-1);
  if (c3?.enabled && lr) {
    const p = c3.parameters;
    const { baseline, samples } = medianBaseline(mr.map((s) => ({ date: s.date, value: s.value })), lr.date);
    const co = Number(lr.sampleSize); const ro = Number(lr.numerator ?? 0);
    if (baseline === null || samples.length < 3) { await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: lr.sampleSize, threshold: p, evidence: { current: lr.value.toString() } }); return; }
    const histDenom = mr.slice(0, -1).reduce((s, x) => s + Number(x.sampleSize), 0);
    const rate = lr.value.toNumber(); const dp = lr.value.sub(baseline).mul(100).toNumber();
    const trig = co >= num(p, "min_orders", 30) && ro >= num(p, "min_refund_orders", 5) && rate >= num(p, "rate_min", 0.10) && dp >= num(p, "diff_pp", 5) && histDenom >= num(p, "min_history_denom", 100);
    const crit = rate >= num(p, "critical_rate", 0.20) && ro >= num(p, "critical_orders", 10);
    await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr.date, status: trig ? "triggered" : "not_triggered", sampleSize: lr.sampleSize, threshold: p, evidence: { current_rate: lr.value.toString(), baseline: baseline.toString(), diff_pp: dp.toFixed(2), orders: co, refund_orders: ro, history_total_denom: histDenom }, alert: trig ? { severity: crit ? "critical" : "warning", title: `订单退款率${(rate * 100).toFixed(1)}%（基准${(baseline.toNumber() * 100).toFixed(1)}%）`, category: "after_sales" } : null });
  }
  const c10 = cfgs.get("R10");
  const ms = (await mSeries(tx, a, "sku_refund_rate_d7")).filter((s) => s.maturity === "mature" && s.coverage === "complete");
  const ls = ms.at(-1);
  if (c10?.enabled && ls) {
    const p = c10.parameters;
    const { baseline } = medianBaseline(ms.map((s) => ({ date: s.date, value: s.value })), ls.date);
    const sold = Number(ls.sampleSize); const ref = Number(ls.numerator ?? 0);
    if (baseline === null) { await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ls.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: ls.sampleSize, threshold: p, evidence: {} }); return; }
    const rate = ls.value.toNumber(); const dp = ls.value.sub(baseline).mul(100).toNumber();
    const trig = sold >= num(p, "min_sold", 20) && ref >= num(p, "min_refunded", 5) && rate >= num(p, "rate_min", 0.15) && dp >= num(p, "diff_pp", 8);
    const crit = rate >= num(p, "critical_rate", 0.30) && ref >= num(p, "critical_refunded", 10);
    await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ls.date, status: trig ? "triggered" : "not_triggered", sampleSize: ls.sampleSize, threshold: p, evidence: { current_rate: ls.value.toString(), baseline: baseline.toString(), sold, refunded: ref }, alert: trig ? { severity: crit ? "critical" : "warning", title: `SKU退件率${(rate * 100).toFixed(1)}%`, category: "sku" } : null });
  }
}

// H06：R08 case+投诉双通道
async function evalAfterSales(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R08"); if (!cfg?.enabled) return; const p = cfg.parameters;
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { timezone: true } });
  const cases = await tx.afterSaleRecord.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { occurredAt: true } });
  const cm = new Map<string, number>(); for (const c of cases) { const d = localDateOf(st.timezone, c.occurredAt); cm.set(d, (cm.get(d) ?? 0) + 1); }
  const cd = [...cm.entries()].sort(([x], [y]) => x.localeCompare(y)); const lc = cd.at(-1);
  if (lc) {
    const [ld, cnt] = lc; const series = cd.map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v) }));
    const { baseline } = medianBaseline(series, ld);
    if (baseline !== null) {
      const trig = cnt >= num(p, "min_count", 10) && new Prisma.Decimal(cnt).sub(baseline).gte(new Prisma.Decimal(num(p, "rise_abs", 5))) && (baseline.isZero() ? cnt >= num(p, "min_count", 10) : cnt / baseline.toNumber() >= 1 + num(p, "rise_ratio", 1.0));
      const crit = cnt >= num(p, "critical_count", 30) && (baseline.isZero() || cnt / baseline.toNumber() >= 1 + num(p, "critical_ratio", 2.0));
      await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "case", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: BigInt(cnt), threshold: p, evidence: { current: cnt, baseline: baseline.toString(), subchannel: "case" }, alert: trig ? { severity: crit ? "critical" : "warning", title: `售后case增加：${cnt}条`, category: "after_sales" } : null });
    }
  }
  const complaints = await tx.customerMessage.findMany({ where: { orgId: a.orgId, storeId: a.storeId, isComplaint: true }, select: { messageAt: true } });
  const pm = new Map<string, number>(); for (const c of complaints) { const d = localDateOf(st.timezone, c.messageAt); pm.set(d, (pm.get(d) ?? 0) + 1); }
  const pd = [...pm.entries()].sort(([x], [y]) => x.localeCompare(y)); const lp = pd.at(-1);
  if (lp) {
    const [ld, cnt] = lp; const series = pd.map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v) }));
    const { baseline } = medianBaseline(series, ld);
    if (baseline !== null) {
      const trig = cnt >= num(p, "min_count", 10) && new Prisma.Decimal(cnt).sub(baseline).gte(new Prisma.Decimal(num(p, "rise_abs", 5))) && (baseline.isZero() ? cnt >= num(p, "min_count", 10) : cnt / baseline.toNumber() >= 1 + num(p, "rise_ratio", 1.0));
      await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "complaint_message", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: BigInt(cnt), threshold: p, evidence: { current: cnt, baseline: baseline.toString(), subchannel: "complaint_message" }, alert: trig ? { severity: "warning", title: `投诉消息增加：${cnt}条`, category: "customer_service" } : null });
    }
  }
}

// H06：R09 用已存在有效分类
async function evalVoc(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R09"); if (!cfg?.enabled) return; const p = cfg.parameters;
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { timezone: true } });
  const msgs = await tx.customerMessage.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { messageAt: true, sentiment: true } });
  const byDay = new Map<string, { known: number; neg: number; total: number }>();
  for (const m of msgs) { const d = localDateOf(st.timezone, m.messageAt); const g = byDay.get(d) ?? { known: 0, neg: 0, total: 0 }; g.total++; if (m.sentiment && ["positive", "neutral", "negative"].includes(m.sentiment)) { g.known++; if (m.sentiment === "negative") g.neg++; } byDay.set(d, g); }
  const days = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y)); const latest = days.at(-1); if (!latest) return;
  const [ld, agg] = latest;
  const cov = agg.total > 0 ? agg.known / agg.total : 0;
  if (cov < num(p, "min_coverage", 0.80) || agg.known < num(p, "min_known", 30)) { await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "insufficient_sentiment_coverage", sampleSize: BigInt(agg.total), threshold: p, evidence: { known: agg.known, total: agg.total, coverage: cov } }); return; }
  const nr = agg.neg / agg.known;
  const series = days.map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v.known > 0 ? v.neg / v.known : 0) }));
  const { baseline } = medianBaseline(series.slice(0, -1), ld);
  if (baseline === null) { await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "insufficient_history", sampleSize: BigInt(agg.total), threshold: p, evidence: {} }); return; }
  const dp = (nr - baseline.toNumber()) * 100;
  const trig = agg.neg >= num(p, "min_negative", 10) && dp >= num(p, "rate_up_pp", 15);
  const crit = dp >= num(p, "critical_pp", 30) && agg.neg >= num(p, "critical_negative", 30);
  await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: BigInt(agg.total), threshold: p, evidence: { negative_rate: nr.toFixed(4), baseline: baseline.toString(), diff_pp: dp.toFixed(2), negative_count: agg.neg }, alert: trig ? { severity: crit ? "critical" : "warning", title: `负面VOC增加：${agg.neg}条`, category: "customer_service" } : null });
}

// H06：R05/R12有配置才评估
async function evalAds(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { currency: true } });
  const us = await mSeries(tx, a, "units_sold");
  const as_ = await mSeries(tx, a, "ad_spend");
  const ld = as_.at(-1)?.date ?? us.at(-1)?.date; if (!ld) return;
  const c5 = cfgs.get("R05");
  if (c5?.enabled) {
    const p = c5.parameters; const abs = typeof p.abs_amount === "number" ? p.abs_amount : (typeof p.default_cny === "number" ? p.default_cny : null);
    if (abs === null) { await writeEval(tx, { ...a, ruleId: "R05", ruleVersion: c5.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "absolute_amount_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须按币种配置绝对金额后启用" } }); }
    else {
      const rs = await mSeries(tx, a, "roas");
      const lsp = as_.at(-1); const lro = rs.at(-1);
      if (lsp && lro) {
        const { baseline: sb } = medianBaseline(as_.slice(0, -1).map((s) => ({ date: s.date, value: s.value })), ld);
        const { baseline: rb } = medianBaseline(rs.slice(0, -1).map((s) => ({ date: s.date, value: s.value })), ld);
        if (sb !== null && rb !== null && !sb.isZero()) {
          const sr = lsp.value.sub(sb).div(sb).toNumber(); const rd = rb.sub(lro.value).div(rb.isZero() ? new Prisma.Decimal(1) : rb).toNumber();
          const trig = sr >= 0.30 && lsp.value.sub(sb).gte(new Prisma.Decimal(abs)) && rd >= 0.20;
          await writeEval(tx, { ...a, ruleId: "R05", ruleVersion: c5.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: 0n, threshold: p, evidence: { spend_current: lsp.value.toString(), spend_baseline: sb.toString(), spend_rise: sr.toFixed(4), roas_current: lro.value.toString(), roas_baseline: rb.toString(), roas_drop: rd.toFixed(4), currency: st.currency }, alert: trig ? { severity: sr >= 1.0 && rd >= 0.5 ? "critical" : "warning", title: `广告花费上升${(sr * 100).toFixed(0)}%且ROAS下降`, category: "advertising" } : null });
        }
      }
    }
  }
  const c12 = cfgs.get("R12");
  if (c12?.enabled) {
    const p = c12.parameters; const target = p.roas_target;
    if (typeof target !== "number") { await writeEval(tx, { ...a, ruleId: "R12", ruleVersion: c12.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "roas_target_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须配置ROAS目标后启用" } }); }
    else { const lr = (await mSeries(tx, a, "roas")).at(-1); if (lr) { const trig = lr.value.toNumber() < target; await writeEval(tx, { ...a, ruleId: "R12", ruleVersion: c12.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr.date, status: trig ? "triggered" : "not_triggered", sampleSize: 0n, threshold: p, evidence: { roas: lr.value.toString(), target }, alert: trig ? { severity: "warning", title: `广告ROAS ${lr.value.toFixed(2)} 低于目标 ${target}`, category: "advertising" } : null }); } }
  }
}

// R11
async function evalCoverage(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R11"); if (!cfg?.enabled) return;
  const ls = await mSeries(tx, a, "gmv"); const ld = ls.at(-1)?.date; if (!ld) return;
  const problems: string[] = [];
  for (const kind of ["orders", "order_items"] as const) { const c = await tx.dataCoverage.findFirst({ where: { orgId: a.orgId, storeId: a.storeId, sourceKind: kind, channel: "default_channel", coverageDate: new Date(`${ld}T00:00:00Z`) }, orderBy: { datasetVersion: "desc" } }); if (!c || c.status !== "complete") problems.push(`${kind}@${ld}:${c?.status ?? "missing"}`); }
  const inc = await tx.order.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { id: true, expectedItemCount: true, _count: { select: { orderItems: true } } } });
  for (const o of inc) if (o._count.orderItems < o.expectedItemCount) problems.push(`order_rows:${o.id.slice(0, 8)}`);
  await writeEval(tx, { ...a, ruleId: "R11", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: ld, status: problems.length > 0 ? "triggered" : "not_triggered", sampleSize: BigInt(problems.length), threshold: {}, evidence: { problems }, alert: problems.length > 0 ? { severity: "warning", title: `数据不完整：${problems.length}项`, category: "data_quality" } : null });
}

export async function buildRulesSnapshot(input: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date; tx: Tx }): Promise<void> {
  const { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, tx } = input;
  const a = { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt };
  const configs = await getConfigs(tx, orgId, storeId, rulesetVersion);
  await evalUnits(tx, a, configs, "R01");
  await evalUnits(tx, a, configs, "R02");
  await evalRefund(tx, a, configs);
  await evalSku(tx, a, configs);
  await evalAfterSales(tx, a, configs);
  await evalVoc(tx, a, configs);
  await evalAds(tx, a, configs);
  await evalCoverage(tx, a, configs);
  for (const rid of ["R04", "R06"]) {
    const cfg = configs.get(rid);
    const ls = await mSeries(tx, a, "units_sold"); const ld = ls.at(-1)?.date ?? addDay(localDateOf("UTC", evaluationAt), -1);
    await writeEval(tx, { ...a, ruleId: rid, ruleVersion: cfg?.ruleVersion ?? RULE_VERSION, entityKey: "store", subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "unsupported_source", sampleSize: 0n, threshold: cfg?.parameters ?? {}, evidence: { note: "P1数据源未接入" } });
  }
}

export function registerRulesBuilder(): void {
  registerSnapshotBuilder("rules", { build: async (input) => { await buildRulesSnapshot({ orgId: input.orgId, storeId: input.storeId, datasetVersion: input.datasetVersion, rulesetVersion: input.rulesetVersion, evaluationAt: input.evaluationAt, tx: input.tx }); } });
}
