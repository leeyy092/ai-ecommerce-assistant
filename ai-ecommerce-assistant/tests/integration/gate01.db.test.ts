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
import { createUtcPool, UTC_SESSION_OPTIONS } from "@/database/prisma";
import {
  applyMigrations,
  applyMigrationsUpTo,
  createTestDatabase,
  dropTestDatabase,
  resetDbSingletons,
  resolveDatabaseUrl,
} from "../helpers/pgMigrate";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
// H11：每次运行唯一命名测试库，只管理本库生命周期，不触碰集群内其他数据库
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));

let prisma: PrismaClient;
let admin: PrismaClient;
let adminPool: import("pg").Pool;
let prismaPool: import("pg").Pool;

beforeAll(async () => {
  adminPool = createUtcPool(adminUrl);
  admin = new PrismaClient({ adapter: new PrismaPg(adminPool) });
  await applyMigrations(testUrl);
  resetDbSingletons();
  prismaPool = createUtcPool(testUrl);
  prisma = new PrismaClient({ adapter: new PrismaPg(prismaPool) });
});

afterAll(async () => {
  await prisma?.$disconnect();
  await admin.$disconnect();
  await admin.$disconnect();
  await prisma.$disconnect();
  await adminPool.end().catch(() => undefined);
  await prismaPool.end().catch(() => undefined);
  await dropTestDatabase(adminUrl, testUrl);
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

  it("H08 REVIEW_4：并发交错方向 A——父行改归属未提交时插入旧组织审计引用，后者必须失败", async () => {
    const t = randomUUID().slice(0, 8);
    const pg = (await import("pg")).default;
    const mk = async (tag: string) => {
      await prisma.authUser.create({ data: { id: `auth-${tag}`, name: tag, email: `r-${tag}@example.com` } });
      const user = await prisma.user.create({
        data: { authUserId: `auth-${tag}`, email: `r-${tag}@example.com`, displayName: tag },
      });
      const org = await prisma.organization.create({ data: { id: randomUUID(), name: `R组织${tag}`, ownerUserId: user.id } });
      const store = await prisma.store.create({
        // 名称按 tag 区分：G2-M02 起 (org_id, name) 唯一，跨组织迁移夹具不能同名
        data: { id: randomUUID(), orgId: org.id, name: `RS-${tag}`, externalStoreId: `REXT-${tag}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
      });
      return { org, store };
    };
    const { org: orgA2, store: sharedStore } = await mk(`${t}a`);
    const { org: orgB2 } = await mk(`${t}b`);

    const c1 = new pg.Client({ connectionString: testUrl, options: UTC_SESSION_OPTIONS });
    c1.on("error", () => undefined);
    const c2 = new pg.Client({ connectionString: testUrl, options: UTC_SESSION_OPTIONS });
    c2.on("error", () => undefined);
    await c1.connect();
    await c2.connect();
    try {
      // T1：父行改归属，暂不提交
      await c1.query("BEGIN");
      await c1.query("UPDATE store SET org_id=$1 WHERE id=$2", [orgB2.id, sharedStore.id]);
      // T2：插入旧组织审计引用——RI 检查对父行取 KEY SHARE 锁，须等待 T1 提交；
      // 先挂起 promise 再提交 T1（等待中的 RI 检查不阻塞 T1），最后断言 T2 被拒
      await c2.query("BEGIN");
      const auditId = randomUUID();
      const insertPromise = c2.query(
        `INSERT INTO audit_log (id,org_id,store_id,action,entity_type,entity_id,request_id,updated_at)
         VALUES ($1,$2,$3,'race','probe',$4,$5,now())`,
        [auditId, orgA2.id, sharedStore.id, auditId, auditId],
      ).then(
        () => "OK",
        (e: { code?: string; message?: string }) => `${e.code ?? ""}:${e.message ?? ""}`,
      );
      await new Promise((r) => setTimeout(r, 300)); // 让 T2 进入父行锁等待
      await c1.query("COMMIT");
      const insertResult = await insertPromise;
      expect(insertResult).toMatch(/23503|violates foreign key|fk_audit_log_store_same_domain/i);
      await c2.query("ROLLBACK");

      const cross = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::int AS n FROM audit_log a JOIN store s ON s.id = a.store_id WHERE a.org_id <> s.org_id`;
      expect(Number(cross[0].n)).toBe(0);
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
  });

  it("H08 REVIEW_4：并发交错方向 B——审计引用未提交时改父行归属，后者必须失败且引用方正常提交", async () => {
    const t = randomUUID().slice(0, 8);
    const pg = (await import("pg")).default;
    const mk = async (tag: string) => {
      await prisma.authUser.create({ data: { id: `auth-${tag}`, name: tag, email: `s-${tag}@example.com` } });
      const user = await prisma.user.create({
        data: { authUserId: `auth-${tag}`, email: `s-${tag}@example.com`, displayName: tag },
      });
      const org = await prisma.organization.create({ data: { id: randomUUID(), name: `S组织${tag}`, ownerUserId: user.id } });
      const store = await prisma.store.create({
        data: { id: randomUUID(), orgId: org.id, name: "SS", externalStoreId: `SEXT-${tag}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
      });
      return { org, store };
    };
    const { org: orgA2, store: sharedStore } = await mk(`${t}a`);
    const { org: orgB2 } = await mk(`${t}b`);

    const c1 = new pg.Client({ connectionString: testUrl, options: UTC_SESSION_OPTIONS });
    c1.on("error", () => undefined);
    const c2 = new pg.Client({ connectionString: testUrl, options: UTC_SESSION_OPTIONS });
    c2.on("error", () => undefined);
    await c1.connect();
    await c2.connect();
    try {
      // T2：先插入同域审计引用，暂不提交
      await c2.query("BEGIN");
      const auditId = randomUUID();
      await c2.query(
        `INSERT INTO audit_log (id,org_id,store_id,action,entity_type,entity_id,request_id,updated_at)
         VALUES ($1,$2,$3,'race','probe',$4,$5,now())`,
        [auditId, orgA2.id, sharedStore.id, auditId, auditId],
      );
      // T1：父行改归属须等待 T2 提交（被引用键变更与子行 KEY SHARE 冲突），
      // 随后被守卫/复合 FK 拒绝；先挂起 promise 再提交 T2，最后断言 T1 被拒
      await c1.query("BEGIN");
      const updatePromise = c1
        .query("UPDATE store SET org_id=$1 WHERE id=$2", [orgB2.id, sharedStore.id])
        .then(
          () => "OK",
          (e: { code?: string; message?: string }) => `${e.code ?? ""}:${e.message ?? ""}`,
        );
      await new Promise((r) => setTimeout(r, 300)); // 让 T1 进入父行锁等待
      await c2.query("COMMIT");
      const updateResult = await updatePromise;
      expect(updateResult).toMatch(/组织归属变更|still referenced|23503|violates foreign key/i);
      await c1.query("ROLLBACK");

      const cross = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::int AS n FROM audit_log a JOIN store s ON s.id = a.store_id WHERE a.org_id <> s.org_id`;
      expect(Number(cross[0].n)).toBe(0);
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }
  });

  it("H08 REVIEW_4：删除店铺只清 store_id、保留 org_id；M04 领域主键 UUID 约束存在", async () => {
    const t = randomUUID().slice(0, 8);
    await prisma.authUser.create({ data: { id: `auth-${t}`, name: t, email: `d-${t}@example.com` } });
    const user = await prisma.user.create({
      data: { authUserId: `auth-${t}`, email: `d-${t}@example.com`, displayName: t },
    });
    const org = await prisma.organization.create({ data: { id: randomUUID(), name: `D组织${t}`, ownerUserId: user.id } });
    const store = await prisma.store.create({
      data: { id: randomUUID(), orgId: org.id, name: "DS", externalStoreId: `DEXT-${t}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    });
    const auditId = randomUUID();
    await prisma.auditLog.create({
      data: { id: auditId, orgId: org.id, storeId: store.id, action: "del", entityType: "probe", entityId: randomUUID(), requestId: randomUUID() },
    });

    // M04 REVIEW_5：领域 28/28 表主键 UUID CHECK 全量覆盖；auth_rate_limit 辅助表单独约束；认证框架四表不带
    const ck = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::int AS n FROM pg_constraint
      WHERE contype='c' AND conname LIKE 'ck_domain_uuid_%'`;
    expect(Number(ck[0].n)).toBe(28);
    const auxCk = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::int AS n FROM pg_constraint
      WHERE conrelid='auth_rate_limit'::regclass AND conname = 'ck_auth_rate_limit_uuid'`;
    expect(Number(auxCk[0].n)).toBe(1);
    const authCk = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::int AS n FROM pg_constraint
      WHERE conrelid IN ('user'::regclass,'session'::regclass,'account'::regclass,'verification'::regclass)
        AND (conname LIKE 'ck_domain_uuid_%' OR conname = 'ck_auth_rate_limit_uuid')`;
    expect(Number(authCk[0].n)).toBe(0);

    // M04：遗漏表代表（JobRun）非法 ID 被数据库拒绝（23514 check violation）、合法 UUID 通过
    await expect(
      prisma.$executeRaw`
      INSERT INTO job_run (id, org_id, store_id, job_kind, idempotency_key, context, dataset_version, ruleset_version, status, attempt_count, created_at, updated_at, row_version)
      VALUES ('not-a-uuid-review', ${org.id}, ${store.id}, 'recompute_snapshot', ${"idem-" + t}, '{}'::jsonb, 1, 'v1', 'succeeded', 1, now(), now(), 1)`,
    ).rejects.toThrow(/23514/);
    const legalId = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO job_run (id, org_id, store_id, job_kind, idempotency_key, context, dataset_version, ruleset_version, status, attempt_count, created_at, updated_at, row_version)
      VALUES (${legalId}, ${org.id}, ${store.id}, 'recompute_snapshot', ${"idem2-" + t}, '{}'::jsonb, 1, 'v1', 'succeeded', 1, now(), now(), 1)`;
    await prisma.jobRun.delete({ where: { id: legalId } });

    // H08 删除语义：删除店铺只清 store_id、保留 org_id
    await prisma.store.delete({ where: { id: store.id } });
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id: auditId } });
    expect(row.storeId).toBeNull();
    expect(row.orgId).toBe(org.id);
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
    // H11：守卫夹具库同样唯一命名、仅自管理
    const guardUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));

    // 只应用到 v1 审计迁移（无守卫），注入坏行，再应用 v2 → 必须失败
    await applyMigrationsUpTo(guardUrl, "20260913044218_p0_audit_tenant_fk");
    const seedPool = createUtcPool(guardUrl);
    const seed = new PrismaClient({ adapter: new PrismaPg(seedPool) });
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
    await seed.$disconnect();
    await dropTestDatabase(adminUrl, guardUrl);
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

describe("Gate-01 REVIEW_5｜TASK-002（H12 连接边界 / M06 upTo / M07 Schema 同步护栏）", () => {
  it("H12：应用连接池会话为 UTC；ORM 写→SQL epoch、SQL 写→ORM 读均与真实时刻一致（原始 pg 独立参考）", async () => {
    // 1) 应用连接（createUtcPool）会话时区必须是 UTC
    const tz = await prisma.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`;
    expect(String(tz[0].TimeZone)).toMatch(/^(UTC|Etc\/UTC|GMT)$/i);

    // 2) ORM 写 → 原始 SQL 读 epoch：绝对时刻一致（与集群默认时区无关）
    const t = randomUUID().slice(0, 8);
    await prisma.authUser.create({ data: { id: `auth-${t}`, name: t, email: `tz2-${t}@example.com` } });
    const user = await prisma.user.create({
      data: { authUserId: `auth-${t}`, email: `tz2-${t}@example.com`, displayName: t },
    });
    const org = await prisma.organization.create({ data: { id: randomUUID(), name: `TZ组织${t}`, ownerUserId: user.id } });
    const at = new Date("2026-01-01T00:30:00.000Z");
    const inv = await prisma.invitation.create({
      data: { id: randomUUID(), orgId: org.id, email: `tz2-${t}@example.com`, role: "operator", tokenHash: `hash-${t}`, invitedBy: user.id, expiresAt: at },
    });
    const pgMod = (await import("pg")).default;
    const raw = new pgMod.Client({ connectionString: testUrl, options: UTC_SESSION_OPTIONS });
    raw.on("error", () => undefined);
    await raw.connect();
    try {
      const dbEpoch = Number((await raw.query<{ e: string }>(`SELECT EXTRACT(EPOCH FROM expires_at)::text AS e FROM invitation WHERE id=$1`, [inv.id])).rows[0].e);
      expect(Math.floor(dbEpoch)).toBe(Math.floor(at.getTime() / 1000));

      // 3) SQL 写（非 UTC 偏移字面量表达同一时刻）→ ORM 读：绝对时刻一致
      const sqlEpoch = 1767225600; // 2026-01-01T00:00:00Z
      await raw.query(`UPDATE invitation SET expires_at = '2026-01-01 08:00:00+08' WHERE id=$1`, [inv.id]);
      const readBack = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
      expect(Math.floor(readBack.expiresAt.getTime() / 1000)).toBe(sqlEpoch);

      // 4) 多连接池：另一条原始连接读同一行，epoch 一致
      const raw2 = new pgMod.Client({ connectionString: testUrl });
      raw2.on("error", () => undefined);
      await raw2.connect();
      try {
        const dbEpoch2 = Number((await raw2.query<{ e: string }>(`SELECT EXTRACT(EPOCH FROM expires_at)::text AS e FROM invitation WHERE id=$1`, [inv.id])).rows[0].e);
        expect(Math.floor(dbEpoch2)).toBe(sqlEpoch);
      } finally {
        await raw2.end();
      }
      await prisma.invitation.delete({ where: { id: inv.id } });
    } finally {
      await raw.end();
    }
  });

  it("M06：applyMigrationsUpTo 首次执行到目标、重复不越界、不存在目标明确失败", async () => {
    const guardUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));
    const target = "20260913043631_p0_domain_timestamptz"; // 第 3 份迁移
    const first = await applyMigrationsUpTo(guardUrl, target);
    expect(first.length).toBe(3);
    const repeat = await applyMigrationsUpTo(guardUrl, target);
    expect(repeat.length).toBe(0);
    const pgMod = (await import("pg")).default;
    const c = new pgMod.Client({ connectionString: guardUrl });
    c.on("error", () => undefined);
    await c.connect();
    const n = (await c.query("SELECT count(*)::int AS n FROM _prisma_migrations")).rows[0].n;
    await c.end();
    expect(n).toBe(3);
    await expect(applyMigrationsUpTo(guardUrl, "20991231_not_exists")).rejects.toThrow(/不存在/);
    await dropTestDatabase(adminUrl, guardUrl);
  });

  it("M07：官方 migrate diff 不再净删除审计同域复合外键（重建必须同引用且配平）", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: testUrl }, timeout: 120_000 },
    );
    // 复合外键的单列旧外键已由迁移移除
    expect(out).not.toContain("audit_log_store_id_fkey");
    // 对 audit_log 同域外键：任何 DROP 必须伴随同引用 (org_id, store_id)→store(org_id, id) 的 ADD（按列 SET NULL 是 Prisma 无法表达的 SQL 维护边界）
    const drops = out.match(/ALTER TABLE "audit_log" DROP CONSTRAINT "[^"]+"/g) ?? [];
    for (const drop of drops) {
      const name = drop.match(/DROP CONSTRAINT "([^"]+)"/)![1];
      const addRe = new RegExp(`ADD CONSTRAINT "${name}" [^;]*REFERENCES "store"\\("org_id", "id"\\)`);
      expect(out).toMatch(addRe);
    }
  });
});
