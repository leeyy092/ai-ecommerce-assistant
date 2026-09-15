/**
 * Better Auth 实例（TASK-003；Gate-01 H10 修复：懒加载）。
 * 实例与认证环境校验延迟到首次使用——`next build` 收集路由数据时不再要求
 * BETTER_AUTH_SECRET/URL；运行时首个请求/任务仍强校验（缺失即抛明确错误）。
 * 生产秘密不进入镜像：compose/部署环境在运行时注入。
 * 认证表为 Better Auth 官方结构；Prisma 模型名 AuthUser 等，经委托门面映射
 * （官方 prismaAdapter 无 modelMapping 选项）。
 * 登录防爆破由 /api/auth 路由包装层数据库限流（src/lib/rateLimit.ts）。
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/database/prisma";
import { loadEnv } from "@/lib/env";

let cached: unknown = null;

/** better-auth 模型名 → 我们的 Prisma 模型委托 */
function authPrismaFacade(client: PrismaClient): Parameters<typeof prismaAdapter>[0] {
  const facade = {
    user: client.authUser,
    session: client.authSession,
    account: client.authAccount,
    verification: client.authVerification,
    $transaction: client.$transaction.bind(client),
  };
  return facade as unknown as Parameters<typeof prismaAdapter>[0];
}

/** 懒加载并缓存 Better Auth 实例；首次调用强校验认证环境变量 */
export function getAuth() {
  cached ??= createAuth();
  return cached as ReturnType<typeof betterAuth>;
}

function createAuth() {
  const env = loadEnv(["auth"]);
  const authEnv = env.auth;
  if (!authEnv) {
    throw new Error("认证组件未启用（缺少 BETTER_AUTH_SECRET / BETTER_AUTH_URL）");
  }
  const betterAuthInstance = betterAuth({
    baseURL: authEnv.url,
    trustedOrigins: [authEnv.url],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
    },
    advanced: {
      useSecureCookies: env.nodeEnv === "production",
    },
    database: prismaAdapter(authPrismaFacade(getPrismaClient()), { provider: "postgresql" }),
  });
  return betterAuthInstance;
}

/** 仅供测试：重置缓存实例 */
export function resetAuthForTests(): void {
  cached = null;
}

/** 供路由拼接一次性邀请 URL（同样懒校验） */
export function authBaseUrl(): string {
  const authEnv = loadEnv(["auth"]).auth;
  if (!authEnv) {
    throw new Error("认证组件未启用（缺少 BETTER_AUTH_SECRET / BETTER_AUTH_URL）");
  }
  return authEnv.url;
}

/** 仅供测试：重置缓存实例（切换测试数据库时使用） */

