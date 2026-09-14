import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 420_000,
    // 本机沙箱下 worker 线程 RPC 偶发超时，改为单 fork 进程稳定执行
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
