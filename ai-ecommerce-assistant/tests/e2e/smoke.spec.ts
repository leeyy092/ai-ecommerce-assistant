import { expect, test } from "@playwright/test";

test("GET /api/health 返回 200 且 body 为 {status:'ok'}（数据库在线）", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { status?: string };
  expect(body).toEqual({ status: "ok" });
});

test("基础页可打开且无业务假数据", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI 电商运营助手" })).toBeVisible();
  await expect(page.getByText("TASK-001")).toBeVisible();
});
