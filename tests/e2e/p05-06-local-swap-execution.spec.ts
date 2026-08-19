import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_06 === "1";
const userId = "76000000-0000-4000-8000-000000000001";
const walletId = "76000000-0000-4000-8000-000000000011";
const operationId = "76000000-0000-4000-8000-000000000021";
const address = `0x${"1".repeat(40)}`;
const helperAddress = `0x${"2".repeat(40)}`;
const tokenIn = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const tokenOut = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const quoteDigest = `sha256:${"3".repeat(64)}`;
const previewDigest = `sha256:${"4".repeat(64)}`;
const planDigest = `sha256:${"5".repeat(64)}`;
const transactionHash = `0x${"6".repeat(64)}`;
const replacementHash = `0x${"7".repeat(64)}`;
const cleanupHash = `0x${"8".repeat(64)}`;
const previewToken = "A".repeat(43);
const observedAt = "2026-08-20T08:00:00.000Z";
const stableQuoteExpiry = "2099-08-20T08:00:30.000Z";
const stableDeadline = "2099-08-20T08:01:30.000Z";
const stablePreviewExpiry = "2099-08-20T08:00:20.000Z";
const epoch = "76000000-0000-4000-8000-000000000091";

const feeLimit = {
  feeCapBaseUnit: "200000000000000",
  gasLimit: "50000",
  maxFeePerGasBaseUnit: "4000000000",
  maxPriorityFeePerGasBaseUnit: "1000000000",
};

type OperationPhase =
  | "broadcast"
  | "failed"
  | "pending"
  | "queued"
  | "reconciling"
  | "signing"
  | "succeeded";

interface FixtureState {
  authorizationMode: "direct" | "permit2";
  executeDelayMs: number;
  executePayloads: Record<string, unknown>[];
  idempotencyKeys: string[];
  operationIndex: number;
  operationSequence: OperationPhase[];
  previewPayloads: Record<string, unknown>[];
  quoteError: string | null;
  quoteExpiresMs: number | null;
  quotePayloads: Record<string, unknown>[];
}

function envelope(data: unknown) {
  return { data, requestId: "p05-06-e2e", success: true };
}

function wallet() {
  return {
    address,
    createdAt: observedAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Local swap wallet",
    revision: 1,
    updatedAt: observedAt,
    walletId,
  };
}

function quoteResponse(body: Record<string, unknown>, expiresMs: number | null) {
  const now = Date.now();
  const quotedAt = expiresMs === null ? observedAt : new Date(now - 1_000).toISOString();
  const expiresAt =
    expiresMs === null ? stableQuoteExpiry : new Date(now + expiresMs).toISOString();
  const deadline =
    expiresMs === null ? stableDeadline : new Date(now + Math.max(expiresMs + 3_000, 4_000)).toISOString();
  return {
    amountInBaseUnit: body.amountInBaseUnit,
    amountOutBaseUnit: "2000",
    blockNumber: "100",
    chainId: 31_337,
    deadline,
    executionEnabled: true,
    expiresAt,
    gas: {
      estimatedFeeBaseUnit: "400000000000000",
      gasLimit: "200000",
      maxFeePerGasBaseUnit: "2000000000",
      maxPriorityFeePerGasBaseUnit: "1000000000",
    },
    helperAddress,
    maxBlockNumber: "105",
    minOutBaseUnit: "1980",
    quoteDigest,
    quoteVersion: "p05-local-swap-quote-v2",
    quotedAt,
    registryVersion: "p05-local-swap-execution-v2",
    serviceFeeBps: 0,
    slippageBps: body.slippageBps,
    tokenIn: body.tokenIn,
    tokenOut: body.tokenOut,
    walletAddress: address,
    walletId,
  };
}

function preview(mode: "direct" | "permit2", expiresMs: number | null) {
  const expiresAt =
    expiresMs === null
      ? stablePreviewExpiry
      : new Date(Date.now() + Math.max(250, expiresMs - 100)).toISOString();
  const deadline =
    expiresMs === null
      ? stableDeadline
      : new Date(Date.now() + Math.max(4_000, expiresMs + 3_000)).toISOString();
  return {
    authorizationMode: mode,
    chainId: 31_337,
    deadline,
    expiresAt,
    feeLimitTotalBaseUnit: "600000000000000",
    helperAddress,
    minOutBaseUnit: "1980",
    previewDigest,
    previewToken,
    quoteDigest,
    serviceFeeBps: 0,
    steps: [
      { amountBaseUnit: "1000", feeLimit, kind: "approve", ordinal: 0 },
      { amountBaseUnit: "1000", feeLimit, kind: "swap", ordinal: 1 },
      { amountBaseUnit: "0", feeLimit, kind: "cleanup", ordinal: 2 },
    ],
    walletId,
  };
}

function transaction(
  generation: number,
  state: "broadcast" | "failed" | "pending" | "replaced" | "signed" | "succeeded",
  hash: string | null,
  active = true,
) {
  return {
    active,
    generation,
    maxFeePerGasBaseUnit: generation === 0 ? "2000000000" : "3000000000",
    maxPriorityFeePerGasBaseUnit: generation === 0 ? "1000000000" : "1500000000",
    state,
    transactionHash: hash,
  };
}

function steps(phase: OperationPhase) {
  const approveState = phase === "queued" ? "queued" : phase === "signing" ? "signed" : "succeeded";
  const approveTransactions =
    phase === "queued"
      ? []
      : phase === "signing"
        ? [transaction(0, "signed", null)]
        : [transaction(0, "succeeded", transactionHash)];
  const reverted = phase === "reconciling" || phase === "failed";
  const swapState =
    phase === "queued" || phase === "signing" || phase === "broadcast"
      ? "blocked"
      : reverted
        ? "failed"
        : phase === "succeeded"
          ? "succeeded"
          : "pending";
  const swapTransactions =
    phase === "queued" || phase === "signing" || phase === "broadcast"
      ? []
      : reverted
        ? [transaction(0, "failed", transactionHash)]
        : [
            transaction(0, "replaced", transactionHash, false),
            transaction(1, phase === "succeeded" ? "succeeded" : "pending", replacementHash),
          ];
  const cleanupState = reverted ? (phase === "failed" ? "succeeded" : "pending") : "skipped";
  const cleanupTransactions = reverted
    ? [transaction(0, phase === "failed" ? "succeeded" : "pending", cleanupHash)]
    : [];
  return [
    {
      failureCode: null,
      feeLimit,
      kind: "approve",
      nonce: "7",
      ordinal: 0,
      state: approveState,
      stepId: "76000000-0000-4000-8000-000000000031",
      transactions: approveTransactions,
    },
    {
      failureCode: reverted ? "SWAP_REVERTED" : null,
      feeLimit,
      kind: "swap",
      nonce: "8",
      ordinal: 1,
      state: swapState,
      stepId: "76000000-0000-4000-8000-000000000032",
      transactions: swapTransactions,
    },
    {
      failureCode: null,
      feeLimit,
      kind: "cleanup",
      nonce: "9",
      ordinal: 2,
      state: cleanupState,
      stepId: "76000000-0000-4000-8000-000000000033",
      transactions: cleanupTransactions,
    },
  ];
}

function operation(phase: OperationPhase, mode: "direct" | "permit2", index = 0) {
  const reverted = phase === "reconciling" || phase === "failed";
  return {
    authorizationMode: mode,
    chainId: 31_337,
    createdAt: "2026-08-20T08:00:01.000Z",
    failureCode: reverted ? "SWAP_REVERTED" : null,
    helperAddress,
    operationId,
    operationKind: "local-swap",
    planDigest,
    quoteDigest,
    reconciliationReason: phase === "reconciling" ? "ALLOWANCE_CLEANUP_REQUIRED" : null,
    registryVersion: "p05-local-swap-execution-v2",
    state: phase,
    steps: steps(phase),
    updatedAt: new Date(Date.parse("2026-08-20T08:00:02.000Z") + index * 1_000).toISOString(),
    walletId,
  };
}

function positionPage() {
  return {
    address,
    chainId: 56,
    coverage: { complete: true, failedPlatformIds: [], scannedPlatformIds: [1, 2, 4, 5] },
    cursor: null,
    items: [],
    quarantined: [],
    registryVersion: "p05-bsc-execution-v1",
    snapshot: {
      blockHash: `0x${"a".repeat(64)}`,
      blockNumber: "116718500",
      blockTimestamp: observedAt,
      digest: `0x${"b".repeat(64)}`,
    },
    status: "empty",
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

function fixture(overrides: Partial<FixtureState> = {}): FixtureState {
  return {
    authorizationMode: "direct",
    executeDelayMs: 500,
    executePayloads: [],
    idempotencyKeys: [],
    operationIndex: 0,
    operationSequence: ["signing", "broadcast", "pending", "succeeded"],
    previewPayloads: [],
    quoteError: null,
    quoteExpiresMs: null,
    quotePayloads: [],
    ...overrides,
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
            displayName: "P05-06 Fixture",
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
    if (path === "/api/swap/quote" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.quotePayloads.push(body);
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (state.quoteError) {
        await route.fulfill({
          contentType: "application/json",
          json: { error: { code: state.quoteError, retryable: false }, success: false },
          status: 409,
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: envelope(quoteResponse(body, state.quoteExpiresMs)),
      });
      return;
    }
    if (path === "/api/swap/execute/preview" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.previewPayloads.push(body);
      state.authorizationMode = body.authorizationMode as "direct" | "permit2";
      await new Promise((resolve) => setTimeout(resolve, 120));
      await route.fulfill({
        contentType: "application/json",
        json: envelope(preview(state.authorizationMode, state.quoteExpiresMs)),
      });
      return;
    }
    if (path === "/api/swap/execute" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.executePayloads.push(body);
      state.idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await new Promise((resolve) => setTimeout(resolve, state.executeDelayMs));
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation("queued", state.authorizationMode)),
        status: 202,
      });
      return;
    }
    if (path === `/api/chain-operations/${operationId}` && method === "GET") {
      const index = Math.min(state.operationIndex, state.operationSequence.length - 1);
      const phase = state.operationSequence[index] ?? "succeeded";
      state.operationIndex += 1;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(phase, state.authorizationMode, index + 1)),
      });
      return;
    }
    if (path === "/api/wallets" && method === "GET") {
      await route.fulfill({ contentType: "application/json", json: envelope({ items: [wallet()] }) });
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
          ownWallets: [{ address, name: "Local swap wallet", walletId }],
        }),
      });
      return;
    }
    if (path === "/api/pricing-positions" && method === "GET") {
      await route.fulfill({ contentType: "application/json", json: envelope({ items: [] }) });
      return;
    }
    if (path === "/api/pricing-positions/stream") {
      const snapshot = {
        cursor: "p05-06-empty-0",
        epoch,
        items: [],
        sequence: "0",
        type: "snapshot",
      };
      await route.fulfill({
        body: `retry: 60000\n\nid: ${snapshot.cursor}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Content-Type": "text/event-stream; charset=utf-8",
        },
        status: 200,
      });
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

async function requestQuote(page: Page) {
  const panel = page.getByTestId("local-swap-execution-panel");
  const button = panel.getByRole("button", { name: "获取报价" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-state", "quoting");
  await expect(panel).toHaveAttribute("data-state", "quoted");
  return panel;
}

async function previewAndSubmit(page: Page) {
  const previewCommand = page.getByRole("button", { name: "预览执行" });
  await previewCommand.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认本地 Swap" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("600000000000000");
  await expect(dialog).toContainText("1980");
  await expect(dialog).toContainText("0 bps");
  await expect(dialog.getByRole("list", { name: "执行预览步骤" }).locator("li")).toHaveCount(3);
  const confirm = dialog.getByRole("button", { name: "确认执行" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator("button.primary-button")).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

test("executes an exact-approval quote once and renders every replacement step", async ({
  page,
}, testInfo) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  const panel = page.getByTestId("local-swap-execution-panel");
  await expect(panel).toHaveAttribute("data-state", "idle");
  await expect(panel.getByRole("button", { name: "预览执行" })).toHaveCount(0);
  await requestQuote(page);
  await expect(panel).toContainText(helperAddress);
  await expect(panel.getByRole("radio", { name: "精确 Approve" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await previewAndSubmit(page);
  await expect(panel).toHaveAttribute("data-state", "queued");
  await expect(panel).toHaveAttribute("data-state", "signing", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "broadcast", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "pending", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 4_000 });
  await expect(panel.getByRole("list", { name: "本地 Swap operation steps" }).locator("> li")).toHaveCount(
    3,
  );
  await expect(panel).toContainText("第 2 代");
  await expect(panel).toContainText("余额、minOut、Helper 事件、allowance 与 canonical receipt 已核对");

  expect(state.quotePayloads).toEqual([
    {
      amountInBaseUnit: "1000",
      chainId: 31_337,
      slippageBps: 100,
      tokenIn,
      tokenOut,
      walletId,
    },
  ]);
  expect(state.previewPayloads).toEqual([{ authorizationMode: "direct", quoteDigest, walletId }]);
  expect(state.executePayloads).toEqual([
    { authorizationMode: "direct", previewDigest, previewToken, quoteDigest, walletId },
  ]);
  expect(state.idempotencyKeys).toHaveLength(1);
  expect(state.idempotencyKeys[0]).toMatch(/^local-swap-[0-9a-f-]{36}$/u);
  expect(JSON.stringify([...state.quotePayloads, ...state.previewPayloads, ...state.executePayloads])).not.toMatch(
    /target|router|spender|selector|calldata/iu,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await axe(page);
  await expect(panel).toHaveScreenshot("p05-06-local-swap-direct-succeeded.png", {
    animations: "disabled",
    caret: "hide",
  });
  if (captureEvidence) {
    const screenshot = await panel.screenshot({
      animations: "disabled",
      path: `artifacts/acceptance/P05-06/E-VIS/direct-succeeded-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(8_000);
  }
});

test("executes the Permit2 path with keyboard selection", async ({ page }) => {
  const state = fixture({ operationSequence: ["pending", "succeeded"] });
  await install(page, state);
  await page.goto("/wallets");
  const panel = await requestQuote(page);
  const permit2 = panel.getByRole("radio", { name: "Permit2" });
  await permit2.focus();
  await page.keyboard.press("Space");
  await expect(permit2).toHaveAttribute("aria-checked", "true");
  await previewAndSubmit(page);
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 4_000 });
  await expect(panel).toContainText("Permit2");
  expect(state.previewPayloads).toEqual([{ authorizationMode: "permit2", quoteDigest, walletId }]);
  expect(state.executePayloads).toEqual([
    { authorizationMode: "permit2", previewDigest, previewToken, quoteDigest, walletId },
  ]);
  await axe(page);
});

test("keeps a reverted Swap reconciling until allowance cleanup confirms", async ({ page }) => {
  const state = fixture({ operationSequence: ["reconciling", "reconciling", "failed"] });
  await install(page, state);
  await page.goto("/wallets");
  const panel = await requestQuote(page);
  await previewAndSubmit(page);
  await expect(panel).toHaveAttribute("data-state", "reconciling", { timeout: 3_000 });
  await expect(panel).toContainText("ALLOWANCE_CLEANUP_REQUIRED");
  const cleanup = panel.locator(".local-swap-operation-steps > li").filter({ hasText: "失败清理" });
  await expect(cleanup).toContainText("确认中");
  await expect(panel).toHaveAttribute("data-state", "failed", { timeout: 5_000 });
  await expect(cleanup).toContainText("成功");
  await expect(panel).toContainText("SWAP_REVERTED");
});

test("hides execution for changed, expired, or inactive-Helper quotes", async ({ page }) => {
  const state = fixture({ quoteExpiresMs: 800 });
  await install(page, state);
  await page.goto("/wallets");
  const panel = await requestQuote(page);
  await expect(panel.getByRole("button", { name: "预览执行" })).toBeVisible();
  await panel.getByLabel("本地 Swap 输入金额 base units").fill("1001");
  await expect(panel).toHaveAttribute("data-state", "stale");
  await expect(panel.getByRole("button", { name: "预览执行" })).toHaveCount(0);

  await panel.getByRole("button", { name: "获取报价" }).click();
  await expect(panel).toHaveAttribute("data-state", "quoted");
  await expect(panel).toHaveAttribute("data-state", "expired", { timeout: 2_000 });
  await expect(panel.getByRole("button", { name: "预览执行" })).toHaveCount(0);

  state.quoteError = "HELPER_NOT_ACTIVE";
  await panel.getByRole("button", { name: "获取报价" }).click();
  await expect(panel).toHaveAttribute("data-state", "error");
  await expect(panel.getByRole("alert")).toContainText("active 本地 Helper");
  await expect(panel.getByRole("button", { name: "预览执行" })).toHaveCount(0);
});
