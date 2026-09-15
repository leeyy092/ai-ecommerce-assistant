/**
 * TASK-002｜P0 数据库与约束迁移集成测试（真实 PostgreSQL 17）。
 * 流程：独立测试库 aiea_test → 空库执行 prisma migrate deploy（首次=迁移、再次=幂等）
 * → 正常链路写入 → 各类约束阻断 → P1 实体未建表断言 → 清理。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createUtcPool } from "@/database/prisma";
import { applyMigrations, createTestDatabase, dropTestDatabase, resetDbSingletons, resolveDatabaseUrl } from "../helpers/pgMigrate";

const adminUrl = resolveDatabaseUrl().replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
// H11：每次运行唯一命名测试库，只管理本库生命周期，不触碰集群内其他数据库
const testUrl = await createTestDatabase(adminUrl, randomUUID().slice(0, 8));

function adminClient(): PrismaClient {
  adminPool = createUtcPool(adminUrl);
  return new PrismaClient({ adapter: new PrismaPg(adminPool) });
}


let prisma: PrismaClient;
let admin: PrismaClient;
let adminPool: import("pg").Pool;
let prismaPool: import("pg").Pool;

beforeAll(async () => {
  admin = adminClient();
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

/** 生成一条完整可写的最小业务链（org→store→source→import→product→sku→order→order_item） */
async function seedChain(p: PrismaClient, tag: string) {
  await p.authUser.create({ data: { id: `auth-${tag}`, name: `Owner ${tag}`, email: `owner-${tag}@example.com` } });
  const user = await p.user.create({
    data: { authUserId: `auth-${tag}`, email: `owner-${tag}@example.com`, displayName: `Owner ${tag}` },
  });
  const org = await p.organization.create({
    data: { name: `Org ${tag}`, ownerUserId: user.id },
  });
  await p.membership.create({
    data: { orgId: org.id, userId: user.id, role: "owner" },
  });
  const store = await p.store.create({
    data: { orgId: org.id, name: `Store ${tag}`, externalStoreId: `EXT-${tag}`, platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
  });
  const dataSource = await p.dataSource.create({
    data: { orgId: org.id, storeId: store.id, sourceNamespace: `ns-${tag}`, name: "CSV 来源", adapterKind: "csv" },
  });
  const importTask = await p.importTask.create({
    data: {
      orgId: org.id, storeId: store.id, dataSourceId: dataSource.id,
      sourceKind: "products", originalFilename: "products.csv",
      rawObjectKey: `raw/${tag}.csv`, fileSha256: randomUUID(),
      uploadRequestKey: `up-${tag}`, baseDatasetVersion: 0n, createdBy: user.id,
    },
  });
  const product = await p.product.create({
    data: {
      orgId: org.id, storeId: store.id, sourceNamespace: `ns-${tag}`,
      sourceUpdatedAt: new Date(), importTaskId: importTask.id, rowHash: randomUUID(),
      externalProductId: `P-${tag}`, name: "保温杯",
    },
  });
  const sku = await p.sKU.create({
    data: {
      orgId: org.id, storeId: store.id, sourceNamespace: `ns-${tag}`,
      sourceUpdatedAt: new Date(), importTaskId: importTask.id, rowHash: randomUUID(),
      productId: product.id, externalSkuId: `S-${tag}`, skuCode: `CODE-${tag}`, name: "红杯",
    },
  });
  const order = await p.order.create({
    data: {
      orgId: org.id, storeId: store.id, sourceNamespace: `ns-${tag}`,
      sourceUpdatedAt: new Date(), importTaskId: importTask.id, rowHash: randomUUID(),
      externalOrderId: `O-${tag}`, paymentStatus: "paid",
      paidAt: new Date(), orderedAt: new Date(), currency: "CNY", expectedItemCount: 1,
    },
  });
  const orderItem = await p.orderItem.create({
    data: {
      orgId: org.id, storeId: store.id, sourceNamespace: `ns-${tag}`,
      sourceUpdatedAt: new Date(), importTaskId: importTask.id, rowHash: randomUUID(),
      orderId: order.id, externalOrderItemId: "L1", skuId: sku.id,
      quantity: 2, itemPaidAmount: 100.0, currency: "CNY",
    },
  });
  return { user, org, store, dataSource, importTask, product, sku, order, orderItem };
}

describe("TASK-002｜P0 数据库与约束迁移（真实 PostgreSQL）", () => {
  it("空库迁移部署成功，且重复部署幂等（从空库与上次迁移各验证一次；迁移数随 Gate-01 修复递增）", async () => {
    await applyMigrations(testUrl);
  resetDbSingletons(); // 幂等重放：无待应用项
    return expect(
      prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`),
    ).resolves.toEqual([{ n: 12 }]); // REVIEW_4/5：+复合FK、UUID 全量、FK Schema 同步；GATE_02：+店铺同名唯一、导入认领/HTTP幂等
  });

  it("正常记录链可写入（B 组默认值与复合外键生效）", async () => {
    const chain = await seedChain(prisma, "ok");
    expect(chain.org.rowVersion).toBe(1);
    expect(chain.orderItem.quantity).toBe(2);
    const found = await prisma.orderItem.findUniqueOrThrow({
      where: { orgId_storeId_sourceNamespace_orderId_externalOrderItemId: {
        orgId: chain.org.id, storeId: chain.store.id, sourceNamespace: `ns-ok`,
        orderId: chain.order.id, externalOrderItemId: "L1",
      } },
    });
    expect(found.skuId).toBe(chain.sku.id);
  });

  it("异租户外键被阻断：B 组织订单行引用 A 组织 SKU", async () => {
    const a = await seedChain(prisma, "aa");
    await prisma.authUser.create({ data: { id: "auth-bb", name: "B Owner", email: "owner-bb@example.com" } });
    const bUser = await prisma.user.create({
      data: { authUserId: "auth-bb", email: "owner-bb@example.com", displayName: "B Owner" },
    });
    const bOrg = await prisma.organization.create({ data: { name: "Org B", ownerUserId: bUser.id } });
    const bStore = await prisma.store.create({
      data: { orgId: bOrg.id, name: "Store B", externalStoreId: "EXT-bb", platform: "manual", currency: "CNY", timezone: "Asia/Shanghai" },
    });
    await expect(
      prisma.orderItem.create({
        data: {
          orgId: bOrg.id, storeId: bStore.id, sourceNamespace: "ns-aa",
          sourceUpdatedAt: new Date(), importTaskId: a.importTask.id, rowHash: randomUUID(),
          orderId: a.order.id, externalOrderItemId: "LX", skuId: a.sku.id,
          quantity: 1, itemPaidAmount: 10.0, currency: "CNY",
        },
      }),
    ).rejects.toThrow(/Foreign key constraint failed|ck_|foreign key/i);
  });

  it("重复自然键被阻断：同 (org,store,namespace,external_sku_id)", async () => {
    const a = await seedChain(prisma, "dup");
    await expect(
      prisma.sKU.create({
        data: {
          orgId: a.org.id, storeId: a.store.id, sourceNamespace: "ns-dup",
          sourceUpdatedAt: new Date(), importTaskId: a.importTask.id, rowHash: randomUUID(),
          productId: a.product.id, externalSkuId: "S-dup", skuCode: "CODE-dup-2", name: "重复",
        },
      }),
    ).rejects.toThrow(/Unique constraint failed/i);
  });

  it("单 Owner 部分唯一被阻断：同组织第二个 owner 成员", async () => {
    const a = await seedChain(prisma, "one-owner");
    await prisma.authUser.create({ data: { id: "auth-other", name: "Other", email: "other@example.com" } });
    const other = await prisma.user.create({
      data: { authUserId: "auth-other", email: "other@example.com", displayName: "Other" },
    });
    await expect(
      prisma.membership.create({
        data: { orgId: a.org.id, userId: other.id, role: "owner" },
      }),
    ).rejects.toThrow(/uq_membership_single_owner|Unique constraint failed/i);
  });

  it("负销量被 CHECK 阻断", async () => {
    const a = await seedChain(prisma, "negqty");
    await expect(
      prisma.orderItem.create({
        data: {
          orgId: a.org.id, storeId: a.store.id, sourceNamespace: "ns-negqty",
          sourceUpdatedAt: new Date(), importTaskId: a.importTask.id, rowHash: randomUUID(),
          orderId: a.order.id, externalOrderItemId: "L2", skuId: a.sku.id,
          quantity: -1, itemPaidAmount: 5.0, currency: "CNY",
        },
      }),
    ).rejects.toThrow(/ck_order_item_quantity_range|check constraint/i);
  });

  it("非法币种被 CHECK 阻断（小写与超长）", async () => {
    const a = await seedChain(prisma, "badcur");
    await expect(
      prisma.order.create({
        data: {
          orgId: a.org.id, storeId: a.store.id, sourceNamespace: "ns-badcur",
          sourceUpdatedAt: new Date(), importTaskId: a.importTask.id, rowHash: randomUUID(),
          externalOrderId: "O-badcur-1", paymentStatus: "unpaid",
          orderedAt: new Date(), currency: "cny", expectedItemCount: 1,
        },
      }),
    ).rejects.toThrow(/ck_order_currency|check constraint/i);
    await expect(
      prisma.store.update({
        where: { orgId_externalStoreId: { orgId: a.org.id, externalStoreId: "EXT-badcur" } },
        data: { currency: "CNYX" },
      }),
    ).rejects.toThrow();
  });

  it("退款事件条件字段被 CHECK 阻断（succeeded 缺金额）", async () => {
    const a = await seedChain(prisma, "refund");
    await expect(
      prisma.refundEvent.create({
        data: {
          orgId: a.org.id, storeId: a.store.id, sourceNamespace: "ns-refund",
          sourceUpdatedAt: new Date(), importTaskId: a.importTask.id, rowHash: randomUUID(),
          externalRecordId: "RF-1", orderId: a.order.id, orderItemId: a.orderItem.id,
          occurredAt: new Date(), status: "succeeded", completedAt: new Date(),
          currency: "CNY", reasonCode: "quality",
        },
      }),
    ).rejects.toThrow(/ck_refund_succeeded_fields|check constraint/i);
  });

  it("P1/P2 实体未建表；认证四表存在", async () => {
    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`,
    );
    const names = tables.map((t) => t.table_name);
    for (const p1 of ["competitor", "cost_entry", "traffic_metric", "review", "inventory_snapshot"]) {
      expect(names).not.toContain(p1);
    }
    for (const authTable of ["user", "session", "account", "verification"]) {
      expect(names).toContain(authTable);
    }
    // 28 个领域表全部存在
    for (const t of [
      "domain_user", "organization", "membership", "invitation", "store", "data_source", "rule_config",
      "product", "sku", "sku_alias", "order", "order_item", "after_sale_record", "refund_event", "ad_metric",
      "customer_message", "daily_metric", "voc_insight", "rule_evaluation", "alert", "ai_insight",
      "action_state", "ai_report", "ai_run", "import_task", "data_coverage", "job_run", "audit_log",
    ]) {
      expect(names).toContain(t);
    }
  });
});
