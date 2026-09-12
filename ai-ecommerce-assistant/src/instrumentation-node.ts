/**
 * Web 进程（Node runtime）启动环境校验。
 * TASK-003 起认证组件启用：BETTER_AUTH_SECRET/BETTER_AUTH_URL 成为启动必需变量。
 * 缺失时输出安全且明确的错误并以非零码退出；错误信息只含变量名，不含任何值。
 */
import { loadDotEnvIfPresent } from "./lib/dotenv";
import { loadEnv } from "./lib/env";

try {
  loadDotEnvIfPresent();
  loadEnv(["auth"]);
} catch (error) {
  const message = error instanceof Error ? error.message : "启动环境变量校验失败";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
