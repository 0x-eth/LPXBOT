import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const userId = "12000000-0000-4000-8000-000000000301";
const poolKey = `56:0x${"1".repeat(40)}`;
const secondPoolKey = `56:0x${"2".repeat(40)}`;
const thirdPoolKey = `56:0x${"3".repeat(64)}`;
const fourthPoolKey = `56:0x${"4".repeat(64)}`;

function attribution(overrides: Record<string, unknown> = {}) {
  return {
    creatorProfile: {
      avatarUrl: null,
      displayName: "Fixture Creator",
      telegramId: "8800301",
    },
    record: {
      chainId: 56,
      completedAt: "2026-08-17T10:00:00.000Z",
      creatorAddress: `0x${"a".repeat(40)}`,
      feePips: "2500",
      operationId: "12000000-0000-4000-8000-000000000001",
      outcome: "created",
      poolKey,
      protocol: "pcsv3",
      schemaVersion: 1,
      txHash: `0x${"b".repeat(64)}`,
      userId,
      ...overrides,
    },
    warning: overrides.outcome === "already_exists" ? "ALREADY_EXISTS_NOT_PLATFORM_FIRST" : null,
  };
}

async function installBase(page: Page, role: "admin" | "user"): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          isAdmin: role === "admin",
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: role === "admin" ? "P02-12 Admin" : "P02-12 User",
            maintenanceBypass: false,
            role,
            tier: "normal",
            userId,
          },
        },
        requestId: "p02-12-auth",
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
        requestId: "p02-12-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/user/pool-blocklist", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          blocklistHash: `sha256:${"0".repeat(64)}`,
          entries: [],
          revision: 0,
          schemaVersion: 1,
          updatedAt: null,
        },
        requestId: "p02-12-blocklist",
        success: true,
      },
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { remarks: [], shared: [] }, requestId: "p02-12-remarks", success: true },
    }),
  );
  await page.route("**/api/stats/stream**", (route) =>
    route.fulfill({ contentType: "application/json", json: {}, status: 503 }),
  );
}

async function seriousAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
}

test("POOL-15 shows personal creation history on desktop and mobile with focus restoration", async ({
  page,
}, testInfo) => {
  await installBase(page, "user");
  await page.route("**/api/pools/create-history?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          items: [
            attribution(),
            attribution({
              completedAt: "2026-08-17T09:00:00.000Z",
              creatorAddress: null,
              operationId: "12000000-0000-4000-8000-000000000002",
              outcome: "already_exists",
              poolKey: secondPoolKey,
              protocol: "univ3",
              txHash: null,
            }),
          ],
          nextCursor: null,
        },
        requestId: "p02-12-history",
        success: true,
      },
    }),
  );
  await page.route("**/api/admin/pool-creators", (route) => route.abort());
  await page.goto("/pools?fixture=pools-ready");

  const trigger = page.getByRole("button", { name: "创建历史" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "创建历史" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("PancakeSwap V3");
  await expect(dialog).toContainText("Uniswap V3");
  await expect(dialog).toContainText("0.25%");
  await expect(dialog).toContainText("创建时池子已存在，可能非本平台首创");
  await expect(dialog.getByRole("link", { name: /查看创建交易/u })).toHaveAttribute(
    "href",
    `https://bscscan.com/tx/0x${"b".repeat(64)}`,
  );
  await expect(dialog.getByRole("button", { name: "关闭创建历史" })).toBeFocused();
  expect(await seriousAxeViolations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    path: `artifacts/acceptance/P02-12/ui/pool-provenance-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
  await dialog.getByRole("button", { name: "关闭创建历史" }).click();
  await expect(trigger).toBeFocused();
});

test("POOL-15 exposes history loading, empty, error and stable pagination states", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Operational states run once.");
  await installBase(page, "user");
  let firstRoute: Route | null = null;
  let calls = 0;
  await page.route("**/api/pools/create-history?**", async (route) => {
    calls += 1;
    if (calls === 1) {
      firstRoute = route;
      return;
    }
    if (calls === 2) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          error: { code: "POOL_PROVENANCE_UNAVAILABLE", retryable: true },
          requestId: "history-error",
          success: false,
        },
        status: 503,
      });
      return;
    }
    if (calls === 3) {
      expect(new URL(route.request().url()).searchParams.get("cursor")).toBeNull();
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: { items: [attribution()], nextCursor: "history-page-2" },
          requestId: "history-first-page",
          success: true,
        },
      });
      return;
    }
    expect(new URL(route.request().url()).searchParams.get("cursor")).toBe("history-page-2");
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          items: [
            attribution({
              completedAt: "2026-08-17T09:00:00.000Z",
              operationId: "12000000-0000-4000-8000-000000000002",
              poolKey: secondPoolKey,
              protocol: "univ3",
            }),
          ],
          nextCursor: null,
        },
        requestId: "history-second-page",
        success: true,
      },
    });
  });
  await page.goto("/pools?fixture=pools-ready");

  const trigger = page.getByRole("button", { name: "创建历史" });
  await trigger.click();
  let dialog = page.getByRole("dialog", { name: "创建历史" });
  await expect(dialog.getByText("正在加载创建历史")).toBeVisible();
  await expect.poll(() => firstRoute !== null).toBe(true);
  await firstRoute!.fulfill({
    contentType: "application/json",
    json: { data: { items: [], nextCursor: null }, requestId: "history-empty", success: true },
  });
  await expect(dialog.getByText("还没有平台创建记录")).toBeVisible();
  await dialog.getByRole("button", { name: "关闭创建历史" }).click();

  await trigger.click();
  dialog = page.getByRole("dialog", { name: "创建历史" });
  await expect(dialog.getByRole("alert")).toContainText("创建历史加载失败");
  await dialog.getByRole("button", { name: "重试创建历史" }).click();
  await expect(dialog.getByText("PancakeSwap V3")).toBeVisible();
  await dialog.getByRole("button", { name: "加载更多创建历史" }).click();
  await expect(dialog.getByText("Uniswap V3")).toBeVisible();
  expect(calls).toBe(4);
});

test("POOL-15 batches visible admin rows once and ordinary users render no creator entry", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "RBAC request count runs once.");
  await installBase(page, "admin");
  let batchCalls = 0;
  await page.route("**/api/pools/create-history?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { items: [], nextCursor: null }, requestId: "history-empty", success: true },
    }),
  );
  await page.route("**/api/admin/pool-creators", async (route) => {
    batchCalls += 1;
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { poolKeys: string[] };
    expect(body.poolKeys).toContain(poolKey);
    expect(body.poolKeys.some((value) => value.length === 69)).toBe(true);
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          results: body.poolKeys.map((identity) => ({
            creator: identity === poolKey ? attribution() : null,
            identity,
          })),
        },
        requestId: "p02-12-batch",
        success: true,
      },
    });
  });
  await page.goto("/pools?fixture=pools-ready");
  const creatorButton = page.getByRole("button", {
    name: `查看池子创建者 0x${"1".repeat(40)}`,
  });
  await expect(creatorButton).toBeVisible();
  expect(batchCalls).toBe(1);
  await creatorButton.click();
  const dialog = page.getByRole("dialog", { name: "池子创建者" });
  await expect(dialog).toContainText("Fixture Creator");
  await expect(dialog).toContainText("TG 8800301");
  await expect(dialog).toContainText(`0x${"a".repeat(40)}`);
  expect(await seriousAxeViolations(page)).toEqual([]);

  const ordinary = await page.context().newPage();
  await installBase(ordinary, "user");
  let ordinaryAdminCalls = 0;
  await ordinary.route("**/api/pools/create-history?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { items: [], nextCursor: null }, requestId: "empty", success: true },
    }),
  );
  await ordinary.route("**/api/admin/pool-creators", (route) => {
    ordinaryAdminCalls += 1;
    return route.abort();
  });
  await ordinary.goto("/pools?fixture=pools-ready");
  await expect(ordinary.getByRole("button", { name: /查看池子创建者/u })).toHaveCount(0);
  expect(ordinaryAdminCalls).toBe(0);
  await ordinary.close();
});

test("POOL-15 renders null, partial, deleted-user, malformed and batch-error admin states", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Admin operational states run once.");
  await installBase(page, "admin");
  await page.route("**/api/pools/create-history?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { items: [], nextCursor: null }, requestId: "history-empty", success: true },
    }),
  );
  let calls = 0;
  await page.route("**/api/admin/pool-creators", async (route) => {
    calls += 1;
    if (calls === 3) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          error: { code: "POOL_PROVENANCE_UNAVAILABLE", retryable: true },
          requestId: "batch-error",
          success: false,
        },
        status: 503,
      });
      return;
    }
    const body = route.request().postDataJSON() as { poolKeys: string[] };
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          results: body.poolKeys.map((identity) => {
            if (identity === poolKey) return { creator: null, identity };
            if (identity === secondPoolKey) {
              return {
                creator: {
                  ...attribution({ poolKey: secondPoolKey, protocol: "univ3" }),
                  creatorProfile: null,
                },
                identity,
              };
            }
            if (identity === thirdPoolKey) {
              return {
                creator: attribution({
                  outcome: "invented",
                  poolKey: thirdPoolKey,
                  protocol: "pcsv4",
                }),
                identity,
              };
            }
            return {
              creator: attribution({
                creatorAddress: null,
                outcome: "already_exists",
                poolKey: fourthPoolKey,
                protocol: "univ4",
                txHash: null,
              }),
              identity,
            };
          }),
        },
        requestId: `batch-partial-${calls}`,
        success: true,
      },
    });
  });
  await page.goto("/pools?fixture=pools-ready");
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByText("部分创建记录不可用")).toBeVisible();

  await page.getByRole("button", { name: `查看池子创建者 0x${"1".repeat(40)}` }).click();
  let dialog = page.getByRole("dialog", { name: "池子创建者" });
  await expect(dialog).toContainText("非本平台创建，或创建于本功能上线前");
  await dialog.getByRole("button", { name: "关闭池子创建者" }).click();

  await page.getByRole("button", { name: `查看池子创建者 0x${"3".repeat(64)}` }).click();
  dialog = page.getByRole("dialog", { name: "池子创建者" });
  await expect(dialog).toContainText("创建记录格式异常");
  await dialog.getByRole("button", { name: "关闭池子创建者" }).click();

  await page.getByRole("button", { name: `查看池子创建者 0x${"4".repeat(64)}` }).click();
  dialog = page.getByRole("dialog", { name: "池子创建者" });
  await expect(dialog).toContainText("创建时池子已存在，可能非本平台首创");
  await dialog.getByRole("button", { name: "关闭池子创建者" }).click();

  await page.getByRole("button", { name: /展开池分组/u }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByRole("button", { name: `查看池子创建者 0x${"2".repeat(40)}` }).click();
  dialog = page.getByRole("dialog", { name: "池子创建者" });
  await expect(dialog).toContainText("用户已删除");
  await expect(dialog).toContainText(userId);
  await dialog.getByRole("button", { name: "关闭池子创建者" }).click();

  await page.getByRole("button", { name: "展开高级筛选" }).click();
  await page.getByRole("checkbox", { exact: true, name: "V4" }).uncheck();
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect.poll(() => calls).toBe(3);
  await page.getByRole("button", { name: `查看池子创建者 0x${"1".repeat(40)}` }).click();
  dialog = page.getByRole("dialog", { name: "池子创建者" });
  await expect(dialog.getByRole("alert")).toContainText("创建归属加载失败");
});

test("POOL-15 cancels filtered admin batches and ignores their late response", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Late response timing runs once.");
  await installBase(page, "admin");
  let firstRoute: Route | null = null;
  let calls = 0;
  await page.route("**/api/pools/create-history?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { items: [], nextCursor: null }, requestId: "empty", success: true },
    }),
  );
  await page.route("**/api/admin/pool-creators", async (route) => {
    calls += 1;
    const body = route.request().postDataJSON() as { poolKeys: string[] };
    if (calls === 1) {
      firstRoute = route;
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          results: body.poolKeys.map((identity) => ({ creator: null, identity })),
        },
        requestId: "fresh",
        success: true,
      },
    });
  });
  await page.goto("/pools?fixture=pools-ready");
  await expect.poll(() => calls).toBe(1);
  await page.getByRole("button", { name: "展开高级筛选" }).click();
  await page.getByRole("checkbox", { exact: true, name: "V4" }).uncheck();
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByRole("button", { name: /查看池子创建者/u })).toHaveCount(1);
  await (firstRoute as Route | null)
    ?.fulfill({
      contentType: "application/json",
      json: {
        data: {
          results: [{ creator: attribution({ userId: "late-user" }), identity: poolKey }],
        },
        requestId: "late",
        success: true,
      },
    })
    .catch(() => undefined);
  await expect(page.getByText("late-user")).toHaveCount(0);
});
