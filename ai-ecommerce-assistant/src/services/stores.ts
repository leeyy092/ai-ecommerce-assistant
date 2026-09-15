/**
 * 店铺与数据源配置（TASK-005；08 §stores/data-sources）。
 * 目标：导入前固定数据所属店铺、时区、币种和来源命名空间。
 * 关键不变量：
 * - 平台只是标签，系统不存在任何平台 API 连接（不返回 connected 类状态）；
 * - demo_mode 继承组织，创建者不可自行切换；
 * - 首笔事实（任一业务事实行）后币种/时区锁定（409 STORE_CONFIG_LOCKED）；
 * - 归档店铺拒绝新建数据源（后续导入同样拒绝）；
 * - mock 数据源只能绑定演示店铺。
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { AccessError, type AuthContext } from "@/services/access";
import { writeAudit } from "@/services/audit";

export const STORE_PLATFORMS = [
  "manual",
  "amazon",
  "shopify",
  "shopee",
  "tiktok",
  "other",
] as const;

export interface StoresContext {
  db: PrismaClient;
  orgId: string;
  userId: string;
}

/** 合法 IANA 时区（数据库存原文，写入前校验可被 Intl 解析） */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 首笔事实判定：任一业务事实表存在该店铺的行即视为已有事实（币种/时区锁定） */
export async function storeHasFacts(
  db: Prisma.TransactionClient | PrismaClient,
  storeId: string,
): Promise<boolean> {
  const [order, product, message, adMetric, afterSale, refund] = await Promise.all([
    db.order.findFirst({ where: { storeId }, select: { id: true } }),
    db.product.findFirst({ where: { storeId }, select: { id: true } }),
    db.customerMessage.findFirst({ where: { storeId }, select: { id: true } }),
    db.adMetric.findFirst({ where: { storeId }, select: { id: true } }),
    db.afterSaleRecord.findFirst({ where: { storeId }, select: { id: true } }),
    db.refundEvent.findFirst({ where: { storeId }, select: { id: true } }),
  ]);
  return Boolean(order ?? product ?? message ?? adMetric ?? afterSale ?? refund);
}

export interface CreateStoreInput {
  name: string;
  externalStoreId: string;
  platform: (typeof STORE_PLATFORMS)[number];
  currency: string;
  timezone: string;
}

export async function createStore(
  ctx: StoresContext,
  input: CreateStoreInput,
): Promise<{ id: string }> {
  const currency = input.currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AccessError(422, "VALIDATION_ERROR", "currency 必须为 3 位字母（ISO 4217）");
  }
  if (!isValidTimezone(input.timezone)) {
    throw new AccessError(422, "VALIDATION_ERROR", "timezone 必须为合法 IANA 时区");
  }
  return ctx.db.$transaction(async (tx) => {
    const sameName = await tx.store.findFirst({
      where: { orgId: ctx.orgId, name: input.name },
      select: { id: true },
    });
    if (sameName) {
      throw new AccessError(409, "STORE_NAME_EXISTS", "同名店铺已存在");
    }
    const sameExternal = await tx.store.findFirst({
      where: { orgId: ctx.orgId, externalStoreId: input.externalStoreId },
      select: { id: true },
    });
    if (sameExternal) {
      throw new AccessError(409, "STORE_EXISTS", "相同外部店铺标识已存在");
    }
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: ctx.orgId },
      select: { demoMode: true },
    });
    const created = await tx.store.create({
      data: {
        orgId: ctx.orgId,
        name: input.name,
        externalStoreId: input.externalStoreId,
        platform: input.platform,
        currency,
        timezone: input.timezone,
        demoMode: org.demoMode,
      },
    });
    await writeAudit(tx, {
      orgId: ctx.orgId,
      storeId: created.id,
      actorUserId: ctx.userId,
      action: "store_create",
      entityType: "store",
      entityId: created.id,
      afterSummary: {
        name: input.name,
        platform: input.platform,
        currency,
        timezone: input.timezone,
      },
    });
    return { id: created.id };
  });
}

/** 店铺列表投影：无任何经营数值字段（平台只是标签，无连接状态） */
export async function listStores(
  ctx: StoresContext,
  opts: { cursor?: string; limit?: number },
): Promise<{ items: Record<string, unknown>[]; next_cursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = await ctx.db.store.findMany({
    where: { orgId: ctx.orgId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    take: limit + 1,
    select: {
      id: true,
      name: true,
      platform: true,
      currency: true,
      timezone: true,
      status: true,
      demoMode: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map((s) => ({
      id: s.id,
      name: s.name,
      platform: s.platform,
      currency: s.currency,
      timezone: s.timezone,
      status: s.status,
      demo_mode: s.demoMode,
      created_at: s.createdAt.toISOString(),
    })),
    next_cursor: hasMore ? page[page.length - 1].id : null,
  };
}

export interface UpdateStoreInput {
  name?: string;
  status?: "active" | "archived";
  requiredChannels?: string[];
  currency?: string;
  timezone?: string;
  expectedVersion: number;
}

export async function updateStore(
  ctx: StoresContext,
  storeId: string,
  input: UpdateStoreInput,
): Promise<Record<string, unknown>> {
  return ctx.db.$transaction(async (tx) => {
    const store = await tx.store.findFirst({
      where: { orgId: ctx.orgId, id: storeId },
    });
    if (!store) {
      throw new AccessError(404, "NOT_FOUND", "店铺不存在");
    }
    if (store.rowVersion !== input.expectedVersion) {
      throw new AccessError(409, "VERSION_CONFLICT", "配置版本已变化，请刷新后重试");
    }

    const touchesLocked = input.currency !== undefined || input.timezone !== undefined;
    if (touchesLocked && (await storeHasFacts(tx, storeId))) {
      throw new AccessError(
        409,
        "STORE_CONFIG_LOCKED",
        "已存在业务事实，币种与时区不可变更",
      );
    }
    if (input.currency !== undefined && !/^[A-Za-z]{3}$/.test(input.currency)) {
      throw new AccessError(422, "VALIDATION_ERROR", "currency 必须为 3 位字母（ISO 4217）");
    }
    if (input.timezone !== undefined && !isValidTimezone(input.timezone)) {
      throw new AccessError(422, "VALIDATION_ERROR", "timezone 必须为合法 IANA 时区");
    }

    const nextSettings =
      input.requiredChannels !== undefined
        ? { ...((store.settings as Record<string, unknown>) ?? {}), required_channels: input.requiredChannels }
        : (store.settings as Record<string, unknown>);
    void (nextSettings as Prisma.InputJsonValue);

    await tx.store.update({
      where: { id: store.id },
      data: {
        name: input.name ?? store.name,
        status: input.status ?? store.status,
        currency: input.currency?.toUpperCase() ?? store.currency,
        timezone: input.timezone ?? store.timezone,
        settings: nextSettings as Prisma.InputJsonValue,
        rowVersion: { increment: 1 },
      },
    });

    await writeAudit(tx, {
      orgId: ctx.orgId,
      storeId: store.id,
      actorUserId: ctx.userId,
      action: "store_update",
      entityType: "store",
      entityId: store.id,
      beforeSummary: {
        name: store.name,
        status: store.status,
        currency: store.currency,
        timezone: store.timezone,
      },
      afterSummary: {
        name: input.name ?? store.name,
        status: input.status ?? store.status,
        currency: input.currency?.toUpperCase() ?? store.currency,
        timezone: input.timezone ?? store.timezone,
      },
    });

    const updated = await tx.store.findUniqueOrThrow({
      where: { id: store.id },
      select: {
        id: true,
        name: true,
        status: true,
        currency: true,
        timezone: true,
        settings: true,
        rowVersion: true,
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      currency: updated.currency,
      timezone: updated.timezone,
      required_channels:
        (updated.settings as Record<string, unknown>)?.required_channels ?? null,
      row_version: updated.rowVersion,
    };
  });
}

export type { AuthContext };
