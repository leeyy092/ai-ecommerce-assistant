/**
 * /api/v1/stores/{id}（08 §17：TASK-005）
 * PATCH：O/A 修改 name/status(active/archived)/required_channels，以及未锁定时的
 *        currency/timezone；expected_version 乐观锁。首笔业务事实后币种/时区变更
 *        返回 409 STORE_CONFIG_LOCKED。
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { updateStore, isValidTimezone } from "@/services/stores";

const patchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    status: z.enum(["active", "archived"]).optional(),
    required_channels: z.array(z.string().min(1).max(64)).max(32).optional(),
    currency: z.string().length(3).optional(),
    timezone: z
      .string()
      .max(64)
      .refine((tz) => isValidTimezone(tz), "timezone 必须为合法 IANA 时区")
      .optional(),
    expected_version: z.number().int().positive(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
    const parsed = patchSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path.map(String).join(".") || "_"] = issue.message;
      }
      return fail(422, "店铺更新字段不合法", { fieldErrors });
    }
    const body = parsed.data;
    if (!body.name && !body.status && !body.required_channels && !body.currency && !body.timezone) {
      return fail(422, "至少提供一个待更新字段");
    }

    const { id } = await params;
    const updated = await updateStore(
      { db: getPrismaClient(), orgId: ctx.orgId, userId: ctx.userId },
      id,
      {
        name: body.name,
        status: body.status,
        requiredChannels: body.required_channels,
        currency: body.currency,
        timezone: body.timezone,
        expectedVersion: body.expected_version,
      },
    );
    return ok(updated);
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
