/**
 * 初始 Owner 初始化脚本（TASK-003；08 §17.2）。
 * 用法（密码经 stdin 隐藏输入，禁止命令行明文）：
 *   pnpm exec tsx scripts/init-owner.ts --org "组织名" --email a@b.c --name 显示名 [--demo]
 *   read -s -p "Owner 密码: " PW && echo "$PW" | pnpm exec tsx scripts/init-owner.ts ...
 * 或 OWNER_PASSWORD_FILE=受限文件（chmod 600）。
 * 幂等：重复执行返回既有身份，不重设密码、不建第二个 Owner。
 */
import { readFileSync } from "node:fs";
import { createPrismaClient } from "../src/database/prisma";
import { loadDotEnvIfPresent } from "../src/lib/dotenv";
import { loadEnv } from "../src/lib/env";
import { initOwner } from "../src/services/ownerInit";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readPassword(): Promise<string> {
  const file = process.env.OWNER_PASSWORD_FILE;
  if (file) {
    return readFileSync(file, "utf8").trim();
  }
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

  const org = arg("org");
  const email = arg("email");
  const name = arg("name");
  const demo = process.argv.includes("--demo");
  if (!org || !email || !name) {
    process.stderr.write("用法: --org 组织名 --email 邮箱 --name 显示名 [--demo]，密码经 stdin 或 OWNER_PASSWORD_FILE\n");
    return 2;
  }

  const password = await readPassword();
  if (password.length < 8) {
    process.stderr.write("密码至少 8 位\n");
    return 2;
  }

  const db = createPrismaClient(loadEnv());
  try {
    // auth 模块在 import 时校验认证变量，须在 .env 加载后动态引入
    const { getAuth } = await import("../src/lib/auth");
    const result = await initOwner(
      db,
      { orgName: org, email, displayName: name, demoMode: demo, password },
      async (mail, pass, displayName) => {
        const created = await getAuth().api.signUpEmail({
          body: { email: mail, password: pass, name: displayName },
          asResponse: false,
        });
        return { authUserId: created.user.id };
      },
    );
    if (result.alreadyInitialized) {
      process.stdout.write(
        `已初始化过：org=${result.orgId} user=${result.userId}（未改动密码）\n`,
      );
    } else {
      process.stdout.write(`初始化完成：org=${result.orgId} user=${result.userId}\n`);
    }
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
