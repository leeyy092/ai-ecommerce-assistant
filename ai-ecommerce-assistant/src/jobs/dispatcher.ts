/**
 * 最小 dispatcher（TASK-007；11_DEVELOPMENT_RULES §14.2）：
 * 修复"数据库建账成功、队列投递丢失"窗口（G2-H08 窗口2）。
 * - sweepDispatches：uploaded + outbox=pending 且超过 stale 窗口的任务重新投递并标
 *   dispatched。幂等安全：validate handler 对终态任务直接跳过，重复作业无副作用。
 * - sweepStuckValidations：validating 超时（进程中断/队列重试耗尽未落终态）→
 *   failed + VALIDATE_INTERRUPTED 明确终态，保证任何中断都有可诊断恢复边界。
 * TASK-013 将在此骨架上扩展完整阶段状态机与发布锁，不提前实现。
 */
import { getPrismaClient } from "@/database/prisma";
import { getBoss, QUEUE_VALIDATE } from "./queue";

/** 常规投递失败（网络/队列表瞬时拒绝）后的兜底重投窗口 */
const PENDING_DISPATCH_STALE_MS = 60_000;
/** validating 悬挂判定窗口：20MB/10 万行校验远小于该值；中断后落终态 */
const VALIDATING_STALE_MS = 10 * 60_000;

export interface DispatchSweepResult {
  dispatched: number;
  failedStale: number;
}

export async function sweepDispatches(now = Date.now()): Promise<DispatchSweepResult> {
  const prisma = getPrismaClient();
  const boss = await getBoss();

  const staleBefore = new Date(now - PENDING_DISPATCH_STALE_MS);
  const pending = await prisma.importTask.findMany({
    where: { status: "uploaded", outboxStatus: "pending", rawObjectKey: { not: "" }, updatedAt: { lt: staleBefore } },
    select: { id: true },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  let dispatched = 0;
  for (const task of pending) {
    try {
      await boss.send(QUEUE_VALIDATE, { taskId: task.id }, { retryLimit: 1, retryDelay: 5 });
      await prisma.importTask.updateMany({
        where: { id: task.id, outboxStatus: "pending" },
        data: { outboxStatus: "dispatched" },
      });
      dispatched += 1;
    } catch {
      // 本轮放弃，下一轮 sweep 重试（任务仍保持 uploaded+pending 可诊断）
    }
  }

  const stuckBefore = new Date(now - VALIDATING_STALE_MS);
  const stuck = await prisma.importTask.updateMany({
    where: { status: "validating", updatedAt: { lt: stuckBefore } },
    data: { status: "failed", errorCode: "VALIDATE_INTERRUPTED" },
  });

  return { dispatched, failedStale: stuck.count };
}
