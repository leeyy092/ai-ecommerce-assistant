/**
 * /api/v1/organization（08 §17.2）
 * GET：全员可看 id/name/demo_mode/配置版本；O/A 另见 AI 限额字段。
 * PATCH：O/A 改组织名（expected_version 乐观锁；仅名称修改不触发任何重算）。
 */
import type { NextRequest } from "next/server";
import { CAPABILITIES, requirePermission } from "@/services/access";
import { fail, ok, serviceFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";

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
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    throw error;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requirePermission(req, {
      capability: CAPABILITIES.manageOrgInfo,
    });
    let body: { name?: string; expected_version?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const expectedVersion = Number(body.expected_version);
    if (!body.name?.trim()) {
      return fail(422, "缺少组织名称", { fieldErrors: { name: "必填" } });
    }
    if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
      return fail(422, "缺少合法的 expected_version");
    }

    const updated = await getPrismaClient().organization.updateMany({
      where: { id: ctx.orgId, rowVersion: expectedVersion },
      data: { name: body.name.trim(), rowVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      return fail(409, "组织信息已被修改，请刷新后重试");
    }
    return ok({ status: "updated" });
  } catch (error) {
    const mapped = serviceFailure(error);
    if (mapped) return mapped;
    throw error;
  }
}
