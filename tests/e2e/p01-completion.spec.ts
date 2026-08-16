import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ThemeMode = "light" | "dark" | "system";
type RouteState = "loading" | "empty" | "error" | "forbidden";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const captureEvidence = process.env.LPBOT_CAPTURE_P01_08 === "1";
const routeMatrixTimeoutMilliseconds = 180_000;
const routes = [
  { path: "/tasks/running", title: "Tasks" },
  { path: "/tasks/paused", title: "Tasks" },
  { path: "/tasks/stopped", title: "Tasks" },
  { path: "/pools", title: "Pools" },
  { path: "/strategies", title: "Strategies" },
  { path: "/activity", title: "Activity" },
  { path: "/wallets", title: "Wallets" },
  { path: "/developer", title: "Developer" },
  { path: "/settings", title: "Settings" },
] as const;
const expectedStateTitles: Record<RouteState, string | null> = {
  empty: null,
  error: "Page unavailable",
  forbidden: "Access denied",
  loading: "Loading page",
};

const preferences = {
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
  theme: "system" as ThemeMode,
};

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
            displayName: "P01 Completion User",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "29000000-0000-4000-8000-000000000001",
          },
        },
        requestId: "req-p01-completion-auth",
        success: true,
      },
      status: 200,
    }),
  );
  await page.route("**/api/user/preferences", (route) => fulfillPreferences(route));
  await page.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { links: [] }, requestId: "req-p01-completion-wallets", success: true },
      status: 200,
    }),
  );
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      json: {
        data: {
          observedAt: "2026-08-16T00:00:00.000Z",
          sequence: 1,
          stats: {
            fps: null,
            gas: { baseGwei: null, ethereumGwei: null },
            online: null,
            pingMs: null,
            recommendedPools: null,
            taskCounts: { paused: null, running: null, stopped: null },
          },
        },
        requestId: "req-p01-completion-stats",
        success: true,
      },
      status: 200,
    }),
  );
  await page.route("**/api/stats/stream", (route) =>
    route.fulfill({
      body: "",
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
      status: 200,
    }),
  );
}

async function fulfillPreferences(route: Route): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    json: {
      data: {
        preferences,
        revision: 1,
        schemaVersion: 5,
        updatedAt: "2026-08-16T00:00:00.000Z",
      },
      requestId: "req-p01-completion-preferences",
      success: true,
    },
    status: 200,
  });
}

async function expectAccessibleStablePage(page: Page): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("P01 route-state matrix covers loading, empty, error and forbidden", async ({
  page,
}, testInfo) => {
  test.setTimeout(routeMatrixTimeoutMilliseconds);
  await installFixture(page);
  preferences.theme = "light";

  for (const route of routes) {
    for (const state of ["loading", "empty", "error", "forbidden"] as const) {
      await page.goto(`${route.path}?fixture=route-${state}`);
      await expect(page.locator("main[data-fixture-state]")).toHaveAttribute(
        "data-fixture-state",
        state,
      );
      await expectAccessibleStablePage(page);
      await expect(page.locator("h1")).toContainText(expectedStateTitles[state] ?? route.title);

      if (captureEvidence && route.path === "/tasks/running") {
        await page.screenshot({
          animations: "disabled",
          fullPage: true,
          path: path.join(
            ROOT,
            "artifacts/acceptance/P01-08/ui",
            `${state}-${testInfo.project.name}.png`,
          ),
        });
      }
    }
  }
});

test("P01 route matrix covers light, dark and system themes on both viewports", async ({
  page,
}, testInfo) => {
  test.setTimeout(routeMatrixTimeoutMilliseconds);
  await installFixture(page);

  for (const theme of ["light", "dark", "system"] as const) {
    preferences.theme = theme;
    await page.emulateMedia({ colorScheme: theme === "system" ? "dark" : theme });
    for (const route of routes) {
      await page.goto(`${route.path}?fixture=route-empty`);
      await expect(page.locator("html")).toHaveAttribute("data-theme-preference", theme);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme === "system" ? "dark" : theme,
      );
      await expectAccessibleStablePage(page);
    }

    if (captureEvidence) {
      await page.goto("/tasks/running?fixture=route-empty");
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: path.join(
          ROOT,
          "artifacts/acceptance/P01-08/ui",
          `theme-${theme}-${testInfo.project.name}.png`,
        ),
      });
    }
  }
});

test("P01 route matrix stays non-overlapping at all required widths", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "The width matrix runs once.");
  test.setTimeout(routeMatrixTimeoutMilliseconds);
  await installFixture(page);
  preferences.theme = "system";

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ height: width < 900 ? 844 : 900, width });
    for (const route of routes) {
      await page.goto(`${route.path}?fixture=route-empty`);
      await expectAccessibleStablePage(page);
      const overlap = await page.evaluate(() => {
        const main = document.querySelector("main")?.getBoundingClientRect();
        const mobile = document.querySelector(".mobile-navigation-shell")?.getBoundingClientRect();
        const mobileVisible =
          mobile &&
          getComputedStyle(document.querySelector(".mobile-navigation-shell")!).display !== "none";
        return Boolean(main && mobile && mobileVisible && main.bottom > mobile.top + 0.5);
      });
      expect(overlap, `${route.path} at ${width}px`).toBe(false);
    }
  }
});
