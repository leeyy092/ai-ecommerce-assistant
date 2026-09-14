/**
 * Prisma 客户端（TASK-002）。
 * Prisma 7 使用 driver adapter（@prisma/adapter-pg）连接 PostgreSQL；
 * 连接串来自进程环境或应用根 .env（经 src/lib/env.ts 校验）。
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv, type AppEnv } from "@/lib/env";

/**
 * H12｜会话时区强制（启动参数在连接建立时生效，非池内事后一次性 SET）。
 * 锁定的 adapter 7.10 直接替换 timestamptz 返回值的偏移标识而不换算墙钟；
 * 非 UTC 会话（如集群默认 Asia/Shanghai）下 ORM 读写与数据库真实时刻偏移。
 * Web/Worker/Better Auth/CLI（init-owner）与集成测试统一走本工厂。
 */
export const UTC_SESSION_OPTIONS = "-c timezone=UTC";

/** 创建强制 UTC 会话的连接池（应用与集成测试共用同一语义）。
 * 注意：外部传给 PrismaPg 的 Pool 不由 PrismaClient.$disconnect 关闭——
 * 使用方（测试套件）须在删除测试库前自行 end，避免连接被 terminate。 */
export function createUtcPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    options: UTC_SESSION_OPTIONS,
  });
  // 兜底：若启动参数被中间层剥离，每条连接仍在其首个业务查询前回 SET；
  // SET 幂等，失败不阻断连接（options 为主保障）
  pool.on("connect", (client) => {
    void client.query("SET TIME ZONE 'UTC'").catch(() => undefined);
  });
  // 空闲连接被服务器端终止（如测试删库 terminate、管理员干预）时不再作为
  // 未捕获异常冒泡——pg-pool 要求监听该事件
  pool.on("error", () => undefined);
  return pool;
}

export function createPrismaClient(env: Pick<AppEnv, "databaseUrl">): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(createUtcPool(env.databaseUrl)),
  });
}

/** 开发模式 HMR 下复用同一客户端，避免连接泄漏 */
export function getPrismaClient(): PrismaClient {
  const g = globalThis as typeof globalThis & {
    __aieaPrisma?: PrismaClient;
    __aieaClientPool?: Pool;
  };
  if (!g.__aieaPrisma) {
    loadDotEnvIfPresent();
    g.__aieaClientPool = createUtcPool(loadEnv().databaseUrl);
    g.__aieaPrisma = new PrismaClient({ adapter: new PrismaPg(g.__aieaClientPool) });
  }
  return g.__aieaPrisma;
}

/** 测试隔离：关闭当前单例持有并关闭其连接池（必须在删除测试库前调用） */
export async function resetClientPool(): Promise<void> {
  const g = globalThis as typeof globalThis & {
    __aieaPrisma?: PrismaClient;
    __aieaClientPool?: Pool;
  };
  await g.__aieaClientPool?.end().catch(() => undefined);
  g.__aieaClientPool = undefined;
  g.__aieaPrisma = undefined;
}
