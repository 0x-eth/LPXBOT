import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_03 === "1";
const userId = "74000000-0000-4000-8000-000000000001";
const walletId = "74000000-0000-4000-8000-000000000011";
const pricingId = "74000000-0000-4000-8000-000000000021";
const observationId = "74000000-0000-4000-8000-000000000031";
const epoch = "74000000-0000-4000-8000-000000000090";
const address = "0x1111111111111111111111111111111111111111";
const tokenIn = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const tokenOut = "0x55d398326f99059ff775485246999027b3197955";
const manager = "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613";
const poolAddress = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"ab".repeat(32)}`;
const digest = `0x${"cd".repeat(32)}`;
const snapshotDigest = `0x${"ef".repeat(32)}`;
const observedAt = "2026-08-19T08:00:00.000Z";

function envelope(data: unknown) {
  return { data, requestId: "p05-03-e2e", success: true };
}

function wallet() {
  return {
    address,
    createdAt: observedAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Pricing wallet",
    revision: 1,
    updatedAt: observedAt,
    walletId,
  };
}

const chainPosition = {
  approval: {
    approvedAddress: null,
    approvedForAll: false,
    helperAuthorized: false,
    nftOwner: address,
    observedAtBlock: "116718500",
  },
  chainId: 56,
  fees: {
    estimated0BaseUnit: "7",
    estimated1BaseUnit: "9",
    owed0BaseUnit: "7",
    owed1BaseUnit: "9",
  },
  liquidity: { amount0BaseUnit: "100", amount1BaseUnit: "200", raw: "300" },
  owner: address,
  platformId: 1,
  pool: {
    feePips: "500",
    hooks: null,
    poolAddress,
    poolId: null,
    tickSpacing: "10",
    token0: tokenIn,
    token1: tokenOut,
  },
  snapshot: {
    blockHash,
    blockNumber: "116718500",
    blockTimestamp: observedAt,
    digest: snapshotDigest,
    positionManager: manager,
    positionManagerCodeHash: "0xbc0177f23ffd65c41e41fb201e170cb253489d7d637f8f6a15743a1f861160f5",
    registryVersion: "p05-bsc-execution-v1",
  },
  ticks: { current: "0", inRange: true, lower: "-10", upper: "10" },
  tokenId: "42",
};

function positionPage() {
  return {
    address,
    chainId: 56,
    coverage: { complete: true, failedPlatformIds: [], scannedPlatformIds: [1, 2, 4, 5] },
    cursor: null,
    items: [chainPosition],
    quarantined: [],
    registryVersion: "p05-bsc-execution-v1",
    snapshot: { blockHash, blockNumber: "116718500", blockTimestamp: observedAt, digest },
    status: "ready",
    walletId,
  };
}

function helperStatus() {
  return {
    address: null,
    chainId: 56,
    failures: [],
    helperVersion: null,
    owner: address,
    registryVersion: "p05-bsc-execution-v1",
    state: "undeployed",
    verification: null,
    walletId,
  };
}

function pricingPosition(status: "active" | "hidden" = "active", revision = 1) {
  return {
    chainId: 56,
    costBasis: {
      amount0BaseUnit: "100",
      amount1BaseUnit: "200",
      priceObservedAt: null,
      priceSource: null,
      priceStatus: "missing",
      usdValueDecimal: null,
    },
    importedAt: observedAt,
    observations: [
      {
        blockHash,
        blockNumber: "116718500",
        liquidityAmount0BaseUnit: "100",
        liquidityAmount1BaseUnit: "200",
        liquidityRaw: "300",
        observationId,
        observedAt,
        observedFee0BaseUnit: "7",
        observedFee1BaseUnit: "9",
        pageSnapshotDigest: digest,
        recordedAt: observedAt,
        snapshotDigest,
      },
    ],
    platformId: 1,
    pool: { poolAddress, poolId: null, token0: tokenIn, token1: tokenOut },
    positionManager: manager,
    pricingId,
    revision,
    status,
    tokenId: "42",
    updatedAt: observedAt,
    walletAddress: address,
    walletId,
  };
}

interface FixtureState {
  imported: boolean;
  quoteMode: "error" | "stale" | "success";
  quotePayloads: Record<string, unknown>[];
  withdrawn: boolean;
}

function quoteResponse(body: Record<string, unknown>) {
  const quotedAt = new Date();
  const expiresAt = new Date(quotedAt.getTime() + 1_500);
  const deadline = new Date(quotedAt.getTime() + 3_000);
  const amountOut = 2_000n;
  const slippage = Number(body.slippageBps);
  return {
    amountInBaseUnit: body.amountInBaseUnit,
    amountOutBaseUnit: amountOut.toString(),
    blockNumber: "116718500",
    calldataDigest: digest,
    chainId: 56,
    deadline: deadline.toISOString(),
    digest,
    digestDomain: "LPXBOT_SWAP_QUOTE",
    digestVersion: 1,
    executionEnabled: false,
    expiresAt: expiresAt.toISOString(),
    gas: {
      estimatedFeeWei: "543000000000000",
      gasLimit: "181000",
      gasPriceWei: "3000000000",
    },
    maxBlockNumber: "116718505",
    minOutBaseUnit: ((amountOut * BigInt(10_000 - slippage)) / 10_000n).toString(),
    platformId: body.platformId,
    priceImpactBps: 24,
    providerSnapshotId: "74000000-0000-4000-8000-000000000041",
    quotedAt: quotedAt.toISOString(),
    registryVersion: "p05-bsc-execution-v1",
    route: { poolPath: [blockHash], tokens: [body.tokenIn, body.tokenOut] },
    router: "0x1111111111111111111111111111111111110051",
    selector: "0x01000051",
    slippageBps: slippage,
    spender: "0x1111111111111111111111111111111111110151",
    tokenIn: body.tokenIn,
    tokenOut: body.tokenOut,
    walletAddress: address,
    walletId,
  };
}

async function install(page: Page, state: FixtureState) {
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === "/api/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "P05-03 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId,
          },
        }),
      });
      return;
    }
    if (path === "/api/user/preferences") {
      await route.fulfill({
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
      });
      return;
    }
    if (path === "/api/wallets" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: [wallet()] }),
      });
      return;
    }
    if (path.endsWith("/balances")) {
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
    if (path.endsWith("/tokens")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ chainId: 56, items: [], walletId }),
      });
      return;
    }
    if (path.endsWith("/receive")) {
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
    if (path.startsWith("/api/wallets/") && path.endsWith("/positions")) {
      await route.fulfill({ contentType: "application/json", json: envelope(positionPage()) });
      return;
    }
    if (path.endsWith("/helper")) {
      await route.fulfill({ contentType: "application/json", json: envelope(helperStatus()) });
      return;
    }
    if (path === "/api/wallets/helper-residuals") {
      await route.fulfill({ contentType: "application/json", json: envelope(null) });
      return;
    }
    if (path === "/api/address-book") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          chainId: 56,
          classification: null,
          entries: [],
          ownWallets: [{ address, name: "Pricing wallet", walletId }],
        }),
      });
      return;
    }
    if (path === "/api/pricing-positions" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          items: state.imported
            ? [pricingPosition(state.withdrawn ? "hidden" : "active", state.withdrawn ? 2 : 1)]
            : [],
        }),
      });
      return;
    }
    if (path === "/api/pricing-positions/stream") {
      const items = state.imported ? [pricingPosition()] : [];
      const cursor = state.imported ? "fixture-cursor-1" : "fixture-cursor-0";
      const sequence = state.imported ? "1" : "0";
      await route.fulfill({
        body:
          "retry: 60000\n\n" +
          `id: ${cursor}\nevent: snapshot\ndata: ${JSON.stringify({ cursor, epoch, items, sequence, type: "snapshot" })}\n\n` +
          `id: ${cursor}\nevent: heartbeat\ndata: ${JSON.stringify({ cursor, epoch, observedAt: new Date().toISOString(), sequence, type: "heartbeat" })}\n\n`,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Content-Type": "text/event-stream; charset=utf-8",
        },
        status: 200,
      });
      return;
    }
    if (path === "/api/pricing-positions/import" && method === "POST") {
      state.imported = true;
      await route.fulfill({ contentType: "application/json", json: envelope(pricingPosition()) });
      return;
    }
    if (path.endsWith("/withdrawn") && method === "POST") {
      state.withdrawn = true;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(pricingPosition("hidden", 2)),
      });
      return;
    }
    if (path === "/api/swap/quote" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.quotePayloads.push(body);
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (state.quoteMode !== "success") {
        await route.fulfill({
          contentType: "application/json",
          json: {
            error: {
              code: state.quoteMode === "stale" ? "SWAP_QUOTE_STALE" : "SWAP_QUOTE_UNAVAILABLE",
              retryable: state.quoteMode === "error",
            },
            success: false,
          },
          status: state.quoteMode === "stale" ? 409 : 503,
        });
        return;
      }
      await route.fulfill({ contentType: "application/json", json: envelope(quoteResponse(body)) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: { code: "NOT_FOUND", retryable: false }, success: false },
      status: 404,
    });
  });
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("quotes without execution and maintains the observed pricing ledger", async ({
  page,
}, testInfo) => {
  const state: FixtureState = {
    imported: false,
    quoteMode: "success",
    quotePayloads: [],
    withdrawn: false,
  };
  await install(page, state);
  await page.goto("/wallets");

  const quotePanel = page.locator("[data-testid='swap-quote-panel']");
  await expect(page.getByRole("heading", { name: "Swap 报价" })).toBeVisible();
  await expect(quotePanel).toHaveAttribute("data-state", "idle");
  const refresh = page.getByRole("button", { name: "刷新 Swap 报价" });
  await refresh.focus();
  await page.keyboard.press("Enter");
  await expect(quotePanel).toHaveAttribute("data-state", "quoting");
  await expect(quotePanel).toHaveAttribute("data-state", "quoted");
  await expect(page.getByText("1990", { exact: true })).toBeVisible();
  await expect(page.getByText("543000000000000", { exact: true })).toBeVisible();
  await expect(page.getByText(tokenIn, { exact: true })).toBeVisible();
  await expect(refresh).toBeFocused();
  expect(Object.keys(state.quotePayloads[0]!).sort()).toEqual([
    "amountInBaseUnit",
    "chainId",
    "platformId",
    "slippageBps",
    "tokenIn",
    "tokenOut",
    "walletId",
  ]);
  expect(JSON.stringify(state.quotePayloads)).not.toMatch(/router|spender|selector|calldata|okx/iu);
  await expect(quotePanel).toHaveAttribute("data-state", "expired", { timeout: 4_000 });

  state.quoteMode = "stale";
  await refresh.click();
  await expect(quotePanel).toHaveAttribute("data-state", "stale");
  state.quoteMode = "error";
  await refresh.click();
  await expect(quotePanel).toHaveAttribute("data-state", "error");

  const ledger = page.locator("[data-testid='pricing-position-panel']");
  await expect(page.getByRole("heading", { name: "观察台账" })).toBeVisible();
  const importButton = page.getByRole("button", { name: "导入观察仓位" });
  await importButton.focus();
  await page.keyboard.press("Enter");
  await expect(ledger.getByText("Token #42", { exact: true })).toBeVisible();
  await expect(importButton).toBeFocused();
  const withdrawn = page.getByRole("button", { name: "标记 Token #42 已撤出" });
  await withdrawn.focus();
  await page.keyboard.press("Enter");
  await expect(ledger.getByText("已隐藏", { exact: true })).toBeVisible();
  await expect(withdrawn).toBeFocused();

  for (const name of [
    /approve/i,
    /sign/i,
    /broadcast/i,
    /execute/i,
    /批准/,
    /签名/,
    /广播/,
    /执行/,
  ]) {
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await axe(page);

  if (captureEvidence) {
    await page.addStyleTag({
      content: `
        .app-header,
        .shell-status-bar,
        .mobile-navigation-shell,
        .wallets-heading,
        .wallet-list,
        .asset-section,
        .position-helper-read-model,
        .receive-section,
        .address-book-section {
          display: none !important;
        }
        .app-frame {
          display: block !important;
          min-height: 0 !important;
          padding-bottom: 0 !important;
        }
        .workspace.wallets-workspace {
          padding-top: 20px !important;
          padding-bottom: 20px !important;
        }
        .wallet-read-model {
          margin-top: 0 !important;
        }
      `,
    });
    await page.screenshot({
      fullPage: true,
      path: `artifacts/acceptance/P05-03/E-VIS/swap-pricing-${testInfo.project.name}.png`,
    });
  }
});
