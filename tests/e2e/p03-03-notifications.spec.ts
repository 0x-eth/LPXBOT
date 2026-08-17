import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type NotificationCategory =
  | "feedback-replied"
  | "monitor-match"
  | "operation-failed"
  | "position-closed"
  | "position-moved"
  | "task-created";

interface DestinationFixture {
  categories: NotificationCategory[];
  config:
    | {
        secretConfigured: boolean;
        secretRef: string | null;
        telegramIdentityId: string;
        template: string;
      }
    | {
        method: "GET" | "POST";
        secretConfigured: boolean;
        secretRef: string | null;
        template: unknown;
        url: string;
      };
  createdAt: string;
  destinationId: string;
  enabled: boolean;
  name: string;
  revision: number;
  type: "telegram" | "webhook";
  updatedAt: string;
  userId: string;
}

interface NotificationRouteState {
  auditWrites: number;
  conflictNext: boolean;
  delayMs: number;
  destinationWrites: number;
  destinations: DestinationFixture[];
  failLoad: boolean;
  historyWrites: number;
  outboxWrites: number;
  preferenceRevision: number;
  preferences: Record<NotificationCategory, boolean>;
  testCalls: number;
}

const userId = "35000000-0000-4000-8000-000000000001";
const telegramIdentityId = "700000000001";
const timestamp = "2026-08-18T01:30:00.000Z";
const categories: NotificationCategory[] = [
  "monitor-match",
  "task-created",
  "position-moved",
  "operation-failed",
  "position-closed",
  "feedback-replied",
];

function webhookDestination(overrides: Partial<DestinationFixture> = {}): DestinationFixture {
  return {
    categories: ["monitor-match"],
    config: {
      method: "POST",
      secretConfigured: true,
      secretRef: "secretref://notification/e2e-existing",
      template: { message: "{{monitor.name}}" },
      url: "https://hooks.example.test/existing",
    },
    createdAt: timestamp,
    destinationId: "35000000-0000-4000-8000-000000000011",
    enabled: false,
    name: "Existing webhook",
    revision: 1,
    type: "webhook",
    updatedAt: timestamp,
    userId,
    ...overrides,
  };
}

function envelope(data: unknown) {
  return { data, requestId: "p03-03-e2e", success: true };
}

function errorEnvelope(code: string, retryable: boolean) {
  return {
    error: { code, message: code, requestId: "p03-03-e2e-error", retryable },
    success: false,
  };
}

function routeState(): NotificationRouteState {
  return {
    auditWrites: 0,
    conflictNext: false,
    delayMs: 0,
    destinationWrites: 0,
    destinations: [],
    failLoad: false,
    historyWrites: 0,
    outboxWrites: 0,
    preferenceRevision: 0,
    preferences: Object.fromEntries(categories.map((category) => [category, false])) as Record<
      NotificationCategory,
      boolean
    >,
    testCalls: 0,
  };
}

async function notificationRoute(route: Route, state: NotificationRouteState): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (request.method() === "GET" && state.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, state.delayMs));
  }
  if (request.method() === "GET" && state.failLoad) {
    await route.fulfill({
      contentType: "application/json",
      json: errorEnvelope("SERVICE_UNAVAILABLE", true),
      status: 503,
    });
    return;
  }
  if (path === "/api/notification-preferences") {
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          categories: structuredClone(state.preferences),
          revision: state.preferenceRevision,
          updatedAt: state.preferenceRevision === 0 ? null : timestamp,
        }),
      });
      return;
    }
    const body = request.postDataJSON() as {
      categories: Partial<Record<NotificationCategory, boolean>>;
      expectedRevision: number;
    };
    if (body.expectedRevision !== state.preferenceRevision) {
      await route.fulfill({
        contentType: "application/json",
        json: { ...errorEnvelope("REVISION_CONFLICT", true), current: state.preferences },
        status: 409,
      });
      return;
    }
    Object.assign(state.preferences, body.categories);
    state.preferenceRevision += 1;
    await route.fulfill({
      contentType: "application/json",
      json: envelope({
        categories: structuredClone(state.preferences),
        revision: state.preferenceRevision,
        updatedAt: timestamp,
      }),
    });
    return;
  }
  if (path === "/api/notification-destinations/options") {
    await route.fulfill({
      contentType: "application/json",
      json: envelope({ telegramIdentityId }),
    });
    return;
  }
  if (path === "/api/notification-destinations/test") {
    state.testCalls += 1;
    const body = request.postDataJSON() as { type: "telegram" | "webhook" };
    await route.fulfill({
      contentType: "application/json",
      json: envelope(
        body.type === "telegram"
          ? {
              destinationType: "telegram",
              networkCalls: 0,
              rendered: { message: "<b>Local fixture monitor</b>", parseMode: "HTML" },
              signed: false,
              sink: "local-sink://p03-01",
            }
          : {
              destinationType: "webhook",
              networkCalls: 0,
              rendered: { body: '{"message":"Local fixture monitor"}', method: "POST" },
              signed: true,
              sink: "local-sink://p03-01",
            },
      ),
    });
    return;
  }
  if (path === "/api/notification-destinations" && request.method() === "GET") {
    await route.fulfill({
      contentType: "application/json",
      json: envelope(structuredClone(state.destinations)),
    });
    return;
  }
  if (path === "/api/notification-destinations" && request.method() === "POST") {
    const body = request.postDataJSON() as {
      categories: NotificationCategory[];
      config:
        | { botToken: string; telegramIdentityId: string; template: string }
        | { method: "GET" | "POST"; signingSecret?: string; template: unknown; url: string };
      enabled: boolean;
      name: string;
      type: "telegram" | "webhook";
    };
    const created: DestinationFixture = {
      categories: body.categories,
      config:
        body.type === "telegram"
          ? {
              secretConfigured: true,
              secretRef: "secretref://notification/e2e-telegram",
              telegramIdentityId: body.config.telegramIdentityId,
              template: body.config.template,
            }
          : {
              method: body.config.method,
              secretConfigured: body.config.signingSecret !== undefined,
              secretRef:
                body.config.signingSecret === undefined
                  ? null
                  : "secretref://notification/e2e-1",
              template: body.config.template,
              url: body.config.url,
            },
      createdAt: timestamp,
      destinationId: "35000000-0000-4000-8000-000000000010",
      enabled: body.enabled,
      name: body.name,
      revision: 1,
      type: body.type,
      updatedAt: timestamp,
      userId,
    };
    state.destinations.unshift(created);
    state.destinationWrites += 1;
    await route.fulfill({ contentType: "application/json", json: envelope(created), status: 201 });
    return;
  }
  const destinationId = path.split("/").at(-1);
  const destination = state.destinations.find((item) => item.destinationId === destinationId);
  if (!destination) {
    await route.fulfill({
      contentType: "application/json",
      json: errorEnvelope("DESTINATION_NOT_FOUND", false),
      status: 404,
    });
    return;
  }
  if (request.method() === "PATCH") {
    const body = request.postDataJSON() as {
      changes: Partial<Pick<DestinationFixture, "enabled" | "name">>;
      expectedRevision: number;
    };
    if (state.conflictNext || body.expectedRevision !== destination.revision) {
      state.conflictNext = false;
      Object.assign(destination, { name: "权威目的地", revision: destination.revision + 1 });
      await route.fulfill({
        contentType: "application/json",
        json: { ...errorEnvelope("REVISION_CONFLICT", true), current: destination },
        status: 409,
      });
      return;
    }
    Object.assign(destination, body.changes, { revision: destination.revision + 1 });
    state.destinationWrites += 1;
    await route.fulfill({ contentType: "application/json", json: envelope(destination) });
    return;
  }
  if (request.method() === "DELETE") {
    state.destinations = state.destinations.filter((item) => item.destinationId !== destinationId);
    state.destinationWrites += 1;
    await route.fulfill({ status: 204 });
    return;
  }
  await route.abort("failed");
}

async function installApplicationFixture(page: Page, state: NotificationRouteState): Promise<void> {
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
            displayName: "P03-03 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId,
          },
        },
        requestId: "p03-03-auth",
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
            theme: "light",
          },
          revision: 0,
          schemaVersion: 5,
          updatedAt: null,
        },
        requestId: "p03-03-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({ contentType: "application/json", json: envelope({ links: [] }) }),
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
  await page.route("**/api/notification-**", (route) => notificationRoute(route, state));
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

test("MON-04 and NOTIFY-01/02 manage preferences and a local-sink Webhook without side effects", async ({
  page,
}) => {
  const state = routeState();
  state.delayMs = 600;
  await installApplicationFixture(page, state);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { level: 2, name: "通知" })).toBeVisible();
  await expect(page.getByRole("status", { name: "通知设置状态" })).toContainText("正在加载");
  await expect(page.getByRole("switch", { name: "监控匹配通知" })).toBeDisabled();
  await expect(page.getByText("还没有通知目的地")).toBeVisible();

  const monitorMatches = page.getByRole("switch", { name: "监控匹配通知" });
  await expect(monitorMatches).not.toBeChecked();
  await monitorMatches.click();
  await expect(monitorMatches).toBeChecked();

  const add = page.getByRole("button", { name: "添加目的地" });
  await add.click();
  const editor = page.getByRole("dialog", { name: "添加通知目的地" });
  await expect(editor.getByLabel("目的地名称")).toBeFocused();
  await editor.getByLabel("目的地名称").fill("Operations webhook");
  await editor.getByRole("radio", { name: "Webhook" }).click();
  await editor.getByRole("radio", { name: "POST" }).click();
  await editor.getByLabel("Webhook URL").fill("https://hooks.example.test/lpx");
  await editor.getByLabel("请求模板").fill('{"message":"{{monitor.name}}"}');
  await editor.getByLabel("签名密钥").fill("fixture-signing-secret-material-0001");

  await editor.getByRole("button", { name: "本地测试" }).click();
  await expect(editor.getByRole("status", { name: "本地测试结果" })).toContainText(
    "local-sink://p03-01",
  );
  expect(state.testCalls).toBe(1);
  expect(state.destinationWrites).toBe(0);
  expect(state.outboxWrites).toBe(0);
  expect(state.historyWrites).toBe(0);
  expect(state.auditWrites).toBe(0);
  expect(state.destinations).toEqual([]);

  await editor.getByRole("button", { name: "保存目的地" }).click();
  await expect(editor).toBeHidden();
  const row = page.getByRole("article", { name: "目的地 Operations webhook" });
  await expect(row).toContainText("Webhook");
  await expect(row).toContainText("已配置签名");
  await expect(page.getByText("fixture-signing-secret-material-0001")).toHaveCount(0);
  await row.getByRole("switch", { name: "停用目的地 Operations webhook" }).click();
  await expect(row.getByRole("switch", { name: "启用目的地 Operations webhook" })).not.toBeChecked();
  await expectAccessibleAndContained(page);
});

test("MON-04 recovers errors and destination conflicts while preserving keyboard focus and drafts", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Conflict and focus run once.");
  const state = routeState();
  state.destinations = [webhookDestination()];
  state.failLoad = true;
  await installApplicationFixture(page, state);
  await page.goto("/settings");

  await expect(page.getByRole("alert").filter({ hasText: "通知配置暂时不可用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加目的地" })).toBeDisabled();
  state.failLoad = false;
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("article", { name: "目的地 Existing webhook" })).toBeVisible();

  const add = page.getByRole("button", { name: "添加目的地" });
  await add.click();
  let editor = page.getByRole("dialog", { name: "添加通知目的地" });
  const telegram = editor.getByRole("radio", { name: "Telegram" });
  await expect(telegram).toBeEnabled();
  await telegram.click();
  const identity = editor.getByLabel("Telegram identity");
  await expect(identity).toBeDisabled();
  await expect(identity.locator("option")).toHaveCount(1);
  await expect(identity).toHaveValue(telegramIdentityId);
  await editor.getByLabel("目的地名称").fill("Telegram alerts");
  await editor.getByLabel("Bot token（仅写入）").fill("fixture-bot-token-material-000001");
  await editor.getByLabel("请求模板").fill("{{internal.secret}}");
  await expect(editor.getByRole("alert").filter({ hasText: "模板变量无效" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "保存目的地" })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "本地测试" })).toBeDisabled();
  await editor.press("Escape");
  await expect(editor).toBeHidden();
  await expect(add).toBeFocused();

  const row = page.getByRole("article", { name: "目的地 Existing webhook" });
  const edit = row.getByRole("button", { name: "编辑目的地 Existing webhook" });
  await edit.click();
  editor = page.getByRole("dialog", { name: "编辑通知目的地" });
  await editor.getByLabel("目的地名称").fill("Local draft name");
  state.conflictNext = true;
  await editor.getByRole("button", { name: "保存目的地" }).click();
  await expect(editor.getByRole("alert").filter({ hasText: "其他会话已更新" })).toBeVisible();
  await expect(editor.getByLabel("目的地名称")).toHaveValue("Local draft name");
  await editor.getByRole("button", { name: "保存目的地" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("article", { name: "目的地 Local draft name" })).toBeVisible();

  const updated = page.getByRole("article", { name: "目的地 Local draft name" });
  const remove = updated.getByRole("button", { name: "删除目的地 Local draft name" });
  await remove.click();
  const confirmation = page.getByRole("alertdialog", { name: "删除通知目的地" });
  await expect(confirmation.getByRole("button", { name: "取消" })).toBeFocused();
  await confirmation.getByRole("button", { name: "确认删除" }).click();
  await expect(updated).toBeHidden();
  await expect(page.getByText("还没有通知目的地")).toBeVisible();
  await expectAccessibleAndContained(page);
});
