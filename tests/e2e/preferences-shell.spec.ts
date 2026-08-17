import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

const captureP0106Evidence = process.env.LPBOT_CAPTURE_P01_06 === "1";

declare global {
  var __themeAtDomReady: string | undefined;
}

type ThemeMode = "light" | "dark" | "system";

interface PreferenceFixture {
  colorTheme: string;
  customColor: string | null;
  navConfig: Array<{ key: string; visible: boolean }>;
  poolColumns: Array<{ key: string; visible: boolean }>;
  poolsPanelCollapsed: boolean;
  showHotPools: boolean;
  showPoolLabels: boolean;
  showScanTab: boolean;
  taskViewMode: "grid" | "list";
  theme: ThemeMode;
}

interface FixtureState {
  failNextPatch?: boolean;
  failedPatchGate?: Promise<void>;
  getGate?: Promise<void>;
  preferences: PreferenceFixture;
  revision: number;
}

const defaultPreferences: PreferenceFixture = {
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
};

const session = {
  allowedChainIds: [1, 56],
  avatarUrl: null,
  displayName: "Preference Fixture",
  maintenanceBypass: false,
  role: "user",
  tier: "normal",
  userId: "28000000-0000-4000-8000-000000000001",
};

function cloneDefaults(): PreferenceFixture {
  return structuredClone(defaultPreferences);
}

async function fulfillPreferences(route: Route, state: FixtureState): Promise<void> {
  if (route.request().method() === "GET") {
    if (state.getGate) await state.getGate;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      json: {
        data: {
          preferences: state.preferences,
          revision: state.revision,
          schemaVersion: 5,
          updatedAt: state.revision === 0 ? null : "2026-08-14T09:30:00.000Z",
        },
        requestId: "req-preferences-e2e",
        success: true,
      },
      status: 200,
    });
    return;
  }

  const body = route.request().postDataJSON() as {
    changes: Partial<PreferenceFixture>;
    expectedRevision: number;
  };
  if (state.failNextPatch) {
    state.failNextPatch = false;
    await (state.failedPatchGate ?? new Promise((resolve) => setTimeout(resolve, 250)));
    await route.fulfill({
      contentType: "application/json",
      json: {
        error: {
          code: "INTERNAL_ERROR",
          message: "Fixture internals must not render",
          requestId: "req-preferences-failed",
          retryable: true,
        },
        success: false,
      },
      status: 500,
    });
    return;
  }
  if (body.expectedRevision !== state.revision) {
    await route.fulfill({
      contentType: "application/json",
      json: {
        error: {
          code: "PREFERENCES_CONFLICT",
          message: "Preferences changed",
          requestId: "req-preferences-conflict",
          retryable: true,
        },
        success: false,
      },
      status: 409,
    });
    return;
  }
  state.preferences = { ...state.preferences, ...structuredClone(body.changes) };
  state.revision += 1;
  await route.fulfill({
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    json: {
      data: {
        preferences: state.preferences,
        revision: state.revision,
        schemaVersion: 5,
        updatedAt: "2026-08-14T09:30:00.000Z",
      },
      requestId: "req-preferences-saved",
      success: true,
    },
    status: 200,
  });
}

async function installFixture(context: BrowserContext, state: FixtureState): Promise<void> {
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: { isAdmin: false, maintenance: null, user: session },
        requestId: "req-preferences-auth",
        success: true,
      },
      status: 200,
    }),
  );
  await context.route("**/api/user/preferences", (route) => fulfillPreferences(route, state));
  await context.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { links: [] }, requestId: "req-wallet-empty", success: true },
      status: 200,
    }),
  );
  await context.route("**/api/notification-preferences", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          categories: {
            "feedback-replied": false,
            "monitor-match": false,
            "operation-failed": false,
            "position-closed": false,
            "position-moved": false,
            "task-created": false,
          },
          revision: 0,
          updatedAt: null,
        },
        requestId: "req-notification-preferences-empty",
        success: true,
      },
      status: 200,
    }),
  );
  await context.route("**/api/notification-destinations", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: [], requestId: "req-notification-destinations-empty", success: true },
      status: 200,
    }),
  );
  await context.route("**/api/notification-destinations/options", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: { telegramIdentityId: null },
        requestId: "req-notification-options-empty",
        success: true,
      },
      status: 200,
    }),
  );
  await context.route("**/api/stats", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      json: {
        data: {
          observedAt: "2026-08-14T09:30:00.000Z",
          sequence: 20,
          stats: {
            fps: 60,
            gas: { baseGwei: 0.006, ethereumGwei: 0.232 },
            online: true,
            pingMs: 84,
            taskCounts: { paused: 1, running: 1, stopped: 1 },
          },
        },
        requestId: "req-stats-snapshot",
        success: true,
      },
      status: 200,
    }),
  );
  await context.route("**/api/stats/stream**", (route) =>
    route.fulfill({
      body:
        'id: 20\nevent: snapshot\ndata: {"type":"snapshot","observedAt":"2026-08-14T09:30:00.000Z","sequence":20,"stats":{"fps":60,"gas":{"baseGwei":0.006,"ethereumGwei":0.232},"online":true,"pingMs":84,"taskCounts":{"paused":1,"running":1,"stopped":1}}}\n\n' +
        'id: 21\nevent: heartbeat\ndata: {"type":"heartbeat","observedAt":"2026-08-14T09:30:01.000Z","sequence":21}\n\n',
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
      status: 200,
    }),
  );
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

async function waitForWordmarkImage(page: Page): Promise<void> {
  const image = page.locator(".wordmark img");
  await image.evaluate((element: HTMLImageElement) => element.decode());
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(
    0,
  );
}

async function installPersistentStatsStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, window.location.href).pathname !== "/api/stats/stream") {
        return nativeFetch(input, init);
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'id: 20\nevent: snapshot\ndata: {"type":"snapshot","observedAt":"2026-08-14T09:30:00.000Z","sequence":20,"stats":{"fps":60,"gas":{"baseGwei":0.006,"ethereumGwei":0.232},"online":true,"pingMs":84,"taskCounts":{"paused":1,"running":1,"stopped":1}}}\n\n',
            ),
          );
        },
      });
      return Promise.resolve(
        new Response(stream, { headers: { "Content-Type": "text/event-stream" }, status: 200 }),
      );
    };
  });
}

test("SHELL-03 applies cached theme before first paint and follows live system changes", async ({
  context,
  page,
}) => {
  const state: FixtureState = {
    preferences: { ...cloneDefaults(), colorTheme: "teal", theme: "system" },
    revision: 4,
  };
  await page.addInitScript(() => {
    localStorage.setItem(
      "lpbot-theme-bootstrap",
      JSON.stringify({ colorTheme: "teal", customColor: null, theme: "system" }),
    );
    const browser = globalThis as typeof globalThis & {
      __themeAtDomReady: string | undefined;
    };
    document.addEventListener("DOMContentLoaded", () => {
      browser.__themeAtDomReady = document.documentElement.dataset.theme;
    });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await installFixture(context, state);
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => globalThis.__themeAtDomReady)).toBe("light");
  await expect(page.locator("meta[name='theme-color']")).toHaveAttribute("content", "#FFFFFF");
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("meta[name='theme-color']")).toHaveAttribute("content", "#151719");
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
});

test("SHELL-03 covers light, dark, system-light and system-dark with a representative accent", async ({
  context,
  page,
}) => {
  const state: FixtureState = { preferences: cloneDefaults(), revision: 0 };
  await installFixture(context, state);
  for (const fixture of [
    { expected: "light", mode: "light", system: "dark" },
    { expected: "dark", mode: "dark", system: "light" },
    { expected: "light", mode: "system", system: "light" },
    { expected: "dark", mode: "system", system: "dark" },
  ] as const) {
    state.preferences = { ...cloneDefaults(), colorTheme: "blue", theme: fixture.mode };
    await page.emulateMedia({ colorScheme: fixture.system });
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("data-theme", fixture.expected);
    await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
    await expect(page.getByRole("heading", { level: 2, name: "界面" })).toBeVisible();
  }
});

test("SET-01 and SET-02 update optimistically, roll back, retry and validate custom color", async ({
  context,
  page,
}) => {
  let releaseFailedPatch = () => {};
  const failedPatchGate = new Promise<void>((resolve) => {
    releaseFailedPatch = resolve;
  });
  let releaseGet = () => {};
  const getGate = new Promise<void>((resolve) => {
    releaseGet = resolve;
  });
  const state: FixtureState = {
    failNextPatch: true,
    failedPatchGate,
    getGate,
    preferences: cloneDefaults(),
    revision: 0,
  };
  await installFixture(context, state);
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  try {
    await expect(page.getByRole("status", { name: "界面设置状态" })).toContainText("正在加载");
  } finally {
    releaseGet();
  }
  await expect(page.getByRole("status", { name: "界面设置状态" })).toContainText("已同步");

  const hotPools = page.getByRole("switch", { name: "热门池子推荐" });
  await hotPools.click();
  try {
    await expect(hotPools).toBeChecked();
    await expect(page.getByRole("status", { name: "界面设置状态" })).toContainText("正在保存");
  } finally {
    releaseFailedPatch();
  }
  await expect(page.getByRole("alert").filter({ hasText: "界面设置保存失败" })).toBeVisible();
  await expect(hotPools).not.toBeChecked();
  await expect(page.getByText("Fixture internals must not render")).toHaveCount(0);

  await page.getByRole("button", { name: "重试" }).click();
  await expect(hotPools).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "界面设置已保存" })).toBeVisible();

  await page.getByRole("radio", { name: "自定义颜色" }).click();
  const customColor = page.getByLabel("自定义强调色");
  await customColor.fill("red");
  await customColor.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "请输入六位十六进制颜色" })).toBeVisible();
  await customColor.fill("#0F766E");
  await customColor.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "custom");
  await expectNoSeriousAxeViolations(page);
});

test("SHELL-04 reorders and hides both navigation surfaces with keyboard and cross-context persistence", async ({
  browser,
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Cross-context navigation runs once.");
  const state: FixtureState = { preferences: cloneDefaults(), revision: 0 };
  await installFixture(context, state);
  await page.goto("/settings");

  const taskVisibility = page.getByRole("switch", { name: "显示任务" });
  await expect(taskVisibility).toBeChecked();
  await expect(taskVisibility).toBeDisabled();
  await page.getByRole("switch", { name: "显示策略" }).click();
  const walletRow = page.getByRole("listitem").filter({ hasText: "钱包" });
  await walletRow.focus();
  await walletRow.press("Alt+ArrowUp");
  await expect(page.getByRole("status").filter({ hasText: "界面设置已保存" })).toBeVisible();

  const desktopNav = page.locator(".app-header > .primary-navigation");
  await expect(desktopNav.getByText("策略", { exact: true })).toHaveCount(0);
  await expect(desktopNav.locator(".primary-navigation-item")).toHaveText([
    /任务/u,
    /池子/u,
    /钱包/u,
    /日志/u,
    /聊天室/u,
  ]);
  await page.setViewportSize({ height: 844, width: 390 });
  const mobileNav = page.locator(".mobile-navigation-shell .primary-navigation");
  await expect(mobileNav.getByText("策略", { exact: true })).toHaveCount(0);
  await expect(mobileNav.locator(".primary-navigation-item")).toHaveText([
    /任务/u,
    /池子/u,
    /钱包/u,
    /日志/u,
    /聊天室/u,
  ]);
  await expect(page.getByRole("link", { name: "管理" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".app-header > .primary-navigation").getByText("策略")).toHaveCount(0);
  const secondContext = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  try {
    await installFixture(secondContext, state);
    const secondPage = await secondContext.newPage();
    await secondPage.goto("/tasks/running");
    const secondNav = secondPage.locator(".app-header > .primary-navigation");
    await expect(secondNav.getByText("策略", { exact: true })).toHaveCount(0);
    await expect(secondNav.locator(".primary-navigation-item")).toHaveText([
      /任务/u,
      /池子/u,
      /钱包/u,
      /日志/u,
      /聊天室/u,
    ]);
  } finally {
    await secondContext.close();
  }
});

test("POOL-07 persists the pool label visibility preference", async ({ context, page }) => {
  const state: FixtureState = { preferences: cloneDefaults(), revision: 0 };
  await installFixture(context, state);
  await page.goto("/settings");

  const poolLabels = page.getByRole("switch", { name: "显示池标签" });
  await expect(poolLabels).toBeChecked();
  await poolLabels.click();
  await expect(poolLabels).not.toBeChecked();
  await expect.poll(() => state.preferences.showPoolLabels).toBe(false);

  await page.reload();
  await expect(poolLabels).not.toBeChecked();
});

test("SET-01 and SET-02 remain non-overlapping and accessible at boundary widths", async ({
  context,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "The settings width matrix runs once.");
  const state: FixtureState = {
    preferences: { ...cloneDefaults(), colorTheme: "custom", customColor: "#0F766E" },
    revision: 2,
  };
  await installFixture(context, state);
  await page.goto("/settings");

  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ height: width === 1024 ? 900 : 844, width });
    await expect(page.getByRole("heading", { level: 2, name: "界面" })).toBeVisible();
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".interface-settings-panel")?.getBoundingClientRect();
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".segmented-control, .color-swatches, .navigation-preference-list",
        ),
      );
      return {
        controlsInsidePanel:
          panel !== undefined &&
          controls.every((control) => {
            const rect = control.getBoundingClientRect();
            return rect.left >= panel.left - 0.5 && rect.right <= panel.right + 0.5;
          }),
        rootOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(metrics.rootOverflow, `${width}px root overflow`).toBe(false);
    expect(metrics.controlsInsidePanel, `${width}px settings control overflow`).toBe(true);
    await expectNoSeriousAxeViolations(page);
  }

  const walletRow = page.getByRole("listitem").filter({ hasText: "钱包" });
  await walletRow.focus();
  expect(await walletRow.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
    "none",
  );
});

test("SHELL-02 renders real fixture values on desktop and compact stable badges on mobile", async ({
  context,
  page,
}, testInfo) => {
  const state: FixtureState = { preferences: cloneDefaults(), revision: 0 };
  await installPersistentStatsStream(page);
  await installFixture(context, state);
  await page.goto("/tasks/running");
  const statusBar = page.getByRole("contentinfo", { name: "实时状态" });
  await expect(statusBar).toBeVisible();
  if (testInfo.project.name === "chromium-mobile") {
    await expect(
      page.locator(".mobile-navigation-shell .nav-badge-slot").filter({ hasText: "1" }).first(),
    ).toBeVisible();
  } else {
    await expect(statusBar).toContainText("在线");
    await expect(statusBar).toContainText("Base 0.006");
    await expect(statusBar).toContainText("ETH 0.232");
    await expect(statusBar).toContainText("FPS 60");
    await expect(statusBar).toContainText("PING 84ms");
    await expect(
      page.locator(".app-header .nav-badge-slot").filter({ hasText: "1" }).first(),
    ).toBeVisible();
  }
});

test("P01-06 settings visual contract matches the observed responsive interface", async ({
  context,
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  const state: FixtureState = {
    preferences: { ...cloneDefaults(), colorTheme: "teal", theme: "light" },
    revision: 3,
  };
  await installFixture(context, state);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 2, name: "界面" })).toBeVisible();
  await waitForWordmarkImage(page);
  const masks = [
    page.locator("[data-visual-mask='account']"),
    page.locator("[data-visual-mask='stats']"),
    page.locator("[data-visual-mask='login-wallets']"),
  ];
  await expect(page).toHaveScreenshot("settings-light.png", {
    animations: "disabled",
    caret: "hide",
    mask: masks,
    maxDiffPixels: 60,
  });
  if (captureP0106Evidence) {
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      mask: masks,
      path: `artifacts/acceptance/P01-06/visual/settings-light-${testInfo.project.name}-actual.png`,
    });
  }

  state.preferences = {
    ...state.preferences,
    colorTheme: "custom",
    customColor: "#0F766E",
    theme: "dark",
  };
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await waitForWordmarkImage(page);
  await expect(page).toHaveScreenshot("settings-dark.png", {
    animations: "disabled",
    caret: "hide",
    mask: masks,
    maxDiffPixels: 60,
  });
  if (captureP0106Evidence) {
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      mask: masks,
      path: `artifacts/acceptance/P01-06/visual/settings-dark-${testInfo.project.name}-actual.png`,
    });
  }
});
