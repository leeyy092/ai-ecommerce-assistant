/**
 * TASK-013｜快照重建队列 handler（薄封装；状态机/构建/发布在 services/snapshot）。
 */
import { getPrismaClient } from "@/database/prisma";
import { runRebuildJob, type RebuildOutcome } from "@/services/snapshot";
import { registerBasicMetricsBuilder } from "@/services/metrics/basic";
import { registerCohortMetricsBuilder } from "@/services/metrics/cohort";
import { registerRulesBuilder } from "@/services/alerts/engine";

// TASK-014/015/016 真实构建器齐备（幂等注册；三项不齐不发布）
registerBasicMetricsBuilder();
registerCohortMetricsBuilder();
registerRulesBuilder();

export async function handleRebuildJob(data: { jobRunId: string }): Promise<RebuildOutcome> {
  const db = getPrismaClient();
  return runRebuildJob(data.jobRunId, db);
}
