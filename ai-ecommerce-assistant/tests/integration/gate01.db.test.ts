/**
 * Gate-01 修复回归（TASK-002）：
 * H08｜AuditLog 店铺同域强制（数据库触发器）：同域 PASS / 异域 FAIL / 空 store PASS。
 * H09｜领域时间列 timestamptz：类型断言（领域表=带时区，认证四表=框架原生无时区）
 *      与跨会话时区等值（同一时刻 UTC/+08 写入读回一致）。
 * 空库全链路由本套件自身覆盖（独立测试库 migrate deploy）；
 * 现有库升级路径见 12_PROGRESS 中 aiea_dev 的 deploy 记录。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { baseUrlFromDotenv } from "../helpers/pgMigrate";
import { applyMigrations, resetDbSingletons } from "../helpers/pgMigrate";
import { applyMigrationsUpTo } from "../helpers/pgMigrate";
import { loadEnv } from "@/lib/env";

process.env.DATABASE_URL = baseUrlFromDotenv();
const baseEnv = loadEnv();

const TEST_DB = "aiea_gate01_test";
const adminUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);

let prisma: PrismaClient;
let admin: PrismaClient;

beforeAll(async () => {
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'aiea_%' AND pid <> pg_backend_pid()`,
  ).catch(() => {});
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  await applyMigrations(testUrl);
  resetDbSingletons();
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }) });
});

afterAll(async () => {
  await prisma?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$disconnect();
});

describe("Gate-01 H08｜AuditLog 店铺同域强制（数据库级）", () => {
  it("同组织店铺 PASS；跨组织店铺 FAIL；空 store PASS", async () => {
    const t = randomUUID().slice(0, 8);
    const mk = async (tag: string) => {
      await prisma.authUser.create({ data: { id: `auth-${tag}`, name: tag, email: `u-${tag}@example.com` } });
      const user = await prisma.user.create({
        data: { authUserId: `auth-${tag}`, email: `u-${tag}@example.com`, displayName: tag },
      });
      const org = await prisma.organization.create({
        data: { id: randomUUID(), name: `组织${tag}`, ownerUserId: user.id },
      });
      const store = await prisma.store.create({
        data: { id: randomUUID(), orgId: org.id, name: `店${tag}`, externalStoreId: `EXT-${tag}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
      });
      return { org, store };
    };
    const a = await mk(`${t}a`);
    const b = await mk(`${t}b`);

    const insert = (orgId: string, storeId: string | null) =>
      prisma.auditLog.create({
        data: {
          id: randomUUID(), orgId, storeId, action: "probe", entityType: "probe",
          entityId: randomUUID(), requestId: randomUUID(),
        },
      });

    await expect(insert(a.org.id, a.store.id)).resolves.toBeTruthy(); // 同域
    await expect(insert(a.org.id, null)).resolves.toBeTruthy(); // 组织级（空店铺）
    await expect(insert(a.org.id, b.store.id)).rejects.toThrow(/同域校验失败|audit_log store/); // 异域
  });
});

describe("Gate-01 H09｜领域时间列 timestamptz", () => {
  it("领域表时间为带时区类型；Better Auth 四表保持框架原生（不带时区）", async () => {
    const domainTz = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN
        ('domain_user','organization','membership','invitation','store','import_task','audit_log','job_run')
        AND column_name IN ('created_at','updated_at') AND data_type='timestamp with time zone'`;
    expect(Number(domainTz[0].n)).toBeGreaterThanOrEqual(16);

    const authTz = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('user','session','account','verification')
        AND data_type='timestamp with time zone'`;
    expect(Number(authTz[0].n)).toBe(0);
  });

  it("跨会话时区等值：UTC 与 Asia/Shanghai 会话写入同一时刻，读回一致", async () => {
    const email = `tz-${randomUUID().slice(0, 8)}@example.com`;
    const idUtc = randomUUID();
    const idSh = randomUUID();

    await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${`auth-${idUtc.slice(0, 8)}`}, 'tz', ${`utc-${email}`}, false, now(), now())`;
    await prisma.$executeRaw`SET TIME ZONE 'UTC'`;
    await prisma.$executeRaw`INSERT INTO domain_user (id, auth_user_id, email, display_name, created_at, updated_at, status)
      VALUES (${idUtc}, ${`auth-${idUtc.slice(0, 8)}`}, ${`utc-${email}`}, 'utc', '2026-01-01 12:00:00+00', '2026-01-01 12:00:00+00', 'active')`;

    await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${`auth-${idSh.slice(0, 8)}`}, 'tz', ${`sh-${email}`}, false, now(), now())`;
    await prisma.$executeRaw`SET TIME ZONE 'Asia/Shanghai'`;
    await prisma.$executeRaw`INSERT INTO domain_user (id, auth_user_id, email, display_name, created_at, updated_at, status)
      VALUES (${idSh}, ${`auth-${idSh.slice(0, 8)}`}, ${`sh-${email}`}, 'sh', '2026-01-01 20:00:00+08', '2026-01-01 20:00:00+08', 'active')`;

    await prisma.$executeRaw`SET TIME ZONE 'UTC'`; // 读回也切回 UTC，排除显示影响
    const rows = await prisma.user.findMany({
      where: { id: { in: [idUtc, idSh] } },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    const diff = Math.abs(rows[1].createdAt.getTime() - rows[0].createdAt.getTime());
    expect(diff).toBeLessThanOrEqual(1000); // 同一时刻（允许毫秒级截断）
  });
});

describe("Gate-01 正式复核 H08/H09/M04 增补", () => {
  it("H08：store.org_id 变更使审计脱离同域 → 阻断；无引用时允许", async () => {
    const t = randomUUID().slice(0, 8);
    await prisma.authUser.create({ data: { id: `auth-h08-${t}`, name: "h08", email: `h08-${t}@example.com` } });
    const user = await prisma.user.create({
      data: { authUserId: `auth-h08-${t}`, email: `h08-${t}@example.com`, displayName: "h08" },
    });
    await prisma.authUser.create({ data: { id: `auth-h08b-${t}`, name: "h08b", email: `h08b-${t}@example.com` } });
    const userB = await prisma.user.create({
      data: { authUserId: `auth-h08b-${t}`, email: `h08b-${t}@example.com`, displayName: "h08b" },
    });
    const orgA = await prisma.organization.create({ data: { id: randomUUID(), name: `HA-${t}`, ownerUserId: user.id } });
    const orgB = await prisma.organization.create({ data: { id: randomUUID(), name: `HB-${t}`, ownerUserId: userB.id } });
    const store = await prisma.store.create({
      data: { id: randomUUID(), orgId: orgA.id, name: "S", externalStoreId: `EX-${t}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    });
    await prisma.auditLog.create({
      data: { id: randomUUID(), orgId: orgA.id, storeId: store.id, action: "x", entityType: "x", entityId: randomUUID(), requestId: randomUUID() },
    });
    await expect(
      prisma.store.update({ where: { id: store.id }, data: { orgId: orgB.id } }),
    ).rejects.toThrow(/组织归属变更|org reassign/i);

    // 无审计引用的店铺可正常迁移归属
    const store2 = await prisma.store.create({
      data: { id: randomUUID(), orgId: orgA.id, name: "S2", externalStoreId: `EX2-${t}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    });
    await expect(
      prisma.store.update({ where: { id: store2.id }, data: { orgId: orgB.id } }),
    ).resolves.toBeTruthy();
  });

  it("H08：升级守卫——存量跨域引用使 v2 迁移失败（拒绝静默通过）", async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const { PrismaClient } = await import("@/generated/prisma/client");
    const guardDb = "aiea_gate01_upgrade_guard";
    const guardUrl = testUrl.replace(`/${TEST_DB}`, `/${guardDb}`);
    const admin2 = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
    await admin2.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${guardDb}" WITH (FORCE)`);
    await admin2.$executeRawUnsafe(`CREATE DATABASE "${guardDb}"`);
    await admin2.$disconnect();

    // 只应用到 v1 审计迁移（无守卫），注入坏行，再应用 v2 → 必须失败
    await applyMigrationsUpTo(guardUrl, "20260913044218_p0_audit_tenant_fk");
    const seed = new PrismaClient({ adapter: new PrismaPg({ connectionString: guardUrl }) });
    await seed.authUser.create({ data: { id: "auth-g", name: "g", email: "g@example.com" } });
    await seed.authUser.create({ data: { id: "auth-g2", name: "g2", email: "g2@example.com" } });
    const u = await seed.user.create({ data: { authUserId: "auth-g", email: "g@example.com", displayName: "g" } });
    const u2 = await seed.user.create({ data: { authUserId: "auth-g2", email: "g2@example.com", displayName: "g2" } });
    const oa = await seed.organization.create({ data: { id: randomUUID(), name: "GA", ownerUserId: u.id } });
    const ob = await seed.organization.create({ data: { id: randomUUID(), name: "GB", ownerUserId: u2.id } });
    const sb = await seed.store.create({ data: { id: randomUUID(), orgId: ob.id, name: "SB", externalStoreId: "EXB", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" } });
    // 绕过 v1 行级触发器：直接禁用后再启用会破坏增量，这里用超管连接绕过（测试库）
    await seed.$executeRawUnsafe(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_store_same_domain_trg`);
    await seed.auditLog.create({ data: { id: randomUUID(), orgId: oa.id, storeId: sb.id, action: "bad", entityType: "x", entityId: randomUUID(), requestId: randomUUID() } });
    await seed.$executeRawUnsafe(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_store_same_domain_trg`);
    await seed.$disconnect();

    await expect(applyMigrationsUpTo(guardUrl, "20260913120100_p0_audit_tenant_fk_v2")).rejects.toThrow(/跨组织店铺引用/);
    const admin3 = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
    await admin3.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${guardDb}" WITH (FORCE)`);
    await admin3.$disconnect();
  });

  it("H09：全量清单——领域表零 timestamp without time zone；认证四表保持原生", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema='public' AND data_type='timestamp without time zone'
      GROUP BY table_name`;
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(["account", "session", "user", "verification"]);
  });

  it("M04：悬空 auth_user_id 被 FK 阻断；合法引用可写", async () => {
    await expect(
      prisma.user.create({
        data: { authUserId: `ghost-${randomUUID().slice(0, 8)}`, email: `ghost-${randomUUID().slice(0, 8)}@example.com`, displayName: "ghost" },
      }),
    ).rejects.toThrow(/Foreign key constraint failed|domain_user_auth_user_id_fkey/i);
  });
});
