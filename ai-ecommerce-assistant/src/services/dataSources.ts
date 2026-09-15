/**
 * 数据源配置（TASK-005；08 §data-sources）。
 * - csv/mock 两类适配；同一来源（namespace）支持六类标准文件（TASK-006 统一 Adapter）；
 * - mock 只能绑定演示店铺；归档店铺拒绝新建数据源（TASK-005 验收：归档店拒绝新导入）；
 * - mapping_version 由统一 Adapter 约定（mapping-v1）；
 * - 列表按角色裁剪 supported_entities：客服仅 customer_messages（02_USER_ROLES）；
 * - coverage 按日摘要来自 DataCoverage（导入提交后生成，P0 初始为空）。
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { AccessError, type AuthContext } from "@/services/access";
import { writeAudit } from "@/services/audit";

export const MAPPING_VERSION = "mapping-v1";

/** 六类标准文件（与 ROLE_IMPORT_KINDS 一致；TASK-006 黄金样本同清单） */
export const SUPPORTED_ENTITIES = [
  "products",
  "orders",
  "order_items",
  "ads",
  "customer_messages",
  "after_sales",
] as const;

export interface DataSourcesContext {
  db: PrismaClient;
  orgId: string;
  userId: string;
  role: AuthContext["role"];
}

export interface CreateDataSourceInput {
  storeId: string;
  name: string;
  adapterKind: "csv" | "mock";
  sourceNamespace: string;
}

export async function createDataSource(
  ctx: DataSourcesContext,
  input: CreateDataSourceInput,
): Promise<{ id: string }> {
  return ctx.db.$transaction(async (tx) => {
    const store = await tx.store.findFirst({
      where: { orgId: ctx.orgId, id: input.storeId },
      select: { id: true, status: true, demoMode: true },
    });
    if (!store) {
      throw new AccessError(404, "NOT_FOUND", "店铺不存在");
    }
    if (store.status === "archived") {
      throw new AccessError(409, "STORE_ARCHIVED", "归档店铺不接受新的数据源与导入");
    }
    if (input.adapterKind === "mock" && !store.demoMode) {
      throw new AccessError(409, "MOCK_SOURCE_DEMO_ONLY", "mock 数据源只能绑定演示店铺");
    }
    const dup = await tx.dataSource.findFirst({
      where: {
        orgId: ctx.orgId,
        storeId: input.storeId,
        sourceNamespace: input.sourceNamespace,
      },
      select: { id: true },
    });
    if (dup) {
      throw new AccessError(409, "SOURCE_NAMESPACE_EXISTS", "同一店铺下来源命名空间已存在");
    }
    const created = await tx.dataSource.create({
      data: {
        orgId: ctx.orgId,
        storeId: input.storeId,
        sourceNamespace: input.sourceNamespace,
        name: input.name,
        adapterKind: input.adapterKind,
        configuration: { mapping_version: MAPPING_VERSION },
      },
    });
    await writeAudit(tx, {
      orgId: ctx.orgId,
      storeId: input.storeId,
      actorUserId: ctx.userId,
      action: "data_source_create",
      entityType: "data_source",
      entityId: created.id,
      afterSummary: {
        name: input.name,
        adapter_kind: input.adapterKind,
        source_namespace: input.sourceNamespace,
      },
    });
    return { id: created.id };
  });
}

export interface ListDataSourcesOpts {
  storeId: string;
  from?: string;
  to?: string;
}

/** 按日 coverage 摘要（P0：导入提交前为空数组；from/to 为 ISO 日期边界） */
export async function listDataSources(
  ctx: DataSourcesContext,
  opts: ListDataSourcesOpts,
): Promise<{ store: { id: string; name: string; status: string }; items: Record<string, unknown>[] }> {
  const store = await ctx.db.store.findFirst({
    where: { orgId: ctx.orgId, id: opts.storeId },
    select: { id: true, name: true, status: true },
  });
  if (!store) {
    throw new AccessError(404, "NOT_FOUND", "店铺不存在");
  }

  const sources = await ctx.db.dataSource.findMany({
    where: { orgId: ctx.orgId, storeId: opts.storeId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      adapterKind: true,
      sourceNamespace: true,
      status: true,
      configuration: true,
    },
  });

  const coverageWhere = {
    orgId: ctx.orgId,
    storeId: opts.storeId,
    ...(opts.from || opts.to
      ? {
          coverageDate: {
            ...(opts.from ? { gte: new Date(opts.from) } : {}),
            ...(opts.to ? { lte: new Date(opts.to) } : {}),
          },
        }
      : {}),
  };
  const coverageRows = await ctx.db.dataCoverage.groupBy({
    by: ["dataSourceId", "coverageDate"],
    where: coverageWhere,
    _sum: { recordCount: true },
    _count: { sourceKind: true },
  });
  const lastImports = await ctx.db.importTask.groupBy({
    by: ["dataSourceId"],
    where: { orgId: ctx.orgId, storeId: opts.storeId },
    _max: { createdAt: true },
  });
  const lastImportBySource = new Map(
    lastImports.map((r) => [r.dataSourceId, r._max.createdAt?.toISOString() ?? null]),
  );

  // 角色裁剪：客服仅消息源实体（02_USER_ROLES：C 只见脱敏客服数据）
  const supported =
    ctx.role === "customer_service" ? ["customer_messages"] : [...SUPPORTED_ENTITIES];

  const items = sources.map((s) => {
    const coverage = coverageRows
      .filter((c) => c.dataSourceId === s.id)
      .map((c) => ({
        date: c.coverageDate.toISOString().slice(0, 10),
        source_kinds: c._count.sourceKind,
        record_count: Number(c._sum.recordCount ?? 0n),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      id: s.id,
      name: s.name,
      adapter_kind: s.adapterKind,
      source_namespace: s.sourceNamespace,
      status: s.status,
      mapping_version:
        (s.configuration as Record<string, unknown>)?.mapping_version ?? MAPPING_VERSION,
      supported_entities: supported,
      coverage,
      last_import_at: lastImportBySource.get(s.id) ?? null,
    };
  });

  return { store: { id: store.id, name: store.name, status: store.status }, items };
}
