/**
 * 数据库连接串解析（TASK-001；M05 统一非默认数据库口令配置）。
 * 供 prisma.config.ts（CLI/迁移）与 src/lib/env.ts（应用运行时）共用，保证
 * PostgreSQL、Web、Worker 使用同一份口令配置。
 *
 * 优先级：进程 DATABASE_URL → 根目录 .env 的 DATABASE_URL →
 * PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE 分量组装（user/password 经
 * encodeURIComponent，口令含 URL 保留字符时仍正确）。全部缺失返回空串，
 * 由调用方给出明确错误，不猜测连接目标。
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

type VarSource = Record<string, string | undefined>;

export function resolveDbUrl(source: VarSource = process.env, allowDotenv = true): string {
  if (source.DATABASE_URL && source.DATABASE_URL.length > 0) return source.DATABASE_URL;
  if (allowDotenv) {
    try {
      const parsed = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
      if (parsed.DATABASE_URL && parsed.DATABASE_URL.length > 0) return parsed.DATABASE_URL;
    } catch {
      // 无 .env 文件：继续走分量组装
    }
  }
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = source;
  if (PGHOST && PGUSER && PGDATABASE) {
    const auth =
      PGPASSWORD !== undefined && PGPASSWORD !== ""
        ? `${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}`
        : encodeURIComponent(PGUSER);
    return `postgresql://${auth}@${PGHOST}:${PGPORT ?? "5432"}/${PGDATABASE}`;
  }
  return "";
}
