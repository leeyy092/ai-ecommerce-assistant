/**
 * GET /api/v1/me（08 §17.2）：当前用户、成员关系、活跃组织、角色与可见模块。
 * CustomerService 登录默认入口为客服中心（由 allowed_modules 表达）。
 */
import { getSessionContext, type MembershipInfo } from "@/lib/session";
import { ok, unauthorized } from "@/lib/http";
import { cookies } from "next/headers";

const ACTIVE_ORG_COOKIE = "aiea_active_org";

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

  const cookieOrg = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const membership = ctx.memberships.find((m) => m.orgId === cookieOrg) ?? ctx.memberships[0];

  return ok({
    user: { id: ctx.user.id, name: ctx.user.displayName, email: ctx.user.email },
    memberships: ctx.memberships.map((m) => ({
      organization_id: m.orgId,
      organization_name: m.orgName,
      role: m.role,
    })),
    active_org: membership?.orgId ?? null,
    role: membership?.role ?? null,
    allowed_modules: membership ? allowedModules(membership.role) : [],
  });
}
