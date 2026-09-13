/**
 * Gate-01 修复回归（TASK-003）：
 * H04 公开注册拒绝（HTTP 层）且两条受控创建路径不受影响
 * H05 邀请接受后登录态采用框架 Set-Cookie（可建立真实会话）
 * H06 输入校验无副作用 / 孤儿 Auth 身份恢复 / Auth 后故障补偿与重试
 * H07 邀请创建与审计同事务（审计故障 → 业务零提交）
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv } from "@/lib/env";

loadDotEnvIfPresent();
const baseEnv = loadEnv();

const TEST_DB = "aiea_gate01_auth_test";
const adminUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;

const signUpFn = async (email: string, password: string, name: string) => {
  const { auth } = await import("@/lib/auth");
  const result = await auth.api.signUpEmail({
    body: { email, password, name },
    asResponse: false,
  });
  return { authUserId: result.user.id };
};

function tag(): string {
  return randomUUID().slice(0, 8);
}

beforeAll(async () => {
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  await admin.$disconnect();
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
    timeout: 180_000,
  });
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
});

afterAll(async () => {
  await db?.$disconnect();
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$disconnect();
});

async function seedOwner(t: string) {
  const { initOwner } = await import("@/services/ownerInit");
  const email = `owner-${t}@example.com`;
  const result = await initOwner(
    db,
    { orgName: `组织${t}`, email, displayName: "老板", demoMode: false, password: "initial-pass-123" },
    signUpFn,
  );
  return { email, orgId: result.orgId, userId: result.userId };
}

describe("Gate-01 H04｜公开注册关闭", () => {
  it("匿名 POST /api/auth/sign-up/email → 403，且不创建任何 AuthUser", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const before = await db.authUser.count();
    const request = new NextRequest("http://127.0.0.1:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `stranger-${tag()}@example.com`,
        password: "hijack-pass-123",
        name: "stranger",
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PUBLIC_SIGNUP_DISABLED");
    expect(await db.authUser.count()).toBe(before);
  });

  it("两条受控创建路径仍可用：服务端 auth.api.signUpEmail 正常建身份", async () => {
    const { auth } = await import("@/lib/auth");
    const email = `controlled-${tag()}@example.com`;
    const result = await auth.api.signUpEmail({
      body: { email, password: "controlled-123", name: "受控" },
      asResponse: false,
    });
    expect(result.user.email).toBe(email);
  });
});

describe("Gate-01 H05｜邀请接受后为框架真实会话", () => {
  it("accept 响应转发的 Set-Cookie 可建立可用登录态（getSessionContext 解析成功）", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { createInvitation } = await import("@/services/invitations");
    const created = await createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `member-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const token = created.url.split("/invite/")[1];

    const { POST } = await import("@/app/api/v1/invitations/[idOrToken]/accept/route");
    const response = await POST(
      new NextRequest(`http://127.0.0.1:3000/api/v1/invitations/${token}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "新成员", password: "member-pass-123" }),
      }),
      { params: Promise.resolve({ idOrToken: token }) },
    );
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);

    const { getSessionContext } = await import("@/lib/session");
    const ctx = await getSessionContext(
      new Request("http://local/api/v1/me", {
        headers: { cookie: cookies.map((c) => c.split(";")[0]).join("; ") },
      }),
      db,
    );
    expect(ctx?.user.email).toBe(`member-${t}@example.com`);
    expect(ctx?.memberships[0]?.role).toBe("operator");
  });
});

describe("Gate-01 H06｜输入校验、孤儿恢复与故障补偿", () => {
  it("超长姓名：422 且零副作用（无 AuthUser / 无领域行 / 邀请仍 pending）", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { createInvitation, acceptInvitation } = await import("@/services/invitations");
    const created = await createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `long-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const token = created.url.split("/invite/")[1];

    await expect(
      acceptInvitation(db, {
        token,
        displayName: "超".repeat(81),
        password: "member-pass-123",
        signUpNewUser: signUpFn,
      }),
    ).rejects.toMatchObject({ status: 422 });

    expect(await db.authUser.count({ where: { email: `long-${t}@example.com` } })).toBe(0);
    const invitation = await db.invitation.findUniqueOrThrow({ where: { id: created.id } });
    expect(invitation.status).toBe("pending");
  });

  it("孤儿 Auth 身份（有 Auth 无领域）→ 安全回收后正常接受", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { createInvitation, acceptInvitation } = await import("@/services/invitations");
    const created = await createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `orphan-${t}@example.com`, role: "customer_service", baseUrl: "http://127.0.0.1:3000" },
    );

    // 模拟历史故障留下的孤立 Auth 身份
    await db.authUser.create({
      data: { id: `orphan-auth-${t}`, name: "旧", email: `orphan-${t}@example.com` },
    });

    const token = created.url.split("/invite/")[1];
    await expect(
      acceptInvitation(db, {
        token,
        displayName: "恢复用户",
        password: "member-pass-123",
        signUpNewUser: signUpFn,
      }),
    ).resolves.toBeUndefined();

    const user = await db.user.findUniqueOrThrow({ where: { email: `orphan-${t}@example.com` } });
    expect(user.authUserId).not.toBe(`orphan-auth-${t}`);
  });

  it("Auth 创建后领域事务失败：补偿删除 Auth 身份，邀请回 pending，重试成功", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { createInvitation, acceptInvitation } = await import("@/services/invitations");
    const created = await createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `flaky-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const token = created.url.split("/invite/")[1];

    let createdAuthId: string | null = null;
    const failingSignUp: typeof signUpFn = async (email, password, name) => {
      const result = await signUpFn(email, password, name);
      createdAuthId = result.authUserId;
      return result;
    };

    await expect(
      acceptInvitation(db, {
        token,
        displayName: "故障用户",
        password: "member-pass-123",
        signUpNewUser: failingSignUp,
        testHookAfterAuth: async () => {
          throw new Error("injected: domain tx will fail before running");
        },
      }),
    ).rejects.toThrow("injected");

    expect(createdAuthId).toBeTruthy();
    expect(await db.authUser.count({ where: { id: createdAuthId! } })).toBe(0); // 补偿已删除
    const invitation = await db.invitation.findUniqueOrThrow({ where: { id: created.id } });
    expect(invitation.status).toBe("pending");

    await expect(
      acceptInvitation(db, {
        token,
        displayName: "故障用户",
        password: "member-pass-123",
        signUpNewUser: signUpFn,
      }),
    ).resolves.toBeUndefined();
    const membership = await db.membership.findFirstOrThrow({
      where: { organization: { id: owner.orgId }, user: { email: `flaky-${t}@example.com` } },
    });
    expect(membership.role).toBe("operator");
  });

  it("Owner 初始化同型故障：补偿后重跑成功", async () => {
    const t = tag();
    const email = `flaky-owner-${t}@example.com`;
    const { initOwner } = await import("@/services/ownerInit");

    await expect(
      initOwner(
        db,
        {
          orgName: `组织${t}`,
          email,
          displayName: "老板",
          demoMode: false,
          password: "initial-pass-123",
          testHookAfterAuth: async () => {
            throw new Error("injected-owner");
          },
        },
        signUpFn,
      ),
    ).rejects.toThrow("injected-owner");
    expect(await db.authUser.count({ where: { email } })).toBe(0);

    const retry = await initOwner(
      db,
      { orgName: `组织${t}`, email, displayName: "老板", demoMode: false, password: "initial-pass-123" },
      signUpFn,
    );
    expect(retry.alreadyInitialized).toBe(false);
  });
});

describe("Gate-01 H07｜邀请创建与审计原子", () => {
  it("审计写入失败（DB 级故障注入）→ 邀请零提交（无残留行）", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { createInvitation } = await import("@/services/invitations");

    // DB 级注入：临时约束令 invite_create 审计必失败（NOT VALID 跳过存量行校验，
    // 仅约束新写入 → 事务内审计失败 → 整体回滚）
    await db.$executeRawUnsafe(
      `ALTER TABLE audit_log ADD CONSTRAINT ck_inject_audit_fail CHECK (action <> 'invite_create') NOT VALID`,
    );
    try {
      await expect(
        createInvitation(
          { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
          { email: `auditfail-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
        ),
      ).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS ck_inject_audit_fail`);
    }

    expect(
      await db.invitation.count({ where: { orgId: owner.orgId, email: `auditfail-${t}@example.com` } }),
    ).toBe(0);
    expect(await db.auditLog.count({ where: { orgId: owner.orgId, action: "invite_create" } })).toBe(0);
  });
});
