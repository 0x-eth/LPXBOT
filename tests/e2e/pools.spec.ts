import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function useSession(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "Pools Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000052",
          },
        },
        requestId: "req-pools-e2e",
      },
      status: 200,
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: { remarks: [], shared: [] },
        requestId: "req-pools-remarks-e2e",
        success: true,
      },
      status: 200,
    }),
  );
}

test("POOL-01/02/04/16 render the usable local tracer row", async ({ page }) => {
  await useSession(page);
  await page.goto("/pools?fixture=pools-ready");

  await expect(page.getByRole("heading", { level: 1, name: "热门池" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "时间窗" })).toBeVisible();
  for (const minutes of [1, 5, 15, 30, 60]) {
    await expect(page.getByRole("radio", { exact: true, name: `${minutes} 分钟` })).toBeVisible();
  }
  await page.getByRole("radio", { exact: true, name: "15 分钟" }).click();
  await expect(page.getByRole("radio", { exact: true, name: "15 分钟" })).toBeChecked();
  await expect(page.getByRole("status", { name: "市场数据连接状态" })).toContainText("实时");
  const table = page.getByRole("table", { name: "BSC 热门池" });
  await expect(table).toBeVisible();
  for (const heading of ["池", "协议", "Fees", "Volume", "TVL", "Txs", "FDV"]) {
    await expect(table.getByRole("columnheader", { name: heading })).toBeVisible();
  }
  await expect(table.getByRole("row", { name: /WBNB.*USDT.*PancakeSwap V3/u })).toBeVisible();
  await expect(page.getByText(/aTVL/u)).toHaveCount(0);
});

for (const state of ["loading", "empty", "error", "stale", "reconnecting"] as const) {
  test(`pools exposes the ${state} state without fake values`, async ({ page }) => {
    await useSession(page);
    await page.goto(`/pools?fixture=pools-${state}`);
    await expect(page.locator("main[data-pools-state]")).toHaveAttribute("data-pools-state", state);
    if (state === "loading") {
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
    }
    if (state === "error") {
      await expect(page.locator(".pools-error").getByRole("alert")).toHaveText("市场数据暂不可用");
    }
    if (state === "stale" || state === "reconnecting") {
      await expect(page.getByRole("table", { name: "BSC 热门池" })).toBeVisible();
    }
    if (state === "empty" || state === "error" || state === "loading") {
      await expect(page.getByText("$0", { exact: true })).toHaveCount(0);
    }
  });
}

test("pools is keyboard accessible, non-overflowing, and axe-clean on mobile and desktop", async ({
  page,
}) => {
  await useSession(page);
  await page.goto("/pools?fixture=pools-ready");

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("radio", { exact: true, name: "1 分钟" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { exact: true, name: "5 分钟" })).toBeChecked();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      `${viewport.width}px root overflow`,
    ).toBe(false);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(
      axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  }
});
