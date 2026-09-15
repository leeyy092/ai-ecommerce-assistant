/**
 * pg-boss 最小持久队列（TASK-007）。
 * 复用应用 DATABASE_URL；仅注册导入链路所需的 validate/commit 两个队列，
 * 供后续 TASK（008+ 校验/提交编排）在既有边界上扩展。
 */
import { PgBoss } from "pg-boss";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv } from "@/lib/env";

export const QUEUE_VALIDATE = "import-validate";
export const QUEUE_COMMIT = "import-commit";

const g = globalThis as typeof globalThis & { __aieaBoss?: PgBoss };

export async function getBoss(): Promise<PgBoss> {
  if (!g.__aieaBoss) {
    loadDotEnvIfPresent();
    const { databaseUrl } = loadEnv();
    const boss = new PgBoss({ connectionString: databaseUrl, max: 2 });
    // pg-boss 内部连接被服务器端终止（如测试删库）时不作为未捕获异常冒泡
    boss.on("error", () => undefined);
    g.__aieaBoss = await boss.start();
  }
  return g.__aieaBoss;
}

/** 幂等建队列（pg-boss 12：createQueue 已存在时幂等返回） */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUE_VALIDATE);
  await boss.createQueue(QUEUE_COMMIT);
}

export async function enqueueValidate(taskId: string): Promise<string | null> {
  const boss = await getBoss();
  await ensureQueues(boss);
  return boss.send(QUEUE_VALIDATE, { taskId }, { retryLimit: 1, retryDelay: 5 });
}
