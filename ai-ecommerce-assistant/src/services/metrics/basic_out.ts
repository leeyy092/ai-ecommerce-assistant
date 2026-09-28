/**
 * TASK-014/015 共享：DailyMetric 版本化 upsert 写入。
 * Postgres 事务内唯一冲突会中止整个事务（25P02），不能逐行 catch 吞冲突，
 * 因此统一按复合唯一键 upsert；G4R2 H01/C13 起唯一键含 evaluation_at——
 * 同事实版本的新评估写自己的行集，不原地覆盖已发布评估的行；陈旧行由
 * publishSnapshot 在 CAS 成功后清理（新发布成功前旧发布始终可读）。
 */
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export interface DailyMetricWrite {
  orgId: string;
  storeId: string;
  datasetVersion: bigint;
  rulesetVersion: string;
  evaluationAt: Date;
  metricVersion: string;
  metricId: string;
  entityKey: string;
  /** sku: 实体行必填（ck_metric_sku_entity_has_product） */
  productIdAtSnapshot?: string | null;
  periodStart: string;
  valueNumeric: Prisma.Decimal | null;
  numerator: Prisma.Decimal | null;
  denominator: Prisma.Decimal | null;
  sampleSize: bigint;
  status: "available" | "unavailable";
  coverageStatus: "complete" | "partial" | "missing";
  unavailableReason: string | null;
  currency: string | null;
  maturity?: "mature" | "provisional" | "not_applicable";
}

export async function upsertDailyMetric(tx: Tx, r: DailyMetricWrite): Promise<void> {
  const periodDate = new Date(`${r.periodStart}T00:00:00Z`);
  const maturity = r.maturity ?? "not_applicable";
  await tx.dailyMetric.upsert({
    where: {
      orgId_storeId_metricId_entityKey_periodStart_periodEnd_datasetVersion_rulesetVersion_metricVersion_evaluationAt: {
        orgId: r.orgId, storeId: r.storeId, metricId: r.metricId, entityKey: r.entityKey,
        periodStart: periodDate, periodEnd: periodDate,
        datasetVersion: r.datasetVersion, rulesetVersion: r.rulesetVersion, metricVersion: r.metricVersion,
        evaluationAt: r.evaluationAt,
      },
    },
    create: {
      orgId: r.orgId, storeId: r.storeId, metricId: r.metricId, entityKey: r.entityKey,
      productIdAtSnapshot: r.productIdAtSnapshot ?? null,
      periodStart: periodDate, periodEnd: periodDate,
      valueNumeric: r.valueNumeric?.toString() ?? null,
      numerator: r.numerator?.toString() ?? null,
      denominator: r.denominator?.toString() ?? null,
      sampleSize: r.sampleSize,
      status: r.status, coverageStatus: r.coverageStatus, maturity,
      unavailableReason: r.unavailableReason, currency: r.currency,
      datasetVersion: r.datasetVersion, evaluationAt: r.evaluationAt,
      rulesetVersion: r.rulesetVersion, metricVersion: r.metricVersion,
    },
    update: {
      // H01-C13：同版本重评估只在评估身份更晚时覆盖；旧评估的已发布行保持可读
      valueNumeric: r.valueNumeric?.toString() ?? null,
      numerator: r.numerator?.toString() ?? null,
      denominator: r.denominator?.toString() ?? null,
      sampleSize: r.sampleSize,
      status: r.status, coverageStatus: r.coverageStatus, maturity,
      unavailableReason: r.unavailableReason, currency: r.currency,
      evaluationAt: r.evaluationAt,
    },
  });
}
