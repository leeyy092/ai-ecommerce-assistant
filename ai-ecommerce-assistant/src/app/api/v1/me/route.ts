/**
 * GET /api/v1/me（08 §17.2；Gate-01 H01 修复版）。
 * 活跃组织、角色与可见模块全部取自 getSessionContext 的统一解析结果
 * （Cookie 只能在有效成员关系内选择，不能自授权限）。
 */
import { getSessionContext, type MembershipInfo } from "@/lib/session";
import { ok, unauthorized } from "@/lib/http";

function allowedModules(role: MembershipInfo["role"]): string[] {
  switch (role) {
    case "owner":
    case "admin":
      return [
        "dashboard",
        "data.metrics",
        "data.reports",
        "products",
        "customer_service",
        "alerts",
        "ai_insights",
        "import",
        "settings",
      ];
    case "operator":
      return [
        "dashboard",
        "data.metrics",
        "data.reports",
        "products",
        "customer_service",
        "alerts",
        "ai_insights",
        "import",
      ];
    case "customer_service":
      return ["customer_service", "ai_insights", "import.customer_messages", "alerts.customer_service"];
  }
}

export async function GET(request: Request) {
  const ctx = await getSessionContext(request);
  if (!ctx) return unauthorized();

  const membership = ctx.memberships.find((m) => m.orgId === ctx.activeOrgId);

  return ok({
    user: { id: ctx.user.id, name: ctx.user.displayName, email: ctx.user.email },
    memberships: ctx.memberships.map((m) => ({
      organization_id: m.orgId,
      organization_name: m.orgName,
      role: m.role,
    })),
    active_org: ctx.activeOrgId,
    role: membership?.role ?? null,
    allowed_modules: membership ? allowedModules(membership.role) : [],
  });
}
