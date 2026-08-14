import { expect, test } from "@playwright/test";

test("LPBot renders without browser runtime failures", async ({ page }) => {
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [1, 56],
            avatarUrl: null,
            displayName: "Smoke User",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000009",
          },
        },
        requestId: "req-smoke",
      },
      status: 200,
    }),
  );
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("LP Bot");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
  expect(pageErrors, "uncaught page errors").toEqual([]);
  expect(requestFailures, "failed browser requests").toEqual([]);
  expect(consoleErrors, "severe browser console errors").toEqual([]);
});
