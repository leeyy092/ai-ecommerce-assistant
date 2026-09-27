/**
 * TASK-013｜快照重建队列 handler（薄封装；状态机/构建/发布在 services/snapshot）。
 */
import { getPrismaClient } from "@/database/prisma";
import { runRebuildJob, type RebuildOutcome } from "@/services/snapshot";
import { registerBasicMetricsBuilder } from "@/services/metrics/basic";

// TASK-014 起注册真实构建器（幂等；cohort=015/rules=016 完成后追加，注册表不齐不发布）
registerBasicMetricsBuilder();

export async function handleRebuildJob(data: { jobRunId: string }): Promise<RebuildOutcome> {
  const db = getPrismaClient();
  return runRebuildJob(data.jobRunId, db);
}
