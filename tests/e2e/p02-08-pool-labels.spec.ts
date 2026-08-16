import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function installFixture(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "P02-08 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000058",
          },
        },
        requestId: "req-p02-08-auth",
        success: true,
      },
    }),
  );
  await page.route("**/api/user/preferences", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          preferences: {
            colorTheme: "neutral",
            customColor: null,
            navConfig: [
              { key: "tasks", visible: true },
              { key: "pools", visible: true },
              { key: "strategies", visible: true },
              { key: "activity", visible: true },
              { key: "wallets", visible: true },
              { key: "chat", visible: true },
            ],
            poolColumns: [
              { key: "pool", visible: true },
              { key: "protocol", visible: true },
              { key: "fees", visible: true },
              { key: "volume", visible: true },
              { key: "feeTvl", visible: true },
              { key: "feeActiveTvl", visible: true },
              { key: "tvl", visible: true },
              { key: "txs", visible: true },
              { key: "fdv", visible: true },
              { key: "actions", visible: true },
            ],
            poolsPanelCollapsed: false,
            showHotPools: false,
            showPoolLabels: true,
            showScanTab: true,
            taskViewMode: "grid",
            theme: "system",
          },
          revision: 0,
          schemaVersion: 5,
          updatedAt: null,
        },
        requestId: "req-p02-08-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { remarks: [], shared: [] }, requestId: "req-p02-08-remarks", success: true },
    }),
  );
}

test("POOL-07 shows first label, +N and every stable reason in an expanded layer", async ({ page }) => {
  await installFixture(page);
  await page.goto("/pools?fixture=pools-ready");

  const firstRow = page.getByRole("table", { name: "BSC 热门池" }).locator("tbody tr").first();
  const label = firstRow.getByRole("button", { name: /查看池标签 高费率/u });
  await expect(label).toBeVisible();
  await expect(firstRow.locator(".pool-label-more")).toHaveText("+2");
  await label.focus();
  await expect(label).toBeFocused();
  await page.keyboard.press("Enter");

  const detail = page.getByRole("dialog", { name: "池标签详情" });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("FEE_TVL_GTE_THRESHOLD");
  await expect(detail).toContainText("TRANSACTION_COUNT_GTE_THRESHOLD");
  await expect(detail).toContainText("LP_NET_FLOW_GTE_THRESHOLD");
  await expect(detail).toContainText("pool-labels/local-v1");
  await page.keyboard.press("Escape");
  await expect(label).toBeFocused();

  const unlabeled = page.locator("tbody tr[data-pool-label-count='0']").first();
  await expect(unlabeled).toBeVisible();
  await expect(unlabeled.locator(".pool-label-chip, .pool-label-placeholder")).toHaveCount(0);
});

test("pool labels remain keyboard accessible, axe-clean and non-overflowing on each viewport", async ({
  page,
}, testInfo) => {
  await installFixture(page);
  await page.goto("/pools?fixture=pools-ready");
  const button = page.getByRole("button", { name: /查看池标签 高费率/u }).first();
  await button.focus();
  await page.keyboard.press("Space");
  const detail = page.getByRole("dialog", { name: "池标签详情" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "关闭池标签详情" })).toBeFocused();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  expect(await detail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-08/ui/pool-labels-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});
