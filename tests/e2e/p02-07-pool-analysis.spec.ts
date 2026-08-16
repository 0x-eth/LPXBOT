import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const poolColumns = [
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
] as const;

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
            displayName: "P02-07 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000057",
          },
        },
        requestId: "req-p02-07-auth",
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
            poolColumns,
            poolsPanelCollapsed: false,
            showHotPools: false,
            showScanTab: true,
            taskViewMode: "grid",
            theme: "system",
          },
          revision: 0,
          schemaVersion: 4,
          updatedAt: null,
        },
        requestId: "req-p02-07-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { remarks: [], shared: [] }, requestId: "req-p02-07-remarks", success: true },
    }),
  );
}

test("POOL-05/06 expose precise yield columns and restorable advanced filters", async ({
  page,
}) => {
  await installFixture(page);
  await page.goto("/pools?fixture=pools-ready");

  const table = page.getByRole("table", { name: "BSC 热门池" });
  await expect(table.getByRole("columnheader", { name: "Fee/TVL" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Fee/aTVL" })).toBeVisible();
  await expect(table.locator("tbody tr").first()).toContainText("0.4281%");
  await expect(table.locator("tbody tr").first()).toContainText("不可用");

  const search = page.getByRole("region", { name: "池搜索" });
  const advanced = page.getByRole("region", { name: "高级筛选" });
  expect(
    await search.evaluate(
      (element, filter) =>
        Boolean(element.compareDocumentPosition(filter as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await advanced.elementHandle(),
    ),
  ).toBe(true);
  await expect(advanced).toHaveAttribute("data-filter-state", "pristine");
  await advanced.getByRole("button", { name: "展开高级筛选" }).click();
  await advanced.getByRole("checkbox", { name: "V4" }).uncheck();
  await advanced.getByRole("checkbox", { name: "启用 Fees 筛选" }).check();
  await advanced.getByLabel("Fees 最小值").fill("400");
  await expect(advanced).toHaveAttribute("data-filter-state", "dirty");
  await advanced.getByRole("button", { name: "应用筛选" }).click();
  await expect(advanced).toHaveAttribute("data-filter-state", "applied");
  await expect(page).toHaveURL(/pool_versions=v3/u);
  await expect(page).toHaveURL(/pool_fees=400%3A/u);
  await expect(page.locator(".pool-table-toolbar")).toContainText("1 组");

  await page.reload();
  await expect(advanced.getByRole("checkbox", { name: "V4" })).not.toBeChecked();
  await expect(advanced.getByLabel("Fees 最小值")).toHaveValue("400");
  await advanced.getByRole("button", { name: "重置筛选" }).click();
  await expect(advanced).toHaveAttribute("data-filter-state", "pristine");
  await expect(page).not.toHaveURL(/pool_versions|pool_fees/u);

  await advanced.getByRole("checkbox", { name: "启用 Volume 筛选" }).check();
  await advanced.getByLabel("Volume 最小值").fill("not-a-decimal");
  await advanced.getByRole("button", { name: "应用筛选" }).click();
  await expect(advanced).toHaveAttribute("data-filter-state", "invalid");
  await expect(advanced.getByRole("alert")).toHaveText("请检查高级筛选条件");

  await advanced.getByRole("button", { name: "重置筛选" }).click();
  await advanced.getByRole("checkbox", { name: "启用 Fee/aTVL 筛选" }).check();
  await advanced.getByRole("button", { name: "应用筛选" }).click();
  await expect(advanced).toHaveAttribute("data-filter-state", "no-results");
  await expect(page.getByText("没有符合高级筛选条件的池", { exact: true })).toBeVisible();
});

test("POOL-11 compares two to three stable pool keys in one snapshot", async ({ page }) => {
  await installFixture(page);
  await page.goto("/pools?fixture=pools-ready");

  const table = page.getByRole("table", { name: "BSC 热门池" });
  let select = table.getByRole("button", { name: /^选择对比/u });
  await select.nth(0).click();
  const comparison = page.getByRole("region", { name: "池对比" });
  await expect(comparison).toHaveAttribute("data-comparison-state", "one-selected");
  await select.nth(1).click();
  await expect(comparison).toHaveAttribute("data-comparison-state", "ready");
  const comparisonTable = comparison.getByRole("table", { name: "池对比指标" });
  await expect(comparisonTable.getByRole("row", { name: /aTVL/u })).toContainText("不可用");
  await expect(comparison).toContainText("5m");
  await expect(comparison).toContainText("快照 fixture-1");
  await expect(comparison).toContainText("2026-08-16 01:00:00 UTC");

  select = table.getByRole("button", { name: /^选择对比/u });
  await select.first().click();
  await table.getByRole("button", { name: /^展开池分组/u }).click();
  await table.getByRole("button", { name: /^选择对比/u }).click();
  await expect(comparison).toHaveAttribute("data-comparison-state", "limit-reached");
  await expect(comparison.getByRole("alert")).toHaveText("最多对比 3 个池");

  await page.reload();
  await expect(comparison).toHaveAttribute("data-comparison-state", "none-selected");
});

test("advanced filtering and comparison are keyboard, mobile, and axe clean", async ({
  page,
}, testInfo) => {
  await installFixture(page);
  await page.goto("/pools?fixture=pools-ready");

  const table = page.getByRole("table", { name: "BSC 热门池" });
  const compare = table.getByRole("button", { name: /^选择对比/u }).first();
  await compare.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: "池对比" })).toHaveAttribute(
    "data-comparison-state",
    "one-selected",
  );
  await table.getByRole("button", { name: /^选择对比/u }).first().click();
  await expect(page.getByRole("region", { name: "池对比" })).toHaveAttribute(
    "data-comparison-state",
    "ready",
  );
  await page.getByRole("button", { name: "展开高级筛选" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Volume 最小值")).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-07/ui/pool-analysis-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});
