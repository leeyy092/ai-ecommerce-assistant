/**
 * PUT /api/v1/me/active-organization（08 §17.2）：切换活跃组织（仅显示上下文，不授权）。
 * 校验当前用户确为该组织成员；写入 HttpOnly Cookie；切换即清空客户端旧域缓存语义。
 */
import { cookies } from "next/headers";
import { getSessionContext } from "@/lib/session";
import { fail, ok, unauthorized } from "@/lib/http";

const ACTIVE_ORG_COOKIE = "aiea_active_org";

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

  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, membership.orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return ok({ active_org: membership.orgId, role: membership.role });
}
