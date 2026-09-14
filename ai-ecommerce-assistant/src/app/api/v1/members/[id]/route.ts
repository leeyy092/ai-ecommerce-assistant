/**
 * PATCH /api/v1/members/{id}（08 §17.2；Gate-01 H02/H03/H07 修复版）
 * 角色调整或禁用。D01 方案 A：禁用仅作用于本组织 Membership.status，
 * 不修改全局 User.status——其他组织的有效成员关系不受影响；撤销旧会话
 * 属登录会话管理（重新登录后其余有效组织可用），与成员资格分层。
 * 权限：Owner 可改非 Owner 成员角色；Admin 仅可 Operator↔CustomerService
 * 或禁用 P/C；H02：同时校验目标旧角色与拟授予新角色，Admin 不能授予 admin/owner。
 * H07：CAS + 会话撤销 + 审计同一事务。
 */
import type { NextRequest } from "next/server";
import { CAPABILITIES, assertMemberManageable, requirePermission, type Role } from "@/services/access";
import { fail, ok, serviceFailure, guardWrite, internalFailure } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { writeAudit } from "@/services/audit";
import { z } from "zod";

const MembersPatchSchema = z
  .object({
    role: z.enum(["admin", "operator", "customer_service"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    expected_version: z.number().int().positive(),
  })
  .strict();

const ASSIGNABLE_ROLES: ReadonlySet<string> = new Set(["admin", "operator", "customer_service"]);

/** H02：拟授予角色校验——Admin 只能在 P↔C 内调整；Owner 可授予 A/P/C（不可授予 owner） */
export function assertRoleAssignment(actorRole: Role, newRole: string): void {
  if (!ASSIGNABLE_ROLES.has(newRole)) {
    throw Object.assign(new Error("角色只能调整为 admin/operator/customer_service"), {
      status: 422,
      code: "VALIDATION_ERROR",
    });
  }
  if (actorRole === "admin" && newRole === "admin") {
    throw Object.assign(new Error("Admin 不能授予 Admin 角色"), {
      status: 403,
      code: "FORBIDDEN",
    });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const blocked = guardWrite(req);
    if (blocked) return blocked;
    const ctx = await requirePermission(req, { capability: CAPABILITIES.viewMembers });

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const body = MembersPatchSchema.parse(parsed);

    const db = getPrismaClient();
    const { id } = await params;
    const target = await db.membership.findFirst({
      where: { id, orgId: ctx.orgId },
      include: { user: true },
    });
    if (!target) return fail(404, "成员不存在");

    assertMemberManageable(ctx.role, target.role);
    if (body.role) assertRoleAssignment(ctx.role, body.role);

    if (body.status && !["active", "disabled"].includes(body.status)) {
      return fail(422, "status 只能为 active/disabled");
    }
    if (target.role === "owner" && (body.status === "disabled" || body.role)) {
      return fail(403, "不能禁用或改角色唯一 Owner");
    }
    if (body.role === target.role && body.status === target.status) {
      return fail(422, "没有任何变更");
    }

    const result = await db.$transaction(async (tx) => {
      const updated = await tx.membership.updateMany({
        where: { id, orgId: ctx.orgId, rowVersion: body.expected_version },
        data: {
          ...(body.role ? { role: body.role as "admin" | "operator" | "customer_service" } : {}),
          ...(body.status ? { status: body.status as "active" | "disabled" } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw Object.assign(new Error("成员状态已被他人修改，请刷新后重试"), {
          status: 409,
          code: "VERSION_CONFLICT",
        });
      }

      // D01 方案 A：仅本组织成员资格生效；禁用时撤销该用户全部登录会话
      // （重新登录后其余有效组织继续可用）。不修改全局 User.status。
      if (body.status === "disabled") {
        await tx.authSession.deleteMany({ where: { userId: target.user.authUserId } });
      }

      await writeAudit(tx, {
        orgId: ctx.orgId,
        actorUserId: ctx.userId,
        action: "member_update",
        entityType: "membership",
        entityId: id,
        beforeSummary: { role: target.role, status: target.status },
        afterSummary: { role: body.role ?? target.role, status: body.status ?? target.status },
      });
      return { role: body.role ?? target.role, status: body.status ?? target.status };
    });

    return ok({ id, ...result });
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
