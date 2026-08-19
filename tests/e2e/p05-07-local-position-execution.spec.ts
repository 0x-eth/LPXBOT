import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_07 === "1";
const userId = "77000000-0000-4000-8000-000000000001";
const walletId = "77000000-0000-4000-8000-000000000011";
const collectOperationId = "77000000-0000-4000-8000-000000000021";
const removeOperationId = "77000000-0000-4000-8000-000000000022";
const address = `0x${"1".repeat(40)}`;
const managerAddress = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853";
const token0 = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const token1 = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const snapshotDigest = `sha256:${"2".repeat(64)}`;
const previewDigest = `sha256:${"3".repeat(64)}`;
const planDigest = `sha256:${"4".repeat(64)}`;
const previewToken = "A".repeat(43);
const transactionHash = `0x${"5".repeat(64)}`;
const replacementHash = `0x${"6".repeat(64)}`;
const burnHash = `0x${"7".repeat(64)}`;
const blockHash = `0x${"8".repeat(64)}`;
const runtimeHash = `0x${"9".repeat(64)}`;
const abiHash = `sha256:${"a".repeat(64)}`;
const registryDigest = `sha256:${"b".repeat(64)}`;
const observedAt = "2099-08-20T08:00:00.000Z";
const expiresAt = "2099-08-20T08:10:00.000Z";
const deadline = "2099-08-20T08:05:00.000Z";
const previewExpiresAt = "2099-08-20T08:02:00.000Z";
const epoch = "77000000-0000-4000-8000-000000000091";

const collectFee = {
  feeCapBaseUnit: "720000000000000",
  gasLimit: "180000",
  maxFeePerGasBaseUnit: "4000000000",
  maxPriorityFeePerGasBaseUnit: "2000000000",
};
const decreaseFee = {
  feeCapBaseUnit: "880000000000000",
  gasLimit: "220000",
  maxFeePerGasBaseUnit: "4000000000",
  maxPriorityFeePerGasBaseUnit: "2000000000",
};
const burnFee = {
  feeCapBaseUnit: "400000000000000",
  gasLimit: "100000",
  maxFeePerGasBaseUnit: "4000000000",
  maxPriorityFeePerGasBaseUnit: "2000000000",
};

type Phase = "pending" | "queued" | "reconciling" | "succeeded";

interface FixtureState {
  closed: boolean;
  executePayloads: Record<string, unknown>[];
  idempotencyKeys: string[];
  mode: "collect" | "remove";
  operationIndex: number;
  operationSequence: Phase[];
  owed0: string;
  owed1: string;
  previewPayloads: Record<string, unknown>[];
}

function envelope(data: unknown) {
  return { data, requestId: "p05-07-e2e", success: true };
}

function fixture(overrides: Partial<FixtureState> = {}): FixtureState {
  return {
    closed: false,
    executePayloads: [],
    idempotencyKeys: [],
    mode: "collect",
    operationIndex: 0,
    operationSequence: ["pending", "reconciling", "succeeded"],
    owed0: "17",
    owed1: "23",
    previewPayloads: [],
    ...overrides,
  };
}

function wallet() {
  return {
    address,
    createdAt: observedAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Local position wallet",
    revision: 1,
    updatedAt: observedAt,
    walletId,
  };
}

function snapshot(state: FixtureState) {
  return {
    block: { hash: blockHash, number: "100", timestamp: observedAt },
    chainId: 31_337,
    expiresAt,
    manager: { abiHash, address: managerAddress, runtimeCodeHash: runtimeHash },
    observedAt,
    position: {
      approval: { approvedAddress: null, approvedForAll: false, operator: null },
      liquidity: "1001",
      owner: address,
      platformId: 1,
      pool: {
        feePips: "3000",
        poolAddress: `0x${"c".repeat(40)}`,
        poolId: null,
        tickSpacing: "60",
        token0,
        token1,
      },
      reserve0BaseUnit: "10000",
      reserve1BaseUnit: "20000",
      ticks: { lower: "-120", upper: "120" },
      tokenId: "42",
      tokensOwed0BaseUnit: state.owed0,
      tokensOwed1BaseUnit: state.owed1,
    },
    registry: { digest: registryDigest, version: "p05-local-position-execution-v2" },
    schemaVersion: 2,
    snapshotDigest,
    snapshotVersion: "p05-local-position-snapshot-v2",
    tokens: [
      { address: token0, runtimeCodeHash: runtimeHash },
      { address: token1, runtimeCodeHash: runtimeHash },
    ],
    wallet: { address, walletId },
  };
}

function currentPage(state: FixtureState) {
  return {
    chainId: 31_337,
    executionEnabled: !state.closed,
    items: state.closed ? [] : [snapshot(state)],
    registryVersion: "p05-local-position-execution-v2",
    serviceFeeBps: 0,
    walletId,
  };
}

function collectPreview(state: FixtureState) {
  return {
    burnIfEmpty: false,
    chainId: 31_337,
    deadline,
    expectedToken0DeltaBaseUnit: state.owed0,
    expectedToken1DeltaBaseUnit: state.owed1,
    expiresAt: previewExpiresAt,
    feeLimitTotalBaseUnit: collectFee.feeCapBaseUnit,
    feeProceeds0BaseUnit: state.owed0,
    feeProceeds1BaseUnit: state.owed1,
    liquidityDelta: "0",
    managerAddress,
    minPrincipal0BaseUnit: "0",
    minPrincipal1BaseUnit: "0",
    operationKind: "position-collect-fees",
    percent: null,
    platformId: 1,
    previewDigest,
    previewToken,
    principal0BaseUnit: "0",
    principal1BaseUnit: "0",
    remainingLiquidity: "1001",
    serviceFeeBps: 0,
    slippageBps: null,
    snapshotDigest,
    steps: [{ feeLimit: collectFee, kind: "collect", ordinal: 0 }],
    tokenId: "42",
    walletId,
  };
}

function removePreview(body: Record<string, unknown>) {
  const percent = Number(body.percent);
  const full = percent === 100;
  const delta = full ? 1001n : (1001n * BigInt(percent)) / 100n;
  const principal0 = full ? 10000n : (10000n * delta) / 1001n;
  const principal1 = full ? 20000n : (20000n * delta) / 1001n;
  const steps = [
    { feeLimit: decreaseFee, kind: "decrease", ordinal: 0 },
    { feeLimit: collectFee, kind: "collect", ordinal: 1 },
    ...(body.burnIfEmpty ? [{ feeLimit: burnFee, kind: "burn", ordinal: 2 }] : []),
  ];
  return {
    burnIfEmpty: body.burnIfEmpty,
    chainId: 31_337,
    deadline,
    expectedToken0DeltaBaseUnit: (principal0 + 17n).toString(),
    expectedToken1DeltaBaseUnit: (principal1 + 23n).toString(),
    expiresAt: previewExpiresAt,
    feeLimitTotalBaseUnit: steps
      .reduce((total, step) => total + BigInt(step.feeLimit.feeCapBaseUnit), 0n)
      .toString(),
    feeProceeds0BaseUnit: "17",
    feeProceeds1BaseUnit: "23",
    liquidityDelta: delta.toString(),
    managerAddress,
    minPrincipal0BaseUnit: ((principal0 * 9900n) / 10000n).toString(),
    minPrincipal1BaseUnit: ((principal1 * 9900n) / 10000n).toString(),
    operationKind: "position-remove-liquidity",
    percent,
    platformId: 1,
    previewDigest,
    previewToken,
    principal0BaseUnit: principal0.toString(),
    principal1BaseUnit: principal1.toString(),
    remainingLiquidity: (1001n - delta).toString(),
    serviceFeeBps: 0,
    slippageBps: body.slippageBps,
    snapshotDigest,
    steps,
    tokenId: "42",
    walletId,
  };
}

function transaction(
  generation: number,
  state: "pending" | "replaced" | "succeeded",
  transactionHashValue: string,
  active: boolean,
) {
  return {
    active,
    generation,
    maxFeePerGasBaseUnit: generation === 0 ? "2000000000" : "3000000000",
    maxPriorityFeePerGasBaseUnit: generation === 0 ? "1000000000" : "1500000000",
    state,
    transactionHash: transactionHashValue,
  };
}

function step(
  kind: "burn" | "collect" | "decrease",
  ordinal: number,
  state: string,
  transactions: ReturnType<typeof transaction>[],
) {
  return {
    failureCode: null,
    feeLimit: kind === "decrease" ? decreaseFee : kind === "collect" ? collectFee : burnFee,
    kind,
    nonce: String(7 + ordinal),
    ordinal,
    state,
    stepId: `77000000-0000-4000-8000-${String(31 + ordinal).padStart(12, "0")}`,
    transactions,
  };
}

function operation(state: FixtureState, phase: Phase, index = 0) {
  const createdAt = "2099-08-20T08:00:01.000Z";
  const updatedAt = new Date(Date.parse(createdAt) + (index + 1) * 1_000).toISOString();
  if (state.mode === "collect") {
    const pending = phase !== "queued" && phase !== "succeeded";
    return {
      burnIfEmpty: false,
      chainId: 31_337,
      createdAt,
      failureCode: null,
      managerAddress,
      operationId: collectOperationId,
      operationKind: "position-collect-fees",
      percent: null,
      planDigest,
      platformId: 1,
      reconciliationReason: phase === "reconciling" ? "CANONICAL_RECEIPT_RECHECK" : null,
      registryVersion: "p05-local-position-execution-v2",
      slippageBps: null,
      snapshotDigest,
      state: phase,
      steps: [
        step(
          "collect",
          0,
          phase === "queued" ? "queued" : phase === "succeeded" ? "succeeded" : "pending",
          phase === "queued"
            ? []
            : [
                transaction(0, "replaced", transactionHash, false),
                transaction(1, pending ? "pending" : "succeeded", replacementHash, true),
              ],
        ),
      ],
      tokenId: "42",
      updatedAt,
      walletId,
    };
  }
  const collectSucceeded = phase === "reconciling" || phase === "succeeded";
  return {
    burnIfEmpty: true,
    chainId: 31_337,
    createdAt,
    failureCode: null,
    managerAddress,
    operationId: removeOperationId,
    operationKind: "position-remove-liquidity",
    percent: 100,
    planDigest,
    platformId: 1,
    reconciliationReason: phase === "reconciling" ? "BURN_RETRY_REQUIRED" : null,
    registryVersion: "p05-local-position-execution-v2",
    slippageBps: 100,
    snapshotDigest,
    state: phase,
    steps: [
      step(
        "decrease",
        0,
        phase === "queued" ? "queued" : "succeeded",
        phase === "queued" ? [] : [transaction(0, "succeeded", transactionHash, true)],
      ),
      step(
        "collect",
        1,
        phase === "queued" ? "blocked" : collectSucceeded ? "succeeded" : "pending",
        phase === "queued"
          ? []
          : [
              transaction(0, "replaced", transactionHash, false),
              transaction(1, collectSucceeded ? "succeeded" : "pending", replacementHash, true),
            ],
      ),
      step(
        "burn",
        2,
        phase === "reconciling" ? "pending" : phase === "succeeded" ? "succeeded" : "blocked",
        phase === "reconciling"
          ? [transaction(0, "pending", burnHash, true)]
          : phase === "succeeded"
            ? [transaction(0, "succeeded", burnHash, true)]
            : [],
      ),
    ],
    tokenId: "42",
    updatedAt,
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
      blockHash,
      blockNumber: "116718500",
      blockTimestamp: observedAt,
      digest: `0x${"d".repeat(64)}`,
    },
    status: "empty",
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
            allowedChainIds: state.closed ? [56] : [56, 31_337],
            avatarUrl: null,
            displayName: "P05-07 Fixture",
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
    if (path === "/api/positions/local-current" && method === "GET") {
      await route.fulfill({ contentType: "application/json", json: envelope(currentPage(state)) });
      return;
    }
    if (path === "/api/positions/collect-fees/preview" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.mode = "collect";
      state.previewPayloads.push(body);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(collectPreview(state)),
      });
      return;
    }
    if (path === "/api/positions/remove-liquidity/preview" && method === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.mode = "remove";
      state.previewPayloads.push(body);
      await route.fulfill({ contentType: "application/json", json: envelope(removePreview(body)) });
      return;
    }
    if (
      (path === "/api/positions/collect-fees" || path === "/api/positions/remove-liquidity") &&
      method === "POST"
    ) {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      state.executePayloads.push(body);
      state.idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(state, "queued")),
        status: 202,
      });
      return;
    }
    if (
      (path === `/api/chain-operations/${collectOperationId}` ||
        path === `/api/chain-operations/${removeOperationId}`) &&
      method === "GET"
    ) {
      const index = Math.min(state.operationIndex, state.operationSequence.length - 1);
      const phase = state.operationSequence[index] ?? "succeeded";
      state.operationIndex += 1;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(state, phase, index + 1)),
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
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          address: null,
          chainId: 56,
          failures: [],
          helperVersion: null,
          owner: address,
          registryVersion: "p05-bsc-execution-v1",
          state: "undeployed",
          verification: null,
          walletId,
        }),
      });
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
          ownWallets: [{ address, name: "Local position wallet", walletId }],
        }),
      });
      return;
    }
    if (path === "/api/pricing-positions" && method === "GET") {
      await route.fulfill({ contentType: "application/json", json: envelope({ items: [] }) });
      return;
    }
    if (path === "/api/pricing-positions/stream") {
      const stream = {
        cursor: "p05-07-empty-0",
        epoch,
        items: [],
        sequence: "0",
        type: "snapshot",
      };
      await route.fulfill({
        body: `retry: 60000\n\nid: ${stream.cursor}\nevent: snapshot\ndata: ${JSON.stringify(stream)}\n\n`,
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

async function openPanel(page: Page, state: FixtureState) {
  await install(page, state);
  await page.goto("/wallets");
  const panel = page.getByTestId("local-position-execution-panel");
  await expect(panel).toHaveAttribute("data-state", "ready");
  return panel;
}

async function confirmDialog(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "确认执行" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

test("collects a zero-owed snapshot once with canonical operation polling", async ({ page }) => {
  const state = fixture({ mode: "collect", owed0: "0", owed1: "0" });
  const panel = await openPanel(page, state);
  await expect(panel).toContainText("Uniswap V3");
  const preview = panel.getByRole("button", { name: "预览收取" });
  await preview.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认收取手续费" });
  await expect(dialog).toContainText("Token0 预期增量");
  await expect(dialog.getByRole("list", { name: "仓位执行预览步骤" }).locator("li")).toHaveCount(1);
  await confirmDialog(page, "确认收取手续费");
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 6_000 });
  await expect(panel).toContainText("canonical receipt、owed 数量与钱包 token 增量已核对");
  await expect(panel).toContainText("第 2 代");
  expect(state.previewPayloads).toEqual([
    { platformId: 1, snapshotDigest, tokenId: "42", walletId },
  ]);
  expect(state.executePayloads).toEqual([
    { platformId: 1, previewDigest, previewToken, snapshotDigest, tokenId: "42", walletId },
  ]);
  expect(state.idempotencyKeys).toHaveLength(1);
  expect(state.idempotencyKeys[0]).toMatch(/^local-position-collect-[0-9a-f-]{36}$/u);
  await axe(page);
});

test("recovers a full decrease, collect and burn sequence with replacement lineage", async ({
  page,
}, testInfo) => {
  const state = fixture({ mode: "remove" });
  const panel = await openPanel(page, state);
  const removeTab = panel.getByRole("tab", { name: "撤出流动性" });
  await removeTab.focus();
  await page.keyboard.press("Enter");
  const full = panel.getByRole("radio", { name: "100%" });
  await full.focus();
  await page.keyboard.press("Space");
  await expect(full).toHaveAttribute("aria-checked", "true");
  const burn = panel.getByRole("checkbox", { name: "空仓后 Burn NFT" });
  await burn.focus();
  await page.keyboard.press("Space");
  await expect(burn).toBeChecked();
  const command = panel.getByRole("button", { name: "预览撤出" });
  await command.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认撤出流动性" });
  await expect(dialog).toContainText("1001");
  await expect(dialog).toContainText("2000000000000000");
  await expect(dialog.getByRole("list", { name: "仓位执行预览步骤" }).locator("li")).toHaveCount(3);
  await confirmDialog(page, "确认撤出流动性");
  await expect(panel).toHaveAttribute("data-state", "pending", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "reconciling", { timeout: 4_000 });
  await expect(panel).toContainText("BURN_RETRY_REQUIRED");
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 5_000 });
  await expect(
    panel.getByRole("list", { name: "本地仓位 operation steps" }).locator(":scope > li"),
  ).toHaveCount(3);
  await expect(panel).toContainText("第 2 代");
  await expect(panel).toContainText("decrease principal、collect fee proceeds 与 burn 条件已核对");
  expect(state.previewPayloads).toEqual([
    {
      burnIfEmpty: true,
      percent: 100,
      platformId: 1,
      slippageBps: 100,
      snapshotDigest,
      tokenId: "42",
      walletId,
    },
  ]);
  expect(state.executePayloads).toEqual([
    {
      burnIfEmpty: true,
      percent: 100,
      platformId: 1,
      previewDigest,
      previewToken,
      slippageBps: 100,
      snapshotDigest,
      tokenId: "42",
      walletId,
    },
  ]);
  expect(JSON.stringify([...state.previewPayloads, ...state.executePayloads])).not.toMatch(
    /manager|target|selector|calldata|recipient|liquidityDelta|amount0Max|amount1Max|amount0Min|amount1Min|fee/iu,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await axe(page);
  await expect(panel).toHaveScreenshot("p05-07-local-position-remove-succeeded.png", {
    animations: "disabled",
    caret: "hide",
  });
  if (captureEvidence) {
    const screenshot = await panel.screenshot({
      animations: "disabled",
      path: `artifacts/acceptance/P05-07/E-VIS/remove-succeeded-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(8_000);
  }
});

test("supports 1/25/50/99/100 percent controls and forbids burn on partial removal", async ({
  page,
}) => {
  const state = fixture({ mode: "remove", operationSequence: ["succeeded"] });
  const panel = await openPanel(page, state);
  await panel.getByRole("tab", { name: "撤出流动性" }).click();
  const burn = panel.getByRole("checkbox", { name: "空仓后 Burn NFT" });
  for (const percent of [1, 25, 50, 99, 100]) {
    const preset = panel.getByRole("radio", { name: `${percent}%` });
    await preset.click();
    await expect(preset).toHaveAttribute("aria-checked", "true");
    if (percent === 100) await expect(burn).toBeEnabled();
    else await expect(burn).toBeDisabled();
  }
  await panel.getByRole("radio", { name: "25%" }).click();
  await panel.getByRole("button", { name: "预览撤出" }).click();
  const dialog = page.getByRole("dialog", { name: "确认撤出流动性" });
  await expect(dialog.getByRole("list", { name: "仓位执行预览步骤" }).locator("li")).toHaveCount(2);
  await expect(dialog).toContainText("751");
  expect(state.previewPayloads).toEqual([
    {
      burnIfEmpty: false,
      percent: 25,
      platformId: 1,
      slippageBps: 100,
      snapshotDigest,
      tokenId: "42",
      walletId,
    },
  ]);
  await axe(page);
});

test("keeps the chainId 56 view free of local position signing controls when gate is closed", async ({
  page,
}) => {
  const state = fixture({ closed: true });
  await install(page, state);
  await page.goto("/wallets");
  await expect(page.getByTestId("local-position-execution-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /预览收取|预览撤出|确认执行/u })).toHaveCount(0);
  expect(state.previewPayloads).toEqual([]);
  expect(state.executePayloads).toEqual([]);
  await axe(page);
});
