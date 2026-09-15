/**
 * 独立 Worker 入口（TASK-001）。
 * 职责限定：启动 → 校验环境 → PostgreSQL 连通检查 → 周期心跳状态 → 正常退出。
 * pg-boss 队列、业务 handler 与 dispatcher 在 TASK-007 起实施，
 * 此处不注册空的导入/AI/日报任务冒充可用。
 */
import pino from "pino";
import { loadDotEnvIfPresent } from "../lib/dotenv";
import { EnvValidationError, loadEnv } from "../lib/env";
import { createDbPool, pingDb } from "../lib/db";
import {
  HEARTBEAT_INTERVAL_MS,
  writeWorkerStatus,
  type WorkerStatus,
} from "../lib/workerStatus";

const startedAt = new Date().toISOString();
const pid = process.pid;

function beat(state: WorkerStatus["state"], dbOk: boolean): WorkerStatus {
  const status: WorkerStatus = {
    state,
    pid,
    started_at: startedAt,
    last_beat_at: new Date().toISOString(),
    db_ok: dbOk,
  };
  writeWorkerStatus(status);
  return status;
}

async function main(): Promise<number> {
  loadDotEnvIfPresent();

  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write("环境变量校验发生未知错误\n");
    }
    beat("failed", false);
    return 1;
  }

  const logger = pino({ level: env.logLevel, base: { service: "worker" } });
  logger.info("worker 启动中：开始 PostgreSQL 连通检查");

  beat("starting", false);
  const pool = createDbPool(env);
  const dbOk = await pingDb(pool, 5000);
  if (!dbOk) {
    logger.error(
      "worker 启动失败：无法连接 PostgreSQL（DATABASE_URL 指向的数据库不可达或凭据无效）",
    );
    beat("failed", false);
    await pool.end().catch(() => {});
    return 1;
  }

  logger.info("worker 运行中：数据库连接正常，心跳间隔 %dms", HEARTBEAT_INTERVAL_MS);
  beat("running", true);

  // TASK-007：pg-boss 持久队列与 dispatcher——注册 validate/commit 边界
  const { getBoss, ensureQueues, QUEUE_VALIDATE, QUEUE_COMMIT } = await import("./queue");
  const { handleValidateTask, handleCommitTask } = await import("./handlers/imports");
  const { sweepDispatches } = await import("./dispatcher");
  try {
    const boss = await getBoss();
    await ensureQueues(boss);
    await boss.work<{ taskId: string }>(QUEUE_VALIDATE, async (jobs) => {
      const results = [];
      for (const job of jobs) {
        logger.info({ job_id: job.id, task: job.data }, "import-validate 开始");
        // pg-boss 12 work 类型未暴露 retry 计数，运行时字段存在（重试耗尽判定用）
        const retry = job as typeof job & { retryCount?: number; retryLimit?: number };
        const result = await handleValidateTask(job.data, {
          retryCount: retry.retryCount,
          retryLimit: retry.retryLimit,
        });
        logger.info({ job_id: job.id, ...result }, "import-validate 完成");
        results.push(result);
      }
      return results;
    });
    await boss.work<{ taskId: string }>(QUEUE_COMMIT, async (jobs) => {
      for (const job of jobs) {
        logger.warn({ job_id: job.id, task: job.data }, "import-commit 边界被触发（TASK-008 实现前不应入队）");
        await handleCommitTask(job.data);
      }
    });
    logger.info("pg-boss 队列就绪：%s / %s", QUEUE_VALIDATE, QUEUE_COMMIT);
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : error }, "pg-boss 队列初始化失败");
    beat("failed", true);
    await pool.end().catch(() => {});
    return 1;
  }

  // G2-H08：dispatcher 周期兜底——投递丢失窗口与悬挂 validating 的恢复边界
  const dispatchTimer = setInterval(() => {
    void sweepDispatches().catch((error: unknown) => {
      logger.warn({ err: error instanceof Error ? error.message : error }, "dispatcher sweep 失败（下轮重试）");
    });
  }, 30_000);
  void sweepDispatches().catch(() => undefined);

  const heartbeat = setInterval(() => beat("running", true), HEARTBEAT_INTERVAL_MS);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    clearInterval(dispatchTimer);
    logger.info({ signal }, "worker 收到退出信号，正在停止");
    beat("stopped", true);
    void pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return 0;
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
