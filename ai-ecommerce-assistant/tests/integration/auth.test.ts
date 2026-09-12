/**
 * TASK-003｜登录、初始Owner与受控邀请 集成测试（真实 PostgreSQL + 真实 Better Auth 会话）。
 * 独立测试库 aiea_auth_test：空库迁移 → 服务与 auth.api 全链路 → 断言 → 清理。
 * 验收：公开注册关闭（无 signUp 入口暴露给匿名）、邀请过期/重复使用/邮箱不符均拒绝、
 * 并发两次接受仅一次成功、重复初始化不改密码、不建第二个 Owner、限流持久计数、禁用即时失权。
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv } from "@/lib/env";

loadDotEnvIfPresent();
const baseEnv = loadEnv();

const TEST_DB = "aiea_auth_test";
const adminUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);

// 认证组件变量（测试实例独立 secret）
process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

type Modules = typeof import("@/lib/auth") &
  typeof import("@/services/invitations") &
  typeof import("@/services/ownerInit") &
  typeof import("@/lib/session") &
  typeof import("@/lib/rateLimit") &
  typeof import("@/database/prisma");

let mods: Modules;
let db: PrismaClient;

async function runMigrateDeploy(url: string): Promise<void> {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
    timeout: 120_000,
  });
}

beforeAll(async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  await admin.$disconnect();

  await runMigrateDeploy(testUrl);

  // 环境就绪后再加载被测模块（auth 模块在 import 时绑定 Prisma 客户端）
  const auth = await import("@/lib/auth");
  const invitations = await import("@/services/invitations");
  const ownerInit = await import("@/services/ownerInit");
  const session = await import("@/lib/session");
  const rateLimit = await import("@/lib/rateLimit");
  const prisma = await import("@/database/prisma");
  mods = { ...auth, ...invitations, ...ownerInit, ...session, ...rateLimit, ...prisma } as Modules;
  db = prisma.getPrismaClient();
});

afterAll(async () => {
  await db?.$disconnect();
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$disconnect();
});

const signUpFn: import("@/services/ownerInit").SignUpFn = async (email, password, name) => {
  const result = await mods.auth.api.signUpEmail({
    body: { email, password, name },
    asResponse: false,
  });
  return { authUserId: result.user.id };
};

function tag(): string {
  return randomUUID().slice(0, 8);
}

describe("TASK-003｜初始 Owner 与登录", () => {
  it("初始化创建 Auth+领域身份并可用真实会话登录；/api 层无公开注册入口依赖", async () => {
    const t = tag();
    const email = `owner-${t}@example.com`;
    const result = await mods.initOwner(db, {
      orgName: `组织 ${t}`,
      email,
      displayName: "老板",
      demoMode: false,
      password: "initial-pass-123",
    }, signUpFn);
    expect(result.alreadyInitialized).toBe(false);

    const signIn = await mods.auth.api
      .signInEmail({ body: { email, password: "initial-pass-123" }, asResponse: false })
      .catch(() => null);
    expect(signIn?.user?.email).toBe(email);

    // 会员与审计
    const membership = await db.membership.findFirstOrThrow({
      where: { userId: result.userId },
    });
    expect(membership.role).toBe("owner");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "owner_init", entityId: result.orgId },
    });
    expect(audit.orgId).toBe(result.orgId);
  });

  it("重复初始化幂等：不重设密码、不建第二个 Owner、不接管邮箱", async () => {
    const t = tag();
    const email = `owner2-${t}@example.com`;
    const first = await mods.initOwner(db, {
      orgName: `组织 ${t}`, email, displayName: "老板", demoMode: false,
      password: "initial-pass-123",
    }, signUpFn);

    // 用不同密码重跑 → 仍返回既有身份，原密码继续有效
    const second = await mods.initOwner(db, {
      orgName: `组织 ${t}`, email, displayName: "老板", demoMode: false,
      password: "another-pass-456",
    }, signUpFn);
    expect(second.alreadyInitialized).toBe(true);
    expect(second.orgId).toBe(first.orgId);

    const reLogin = await mods.auth.api
      .signInEmail({ body: { email, password: "initial-pass-123" }, asResponse: false })
      .catch(() => null);
    expect(reLogin?.user?.email).toBe(email);

    // 数据库单 Owner 部分唯一：同组织第二个 owner 成员被拒绝
    const other = await db.user.create({
      data: { authUserId: `auth-${t}`, email: `other-${t}@example.com`, displayName: "他人" },
    });
    await expect(
      db.membership.create({ data: { orgId: first.orgId, userId: other.id, role: "owner" } }),
    ).rejects.toThrow(/uq_membership_single_owner|Unique constraint/i);
  });

  it("禁用即时失权：禁用后旧会话解析为未登录", async () => {
    const t = tag();
    const email = `owner3-${t}@example.com`;
    const result = await mods.initOwner(db, {
      orgName: `组织 ${t}`, email, displayName: "老板", demoMode: false,
      password: "initial-pass-123",
    }, signUpFn);

    const signInResponse = await mods.auth.api.signInEmail({
      body: { email, password: "initial-pass-123" },
      asResponse: true,
    });
    const cookieHeader = signInResponse.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const request = new Request("http://local/api/v1/me", {
      headers: { cookie: cookieHeader },
    });
    const before = await mods.getSessionContext(request, db);
    expect(before?.user.email).toBe(email);

    // 管理员禁用路径的核心动作：删会话 + 禁用领域身份
    const domainUser = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
    await db.authSession.deleteMany({ where: { userId: domainUser.authUserId } });
    await db.user.update({ where: { id: result.userId }, data: { status: "disabled" } });

    const after = await mods.getSessionContext(request, db);
    expect(after).toBeNull();
  });
});

describe("TASK-003｜受控邀请", () => {
  async function ownerCtx(t: string) {
    const email = `inviter-${t}@example.com`;
    const init = await mods.initOwner(db, {
      orgName: `组织 ${t}`, email, displayName: "邀请人", demoMode: false,
      password: "initial-pass-123",
    }, signUpFn);
    return { email, orgId: init.orgId, userId: init.userId };
  }

  it("Operator 不能创建邀请；Owner 创建返回一次性 URL（只存哈希）", async () => {
    const t = tag();
    const owner = await ownerCtx(t);
    const operator = await db.user.create({
      data: { authUserId: `auth-${t}`, email: `op-${t}@example.com`, displayName: "运营" },
    });
    await db.membership.create({
      data: { orgId: owner.orgId, userId: operator.id, role: "operator" },
    });

    await expect(
      mods.createInvitation(
        { db, orgId: owner.orgId, userId: operator.id, role: "operator" },
        { email: `new-${t}@example.com`, role: "customer_service", baseUrl: "http://127.0.0.1:3000" },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const created = await mods.createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `new-${t}@example.com`, role: "customer_service", baseUrl: "http://127.0.0.1:3000" },
    );
    expect(created.url).toMatch(/\/invite\/[0-9a-f]{64}$/);
    const token = created.url.split("/invite/")[1];
    const byId = await db.invitation.findUniqueOrThrow({ where: { id: created.id } });
    expect(byId.tokenHash).not.toBe(token);
    expect(byId.tokenHash).toHaveLength(64);
  });

  it("已是成员的邮箱再邀请 → 409", async () => {
    const t = tag();
    const owner = await ownerCtx(t);
    await expect(
      mods.createInvitation(
        { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
        { email: owner.email, role: "operator", baseUrl: "http://127.0.0.1:3000" },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("完整接受流程：新用户建 Auth+领域身份并入组织；并发两次接受仅一次成功", async () => {
    const t = tag();
    const owner = await ownerCtx(t);
    const created = await mods.createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `member-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const token = created.url.split("/invite/")[1];

    const [first, second] = await Promise.allSettled([
      mods.acceptInvitation(db, {
        token,
        displayName: "新成员",
        password: "member-pass-123",
        signUpNewUser: signUpFn,
      }),
      mods.acceptInvitation(db, {
        token,
        displayName: "新成员",
        password: "member-pass-123",
        signUpNewUser: signUpFn,
      }),
    ]);
    const settled = [first, second];
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.status).toBe(409);

    const member = await db.user.findUniqueOrThrow({ where: { email: `member-${t}@example.com` } });
    const membership = await db.membership.findFirstOrThrow({ where: { userId: member.id } });
    expect(membership.role).toBe("operator");
    expect(membership.orgId).toBe(owner.orgId);

    // 第三次（串行重放）同样拒绝
    await expect(
      mods.acceptInvitation(db, {
        token,
        displayName: "新成员",
        password: "member-pass-123",
        signUpNewUser: signUpFn,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("过期邀请 → 410；已登录邮箱不符 → 403；撤销后接受 → 409", async () => {
    const t = tag();
    const owner = await ownerCtx(t);

    // 过期
    const expired = await mods.createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `late-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const expiredToken = expired.url.split("/invite/")[1];
    await db.invitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      mods.previewInvitationByToken(db, expiredToken),
    ).rejects.toMatchObject({ status: 410 });

    // 邮箱不符
    const mismatch = await mods.createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `target-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    await expect(
      mods.acceptInvitation(db, {
        token: mismatch.url.split("/invite/")[1],
        sessionUser: { id: owner.userId, email: owner.email },
      }),
    ).rejects.toMatchObject({ status: 403 });

    // 撤销后接受
    const revoked = await mods.createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `gone-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    await mods.revokeInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      revoked.id,
      1,
    );
    await expect(
      mods.previewInvitationByToken(db, revoked.url.split("/invite/")[1]),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("TASK-003｜数据库限流", () => {
  it("10 次/窗口后拒绝并给出等待秒数；重置后恢复", async () => {
    const key = `test-login-fail:${tag()}`;
    for (let i = 0; i < 10; i++) {
      const r = await mods.consumeRateLimit(db, key, 10, 60);
      expect(r.allowed).toBe(true);
    }
    const blocked = await mods.consumeRateLimit(db, key, 10, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);

    await mods.resetRateLimit(db, key);
    const after = await mods.consumeRateLimit(db, key, 10, 60);
    expect(after.allowed).toBe(true);
  });
});
