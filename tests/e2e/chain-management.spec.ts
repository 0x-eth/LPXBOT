import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

type Role = "user" | "pro" | "admin";
type Access = "off" | "pro" | "all";

interface ChainFixture {
  access: Access;
  activePositionCount: number | null;
  chainId: number;
  configurationComplete: boolean;
  displayName: string;
  isDefault: boolean;
  missingConfiguration: string[];
  previousAccess: Access | null;
  reason: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

interface FixtureState {
  conflictNext?: boolean;
  getSequence?: Array<"data" | "empty" | "error">;
  posts: unknown[];
  saveDelayMs?: number;
}

const chains: ChainFixture[] = [
  {
    access: "all",
    activePositionCount: 2,
    chainId: 56,
    configurationComplete: true,
    displayName: "BNB Smart Chain",
    isDefault: true,
    missingConfiguration: [],
    previousAccess: null,
    reason: "Local fixture seed",
    revision: 1,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "local-fixture-seed",
  },
  {
    access: "pro",
    activePositionCount: null,
    chainId: 8453,
    configurationComplete: true,
    displayName: "Base",
    isDefault: false,
    missingConfiguration: [],
    previousAccess: null,
    reason: "Local fixture seed",
    revision: 1,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "local-fixture-seed",
  },
  {
    access: "off",
    activePositionCount: null,
    chainId: 1,
    configurationComplete: true,
    displayName: "Ethereum",
    isDefault: false,
    missingConfiguration: [],
    previousAccess: null,
    reason: "Local fixture seed",
    revision: 1,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "local-fixture-seed",
  },
  {
    access: "off",
    activePositionCount: null,
    chainId: 4663,
    configurationComplete: false,
    displayName: "Robinhood Chain",
    isDefault: false,
    missingConfiguration: ["execution-adapter"],
    previousAccess: null,
    reason: "Local fixture seed",
    revision: 1,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "local-fixture-seed",
  },
  {
    access: "off",
    activePositionCount: null,
    chainId: 196,
    configurationComplete: false,
    displayName: "X Layer",
    isDefault: false,
    missingConfiguration: ["execution-adapter"],
    previousAccess: null,
    reason: "Local fixture seed",
    revision: 1,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "local-fixture-seed",
  },
];

function session(role: Role) {
  return {
    allowedChainIds: role === "user" ? [56] : [56, 8453],
    avatarUrl: null,
    displayName: `Fixture ${role}`,
    maintenanceBypass: false,
    role,
    tier: role === "pro" ? "pro" : "normal",
    userId: `30000000-0000-4000-8000-00000000000${role === "user" ? "1" : role === "pro" ? "2" : "3"}`,
  };
}

async function fulfillJson(route: Route, status: number, json: unknown, delayMs = 0) {
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  await route.fulfill({
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    json,
    status,
  });
}

async function installFixture(
  context: BrowserContext,
  role: Role,
  state: FixtureState = { posts: [] },
) {
  const mutableChains = structuredClone(chains);
  await context.route("**/api/auth/me", (route) =>
    fulfillJson(route, 200, {
      data: { isAdmin: role === "admin", maintenance: null, user: session(role) },
      requestId: "req-chain-ui-auth",
      success: true,
    }),
  );
  await context.route("**/api/user/preferences", (route) =>
    fulfillJson(route, 200, {
      data: {
        preferences: {
          colorTheme: "teal",
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
        revision: 1,
        schemaVersion: 5,
        updatedAt: "2026-08-15T00:00:00.000Z",
      },
      requestId: "req-chain-ui-preferences",
      success: true,
    }),
  );
  await context.route("**/api/auth/wallet/links", (route) =>
    fulfillJson(route, 200, {
      data: { links: [] },
      requestId: "req-chain-ui-wallets",
      success: true,
    }),
  );
  await context.route("**/api/stats", (route) =>
    fulfillJson(route, 200, {
      data: {
        observedAt: "2026-08-15T00:00:00.000Z",
        sequence: 1,
        stats: {
          fps: null,
          gas: { baseGwei: null, ethereumGwei: null },
          online: true,
          pingMs: null,
          recommendedPools: null,
          taskCounts: { paused: null, running: null, stopped: null },
        },
      },
      requestId: "req-chain-ui-stats",
      success: true,
    }),
  );
  await context.route("**/api/stats/stream", (route) =>
    route.fulfill({
      body: "",
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
      status: 200,
    }),
  );
  await context.route("**/api/system-config/chains", async (route) => {
    if (route.request().method() === "GET") {
      const next = state.getSequence?.shift() ?? "data";
      if (next === "error") {
        await fulfillJson(
          route,
          500,
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "PRIVATE_CHAIN_CONFIGURATION_VALUE",
              requestId: "req-chain-ui-error",
              retryable: true,
            },
            success: false,
          },
          200,
        );
        return;
      }
      await fulfillJson(
        route,
        200,
        {
          data: { chains: next === "empty" ? [] : mutableChains },
          requestId: "req-chain-ui-get",
          success: true,
        },
        200,
      );
      return;
    }

    if (role !== "admin") {
      await fulfillJson(route, 403, {
        error: {
          code: "FORBIDDEN",
          message: "Administrator access is required",
          requestId: "req-chain-ui-forbidden",
          retryable: false,
        },
        success: false,
      });
      return;
    }
    const body = route.request().postDataJSON() as {
      access: Record<string, Access>;
      expectedRevision: Record<string, number>;
      reason: string;
    };
    state.posts.push(structuredClone(body));
    if (state.conflictNext) {
      state.conflictNext = false;
      await fulfillJson(
        route,
        409,
        {
          error: {
            code: "CONFIG_CONFLICT",
            message: "PRIVATE_CONFLICT_DETAIL",
            requestId: "req-chain-ui-conflict",
            retryable: true,
          },
          success: false,
        },
        state.saveDelayMs,
      );
      return;
    }
    for (const [chainIdText, access] of Object.entries(body.access)) {
      const chain = mutableChains.find(({ chainId }) => chainId === Number(chainIdText))!;
      chain.previousAccess = chain.access;
      chain.access = access;
      chain.reason = body.reason;
      chain.revision += 1;
      chain.updatedAt = "2026-08-15T02:05:00.000Z";
      chain.updatedBy = session(role).userId;
    }
    await fulfillJson(
      route,
      200,
      {
        data: { chains: mutableChains, status: "updated" },
        requestId: "req-chain-ui-saved",
        success: true,
      },
      state.saveDelayMs,
    );
  });
  return mutableChains;
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

for (const role of ["user", "pro"] as const) {
  test(`AUTH-10 ${role} does not render chain management and direct writes remain forbidden`, async ({
    context,
    page,
  }) => {
    await installFixture(context, role);
    await page.goto("/settings");
    await expect(page.getByText("站点运营", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "链管理" })).toHaveCount(0);
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/system-config/chains", {
        body: JSON.stringify({
          access: { "56": "pro" },
          expectedRevision: { "56": 1 },
          reason: "Attempted browser elevation",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return response.status;
    });
    expect(status).toBe(403);
  });
}

test("AUTH-10 admin dialog covers loading, error, retry and empty states", async ({
  context,
  page,
}) => {
  const state: FixtureState = { getSequence: ["error", "empty", "data"], posts: [] };
  await installFixture(context, "admin", state);
  await page.goto("/settings");
  const trigger = page.getByRole("button", { name: "链管理" });
  await trigger.click();
  await expect(page.getByRole("status")).toContainText("正在加载链配置");
  await expect(page.getByRole("alert")).toContainText("链配置加载失败");
  await expect(page.getByText("PRIVATE_CHAIN_CONFIGURATION_VALUE")).toHaveCount(0);
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByRole("status")).toContainText("暂无链配置");
  await page.getByRole("button", { name: "关闭链管理" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByText("BNB Smart Chain", { exact: true })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

test("AUTH-10 admin previews, confirms, resolves conflict, saves and rolls back", async ({
  context,
  page,
}, testInfo) => {
  const state: FixtureState = { conflictNext: true, posts: [], saveDelayMs: 250 };
  await installFixture(context, "admin", state);
  await page.goto("/settings");
  const trigger = page.getByRole("button", { name: "链管理" });
  await expect(page.getByText("站点运营", { exact: true })).toBeVisible();
  await trigger.click();

  await expect(page.getByRole("dialog", { name: "链管理" })).toBeVisible();
  await expect(page.getByText("关闭：所有人不能新建，已有仓位仍可监控和撤池")).toBeVisible();
  await expect(page.getByText("Pro：仅 Pro 和管理员可新建")).toBeVisible();
  await expect(page.getByText("全部：所有已授权用户可新建")).toBeVisible();
  const bsc = page.getByRole("group", { name: "BNB Smart Chain 链访问" });
  await expect(bsc.getByText("主链", { exact: true })).toBeVisible();
  await expect(bsc.getByText("2 个活动仓位", { exact: true })).toBeVisible();
  const base = page.getByRole("group", { name: "Base 链访问" });
  await expect(base.getByText("活动仓位不可用", { exact: true })).toBeVisible();
  const incomplete = page.getByRole("group", { name: "Robinhood Chain 链访问" });
  await expect(incomplete.getByText("配置不完整", { exact: true })).toBeVisible();
  await expect(incomplete.getByRole("radio", { name: "Pro" })).toBeDisabled();
  await expect(bsc.getByRole("radio", { name: "关闭" })).toBeDisabled();

  const all = bsc.getByRole("radio", { name: "全部" });
  await all.focus();
  await all.press("ArrowLeft");
  await expect(bsc.getByRole("radio", { name: "Pro" })).toBeChecked();
  await expect(page.getByText("BNB Smart Chain：全部 → Pro")).toBeVisible();
  await page.getByLabel("变更原因").fill("Local all to pro drill");
  const save = page.getByRole("button", { name: "保存链配置" });
  await save.click();
  await expect(page.getByRole("alertdialog", { name: "确认链配置变更" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused();
  await page.getByRole("button", { name: "确认保存" }).click();
  await expect(page.getByRole("status")).toContainText("正在保存链配置");
  await expect(page.getByRole("alert")).toContainText("配置已被其他会话更新，请重新加载");
  await expect(page.getByText("PRIVATE_CONFLICT_DETAIL")).toHaveCount(0);
  await page.getByRole("button", { name: "重新加载" }).click();

  const reloadedBsc = page.getByRole("group", { name: "BNB Smart Chain 链访问" });
  await reloadedBsc.getByRole("radio", { name: "Pro" }).click();
  await page.getByLabel("变更原因").fill("Local all to pro drill");
  await page.getByRole("button", { name: "保存链配置" }).click();
  await page.getByRole("button", { name: "确认保存" }).click();
  await expect(page.getByRole("status")).toContainText("链配置已保存");
  await expect(reloadedBsc.getByRole("radio", { name: "Pro" })).toBeChecked();

  await page.getByRole("button", { name: "恢复 BNB Smart Chain 上一版本" }).click();
  await expect(page.getByText("BNB Smart Chain：Pro → 全部")).toBeVisible();
  await page.getByLabel("变更原因").fill("Local rollback drill");
  await page.getByRole("button", { name: "保存链配置" }).click();
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused();
  await page.getByRole("button", { name: "确认保存" }).click();
  await expect(page.getByRole("status")).toContainText("链配置已保存");
  await expect(reloadedBsc.getByRole("radio", { name: "全部" })).toBeChecked();

  expect(state.posts).toHaveLength(3);
  for (const post of state.posts as Array<Record<string, unknown>>) {
    expect(Object.keys(post).sort()).toEqual(["access", "expectedRevision", "reason"]);
    expect(post).not.toHaveProperty("actor");
    expect(post).not.toHaveProperty("userId");
  }
  await expectNoSeriousAxeViolations(page);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    path: `artifacts/acceptance/P01-07/ui/chain-management-${testInfo.project.name}.png`,
  });

  await page.setViewportSize({ height: 844, width: 320 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "关闭链管理" }).click();
  await expect(trigger).toBeFocused();
});
