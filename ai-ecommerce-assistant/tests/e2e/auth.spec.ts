import { expect, test } from "@playwright/test";

const EMAIL = "owner-e2e@aiea.local";
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "e2e-owner-pass-123";

test("登录页可打开且不暴露内部信息", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AI 电商运营助手" })).toBeVisible();
  await expect(page.getByText("不提供公开注册")).toBeVisible();
});

test("错误密码显示明确错误且不进入系统", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(EMAIL);
  await page.getByLabel("密码").fill("wrong-password-xxx");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("正确密码登录成功并携带会话访问 /api/v1/me", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(EMAIL);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/");

  // 用页面内 fetch 携带浏览器 Cookie（与真实用户行为一致）验证会话
  const payload = await page.evaluate(async () => {
    const response = await fetch("/api/v1/me");
    const body = (await response.json().catch(() => null)) as {
      data?: { user?: { email?: string }; role?: string };
    } | null;
    return { status: response.status, email: body?.data?.user?.email, role: body?.data?.role };
  });
  expect(payload.status).toBe(200);
  expect(payload.email).toBe(EMAIL);
  expect(payload.role).toBe("owner");
});

test("未登录访问 /api/v1/me 返回 401", async ({ request }) => {
  const response = await request.get("/api/v1/me");
  expect(response.status()).toBe(401);
});

test("Gate-01 H05｜邀请全流程：Owner 创建 → 新浏览器接受 → 真实会话", async ({ page, browser }) => {
  const EMAIL = "owner-e2e@aiea.local";
  const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "e2e-owner-pass-123";
  const inviteEmail = `invite-${Date.now()}@aiea.local`;
  const invitePassword = "invite-pass-12345";

  // Owner 登录并创建邀请（页面内 fetch 携带会话）
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(EMAIL);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/");

  const inviteUrl = await page.evaluate(async (email) => {
    const response = await fetch("/api/v1/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role: "operator" }),
    });
    const body = (await response.json()) as { data?: { url?: string } };
    return body.data?.url ?? "";
  }, inviteEmail);
  expect(inviteUrl).toMatch(/\/invite\/[0-9a-f]{64}$/);

  // 全新浏览器上下文（未登录）打开一次性邀请链接并接受
  const ctx = await browser.newContext();
  const invitePage = await ctx.newPage();
  await invitePage.goto(inviteUrl);
  await expect(invitePage.getByText(/以「运营」身份加入/)).toBeVisible();
  await invitePage.getByLabel("姓名").fill("受邀成员");
  await invitePage.getByLabel(/设置密码/).fill(invitePassword);
  await invitePage.getByRole("button", { name: "创建账号并加入" }).click();
  await invitePage.waitForURL("/", { timeout: 15_000 });

  // 框架下发的登录态可访问受保护接口
  const payload = await invitePage.evaluate(async () => {
    const response = await fetch("/api/v1/me");
    return { status: response.status, body: (await response.json()) as { data?: { role?: string; user?: { email?: string } } } };
  });
  expect(payload.status).toBe(200);
  expect(payload.body.data?.role).toBe("operator");
  await ctx.close();
});

test("Gate-01 H04｜公开注册 URL 在浏览器路径下同样拒绝", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { email: `pub-${Date.now()}@aiea.local`, password: "hijack-pass-123", name: "x" },
  });
  expect(response.status()).toBe(403);
});
