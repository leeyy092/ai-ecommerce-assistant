/**
 * POST /api/v1/sku-aliases（TASK-009/F17 最小实现；08 §17.3）
 * 未知 SKU 的显式映射落库：只影响后续校验（重验属对应导入任务重试）。
 * 通用别名工作台/恢复 UI 仍属 TASK-026（不提前实现）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { AccessError, CAPABILITIES, requirePermission } from "@/services/access";
import { writeAudit } from "@/services/audit";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    store_id: z.string().min(1),
    source_namespace: z.string().min(1),
    external_sku_id: z.string().min(1),
    canonical_sku_id: z.string().min(1),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewCustomerServiceData });
    const db = getPrismaClient();
    const parsedBody = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return fail(422, "store_id/source_namespace/external_sku_id/canonical_sku_id 必填", {
        code: "VALIDATION_ERROR",
      });
    }
    const { store_id, source_namespace, external_sku_id, canonical_sku_id } = parsedBody.data;
    const store = await db.store.findFirst({ where: { orgId: ctx.orgId, id: store_id } });
    if (!store) return fail(404, "店铺不存在", { code: "NOT_FOUND" });

    const canonical = await db.sKU.findFirst({
      where: { orgId: ctx.orgId, storeId: store_id, sourceNamespace: source_namespace, id: canonical_sku_id },
      select: { id: true },
    });
    if (!canonical) {
      // 别名必须指向同店同来源的真实 SKU；跨店/跨来源一律 404（别名跨店被拒）
      return fail(404, "canonical_sku_id 不存在于该店铺/来源", { code: "NOT_FOUND" });
    }
    const collision = await db.sKU.findFirst({
      where: { orgId: ctx.orgId, storeId: store_id, sourceNamespace: source_namespace, externalSkuId: external_sku_id },
      select: { id: true },
    });
    if (collision) {
      return fail(409, "该 external_sku_id 已是真实 SKU，不能重复映射", { code: "ALREADY_MAPPED" });
    }
    try {
      const alias = await db.skuAlias.create({
        data: {
          orgId: ctx.orgId,
          storeId: store_id,
          sourceNamespace: source_namespace,
          externalSkuId: external_sku_id,
          skuId: canonical_sku_id,
          createdBy: ctx.userId,
        },
      });
      await writeAudit(db, {
        orgId: ctx.orgId,
        storeId: store_id,
        actorUserId: ctx.userId,
        action: "sku_alias_create",
        entityType: "sku_alias",
        entityId: alias.id,
        afterSummary: { external_sku_id: external_sku_id, canonical_sku_id },
      });
      return ok({ id: alias.id, external_sku_id, canonical_sku_id }, { status: 201 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002") {
        return fail(409, "该 external_sku_id 已映射", { code: "ALREADY_MAPPED" });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AccessError) throw error;
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
