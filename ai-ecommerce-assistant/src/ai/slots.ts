/**
 * TASK-017｜跨进程执行闸（T017R2 H03 修复版）。
 *
 * 合同（06 §8.2）：全局最多 2 个 LLM 请求、单组织同时 1 个。R1 用组织级 xact 锁包住
 * 网络调用的长事务在崩溃时回滚 claim/预留（J02）；本实现改为专用连接上的
 * 会话级 advisory lock：锁不依赖事务，进程崩溃即连接断开、PG 自动释放，
 * 与"调用前独立提交 claim"配合实现可恢复的并发边界（全局2/组织1）。
 */
import { Client } from "pg";

const GLOBAL_SLOT_KEYS = ["ai-global-slot-0", "ai-global-slot-1"];

export interface ExecutionSlots {
  release(): Promise<void>;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 未配置（执行闸需要专用连接）");
  return url;
}

/**
 * 获取执行闸：先抢占两个全局槽位之一（try），都满则阻塞等待槽位0；
 * 再阻塞获取组织锁。同一专用会话持有全部锁，release 一次性解锁并断开。
 * 崩溃时连接断开 → 会话锁自动释放，不会死锁残留。
 */
export async function acquireExecutionSlots(orgId: string): Promise<ExecutionSlots> {
  const conn = new Client({ connectionString: connectionString() });
  await conn.connect();
  try {
    let heldGlobal = false;
    for (const slot of GLOBAL_SLOT_KEYS) {
      const res = await conn.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [slot]);
      if (res.rows[0].ok) { heldGlobal = true; break; }
    }
    if (!heldGlobal) {
      await conn.query("SELECT pg_advisory_lock(hashtext($1))", [GLOBAL_SLOT_KEYS[0]]);
    }
    await conn.query("SELECT pg_advisory_lock(hashtext($1))", [`ai-org-exec:${orgId}`]);
    let released = false;
    return {
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          await conn.query("SELECT pg_advisory_unlock_all()");
        } finally {
          await conn.end().catch(() => undefined);
        }
      },
    };
  } catch (error) {
    await conn.end().catch(() => undefined);
    throw error;
  }
}
