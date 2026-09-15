/**
 * E2E 种子（TASK-003）：在 aiea_dev 初始化演示 Owner（幂等）。
 * 密码来自环境变量 E2E_OWNER_PASSWORD（CI/本地统一注入），不写入仓库。
 */
import { execFileSync } from "node:child_process";

const EMAIL = "owner-e2e@aiea.local";
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "e2e-owner-pass-123";

export default async function globalSetup(): Promise<void> {
  execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/init-owner.ts", "--org", "E2E 演示组织", "--email", EMAIL, "--name", "E2E Owner"],
    {
      cwd: process.cwd(),
      env: { ...process.env, E2E_OWNER_PASSWORD: PASSWORD },
      input: `${PASSWORD}\n`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
      // tsx 冷启动 + Prisma/Better Auth 导入在 iCloud 同步目录下约 60s，与 webServer 并发时更慢，预留 300s
      timeout: 300_000,
    },
  );
}

export const E2E_OWNER = { email: EMAIL, password: PASSWORD };
