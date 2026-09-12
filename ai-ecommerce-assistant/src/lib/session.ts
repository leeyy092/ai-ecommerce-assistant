/**
 * 会话上下文（TASK-003）。
 * 从请求 Cookie 解析 Better Auth session → 领域 User + 全部 Membership。
 * 禁用用户即时失权：session 仍有效但领域 status=disabled 时视为未登录。
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { getPrismaClient } from "@/database/prisma";

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

export async function getSessionContext(
  request: Request,
  db: PrismaClient = getPrismaClient(),
): Promise<SessionContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
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

  return {
    authUserId: session.user.id,
    user: { id: domainUser.id, email: domainUser.email, displayName: domainUser.displayName },
    memberships,
    activeOrgId: memberships[0]?.orgId ?? null,
  };
}
