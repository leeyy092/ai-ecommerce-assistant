/**
 * Better Auth 最小配置（仅用于 CLI 生成官方 Prisma 认证表，TASK-002）。
 * Prisma 7 客户端使用 driver adapter；连接串来自进程环境或应用根 .env。
 * 完整认证实现（登录/邀请/会话）属 TASK-003 的 src/lib/auth.ts。
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const parsed = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
  return parsed.DATABASE_URL ?? "postgresql://localhost:5432/undefined";
}

export const auth = betterAuth({
  database: prismaAdapter(
    new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) }),
    { provider: "postgresql" },
  ),
  emailAndPassword: {
    enabled: true,
  },
});
