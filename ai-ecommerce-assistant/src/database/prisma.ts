/**
 * Prisma 客户端（TASK-002）。
 * Prisma 7 使用 driver adapter（@prisma/adapter-pg）连接 PostgreSQL；
 * 连接串来自进程环境或应用根 .env（经 src/lib/env.ts 校验）。
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv, type AppEnv } from "@/lib/env";

export function createPrismaClient(env: Pick<AppEnv, "databaseUrl">): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.databaseUrl }),
  });
}

/** 开发模式 HMR 下复用同一客户端，避免连接泄漏 */
export function getPrismaClient(): PrismaClient {
  const g = globalThis as typeof globalThis & { __aieaPrisma?: PrismaClient };
  if (!g.__aieaPrisma) {
    loadDotEnvIfPresent();
    g.__aieaPrisma = createPrismaClient(loadEnv());
  }
  return g.__aieaPrisma;
}
