/**
 * Web 进程（Node runtime）启动环境校验。
 * 缺少启动必需变量（如 DATABASE_URL）时输出安全且明确的错误并以非零码退出，
 * 而不是静默启动后所有请求失败。错误信息只含变量名，不含任何值。
 */
import { loadDotEnvIfPresent } from "./lib/dotenv";
import { loadEnv } from "./lib/env";

try {
  loadDotEnvIfPresent();
  loadEnv();
} catch (error) {
  const message = error instanceof Error ? error.message : "启动环境变量校验失败";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
