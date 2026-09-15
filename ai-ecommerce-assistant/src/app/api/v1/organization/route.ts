/**
 * /api/v1/organization（08 §17.2；Gate-01 H01/H07 修复版）
 * GET：全员可见 id/name/demo_mode/配置版本；O/A 另见 AI 限额字段。
 * 活跃组织取自统一解析（H01：与 /me、requirePermission 同源）。
 * PATCH：O/A 改组织名；CAS + 审计同一事务（H07）；仅名称修改不触发重算。
 */
import type { NextRequest } from "next/server";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { fail, ok, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { writeAudit } from "@/services/audit";
import { z } from "zod";

const OrgPatchSchema = z
  .object({
    name: z.string().min(1).max(100),
    expected_version: z.number().int().positive(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, {
      capability: CAPABILITIES.viewCustomerServiceData,
    });
    const org = await getPrismaClient().organization.findUniqueOrThrow({
      where: { id: ctx.orgId },
    });

    const base = {
      id: org.id,
      name: org.name,
      demo_mode: org.demoMode,
      row_version: org.rowVersion,
    };
    // O/A 可见预算与配额；P/C 不返回（02 权限矩阵）
    if (ctx.role === "owner" || ctx.role === "admin") {
      return ok({
        ...base,
        ai_daily_budget_cny: org.aiDailyBudget.toString(),
        ai_monthly_budget_cny: org.aiMonthlyBudget.toString(),
        daily_message_limit: org.dailyMessageLimit,
        budget_timezone: org.budgetTimezone,
      });
    }
    return ok(base);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(422, "请求字段类型或取值不合法", {
        code: "VALIDATION_ERROR",
        fieldErrors: Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message])),
      });
    }
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, {
      capability: CAPABILITIES.manageOrgInfo,
    });
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const body = OrgPatchSchema.parse(parsed);
    const name = body.name.trim();
    const expectedVersion = body.expected_version;

    const db = getPrismaClient();
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.organization.updateMany({
        where: { id: ctx.orgId, rowVersion: expectedVersion },
        data: { name, rowVersion: { increment: 1 } },
      });
      if (updated.count !== 1) {
        throw Object.assign(new Error("组织信息已被修改，请刷新后重试"), {
          status: 409,
          code: "VERSION_CONFLICT",
        });
      }
      await writeAudit(tx, {
        orgId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "org_update",
        entityType: "organization",
        entityId: ctx.orgId,
        beforeSummary: undefined,
        afterSummary: { name },
      });
      return { status: "updated" as const };
    });
    return ok(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(422, "请求字段类型或取值不合法", {
        code: "VALIDATION_ERROR",
        fieldErrors: Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message])),
      });
    }
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    return internalFailure(error);
  }
}
