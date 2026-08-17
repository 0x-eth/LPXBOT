import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

interface ConditionFixture {
  enabled: boolean;
  id: "volumeUsd" | "feesUsd" | "feeTvlRatio" | "tvlUsd" | "transactionCount" | "metricVersion";
  operator: "eq" | "gte" | "lte";
  value: string;
}

interface MonitorFixture {
  conditions: ConditionFixture[];
  createdAt: string;
  disabledAt: string | null;
  enabled: boolean;
  enabledAt: string | null;
  excludeHanToken: boolean;
  excludeHook: boolean;
  monitorId: string;
  name: string;
  poolKey: string;
  revision: number;
  updatedAt: string;
  userId: string;
  windowMinutes: number;
}

interface MonitorRouteState {
  conflictNext: boolean;
  createCalls: number;
  delayMs: number;
  enabledCount?: number;
  failList: boolean;
  items: MonitorFixture[];
  totalCount?: number;
}

const userId = "30000000-0000-4000-8000-000000000302";
const poolKey = `56:0x${"1".repeat(40)}`;
const secondPoolKey = `56:0x${"2".repeat(40)}`;
const timestamp = "2026-08-17T10:00:00.000Z";

function monitor(
  monitorId: string,
  name: string,
  pool: string,
  conditions: ConditionFixture[] = [
    { enabled: true, id: "volumeUsd", operator: "gte", value: "1000" },
  ],
): MonitorFixture {
  return {
    conditions,
    createdAt: timestamp,
    disabledAt: timestamp,
    enabled: false,
    enabledAt: null,
    excludeHanToken: true,
    excludeHook: true,
    monitorId,
    name,
    poolKey: pool,
    revision: 1,
    updatedAt: timestamp,
    userId,
    windowMinutes: 5,
  };
}

function envelope(data: unknown) {
  return { data, requestId: "p03-02-e2e", success: true };
}

function errorEnvelope(code: string, retryable: boolean) {
  return {
    error: { code, message: code, requestId: "p03-02-e2e-error", retryable },
    success: false,
  };
}

async function monitorRoute(route: Route, state: MonitorRouteState): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const segments = url.pathname.split("/").filter(Boolean);
  const monitorId = segments[2];
  const action = segments[3];

  if (url.pathname === "/api/monitors" && request.method() === "GET") {
    if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    if (state.failList) {
      await route.fulfill({
        contentType: "application/json",
        json: errorEnvelope("SERVICE_UNAVAILABLE", true),
        status: 503,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: envelope({
        enabledCount:
          state.enabledCount ?? state.items.filter(({ enabled }) => enabled).length,
        items: structuredClone(state.items),
        nextCursor: null,
        totalCount: state.totalCount ?? state.items.length,
      }),
    });
    return;
  }

  if (url.pathname === "/api/monitors" && request.method() === "POST") {
    state.createCalls += 1;
    const body = request.postDataJSON() as Omit<
      MonitorFixture,
      | "createdAt"
      | "disabledAt"
      | "enabled"
      | "enabledAt"
      | "monitorId"
      | "revision"
      | "updatedAt"
      | "userId"
    >;
    const created = monitor(
      `30000000-0000-4000-8000-${String(32 + state.createCalls).padStart(12, "0")}`,
      body.name,
      body.poolKey,
      body.conditions,
    );
    Object.assign(created, {
      excludeHanToken: body.excludeHanToken,
      excludeHook: body.excludeHook,
      windowMinutes: body.windowMinutes,
    });
    state.items.unshift(created);
    await route.fulfill({ contentType: "application/json", json: envelope(created), status: 201 });
    return;
  }

  const index = state.items.findIndex((item) => item.monitorId === monitorId);
  if (index < 0) {
    await route.fulfill({
      contentType: "application/json",
      json: errorEnvelope("MONITOR_NOT_FOUND", false),
      status: 404,
    });
    return;
  }
  const current = state.items[index]!;

  if (request.method() === "PATCH") {
    const body = request.postDataJSON() as {
      changes: Partial<MonitorFixture>;
      expectedRevision: number;
    };
    if (state.conflictNext || body.expectedRevision !== current.revision) {
      state.conflictNext = false;
      Object.assign(current, {
        name: "权威更新",
        revision: current.revision + 1,
        updatedAt: timestamp,
      });
      await route.fulfill({
        contentType: "application/json",
        json: {
          ...errorEnvelope("REVISION_CONFLICT", true),
          current: structuredClone(current),
        },
        status: 409,
      });
      return;
    }
    Object.assign(current, body.changes, {
      revision: current.revision + 1,
      updatedAt: timestamp,
    });
    await route.fulfill({ contentType: "application/json", json: envelope(current) });
    return;
  }

  if (request.method() === "POST" && (action === "enable" || action === "disable")) {
    if (action === "enable" && !current.conditions.some(({ enabled }) => enabled)) {
      await route.fulfill({
        contentType: "application/json",
        json: errorEnvelope("MONITOR_NOT_READY", false),
        status: 422,
      });
      return;
    }
    const enabled = action === "enable";
    Object.assign(current, {
      disabledAt: enabled ? current.disabledAt : timestamp,
      enabled,
      enabledAt: enabled ? timestamp : current.enabledAt,
      revision: current.revision + 1,
      updatedAt: timestamp,
    });
    await route.fulfill({ contentType: "application/json", json: envelope(current) });
    return;
  }

  if (request.method() === "DELETE") {
    state.items.splice(index, 1);
    await route.fulfill({ status: 204 });
    return;
  }

  await route.abort("failed");
}

async function installApplicationFixture(page: Page, state: MonitorRouteState): Promise<void> {
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
            displayName: "P03-02 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId,
          },
        },
        requestId: "p03-02-auth",
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
        requestId: "p03-02-preferences",
        success: true,
      },
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
  await page.route("**/api/stats/stream**", (route) =>
    route.fulfill({ contentType: "application/json", json: {}, status: 503 }),
  );
  await page.route("**/api/monitors**", (route) => monitorRoute(route, state));
}

function routeState(items: MonitorFixture[] = []): MonitorRouteState {
  return { conflictNext: false, createCalls: 0, delayMs: 0, failList: false, items };
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

test("MON-01 creates a disabled BSC monitor from loading and empty states", async ({
  page,
}, testInfo) => {
  const state = routeState();
  state.delayMs = 700;
  await installApplicationFixture(page, state);
  await page.goto("/monitors");

  await expect(page).toHaveURL(/\/monitors$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Monitors" })).toBeVisible();
  await expect(page.getByRole("status", { name: "正在加载监控" })).toBeVisible();
  await expect(page.getByText("还没有监控")).toBeVisible();
  await expect(page.getByLabel("0 个已启用，共 0 个监控")).toHaveText("0/0");

  await page.getByRole("button", { name: "新建监控" }).click();
  const editor = page.getByRole("dialog", { name: "新建监控" });
  await expect(editor.getByLabel("监控名称")).toBeFocused();
  await expect(editor.getByRole("option", { name: "active TVL（不可用）" })).toHaveAttribute(
    "disabled",
    "",
  );
  await expect(editor.getByRole("option", { name: "Fee/aTVL（不可用）" })).toHaveAttribute(
    "disabled",
    "",
  );
  await editor.getByLabel("监控名称").fill("BSC 成交量");
  await editor.getByLabel("Pool Key").fill(poolKey);
  await editor.getByLabel("指标 1").selectOption("transactionCount");
  await editor.getByLabel("阈值 1").fill("9007199254740992");
  await expect(editor.getByRole("button", { name: "保存监控" })).toBeDisabled();
  await editor.getByLabel("阈值 1").fill("9007199254740991");
  await expect(editor.getByRole("button", { name: "保存监控" })).toBeEnabled();
  await editor.getByLabel("指标 1").selectOption("volumeUsd");
  await editor.getByLabel("阈值 1").fill("1000.25");
  const windows = editor.getByRole("radiogroup", { name: "评估窗口" });
  await expect(windows.getByRole("radio")).toHaveCount(5);
  await windows.getByRole("radio", { name: "15 分钟" }).click();
  await expect(windows.getByRole("radio", { name: "15 分钟" })).toBeChecked();
  await editor.getByRole("button", { name: "保存监控" }).click();

  await expect(editor).toBeHidden();
  await expect(page.getByRole("article", { name: "监控 BSC 成交量" })).toContainText("已停用");
  await expect(page.getByRole("article", { name: "监控 BSC 成交量" })).toContainText("15 分钟");
  await expect(page.getByLabel("0 个已启用，共 1 个监控")).toHaveText("0/1");
  const lifecycle = page.getByRole("switch", { name: "启用监控 BSC 成交量" });
  await lifecycle.click();
  await expect(page.getByRole("switch", { name: "停用监控 BSC 成交量" })).toBeChecked();
  await expect(page.getByLabel("1 个已启用，共 1 个监控")).toHaveText("1/1");

  await page.getByRole("button", { name: "编辑监控 BSC 成交量" }).click();
  const runningEditor = page.getByRole("dialog", { name: "编辑监控" });
  await runningEditor.getByLabel("启用条件 1").uncheck();
  await expect(runningEditor.getByRole("button", { name: "保存监控" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await expectAccessibleAndContained(page);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P03-02/ui/monitors-ready-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test("MON-02 recovers revision conflicts, not-ready, stale, error, delete focus and keyboard", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Mutation and focus recovery run once.");
  const ready = monitor("30000000-0000-4000-8000-000000000041", "Ready", poolKey);
  const notReady = monitor("30000000-0000-4000-8000-000000000042", "Draft", secondPoolKey, [
    { enabled: false, id: "feesUsd", operator: "gte", value: "25" },
  ]);
  const state = routeState([ready, notReady]);
  await installApplicationFixture(page, state);
  await page.goto("/monitors");

  await expect(page.getByText("未就绪", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "启用监控 Draft" })).toBeDisabled();
  const edit = page.getByRole("button", { name: "编辑监控 Ready" });
  await edit.click();
  let editor = page.getByRole("dialog", { name: "编辑监控" });
  await expect(editor.getByLabel("Pool Key")).toBeDisabled();
  state.conflictNext = true;
  await editor.getByLabel("监控名称").fill("Lost update");
  await editor.getByRole("button", { name: "保存监控" }).click();
  await expect(editor.getByRole("alert")).toContainText("其他会话已更新");
  await expect(editor.getByLabel("监控名称")).toHaveValue("Lost update");
  await expect(editor.getByRole("button", { name: "采用最新版本" })).toBeVisible();
  await editor.getByLabel("监控名称").fill("Recovered");
  await editor.getByRole("button", { name: "保存监控" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: "编辑监控 Recovered" })).toBeFocused();

  const remove = page.getByRole("button", { name: "删除监控 Recovered" });
  await remove.click();
  const confirmation = page.getByRole("alertdialog", { name: "删除监控" });
  await expect(confirmation.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await remove.click();
  await confirmation.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("article", { name: "监控 Recovered" })).toHaveCount(0);

  state.failList = true;
  await page.getByRole("button", { name: "刷新监控" }).click();
  await expect(page.getByRole("alert")).toContainText("显示的是上次加载的数据");
  await expect(page.locator("main[data-monitor-state='stale']")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("加载监控失败");
  state.failList = false;
  await page.getByRole("button", { name: "重试加载监控" }).click();
  await expect(page.getByRole("article", { name: "监控 Draft" })).toBeVisible();
  await expectAccessibleAndContained(page);

  await page.getByRole("button", { name: "新建监控" }).focus();
  await page.keyboard.press("Enter");
  editor = page.getByRole("dialog", { name: "新建监控" });
  await expect(editor.getByLabel("监控名称")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "新建监控" })).toBeFocused();
});

test("MON-01 preserves enabled and total aggregates beyond the current page", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Aggregate mutation runs once.");
  const row = monitor("30000000-0000-4000-8000-000000000043", "Paged", poolKey);
  const state = routeState([row]);
  state.enabledCount = 5;
  state.totalCount = 7;
  await installApplicationFixture(page, state);
  await page.goto("/monitors");

  await expect(page.getByLabel("5 个已启用，共 7 个监控")).toHaveText("5/7");
  await page.getByRole("switch", { name: "启用监控 Paged" }).click();
  await expect(page.getByLabel("6 个已启用，共 7 个监控")).toHaveText("6/7");
  await page.getByRole("switch", { name: "停用监控 Paged" }).click();
  await expect(page.getByLabel("5 个已启用，共 7 个监控")).toHaveText("5/7");

  await page.getByRole("button", { name: "删除监控 Paged" }).click();
  await page.getByRole("alertdialog", { name: "删除监控" }).getByRole("button", {
    name: "确认删除",
  }).click();
  await expect(page.getByLabel("5 个已启用，共 6 个监控")).toHaveText("5/6");
});

test("MON-03 consumes create-monitor intent as poolKey prefill without persistence", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Pool intent navigation runs once.");
  const state = routeState();
  await installApplicationFixture(page, state);
  await page.goto("/pools?fixture=pools-ready");
  const row = page
    .getByRole("table", { name: "BSC 热门池" })
    .locator("tbody > tr")
    .filter({ hasText: "0x1111111111111111111111111111111111111111" });
  await row.getByRole("button", { name: /更多池操作/u }).click();
  await page.getByRole("menuitem", { name: "创建监控" }).click();

  await expect(page).toHaveURL(/\/monitors$/u);
  const editor = page.getByRole("dialog", { name: "新建监控" });
  await expect(editor.getByLabel("Pool Key")).toHaveValue(poolKey);
  await expect(page.getByLabel("0 个已启用，共 0 个监控")).toHaveText("0/0");
  expect(state.createCalls).toBe(0);
  await expectAccessibleAndContained(page);
});
