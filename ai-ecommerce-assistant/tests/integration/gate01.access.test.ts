/**
 * Gate-01 修复回归（TASK-004）：
 * H01 同一账号双组织不同角色：切换后 /me 与业务读写使用同一组织上下文
 * H02 Admin 不能授予 Admin（旧角色允许、新角色禁止的组合）
 * H03 D01 方案 A：A 组织禁用不影响 B 组织 Owner；旧会话撤销后可重新登录使用 B
 * H07 成员/组织管理写入与审计原子（DB 级注入 → 零部分提交）
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv } from "@/lib/env";

loadDotEnvIfPresent();
const baseEnv = loadEnv();

const TEST_DB = "aiea_gate01_access_test";
const adminUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;
type Auth = (typeof import("@/lib/auth"))["auth"];
let auth: Auth;

const PASSWORD = "dual-org-pass-123";

interface Actor {
  userId: string;
  email: string;
  cookie: string;
}

let orgA: string;
let orgB: string;
let dual: Actor; // A=owner, B=customer_service（H01 双组织双角色）
let cross: Actor; // A=operator, B=owner（H03 跨组织禁用隔离）
let adminA: Actor;
let opA: { userId: string; membershipId: string; rowVersion: number };

function req(path: string, cookie?: string, init: RequestInit = {}, extraCookie?: string): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", extraCookie ? `${cookie}; ${extraCookie}` : cookie);
  headers.set("content-type", "application/json");
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers,
  } as ConstructorParameters<typeof NextRequest>[1]);
}

async function loginCookie(email: string): Promise<string> {
  const response = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
  return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function createUser(
  email: string,
  memberships: { orgId: string; role: "owner" | "admin" | "operator" | "customer_service" }[],
): Promise<Actor> {
  const created = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: email.split("@")[0] },
    asResponse: false,
  });
  const user = await db.user.create({
    data: { id: randomUUID(), authUserId: created.user.id, email, displayName: email.split("@")[0] },
  });
  for (const m of memberships) {
    await db.membership.create({ data: { orgId: m.orgId, userId: user.id, role: m.role } });
  }
  return { userId: user.id, email, cookie: await loginCookie(email) };
}

beforeAll(async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
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
  ({ auth } = await import("@/lib/auth"));

  const t = randomUUID().slice(0, 8);
  const mkOrg = async (name: string) => {
    const email = `owner-${name}-${t}@example.com`;
    const created = await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name },
      asResponse: false,
    });
    const user = await db.user.create({
      data: { id: randomUUID(), authUserId: created.user.id, email, displayName: name },
    });
    const org = await db.organization.create({
      data: { id: randomUUID(), name: `${name}组织`, ownerUserId: user.id },
    });
    await db.membership.create({ data: { orgId: org.id, userId: user.id, role: "owner" } });
    return org.id;
  };
  // dual 即 A 组织的 Owner（同时是 B 的 CustomerService，用于 H01 双组织双角色）
  const dualEmail = `dual-${t}@example.com`;
  const dualCreated = await auth.api.signUpEmail({
    body: { email: dualEmail, password: PASSWORD, name: "dual" },
    asResponse: false,
  });
  const dualUser = await db.user.create({
    data: { id: randomUUID(), authUserId: dualCreated.user.id, email: dualEmail, displayName: "dual" },
  });
  // cross：A 的 Operator、B 的 Owner（H03）
  const crossEmail = `cross-${t}@example.com`;
  const crossCreated = await auth.api.signUpEmail({
    body: { email: crossEmail, password: PASSWORD, name: "cross" },
    asResponse: false,
  });
  const crossUser = await db.user.create({
    data: { id: randomUUID(), authUserId: crossCreated.user.id, email: crossEmail, displayName: "cross" },
  });
  const orgARecord = await db.organization.create({
    data: { id: randomUUID(), name: "A组织", ownerUserId: dualUser.id },
  });
  await db.membership.create({ data: { orgId: orgARecord.id, userId: dualUser.id, role: "owner" } });
  const orgBRecord = await db.organization.create({
    data: { id: randomUUID(), name: "B组织", ownerUserId: crossUser.id },
  });
  await db.membership.create({ data: { orgId: orgBRecord.id, userId: crossUser.id, role: "owner" } });
  orgA = orgARecord.id;
  orgB = orgBRecord.id;
  dual = { userId: dualUser.id, email: dualEmail, cookie: await loginCookie(dualEmail) };
  await db.membership.create({ data: { orgId: orgA, userId: crossUser.id, role: "operator" } });
  await db.membership.create({ data: { orgId: orgB, userId: dualUser.id, role: "customer_service" } });
  cross = { userId: crossUser.id, email: crossEmail, cookie: await loginCookie(crossEmail) };
  adminA = await createUser(`admin-a-${t}@example.com`, [{ orgId: orgA, role: "admin" }]);

  const opUser = await createUser(`op-a-${t}@example.com`, [{ orgId: orgA, role: "operator" }]);
  const opMembership = await db.membership.findFirstOrThrow({
    where: { userId: opUser.userId, orgId: orgA },
  });
  opA = { userId: opUser.userId, membershipId: opMembership.id, rowVersion: opMembership.rowVersion };
});

afterAll(async () => {
  await db?.$disconnect();
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$disconnect();
});

describe("Gate-01 H01｜活跃组织统一（双组织双角色真实会话）", () => {
  it("默认首个成员关系（A/owner）；PUT 切到 B 后 /me 与 /organization 均为 B/customer_service，PATCH 403", async () => {
    const { GET: meGET } = await import("@/app/api/v1/me/route");
    const { GET: orgGET, PATCH: orgPATCH } = await import("@/app/api/v1/organization/route");

    const before = (await (await meGET(req("/api/v1/me", dual.cookie))).json()) as { data: { active_org: string; role: string } };
    expect(before.data.active_org).toBe(orgA);
    expect(before.data.role).toBe("owner");

    const { PUT } = await import("@/app/api/v1/me/active-organization/route");
    const switched = await PUT(
      req("/api/v1/me/active-organization", dual.cookie, {
        method: "PUT",
        body: JSON.stringify({ organization_id: orgB }),
      }),
    );
    expect(switched.status).toBe(200);
    const switchCookie = switched.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    const meAfter = (await (await meGET(req("/api/v1/me", dual.cookie, {}, switchCookie))).json()) as { data: { active_org: string; role: string; allowed_modules: string[] } };
    expect(meAfter.data.active_org).toBe(orgB);
    expect(meAfter.data.role).toBe("customer_service");
    expect(meAfter.data.allowed_modules).not.toContain("settings");

    // 业务读写同源：GET /organization 展示 B（无预算字段）；PATCH 被 C 角色拒绝
    const orgView = (await (await orgGET(req("/api/v1/organization", dual.cookie, {}, switchCookie))).json()) as {
      data: { id: string; ai_daily_budget_cny?: string };
    };
    expect(orgView.data.id).toBe(orgB);
    expect(orgView.data.ai_daily_budget_cny).toBeUndefined();

    const orgPatch = await orgPATCH(
      req("/api/v1/organization", dual.cookie, { method: "PATCH", body: JSON.stringify({ name: "X", expected_version: 1 }) }, switchCookie),
    );
    expect(orgPatch.status).toBe(403);
    const orgA_after = await db.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(orgA_after.name).toBe("A组织");
  });

  it("伪造不存在的 active-org Cookie 回退首个有效成员关系，不能自授权限", async () => {
    const { GET: meGET } = await import("@/app/api/v1/me/route");
    const forged = (await (await meGET(req("/api/v1/me", dual.cookie, {}, "aiea_active_org=00000000-0000-0000-0000-000000000000"))).json()) as {
      data: { active_org: string };
    };
    expect(forged.data.active_org).toBe(orgA);
  });
});

describe("Gate-01 H02｜拟授予角色校验", () => {
  it("Admin 把 Operator 提升为 Admin → 403 且角色不变；Owner 提升为 Admin → 200", async () => {
    const { PATCH } = await import("@/app/api/v1/members/[id]/route");

    const denied = await PATCH(
      req(`/api/v1/members/${opA.membershipId}`, adminA.cookie, {
        method: "PATCH",
        body: JSON.stringify({ role: "admin", expected_version: opA.rowVersion }),
      }),
      { params: Promise.resolve({ id: opA.membershipId }) },
    );
    expect(denied.status).toBe(403);
    expect(
      (await db.membership.findUniqueOrThrow({ where: { id: opA.membershipId } })).role,
    ).toBe("operator");

    const ownerCookie = dual.cookie; // dual 在 A 为 owner
    const allowed = await PATCH(
      req(`/api/v1/members/${opA.membershipId}`, ownerCookie, {
        method: "PATCH",
        body: JSON.stringify({ role: "admin", expected_version: opA.rowVersion }),
      }),
      { params: Promise.resolve({ id: opA.membershipId }) },
    );
    expect(allowed.status).toBe(200);
    expect(
      (await db.membership.findUniqueOrThrow({ where: { id: opA.membershipId } })).role,
    ).toBe("admin");

    // 还原为 operator 供 H03 使用
    await db.membership.update({
      where: { id: opA.membershipId },
      data: { role: "operator", rowVersion: { increment: 1 } },
    });
  });

  it("Admin 在 P↔C 之间调整允许", async () => {
    const fresh = await createUser(`pc-${randomUUID().slice(0, 8)}@example.com`, [
      { orgId: orgA, role: "operator" },
    ]);
    const membership = await db.membership.findFirstOrThrow({
      where: { userId: fresh.userId, orgId: orgA },
    });
    const { PATCH } = await import("@/app/api/v1/members/[id]/route");
    const response = await PATCH(
      req(`/api/v1/members/${membership.id}`, adminA.cookie, {
        method: "PATCH",
        body: JSON.stringify({ role: "customer_service", expected_version: membership.rowVersion }),
      }),
      { params: Promise.resolve({ id: membership.id }) },
    );
    expect(response.status).toBe(200);
    expect((await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).role).toBe("customer_service");
  });
});

describe("Gate-01 H03｜D01 方案 A：成员禁用仅作用于本组织", () => {
  it("A 禁用 dual 后：B 的 Membership/全局 User 不变；旧 Cookie 401；重新登录 B 可用，A 失效", async () => {
    // A 的 Owner(dual) 禁用 cross 在 A 的成员关系；cross 同时是 B 的 Owner
    const crossA = await db.membership.findFirstOrThrow({
      where: { userId: cross.userId, orgId: orgA },
    });
    const ownerACookie = dual.cookie;

    const { PATCH } = await import("@/app/api/v1/members/[id]/route");
    const response = await PATCH(
      req(`/api/v1/members/${crossA.id}`, ownerACookie, {
        method: "PATCH",
        body: JSON.stringify({ status: "disabled", expected_version: crossA.rowVersion }),
      }),
      { params: Promise.resolve({ id: crossA.id }) },
    );
    expect(response.status).toBe(200);

    // H03：不修改全局 User.status；B 成员关系仍 active
    const globalUser = await db.user.findUniqueOrThrow({ where: { id: cross.userId } });
    expect(globalUser.status).toBe("active");
    const crossB = await db.membership.findFirstOrThrow({
      where: { userId: cross.userId, orgId: orgB },
    });
    expect(crossB.status).toBe("active");

    // 旧 Cookie 立即失效（会话已撤销）
    const { GET: meGET } = await import("@/app/api/v1/me/route");
    expect((await meGET(req("/api/v1/me", cross.cookie))).status).toBe(401);

    // 重新登录：B 作为 Owner 可用（active_org=B、role=owner）；A 已不在有效成员关系中
    const reCookie = await loginCookie(cross.email);
    const after = (await (await meGET(req("/api/v1/me", reCookie))).json()) as {
      data: { active_org: string; role: string; memberships: { organization_id: string }[] };
    };
    expect(after.data.active_org).toBe(orgB);
    expect(after.data.role).toBe("owner");
    expect(after.data.memberships.map((m) => m.organization_id)).toEqual([orgB]);

    // 恢复：重新启用 A 成员关系（经 Owner PATCH），供后续用例
    const restored = await PATCH(
      req(`/api/v1/members/${crossA.id}`, ownerACookie, {
        method: "PATCH",
        body: JSON.stringify({ status: "active", expected_version: crossA.rowVersion + 1 }),
      }),
      { params: Promise.resolve({ id: crossA.id }) },
    );
    expect(restored.status).toBe(200);
  });
});

describe("Gate-01 H07｜成员/组织管理与审计原子", () => {
  it("成员 PATCH：审计故障 → 角色与版本零提交", async () => {
    await db.$executeRawUnsafe(
      `ALTER TABLE audit_log ADD CONSTRAINT ck_inject_member_audit CHECK (action <> 'member_update') NOT VALID`,
    );
    try {
      const { PATCH } = await import("@/app/api/v1/members/[id]/route");
      await expect(
        PATCH(
          req(`/api/v1/members/${opA.membershipId}`, dual.cookie, {
            method: "PATCH",
            body: JSON.stringify({
              role: "admin",
              expected_version: (await db.membership.findUniqueOrThrow({ where: { id: opA.membershipId } })).rowVersion,
            }),
          }),
          { params: Promise.resolve({ id: opA.membershipId }) },
        ),
      ).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS ck_inject_member_audit`);
    }
    const membership = await db.membership.findUniqueOrThrow({ where: { id: opA.membershipId } });
    expect(membership.role).toBe("operator");
    // 注入期间该动作零提交（此前用例的正常 member_update 记录不计入约束失败断言）
    const membershipNow = await db.membership.findUniqueOrThrow({ where: { id: opA.membershipId } });
    const auditDuringInjection = await db.auditLog.count({
      where: { action: "member_update", orgId: orgA, entityId: opA.membershipId, createdAt: { gte: membershipNow.updatedAt } },
    });
    expect(auditDuringInjection).toBe(0);
    void membershipNow;
  });

  it("组织 PATCH：审计故障 → 名称与版本零提交", async () => {
    await db.$executeRawUnsafe(
      `ALTER TABLE audit_log ADD CONSTRAINT ck_inject_org_audit CHECK (action <> 'org_update') NOT VALID`,
    );
    try {
      const { PATCH } = await import("@/app/api/v1/organization/route");
      const org = await db.organization.findUniqueOrThrow({ where: { id: orgA } });
      await expect(
        PATCH(
          req("/api/v1/organization", dual.cookie, {
            method: "PATCH",
            body: JSON.stringify({ name: "不该生效", expected_version: org.rowVersion }),
          }),
        ),
      ).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS ck_inject_org_audit`);
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(org.name).toBe("A组织");
  });
});
