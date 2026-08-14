import { expect, test, type Page } from "@playwright/test";

const userSession = {
  allowedChainIds: [56],
  avatarUrl: null,
  displayName: "Shell Fixture",
  maintenanceBypass: false,
  role: "user",
  tier: "normal",
  userId: "00000000-0000-4000-8000-000000000051",
};

async function useUserSession(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: { isAdmin: false, maintenance: null, user: userSession },
        requestId: "req-shell-e2e",
      },
      status: 200,
    }),
  );
}

test("SHELL-01 keeps the observed application chrome stable", async ({ page }) => {
  await useUserSession(page);
  await page.goto("/tasks/running");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();

  await expect(page).toHaveScreenshot("shell.png", {
    animations: "disabled",
    caret: "hide",
    mask: [page.locator("main"), page.locator("[data-visual-mask='account']")],
    maxDiffPixelRatio: 0.005,
  });
});

test("SHELL-01 opens recent chats as an empty drawer", async ({ page }) => {
  await useUserSession(page);
  await page.goto("/tasks/running");

  await page.getByRole("button", { name: "聊天室" }).click();

  await expect(page.getByRole("dialog", { name: "最近聊天" })).toBeVisible();
  await expect(page.getByText("暂无最近聊天", { exact: true })).toBeVisible();
  await expect(page.locator("[data-chat-message]")).toHaveCount(0);
});

test("SHELL-01 keeps localized route outlets and current navigation stable", async ({ page }) => {
  await useUserSession(page);
  const routes = [
    ["/tasks/running", "任务", "任务"],
    ["/tasks/paused", "任务", "任务"],
    ["/tasks/stopped", "任务", "任务"],
    ["/pools", "池子发现", "池子"],
    ["/strategies", "自动策略", "策略"],
    ["/activity", "操作日志", "日志"],
    ["/wallets", "钱包管理", "钱包"],
    ["/developer", "开发者", null],
    ["/settings", "设置", null],
  ] as const;

  for (const [path, heading, navigation] of routes) {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toContainText(heading);
    if (navigation) {
      await expect(page.getByRole("link", { name: navigation })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  }

  await expect(page.getByRole("link", { name: "管理" })).toHaveCount(0);
});

test("SHELL-05 route errors stay safe and expose a real retry command", async ({ page }) => {
  await useUserSession(page);
  await page.goto("/developer?fixture=route-error");

  await expect(page.getByRole("heading", { level: 1, name: "Page unavailable" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("This page could not be displayed safely.");
  await expect(page.getByText(/INTERNAL_FIXTURE_TOKEN|requestBody/u)).toHaveCount(0);

  await page.getByRole("button", { name: "Retry page" }).click();
  await expect(page).toHaveURL(/\/developer$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Developer" })).toBeVisible();
});
