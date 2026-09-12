/**
 * PATCH /api/v1/members/{id}（08 §17.2）
 * 角色调整或禁用；禁用即时撤销该成员全部会话。权限矩阵：
 * Owner 可改非 Owner 成员角色；Admin 仅可 Operator↔CustomerService 或禁用 P/C，不能动 O/A；
 * 最后一个 Owner 保护（数据库单 Owner 部分唯一 + 服务端拒绝禁用 Owner）。
 */
import type { NextRequest } from "next/server";
import { getSessionContext } from "@/lib/session";
import { fail, ok, unauthorized } from "@/lib/http";
import { getPrismaClient } from "@/database/prisma";
import { writeAudit } from "@/services/audit";

const MANAGEABLE_BY_ADMIN = new Set(["operator", "customer_service"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getSessionContext(req);
  if (!ctx) return unauthorized();
  const actor = ctx.memberships[0];
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    return fail(403, "只有 Owner/Admin 可以管理成员");
  }

  let body: { role?: string; status?: string; expected_version?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(422, "请求体不是合法 JSON");
  }
  const expectedVersion = Number(body.expected_version);
  if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
    return fail(422, "缺少合法的 expected_version");
  }

  const db = getPrismaClient();
  const { id } = await params;
  const target = await db.membership.findFirst({
    where: { id, orgId: actor.orgId },
    include: { user: true },
  });
  if (!target) return fail(404, "成员不存在");

  if (actor.role === "admin" && !MANAGEABLE_BY_ADMIN.has(target.role)) {
    return fail(403, "Admin 不能操作 Owner/Admin 成员");
  }

  // 目标角色合法性
  if (
    body.role &&
    !["admin", "operator", "customer_service"].includes(body.role)
  ) {
    return fail(422, "角色只能调整为 admin/operator/customer_service");
  }
  if (body.status && !["active", "disabled"].includes(body.status)) {
    return fail(422, "status 只能为 active/disabled");
  }
  if (target.role === "owner" && (body.status === "disabled" || body.role)) {
    return fail(403, "不能禁用或改角色唯一 Owner（403 最后Owner）");
  }
  if (body.role === target.role && body.status === target.status) {
    return fail(422, "没有任何变更");
  }

  const updated = await db.membership.updateMany({
    where: { id, orgId: actor.orgId, rowVersion: expectedVersion },
    data: {
      ...(body.role ? { role: body.role as "admin" | "operator" | "customer_service" } : {}),
      ...(body.status ? { status: body.status as "active" | "disabled" } : {}),
      rowVersion: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    return fail(409, "成员状态已被他人修改，请刷新后重试");
  }

  // 禁用：即时撤销全部会话（Auth session + 领域状态）
  if (body.status === "disabled") {
    await db.authSession.deleteMany({ where: { userId: target.user.authUserId } });
    await db.user.update({ where: { id: target.userId }, data: { status: "disabled" } });
  }
  if (body.status === "active") {
    await db.user.update({ where: { id: target.userId }, data: { status: "active" } });
  }

  await writeAudit(db, {
    orgId: actor.orgId,
    actorUserId: ctx.user.id,
    action: "member_update",
    entityType: "membership",
    entityId: id,
    beforeSummary: { role: target.role, status: target.status },
    afterSummary: { role: body.role ?? target.role, status: body.status ?? target.status },
  });

  return ok({ id, role: body.role ?? target.role, status: body.status ?? target.status });
}
