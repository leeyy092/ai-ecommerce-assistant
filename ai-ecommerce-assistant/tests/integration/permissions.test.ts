/**
 * TASK-004｜组织隔离与固定权限服务 集成测试。
 * 双组织 × 四角色，真实会话 Cookie 直调路由 handler，验证：
 * 权限矩阵执行、跨组织资源 404、C 拒绝经营入口、禁用后旧 Cookie 401、店铺同域校验。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
// H11：每次运行唯一命名测试库，只管理本库生命周期，不触碰集群内其他数据库
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;
type Auth = ReturnType<(typeof import("@/lib/auth"))["getAuth"]>;

interface Actor {
  userId: string;
  email: string;
  role: string;
  cookie: string;
}

async function createActor(
  auth: Auth,
  prisma: PrismaClient,
  orgId: string,
  role: "owner" | "admin" | "operator" | "customer_service",
  t: string,
): Promise<Actor> {
  const email = `${role}-${t}@example.com`;
  const password = `pass-${role}-123456`;
  if (role === "owner") {
    const { initOwner } = await import("@/services/ownerInit");
    const result = await initOwner(
      prisma,
      { orgName: `组织 ${t}`, email, displayName: role, demoMode: false, password },
      async (mail, pass, name) => {
        const created = await auth.api.signUpEmail({ body: { email: mail, password: pass, name }, asResponse: false });
        return { authUserId: created.user.id };
      },
    );
    return { userId: result.userId, email, role, cookie: await loginCookie(auth, email, password) };
  }
  const created = await auth.api.signUpEmail({
    body: { email, password, name: role },
    asResponse: false,
  });
  const user = await prisma.user.create({
    data: { id: randomUUID(), authUserId: created.user.id, email, displayName: role },
  });
  await prisma.membership.create({ data: { orgId, userId: user.id, role } });
  return { userId: user.id, email, role, cookie: await loginCookie(auth, email, password) };
}

async function loginCookie(
  auth: Auth,
  email: string,
  password: string,
): Promise<string> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

import { NextRequest } from "next/server";

function request(path: string, cookie?: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  headers.set("content-type", "application/json");
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers,
  } as ConstructorParameters<typeof NextRequest>[1]);
}

let orgA: { id: string; storeId: string };
let orgB: { id: string; storeId: string };
let actors: Record<string, Actor>;

beforeAll(async () => {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@/generated/prisma/client");

  await applyMigrations(testUrl);
  resetDbSingletons();

  const { getPrismaClient } = await import("@/database/prisma");
  const auth = (await import("@/lib/auth")).getAuth();
  db = getPrismaClient();

  const t = randomUUID().slice(0, 8);
  const ownerA = await createActor(auth, db, "", "owner", `${t}-a`);
  orgA = { id: (await db.membership.findFirstOrThrow({ where: { userId: ownerA.userId } })).orgId, storeId: "" };
  const adminA = await createActor(auth, db, orgA.id, "admin", `${t}-a`);
  const opA = await createActor(auth, db, orgA.id, "operator", `${t}-a`);
  const csA = await createActor(auth, db, orgA.id, "customer_service", `${t}-a`);
  const ownerB = await createActor(auth, db, "", "owner", `${t}-b`);
  orgB = { id: (await db.membership.findFirstOrThrow({ where: { userId: ownerB.userId } })).orgId, storeId: "" };

  const storeA = await db.store.create({
    data: { orgId: orgA.id, name: "A 店", externalStoreId: "EXT-A", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
  });
  const storeB = await db.store.create({
    data: { orgId: orgB.id, name: "B 店", externalStoreId: "EXT-B", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
  });
  orgA.storeId = storeA.id;
  orgB.storeId = storeB.id;

  actors = { ownerA, adminA, opA, csA, ownerB };
});

afterAll(async () => {
  await db?.$disconnect();
  await dropTestDatabase(adminUrl, testUrl);
});

describe("TASK-004｜路由级权限矩阵（真实会话）", () => {
  it("组织信息：O/A 可见预算字段；P/C 不可见", async () => {
    const { GET } = await import("@/app/api/v1/organization/route");
    const ownerBody = (await (await GET(request("/api/v1/organization", actors.ownerA.cookie))).json()) as {
      data: Record<string, unknown>;
    };
    expect(ownerBody.data.ai_daily_budget_cny).toBeDefined();

    const opBody = (await (await GET(request("/api/v1/organization", actors.opA.cookie))).json()) as {
      data: Record<string, unknown>;
    };
    expect(opBody.data.ai_daily_budget_cny).toBeUndefined();
    expect(opBody.data.name).toBeDefined();

    const csBody = (await (await GET(request("/api/v1/organization", actors.csA.cookie))).json()) as {
      data: Record<string, unknown>;
    };
    expect(csBody.data.ai_daily_budget_cny).toBeUndefined();
  });

  it("P 改组织名 403；O 改组织名 200（乐观锁）", async () => {
    const { PATCH } = await import("@/app/api/v1/organization/route");
    const denied = await PATCH(
      request("/api/v1/organization", actors.opA.cookie, {
        method: "PATCH",
        body: JSON.stringify({ name: "新名", expected_version: 1 }),
      }),
    );
    expect(denied.status).toBe(403);

    const current = await db.organization.findUniqueOrThrow({ where: { id: orgA.id } });
    const allowed = await PATCH(
      request("/api/v1/organization", actors.ownerA.cookie, {
        method: "PATCH",
        body: JSON.stringify({ name: "组织A-改名", expected_version: current.rowVersion }),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("邀请：C/P 403；Admin 邀请 admin 403、邀请 operator 201", async () => {
    const { POST } = await import("@/app/api/v1/invitations/route");
    const csDenied = await POST(
      request("/api/v1/invitations", actors.csA.cookie, {
        method: "POST",
        body: JSON.stringify({ email: `x-${randomUUID().slice(0, 6)}@example.com`, role: "operator" }),
      }),
    );
    expect(csDenied.status).toBe(403);

    const opDenied = await POST(
      request("/api/v1/invitations", actors.opA.cookie, {
        method: "POST",
        body: JSON.stringify({ email: `x-${randomUUID().slice(0, 6)}@example.com`, role: "operator" }),
      }),
    );
    expect(opDenied.status).toBe(403);

    const adminTooHigh = await POST(
      request("/api/v1/invitations", actors.adminA.cookie, {
        method: "POST",
        body: JSON.stringify({ email: `y-${randomUUID().slice(0, 6)}@example.com`, role: "admin" }),
      }),
    );
    expect(adminTooHigh.status).toBe(403);

    const adminOk = await POST(
      request("/api/v1/invitations", actors.adminA.cookie, {
        method: "POST",
        body: JSON.stringify({ email: `z-${randomUUID().slice(0, 6)}@example.com`, role: "operator" }),
      }),
    );
    expect(adminOk.status).toBe(201);
  });

  it("成员：P 403；O 200；B 组织 Owner 改 A 组织成员 → 404（跨组织不可见）", async () => {
    const { GET } = await import("@/app/api/v1/members/route");
    const opDenied = await GET(request("/api/v1/members", actors.opA.cookie));
    expect(opDenied.status).toBe(403);

    const ownerOk = await GET(request("/api/v1/members", actors.ownerA.cookie));
    expect(ownerOk.status).toBe(200);

    const csMembership = await db.membership.findFirstOrThrow({
      where: { orgId: orgA.id, role: "customer_service" },
    });
    const { PATCH } = await import("@/app/api/v1/members/[id]/route");
    const cross = await PATCH(
      request(`/api/v1/members/${csMembership.id}`, actors.ownerB.cookie, {
        method: "PATCH",
        body: JSON.stringify({ status: "disabled", expected_version: csMembership.rowVersion }),
      }),
      { params: Promise.resolve({ id: csMembership.id }) },
    );
    expect(cross.status).toBe(404);
  });

  it("禁用成员后旧 Cookie 立即 401（重放拒绝）", async () => {
    const { GET } = await import("@/app/api/v1/invitations/route");
    const opUser = await db.user.findUniqueOrThrow({ where: { id: actors.opA.userId } });
    await db.membership.update({
      where: { id: (await db.membership.findFirstOrThrow({ where: { userId: actors.opA.userId } })).id },
      data: { status: "disabled" },
    });
    await db.authSession.deleteMany({ where: { userId: opUser.authUserId } });
    await db.user.update({ where: { id: actors.opA.userId }, data: { status: "disabled" } });

    const replay = await GET(request("/api/v1/invitations", actors.opA.cookie));
    expect(replay.status).toBe(401);
  });

  it("requireStoreAccess：A 组织上下文访问 B 组织店铺 → 404", async () => {
    const { requireStoreAccess, AccessError } = await import("@/services/access");
    await expect(
      requireStoreAccess(db, { orgId: orgA.id }, orgB.storeId),
    ).rejects.toMatchObject({ status: 404 });
    const store = await requireStoreAccess(db, { orgId: orgA.id }, orgA.storeId);
    expect(store.id).toBe(orgA.storeId);
    void AccessError;
  });

  it("两组织同名 SKU 由复合键隔离（DB 层，TASK-002 已建约束的复验）", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: actors.ownerA.userId } });
    const dataSource = await db.dataSource.create({
      data: { orgId: orgA.id, storeId: orgA.storeId, sourceNamespace: "ns-x", name: "X", adapterKind: "csv" },
    });
    const importTask = await db.importTask.create({
      data: {
        orgId: orgA.id, storeId: orgA.storeId, dataSourceId: dataSource.id,
        sourceKind: "products", originalFilename: "p.csv", rawObjectKey: "raw/x",
        fileSha256: randomUUID(), uploadRequestKey: `up-${randomUUID().slice(0, 8)}`,
        baseDatasetVersion: 0n, createdBy: user.id,
      },
    });
    const product = await db.product.create({
      data: {
        orgId: orgA.id, storeId: orgA.storeId, sourceNamespace: "ns-x",
        sourceUpdatedAt: new Date(), importTaskId: importTask.id, rowHash: randomUUID(),
        externalProductId: "P1", name: "保温杯",
      },
    });
    await db.sKU.create({
      data: {
        orgId: orgA.id, storeId: orgA.storeId, sourceNamespace: "ns-x",
        sourceUpdatedAt: new Date(), importTaskId: importTask.id, rowHash: randomUUID(),
        productId: product.id, externalSkuId: "S1", skuCode: "CUP", name: "红杯",
      },
    });

    // B 组织同 (ns, external_sku_id) 建第二个店铺的同名 SKU：合法且互不可见（org 隔离键）
    const dsB = await db.dataSource.create({
      data: { orgId: orgB.id, storeId: orgB.storeId, sourceNamespace: "ns-x", name: "X", adapterKind: "csv" },
    });
    const taskB = await db.importTask.create({
      data: {
        orgId: orgB.id, storeId: orgB.storeId, dataSourceId: dsB.id,
        sourceKind: "products", originalFilename: "p.csv", rawObjectKey: "raw/y",
        fileSha256: randomUUID(), uploadRequestKey: `up-${randomUUID().slice(0, 8)}`,
        baseDatasetVersion: 0n, createdBy: (await db.user.findUniqueOrThrow({ where: { id: actors.ownerB.userId } })).id,
      },
    });
    const productB = await db.product.create({
      data: {
        orgId: orgB.id, storeId: orgB.storeId, sourceNamespace: "ns-x",
        sourceUpdatedAt: new Date(), importTaskId: taskB.id, rowHash: randomUUID(),
        externalProductId: "P1", name: "保温杯",
      },
    });
    const skuB = await db.sKU.create({
      data: {
        orgId: orgB.id, storeId: orgB.storeId, sourceNamespace: "ns-x",
        sourceUpdatedAt: new Date(), importTaskId: taskB.id, rowHash: randomUUID(),
        productId: productB.id, externalSkuId: "S1", skuCode: "CUP", name: "红杯",
      },
    });
    expect(skuB.id).toBeDefined();

    // A 组织上下文按 B 店铺域读取被拒（同域检查）
    const { requireStoreAccess } = await import("@/services/access");
    await expect(requireStoreAccess(db, { orgId: orgA.id }, orgB.storeId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
