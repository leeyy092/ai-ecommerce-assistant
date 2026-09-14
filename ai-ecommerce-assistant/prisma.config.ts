/**
 * Prisma 7 配置：CLI 不再自动加载 .env，连接串解析与应用共用 src/lib/dbUrl
 * （进程 DATABASE_URL 优先 → .env → PG* 分量组装；M05 统一数据库口令配置）。
 */
import path from "node:path";
import { defineConfig } from "prisma/config";
import { resolveDbUrl } from "./src/lib/dbUrl";

function loadDatabaseUrl(): string {
  // 全部来源缺失时保持原有兜底：CLI 连接失败并报出明确错误
  return resolveDbUrl() || "postgresql://localhost:5432/undefined";
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
