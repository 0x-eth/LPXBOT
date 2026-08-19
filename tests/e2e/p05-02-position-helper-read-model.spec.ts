import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_02 === "1";
const userId = "69000000-0000-4000-8000-000000000001";
const walletId = "69000000-0000-4000-8000-000000000011";
const address = "0x1111111111111111111111111111111111111111";
const helperAddress = "0x2222222222222222222222222222222222222222";
const manager = "0x3333333333333333333333333333333333333333";
const token0 = "0x4444444444444444444444444444444444444444";
const token1 = "0x5555555555555555555555555555555555555555";
const blockHash = `0x${"ab".repeat(32)}`;
const digest = `0x${"cd".repeat(32)}`;
const codeHash = `0x${"ef".repeat(32)}`;
const observedAt = "2026-08-19T07:00:00.000Z";

function envelope(data: unknown) {
  return { data, requestId: "p05-02-e2e", success: true };
}

function wallet() {
  return {
    address,
    createdAt: observedAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "BSC read wallet",
    revision: 1,
    updatedAt: observedAt,
    walletId,
  };
}

const position = {
  approval: {
    approvedAddress: helperAddress,
    approvedForAll: false,
    helperAuthorized: true,
    nftOwner: address,
    observedAtBlock: "116718500",
  },
  chainId: 56,
  fees: {
    estimated0BaseUnit: "13",
    estimated1BaseUnit: "21",
    owed0BaseUnit: "3",
    owed1BaseUnit: "5",
  },
  liquidity: { amount0BaseUnit: "1000000000000000001", amount1BaseUnit: "9", raw: "77" },
  owner: address,
  platformId: 1,
  pool: {
    feePips: "500",
    hooks: null,
    poolAddress: "0x7777777777777777777777777777777777777777",
    poolId: null,
    tickSpacing: "10",
    token0,
    token1,
  },
  snapshot: {
    blockHash,
    blockNumber: "116718500",
    blockTimestamp: observedAt,
    digest,
    positionManager: manager,
    positionManagerCodeHash: codeHash,
    registryVersion: "p05-bsc-execution-v1",
  },
  ticks: { current: "0", inRange: true, lower: "-100", upper: "100" },
  tokenId: "9",
};

function positionPage(state: "empty" | "partial" | "quarantined" | "ready" | "stale") {
  const hasItem = state === "ready" || state === "partial";
  const quarantined =
    state === "quarantined"
      ? [{ managerAddress: manager, platformId: 1, reason: "owner-mismatch", tokenId: "11" }]
      : [];
  return {
    address,
    chainId: 56,
    coverage: {
      complete: state === "ready" || state === "empty",
      failedPlatformIds: state === "partial" ? [2] : state === "quarantined" ? [1] : [],
      scannedPlatformIds: state === "stale" ? [] : state === "quarantined" ? [1] : [1, 2, 4, 5],
    },
    cursor: null,
    items: hasItem ? [position] : [],
    quarantined,
    registryVersion: "p05-bsc-execution-v1",
    snapshot: { blockHash, blockNumber: "116718500", blockTimestamp: observedAt, digest },
    status: state,
    walletId,
  };
}

function helperStatus(state: "active" | "degraded" | "residual" | "superseded" | "undeployed") {
  if (state === "undeployed") {
    return {
      address: null,
      chainId: 56,
      failures: [],
      helperVersion: null,
      owner: address,
      registryVersion: "p05-bsc-execution-v1",
      state,
      verification: null,
      walletId,
    };
  }
  const degraded = state === "degraded";
  return {
    address: helperAddress,
    chainId: 56,
    failures: degraded ? ["owner-mismatch"] : [],
    helperVersion: state === "superseded" ? "observed-bsc-helper-v1" : "observed-bsc-helper-v2",
    owner: address,
    registryVersion: "p05-bsc-execution-v1",
    state,
    verification: {
      blockHash,
      blockNumber: "116718500",
      blockTimestamp: observedAt,
      checks: {
        address: true,
        owner: !degraded,
        runtimeCodeHash: true,
        selectorSet: true,
        version: true,
      },
      digest,
      observedOwner: degraded ? helperAddress : address,
      observedRuntimeCodeHash: codeHash,
      observedSelectors: ["0x8da5cb5b"],
      verifiedAt: "2026-08-19T07:00:01.000Z",
    },
    walletId,
  };
}

function residualPage(state: "partial" | "ready") {
  const partial = state === "partial";
  return {
    allowlistVersion: "p05-bsc-helper-residual-v1",
    chainId: 56,
    coverage: {
      allowlistComplete: !partial,
      complete: !partial,
      missingSources: partial ? ["allowlist"] : [],
      positionTokensComplete: true,
      walletTokenRegistryComplete: true,
    },
    cursor: null,
    helperAddress,
    items: [
      {
        amountBaseUnit: "1000000000000000001",
        assetId: `token:${token0}`,
        chainId: 56,
        kind: "token",
        tokenAddress: token0,
      },
    ],
    registryVersion: "p05-bsc-execution-v1",
    scanId: "69000000-0000-4000-8000-000000000021",
    scannedAt: "2026-08-19T07:00:02.000Z",
    snapshot: { blockHash, blockNumber: "116718500", blockTimestamp: observedAt, digest },
    state,
    walletId,
  };
}

type PositionMode = "empty" | "error" | "partial" | "quarantined" | "ready" | "stale";
type HelperMode = "active" | "degraded" | "residual" | "superseded" | "undeployed";
type ResidualMode = "empty" | "error" | "partial" | "ready";

function closedLocalPositionPage() {
  return {
    chainId: 31_337,
    executionEnabled: false,
    items: [],
    registryVersion: "p05-local-position-execution-v2",
    serviceFeeBps: 0,
    walletId,
  };
}

async function install(
  page: Page,
  state: {
    delayMs?: number;
    helper: HelperMode;
    position: PositionMode;
    positionRequests: number;
    residual: ResidualMode;
    residualScans: number;
  },
) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        isAdmin: false,
        maintenance: null,
        user: {
          allowedChainIds: [56],
          avatarUrl: null,
          displayName: "P05 Fixture",
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
  await page.route("**/api/address-book**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        chainId: 56,
        classification: null,
        entries: [],
        ownWallets: [{ address, name: "BSC read wallet", walletId }],
      }),
    }),
  );
  await page.route("**/api/positions/local-current**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope(closedLocalPositionPage()),
    }),
  );
  await page.route("**/api/wallets**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/wallets") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: [wallet()] }),
      });
      return;
    }
    if (request.method() === "GET" && path.endsWith("/balances")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          address,
          blockNumberDecimal: "116718500",
          chainId: 56,
          items: [],
          readAt: observedAt,
          totalUsdValueDecimal: null,
          walletId,
        }),
      });
      return;
    }
    if (request.method() === "GET" && path.endsWith("/tokens")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ chainId: 56, items: [], walletId }),
      });
      return;
    }
    if (request.method() === "GET" && path.endsWith("/receive")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          address,
          amountBaseUnit: null,
          amountDecimal: null,
          chainId: 56,
          eip681: `ethereum:${address}@56`,
          tokenAddress: null,
          walletId,
        }),
      });
      return;
    }
    if (path.endsWith("/positions")) {
      state.positionRequests += 1;
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (state.position === "error") {
        await route.fulfill({
          contentType: "application/json",
          json: { error: { code: "CHAIN_READ_UNAVAILABLE", retryable: true }, success: false },
          status: 503,
        });
      } else {
        await route.fulfill({
          contentType: "application/json",
          json: envelope(positionPage(state.position)),
        });
      }
      return;
    }
    if (path.endsWith("/helper")) {
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      await route.fulfill({
        contentType: "application/json",
        json: envelope(helperStatus(state.helper)),
      });
      return;
    }
    if (path === "/api/wallets/helper-residuals" && request.method() === "GET") {
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (state.residual === "error") {
        await route.fulfill({
          contentType: "application/json",
          json: { error: { code: "CHAIN_READ_UNAVAILABLE", retryable: true }, success: false },
          status: 503,
        });
      } else {
        await route.fulfill({
          contentType: "application/json",
          json: envelope(state.residual === "empty" ? null : residualPage(state.residual)),
        });
      }
      return;
    }
    if (path === "/api/wallets/helper-residuals/scan" && request.method() === "POST") {
      state.residualScans += 1;
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      if (state.residual === "error") {
        await route.fulfill({
          contentType: "application/json",
          json: { error: { code: "CHAIN_READ_UNAVAILABLE", retryable: true }, success: false },
          status: 503,
        });
      } else {
        await route.fulfill({
          contentType: "application/json",
          json: envelope(residualPage(state.residual === "empty" ? "ready" : state.residual)),
        });
      }
      return;
    }
    await route.abort("failed");
  });
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("renders ready position, active Helper, and residual data without execution controls", async ({
  page,
}, testInfo) => {
  const state = {
    helper: "active" as const,
    position: "ready" as PositionMode,
    positionRequests: 0,
    residual: "ready" as ResidualMode,
    residualScans: 0,
  };
  await install(page, state);
  await page.goto("/wallets");

  await expect(page.getByRole("heading", { exact: true, name: "仓位" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Helper 状态" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "残留资产" })).toBeVisible();
  await expect(page.locator("[data-testid='position-read-panel']")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await expect(page.getByText("Token #9")).toBeVisible();
  await expect(page.getByText("Uniswap V3", { exact: true })).toBeVisible();
  await expect(
    page.locator("[data-testid='position-read-panel']").getByText("1000000000000000001 base units"),
  ).toBeVisible();
  await expect(page.locator("[data-testid='helper-read-panel']")).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.locator("[data-testid='helper-residual-panel']")).toHaveAttribute(
    "data-state",
    "ready",
  );

  for (const name of ["collect", "decrease", "deploy", "upgrade", "sweep", "rescue"]) {
    await expect(page.getByRole("button", { name: new RegExp(name, "i") })).toHaveCount(0);
  }
  const positionRefresh = page.getByRole("button", { name: "刷新仓位" });
  await positionRefresh.focus();
  await expect(positionRefresh).toBeFocused();
  const before = state.positionRequests;
  await page.keyboard.press("Enter");
  await expect.poll(() => state.positionRequests).toBeGreaterThan(before);
  await expect(positionRefresh).toBeFocused();

  const scan = page.getByRole("button", { name: "重新扫描残留资产" });
  await scan.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => state.residualScans).toBe(1);
  await expect(scan).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await axe(page);

  if (captureEvidence) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const sections = page.locator(".position-helper-read-model > .wallet-read-section");
    const bounds = await sections.evaluateAll((elements) => {
      const rectangles = elements.map((element) => element.getBoundingClientRect());
      const top = Math.min(...rectangles.map((rectangle) => rectangle.top)) + window.scrollY;
      const bottom = Math.max(...rectangles.map((rectangle) => rectangle.bottom)) + window.scrollY;
      return { height: bottom - top, y: top };
    });
    const viewport = page.viewportSize();
    expect(bounds.height).toBeGreaterThan(0);
    expect(viewport).not.toBeNull();
    await page.setViewportSize({
      height: Math.ceil(bounds.y + bounds.height),
      width: viewport!.width,
    });
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      clip: {
        height: bounds.height,
        width: viewport!.width,
        x: 0,
        y: bounds.y,
      },
      path: `artifacts/acceptance/P05-02/E-VIS/position-helper-ready-${testInfo.project.name}.png`,
      style: ".mobile-navigation-shell, .shell-status-bar { display: none !important; }",
    });
    expect(screenshot.byteLength).toBeGreaterThan(8_000);
  }
});

test("exposes every read-only operational state", async ({ page }) => {
  const state = {
    delayMs: 250,
    helper: "undeployed" as HelperMode,
    position: "empty" as PositionMode,
    positionRequests: 0,
    residual: "empty" as ResidualMode,
    residualScans: 0,
  };
  await install(page, state);
  await page.goto("/wallets");
  await expect(page.locator("[data-testid='position-read-panel']")).toHaveAttribute(
    "data-state",
    "loading",
  );
  await expect(page.locator("[data-testid='helper-residual-panel']")).toHaveAttribute(
    "data-state",
    "loading",
  );
  await expect(page.locator("[data-testid='position-read-panel']")).toHaveAttribute(
    "data-state",
    "empty",
  );
  await expect(page.locator("[data-testid='helper-read-panel']")).toHaveAttribute(
    "data-state",
    "undeployed",
  );
  await expect(page.locator("[data-testid='helper-residual-panel']")).toHaveAttribute(
    "data-state",
    "empty",
  );

  for (const next of ["partial", "stale", "quarantined", "error"] as const) {
    state.position = next;
    await page.getByRole("button", { name: "刷新仓位" }).click();
    await expect(page.locator("[data-testid='position-read-panel']")).toHaveAttribute(
      "data-state",
      next,
    );
  }
  for (const next of ["degraded", "superseded", "residual"] as const) {
    state.helper = next;
    await page.getByRole("button", { name: "刷新 Helper 状态" }).click();
    await expect(page.locator("[data-testid='helper-read-panel']")).toHaveAttribute(
      "data-state",
      next,
    );
  }

  state.residual = "partial";
  const scan = page.getByRole("button", { name: "重新扫描残留资产" });
  await scan.click();
  await expect(page.locator("[data-testid='helper-residual-panel']")).toHaveAttribute(
    "data-state",
    "scanning",
  );
  await expect(page.locator("[data-testid='helper-residual-panel']")).toHaveAttribute(
    "data-state",
    "partial",
  );
  state.residual = "error";
  await scan.click();
  await expect(page.locator("[data-testid='helper-residual-panel']")).toHaveAttribute(
    "data-state",
    "error",
  );
  await axe(page);
});
