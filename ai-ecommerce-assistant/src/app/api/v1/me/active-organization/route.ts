/**
 * PUT /api/v1/me/active-organization（08 §17.2；Gate-01 H01 修复版）。
 * 切换活跃组织（仅显示/授权上下文选择，不授权）。校验成员关系后写 HttpOnly
 * Cookie（直接写响应头，不依赖请求作用域 API，便于路由处理器直调测试）。
 */
import { getSessionContext, ACTIVE_ORG_COOKIE } from "@/lib/session";
import { fail, ok, unauthorized } from "@/lib/http";

export async function PUT(request: Request) {
  const ctx = await getSessionContext(request);
  if (!ctx) return unauthorized();

  let body: { organization_id?: string };
  try {
    body = (await request.json()) as { organization_id?: string };
  } catch {
    return fail(422, "请求体不是合法 JSON");
  }
  if (!body.organization_id) {
    return fail(422, "缺少 organization_id", { fieldErrors: { organization_id: "必填" } });
  }

  const membership = ctx.memberships.find((m) => m.orgId === body.organization_id);
  if (!membership) return fail(404, "不是该组织的成员");

  const response = ok({ active_org: membership.orgId, role: membership.role });
  response.headers.append(
    "set-cookie",
    `${ACTIVE_ORG_COOKIE}=${membership.orgId}; Path=/; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}
