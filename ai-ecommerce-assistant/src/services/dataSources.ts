/**
 * 数据源配置（TASK-005；08 §data-sources）。
 * - csv/mock 两类适配；同一来源（namespace）支持六类标准文件（TASK-006 统一 Adapter）；
 * - mock 只能绑定演示店铺；归档店铺拒绝新建数据源（TASK-005 验收：归档店拒绝新导入）；
 * - mapping_version 由统一 Adapter 约定（mapping-v1）；
 * - 列表按角色裁剪 supported_entities：客服仅 customer_messages（02_USER_ROLES）；
 * - coverage 按日摘要（G2-H01）：只统计当前角色可见的来源类型，且同一
 *   (来源,类型,渠道,日期) 只取 dataset_version 最高的有效行——历史版本不重复累计；
 *   from/to 为店铺本地日期、右开区间、单次最大 90 天；非法输入 422。
 */
import { Prisma, type PrismaClient, type ImportSourceKind } from "@/generated/prisma/client";
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

/** 严格本地日期（YYYY-MM-DD 且真实日历，拒绝 2026-02-30）；G2-H01 稳定 422 */
function parseIsoDate(value: string, field: "from" | "to"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AccessError(422, "VALIDATION_ERROR", `${field} 必须为 YYYY-MM-DD 本地日期`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new AccessError(422, "VALIDATION_ERROR", `${field} 不是合法日历日期：${value}`);
  }
  return value;
}

const DAY_MS = 86_400_000;
const dateKey = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/**
 * 角色可见的来源类型（02_USER_ROLES：C 仅消息；导入能力即覆盖可见能力）。
 */
function visibleKindsFor(role: AuthContext["role"]): ImportSourceKind[] {
  return role === "customer_service"
    ? ["customer_messages"]
    : ([...SUPPORTED_ENTITIES] as ImportSourceKind[]);
}

/** 按日 coverage 摘要：有效版本行汇总 + 角色类型裁剪 + 右开 90 天窗口（G2-H01） */
export async function listDataSources(
  ctx: DataSourcesContext,
  opts: ListDataSourcesOpts,
): Promise<{ store: { id: string; name: string; status: string }; items: Record<string, unknown>[] }> {
  // 日期参数先校验（非法 → 422，不进入 SQL）
  let from: string | undefined;
  let to: string | undefined;
  if (opts.from !== undefined) from = parseIsoDate(opts.from, "from");
  if (opts.to !== undefined) to = parseIsoDate(opts.to, "to");
  if (from !== undefined && to !== undefined) {
    // 右开区间 [from, to)：from==to 为合法空区间；to<from 才是非法
    if (dateKey(to) < dateKey(from)) {
      throw new AccessError(422, "VALIDATION_ERROR", "to 不得早于 from（右开区间）");
    }
    if ((dateKey(to) - dateKey(from)) / DAY_MS > 90) {
      throw new AccessError(422, "VALIDATION_ERROR", "查询范围一次最多 90 天");
    }
  } else if (from !== undefined) {
    // 只给一侧时按 90 天上限补齐另一侧，保证单次查询不越过 90 天窗口
    to = new Date(dateKey(from) + 90 * DAY_MS).toISOString().slice(0, 10);
  } else if (to !== undefined) {
    from = new Date(dateKey(to) - 90 * DAY_MS).toISOString().slice(0, 10);
  }

  const store = await ctx.db.store.findFirst({
    where: { orgId: ctx.orgId, id: opts.storeId },
    select: { id: true, name: true, status: true },
  });
  if (!store) {
    throw new AccessError(404, "NOT_FOUND", "店铺不存在");
  }

  const kinds = visibleKindsFor(ctx.role);

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

  // G2-H01：同一 (来源,类型,渠道,日期) 先取 dataset_version 最高的有效行，
  // 再在可见类型内按日汇总——历史版本不再与当前版本重复累计。
  const effective = await ctx.db.$queryRaw<
    { data_source_id: string; source_kind: string; coverage_date: Date; record_count: bigint }[]
  >`
    SELECT data_source_id, source_kind, coverage_date, record_count
    FROM (
      SELECT DISTINCT ON (data_source_id, source_kind, channel, coverage_date)
             data_source_id, source_kind, channel, coverage_date, record_count
      FROM "data_coverage"
      WHERE org_id = ${ctx.orgId}
        AND store_id = ${opts.storeId}
        AND source_kind::text IN (${Prisma.join(kinds)})
        ${from !== undefined ? Prisma.sql`AND coverage_date >= ${from}::date` : Prisma.empty}
        ${to !== undefined ? Prisma.sql`AND coverage_date < ${to}::date` : Prisma.empty}
      ORDER BY data_source_id, source_kind, channel, coverage_date, dataset_version DESC
    ) effective`;

  const daily = new Map<string, Map<string, { kinds: Set<string>; count: bigint }>>();
  for (const row of effective) {
    const date = row.coverage_date.toISOString().slice(0, 10);
    const perSource = daily.get(row.data_source_id) ?? new Map();
    const bucket = perSource.get(date) ?? { kinds: new Set<string>(), count: 0n };
    bucket.kinds.add(row.source_kind);
    bucket.count += row.record_count;
    perSource.set(date, bucket);
    daily.set(row.data_source_id, perSource);
  }

  // last_import_at 同样只按当前角色可见的来源类型（G2-H01）
  const lastImports = await ctx.db.importTask.groupBy({
    by: ["dataSourceId"],
    where: { orgId: ctx.orgId, storeId: opts.storeId, sourceKind: { in: kinds } },
    _max: { createdAt: true },
  });
  const lastImportBySource = new Map(
    lastImports.map((r) => [r.dataSourceId, r._max?.createdAt?.toISOString() ?? null]),
  );

  const items = sources.map((s) => {
    const perSource = daily.get(s.id);
    const coverage = perSource
      ? [...perSource.entries()]
          .map(([date, bucket]) => ({
            date,
            source_kinds: bucket.kinds.size,
            record_count: Number(bucket.count),
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
    return {
      id: s.id,
      name: s.name,
      adapter_kind: s.adapterKind,
      source_namespace: s.sourceNamespace,
      status: s.status,
      mapping_version:
        (s.configuration as Record<string, unknown>)?.mapping_version ?? MAPPING_VERSION,
      supported_entities: kinds,
      coverage,
      last_import_at: lastImportBySource.get(s.id) ?? null,
    };
  });

  return { store: { id: store.id, name: store.name, status: store.status }, items };
}
