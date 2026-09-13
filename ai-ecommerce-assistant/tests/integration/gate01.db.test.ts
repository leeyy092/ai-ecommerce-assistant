/**
 * Gate-01 修复回归（TASK-002）：
 * H08｜AuditLog 店铺同域强制（数据库触发器）：同域 PASS / 异域 FAIL / 空 store PASS。
 * H09｜领域时间列 timestamptz：类型断言（领域表=带时区，认证四表=框架原生无时区）
 *      与跨会话时区等值（同一时刻 UTC/+08 写入读回一致）。
 * 空库全链路由本套件自身覆盖（独立测试库 migrate deploy）；
 * 现有库升级路径见 12_PROGRESS 中 aiea_dev 的 deploy 记录。
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { loadDotEnvIfPresent } from "@/lib/dotenv";
import { loadEnv } from "@/lib/env";

loadDotEnvIfPresent();
const baseEnv = loadEnv();

const TEST_DB = "aiea_gate01_test";
const adminUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const testUrl = baseEnv.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, `/${TEST_DB}$1`);

let prisma: PrismaClient;
let admin: PrismaClient;

beforeAll(async () => {
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
    timeout: 180_000,
  });
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

    await prisma.$executeRaw`SET TIME ZONE 'UTC'`;
    await prisma.$executeRaw`INSERT INTO domain_user (id, auth_user_id, email, display_name, created_at, updated_at, status)
      VALUES (${idUtc}, ${`auth-${idUtc.slice(0, 8)}`}, ${`utc-${email}`}, 'utc', '2026-01-01 12:00:00+00', '2026-01-01 12:00:00+00', 'active')`;

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
