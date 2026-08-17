import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P03_04 === "1";
const userId = "3b000000-0000-4000-8000-000000000001";
const monitorA = "3b000000-0000-4000-8000-000000000011";
const monitorB = "3b000000-0000-4000-8000-000000000012";
const timestamp = "2026-08-18T00:00:00.000Z";
const poolKey = `56:0x${"a".repeat(40)}`;

interface HistoryState {
  delayMilliseconds: number;
  fail: boolean;
  items: ReturnType<typeof historyItem>[];
}

function envelope(data: unknown) {
  return { data, requestId: "p03-04-e2e", success: true };
}

function monitor(monitorId: string, name: string) {
  return {
    conditions: [{ enabled: true, id: "volumeUsd", operator: "gte", value: "1000" }],
    createdAt: timestamp,
    destinationIds: [],
    disabledAt: timestamp,
    enabled: false,
    enabledAt: null,
    excludeHanToken: true,
    excludeHook: true,
    monitorId,
    name,
    poolKey,
    revision: 1,
    updatedAt: timestamp,
    userId,
    windowMinutes: 5,
  };
}

function historyItem(
  suffix: number,
  status: "pending" | "sending" | "retrying" | "delivered" | "failed",
  overrides: Record<string, unknown> = {},
) {
  const createdAt = `2026-08-18T00:0${5 - suffix}:00.000Z`;
  return {
    attemptCount: status === "pending" ? 0 : status === "retrying" ? 2 : 1,
    conditionSummary: "volumeUsd gte 1000",
    createdAt,
    deliveredAt: status === "delivered" ? createdAt : null,
    deliveryId: `3b000000-0000-4000-8000-${String(100 + suffix).padStart(12, "0")}`,
    destination: {
      destinationId: "3b000000-0000-4000-8000-000000000021",
      name: status === "sending" ? "Telegram alerts" : "Operations webhook",
      type: status === "sending" ? "telegram" : "webhook",
    },
    errorCode: status === "failed" ? "HTTP_400" : status === "retrying" ? "HTTP_503" : null,
    monitorId: suffix === 4 ? monitorB : monitorA,
    monitorName: suffix === 4 ? "Fee watch" : "Volume watch",
    nextRetryAt: status === "retrying" ? "2026-08-18T00:10:00.000Z" : null,
    poolKey,
    status,
    updatedAt: createdAt,
    windowEnd: "2026-08-17T23:55:00.000Z",
    windowMinutes: 5,
    ...overrides,
  };
}

function historyFixtures() {
  return [
    historyItem(0, "pending"),
    historyItem(1, "sending"),
    historyItem(2, "retrying"),
    historyItem(3, "delivered"),
    historyItem(4, "failed"),
  ];
}

async function historyRoute(route: Route, state: HistoryState): Promise<void> {
  const url = new URL(route.request().url());
  if (state.delayMilliseconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, state.delayMilliseconds));
    state.delayMilliseconds = 0;
  }
  if (state.fail) {
    await route.fulfill({
      contentType: "application/json",
      json: {
        error: {
          code: "NOTIFICATION_HISTORY_UNAVAILABLE",
          message: "fixture",
          requestId: "p03-04-error",
          retryable: true,
        },
        success: false,
      },
      status: 503,
    });
    return;
  }
  let items = state.items;
  const status = url.searchParams.get("deliveryStatus");
  const monitorId = url.searchParams.get("monitorId");
  if (status) items = items.filter((item) => item.status === status);
  if (monitorId) items = items.filter((item) => item.monitorId === monitorId);
  const cursor = url.searchParams.get("cursor");
  const page = status || monitorId ? items : cursor ? items.slice(3) : items.slice(0, 3);
  await route.fulfill({
    contentType: "application/json",
    json: envelope({ items: page, nextCursor: !status && !monitorId && !cursor && items.length > 3 ? "next-page" : null }),
  });
}

async function installFixture(page: Page, state: HistoryState): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        isAdmin: false,
        maintenance: null,
        user: {
          allowedChainIds: [56],
          avatarUrl: null,
          displayName: "P03-04 Fixture",
          maintenanceBypass: false,
          role: "user",
          tier: "normal",
          userId,
        },
      }),
    }),
  );
  await page.route("**/api/user/preferences", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
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
          poolColumns: [],
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
      }),
    }),
  );
  await page.route("**/api/user/pool-blocklist", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        blocklistHash: `sha256:${"0".repeat(64)}`,
        entries: [],
        revision: 0,
        schemaVersion: 1,
        updatedAt: null,
      }),
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({ contentType: "application/json", json: envelope({ remarks: [], shared: [] }) }),
  );
  await page.route("**/api/stats/stream**", (route) => route.fulfill({ status: 503 }));
  await page.route("**/api/monitors**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        enabledCount: 0,
        items: [monitor(monitorA, "Volume watch"), monitor(monitorB, "Fee watch")],
        nextCursor: null,
        totalCount: 2,
      }),
    }),
  );
  await page.route("**/api/notification-destinations", (route) =>
    route.fulfill({ contentType: "application/json", json: envelope([]) }),
  );
  await page.route("**/api/notifications/history**", (route) => historyRoute(route, state));
}

async function expectAccessibleAndContained(page: Page): Promise<void> {
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
}

test("MON-05 notification history supports responsive scanning, filters, pagination, and details", async ({
  page,
}, testInfo) => {
  const state = { delayMilliseconds: 500, fail: false, items: historyFixtures() };
  await installFixture(page, state);
  await page.goto("/monitors");
  await page.getByRole("tab", { name: "通知历史" }).click();
  await expect(page.getByRole("status", { name: "正在加载通知历史" })).toBeVisible();
  const history = page.getByRole("region", { name: "通知历史" });
  await expect(history).toBeVisible();
  await expect(history.locator(".notification-history-status", { hasText: "待发送" })).toBeVisible();
  await expect(history.locator(".notification-history-status", { hasText: "发送中" })).toBeVisible();
  await expect(history.locator(".notification-history-status", { hasText: "重试中" })).toBeVisible();

  if (testInfo.project.name.includes("mobile")) {
    await expect(page.getByRole("list", { name: "通知历史列表" })).toBeVisible();
    await expect(page.getByRole("table", { name: "通知历史表格" })).toBeHidden();
  } else {
    await expect(page.getByRole("table", { name: "通知历史表格" })).toBeVisible();
    await expect(page.getByRole("list", { name: "通知历史列表" })).toBeHidden();
  }

  await page.getByRole("button", { name: "加载更多通知历史" }).click();
  await expect(history.locator(".notification-history-status", { hasText: "已送达" })).toBeVisible();
  await expect(history.locator(".notification-history-status", { hasText: "失败" })).toBeVisible();

  await page.getByLabel("投递状态").selectOption("retrying");
  await expect(page.getByText("HTTP_503", { exact: true })).toBeVisible();
  await expect(history.locator(".notification-history-status", { hasText: "失败" })).toHaveCount(0);
  await page.getByLabel("投递状态").selectOption("");
  await page.getByLabel("监控筛选").selectOption(monitorB);
  await expect(history.locator("strong", { hasText: "Fee watch" })).toBeVisible();

  await page.getByLabel("监控筛选").selectOption("");
  const detailsButton = page.getByRole("button", { name: /查看投递.*102/u }).first();
  await detailsButton.click();
  const drawer = page.getByRole("dialog", { name: "投递详情" });
  await expect(drawer.getByRole("button", { name: "关闭投递详情" })).toBeFocused();
  await expect(drawer).toContainText("volumeUsd gte 1000");
  await page.keyboard.press("Escape");
  await expect(detailsButton).toBeFocused();

  await expectAccessibleAndContained(page);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    ...(captureEvidence
      ? { path: `artifacts/acceptance/P03-04/ui/history-ready-${testInfo.project.name}.png` }
      : {}),
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test("MON-05 notification history exposes error recovery and empty state", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "State recovery runs once.");
  const state = { delayMilliseconds: 0, fail: true, items: historyFixtures() };
  await installFixture(page, state);
  await page.goto("/monitors");
  await page.getByRole("tab", { name: "通知历史" }).click();
  await expect(page.getByRole("alert")).toContainText("加载通知历史失败");
  state.fail = false;
  state.items = [];
  await page.getByRole("button", { name: "重试加载通知历史" }).click();
  await expect(page.getByRole("status", { name: "通知历史为空" })).toContainText("没有符合条件的通知");
  await expectAccessibleAndContained(page);
});
