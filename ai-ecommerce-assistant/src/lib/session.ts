/**
 * 会话上下文（TASK-003；Gate-01 H01 修复版）。
 * 从请求 Cookie 解析 Better Auth session → 领域 User + 全部 Membership。
 * 活跃组织唯一解析点：读取 aiea_active_org Cookie，仅当其命中当前有效
 * Membership 时作为 activeOrgId，否则回退首个有效成员关系——Cookie 只能
 * 在已验证的成员关系内选择显示/授权上下文，不能自授权限。
 * /me、requirePermission 与全部业务 API 共用本函数结果。
 * 禁用即时失权：全局 User.status=disabled（平台运维级）或全部成员关系失效时视为未登录。
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { getAuth } from "@/lib/auth";
import { getPrismaClient } from "@/database/prisma";

export const ACTIVE_ORG_COOKIE = "aiea_active_org";

export interface MembershipInfo {
  orgId: string;
  orgName: string;
  role: "owner" | "admin" | "operator" | "customer_service";
  status: "active" | "disabled";
}

export interface SessionContext {
  authUserId: string;
  user: { id: string; email: string; displayName: string };
  memberships: MembershipInfo[];
  activeOrgId: string | null;
}

/** 从请求头解析活跃组织 Cookie 值（无则 null） */
export function readActiveOrgCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ACTIVE_ORG_COOKIE) {
      const value = rest.join("=");
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export async function getSessionContext(
  request: Request,
  db: PrismaClient = getPrismaClient(),
): Promise<SessionContext | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  const domainUser = await db.user.findUnique({
    where: { authUserId: session.user.id },
    include: {
      memberships: {
        where: { status: "active" },
        include: { organization: { select: { id: true, name: true } } },
      },
    },
  });
  if (!domainUser || domainUser.status === "disabled") return null;

  const memberships: MembershipInfo[] = domainUser.memberships.map((m) => ({
    orgId: m.orgId,
    orgName: m.organization.name,
    role: m.role,
    status: m.status,
  }));

  // H01：唯一活跃组织解析——Cookie 必须命中有效成员关系，否则回退首个
  const cookieOrg = readActiveOrgCookie(request);
  const activeOrgId = memberships.some((m) => m.orgId === cookieOrg)
    ? (cookieOrg as string)
    : (memberships[0]?.orgId ?? null);

  return {
    authUserId: session.user.id,
    user: { id: domainUser.id, email: domainUser.email, displayName: domainUser.displayName },
    memberships,
    activeOrgId,
  };
}
