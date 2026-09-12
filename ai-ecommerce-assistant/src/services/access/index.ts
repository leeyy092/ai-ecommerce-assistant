/**
 * 统一授权入口（TASK-004）：路由、后台任务、文件与 AI 证据共用。
 * requirePermission 从 session 推导组织与角色（请求中的 org_id/store_id 不决定权限），
 * 同域资源检查（requireStoreAccess）保证跨组织/跨店铺引用被拒。
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { getSessionContext } from "@/lib/session";
import { getPrismaClient } from "@/database/prisma";
import {
  ADMIN_MANAGEABLE_ROLES,
  hasCapability,
  INVITABLE_ROLES,
  type Capability,
  type Role,
} from "./permissions";

export * from "./permissions";

export class AccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthContext {
  userId: string;
  authUserId: string;
  email: string;
  orgId: string;
  role: Role;
  storeId?: string;
}

export interface PermissionRequest {
  capability: Capability;
  /** 目标组织（默认当前活跃组织） */
  orgId?: string;
  /** 目标店铺（提供时执行同域检查） */
  storeId?: string;
}

/**
 * 唯一授权入口：session → 活跃/指定组织成员 → 能力校验 → （可选）店铺同域校验。
 * 未登录 401；非该组织成员或能力不足 403；店铺不存在或跨组织 404/403。
 */
export async function requirePermission(
  request: Request,
  req: PermissionRequest,
  db: PrismaClient = getPrismaClient(),
): Promise<AuthContext> {
  const session = await getSessionContext(request, db);
  if (!session) {
    throw new AccessError(401, "UNAUTHENTICATED", "未登录或会话已过期");
  }

  const targetOrgId = req.orgId ?? session.activeOrgId;
  if (!targetOrgId) {
    throw new AccessError(403, "FORBIDDEN", "没有可用组织");
  }
  const membership = session.memberships.find((m) => m.orgId === targetOrgId);
  if (!membership || membership.status !== "active") {
    throw new AccessError(403, "FORBIDDEN", "不是该组织的有效成员");
  }

  if (!hasCapability(membership.role, req.capability)) {
    throw new AccessError(403, "FORBIDDEN", "当前角色没有该操作权限");
  }

  const ctx: AuthContext = {
    userId: session.user.id,
    authUserId: session.authUserId,
    email: session.user.email,
    orgId: targetOrgId,
    role: membership.role,
    ...(req.storeId ? { storeId: req.storeId } : {}),
  };

  if (req.storeId) {
    await requireStoreAccess(db, ctx, req.storeId);
  }
  return ctx;
}

/** 同域资源检查：店铺必须存在且属于当前组织；不可见资源统一 404，不泄露存在性 */
export async function requireStoreAccess(
  db: PrismaClient,
  ctx: Pick<AuthContext, "orgId">,
  storeId: string,
): Promise<{ id: string; orgId: string; currency: string; timezone: string; status: string }> {
  const store = await db.store.findFirst({
    where: { id: storeId, orgId: ctx.orgId },
    select: { id: true, orgId: true, currency: true, timezone: true, status: true },
  });
  if (!store) {
    throw new AccessError(404, "NOT_FOUND", "店铺不存在");
  }
  return store;
}

/** Admin 只能管理 Operator/CustomerService（不可操作 Owner/Admin） */
export function assertMemberManageable(actorRole: Role, targetRole: Role): void {
  if (actorRole === "owner") return; // Owner 可改非 Owner 成员
  if (actorRole === "admin" && ADMIN_MANAGEABLE_ROLES.has(targetRole)) return;
  throw new AccessError(403, "FORBIDDEN", "不能管理该角色的成员");
}

/** 邀请范围校验（O→A/P/C；A→P/C） */
export function assertInvitable(actorRole: Role, inviteRole: Role): void {
  if (!INVITABLE_ROLES[actorRole].has(inviteRole)) {
    throw new AccessError(403, "FORBIDDEN", "当前角色不能邀请该角色");
  }
}
