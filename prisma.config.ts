/**
 * Prisma 7 配置：CLI 不再自动加载 .env，这里显式读取应用根目录 .env
 * （仅取 DATABASE_URL；进程环境优先，不被 .env 覆盖）。
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "prisma/config";

function loadDatabaseUrl(): string {
  const fromProcess = process.env.DATABASE_URL;
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  try {
    const parsed = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
    if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
  } catch {
    // 无 .env 时由 Prisma 报出明确错误
  }
  return "postgresql://localhost:5432/undefined";
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: loadDatabaseUrl(),
  },
});
