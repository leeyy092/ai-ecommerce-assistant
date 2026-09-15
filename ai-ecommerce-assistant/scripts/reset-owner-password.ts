/**
 * 一次性密码重置脚本（TASK-003；08 §17.2）。
 * 由部署管理员核验身份后在本机受限环境执行；重置并撤销该用户全部旧会话。
 * 密码经 stdin 或 RESET_PASSWORD_FILE 传入，禁止命令行明文；普通 Admin 无此通道。
 */
import { readFileSync } from "node:fs";
import { createPrismaClient } from "../src/database/prisma";
import { loadDotEnvIfPresent } from "../src/lib/dotenv";
import { loadEnv } from "../src/lib/env";
import { resetUserPassword } from "../src/services/ownerInit";
import { hashPassword } from "better-auth/crypto";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readPassword(): Promise<string> {
  const file = process.env.RESET_PASSWORD_FILE;
  if (file) return readFileSync(file, "utf8").trim();
  return new Promise<string>((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function main(): Promise<number> {
  loadDotEnvIfPresent();
  loadEnv(["auth"]);

  const email = arg("email");
  if (!email) {
    process.stderr.write("用法: --email 用户邮箱；新密码经 stdin 或 RESET_PASSWORD_FILE\n");
    return 2;
  }
  const password = await readPassword();
  if (password.length < 8) {
    process.stderr.write("密码至少 8 位\n");
    return 2;
  }

  const db = createPrismaClient(loadEnv());
  try {
    await resetUserPassword(db, email, await hashPassword(password));
    process.stdout.write("密码已重置，全部旧会话已撤销\n");
    return 0;
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
