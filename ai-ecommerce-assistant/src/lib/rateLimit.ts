/**
 * 数据库限流（TASK-003；08 §17.2：限额实现复用认证库/数据库，不增加限流服务）。
 * 固定窗口计数，存 auth_rate_limit 表；进程重启后计数仍有效。
 * key 约定：login-fail:{ip} / invite-accept:{ip} 等，由调用方构造。
 */
import type { PrismaClient } from "@/generated/prisma/client";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * M02｜限流键的客户端标识：仅 TRUST_PROXY_HEADERS=true（默认 false）时采信
 * X-Forwarded-For / X-Real-IP；关闭时所有直连客户端共用 "direct" 桶——伪造
 * 代理头不能更换计数桶。真实反代拓扑验证归 TASK-029；共享桶的可用性边界
 * （直连部署下限流按全局计数）由各入口的限额值吸收。
 */
export function clientIpFromRequest(req: {
  headers: { get(name: string): string | null };
}): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") {
    return "direct";
  }
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

interface RowShape {
  count: number;
  retry_after_s: bigint | number;
}

/**
 * 原子消费一次配额；窗口过期自动重置。
 * 等待秒数在数据库内以 EXTRACT(EPOCH ...) 计算，避免应用层时区解析偏差。
 */
export async function consumeRateLimit(
  db: PrismaClient,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<RowShape[]>`
    INSERT INTO auth_rate_limit (id, key, count, expires_at, updated_at)
    VALUES (gen_random_uuid(), ${key}, 1, now() + make_interval(secs => ${windowSeconds}), now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_rate_limit.expires_at <= now() THEN 1 ELSE auth_rate_limit.count + 1 END,
      expires_at = CASE WHEN auth_rate_limit.expires_at <= now()
                        THEN now() + make_interval(secs => ${windowSeconds})
                        ELSE auth_rate_limit.expires_at END,
      updated_at = now()
    RETURNING count, CEIL(EXTRACT(EPOCH FROM (auth_rate_limit.expires_at - now())))::bigint AS retry_after_s`;

  const row = rows[0];
  if (!row) {
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }
  const count = Number(row.count);
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    retryAfterSeconds: Math.max(0, Number(row.retry_after_s)),
  };
}

/**
 * 只读检查当前配额（不消费）：被限时给出等待秒数；未被限时不增加计数。
 * 用于登录包装层——仅当响应确定为 401 时才真正 consume（M02）。
 */
export async function peekRateLimit(
  db: PrismaClient,
  key: string,
  max: number,
  _windowSeconds: number,
): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<{ count: number; retry_after_s: bigint | number }[]>`
    SELECT count, CEIL(EXTRACT(EPOCH FROM (expires_at - now())))::bigint AS retry_after_s
    FROM auth_rate_limit WHERE key = ${key} AND expires_at > now()`;
  void _windowSeconds;
  const row = rows[0];
  if (!row) return { allowed: true, remaining: max, retryAfterSeconds: 0 };
  const count = Number(row.count);
  return {
    allowed: count < max,
    remaining: Math.max(0, max - count),
    retryAfterSeconds: Math.max(0, Number(row.retry_after_s)),
  };
}

/** 重置某 key（例如登录成功后清除失败计数） */
export async function resetRateLimit(db: PrismaClient, key: string): Promise<void> {
  await db.authRateLimit.deleteMany({ where: { key } });
}

/** 惰性清理过期行（低频调用，防表膨胀） */
export async function pruneRateLimits(db: PrismaClient): Promise<void> {
  await db.$executeRaw`DELETE FROM auth_rate_limit WHERE expires_at < now() - interval '1 day'`;
}
