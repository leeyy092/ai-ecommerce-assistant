/**
 * Gate-01 修复回归（TASK-003）：
 * H04 公开注册拒绝（HTTP 层）且两条受控创建路径不受影响
 * H05 邀请接受后登录态采用框架 Set-Cookie（可建立真实会话）
 * H06 输入校验无副作用 / 孤儿 Auth 身份恢复 / Auth 后故障补偿与重试
 * H07 邀请创建与审计同事务（审计故障 → 业务零提交）
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
// H11：每次运行唯一命名测试库，只管理本库生命周期，不触碰集群内其他数据库
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;

const signUpFn = async (email: string, password: string, name: string) => {
  const { getAuth } = await import("@/lib/auth");
  const result = await getAuth().api.signUpEmail({
    body: { email, password, name },
    asResponse: false,
  });
  return { authUserId: result.user.id };
};

function tag(): string {
  return randomUUID().slice(0, 8);
}

beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
});

afterAll(async () => {
  await db?.$disconnect();
  await dropTestDatabase(adminUrl, testUrl);
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
    const { getAuth } = await import("@/lib/auth");
    const email = `controlled-${tag()}@example.com`;
    const result = await getAuth().api.signUpEmail({
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

describe("Gate-01 正式复核 H06 增补｜并发与身份链", () => {
  it("init/init 并发：一胜一幂等，AuthUser 恰 1，二者均可登录语义", async () => {
    const t = tag();
    const email = `race-owner-${t}@example.com`;
    const { initOwner } = await import("@/services/ownerInit");
    const results = await Promise.allSettled([
      initOwner(db, { orgName: `竞A${t}`, email, displayName: "A", demoMode: false, password: "race-pass-12345" }, signUpFn),
      initOwner(db, { orgName: `竞B${t}`, email, displayName: "B", demoMode: false, password: "race-pass-12345" }, signUpFn),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2); // 邮箱锁串行后，后到者幂等返回
    const ids = new Set(fulfilled.map((r) => (r as PromiseFulfilledResult<{ orgId: string }>).value.orgId));
    expect(ids.size).toBe(1); // 同一组织，无第二 Owner
    expect(await db.authUser.count({ where: { email } })).toBe(1);
    expect(await db.user.count({ where: { email } })).toBe(1);
    const { getAuth } = await import("@/lib/auth");
    const login = await getAuth().api.signInEmail({ body: { email, password: "race-pass-12345" }, asResponse: false });
    expect(login.user.email).toBe(email); // 真实可登录
  });

  it("init/invite 交错：邮箱锁串行，最终恰一个身份路径胜出且状态一致", async () => {
    const t = tag();
    const email = `mix-${t}@example.com`;
    const { createInvitation, acceptInvitation } = await import("@/services/invitations");
    const initOwnerFn = (await import("@/services/ownerInit")).initOwner;

    const inviter = await seedOwner(`${t}-host`);
    const created = await createInvitation(
      { db, orgId: inviter.orgId, userId: inviter.userId, role: "owner" },
      { email, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const token = created.url.split("/invite/")[1];

    const results = await Promise.allSettled([
      initOwnerFn(db, { orgName: `混${t}`, email, displayName: "M", demoMode: false, password: "mix-pass-12345" }, signUpFn),
      acceptInvitation(db, { token, displayName: "受邀", password: "mix-pass-12345", signUpNewUser: signUpFn }),
    ]);
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    expect(okCount).toBe(1); // 先到者胜；后到者拒绝（409），无双重身份
    expect(await db.user.count({ where: { email } })).toBe(1);
    expect(await db.authUser.count({ where: { email } })).toBe(1);
  });

  it("断链恢复：删除 AuthUser 模拟链断裂后重跑 init → 重建身份且能真实登录", async () => {
    const t = tag();
    const email = `broken-${t}@example.com`;
    const { initOwner } = await import("@/services/ownerInit");
    const first = await initOwner(
      db, { orgName: `断${t}`, email, displayName: "BK", demoMode: false, password: "first-pass-12345" }, signUpFn,
    );
    expect(first.alreadyInitialized).toBe(false);

    // 模拟链断裂（Auth 身份丢失）
    const domainUser = await db.user.findUniqueOrThrow({ where: { email } });
    await db.membership.updateMany({ where: { userId: domainUser.id }, data: { status: "disabled" } }).then(async () => {
      await db.membership.updateMany({ where: { userId: domainUser.id }, data: { status: "active" } });
    });
    await db.authSession.deleteMany({ where: { userId: domainUser.authUserId } });
    // FK(RESTRICT) 的删除侧检查由 "user"（AuthUser 映射表）上的内部 RI 触发器执行：禁用父表全部触发器后删除认证行，finally 恢复
    await db.$executeRawUnsafe(`ALTER TABLE "user" DISABLE TRIGGER ALL`);
    try {
      await db.authUser.delete({ where: { id: domainUser.authUserId } });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "user" ENABLE TRIGGER ALL`);
    }

    const second = await initOwner(
      db, { orgName: `断${t}`, email, displayName: "BK", demoMode: false, password: "second-pass-12345" }, signUpFn,
    );
    expect(second.alreadyInitialized).toBe(true);
    expect(second.recovered).toBe(true);
    expect(second.orgId).toBe(first.orgId);

    const { getAuth } = await import("@/lib/auth");
    const login = await getAuth().api.signInEmail({ body: { email, password: "second-pass-12345" }, asResponse: false });
    expect(login.user.email).toBe(email);
  });
});

describe("Gate-01 REVIEW_4｜邀请入口来源/输入/限流键（M01/M02/M03）", () => {
  async function ownerCookie(t: string): Promise<{ cookie: string; orgId: string; userId: string }> {
    const owner = await seedOwner(t);
    const { getAuth } = await import("@/lib/auth");
    const response = await getAuth().api.signInEmail({
      body: { email: owner.email, password: "initial-pass-123" },
      asResponse: true,
    });
    return {
      cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "),
      orgId: owner.orgId,
      userId: owner.userId,
    };
  }

  function req(path: string, init: RequestInit = {}): NextRequest {
    return new NextRequest(`http://127.0.0.1:3000${path}`, {
      ...init,
      headers: new Headers(init.headers),
    } as ConstructorParameters<typeof NextRequest>[1]);
  }

  it("M03：创建邀请 null body / 数字 email / 额外字段 → 422（不再 503）", async () => {
    const t = tag();
    const { cookie } = await ownerCookie(t);
    const { POST } = await import("@/app/api/v1/invitations/route");

    const nullRes = await POST(
      req("/api/v1/invitations", { method: "POST", headers: { "content-type": "application/json", cookie }, body: "null" }),
    );
    expect(nullRes.status).toBe(422);

    const numRes = await POST(
      req("/api/v1/invitations", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email: 42, role: "operator" }),
      }),
    );
    expect(numRes.status).toBe(422);

    const extraRes = await POST(
      req("/api/v1/invitations", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email: `m-${t}@example.com`, role: "operator", extra: 1 }),
      }),
    );
    expect(extraRes.status).toBe(422);
  });

  it("M03：DELETE expected_version 小数/缺失/非数字 → 422；M01：非可信 Origin 撤销 403、无 Origin 合法撤销 200", async () => {
    const t = tag();
    const { cookie, orgId, userId } = await ownerCookie(t);
    const { createInvitation } = await import("@/services/invitations");
    const { DELETE } = await import("@/app/api/v1/invitations/[idOrToken]/route");

    const mkInvitation = async (suffix: string) => {
      const created = await createInvitation(
        { db, orgId, userId, role: "owner" },
        { email: `rv-${suffix}-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
      );
      return created.id;
    };

    const decimalId = await mkInvitation("dec");
    const decRes = await DELETE(
      req(`/api/v1/invitations/${decimalId}?expected_version=1.1`, { method: "DELETE", headers: { cookie } }),
      { params: Promise.resolve({ idOrToken: decimalId }) },
    );
    expect(decRes.status).toBe(422);

    const missingId = await mkInvitation("miss");
    const missRes = await DELETE(
      req(`/api/v1/invitations/${missingId}`, { method: "DELETE", headers: { cookie } }),
      { params: Promise.resolve({ idOrToken: missingId }) },
    );
    expect(missRes.status).toBe(422);

    const badOriginId = await mkInvitation("org");
    const originRes = await DELETE(
      req(`/api/v1/invitations/${badOriginId}?expected_version=1`, {
        method: "DELETE",
        headers: { origin: "https://evil.example", cookie },
      }),
      { params: Promise.resolve({ idOrToken: badOriginId }) },
    );
    expect(originRes.status).toBe(403);
    const stillPending = await db.invitation.findUniqueOrThrow({ where: { id: badOriginId } });
    expect(stillPending.status).toBe("pending");

    const okId = await mkInvitation("ok");
    const okRes = await DELETE(
      req(`/api/v1/invitations/${okId}?expected_version=1`, {
        method: "DELETE",
        headers: { cookie },
      }),
      { params: Promise.resolve({ idOrToken: okId }) },
    );
    expect(okRes.status).toBe(200);
    const revoked = await db.invitation.findUniqueOrThrow({ where: { id: okId } });
    expect(revoked.status).toBe("revoked");
  });

  it("M03：accept 非法 JSON body → 422（零副作用，邀请仍 pending）", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { createInvitation } = await import("@/services/invitations");
    const created = await createInvitation(
      { db, orgId: owner.orgId, userId: owner.userId, role: "owner" },
      { email: `badjson-${t}@example.com`, role: "operator", baseUrl: "http://127.0.0.1:3000" },
    );
    const token = created.url.split("/invite/")[1];

    const { POST } = await import("@/app/api/v1/invitations/[idOrToken]/accept/route");
    const bad = await POST(
      req(`/api/v1/invitations/${token}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{name:",
      }),
      { params: Promise.resolve({ idOrToken: token }) },
    );
    expect(bad.status).toBe(422);
    const extra = await POST(
      req(`/api/v1/invitations/${token}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", unknown: 1 }),
      }),
      { params: Promise.resolve({ idOrToken: token }) },
    );
    expect(extra.status).toBe(422);
    const stillPending = await db.invitation.findFirstOrThrow({ where: { email: `badjson-${t}@example.com` } });
    expect(stillPending.status).toBe("pending");
  });

  it("M02：预览限流关闭代理信任时伪造 X-Forwarded-For 不能更换计数桶", async () => {
    const t = tag();
    const owner = await seedOwner(t);
    const { GET } = await import("@/app/api/v1/invitations/[idOrToken]/route");
    const token = `nonexistent-${t}`;

    // 前 60 次正常（404/422 等不计成败），第 61 次起 429
    let last = 0;
    for (let i = 0; i < 61; i++) {
      const res = await GET(req(`/api/v1/invitations/${token}`), { params: Promise.resolve({ idOrToken: token }) });
      last = res.status;
    }
    expect(last).toBe(429);

    // 伪造 XFF 换头：仍命中 direct 桶 → 429
    const spoof = await GET(
      req(`/api/v1/invitations/${token}`, { headers: { "x-forwarded-for": "9.9.9.9" } }),
      { params: Promise.resolve({ idOrToken: token }) },
    );
    expect(spoof.status).toBe(429);
  });
});
