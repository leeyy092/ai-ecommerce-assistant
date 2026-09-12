/**
 * Worker 运行状态检查（TASK-001）。
 * 退出码 0 = Worker 存活且心跳新鲜；退出码 1 = 未运行 / 心跳过期 / 状态异常。
 * 供人工检查、脚本与容器 healthcheck 使用。
 */
import {
  HEARTBEAT_STALE_MS,
  readWorkerStatus,
  WORKER_STATUS_FILE,
} from "../lib/workerStatus";

const status = readWorkerStatus();

if (!status) {
  process.stderr.write(
    `worker 未在运行：未找到状态文件（${WORKER_STATUS_FILE}）或内容为空\n`,
  );
  process.exit(1);
}

const ageMs = Date.now() - Date.parse(status.last_beat_at);
if (status.state !== "running") {
  process.stderr.write(
    `worker 未在运行：状态=${status.state}，最后心跳=${status.last_beat_at}\n`,
  );
  process.exit(1);
}
if (!Number.isFinite(ageMs) || ageMs > HEARTBEAT_STALE_MS) {
  process.stderr.write(
    `worker 心跳过期：最后心跳=${status.last_beat_at}（超过 ${HEARTBEAT_STALE_MS}ms）\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `worker running: pid=${status.pid} last_beat=${status.last_beat_at} db_ok=${status.db_ok}\n`,
);
process.exit(0);
