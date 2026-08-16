import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const tokenA = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const tokenB = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const errorToken = "0xffffffffffffffffffffffffffffffffffffffff";
const quoteToken = "0x55d398326f99059ff775485246999027b3197955";
const v3Pool = "0x1111111111111111111111111111111111111111";
const v4Pool = `0x${"3".repeat(64)}`;

type PoolColumnKey =
  | "pool"
  | "protocol"
  | "fees"
  | "volume"
  | "feeTvl"
  | "feeActiveTvl"
  | "tvl"
  | "txs"
  | "fdv"
  | "actions";

interface ColumnPreference {
  key: PoolColumnKey;
  visible: boolean;
}

interface PreferenceState {
  conflictNext: boolean;
  failNext: boolean;
  poolColumns: ColumnPreference[];
  revision: number;
}

const defaultColumns: ColumnPreference[] = [
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
];

function preferences(state: PreferenceState) {
  return {
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
    poolColumns: structuredClone(state.poolColumns),
    poolsPanelCollapsed: false,
    showHotPools: false,
    showScanTab: true,
    taskViewMode: "grid",
    theme: "system",
  };
}

function preferenceEnvelope(state: PreferenceState) {
  return {
    data: {
      preferences: preferences(state),
      revision: state.revision,
      schemaVersion: 5,
      updatedAt: state.revision === 0 ? null : "2026-08-16T10:00:00.000Z",
    },
    requestId: "req-p02-06-preferences",
    success: true,
  };
}

function tokenPoolRow(
  poolAddress: `0x${string}`,
  token: `0x${string}`,
  symbol: string | null,
  fees5m: string | null,
) {
  return {
    activeTvlUsd: null,
    chainId: 56,
    fdvUsd: null,
    feeActiveTvl: null,
    feePips: "2500",
    fees1h: fees5m,
    fees5m,
    feesUsd: fees5m,
    feeTvl: null,
    hooks: null,
    poolAddress,
    poolId: null,
    poolKey: `56:${poolAddress}`,
    protocol: "pcsv3",
    tickSpacing: "50",
    token0Address: token,
    token0Symbol: symbol,
    token1Address: quoteToken,
    token1Symbol: "USDT",
    transactionCount: null,
    transactionCount1h: null,
    transactionCount5m: null,
    tvlUsd: null,
    volume1h: null,
    volume5m: null,
    volumeUsd: null,
  };
}

async function fulfillPreferences(route: Route, state: PreferenceState): Promise<void> {
  if (route.request().method() === "GET") {
    await route.fulfill({ contentType: "application/json", json: preferenceEnvelope(state) });
    return;
  }
  const request = route.request().postDataJSON() as {
    changes: { poolColumns?: ColumnPreference[] };
    expectedRevision: number;
  };
  if (state.failNext) {
    state.failNext = false;
    await route.fulfill({
      contentType: "application/json",
      json: {
        error: { code: "PREFERENCES_WRITE_FAILED", requestId: "req-p02-06-fail", retryable: true },
        success: false,
      },
      status: 503,
    });
    return;
  }
  if (state.conflictNext || request.expectedRevision !== state.revision) {
    state.conflictNext = false;
    state.poolColumns = defaultColumns.map((column) =>
      column.key === "tvl" ? { ...column, visible: false } : { ...column },
    );
    state.revision += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        error: { code: "PREFERENCES_CONFLICT", requestId: "req-p02-06-conflict", retryable: true },
        success: false,
      },
      status: 409,
    });
    return;
  }
  if (request.changes.poolColumns) state.poolColumns = structuredClone(request.changes.poolColumns);
  state.revision += 1;
  await route.fulfill({ contentType: "application/json", json: preferenceEnvelope(state) });
}

async function installFixture(page: Page, state: PreferenceState): Promise<void> {
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
            displayName: "P02-06 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000056",
          },
        },
        requestId: "req-p02-06-auth",
        success: true,
      },
    }),
  );
  await page.route("**/api/user/preferences", (route) => fulfillPreferences(route, state));
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { remarks: [], shared: [] }, requestId: "req-p02-06-remarks", success: true },
    }),
  );
}

function newPreferenceState(): PreferenceState {
  return {
    conflictNext: false,
    failNext: false,
    poolColumns: structuredClone(defaultColumns),
    revision: 0,
  };
}

test("POOL-08 cancels stale Token searches and keeps pool identity semantics explicit", async ({
  page,
}) => {
  const preferenceState = newPreferenceState();
  await installFixture(page, preferenceState);
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
  const firstStarted = new Promise<void>((resolve) => (markFirstStarted = resolve));
  let tokenBRequests = 0;
  await page.route("**/api/pools/by-token/**", async (route) => {
    const address = new URL(route.request().url()).pathname.split("/").at(-1);
    if (address === tokenA) {
      markFirstStarted();
      await firstGate;
      try {
        await route.fulfill({
          contentType: "application/json",
          json: {
            data: [
              tokenPoolRow("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tokenA, "FIRST", "99"),
            ],
            requestId: "req-token-a",
            success: true,
          },
        });
      } catch {
        // The application aborts this route when the second search starts.
      }
      return;
    }
    if (address === errorToken) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          error: {
            code: "MARKET_TOKEN_UNAVAILABLE",
            requestId: "req-token-error",
            retryable: true,
          },
          success: false,
        },
        status: 503,
      });
      return;
    }
    tokenBRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        data: [tokenPoolRow("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee01", tokenB, "SECOND", "12")],
        requestId: "req-token-b",
        success: true,
      },
    });
  });
  await page.goto("/pools?fixture=pools-ready");

  const search = page.getByRole("region", { name: "池搜索" });
  const input = search.getByLabel("Token 地址");
  await input.fill("bad-token");
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveAttribute("data-search-state", "invalid");
  await expect(search.getByRole("alert")).toContainText("合法 Token 地址");

  await input.fill(tokenA);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await firstStarted;
  await expect(search).toHaveAttribute("data-search-state", "loading");
  await search.getByLabel("Token 地址").fill(tokenB);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveAttribute("data-search-state", "ready");
  await expect(page.getByRole("table", { name: "BSC 热门池" })).toContainText("SECOND");
  releaseFirst();
  await page.waitForTimeout(50);
  await expect(page.getByRole("table", { name: "BSC 热门池" })).not.toContainText("FIRST");
  await expect(page).toHaveURL(new RegExp(`pool_search=${tokenB}`, "u"));

  await search.getByRole("button", { name: "刷新池搜索" }).click();
  await expect.poll(() => tokenBRequests).toBe(2);
  await search.getByRole("button", { name: "清除池搜索" }).click();
  await expect(search).toHaveAttribute("data-search-state", "pristine");
  await expect(page).not.toHaveURL(/pool_search=/u);

  await search.getByLabel("Token 地址").fill(errorToken);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveAttribute("data-search-state", "error");
  await expect(search.getByRole("alert")).toHaveText("搜索暂不可用");

  await search.getByRole("radio", { name: "池", exact: true }).click();
  await search.getByLabel("池地址或 Pool ID").fill(v4Pool);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveAttribute("data-search-state", "ready");
  await expect(page.getByRole("table", { name: "BSC 热门池" })).toContainText("PancakeSwap V4");
  await search.getByLabel("池地址或 Pool ID").fill(`0x${"f".repeat(40)}`);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveAttribute("data-search-state", "no-results");

  await page.goto(`/pools?fixture=pools-reconnecting&pool_search_mode=pool&pool_search=${v3Pool}`);
  await expect(search).toHaveAttribute("data-search-state", "reconnecting");
});

test("POOL-09 groups by canonical token, preserves member order and is visually stable", async ({
  page,
}, testInfo) => {
  await installFixture(page, newPreferenceState());
  await page.route("**/api/pools/by-token/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: [
          tokenPoolRow("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", tokenA, "GROUP", "30"),
          tokenPoolRow("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2", tokenA, "GROUP", "20"),
          tokenPoolRow("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3", tokenA, "GROUP", "10"),
        ],
        requestId: "req-token-group",
        success: true,
      },
    }),
  );
  await page.goto("/pools?fixture=pools-ready");

  const table = page.getByRole("table", { name: "BSC 热门池" });
  const defaultToggle = table.getByRole("button", { name: /^展开池分组/u });
  await expect(defaultToggle).toContainText("+1");
  await defaultToggle.click();
  await expect(table.getByRole("button", { name: /^折叠池分组/u })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(table.locator("tbody tr")).toHaveCount(4);

  const search = page.getByRole("region", { name: "池搜索" });
  await search.getByLabel("Token 地址").fill(tokenA);
  await search.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(search).toHaveAttribute("data-search-state", "ready");
  const tokenToggle = table.getByRole("button", { name: /^展开池分组/u });
  await expect(tokenToggle).toContainText("+2");
  await tokenToggle.click();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("tbody tr").nth(0)).toContainText("30");
  await expect(table.locator("tbody tr").nth(1)).toContainText("20");
  await expect(table.locator("tbody tr").nth(2)).toContainText("10");

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-06/ui/pool-discovery-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test("POOL-10 persists locked column preferences and rolls back failures and conflicts", async ({
  page,
}) => {
  const state = newPreferenceState();
  await installFixture(page, state);
  await page.goto("/pools?fixture=pools-ready");
  const table = page.getByRole("table", { name: "BSC 热门池" });
  const openColumns = () => page.getByRole("button", { name: "设置池表列" }).click();

  await openColumns();
  let dialog = page.getByRole("dialog", { name: "表格列" });
  await expect(dialog.locator('[data-column-key="pool"] input')).toBeDisabled();
  await expect(dialog.locator('[data-column-key="actions"] input')).toBeDisabled();
  await dialog.locator('[data-column-key="volume"] input').uncheck();
  await dialog
    .locator('[data-column-key="fdv"]')
    .dragTo(dialog.locator('[data-column-key="protocol"]'));
  await dialog.getByRole("button", { name: "下移 FDV" }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(table.getByRole("columnheader", { name: "Volume" })).toHaveCount(0);
  expect(state.poolColumns[0]?.key).toBe("pool");
  expect(state.poolColumns.at(-1)?.key).toBe("actions");

  await page.reload();
  await expect(table.getByRole("columnheader", { name: "Volume" })).toHaveCount(0);
  await expect(table.getByRole("columnheader").first()).toHaveText("池");
  await expect(table.getByRole("columnheader").last()).toHaveText("操作");

  state.failNext = true;
  await openColumns();
  dialog = page.getByRole("dialog", { name: "表格列" });
  await dialog.locator('[data-column-key="fees"] input').uncheck();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("列设置保存失败");
  await dialog.getByRole("button", { name: "关闭列设置" }).click();
  await expect(table.getByRole("columnheader", { name: "Fees" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Volume" })).toHaveCount(0);

  state.conflictNext = true;
  await openColumns();
  dialog = page.getByRole("dialog", { name: "表格列" });
  await dialog.locator('[data-column-key="volume"] input').check();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("列设置保存失败");
  await dialog.getByRole("button", { name: "关闭列设置" }).click();
  await expect(table.getByRole("columnheader", { exact: true, name: "TVL" })).toHaveCount(0);
  await expect(table.getByRole("columnheader", { name: "Volume" })).toBeVisible();

  await openColumns();
  dialog = page.getByRole("dialog", { name: "表格列" });
  await dialog.getByRole("button", { name: "重置" }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  for (const label of [
    "池",
    "协议",
    "Fees",
    "Volume",
    "Fee/TVL",
    "Fee/aTVL",
    "TVL",
    "Txs",
    "FDV",
    "操作",
  ]) {
    await expect(table.getByRole("columnheader", { name: label, exact: true })).toBeVisible();
  }
});
