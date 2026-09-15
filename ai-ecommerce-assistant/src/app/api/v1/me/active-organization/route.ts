/**
 * PUT /api/v1/me/active-organization（08 §17.2；Gate-01 H01 修复版）。
 * 切换活跃组织（仅显示/授权上下文选择，不授权）。校验成员关系后写 HttpOnly
 * Cookie（直接写响应头，不依赖请求作用域 API，便于路由处理器直调测试）。
 */
import { getSessionContext, ACTIVE_ORG_COOKIE } from "@/lib/session";
import { z } from "zod";

const ActiveOrgSchema = z
  .object({ organization_id: z.string().uuid() })
  .strict();
import { fail, ok, unauthorized, guardWrite, internalFailure } from "@/lib/http";

export async function PUT(request: Request) {
  try {
    const blocked = guardWrite(request);
    if (blocked) return blocked;
    const ctx = await getSessionContext(request);
    if (!ctx) return unauthorized();

    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return fail(422, "请求体不是合法 JSON");
    }
    const body = ActiveOrgSchema.parse(parsed);

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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(422, "请求字段类型或取值不合法", {
        code: "VALIDATION_ERROR",
        fieldErrors: Object.fromEntries(error.issues.map((i) => [i.path.join("."), i.message])),
      });
    }
    return internalFailure(error);
  }
}
