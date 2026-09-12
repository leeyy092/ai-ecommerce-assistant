/**
 * 尽力加载应用根目录的 .env（存在时）。
 * Next.js dev/start 会自动加载 .env；独立 Worker 与测试通过本函数获得一致行为。
 * 已存在于进程环境中的变量优先，不被 .env 覆盖；文件不存在时静默跳过。
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function loadDotEnvIfPresent(path = ".env"): boolean {
  try {
    const content = readFileSync(path, "utf8");
    const parsed = parseEnv(content) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined && value !== undefined) {
        process.env[key] = value;
      }
    }
    return true;
  } catch {
    return false;
  }
}
