/**
 * PostgreSQL 连接（TASK-001 仅用于健康检查与 Worker 连通性验证）。
 * 正式数据访问层（Prisma）在 TASK-002 建立。
 */
import pg from "pg";
import type { AppEnv } from "./env";

export type DbPool = pg.Pool;

export function createDbPool(env: Pick<AppEnv, "databaseUrl">, overrides: pg.PoolConfig = {}): DbPool {
  return new pg.Pool({
    connectionString: env.databaseUrl,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000,
    ...overrides,
  });
}

/** 开发模式 HMR 下复用同一连接池，避免句柄泄漏 */
export function getDbPool(env: Pick<AppEnv, "databaseUrl">): DbPool {
  const g = globalThis as typeof globalThis & { __aieaDbPool?: DbPool };
  g.__aieaDbPool ??= createDbPool(env);
  return g.__aieaDbPool;
}

/** 在限时内执行 SELECT 1；成功返回 true，任何失败（含超时）返回 false */
export async function pingDb(pool: DbPool, timeoutMs = 1500): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = pool.query("SELECT 1");
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ping timeout")), timeoutMs);
    });
    await Promise.race([probe, deadline]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
