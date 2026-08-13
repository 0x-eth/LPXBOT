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

  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("LPBot");
  await expect(page.getByRole("heading", { level: 1, name: "LPBot" })).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
  expect(pageErrors, "uncaught page errors").toEqual([]);
  expect(requestFailures, "failed browser requests").toEqual([]);
  expect(consoleErrors, "severe browser console errors").toEqual([]);
});
