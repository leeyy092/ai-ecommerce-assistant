/**
 * TASK-014/015 共享：DailyMetric 版本化 upsert 写入。
 * Postgres 事务内唯一冲突会中止整个事务（25P02），不能逐行 catch 吞冲突，
 * 因此统一按复合唯一键 upsert：同 (org,store,metric,entity,period,datasetVersion,
 * ruleset,metricVersion) 幂等重写当前构建行；历史版本行不可变、不受影响。
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
      orgId_storeId_metricId_entityKey_periodStart_periodEnd_datasetVersion_rulesetVersion_metricVersion: {
        orgId: r.orgId, storeId: r.storeId, metricId: r.metricId, entityKey: r.entityKey,
        periodStart: periodDate, periodEnd: periodDate,
        datasetVersion: r.datasetVersion, rulesetVersion: r.rulesetVersion, metricVersion: r.metricVersion,
      },
    },
    create: {
      orgId: r.orgId, storeId: r.storeId, metricId: r.metricId, entityKey: r.entityKey,
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
