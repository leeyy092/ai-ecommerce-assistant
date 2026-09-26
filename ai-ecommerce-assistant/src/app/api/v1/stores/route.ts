/**
 * /api/v1/stores（08 §17：店铺与数据源配置 TASK-005）
 * GET：全员可见店铺基础信息（id/name/platform/currency/timezone/status；无经营数值，
 *      platform 只是标签，不存在任何"已连接"状态字段）。
 * POST：O/A 创建店铺；demo_mode 继承组织；409 同名/同外部标识、422 校验失败。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import {
  createStore,
  listStores,
  STORE_PLATFORMS,
  isValidTimezone,
} from "@/services/stores";

const createSchema = z
  .object({
    name: z.string().min(1).max(100),
    external_store_id: z.string().min(1).max(128),
    platform: z.enum(STORE_PLATFORMS),
    currency: z.string().length(3),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => isValidTimezone(tz), "timezone 必须为合法 IANA 时区"),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    // 全员（C 亦可见基础信息；无经营数值字段）
    const ctx = await requirePermission(req, {
      capability: CAPABILITIES.viewCustomerServiceData,
    });
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    if (limitRaw !== null && (!Number.isInteger(limit) || (limit as number) < 1)) {
      return fail(422, "limit 必须为正整数");
    }
    const result = await listStores(
      { db: getPrismaClient(), orgId: ctx.orgId, userId: ctx.userId },
      { cursor: url.searchParams.get("cursor") ?? undefined, limit },
    );
    return ok(result);
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.manageSettings });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await req.text());
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const parsed = createSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.map(String).join(".") || "_"] = issue.message;
      }
      return fail(422, "店铺配置字段不合法", { fieldErrors });
    }

    const created = await createStore(
      { db: getPrismaClient(), orgId: ctx.orgId, userId: ctx.userId },
      {
        name: parsed.data.name,
        externalStoreId: parsed.data.external_store_id,
        platform: parsed.data.platform,
        currency: parsed.data.currency,
        timezone: parsed.data.timezone,
      },
    );
    return ok({ id: created.id }, { status: 201 });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
