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
