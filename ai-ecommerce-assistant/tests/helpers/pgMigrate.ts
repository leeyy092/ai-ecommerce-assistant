/**
 * 测试专用迁移执行器与测试库生命周期（Gate-01 REVIEW_4 修订）。
 *
 * H11 修复约定：
 * - 每次测试运行创建唯一命名的测试库（aiea_t_<tag>），重建前只终止连接到
 *   **本测试库** 的会话；绝不按 datname 模糊匹配清理其他数据库。
 * - 数据库连接串的优先级：进程环境 DATABASE_URL 优先（外部注入的隔离集群
 *   不被覆盖）；仅当未注入时才从磁盘 .env 读取基线。
 *
 * M06 修订（不宣称与官方等价）：
 * - 本辅助器只用于集成测试建库与“升级守卫”夹具（applyMigrationsUpTo 的
 *   upTo 语义 = 按文件名顺序执行到（含）指定迁移后停止，官方 CLI 无此能力）。
 * - _prisma_migrations 行已补全官方列（started_at/rolled_back_at 等），
 *   使官方 `prisma migrate deploy` 可识别已应用迁移并接续；但 checksum 为
 *   文件 SHA256、无失败重试语义，测试用途之外不应依赖。
 * - 官方 CLI 的空库/重复/升级检查以独立工作副本上的真实
 *   `prisma migrate deploy` 为准（本机 iCloud 目录下 node_modules 可能被
 *   驱逐导致 CLI 同步读取挂死，见 12_PROGRESS R4 记录）。
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
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
        "rolled_back_at" TIMESTAMPTZ
      )`);
    // 兼容旧表结构（缺官方列时补齐，保证官方 migrate deploy 可查询）
    await client.query(`ALTER TABLE "_prisma_migrations" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ NOT NULL DEFAULT now()`);
    await client.query(`ALTER TABLE "_prisma_migrations" ADD COLUMN IF NOT EXISTS "rolled_back_at" TIMESTAMPTZ`);
    const done = new Set(
      (await client.query<{ migration_name: string }>(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      )).rows.map((r) => r.migration_name),
    );
    const dirs = readdirSync(MIGRATIONS_DIR)
      .filter((d) => /^\d+_/.test(d))
      .sort();
    // M06：先按 upTo 截断本次目标集合，再排除已执行项——目标已应用时重复调用
    // 不再越过目标继续执行；目标不存在时明确失败而非静默全量。
    let targets = dirs;
    if (upTo) {
      const idx = dirs.indexOf(upTo);
      if (idx === -1) {
        throw new Error(`applyMigrationsUpTo：目标迁移 ${upTo} 不存在于 prisma/migrations`);
      }
      targets = dirs.slice(0, idx + 1);
    }
    for (const dir of targets) {
      if (done.has(dir)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, started_at, finished_at, migration_name, logs, applied_steps_count, rolled_back_at)
           VALUES ($1, $2, now(), now(), $3, NULL, 1, NULL)`,
          [randomUUID(), createHash("sha256").update(sql).digest("hex"), dir],
        );
        await client.query("COMMIT");
        applied.push(dir);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

/** 仅执行到（含）指定迁移，用于升级路径故障注入夹具；非官方等价实现，见文件头 M06 说明 */
export async function applyMigrationsUpTo(databaseUrl: string, upTo: string): Promise<string[]> {
  return applyMigrations(databaseUrl, upTo);
}

/**
 * H11｜创建本次运行唯一命名的测试库。
 * - 库名 aiea_t_<tag>（tag 随机），不与开发库或其他测试库同名冲突；
 * - 若同名库已存在（同进程重复初始化等），仅终止连接到**该库**的会话后重建；
 * - 绝不按 datname 模糊匹配触碰集群内其他数据库。
 */
export async function createTestDatabase(adminUrl: string, tag: string): Promise<string> {
  const dbName = `aiea_t_${tag}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 63);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = (await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_database WHERE datname = $1`,
      [dbName],
    )).rows[0].n;
    if (exists > 0) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await admin.query(`DROP DATABASE "${dbName}"`);
    }
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
  const base = new URL(adminUrl);
  base.pathname = `/${dbName}`;
  return base.toString();
}

/** H11｜删除本次测试创建的库（仅限本函数创建的唯一命名库），忽略不存在 */
export async function dropTestDatabase(adminUrl: string, testUrl: string): Promise<void> {
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");
  if (!/^aiea_t_/.test(dbName)) {
    throw new Error(`拒绝删除非测试命名规则的数据库：${dbName}`);
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  admin.on("error", () => undefined);
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await admin.end();
  }
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

/**
 * H11｜数据库连接串解析：基线在 vitest.config 启动时求值并经 test.env 固化为
 * AIEA_TEST_BASE_DB（外部注入的隔离集群优先，不被磁盘 .env 或先跑文件改写）。
 * 仅当该变量缺失（如单文件直跑）时回退 .env 基线；两者皆无则给出明确错误。
 */
export function resolveDatabaseUrl(): string {
  const injected = process.env.AIEA_TEST_BASE_DB;
  if (injected && injected.length > 0) return injected;
  const { parseEnv } = require("node:util") as typeof import("node:util");
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const parsed = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
  if (!parsed.DATABASE_URL) {
    throw new Error("测试基线数据库未定义（AIEA_TEST_BASE_DB / .env DATABASE_URL 均缺失），拒绝猜测连接目标");
  }
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
