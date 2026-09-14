/**
 * 真实 PostgreSQL 连通性集成测试（TASK-001）。
 * 前置：本地 PostgreSQL 17 实例已启动且 .env 的 DATABASE_URL 指向它。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../helpers/pgMigrate";
import { loadEnv } from "@/lib/env";
import { createDbPool, pingDb, type DbPool } from "@/lib/db";

// H11：进程环境 DATABASE_URL 优先（外部注入的隔离集群不被 .env 覆盖）；本套件只做只读连通性检查
process.env.DATABASE_URL = resolveDatabaseUrl();
const env = loadEnv();

let pool: DbPool;
beforeAll(async () => {
  pool = createDbPool(env);
});
afterAll(async () => {
  await pool.end();
});

describe("真实 PostgreSQL 连通（TASK-001）", () => {
  it("SELECT 1 成功", async () => {
    const result = await pool.query<{ ok: number }>("SELECT 1 AS ok");
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("服务器为主合同约定的 PostgreSQL 17", async () => {
    const result = await pool.query<{ server_version: string }>("SHOW server_version");
    expect(result.rows[0]?.server_version.startsWith("17")).toBe(true);
  });

  it("pingDb 对正常连接返回 true", async () => {
    await expect(pingDb(pool)).resolves.toBe(true);
  });

  it("pingDb 对不可达数据库返回 false（健康接口 degraded 判定依据）", async () => {
    const bad = createDbPool(
      { databaseUrl: "postgres://nobody:none@127.0.0.1:1/none" },
      { connectionTimeoutMillis: 500 },
    );
    try {
      await expect(pingDb(bad, 1500)).resolves.toBe(false);
    } finally {
      await bad.end().catch(() => {});
    }
  });
});
