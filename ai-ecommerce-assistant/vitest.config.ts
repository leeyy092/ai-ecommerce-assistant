import path from "node:path";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

/**
 * H11：测试基线连接串在 vitest 启动时求值一次（外部注入的 DATABASE_URL 优先，
 * 未注入时读 .env），经 test.env 固化给每个测试文件；文件内不得再依赖
 * process.env.DATABASE_URL（会被同进程先跑的文件改写），一律读 AIEA_TEST_BASE_DB。
 */
function baselineDbUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0) {
    return process.env.DATABASE_URL;
  }
  try {
    const parsed = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
    if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
  } catch {
    // 无 .env：由 resolveDatabaseUrl 在测试内给出明确错误
  }
  return "";
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    env: {
      AIEA_TEST_BASE_DB: baselineDbUrl(),
    },
    testTimeout: 60_000,
    hookTimeout: 420_000,
    // 本机沙箱下 worker 线程 RPC 偶发超时，改为单 fork 进程稳定执行
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
