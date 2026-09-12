/**
 * Worker 运行状态文件（TASK-001）。
 * Worker 周期性写入 .runtime/worker-status.json；
 * src/jobs/status.ts 与容器健康检查读取它判断 Worker 是否存活。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RUNTIME_DIR = path.resolve(process.cwd(), ".runtime");
export const WORKER_STATUS_FILE = path.join(RUNTIME_DIR, "worker-status.json");

/** 心跳间隔与判定新鲜度阈值 */
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_STALE_MS = 15_000;

export type WorkerState = "starting" | "running" | "stopped" | "failed";

export interface WorkerStatus {
  state: WorkerState;
  pid: number;
  started_at: string;
  last_beat_at: string;
  db_ok: boolean;
}

export function writeWorkerStatus(status: WorkerStatus): void {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmp = `${WORKER_STATUS_FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`);
  renameSync(tmp, WORKER_STATUS_FILE);
}

export function readWorkerStatus(): WorkerStatus | null {
  try {
    const raw = readFileSync(WORKER_STATUS_FILE, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as WorkerStatus;
  } catch {
    return null;
  }
}
