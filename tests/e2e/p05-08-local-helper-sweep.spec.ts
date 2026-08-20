import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_08 === "1";
const userId = "78000000-0000-4000-8000-000000000001";
const walletId = "78000000-0000-4000-8000-000000000011";
const bindingId = "78000000-0000-4000-8000-000000000012";
const batchId = "78000000-0000-4000-8000-000000000021";
const nativeOperationId = "78000000-0000-4000-8000-000000000031";
const tokenOperationId = "78000000-0000-4000-8000-000000000032";
const wbnbOperationId = "78000000-0000-4000-8000-000000000033";
const epoch = "78000000-0000-4000-8000-000000000091";
const walletAddress = `0x${"1".repeat(40)}`;
const helperAddress = `0x${"2".repeat(40)}`;
const adapterAddress = `0x${"3".repeat(40)}`;
const permit2Address = `0x${"4".repeat(40)}`;
const managerAddress = `0x${"5".repeat(40)}`;
const routerAddress = `0x${"6".repeat(40)}`;
const tokenAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const wbnbAddress = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const unknownTokenAddress = `0x${"7".repeat(40)}`;
const runtimeHash = `0x${"8".repeat(64)}`;
const blockHash = `0x${"9".repeat(64)}`;
const snapshotDigest = `sha256:${"a".repeat(64)}`;
const cleanSnapshotDigest = `sha256:${"b".repeat(64)}`;
const previewDigest = `sha256:${"c".repeat(64)}`;
const planDigest = `sha256:${"d".repeat(64)}`;
const registryDigest = `sha256:${"e".repeat(64)}`;
const previewToken = "A".repeat(43);
const transactionHash = `0x${"a".repeat(64)}`;
const replacementHash = `0x${"b".repeat(64)}`;
const tokenTransactionHash = `0x${"c".repeat(64)}`;
const droppedHash = `0x${"d".repeat(64)}`;
const wbnbReplacementHash = `0x${"e".repeat(64)}`;
const observedAt = "2099-08-20T08:00:00.000Z";
const expiresAt = "2099-08-20T08:10:00.000Z";
const deadline = "2099-08-20T08:05:00.000Z";
const previewExpiresAt = "2099-08-20T08:02:00.000Z";

const feeLimit = {
  feeCapBaseUnit: "400000000000000",
  gasLimit: "100000",
  maxFeePerGasBaseUnit: "4000000000",
  maxPriorityFeePerGasBaseUnit: "2000000000",
};

type BatchPhase = "queued" | "reconciling" | "running" | "succeeded";
type ManualMode = "all" | "none";

interface FixtureState {
  batchIndex: number;
  batchSequence: BatchPhase[];
  bscResidualReads: number;
  idempotencyKeys: string[];
  localResidualReads: number;
  manualMode: ManualMode;
  previewPayloads: Record<string, unknown>[];
  scanPayloads: Record<string, unknown>[];
  sweepPayloads: Record<string, unknown>[];
}

function fixture(overrides: Partial<FixtureState> = {}): FixtureState {
  return {
    batchIndex: 0,
    batchSequence: ["running", "reconciling", "succeeded"],
    bscResidualReads: 0,
    idempotencyKeys: [],
    localResidualReads: 0,
    manualMode: "none",
    previewPayloads: [],
    scanPayloads: [],
    sweepPayloads: [],
    ...overrides,
  };
}

function envelope(data: unknown) {
  return { data, requestId: "p05-08-e2e", success: true };
}

function wallet() {
  return {
    address: walletAddress,
    createdAt: observedAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Local Helper recovery wallet",
    revision: 1,
    updatedAt: observedAt,
    walletId,
  };
}

function balanceFixtures(clean: boolean) {
  return [
    {
      amountBaseUnit: clean ? "0" : "5000000000000000",
      assetId: "native:31337",
      dustBaseUnit: "1000",
      fixture: null,
      kind: "native",
      runtimeCodeHash: null,
      tokenAddress: null,
    },
    {
      amountBaseUnit: clean ? "0" : "4200000",
      assetId: `token:${tokenAddress}`,
      dustBaseUnit: "0",
      fixture: "TestOnlyERC20",
      kind: "token",
      runtimeCodeHash: runtimeHash,
      tokenAddress,
    },
    {
      amountBaseUnit: clean ? "0" : "9000000000000000",
      assetId: `token:${wbnbAddress}`,
      dustBaseUnit: "0",
      fixture: "TestOnlyWBNB",
      kind: "token",
      runtimeCodeHash: runtimeHash,
      tokenAddress: wbnbAddress,
    },
  ];
}

function residualSnapshot(options: { clean?: boolean; manualMode?: ManualMode } = {}) {
  const clean = options.clean ?? false;
  const manual = options.manualMode === "all";
  const degradationReasons = clean
    ? []
    : manual
      ? ["allowance-nonzero", "nft-custody", "unknown-token"]
      : ["residual-above-dust"];
  return {
    allowances: manual
      ? [
          {
            amountBaseUnit: "17",
            assetId: `allowance:${tokenAddress}:${routerAddress}`,
            spenderAddress: routerAddress,
            spenderRole: "router",
            tokenAddress,
          },
        ]
      : [],
    balances: balanceFixtures(clean),
    binding: {
      adapterAddress,
      bindingId,
      deploymentRegistryVersion: "p05-local-helper-deployment-v2",
      helperAddress,
      helperVersion: "WalletHelperV1",
      ownerAddress: walletAddress,
      permit2Address,
      runtimeCodeHash: runtimeHash,
      state: clean ? "active" : "degraded",
      verifiedBlockNumber: "99",
      walletId,
    },
    block: {
      hash: blockHash,
      number: clean ? "104" : "100",
      timestamp: "2099-08-20T07:59:59.000Z",
    },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons,
    expiresAt,
    identity: {
      bindingMatches: true,
      componentsMatch: true,
      observedOwner: walletAddress,
      observedRuntimeCodeHash: runtimeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: manual,
    nftCustody: manual
      ? [{ assetId: `nft:${managerAddress}:42`, managerAddress, tokenId: "42" }]
      : [],
    observedAt,
    registry: { digest: registryDigest, version: "p05-local-helper-sweep-v2" },
    schemaVersion: 2,
    snapshotDigest: clean ? cleanSnapshotDigest : snapshotDigest,
    snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    unknownTokens: manual
      ? [
          {
            amountBaseUnit: "23",
            assetId: `unknown-token:${unknownTokenAddress}`,
            runtimeCodeHash: runtimeHash,
            tokenAddress: unknownTokenAddress,
          },
        ]
      : [],
    wallet: { address: walletAddress, walletId },
  };
}

function sweepPreview() {
  const assets = balanceFixtures(false).map((asset) => ({
    amountBaseUnit: asset.amountBaseUnit,
    assetId: asset.assetId,
    dustBaseUnit: asset.dustBaseUnit,
    feeLimit,
    kind: asset.kind,
    recipient: walletAddress,
    tokenAddress: asset.tokenAddress,
  }));
  return {
    assets,
    chainId: 31_337,
    deadline,
    expiresAt: previewExpiresAt,
    feeLimitTotalBaseUnit: "1200000000000000",
    helperAddress,
    manualRecoveryRequired: false,
    previewDigest,
    previewToken,
    recipient: walletAddress,
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest,
    walletId,
  };
}

function transaction(
  generation: number,
  state: "dropped" | "pending" | "replaced" | "succeeded",
  hash: string,
  active: boolean,
) {
  return {
    active,
    generation,
    maxFeePerGasBaseUnit: generation === 0 ? "4000000000" : "5000000000",
    maxPriorityFeePerGasBaseUnit: generation === 0 ? "2000000000" : "2500000000",
    state,
    transactionHash: hash,
  };
}

function operation(
  operationId: string,
  assetId: string,
  nonce: string,
  kind: "native" | "token",
  phase: BatchPhase,
  token: string | null,
  index: number,
) {
  const terminal = phase === "succeeded";
  const reconciling = phase === "reconciling";
  const transactions =
    phase === "queued"
      ? []
      : index === 0
        ? [
            transaction(0, "replaced", transactionHash, false),
            transaction(1, terminal ? "succeeded" : "pending", replacementHash, true),
          ]
        : index === 1
          ? [
              transaction(
                0,
                terminal || reconciling ? "succeeded" : "pending",
                tokenTransactionHash,
                true,
              ),
            ]
          : [
              transaction(0, "dropped", droppedHash, false),
              transaction(1, terminal ? "succeeded" : "pending", wbnbReplacementHash, true),
            ];
  return {
    amountBaseUnit:
      kind === "native" ? "5000000000000000" : index === 1 ? "4200000" : "9000000000000000",
    assetId,
    assetKind: kind,
    batchId,
    chainId: 31_337,
    createdAt: "2099-08-20T08:00:01.000Z",
    failureCode: null,
    feeLimit,
    helperAddress,
    nonce,
    operationId,
    operationKind: "helper-residual-sweep",
    planDigest,
    recipient: walletAddress,
    reconciliationReason: reconciling ? "CANONICAL_RESCAN_REQUIRED" : null,
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest,
    state: terminal
      ? "succeeded"
      : reconciling
        ? "reconciling"
        : phase === "queued"
          ? "queued"
          : "pending",
    tokenAddress: token,
    transactions,
    updatedAt: new Date(Date.parse(observedAt) + (index + 2) * 1_000).toISOString(),
    walletId,
  };
}

function batch(phase: BatchPhase) {
  return {
    batchId,
    chainId: 31_337,
    createdAt: "2099-08-20T08:00:01.000Z",
    helperAddress,
    operations: [
      operation(nativeOperationId, "native:31337", "7", "native", phase, null, 0),
      operation(tokenOperationId, `token:${tokenAddress}`, "8", "token", phase, tokenAddress, 1),
      operation(wbnbOperationId, `token:${wbnbAddress}`, "9", "token", phase, wbnbAddress, 2),
    ],
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest,
    state: phase,
    updatedAt: new Date(
      Date.parse(observedAt) + (phase === "succeeded" ? 8 : 4) * 1_000,
    ).toISOString(),
    walletId,
  };
}

function positionPage() {
  return {
    address: walletAddress,
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
      digest: `0x${"f".repeat(64)}`,
    },
    status: "empty",
    walletId,
  };
}

async function install(page: Page, state: FixtureState) {
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56, 31_337],
            avatarUrl: null,
            displayName: "P05-08 Fixture",
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
    if (path === "/api/wallets/helper-residuals" && method === "GET") {
      if (url.searchParams.get("chainId") === "31337") {
        state.localResidualReads += 1;
        const clean = state.batchIndex >= state.batchSequence.length;
        await route.fulfill({
          contentType: "application/json",
          json: envelope(residualSnapshot({ clean, manualMode: state.manualMode })),
        });
      } else {
        state.bscResidualReads += 1;
        await route.fulfill({ contentType: "application/json", json: envelope(null) });
      }
      return;
    }
    if (path === "/api/wallets/helper-residuals/scan" && method === "POST") {
      state.scanPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(residualSnapshot({ manualMode: state.manualMode })),
      });
      return;
    }
    if (path === "/api/wallets/helper-residuals/sweep/preview" && method === "POST") {
      state.previewPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      await route.fulfill({ contentType: "application/json", json: envelope(sweepPreview()) });
      return;
    }
    if (path === "/api/wallets/helper-residuals/sweep" && method === "POST") {
      state.sweepPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      state.idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        contentType: "application/json",
        json: envelope(batch("queued")),
        status: 202,
      });
      return;
    }
    if (path === `/api/chain-operation-batches/${batchId}` && method === "GET") {
      const phase = state.batchSequence[state.batchIndex] ?? "succeeded";
      state.batchIndex += 1;
      await route.fulfill({ contentType: "application/json", json: envelope(batch(phase)) });
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
          address: walletAddress,
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
          address: walletAddress,
          amountBaseUnit: null,
          amountDecimal: null,
          chainId: 56,
          eip681: `ethereum:${walletAddress}@56`,
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
          owner: walletAddress,
          registryVersion: "p05-bsc-execution-v1",
          state: "undeployed",
          verification: null,
          walletId,
        }),
      });
      return;
    }
    if (path === "/api/positions/local-current") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          chainId: 31_337,
          executionEnabled: false,
          items: [],
          registryVersion: "p05-local-position-execution-v2",
          serviceFeeBps: 0,
          walletId,
        }),
      });
      return;
    }
    if (path === "/api/address-book") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          chainId: 56,
          classification: null,
          entries: [],
          ownWallets: [{ address: walletAddress, name: "Local Helper recovery wallet", walletId }],
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
        cursor: "p05-08-empty-0",
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
  const panel = page.getByTestId("local-helper-sweep-panel");
  await expect(panel).toHaveAttribute(
    "data-state",
    state.manualMode === "all" ? "manual-recovery-required" : "degraded",
  );
  return panel;
}

test("sweeps a mixed batch once and renders canonical per-asset recovery", async ({
  page,
}, testInfo) => {
  const state = fixture();
  const panel = await openPanel(page, state);
  await expect(panel).toContainText("Local Anvil");
  await expect(panel).toContainText("p05-local-helper-sweep-v2");
  const assets = panel.getByRole("group", { name: "选择超过 dust 的资产" });
  const checkboxes = assets.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await expect(checkboxes.nth(index)).toBeChecked();
  await checkboxes.nth(2).focus();
  await page.keyboard.press("Space");
  await expect(checkboxes.nth(2)).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(checkboxes.nth(2)).toBeChecked();

  const previewCommand = panel.getByRole("button", { name: "预览逐资产恢复" });
  await previewCommand.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认 Helper 残留恢复" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("3 个独立 operation");
  await expect(dialog).toContainText("1200000000000000 wei");
  await expect(dialog).toContainText(walletAddress);
  await expect(
    dialog.getByRole("list", { name: "Helper sweep 资产预览" }).locator("li"),
  ).toHaveCount(3);

  const confirm = dialog.getByRole("button", { name: "确认逐资产执行" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator("button.primary-button")).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(panel).toHaveAttribute("data-state", "queued");
  await expect(panel).toHaveAttribute("data-state", "running", { timeout: 3_000 });
  await expect(panel).toContainText("第 2 代");
  await expect(panel).toContainText("已替换");
  await expect(panel).toContainText("已丢弃");
  await expect(panel).toHaveAttribute("data-state", "reconciling", { timeout: 4_000 });
  await expect(panel).toContainText("CANONICAL_RESCAN_REQUIRED");
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 5_000 });
  await expect(
    panel.getByRole("list", { name: "Helper sweep 逐资产状态" }).locator(":scope > li"),
  ).toHaveCount(3);
  await expect(panel).toContainText("3 / 3");
  await expect(panel).toContainText(
    "canonical receipt、余额、allowance、NFT custody、code hash 与 owner 已完整复扫",
  );

  const assetIds = ["native:31337", `token:${tokenAddress}`, `token:${wbnbAddress}`];
  expect(state.previewPayloads).toEqual([{ assetIds, chainId: 31_337, snapshotDigest, walletId }]);
  expect(state.sweepPayloads).toEqual([
    { assetIds, chainId: 31_337, previewDigest, previewToken, snapshotDigest, walletId },
  ]);
  expect(state.idempotencyKeys).toHaveLength(1);
  expect(state.idempotencyKeys[0]).toMatch(/^local-helper-sweep-[0-9a-f-]{36}$/u);
  expect(JSON.stringify([...state.previewPayloads, ...state.sweepPayloads])).not.toMatch(
    /"(?:helper|token|target|selector|calldata|amount|recipient|fee)"\s*:/u,
  );
  expect(state.localResidualReads).toBeGreaterThanOrEqual(2);
  expect(state.bscResidualReads).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await axe(page);
  await expect(panel).toHaveScreenshot("p05-08-local-helper-sweep-succeeded.png", {
    animations: "disabled",
    caret: "hide",
  });
  if (captureEvidence) {
    const screenshot = await panel.screenshot({
      animations: "disabled",
      path: `artifacts/acceptance/P05-08/E-VIS/sweep-succeeded-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(8_000);
  }
});

test("blocks arbitrary sweep controls for allowance, NFT custody, and unknown Token", async ({
  page,
}) => {
  const state = fixture({ manualMode: "all" });
  const panel = await openPanel(page, state);
  await expect(panel).toContainText("manual-recovery-required");
  await expect(panel).toContainText("Allowance router: 17");
  await expect(panel).toContainText("NFT custody: Token #42");
  await expect(panel).toContainText("Unknown Token: 23 base units");
  await expect(panel.getByRole("button", { name: "预览逐资产恢复" })).toBeDisabled();
  await expect(panel.getByRole("textbox")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /确认逐资产执行/u })).toHaveCount(0);
  expect(state.previewPayloads).toEqual([]);
  expect(state.sweepPayloads).toEqual([]);
  await axe(page);
});

test("keeps the BSC residual reader read-only and separate from local sweep", async ({ page }) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  const bscPanel = page.getByTestId("helper-residual-panel");
  await expect(bscPanel).toContainText("残留资产");
  await expect(bscPanel.getByRole("button", { name: "重新扫描残留资产" })).toBeVisible();
  await expect(bscPanel.getByRole("button", { name: /预览|执行|sweep|rescue/iu })).toHaveCount(0);
  await expect(page.getByTestId("local-helper-sweep-panel")).toContainText("Local Anvil");
  expect(state.bscResidualReads).toBeGreaterThanOrEqual(1);
  expect(state.previewPayloads).toEqual([]);
  expect(state.sweepPayloads).toEqual([]);
  await axe(page);
});
