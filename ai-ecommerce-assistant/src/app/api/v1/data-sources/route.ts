/**
 * /api/v1/data-sources（08 §17：TASK-005）
 * GET：store_id 必填；O/A/P 全量实体清单，C 裁剪为仅 customer_messages；
 *      返回 mapping_version、按日 coverage 摘要与 last_import_at。
 * POST：O/A 创建 csv/mock 数据源；mock 只能绑定演示店铺（409）；归档店铺拒绝（409）。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { createDataSource, listDataSources } from "@/services/dataSources";

const createSchema = z
  .object({
    store_id: z.string().min(1),
    name: z.string().min(1).max(100),
    adapter_kind: z.enum(["csv", "mock"]),
    source_namespace: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "source_namespace 仅限小写字母/数字/-/_"),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const storeId = url.searchParams.get("store_id");
    if (!storeId) {
      return fail(422, "缺少 store_id");
    }
    // 全员可见（O/A/P 全量实体，C 仅消息源——服务层按角色裁剪）
    const ctx = await requirePermission(req, {
      capability: CAPABILITIES.viewCustomerServiceData,
      storeId,
    });
    const result = await listDataSources(
      {
        db: getPrismaClient(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
      },
      {
        storeId,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      },
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
      return fail(422, "数据源字段不合法", { fieldErrors });
    }

    const created = await createDataSource(
      {
        db: getPrismaClient(),
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: ctx.role,
      },
      {
        storeId: parsed.data.store_id,
        name: parsed.data.name,
        adapterKind: parsed.data.adapter_kind,
        sourceNamespace: parsed.data.source_namespace,
      },
    );
    return ok({ id: created.id }, { status: 201 });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
