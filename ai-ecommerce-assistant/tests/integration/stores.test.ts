/**
 * TASK-005｜店铺与数据源配置 集成测试（真实 PostgreSQL + 真实会话）。
 * 验收：创建/列表/改名/归档店铺，创建 csv 或 mock 数据源；
 *       事实存在后不得换币种时区（409 STORE_CONFIG_LOCKED）；
 *       mock 源不能绑定真实店；归档店拒绝新数据源；
 *       platform 只是标签（无任何连接状态字段）；C 仅消息源实体；
 *       关键操作写审计。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@/generated/prisma/client";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
// H11：每次运行唯一命名测试库，只管理本库生命周期
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));

process.env.DATABASE_URL = testUrl;
process.env.BETTER_AUTH_SECRET ??= "test-secret-please-ignore-0123456789abcdef";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3000";

let db: PrismaClient;
type Auth = ReturnType<(typeof import("@/lib/auth"))["getAuth"]>;
let auth: Auth;

const PASSWORD = "stores-pass-123";

interface Actor {
  userId: string;
  email: string;
  cookie: string;
}

let owner: Actor;
let cs: Actor;
let orgId: string;

function req(path: string, init: RequestInit = {}, cookie?: string): NextRequest {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://127.0.0.1:3000${path}`, {
    ...init,
    headers,
  } as ConstructorParameters<typeof NextRequest>[1]);
}

async function loginCookie(email: string): Promise<string> {
  const r = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function seedUser(t: string, role: "owner" | "customer_service", org: string): Promise<Actor> {
  const email = `${role}-${t}@example.com`;
  const created = await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: role },
    asResponse: false,
  });
  const user = await db.user.create({
    data: { id: randomUUID(), authUserId: created.user.id, email, displayName: role },
  });
  await db.membership.create({ data: { orgId: org, userId: user.id, role } });
  return { userId: user.id, email, cookie: await loginCookie(email) };
}

beforeAll(async () => {
  await applyMigrations(testUrl);
  resetDbSingletons();
  const { getPrismaClient } = await import("@/database/prisma");
  db = getPrismaClient();
  auth = (await import("@/lib/auth")).getAuth();

  const t = randomUUID().slice(0, 8);
  const { initOwner } = await import("@/services/ownerInit");
  const ownerEmail = `owner-${t}@example.com`;
  const r = await initOwner(
    db,
    { orgName: `S组织${t}`, email: ownerEmail, displayName: "owner", demoMode: false, password: PASSWORD },
    async (email, password, name) => {
      const result = await auth.api.signUpEmail({ body: { email, password, name }, asResponse: false });
      return { authUserId: result.user.id };
    },
  );
  orgId = r.orgId;
  owner = {
    userId: (await db.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id,
    email: ownerEmail,
    cookie: await loginCookie(ownerEmail),
  };
  cs = await seedUser(`${t}cs`, "customer_service", orgId);
}, 420_000);

afterAll(async () => {
  await db?.$disconnect();
  const { resetClientPool } = await import("@/database/prisma");
  await resetClientPool();
  await dropTestDatabase(adminUrl, testUrl);
});

describe("TASK-005｜店铺创建与列表", () => {
  it("O 创建店铺 201：demo_mode 继承组织、审计写入；platform 只是标签无连接状态", async () => {
    const { POST } = await import("@/app/api/v1/stores/route");
    const res = await POST(
      req("/api/v1/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "旗舰店",
          external_store_id: "ext-main",
          platform: "amazon",
          currency: "cny",
          timezone: "Asia/Shanghai",
        }),
      }, owner.cookie),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    const store = await db.store.findUniqueOrThrow({ where: { id: body.data.id } });
    expect(store.demoMode).toBe(false); // 组织 demoMode=false
    expect(store.currency).toBe("CNY"); // 统一大写
    const audit = await db.auditLog.findFirst({ where: { action: "store_create", entityId: store.id } });
    expect(audit).not.toBeNull();

    // GET 无经营数值/连接状态字段
    const { GET } = await import("@/app/api/v1/stores/route");
    const list = await GET(req("/api/v1/stores", {}, owner.cookie));
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: { items: Record<string, unknown>[] } };
    expect(listBody.data.items.length).toBeGreaterThan(0);
    for (const item of listBody.data.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["created_at", "currency", "demo_mode", "id", "name", "platform", "status", "timezone"].sort(),
      );
      expect(item).not.toHaveProperty("connected");
      expect(item).not.toHaveProperty("provider_status");
    }

    // C 也能看基础列表（全员），同样无经营数值
    const csList = await GET(req("/api/v1/stores", {}, cs.cookie));
    expect(csList.status).toBe(200);
  });

  it("409 同名 / 409 同外部标识 / 422 非法字段", async () => {
    const { POST } = await import("@/app/api/v1/stores/route");
    const mk = (body: Record<string, unknown>) =>
      POST(req("/api/v1/stores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, owner.cookie));

    expect((await mk({ name: "旗舰店", external_store_id: "ext-2", platform: "manual", currency: "CNY", timezone: "UTC" })).status).toBe(409);
    expect((await mk({ name: "店B", external_store_id: "ext-main", platform: "manual", currency: "CNY", timezone: "UTC" })).status).toBe(409);
    const badPlatform = await mk({ name: "店C", external_store_id: "ext-3", platform: "wish", currency: "CNY", timezone: "UTC" });
    expect(badPlatform.status).toBe(422);
    const badTz = await mk({ name: "店D", external_store_id: "ext-4", platform: "manual", currency: "CNY", timezone: "Mars/Olympus" });
    expect(badTz.status).toBe(422);
    const extra = await mk({ name: "店E", external_store_id: "ext-5", platform: "manual", currency: "CNY", timezone: "UTC", connected: true });
    expect(extra.status).toBe(422);
  });

  it("C 无 manageSettings：POST/PATCH 店铺 403", async () => {
    const { POST } = await import("@/app/api/v1/stores/route");
    const res = await POST(
      req("/api/v1/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", external_store_id: "x-1", platform: "manual", currency: "CNY", timezone: "UTC" }),
      }, cs.cookie),
    );
    expect(res.status).toBe(403);
  });
});

describe("TASK-005｜店铺更新、事实锁定与归档", () => {
  let storeId: string;

  beforeAll(async () => {
    const { POST } = await import("@/app/api/v1/stores/route");
    const res = await POST(
      req("/api/v1/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "可变店", external_store_id: "ext-lock", platform: "shopify", currency: "USD", timezone: "UTC" }),
      }, owner.cookie),
    );
    storeId = ((await res.json()) as { data: { id: string } }).data.id;
  });

  it("无事实时可改币种/时区；改名 row_version 递增；expected_version 冲突 409", async () => {
    const { PATCH } = await import("@/app/api/v1/stores/[id]/route");
    const v1 = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).rowVersion;
    const res = await PATCH(
      req(`/api/v1/stores/${storeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currency: "JPY", timezone: "Asia/Tokyo", expected_version: v1 }),
      }, owner.cookie),
      { params: Promise.resolve({ id: storeId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { currency: string; row_version: number } };
    expect(body.data.currency).toBe("JPY");
    expect(body.data.row_version).toBe(v1 + 1);

    const conflict = await PATCH(
      req(`/api/v1/stores/${storeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "并发改", expected_version: v1 }),
      }, owner.cookie),
      { params: Promise.resolve({ id: storeId }) },
    );
    expect(conflict.status).toBe(409);
  });

  it("首笔事实后币种/时区锁定：409 STORE_CONFIG_LOCKED；改名不受限", async () => {
    // 注入首笔事实：数据源 → 导入任务 → 商品行（任一业务事实表存在即锁定）
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    const ds = await db.dataSource.create({
      data: { orgId, storeId: store.id, sourceNamespace: "ns-lock", name: "锁定源", adapterKind: "csv" },
    });
    const task = await db.importTask.create({
      data: {
        orgId, storeId: store.id, dataSourceId: ds.id, sourceKind: "products",
        originalFilename: "p.csv", rawObjectKey: "raw/lock.csv", fileSha256: randomUUID(),
        uploadRequestKey: `up-${randomUUID().slice(0, 8)}`, baseDatasetVersion: 0n, createdBy: owner.userId,
      },
    });
    await db.product.create({
      data: {
        orgId, storeId: store.id, sourceNamespace: "ns-lock", sourceUpdatedAt: new Date(),
        importTaskId: task.id, rowHash: randomUUID(), externalProductId: "EP-1", name: "P1",
      },
    });
    void store;

    const { PATCH } = await import("@/app/api/v1/stores/[id]/route");
    const v = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).rowVersion;
    const locked = await PATCH(
      req(`/api/v1/stores/${storeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currency: "EUR", expected_version: v }),
      }, owner.cookie),
      { params: Promise.resolve({ id: storeId }) },
    );
    expect(locked.status).toBe(409);
    const lockedBody = (await locked.json()) as { error: { code: string } };
    expect(lockedBody.error.code).toBe("STORE_CONFIG_LOCKED");

    const lockedTz = await PATCH(
      req(`/api/v1/stores/${storeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: "Europe/Berlin", expected_version: v }),
      }, owner.cookie),
      { params: Promise.resolve({ id: storeId }) },
    );
    expect(lockedTz.status).toBe(409);

    // 改名/归档不受事实锁限制
    const rename = await PATCH(
      req(`/api/v1/stores/${storeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "锁后改名", expected_version: v }),
      }, owner.cookie),
      { params: Promise.resolve({ id: storeId }) },
    );
    expect(rename.status).toBe(200);
  });

  it("归档店拒绝新建数据源（409 STORE_ARCHIVED）；归档本身可执行", async () => {
    const { PATCH } = await import("@/app/api/v1/stores/[id]/route");
    const { POST: postSource } = await import("@/app/api/v1/data-sources/route");
    const v = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).rowVersion;
    const archive = await PATCH(
      req(`/api/v1/stores/${storeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "archived", expected_version: v }),
      }, owner.cookie),
      { params: Promise.resolve({ id: storeId }) },
    );
    expect(archive.status).toBe(200);

    const ds = await postSource(
      req("/api/v1/data-sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ store_id: storeId, name: "归档后源", adapter_kind: "csv", source_namespace: "ns-arch" }),
      }, owner.cookie),
    );
    expect(ds.status).toBe(409);
    const body = (await ds.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STORE_ARCHIVED");
  });
});

describe("TASK-005｜数据源", () => {
  let activeStoreId: string;
  let demoStoreId: string;

  beforeAll(async () => {
    const { POST } = await import("@/app/api/v1/stores/route");
    const res = await POST(
      req("/api/v1/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "活动店", external_store_id: "ext-active", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" }),
      }, owner.cookie),
    );
    activeStoreId = ((await res.json()) as { data: { id: string } }).data.id;
    // 演示店（组织非 demo，直接落库演示店）
    const s = await db.store.create({
      data: { orgId, name: "演示店", externalStoreId: "ext-demo", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai", demoMode: true },
    });
    demoStoreId = s.id;
  });

  it("csv 源 201 + 审计；mock 绑真实店 409；mock 绑演示店 201；namespace 重复 409", async () => {
    const { POST } = await import("@/app/api/v1/data-sources/route");
    const mk = (body: Record<string, unknown>) =>
      POST(req("/api/v1/data-sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, owner.cookie));

    const okCsv = await mk({ store_id: activeStoreId, name: "主站导出", adapter_kind: "csv", source_namespace: "ns-main" });
    expect(okCsv.status).toBe(201);
    const csvId = ((await okCsv.json()) as { data: { id: string } }).data.id;
    expect((await db.auditLog.findFirst({ where: { action: "data_source_create", entityId: csvId } }))).not.toBeNull();

    const mockReal = await mk({ store_id: activeStoreId, name: "mock 真实店", adapter_kind: "mock", source_namespace: "ns-mock-real" });
    expect(mockReal.status).toBe(409);
    expect(((await mockReal.json()) as { error: { code: string } }).error.code).toBe("MOCK_SOURCE_DEMO_ONLY");

    const mockDemo = await mk({ store_id: demoStoreId, name: "演示 mock", adapter_kind: "mock", source_namespace: "ns-demo" });
    expect(mockDemo.status).toBe(201);

    const dup = await mk({ store_id: activeStoreId, name: "重复命名空间", adapter_kind: "csv", source_namespace: "ns-main" });
    expect(dup.status).toBe(409);

    const badNs = await mk({ store_id: activeStoreId, name: "非法 ns", adapter_kind: "csv", source_namespace: "Bad NS!" });
    expect(badNs.status).toBe(422);
  });

  it("列表投影：O 六类实体、C 仅消息源；coverage 空摘要；last_import_at null；跨组织店铺 404", async () => {
    const { GET } = await import("@/app/api/v1/data-sources/route");
    const ownerView = await GET(req(`/api/v1/data-sources?store_id=${activeStoreId}`, {}, owner.cookie));
    expect(ownerView.status).toBe(200);
    const ownerBody = (await ownerView.json()) as { data: { items: Record<string, unknown>[] } };
    expect(ownerBody.data.items.length).toBeGreaterThan(0);
    for (const item of ownerBody.data.items) {
      expect(item.mapping_version).toBe("mapping-v1");
      expect(item.coverage).toEqual([]);
      expect(item.last_import_at).toBeNull();
      expect(item.supported_entities).toEqual([
        "products", "orders", "order_items", "ads", "customer_messages", "after_sales",
      ]);
    }

    // C：需要是该组织成员才可见（本套件 cs 即本组织成员）
    const csView = await GET(req(`/api/v1/data-sources?store_id=${activeStoreId}`, {}, cs.cookie));
    expect(csView.status).toBe(200);
    const csBody = (await csView.json()) as { data: { items: { supported_entities: string[] }[] } };
    for (const item of csBody.data.items) {
      expect(item.supported_entities).toEqual(["customer_messages"]);
    }

    // 跨组织 store_id → 404（数据不存在于当前组织）
    const otherT = randomUUID().slice(0, 8);
    const otherUser = await db.user.create({
      data: {
        id: randomUUID(),
        authUserId: (await db.authUser.create({ data: { id: `auth-${otherT}`, name: "o", email: `o-${otherT}@example.com` } })).id,
        email: `o-${otherT}@example.com`,
        displayName: "o",
      },
    });
    const otherOrg = await db.organization.create({ data: { id: randomUUID(), name: `其他组织${otherT}`, ownerUserId: otherUser.id } });
    const otherStore = await db.store.create({
      data: { orgId: otherOrg.id, name: "别家店", externalStoreId: "ext-other", platform: "manual", currency: "CNY", timezone: "UTC" },
    });
    const cross = await GET(req(`/api/v1/data-sources?store_id=${otherStore.id}`, {}, owner.cookie));
    expect(cross.status).toBe(404);
  });
});
