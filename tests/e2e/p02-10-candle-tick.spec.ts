import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const token0 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const poolAddress = "0x1111111111111111111111111111111111111111";
const poolKey = `56:${poolAddress}`;
const revision = `canonical:v1:${"ab".repeat(32)}`;

async function installFixture(page: Page): Promise<{ candleRequests: () => number }> {
  let candleRequests = 0;
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
            displayName: "P02-10 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "2b000000-0000-4000-8000-000000000001",
          },
        },
        requestId: "req-p02-10-auth",
        success: true,
      },
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { remarks: [], shared: [] }, requestId: "req-p02-10-remarks", success: true },
    }),
  );
  await page.route("**/api/market/candles?**", (route) => {
    candleRequests += 1;
    const url = new URL(route.request().url());
    const bar = url.searchParams.get("bar") ?? "5m";
    const token = url.searchParams.get("token") ?? token0;
    const direction = token === token0 ? "token0" : "token1";
    return route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          asOf: "2026-08-17T00:05:00.000Z",
          bar,
          candles: [
            {
              close: "1.15",
              high: "1.2",
              low: "0.9",
              open: "1",
              ts: 1_786_924_500,
              volume: "1500000000000000000",
            },
            {
              close: "1.3",
              high: "1.35",
              low: "1.1",
              open: "1.15",
              ts: 1_786_924_800,
              volume: "2200000000000000000",
            },
          ],
          canonicalRevision: revision,
          chainId: 56,
          direction,
          poolKey: url.searchParams.get("poolKey"),
          priceUnit:
            direction === "token0" ? "token1-raw/token0-raw" : "token0-raw/token1-raw",
          source: "canonical-events",
          token,
          version: "7",
          volumeUnit: { kind: "raw-integer", token },
        },
        requestId: `req-candle-${candleRequests}`,
        success: true,
      },
    });
  });
  await page.route("**/api/pools/liquidity/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          asOf: "2026-08-17T00:05:00.000Z",
          canonicalRevision: revision,
          chainId: 56,
          currentTick: 10,
          decimals0: null,
          decimals1: null,
          poolKey,
          range: 10,
          source: "canonical-events",
          tickSpacing: 50,
          ticks: [
            { liquidityNet: "800", price0: null, price1: null, tickIdx: -100 },
            { liquidityNet: "1200", price0: null, price1: null, tickIdx: 0 },
            { liquidityNet: "-600", price0: null, price1: null, tickIdx: 100 },
          ],
          version: "7",
        },
        requestId: "req-tick",
        success: true,
      },
    }),
  );
  return { candleRequests: () => candleRequests };
}

test("POOL-12 expands one pool, refreshes Candle data and switches accessible tabs", async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto("/pools?fixture=pools-ready&chart_refresh_ms=100");

  const firstToggle = page.getByRole("button", { name: `展开池图表 ${poolAddress}` });
  await firstToggle.focus();
  await page.keyboard.press("Enter");
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  const detail = page.getByRole("region", { name: "WBNB / USDT 市场图表" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("tab", { name: "K 线" })).toHaveAttribute("aria-selected", "true");
  await expect(detail.locator(".candle-chart-canvas canvas").first()).toBeVisible();
  await expect.poll(fixture.candleRequests).toBeGreaterThanOrEqual(2);

  const tickTab = detail.getByRole("tab", { name: "Tick 流动性" });
  await tickTab.focus();
  await page.keyboard.press("Enter");
  await expect(tickTab).toHaveAttribute("aria-selected", "true");
  await expect(detail.locator(".tick-liquidity-histogram")).toBeVisible();
  await expect(detail.getByRole("table", { name: "Tick 流动性数据" })).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await expect(detail.getByRole("tab", { name: "K 线" })).toBeFocused();
  await expect(detail.getByRole("tab", { name: "K 线" })).toHaveAttribute("aria-selected", "true");

  await firstToggle.focus();
  await page.keyboard.press("Space");
  await expect(detail).toHaveCount(0);
  await expect(firstToggle).toBeFocused();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
});

test("POOL-12 keeps one expanded row, stable columns, mobile bounds and axe semantics", async ({
  page,
}, testInfo) => {
  await installFixture(page);
  await page.goto("/pools?fixture=pools-ready");
  const table = page.getByRole("table", { name: "BSC 热门池" });
  const widthsBefore = await table.getByRole("columnheader").evaluateAll((cells) =>
    cells.map((cell) => Math.round(cell.getBoundingClientRect().width)),
  );
  const toggles = table.getByRole("button", { name: /^展开池图表/u });
  await toggles.nth(0).click();
  const detail = page.locator(".pool-market-detail");
  await expect(detail).toHaveCount(1);
  const widthsAfter = await table.getByRole("columnheader").evaluateAll((cells) =>
    cells.map((cell) => Math.round(cell.getBoundingClientRect().width)),
  );
  expect(widthsAfter).toEqual(widthsBefore);
  await toggles.nth(1).click();
  await expect(detail).toHaveCount(1);
  await expect(toggles.nth(0)).toHaveAttribute("aria-expanded", "false");
  await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  const box = await detail.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width + 1);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);

  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-10/ui/candle-tick-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

for (const [state, text] of [
  ["loading", "正在加载 K 线"],
  ["empty", "暂无 K 线历史"],
  ["error", "图表加载失败"],
  ["stale", "图表数据陈旧"],
  ["unsupported", "当前池暂不支持图表"],
  ["invalid", "图表数据无效"],
] as const) {
  test(`POOL-12 exposes ${state} without invented chart values`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "State matrix runs once.");
    await installFixture(page);
    await page.goto(`/pools?fixture=pools-ready&chart_state=${state}`);
    await page.getByRole("button", { name: `展开池图表 ${poolAddress}` }).click();
    const detail = page.locator(".pool-market-detail");
    await expect(detail).toHaveAttribute("data-market-detail-state", state);
    await expect(detail.getByText(text, { exact: true })).toBeVisible();
    if (state !== "stale") await expect(detail.locator("canvas")).toHaveCount(0);
  });
}
