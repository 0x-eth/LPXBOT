import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

interface BlocklistEntry {
  chainId: 56;
  identity: string;
  label?: string;
  scope: "pool" | "token";
}

interface BlocklistFixture {
  conflictNext: boolean;
  entries: BlocklistEntry[];
  failNext: boolean;
  holdNext: boolean;
  release: (() => void) | null;
  revision: number;
}

const poolKey = `56:0x${"1".repeat(40)}`;
const externalToken = `0x${"c".repeat(40)}`;

function blocklistSnapshot(state: BlocklistFixture) {
  const hashCharacter = "0123456789abcdef"[state.revision % 16]!;
  return {
    blocklistHash: `sha256:${hashCharacter.repeat(64)}`,
    entries: structuredClone(state.entries).sort((left, right) =>
      `${left.chainId}\0${left.scope}\0${left.identity}`.localeCompare(
        `${right.chainId}\0${right.scope}\0${right.identity}`,
        "en",
      ),
    ),
    revision: state.revision,
    schemaVersion: 1,
    updatedAt: state.revision === 0 ? null : "2026-08-17T04:00:00.000Z",
  };
}

async function blocklistRoute(route: Route, state: BlocklistFixture): Promise<void> {
  if (route.request().method() === "GET") {
    await route.fulfill({
      contentType: "application/json",
      json: { data: blocklistSnapshot(state), requestId: "p02-11-get", success: true },
    });
    return;
  }
  const body = route.request().postDataJSON() as {
    expectedRevision: number;
    operation: { entry: BlocklistEntry; type: "block" | "restore" };
  };
  if (state.holdNext) {
    state.holdNext = false;
    await new Promise<void>((resolve) => {
      state.release = resolve;
    });
    state.release = null;
  }
  if (state.failNext) {
    state.failNext = false;
    await route.fulfill({
      contentType: "application/json",
      json: {
        error: { code: "POOL_BLOCKLIST_WRITE_FAILED", requestId: "p02-11-fail", retryable: true },
        success: false,
      },
      status: 503,
    });
    return;
  }
  if (state.conflictNext || body.expectedRevision !== state.revision) {
    state.conflictNext = false;
    if (!state.entries.some(({ identity }) => identity === externalToken)) {
      state.entries.push({ chainId: 56, identity: externalToken, scope: "token" });
      state.revision += 1;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        current: blocklistSnapshot(state),
        error: {
          code: "REVISION_CONFLICT",
          message: "changed",
          requestId: "p02-11-conflict",
          retryable: true,
        },
        success: false,
      },
      status: 409,
    });
    return;
  }

  const key = `${body.operation.entry.scope}:${body.operation.entry.identity}`;
  const index = state.entries.findIndex((entry) => `${entry.scope}:${entry.identity}` === key);
  const changed =
    body.operation.type === "block"
      ? index < 0 && (state.entries.push(body.operation.entry), true)
      : index >= 0 && (state.entries.splice(index, 1), true);
  if (changed) state.revision += 1;
  await route.fulfill({
    contentType: "application/json",
    json: { data: blocklistSnapshot(state), requestId: "p02-11-patch", success: true },
  });
}

async function installFixture(page: Page, state: BlocklistFixture): Promise<void> {
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
            displayName: "P02-11 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000211",
          },
        },
        requestId: "p02-11-auth",
        success: true,
      },
    }),
  );
  await page.route("**/api/user/pool-blocklist", (route) => blocklistRoute(route, state));
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
        requestId: "p02-11-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { remarks: [], shared: [] }, requestId: "p02-11-remarks", success: true },
    }),
  );
  await page.route("**/api/stats/stream**", (route) =>
    route.fulfill({ contentType: "application/json", json: {}, status: 503 }),
  );
}

function newBlocklistFixture(): BlocklistFixture {
  return {
    conflictNext: false,
    entries: [],
    failNext: false,
    holdNext: false,
    release: null,
    revision: 0,
  };
}

test("POOL-13 shares one accessible row action menu across pointer and keyboard", async ({
  page,
}, testInfo) => {
  const state = newBlocklistFixture();
  await installFixture(page, state);
  await page.goto("/pools?fixture=pools-ready");
  const table = page.getByRole("table", { name: "BSC 热门池" });
  const row = table
    .locator("tbody > tr")
    .filter({ hasText: "0x1111111111111111111111111111111111111111" });
  await expect(row).toBeVisible();

  if (testInfo.project.name === "chromium-desktop") {
    await row.click({ button: "right" });
    let menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveCount(15);
    await expect(menu.getByRole("menuitem", { name: /创建监控/u })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(menu).toContainText("监控模块暂不可用");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: /复制池地址/u })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(row).toBeFocused();

    await page.keyboard.press("Shift+F10");
    menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: /展开 K 线/u })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: /分享到聊天室/u })).toBeFocused();
    await page.keyboard.press("Enter");
    const chat = page.getByRole("dialog", { name: "聊天草稿" });
    await expect(chat.getByLabel("消息草稿")).toHaveValue(`BSC 池 ${poolKey}`);
    await expect(chat.getByRole("button", { name: /发送/u })).toHaveCount(0);
    await chat.getByRole("button", { name: "关闭最近聊天" }).click();
  }

  await row.getByRole("button", { name: /更多池操作/u }).click();
  const moreMenu = page.getByRole("menu");
  await expect(moreMenu.getByRole("menuitem")).toHaveCount(15);
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
    path: `artifacts/acceptance/P02-11/ui/pool-actions-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
});

test("POOL-14 precisely rolls back failures and manages restore and conflicts", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "Mutation timing runs once.");
  const state = newBlocklistFixture();
  await installFixture(page, state);
  await page.goto("/pools?fixture=pools-ready");
  const table = page.getByRole("table", { name: "BSC 热门池" });
  const address = "0x1111111111111111111111111111111111111111";
  const row = () => table.locator("tbody > tr").filter({ hasText: address });

  state.failNext = true;
  state.holdNext = true;
  await row()
    .getByRole("button", { name: /更多池操作/u })
    .click();
  await page.getByRole("menuitem", { name: "屏蔽池", exact: true }).click();
  await expect(row()).toHaveCount(0);
  state.release?.();
  await expect(row()).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("屏蔽失败");

  await row()
    .getByRole("button", { name: /更多池操作/u })
    .click();
  await page.getByRole("menuitem", { name: "屏蔽池", exact: true }).click();
  await expect(row()).toHaveCount(0);
  await page.getByRole("button", { name: /屏蔽管理/u }).click();
  let dialog = page.getByRole("dialog", { name: "屏蔽管理" });
  await expect(dialog.getByRole("region", { name: "池屏蔽项" })).toContainText(address);
  await dialog.getByRole("button", { name: `恢复池 ${poolKey}` }).click();
  await expect(dialog.getByText("暂无屏蔽项")).toBeVisible();
  await expect(row()).toHaveCount(1);
  await dialog.getByRole("button", { name: "关闭屏蔽管理" }).click();

  state.conflictNext = true;
  await row()
    .getByRole("button", { name: /更多池操作/u })
    .click();
  await page.getByRole("menuitem", { name: "屏蔽池", exact: true }).click();
  await expect(row()).toHaveCount(1);
  await page.getByRole("button", { name: /屏蔽管理/u }).click();
  dialog = page.getByRole("dialog", { name: "屏蔽管理" });
  await expect(dialog.getByRole("alert")).toContainText("其他设备更新");
  await expect(dialog.getByRole("region", { name: "Token屏蔽项" })).toContainText(externalToken);
});
