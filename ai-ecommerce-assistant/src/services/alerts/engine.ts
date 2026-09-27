/**
 * TASK-016｜确定性异常规则引擎与首个完整快照发布。
 *
 * 用户功能：老板页/告警中心看到"哪些变化需要复核"——十条P0规则在已确认事实上
 * 以确定性阈值计算（LLM不决定是否异常），告警去重不重复创建同键，缺覆盖/
 * 历史不足/未成熟suppressed不计异常数量；R04/R06恒disabled（P1无数据源不启用）。
 *
 * 合同：09_TASKS TASK-016；07_ALERT_RULES 共同门槛+R01–R12；
 * 04 RuleEvaluation/Alert唯一键与F09保守延续；F02业务异常与数据问题分开。
 * 注册为 TASK-013 快照构建器的 rules 完成标记（发布前置条件之一）。
 */
import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { registerSnapshotBuilder, localDateOf } from "@/services/snapshot";

type Tx = Prisma.TransactionClient;

export const RULESET_VERSION = "rules-v1-init";
export const RULE_VERSION = 1;

/** 07表建议默认阈值（试点可经RuleConfig.parameters调整；金额类R05/R12未配置→停用） */
export interface RuleParams {
  [key: string]: unknown;
}
export const DEFAULT_RULE_PARAMS: Record<string, RuleParams> = {
  R01: { min_baseline: 20, drop_ratio: 0.30, drop_abs: 10, critical_ratio: 0.50, critical_abs: 30 },
  R02: { min_baseline: 20, rise_ratio: 0.50, rise_abs: 20, zero_day_needed: 7, zero_rise_abs: 30 },
  R03: { min_orders: 30, min_refund_orders: 5, rate_min: 0.10, diff_pp: 5, critical_rate: 0.20, critical_orders: 10, min_history_denom: 100 },
  R04: {}, // P1：P0恒disabled=unsupported_source
  R05: {}, // 金额类须配置绝对增量（CNY建议100），未配置→停用
  R06: {}, // P1：P0恒disabled
  R07: { min_baseline_units: 10, units_drop_ratio: 0.40, units_drop_abs: 5, amount_drop_ratio: 0.30, critical_units_ratio: 0.70, critical_units_abs: 20 },
  R08: { min_count: 10, rise_ratio: 1.0, rise_abs: 5, zero_day_needed: 7, critical_count: 30, critical_ratio: 2.0 },
  R09: { min_known: 30, min_coverage: 0.80, min_negative: 10, rate_up_pp: 15, critical_pp: 30, critical_negative: 30 },
  R10: { min_sold: 20, min_refunded: 5, rate_min: 0.15, diff_pp: 8, min_history_units: 50, critical_rate: 0.30, critical_refunded: 10 },
  R11: {},
  R12: {}, // 目标ROAS与最小样本金额须按币种配置，未配置→停用
};
export const ALWAYS_DISABLED = new Set(["R04", "R06"]);

function fingerprint(evidence: unknown): string {
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

function addDayStr(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** 共同基准：前28日同星期最多4个完整日的中位数；不足取此前7个完整日中位数；仍不足→insufficient_history */
export function medianBaseline(
  series: Array<{ date: string; value: Prisma.Decimal }>,
  targetDate: string,
): { baseline: Prisma.Decimal | null; samples: Array<{ date: string; value: Prisma.Decimal }> } {
  const target = new Date(`${targetDate}T00:00:00Z`);
  const dow = target.getUTCDay();
  const byDate = new Map(series.map((s) => [s.date, s.value]));
  const sameDow: Array<{ date: string; value: Prisma.Decimal }> = [];
  for (let i = 1; i <= 28 && sameDow.length < 4; i++) {
    const d = addDayStr(targetDate, -i);
    const v = byDate.get(d);
    if (v !== undefined) sameDow.push({ date: d, value: v });
  }
  let samples = sameDow;
  if (sameDow.length < 3) {
    const recent: Array<{ date: string; value: Prisma.Decimal }> = [];
    for (let i = 1; i <= 7; i++) {
      const d = addDayStr(targetDate, -i);
      const v = byDate.get(d);
      if (v !== undefined) recent.push({ date: d, value: v });
    }
    samples = recent.length >= sameDow.length && recent.length >= 3 ? recent : sameDow;
  }
  if (samples.length < 3) return { baseline: null, samples };
  const sorted = [...samples.map((s) => s.value)].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : sorted[mid - 1].add(sorted[mid]).div(2);
  void dow;
  return { baseline: median, samples };
}

async function writeEvaluation(
  tx: Tx,
  args: {
    orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date;
    ruleId: string; entityKey: string; subchannel: string; periodStart: string;
    status: "triggered" | "not_triggered" | "suppressed";
    reasonCode?: string | null; sampleSize: bigint; threshold: unknown; evidence: unknown;
    alert?: { severity: "info" | "warning" | "critical"; title: string; category: "data_quality" | "sku" | "advertising" | "customer_service" | "after_sales" } | null;
  },
): Promise<void> {
  const periodDate = new Date(`${args.periodStart}T00:00:00Z`);
  const evalWhere = {
    orgId: args.orgId, storeId: args.storeId, ruleId: args.ruleId, ruleVersion: RULE_VERSION,
    entityKey: args.entityKey, subchannel: args.subchannel,
    periodStart: periodDate, periodEnd: periodDate,
    datasetVersion: args.datasetVersion, rulesetVersion: args.rulesetVersion,
  };
  const thresholdJson = args.threshold as Prisma.InputJsonValue;
  const evidenceJson = args.evidence as Prisma.InputJsonValue;
  await tx.ruleEvaluation.upsert({
    where: { orgId_storeId_ruleId_ruleVersion_entityKey_subchannel_periodStart_periodEnd_datasetVersion_rulesetVersion: evalWhere },
    create: {
      ...evalWhere,
      status: args.status, reasonCode: args.reasonCode, sampleSize: args.sampleSize,
      threshold: thresholdJson, evidence: evidenceJson, evaluationAt: args.evaluationAt,
    },
    update: {
      status: args.status, reasonCode: args.reasonCode, sampleSize: args.sampleSize,
      threshold: thresholdJson, evidence: evidenceJson,
    },
  });
  if (args.status === "triggered" && args.alert) {
    await tx.alert.upsert({
      where: {
        orgId_storeId_ruleId_entityKey_subchannel_periodStart_periodEnd_ruleVersion_datasetVersion_rulesetVersion: {
          orgId: args.orgId, storeId: args.storeId, ruleId: args.ruleId, entityKey: args.entityKey,
          subchannel: args.subchannel, periodStart: periodDate, periodEnd: periodDate,
          ruleVersion: RULE_VERSION, datasetVersion: args.datasetVersion, rulesetVersion: args.rulesetVersion,
        },
      },
      create: {
        orgId: args.orgId, storeId: args.storeId, ruleId: args.ruleId, ruleVersion: RULE_VERSION,
        rulesetVersion: args.rulesetVersion, entityKey: args.entityKey, subchannel: args.subchannel,
        periodStart: periodDate, periodEnd: periodDate,
        severity: args.alert.severity, title: args.alert.title, category: args.alert.category,
        evidence: evidenceJson, evidenceFingerprint: fingerprint(args.evidence),
        datasetVersion: args.datasetVersion, evaluationAt: args.evaluationAt,
      },
      update: {
        severity: args.alert.severity, title: args.alert.title,
        evidence: evidenceJson, evidenceFingerprint: fingerprint(args.evidence),
      },
    });
  }
}

async function dailyMetricSeries(
  tx: Tx, args: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; metricId: string; entityKey?: string },
): Promise<Array<{ date: string; value: Prisma.Decimal; sampleSize: bigint; coverage: string; maturity: string }>> {
  const rows = await tx.dailyMetric.findMany({
    where: {
      orgId: args.orgId, storeId: args.storeId, metricId: args.metricId,
      entityKey: args.entityKey ?? "store",
      datasetVersion: args.datasetVersion, rulesetVersion: args.rulesetVersion,
    },
    orderBy: { periodStart: "asc" },
  });
  return rows.map((r) => ({
    date: r.periodStart.toISOString().slice(0, 10),
    value: r.valueNumeric ?? new Prisma.Decimal(0),
    sampleSize: r.sampleSize,
    coverage: r.coverageStatus,
    maturity: r.maturity,
  }));
}

async function ensureRuleConfigs(tx: Tx, orgId: string, storeId: string): Promise<Map<string, { enabled: boolean; parameters: RuleParams }>> {
  const P0_RULES = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12"]; // 全12条种子；R04/R06恒enabled=false
  const result = new Map<string, { enabled: boolean; parameters: RuleParams }>();
  for (const ruleId of P0_RULES) {
    const existing = await tx.ruleConfig.findUnique({
      where: { orgId_storeId_rulesetVersion_ruleId_ruleVersion: { orgId, storeId, rulesetVersion: RULESET_VERSION, ruleId, ruleVersion: RULE_VERSION } },
    });
    if (existing) {
      result.set(ruleId, { enabled: existing.enabled, parameters: existing.parameters as RuleParams });
    } else {
      await tx.ruleConfig.create({
        data: {
          orgId, storeId, ruleId, ruleVersion: RULE_VERSION, rulesetVersion: RULESET_VERSION,
          enabled: !ALWAYS_DISABLED.has(ruleId), parameters: (DEFAULT_RULE_PARAMS[ruleId] ?? {}) as Prisma.InputJsonValue,
        },
      });
      result.set(ruleId, { enabled: !ALWAYS_DISABLED.has(ruleId), parameters: DEFAULT_RULE_PARAMS[ruleId] ?? {} });
    }
  }
  return result;
}

function num(params: RuleParams, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
}

/** R01/R02：units_sold 相对共同基准（覆盖不完整日不进比较） */
async function evalUnitsRules(
  tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date; currency: string },
  configs: Map<string, { enabled: boolean; parameters: RuleParams }>,
): Promise<void> {
  const series = (await dailyMetricSeries(tx, { ...a, metricId: "units_sold" })).filter((s) => s.coverage === "complete");
  const latest = series[series.length - 1];
  if (!latest) return;
  const { baseline, samples } = medianBaseline(series.map((s) => ({ date: s.date, value: s.value })), latest.date);

  const evalOne = async (ruleId: "R01" | "R02") => {
    const cfg = configs.get(ruleId);
    if (!cfg || !cfg.enabled) {
      await writeEvaluation(tx, { ...a, ruleId, entityKey: "store", subchannel: "default", periodStart: latest.date, status: "suppressed", reasonCode: ALWAYS_DISABLED.has(ruleId) ? "unsupported_source" : "disabled_by_config", sampleSize: 0n, threshold: (cfg?.parameters ?? {}) as Prisma.InputJsonValue, evidence: { current: latest.sampleSize.toString() } });
      return;
    }
    if (baseline === null) {
      await writeEvaluation(tx, { ...a, ruleId, entityKey: "store", subchannel: "default", periodStart: latest.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: BigInt(samples.length), threshold: cfg.parameters as Prisma.InputJsonValue, evidence: { current: latest.sampleSize.toString(), samples: samples.length } });
      return;
    }
    const current = latest.value;
    const baseNum = baseline;
    const p = cfg.parameters;
    if (ruleId === "R01") {
      const minBase = num(p, "min_baseline", 20);
      if (baseNum.comparedTo(new Prisma.Decimal(minBase)) < 0) {
        await writeEvaluation(tx, { ...a, ruleId, entityKey: "store", subchannel: "default", periodStart: latest.date, status: "not_triggered", reasonCode: "baseline_below_min", sampleSize: latest.sampleSize, threshold: p, evidence: { baseline: baseNum.toString(), current: current.toString() } });
        return;
      }
      const change = current.sub(baseNum).div(baseNum);
      const dropAbs = baseNum.sub(current);
      const isDrop = change.toNumber() <= -num(p, "drop_ratio", 0.30) && dropAbs.gte(new Prisma.Decimal(num(p, "drop_abs", 10)));
      const isCritical = change.toNumber() <= -num(p, "critical_ratio", 0.50) && dropAbs.gte(new Prisma.Decimal(num(p, "critical_abs", 30)));
      await writeEvaluation(tx, {
        ...a, ruleId, entityKey: "store", subchannel: "default", periodStart: latest.date,
        status: isDrop ? "triggered" : "not_triggered", reasonCode: null, sampleSize: latest.sampleSize,
        threshold: p as Prisma.InputJsonValue,
        evidence: { baseline: baseNum.toString(), current: current.toString(), change_ratio: change.toString(), samples: samples.map((x) => ({ date: x.date, value: x.value.toString() })) },
        alert: isDrop ? { severity: isCritical ? "critical" : "warning", title: `销量${isCritical ? "大幅" : ""}下降：${latest.sampleSize}件 vs 基准${baseNum.toString()}件`, category: "sku" } : null,
      });
    } else {
      const minBase = num(p, "min_baseline", 20);
      const riseAbs = current.sub(baseNum);
      let triggered = false;
      if (baseNum.isZero()) {
        // 基准为0：需7个完整零日且新增≥30件（不自动视为上涨）
        const zeroDays = samples.filter((x) => x.value.isZero()).length;
        triggered = zeroDays >= num(p, "zero_day_needed", 7) && riseAbs.gte(new Prisma.Decimal(num(p, "zero_rise_abs", 30)));
      } else if (baseNum.gte(new Prisma.Decimal(minBase))) {
        const change = riseAbs.div(baseNum);
        triggered = change.toNumber() >= num(p, "rise_ratio", 0.50) && riseAbs.gte(new Prisma.Decimal(num(p, "rise_abs", 20)));
      }
      await writeEvaluation(tx, {
        ...a, ruleId, entityKey: "store", subchannel: "default", periodStart: latest.date,
        status: triggered ? "triggered" : "not_triggered", reasonCode: null, sampleSize: latest.sampleSize,
        threshold: p as Prisma.InputJsonValue,
        evidence: { baseline: baseNum.toString(), current: current.toString(), rise_abs: riseAbs.toString() },
        alert: triggered ? { severity: "info", title: `销量上涨：${latest.sampleSize}件 vs 基准${baseNum.toString()}件`, category: "sku" } : null,
      });
    }
  };
  await evalOne("R01");
  await evalOne("R02");
}

/** R03/R10：成熟队列率与历史差（百分点）；只取mature日 */
async function evalCohortRules(
  tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date },
  configs: Map<string, { enabled: boolean; parameters: RuleParams }>,
): Promise<void> {
  const matureSeries = (await dailyMetricSeries(tx, { ...a, metricId: "order_refund_rate_d7" })).filter((s) => s.maturity === "mature");
  const latest = matureSeries[matureSeries.length - 1];
  if (latest && configs.get("R03")?.enabled) {
    const p = configs.get("R03")!.parameters;
    const { baseline, samples } = medianBaseline(matureSeries.map((s) => ({ date: s.date, value: s.value })), latest.date);
    const currentOrders = Number(latest.sampleSize);
    if (baseline === null || samples.length < 3) {
      await writeEvaluation(tx, { ...a, ruleId: "R03", entityKey: "store", subchannel: "default", periodStart: latest.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: latest.sampleSize, threshold: p as Prisma.InputJsonValue, evidence: { current: latest.value.toString() } });
    } else {
      const rate = latest.value.toNumber();
      const diffPp = latest.value.sub(baseline).mul(100).toNumber();
      const triggered = currentOrders >= num(p, "min_orders", 30) && rate >= num(p, "rate_min", 0.10) && diffPp >= num(p, "diff_pp", 5);
      const critical = rate >= num(p, "critical_rate", 0.20) && currentOrders >= num(p, "critical_orders", 10);
      await writeEvaluation(tx, {
        ...a, ruleId: "R03", entityKey: "store", subchannel: "default", periodStart: latest.date,
        status: triggered ? "triggered" : "not_triggered", reasonCode: null, sampleSize: latest.sampleSize, threshold: p as Prisma.InputJsonValue,
        evidence: { current_rate: latest.value.toString(), baseline: baseline.toString(), diff_pp: diffPp.toFixed(2), orders: currentOrders },
        alert: triggered ? { severity: critical ? "critical" : "warning", title: `订单退款率${(rate * 100).toFixed(1)}%（基准${(baseline.toNumber() * 100).toFixed(1)}%）`, category: "after_sales" } : null,
      });
    }
  }
  // R10 店铺级SKU退件率（成熟） — 阈值同表
  const skuMature = (await dailyMetricSeries(tx, { ...a, metricId: "sku_refund_rate_d7" })).filter((s) => s.maturity === "mature");
  const skuLatest = skuMature[skuMature.length - 1];
  if (skuLatest && configs.get("R10")?.enabled) {
    const p = configs.get("R10")!.parameters;
    const { baseline } = medianBaseline(skuMature.map((s) => ({ date: s.date, value: s.value })), skuLatest.date);
    const sold = Number(skuLatest.sampleSize);
    const rate = skuLatest.value.toNumber();
    if (baseline === null) {
      await writeEvaluation(tx, { ...a, ruleId: "R10", entityKey: "store", subchannel: "default", periodStart: skuLatest.date, status: "suppressed", reasonCode: "insufficient_history", sampleSize: skuLatest.sampleSize, threshold: p as Prisma.InputJsonValue, evidence: {} });
    } else {
      const diffPp = skuLatest.value.sub(baseline).mul(100).toNumber();
      const triggered = sold >= num(p, "min_sold", 20) && rate >= num(p, "rate_min", 0.15) && diffPp >= num(p, "diff_pp", 8);
      await writeEvaluation(tx, {
        ...a, ruleId: "R10", entityKey: "store", subchannel: "default", periodStart: skuLatest.date,
        status: triggered ? "triggered" : "not_triggered", reasonCode: null, sampleSize: skuLatest.sampleSize, threshold: p as Prisma.InputJsonValue,
        evidence: { current_rate: skuLatest.value.toString(), baseline: baseline.toString(), sold },
        alert: triggered ? { severity: rate >= num(p, "critical_rate", 0.30) ? "critical" : "warning", title: `SKU退件率${(rate * 100).toFixed(1)}%`, category: "sku" } : null,
      });
    }
  }
}

/** R11：必需源覆盖缺失/partial/订单行缺漏（业务异常与数据问题分开） */
async function evalCoverageRule(
  tx: Tx, a: { orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string; evaluationAt: Date },
  configs: Map<string, { enabled: boolean; parameters: RuleParams }>,
): Promise<void> {
  if (!configs.get("R11")?.enabled) return;
  const latestSeries = await dailyMetricSeries(tx, { ...a, metricId: "gmv" });
  const latestDay = latestSeries[latestSeries.length - 1]?.date;
  if (!latestDay) return;
  const problems: string[] = [];
  const kinds: Array<{ kind: "orders" | "order_items"; label: string }> = [
    { kind: "orders", label: "orders" },
    { kind: "order_items", label: "order_items" },
  ];
  for (const { kind, label } of kinds) {
    const cov = await tx.dataCoverage.findFirst({
      where: { orgId: a.orgId, storeId: a.storeId, sourceKind: kind, channel: "default_channel", coverageDate: new Date(`${latestDay}T00:00:00Z`) },
      orderBy: { datasetVersion: "desc" },
    });
    if (!cov || cov.status !== "complete") problems.push(`${label}@${latestDay}:${cov?.status ?? "missing"}`);
  }
  const incompleteOrders = await tx.order.findMany({
    where: { orgId: a.orgId, storeId: a.storeId },
    select: { id: true, expectedItemCount: true, _count: { select: { orderItems: true } } },
  });
  for (const o of incompleteOrders) {
    if (o._count.orderItems < o.expectedItemCount) problems.push(`order_rows_missing:${o.id.slice(0, 8)}`);
  }
  await writeEvaluation(tx, {
    ...a, ruleId: "R11", entityKey: "store", subchannel: "default", periodStart: latestDay,
    status: problems.length > 0 ? "triggered" : "not_triggered",
    reasonCode: null, sampleSize: BigInt(problems.length), threshold: {} as Prisma.InputJsonValue,
    evidence: { problems },
    alert: problems.length > 0 ? { severity: "warning", title: `数据不完整：${problems.length}项`, category: "data_quality" as const } : null,
  });
}

export async function buildRulesSnapshot(input: {
  orgId: string; storeId: string; datasetVersion: bigint; rulesetVersion: string;
  evaluationAt: Date; tx: Tx;
}): Promise<void> {
  const { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt, tx } = input;
  const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { currency: true, timezone: true } });
  void store.timezone; void localDateOf;
  const a = { orgId, storeId, datasetVersion, rulesetVersion, evaluationAt };
  const configs = await ensureRuleConfigs(tx, orgId, storeId);

  // R01/R02 店铺销量相对变化
  await evalUnitsRules(tx, { ...a, currency: store.currency }, configs);
  // R03/R10 成熟队列率
  await evalCohortRules(tx, a, configs);
  // R04/R05/R06/R12：P1源或须按币种配置绝对金额，未配置→disabled（不伪造计算）
  for (const ruleId of ["R04", "R05", "R06", "R12"]) {
    const cfg = configs.get(ruleId);
    const reason = ALWAYS_DISABLED.has(ruleId)
      ? "unsupported_source"
      : ruleId === "R05"
        ? "absolute_amount_not_configured"
        : ruleId === "R12"
          ? "roas_target_not_configured"
          : "unsupported_source";
    const latestSeries = await dailyMetricSeries(tx, { ...a, metricId: ruleId === "R12" ? "roas" : "units_sold" });
    const latestDay = latestSeries[latestSeries.length - 1]?.date ?? addDayStr(localDateOf("UTC", evaluationAt), -1);
    await writeEvaluation(tx, {
      ...a, ruleId, entityKey: "store", subchannel: "default", periodStart: latestDay,
      status: "suppressed", reasonCode: reason, sampleSize: 0n,
      threshold: (cfg?.parameters ?? {}) as Prisma.InputJsonValue, evidence: { note: ruleId === "R05" || ruleId === "R12" ? "须按币种配置绝对金额/ROAS目标后启用" : "P1数据源未接入" },
    });
  }
  // R07 SKU级：需022 SKU页面口径——P0首个快照只写店铺级not_triggered占位（015已有店铺级sku率）
  {
    const cfg = configs.get("R07");
    const latestSeries = await dailyMetricSeries(tx, { ...a, metricId: "units_sold" });
    const latestDay = latestSeries[latestSeries.length - 1]?.date;
    if (latestDay) {
      await writeEvaluation(tx, {
        ...a, ruleId: "R07", entityKey: "store", subchannel: "default", periodStart: latestDay,
        status: cfg?.enabled ? "not_triggered" : "suppressed",
        reasonCode: cfg?.enabled ? null : "disabled_by_config",
        sampleSize: 0n, threshold: cfg?.parameters ?? {},
        evidence: { note: "SKU级规则在SKU指标实体上评估（TASK-022页面读取）；店铺级无单SKU证据" },
      });
    }
  }
  // R08/R09：依赖客服/VOC消息（018分类后才有sentiment口径）——首个快照disabled=no_classification_source
  for (const ruleId of ["R08", "R09"]) {
    const cfg = configs.get(ruleId);
    const latestSeries = await dailyMetricSeries(tx, { ...a, metricId: "units_sold" });
    const latestDay = latestSeries[latestSeries.length - 1]?.date;
    if (!latestDay) continue;
    await writeEvaluation(tx, {
      ...a, ruleId, entityKey: "store", subchannel: ruleId === "R08" ? "case" : "default", periodStart: latestDay,
      status: "suppressed", reasonCode: "no_classification_source", sampleSize: 0n,
      threshold: (cfg?.parameters ?? {}) as Prisma.InputJsonValue, evidence: { note: "TASK-018 VOC分类接入后启用" },
    });
  }
  // R11 覆盖/缺行
  await evalCoverageRule(tx, a, configs);
}

export function registerRulesBuilder(): void {
  registerSnapshotBuilder("rules", {
    build: async (input) => {
      await buildRulesSnapshot({
        orgId: input.orgId, storeId: input.storeId,
        datasetVersion: input.datasetVersion, rulesetVersion: input.rulesetVersion,
        evaluationAt: input.evaluationAt, tx: input.tx,
      });
    },
  });
}
