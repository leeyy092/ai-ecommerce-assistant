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

  const heartbeat = setInterval(() => beat("running", true), HEARTBEAT_INTERVAL_MS);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
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
