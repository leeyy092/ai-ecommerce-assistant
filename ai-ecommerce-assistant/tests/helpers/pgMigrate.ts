/**
 * 测试专用迁移执行器（Gate-01 R3）：
 * 规避本机 Prisma CLI 每次启动约 10 分钟的空转（与端点无关，疑为 agent/skills 守护）。
 * 直接用 pg 简单查询协议执行 prisma/migrations/*.sql（支持 $$ 函数体多语句），
 * 并写入 Prisma 兼容的 _prisma_migrations 行（checksum=文件 SHA256），
 * 使后续真实 `prisma migrate deploy` 仍识别为已应用。
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../prisma/migrations");

export async function applyMigrations(databaseUrl: string, upTo?: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`);
    const done = new Set(
      (await client.query<{ migration_name: string }>(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
      )).rows.map((r) => r.migration_name),
    );
    const dirs = readdirSync(MIGRATIONS_DIR)
      .filter((d) => /^\d+_/.test(d))
      .sort();
    for (const dir of dirs) {
      if (done.has(dir)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
           VALUES ($1, $2, now(), $3, 0)`,
          [randomUUID(), createHash("sha256").update(sql).digest("hex"), dir],
        );
        await client.query("COMMIT");
        applied.push(dir);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      if (upTo && dir === upTo) break;
    }
    return applied;
  } finally {
    await client.end();
  }
}

/** 仅执行到（含）指定迁移，用于升级路径故障注入 */
export async function applyMigrationsUpTo(databaseUrl: string, upTo: string): Promise<string[]> {
  return applyMigrations(databaseUrl, upTo);
}

/**
 * 测试辅助：singleFork 下多文件共享进程，重置 Prisma/Auth 全局单例，
 * 使每个测试文件绑定自己的 DATABASE_URL。
 */
export function resetDbSingletons(): void {
  (globalThis as { __aieaPrisma?: unknown }).__aieaPrisma = undefined;
  // 同步重置 better-auth 懒实例（其 adapter 持有旧库连接池）
  const g = globalThis as { __require_auth_reset__?: () => void };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    g.__require_auth_reset__?.();
  } catch {
    /* 忽略：未注入时跳过 */
  }
}


/** singleFork 共享进程：从磁盘 .env 重读 DATABASE_URL 基线（忽略进程内被测试改写的值） */
export function baseUrlFromDotenv(): string {
  const { parseEnv } = require("node:util") as typeof import("node:util");
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const parsed = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
  return parsed.DATABASE_URL;
}


/** M04 FK 后的测试夹具：先建 AuthUser 再建领域 User（自动配对唯一 email） */
export async function seedUserPair(
  prisma: { authUser: { create: (a: unknown) => Promise<{ id: string }> }; user: { create: (b: unknown) => Promise<{ id: string }> } },
  opts: { tag: string; email?: string },
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? `${opts.tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const auth = await prisma.authUser.create({
    data: { id: `auth-${opts.tag}-${Math.floor(Math.random() * 1e9).toString(36)}`, name: opts.tag, email },
  });
  const user = await prisma.user.create({
    data: { id: crypto.randomUUID(), authUserId: auth.id, email, displayName: opts.tag },
  });
  return { id: user.id, email };
}
