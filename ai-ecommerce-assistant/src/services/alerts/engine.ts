/**
 * TASK-016｜确定性异常规则引擎（G4R1修复版）。
 * H04：数量读sampleSize+真正同星期基准+7日回退≥7；H05：R03/R10全部门槛；
 * H06：恢复全部P0规则含SKU级R07、R05/R12有配置、R08双通道、R09用有效分类；
 * H07：按Store实际rulesetVersion/ruleVersion读写。
 */
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { registerSnapshotBuilder, localDateOf, localInstantOf } from "@/services/snapshot";
import { writeAudit } from "@/services/audit";

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
/**
 * H07：R05/R12 默认参数必须为空（未配置 → suppressed），但金额/目标是可配置项；
 * 配置接口允许的阈值键 = DEFAULT_RULE_PARAMS 键 ∪ 本表（按币种 default_<ccc> 与绝对金额）。
 */
export const RULE_EXTRA_THRESHOLD_KEYS: Record<string, string[]> = {
  R05: ["abs_amount", "default_cny", "default_usd"],
  R12: ["roas_target", "abs_amount", "default_cny", "default_usd"],
};

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
  // G4R3 H01/T01：唯一键含 evaluationAt——新评估写自己的行，不覆盖旧发布身份的规则/告警
  const w = { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, ruleVersion: a.ruleVersion, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion, evaluationAt: a.evaluationAt };
  await tx.ruleEvaluation.upsert({
    where: { orgId_storeId_ruleId_ruleVersion_entityKey_subchannel_periodStart_periodEnd_datasetVersion_rulesetVersion_evaluationAt: w },
    create: { ...w, status: a.status, reasonCode: a.reasonCode ?? null, sampleSize: a.sampleSize, threshold: th, evidence: ev },
    update: { status: a.status, reasonCode: a.reasonCode ?? null, sampleSize: a.sampleSize, threshold: th, evidence: ev },
  });
  if (a.status === "triggered" && a.alert) {
    // G4R3 H07/T11+G4R4 U02 F09保守延续：先取同对象（规则/实体/子通道/期间+同等级+同指纹+同规则版本）
    // 的【最近一条】告警作为合法前驱，再判断其状态是否 acknowledged/ignored——
    // 最新为 resolved（或 open）时不向更早的 ack/ignored 回溯；参数变化（K05）同样不延续。
    const priorEval = await tx.ruleEvaluation.findFirst({
      where: { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, ruleVersion: a.ruleVersion, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, evaluationAt: { lt: a.evaluationAt } },
      orderBy: { evaluationAt: "desc" },
      select: { threshold: true },
    });
    const paramsUnchanged = !priorEval || JSON.stringify(priorEval.threshold) === JSON.stringify(th);
    const latestSameAlert = await tx.alert.findFirst({
      where: { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, severity: a.alert.severity, evidenceFingerprint: fp(a.evidence), ruleVersion: a.ruleVersion },
      orderBy: { evaluationAt: "desc" },
    });
    const prior = paramsUnchanged && (latestSameAlert?.status === "acknowledged" || latestSameAlert?.status === "ignored") ? latestSameAlert : null;
    await tx.alert.upsert({
      where: { orgId_storeId_ruleId_entityKey_subchannel_periodStart_periodEnd_ruleVersion_datasetVersion_rulesetVersion_evaluationAt: { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, ruleVersion: a.ruleVersion, datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion, evaluationAt: a.evaluationAt } },
      create: { orgId: a.orgId, storeId: a.storeId, ruleId: a.ruleId, ruleVersion: a.ruleVersion, rulesetVersion: a.rulesetVersion, entityKey: a.entityKey, subchannel: a.subchannel, periodStart: pd, periodEnd: pd, severity: a.alert.severity, title: a.alert.title, category: a.alert.category, status: prior?.status ?? ("open" as const), carriedFromAlertId: prior?.id ?? null, evidence: ev, evidenceFingerprint: fp(a.evidence), datasetVersion: a.datasetVersion, evaluationAt: a.evaluationAt },
      update: { severity: a.alert.severity, title: a.alert.title, evidence: ev, evidenceFingerprint: fp(a.evidence) },
    });
    if (prior) {
      await writeAudit(tx, {
        orgId: a.orgId, storeId: a.storeId, actorType: "system",
        action: "alert_status_carried", entityType: "alert", entityId: prior.id,
        beforeSummary: { status: prior.status, rule_id: a.ruleId, entity_key: a.entityKey, subchannel: a.subchannel },
        afterSummary: { continued_status: prior.status, carried_from_alert_id: prior.id, evidence_fingerprint_unchanged: true, params_unchanged: true },
      });
    }
  }
}

async function mSeries(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt?: Date }, metricId: string, entityKey = "store"): Promise<Array<{ date: string; value: Prisma.Decimal; sampleSize: bigint; coverage: string; maturity: string; status: string; numerator: Prisma.Decimal | null }>> {
  // G4R3 H01/T06：构建读取限定本次 evaluationAt，杜绝 E1/E2 行混读混计。
  // 本次评估完全无行时（如仅直接调用规则构建器、指标构建器未跑），
  // 回退读"最近一次有行的评估"的整组行——不与本次部分行混合，仍不跨评估混计。
  const scope = { orgId: a.orgId, storeId: a.storeId, metricId, entityKey, datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion };
  const read = async (extra: Record<string, unknown>) => tx.dailyMetric.findMany({ where: { ...scope, ...extra }, orderBy: { periodStart: "asc" } });
  let rows = a.evaluationAt ? await read({ evaluationAt: a.evaluationAt }) : await read({});
  if (rows.length === 0 && a.evaluationAt) {
    const prev = await tx.dailyMetric.findFirst({ where: { ...scope, evaluationAt: { lte: a.evaluationAt } }, orderBy: { evaluationAt: "desc" }, select: { evaluationAt: true } });
    if (prev) rows = await read({ evaluationAt: prev.evaluationAt });
  }
  return rows.map((r) => ({ date: r.periodStart.toISOString().slice(0, 10), value: r.valueNumeric ?? new Prisma.Decimal(0), sampleSize: r.sampleSize, coverage: r.coverageStatus, maturity: r.maturity, status: r.status, numerator: r.numerator }));
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

// H06/S01：R07 SKU级——店铺时区分日、目标日orders+order_items覆盖完整、完整自然日，否则suppressed
async function evalSku(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R07");
  if (!cfg) return;
  const p = cfg.parameters;
  if (!cfg.enabled) {
    await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "disabled_by_config", sampleSize: 0n, threshold: p, evidence: { note: "规则被配置禁用" } });
    return;
  }
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { timezone: true } });
  const skus = await tx.sKU.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { id: true, externalSkuId: true } });
  const orders = await tx.order.findMany({ where: { orgId: a.orgId, storeId: a.storeId, paidAt: { not: null } }, select: { id: true, paidAt: true } });
  const od = new Map(orders.map((o) => [o.id, o.paidAt!]));
  for (const sku of skus) {
    const items = await tx.orderItem.findMany({ where: { orgId: a.orgId, storeId: a.storeId, skuId: sku.id, order: { paidAt: { not: null } } }, select: { quantity: true, itemPaidAmount: true, orderId: true } });
    // S01：按店铺时区分日（此前硬编码UTC）
    const byDay = new Map<string, { units: bigint; amount: Prisma.Decimal }>();
    for (const it of items) { const d = localDateOf(st.timezone, od.get(it.orderId)!); const g = byDay.get(d) ?? { units: 0n, amount: new Prisma.Decimal(0) }; g.units += BigInt(it.quantity); g.amount = g.amount.add(new Prisma.Decimal(it.itemPaidAmount.toString())); byDay.set(d, g); }
    const days = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y)); const latest = days.at(-1); if (!latest) continue;
    const [ld, la] = latest;
    const entityKey = `sku:${sku.externalSkuId}`;
    // T03：历史基准日同样要求 orders+order_items 覆盖 complete——partial 历史日不进基准
    const historyDays = days.map(([d]) => d).filter((d) => d < ld);
    const covRows = await tx.dataCoverage.findMany({
      where: { orgId: a.orgId, storeId: a.storeId, sourceKind: { in: ["orders", "order_items"] }, channel: "default_channel", coverageDate: { in: [...historyDays, ld].map((d) => new Date(`${d}T00:00:00Z`)) } },
      orderBy: { datasetVersion: "desc" }, select: { sourceKind: true, coverageDate: true, status: true },
    });
    const covOk = new Map<string, boolean>();
    for (const c of covRows) { const k = `${c.sourceKind}|${c.coverageDate.toISOString().slice(0, 10)}`; if (!covOk.has(k)) covOk.set(k, c.status === "complete"); }
    const dayFullyCovered = (d: string) => covOk.get(`orders|${d}`) === true && covOk.get(`order_items|${d}`) === true;
    // S01：目标日 orders+order_items 覆盖必须complete（任一partial/missing → suppressed，不触发）
    if (!dayFullyCovered(ld)) { await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "current_coverage_incomplete", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId, day: ld } }); continue; }
    // T04：完整自然日按店铺时区次日零点判定（此前误用UTC次日零点）
    const dayEnd = localInstantOf(st.timezone, addDay(ld, 1));
    if (a.evaluationAt.getTime() < dayEnd.getTime()) { await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "natural_day_incomplete", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId, day: ld } }); continue; }
    const baselineDays = days.filter(([d]) => d < ld && dayFullyCovered(d));
    const uS = [...baselineDays, [ld, la] as [string, { units: bigint; amount: Prisma.Decimal }]].map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v.units.toString()) }));
    const aS = [...baselineDays, [ld, la] as [string, { units: bigint; amount: Prisma.Decimal }]].map(([d, v]) => ({ date: d, value: v.amount }));
    const { baseline: ub } = medianBaseline(uS, ld); const { baseline: ab } = medianBaseline(aS, ld);
    if (ub === null || ab === null) { await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "insufficient_history", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId } }); continue; }
    if (ub.lt(new Prisma.Decimal(num(p, "min_baseline_units", 10)))) { await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "not_triggered", reasonCode: "baseline_below_min", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId, baseline_units: ub.toString() } }); continue; }
    const ud = ub.sub(new Prisma.Decimal(la.units.toString())); const ad = ab.sub(la.amount);
    const udr = ud.div(ub).toNumber(); const adr = ab.isZero() ? 0 : ad.div(ab).toNumber();
    const trig = udr >= num(p, "units_drop_ratio", 0.40) && ud.gte(new Prisma.Decimal(num(p, "units_drop_abs", 5))) && adr >= num(p, "amount_drop_ratio", 0.30);
    const crit = udr >= num(p, "critical_units_ratio", 0.70) && ud.gte(new Prisma.Decimal(num(p, "critical_units_abs", 20)));
    await writeEval(tx, { ...a, ruleId: "R07", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: la.units, threshold: p, evidence: { sku: sku.externalSkuId, baseline_units: ub.toString(), current_units: la.units.toString(), baseline_amount: ab.toString(), current_amount: la.amount.toString() }, alert: trig ? { severity: crit ? "critical" : "warning", title: `SKU ${sku.externalSkuId} 销量销售额双降`, category: "sku" } : null });
  }
}

// H05：R03/R10全部门槛；H06/S02：R10逐SKU实体；H07/C11：禁用也保留suppressed理由行
async function evalRefund(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const c3 = cfgs.get("R03");
  const allR = await mSeries(tx, a, "order_refund_rate_d7");
  if (c3) {
    const p = c3.parameters;
    if (!c3.enabled) {
      const lr = allR.at(-1);
      await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr?.date ?? await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "disabled_by_config", sampleSize: BigInt(lr?.sampleSize ?? 0n), threshold: p, evidence: { note: "规则被配置禁用" } });
    } else {
      const mr = allR.filter((s) => s.maturity === "mature" && s.coverage === "complete");
      const lr = mr.at(-1);
      if (!lr) {
        await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "insufficient_history", sampleSize: 0n, threshold: p, evidence: { note: "无成熟且覆盖完整的退款队列序列" } });
      } else {
        const { baseline, samples } = medianBaseline(mr.map((s) => ({ date: s.date, value: s.value })), lr.date);
        const co = new Prisma.Decimal(lr.sampleSize.toString());
        const ro = lr.numerator ?? new Prisma.Decimal(0);
        const histDenom = mr.slice(0, -1).reduce((s, x) => s.add(new Prisma.Decimal(x.sampleSize.toString())), new Prisma.Decimal(0));
        if (baseline === null || samples.length < 3) {
          await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: lr.sampleSize, threshold: p, evidence: { current: lr.value.toString(), samples: samples.length } });
        } else {
          // H05/C10：样本门槛不足 → suppressed（不能向老板表达“已判断正常”），与阈值未到区分
          const minOrders = new Prisma.Decimal(num(p, "min_orders", 30));
          const minRefunds = new Prisma.Decimal(num(p, "min_refund_orders", 5));
          const minHist = new Prisma.Decimal(num(p, "min_history_denom", 100));
          if (co.lt(minOrders) || ro.lt(minRefunds) || histDenom.lt(minHist)) {
            await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr.date, status: "suppressed", reasonCode: "insufficient_sample", sampleSize: lr.sampleSize, threshold: p, evidence: { orders: co.toString(), refund_orders: ro.toString(), history_total_denom: histDenom.toString(), requires: { orders: minOrders.toString(), refund_orders: minRefunds.toString(), history_total_denom: minHist.toString() } } });
          } else {
            // 未舍入 Decimal 比较（H05）
            const rateOk = lr.value.gte(new Prisma.Decimal(num(p, "rate_min", 0.10)));
            const dpOk = lr.value.sub(baseline).mul(100).gte(new Prisma.Decimal(num(p, "diff_pp", 5)));
            const trig = rateOk && dpOk;
            const crit = lr.value.gte(new Prisma.Decimal(num(p, "critical_rate", 0.20))) && ro.gte(new Prisma.Decimal(num(p, "critical_orders", 10)));
            await writeEval(tx, { ...a, ruleId: "R03", ruleVersion: c3.ruleVersion, entityKey: "store", subchannel: "default", periodStart: lr.date, status: trig ? "triggered" : "not_triggered", sampleSize: lr.sampleSize, threshold: p, evidence: { current_rate: lr.value.toString(), baseline: baseline.toString(), diff_pp: lr.value.sub(baseline).mul(100).toString(), orders: co.toString(), refund_orders: ro.toString(), history_total_denom: histDenom.toString() }, alert: trig ? { severity: crit ? "critical" : "warning", title: `订单退款率${lr.value.mul(100).toFixed(1)}%（基准${baseline.mul(100).toFixed(1)}%）`, category: "after_sales" } : null });
          }
        }
      }
    }
  }
  const c10 = cfgs.get("R10");
  if (c10) {
    const p = c10.parameters;
    if (!c10.enabled) {
      await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: "store", subchannel: "default", periodStart: await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "disabled_by_config", sampleSize: 0n, threshold: p, evidence: { note: "规则被配置禁用" } });
    } else {
      // H06/S02：逐实体评估（sku:* 逐SKU + store 聚合），不再只读店铺聚合；读取限定本次评估（T06）
      const entityRows = await tx.dailyMetric.findMany({ where: { orgId: a.orgId, storeId: a.storeId, metricId: "sku_refund_rate_d7", datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion, evaluationAt: a.evaluationAt }, select: { entityKey: true }, distinct: ["entityKey"] });
      for (const e of entityRows) {
        const ms = (await mSeries(tx, a, "sku_refund_rate_d7", e.entityKey)).filter((s) => s.maturity === "mature" && s.coverage === "complete");
        const ls = ms.at(-1);
        if (!ls) { await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: e.entityKey, subchannel: "default", periodStart: await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "insufficient_history", sampleSize: 0n, threshold: p, evidence: { entity: e.entityKey, note: "无成熟且覆盖完整的退件队列序列" } }); continue; }
        const { baseline } = medianBaseline(ms.map((s) => ({ date: s.date, value: s.value })), ls.date);
        const sold = new Prisma.Decimal(ls.sampleSize.toString());
        const ref = ls.numerator ?? new Prisma.Decimal(0);
        const histUnits = ms.slice(0, -1).reduce((s, x) => s.add(new Prisma.Decimal(x.sampleSize.toString())), new Prisma.Decimal(0));
        if (baseline === null) { await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: e.entityKey, subchannel: "default", periodStart: ls.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: ls.sampleSize, threshold: p, evidence: { entity: e.entityKey } }); continue; }
        const minSold = new Prisma.Decimal(num(p, "min_sold", 20));
        const minRef = new Prisma.Decimal(num(p, "min_refunded", 5));
        const minHistUnits = new Prisma.Decimal(num(p, "min_history_units", 50));
        if (sold.lt(minSold) || ref.lt(minRef) || histUnits.lt(minHistUnits)) {
          await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: e.entityKey, subchannel: "default", periodStart: ls.date, status: "suppressed", reasonCode: "insufficient_sample", sampleSize: ls.sampleSize, threshold: p, evidence: { entity: e.entityKey, sold: sold.toString(), refunded: ref.toString(), history_total_units: histUnits.toString(), requires: { sold: minSold.toString(), refunded: minRef.toString(), history_total_units: minHistUnits.toString() } } });
          continue;
        }
        const rateOk = ls.value.gte(new Prisma.Decimal(num(p, "rate_min", 0.15)));
        const dpOk = ls.value.sub(baseline).mul(100).gte(new Prisma.Decimal(num(p, "diff_pp", 8)));
        const trig = rateOk && dpOk;
        const crit = ls.value.gte(new Prisma.Decimal(num(p, "critical_rate", 0.30))) && ref.gte(new Prisma.Decimal(num(p, "critical_refunded", 10)));
        await writeEval(tx, { ...a, ruleId: "R10", ruleVersion: c10.ruleVersion, entityKey: e.entityKey, subchannel: "default", periodStart: ls.date, status: trig ? "triggered" : "not_triggered", sampleSize: ls.sampleSize, threshold: p, evidence: { entity: e.entityKey, current_rate: ls.value.toString(), baseline: baseline.toString(), sold: sold.toString(), refunded: ref.toString(), history_total_units: histUnits.toString() }, alert: trig ? { severity: crit ? "critical" : "warning", title: `${e.entityKey === "store" ? "店铺" : `SKU ${e.entityKey.slice(4)}`}退件率${ls.value.mul(100).toFixed(1)}%`, category: "sku" } : null });
      }
    }
  }
}

/** 无可用业务序列时给suppressed行一个稳定的期间（最近units_sold日，否则评估日前一日） */
async function fallbackPeriod(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }): Promise<string> {
  const ls = await tx.dailyMetric.findFirst({ where: { orgId: a.orgId, storeId: a.storeId, metricId: "units_sold", datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion, evaluationAt: a.evaluationAt }, orderBy: { periodStart: "desc" }, select: { periodStart: true } });
  if (ls) return ls.periodStart.toISOString().slice(0, 10);
  return addDay(localDateOf("UTC", a.evaluationAt), -1);
}

// H06：R08 case+投诉双通道；投诉子通道当前及基准期is_complaint标记覆盖须100%
async function evalAfterSales(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R08");
  if (!cfg) return;
  const p = cfg.parameters;
  if (!cfg.enabled) {
    await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "disabled_by_config", sampleSize: 0n, threshold: p, evidence: { note: "规则被配置禁用" } });
    return;
  }
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { timezone: true } });
  const cases = await tx.afterSaleRecord.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { occurredAt: true } });
  const cm = new Map<string, number>(); for (const c of cases) { const d = localDateOf(st.timezone, c.occurredAt); cm.set(d, (cm.get(d) ?? 0) + 1); }
  const cd = [...cm.entries()].sort(([x], [y]) => x.localeCompare(y)); const lc = cd.at(-1);
  if (lc) {
    const [ld, cnt] = lc; const series = cd.map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v) }));
    const { baseline } = medianBaseline(series, ld);
    if (baseline === null) { await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "case", periodStart: ld, status: "suppressed", reasonCode: "insufficient_history", sampleSize: BigInt(cnt), threshold: p, evidence: { subchannel: "case" } }); }
    else {
      const trig = cnt >= num(p, "min_count", 10) && new Prisma.Decimal(cnt).sub(baseline).gte(new Prisma.Decimal(num(p, "rise_abs", 5))) && (baseline.isZero() ? cnt >= num(p, "min_count", 10) : cnt / baseline.toNumber() >= 1 + num(p, "rise_ratio", 1.0));
      const crit = cnt >= num(p, "critical_count", 30) && (baseline.isZero() || cnt / baseline.toNumber() >= 1 + num(p, "critical_ratio", 2.0));
      await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "case", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: BigInt(cnt), threshold: p, evidence: { current: cnt, baseline: baseline.toString(), subchannel: "case" }, alert: trig ? { severity: crit ? "critical" : "warning", title: `售后case增加：${cnt}条`, category: "after_sales" } : null });
    }
  }
  // 投诉子通道：显式 is_complaint=true 的消息计数；当前/基准日 is_complaint 标记覆盖 100%
  // 且 customer_messages 源覆盖（default通道）完整，否则 suppressed（07 R08/T08/T09口径）
  const msgs = await tx.customerMessage.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { messageAt: true, isComplaint: true } });
  const byDay = new Map<string, { complaints: number; total: number; unmarked: number }>();
  for (const m of msgs) {
    const d = localDateOf(st.timezone, m.messageAt);
    const g = byDay.get(d) ?? { complaints: 0, total: 0, unmarked: 0 };
    g.total += 1;
    if (m.isComplaint === null || m.isComplaint === undefined) g.unmarked += 1;
    else if (m.isComplaint) g.complaints += 1;
    byDay.set(d, g);
  }
  const pd = [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y)); const lp = pd.at(-1);
  if (lp) {
    const [ld, agg] = lp;
    const series = pd.map(([d, v]) => ({ date: d, value: new Prisma.Decimal(v.complaints) }));
    const { baseline, samples } = medianBaseline(series, ld);
    if (baseline === null) { await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "complaint_message", periodStart: ld, status: "suppressed", reasonCode: "insufficient_history", sampleSize: BigInt(agg.total), threshold: p, evidence: { subchannel: "complaint_message" } }); }
    else {
      // 当前日与基准样本日：is_complaint 标记覆盖 100% 且消息源覆盖 complete
      const sampleDates = new Set([ld, ...samples.map((s) => s.date)]);
      const unmarkedDays: Array<{ day: string; unmarked: number; total: number }> = [];
      for (const [d, g] of byDay) if (sampleDates.has(d) && g.unmarked > 0) unmarkedDays.push({ day: d, unmarked: g.unmarked, total: g.total });
      const uncoveredDays: string[] = [];
      for (const d of sampleDates) {
        const c = await tx.dataCoverage.findFirst({ where: { orgId: a.orgId, storeId: a.storeId, sourceKind: "customer_messages", channel: "default_channel", coverageDate: new Date(`${d}T00:00:00Z`) }, orderBy: { datasetVersion: "desc" }, select: { status: true } });
        if (c?.status !== "complete") uncoveredDays.push(d);
      }
      if (unmarkedDays.length > 0) {
        await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "complaint_message", periodStart: ld, status: "suppressed", reasonCode: "complaint_marking_incomplete", sampleSize: BigInt(agg.total), threshold: p, evidence: { subchannel: "complaint_message", unmarked_days: unmarkedDays } });
      } else if (uncoveredDays.length > 0) {
        await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "complaint_message", periodStart: ld, status: "suppressed", reasonCode: "source_coverage_incomplete", sampleSize: BigInt(agg.total), threshold: p, evidence: { subchannel: "complaint_message", uncovered_days: uncoveredDays } });
      } else {
        const cnt = agg.complaints;
        // T07：投诉子通道同样有 critical 等级（≥critical_count 且增幅达 critical_ratio）
        const crit = cnt >= num(p, "critical_count", 30) && (baseline.isZero() ? cnt >= num(p, "critical_count", 30) : cnt / baseline.toNumber() >= 1 + num(p, "critical_ratio", 2.0));
        const trig = cnt >= num(p, "min_count", 10) && new Prisma.Decimal(cnt).sub(baseline).gte(new Prisma.Decimal(num(p, "rise_abs", 5))) && (baseline.isZero() ? cnt >= num(p, "min_count", 10) : cnt / baseline.toNumber() >= 1 + num(p, "rise_ratio", 1.0));
        await writeEval(tx, { ...a, ruleId: "R08", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "complaint_message", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: BigInt(cnt), threshold: p, evidence: { current: cnt, baseline: baseline.toString(), subchannel: "complaint_message", marking_coverage: 1 }, alert: trig ? { severity: crit ? "critical" : "warning", title: `投诉消息增加：${cnt}条`, category: "customer_service" } : null });
      }
    }
  }
}

// H06：R09 同渠道/分类版本隔离；基准样本日也须满足情感已知样本与覆盖率门槛
async function evalVoc(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const cfg = cfgs.get("R09");
  if (!cfg) return;
  const p = cfg.parameters;
  if (!cfg.enabled) {
    await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: await fallbackPeriod(tx, a), status: "suppressed", reasonCode: "disabled_by_config", sampleSize: 0n, threshold: p, evidence: { note: "规则被配置禁用" } });
    return;
  }
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { timezone: true } });
  const msgs = await tx.customerMessage.findMany({ where: { orgId: a.orgId, storeId: a.storeId }, select: { messageAt: true, sentiment: true, channel: true, classificationVersion: true } });
  const KNOWN = ["positive", "neutral", "negative"];
  // 按 (channel, classificationVersion) 分组隔离；版本变化不共用基准（07 R09）
  const groups = new Map<string, Map<string, { known: number; neg: number; total: number }>>();
  for (const m of msgs) {
    const key = `${m.channel}|${m.classificationVersion ?? ""}`;
    const d = localDateOf(st.timezone, m.messageAt);
    const days = groups.get(key) ?? new Map<string, { known: number; neg: number; total: number }>();
    const g = days.get(d) ?? { known: 0, neg: 0, total: 0 };
    g.total += 1;
    if (m.sentiment && KNOWN.includes(m.sentiment)) { g.known += 1; if (m.sentiment === "negative") g.neg += 1; }
    days.set(d, g);
    groups.set(key, days);
  }
  const minKnown = num(p, "min_known", 30);
  const minCoverage = num(p, "min_coverage", 0.80);
  for (const [key, dayMap] of groups) {
    const days = [...dayMap.entries()].sort(([x], [y]) => x.localeCompare(y));
    const latest = days.at(-1); if (!latest) continue;
    const [ld, agg] = latest;
    const channel = key.split("|")[0];
    const version = key.split("|")[1] || null;
    // 子通道编码 渠道+分类版本：不同版本是独立评估行（唯一键隔离），版本变化不共用行
    const sub = (version ? `${channel}|${version}` : channel).slice(0, 32);
    // G4R4 U03：源覆盖门槛限定当前期 + 原合同有效基准候选窗口（前28日同星期最多4个 + 前7日回退）。
    // 无关远古日期（窗口外）不参与覆盖判定，不得禁用当前判断；当前期 partial 仍 suppressed；
    // 候选样本日不完整则从基准剔除并按历史不足处理（07 §9/§21，REVIEW4 H06关闭标准）。
    const sameDowCandidates: string[] = [];
    const targetDow = new Date(`${ld}T00:00:00Z`).getUTCDay();
    for (let i = 1; i <= 28 && sameDowCandidates.length < 4; i++) {
      const d = addDay(ld, -i);
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === targetDow) sameDowCandidates.push(d);
    }
    const fallbackCandidates: string[] = [];
    for (let i = 1; i <= 7; i++) fallbackCandidates.push(addDay(ld, -i));
    const candidateWindow = new Set([...sameDowCandidates, ...fallbackCandidates]);
    const dayMapDates = new Set(days.map(([d]) => d));
    const coverageOk = new Map<string, boolean>();
    for (const d of [ld, ...candidateWindow]) {
      if (d !== ld && !dayMapDates.has(d)) continue; // 无消息的候选日无需覆盖判定
      const c = await tx.dataCoverage.findFirst({ where: { orgId: a.orgId, storeId: a.storeId, sourceKind: "customer_messages", channel: "default_channel", coverageDate: new Date(`${d}T00:00:00Z`) }, orderBy: { datasetVersion: "desc" }, select: { status: true } });
      coverageOk.set(d, c?.status === "complete");
    }
    if (coverageOk.get(ld) === false) {
      await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: sub, periodStart: ld, status: "suppressed", reasonCode: "source_coverage_incomplete", sampleSize: BigInt(agg.total), threshold: p, evidence: { channel, classification_version: version, uncovered_current: ld } });
      continue;
    }
    const cov = agg.total > 0 ? agg.known / agg.total : 0;
    if (agg.known < minKnown || cov < minCoverage) {
      await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: sub, periodStart: ld, status: "suppressed", reasonCode: "insufficient_sentiment_coverage", sampleSize: BigInt(agg.total), threshold: p, evidence: { channel, classification_version: version, known: agg.known, total: agg.total, coverage: cov } });
      continue;
    }
    // 基准样本日也须情感已知≥min_known且覆盖率≥min_coverage，且位于有效候选窗口、源覆盖完整
    const eligible = days.filter(([d, g]) => d < ld && candidateWindow.has(d) && coverageOk.get(d) !== false && g.known >= minKnown && (g.total > 0 ? g.known / g.total : 0) >= minCoverage);
    const series = eligible.map(([d, g]) => ({ date: d, value: new Prisma.Decimal(g.known > 0 ? g.neg / g.known : 0) }));
    const { baseline } = medianBaseline(series, ld);
    if (baseline === null) {
      await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: sub, periodStart: ld, status: "suppressed", reasonCode: "insufficient_history", sampleSize: BigInt(agg.total), threshold: p, evidence: { channel, classification_version: version, eligible_history_days: series.length } });
      continue;
    }
    const nr = agg.neg / agg.known;
    const dp = (nr - baseline.toNumber()) * 100;
    const trig = agg.neg >= num(p, "min_negative", 10) && dp >= num(p, "rate_up_pp", 15);
    const crit = dp >= num(p, "critical_pp", 30) && agg.neg >= num(p, "critical_negative", 30);
    await writeEval(tx, { ...a, ruleId: "R09", ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: sub, periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: BigInt(agg.total), threshold: p, evidence: { channel, classification_version: version, negative_rate: nr.toFixed(4), baseline: baseline.toString(), diff_pp: dp.toFixed(2), negative_count: agg.neg }, alert: trig ? { severity: crit ? "critical" : "warning", title: `负面VOC增加：${agg.neg}条`, category: "customer_service" } : null });
  }
}

// H06：R05/R12 逐广告归因组实体（ads:{model}:{window}）计算，不跨组合并；
// 归因窗未结束/覆盖不完整 → suppressed；绝对金额/目标未按币种配置 → suppressed
async function evalAds(tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date }, cfgs: Map<string, { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number }>): Promise<void> {
  const st = await tx.store.findUniqueOrThrow({ where: { id: a.storeId }, select: { currency: true } });
  const c5 = cfgs.get("R05");
  const c12 = cfgs.get("R12");
  // T10：逐 campaign+归因组实体（ads:{campaign}:{model}:{window}）——不同 campaign 变化不得互相抵消
  const adEntities = await tx.dailyMetric.findMany({ where: { orgId: a.orgId, storeId: a.storeId, metricId: "ad_spend", datasetVersion: a.datasetVersion, rulesetVersion: a.rulesetVersion, evaluationAt: a.evaluationAt }, select: { entityKey: true }, distinct: ["entityKey"] });
  const fallbackDate = await fallbackPeriod(tx, a);
  const absOf = (p: Record<string, unknown>): number | null => {
    if (typeof p.abs_amount === "number") return p.abs_amount;
    const byCur = p[`default_${String(st.currency).toLowerCase()}`];
    return typeof byCur === "number" ? byCur : null;
  };
  const writeNoEntity = async (ruleId: "R05" | "R12", cfg: { enabled: boolean; parameters: Record<string, unknown>; ruleVersion: number } | undefined): Promise<void> => {
    if (!cfg) return;
    const p = cfg.parameters;
    if (!cfg.enabled) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: fallbackDate, status: "suppressed", reasonCode: "disabled_by_config", sampleSize: 0n, threshold: p, evidence: { note: "规则被配置禁用" } }); return; }
    if (ruleId === "R12" && typeof p.roas_target !== "number") { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: fallbackDate, status: "suppressed", reasonCode: "roas_target_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须配置ROAS目标后启用" } }); return; }
    if (absOf(p) === null) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: fallbackDate, status: "suppressed", reasonCode: "absolute_amount_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须按币种配置绝对金额后启用", currency: st.currency } }); return; }
    await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey: "store", subchannel: "default", periodStart: fallbackDate, status: "suppressed", reasonCode: "insufficient_history", sampleSize: 0n, threshold: p, evidence: { note: "无广告归因组数据" } });
  };
  if (adEntities.length === 0) {
    await writeNoEntity("R05", c5);
    await writeNoEntity("R12", c12);
    return;
  }
  for (const e of adEntities) {
    const entityKey = e.entityKey;
    // 归因组窗口：entityKey = ads:{campaign}:{model}:{window}（旧3段格式兼容末段）；报告日+window 未到评估时点 → 归因窗未结束
    const parts = entityKey.split(":");
    const windowDays = Number.parseInt(parts[3] ?? parts[2] ?? "7", 10);
    const as_ = await mSeries(tx, a, "ad_spend", entityKey);
    const ld = as_.at(-1)?.date;
    const windowOpen = ld ? Date.parse(`${ld}T00:00:00Z`) + (Number.isNaN(windowDays) ? 7 : windowDays) * 86400000 > a.evaluationAt.getTime() : false;
    const latestCoverage = as_.at(-1)?.coverage ?? "missing";
    for (const [ruleId, cfg] of [["R05", c5], ["R12", c12]] as const) {
      if (!cfg) continue;
      const p = cfg.parameters;
      if (!cfg.enabled) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld ?? fallbackDate, status: "suppressed", reasonCode: "disabled_by_config", sampleSize: 0n, threshold: p, evidence: { note: "规则被配置禁用" } }); continue; }
      if (ruleId === "R12" && typeof p.roas_target !== "number") { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld ?? fallbackDate, status: "suppressed", reasonCode: "roas_target_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须配置ROAS目标后启用" } }); continue; }
      const abs = absOf(p);
      if (abs === null) {
        await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld ?? fallbackDate, status: "suppressed", reasonCode: "absolute_amount_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须按币种配置绝对金额后启用", currency: st.currency } });
        continue;
      }
      if (!ld) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: fallbackDate, status: "suppressed", reasonCode: "insufficient_history", sampleSize: 0n, threshold: p, evidence: { entity: entityKey } }); continue; }
      if (windowOpen) { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "attribution_window_open", sampleSize: 0n, threshold: p, evidence: { entity: entityKey, day: ld, window_days: Number.isNaN(windowDays) ? 7 : windowDays } }); continue; }
      if (latestCoverage !== "complete") { await writeEval(tx, { ...a, ruleId, ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "current_coverage_incomplete", sampleSize: 0n, threshold: p, evidence: { entity: entityKey, day: ld, coverage: latestCoverage } }); continue; }
      if (ruleId === "R05") {
        const rs = await mSeries(tx, a, "roas", entityKey);
        const lsp = as_.at(-1)!; const lro = rs.at(-1);
        const salesRow = (await mSeries(tx, a, "ad_sales", entityKey)).at(-1);
        if (!lro || !salesRow || salesRow.status !== "available") { await writeEval(tx, { ...a, ruleId: "R05", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "no_valid_attribution", sampleSize: 0n, threshold: p, evidence: { entity: entityKey, note: "当前无有效销售归因" } }); continue; }
        const { baseline: sb } = medianBaseline(as_.slice(0, -1).map((s) => ({ date: s.date, value: s.value })), ld);
        const { baseline: rb } = medianBaseline(rs.slice(0, -1).map((s) => ({ date: s.date, value: s.value })), ld);
        if (sb === null || rb === null || sb.isZero()) { await writeEval(tx, { ...a, ruleId: "R05", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: sb === null || rb === null ? "insufficient_history" : "zero_baseline", sampleSize: 0n, threshold: p, evidence: { entity: entityKey } }); continue; }
        const sr = lsp.value.sub(sb).div(sb).toNumber(); const rd = rb.sub(lro.value).div(rb.isZero() ? new Prisma.Decimal(1) : rb).toNumber();
        const trig = sr >= 0.30 && lsp.value.sub(sb).gte(new Prisma.Decimal(abs)) && rd >= 0.20;
        await writeEval(tx, { ...a, ruleId: "R05", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: trig ? "triggered" : "not_triggered", sampleSize: 0n, threshold: p, evidence: { entity: entityKey, spend_current: lsp.value.toString(), spend_baseline: sb.toString(), spend_rise: sr.toFixed(4), roas_current: lro.value.toString(), roas_baseline: rb.toString(), roas_drop: rd.toFixed(4), currency: st.currency, abs_amount: abs }, alert: trig ? { severity: sr >= 1.0 && rd >= 0.5 ? "critical" : "warning", title: `广告花费上升${(sr * 100).toFixed(0)}%且ROAS下降（${entityKey}）`, category: "advertising" } : null });
      } else {
        const target = p.roas_target;
        if (typeof target !== "number") { await writeEval(tx, { ...a, ruleId: "R12", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "roas_target_not_configured", sampleSize: 0n, threshold: p, evidence: { note: "须配置ROAS目标后启用" } }); continue; }
        const lsp = as_.at(-1)!;
        const lr = (await mSeries(tx, a, "roas", entityKey)).at(-1);
        if (!lr || lsp.value.lt(new Prisma.Decimal(abs))) { await writeEval(tx, { ...a, ruleId: "R12", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: ld, status: "suppressed", reasonCode: "insufficient_sample", sampleSize: 0n, threshold: p, evidence: { entity: entityKey, spend: lsp.value.toString(), requires: abs, currency: st.currency } }); continue; }
        const trig = lr.value.toNumber() < target;
        await writeEval(tx, { ...a, ruleId: "R12", ruleVersion: cfg.ruleVersion, entityKey, subchannel: "default", periodStart: lr.date, status: trig ? "triggered" : "not_triggered", sampleSize: 0n, threshold: p, evidence: { entity: entityKey, roas: lr.value.toString(), target, spend: lsp.value.toString() }, alert: trig ? { severity: "warning", title: `广告ROAS ${lr.value.toFixed(2)} 低于目标 ${target}（${entityKey}）`, category: "advertising" } : null });
      }
    }
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
  // G4R3 H01/T01：构建期只清理同元组"非已发布身份"的更旧规则/告警行——
  // 已发布身份的行在发布 CAS 成功前完整保留（E2 待发布时 E1 的 rules/alerts 不动）；
  // 未发布过（无指针）时清掉更旧行保持单活跃集合，保证最新评估可确定读取。
  const published = await tx.store.findUnique({ where: { id: storeId }, select: { currentSnapshotVersion: true, currentSnapshotRulesetVersion: true, currentSnapshotEvaluationAt: true } });
  const publishedIsThisTuple = published?.currentSnapshotVersion === datasetVersion && published?.currentSnapshotRulesetVersion === rulesetVersion;
  const keepAt = publishedIsThisTuple ? published?.currentSnapshotEvaluationAt ?? null : null;
  const olderWhere = { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt: keepAt ? { lt: evaluationAt, not: keepAt } : { lt: evaluationAt } };
  await tx.ruleEvaluation.deleteMany({ where: olderWhere });
  await tx.alert.deleteMany({ where: olderWhere });
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
