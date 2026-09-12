/**
 * Better Auth 实例（TASK-003）。
 * email/password + 数据库 session；关闭公开注册（账号只经初始化与受控邀请建立）。
 * 认证表为 Better Auth 官方结构；Prisma 模型名为 AuthUser/AuthSession/AuthAccount/AuthVerification
 * （让出领域 User 名称），经委托门面映射给官方 prismaAdapter（1.7.4 无 modelMapping 选项）。
 * 登录防爆破限流由 /api/auth 路由包装层按 IP 计数（src/lib/rateLimit.ts，数据库持久）。
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/database/prisma";
import { loadEnv } from "@/lib/env";

const env = loadEnv(["auth"]);
const authEnv = env.auth;
if (!authEnv) {
  throw new Error("认证组件未启用（缺少 BETTER_AUTH_SECRET / BETTER_AUTH_URL）");
}

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

export const auth = betterAuth({
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

/** 供路由拼接一次性邀请 URL */
const AUTH_BASE_URL = authEnv.url;
export function authBaseUrl(): string {
  return AUTH_BASE_URL;
}
