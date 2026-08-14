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

test("SHELL-01 keeps the observed application chrome stable", async ({ page }, testInfo) => {
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
