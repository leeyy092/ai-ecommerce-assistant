/**
 * TASK-013｜快照重建队列 handler（薄封装；状态机/构建/发布在 services/snapshot）。
 */
import { getPrismaClient } from "@/database/prisma";
import { runRebuildJob, type RebuildOutcome } from "@/services/snapshot";

export async function handleRebuildJob(data: { jobRunId: string }): Promise<RebuildOutcome> {
  const db = getPrismaClient();
  return runRebuildJob(data.jobRunId, db);
}
