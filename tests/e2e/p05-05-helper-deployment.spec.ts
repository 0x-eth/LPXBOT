import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_05 === "1";
const userId = "75000000-0000-4000-8000-000000000001";
const walletId = "75000000-0000-4000-8000-000000000011";
const operationId = "75000000-0000-4000-8000-000000000021";
const epoch = "75000000-0000-4000-8000-000000000091";
const address = `0x${"1".repeat(40)}`;
const expectedAddress = `0x${"2".repeat(40)}`;
const adapter = `0x${"3".repeat(40)}`;
const permit2 = `0x${"4".repeat(40)}`;
const runtimeHash = `0x${"5".repeat(64)}`;
const previewDigest = `sha256:${"6".repeat(64)}`;
const planDigest = `sha256:${"7".repeat(64)}`;
const transactionHash = `0x${"8".repeat(64)}`;
const replacementHash = `0x${"9".repeat(64)}`;
const previewToken = "A".repeat(43);
const observedAt = "2026-08-20T08:00:00.000Z";
const feeLimit = {
  feeCapBaseUnit: "1400000000000000",
  gasLimit: "700000",
  maxFeePerGasBaseUnit: "2000000000",
  maxPriorityFeePerGasBaseUnit: "1000000000",
};

type OperationState =
  | "broadcast"
  | "confirmed"
  | "dropped"
  | "failed"
  | "pending"
  | "queued"
  | "reconciling"
  | "signed"
  | "succeeded";

interface FixtureState {
  idempotencyKeys: string[];
  operationIndex: number;
  operationSequence: OperationState[];
  previewExpiresMs: number;
  previewPayloads: Record<string, unknown>[];
  submitDelayMs: number;
  submitError: string | null;
  submitPayloads: Record<string, unknown>[];
}

function envelope(data: unknown) {
  return { data, requestId: "p05-05-e2e", success: true };
}

function wallet() {
  return {
    address,
    createdAt: observedAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Local deployer",
    revision: 1,
    updatedAt: observedAt,
    walletId,
  };
}

function preview(expiresInMs: number) {
  return {
    chainId: 31_337,
    constructor: { adapter, owner: address, permit2 },
    expectedAddress,
    expectedRuntimeCodeHash: runtimeHash,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    feeLimit,
    helperVersion: "WalletHelperV1",
    nonce: "7",
    previewDigest,
    previewToken,
    registryVersion: "p05-local-helper-v2",
    walletId,
  };
}

function transactions(state: OperationState, recovered: boolean) {
  if (state === "queued") return [];
  if (recovered) {
    const activeState =
      state === "succeeded" || state === "confirmed"
        ? "confirmed"
        : state === "dropped" || state === "reconciling"
          ? "dropped"
          : state;
    return [
      { active: false, generation: 0, state: "replaced", transactionHash },
      { active: true, generation: 1, state: activeState, transactionHash: replacementHash },
    ];
  }
  const transactionState = state === "succeeded" ? "confirmed" : state;
  return [
    {
      active: true,
      generation: 0,
      state: transactionState,
      transactionHash: state === "signed" ? null : transactionHash,
    },
  ];
}

function operation(state: OperationState, index: number, recovered = false) {
  return {
    chainId: 31_337,
    createdAt: "2026-08-20T08:00:00.000Z",
    expectedAddress,
    failureCode: state === "failed" ? "HELPER_DEPLOYMENT_REVERTED" : null,
    feeLimit,
    helperVersion: "WalletHelperV1",
    nonce: "7",
    operationId,
    planDigest,
    reconciliationReason: state === "reconciling" ? "DROPPED_TRANSACTION_RECOVERY" : null,
    registryVersion: "p05-local-helper-v2",
    state,
    transactions: transactions(state, recovered),
    updatedAt: new Date(Date.parse(observedAt) + index * 1_000).toISOString(),
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
            displayName: "P05-05 Fixture",
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
    if (path === "/api/wallets/helper/deploy/preview" && method === "POST") {
      state.previewPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(preview(state.previewExpiresMs)),
      });
      return;
    }
    if (path === "/api/wallets/helper/deploy" && method === "POST") {
      state.submitPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      state.idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      if (state.submitDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.submitDelayMs));
      }
      if (state.submitError) {
        await route.fulfill({
          contentType: "application/json",
          json: { error: { code: state.submitError, retryable: false }, success: false },
          status: 409,
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation("queued", 0)),
        status: 202,
      });
      return;
    }
    if (path === `/api/chain-operations/${operationId}` && method === "GET") {
      const index = Math.min(state.operationIndex, state.operationSequence.length - 1);
      const current = state.operationSequence[index] ?? "succeeded";
      state.operationIndex += 1;
      const recovered =
        state.operationSequence.includes("dropped") &&
        index >= state.operationSequence.indexOf("dropped");
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(current, index + 1, recovered)),
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
          ownWallets: [{ address, name: "Local deployer", walletId }],
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
        cursor: "p05-05-empty-0",
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

function fixture(overrides: Partial<FixtureState> = {}): FixtureState {
  return {
    idempotencyKeys: [],
    operationIndex: 0,
    operationSequence: ["broadcast", "pending", "succeeded"],
    previewExpiresMs: 60_000,
    previewPayloads: [],
    submitDelayMs: 600,
    submitError: null,
    submitPayloads: [],
    ...overrides,
  };
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("previews, confirms once, and follows the local deployment operation to success", async ({
  page,
}, testInfo) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  const panel = page.getByTestId("helper-deployment-panel");
  const deploy = page.getByRole("button", { name: "部署 Helper" });
  await expect(panel).toHaveAttribute("data-state", "idle");
  await deploy.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "部署本地 Helper" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Local Anvil");
  await expect(dialog).toContainText("31337");
  await expect(dialog).toContainText(expectedAddress);
  await expect(dialog).toContainText(runtimeHash);
  await axe(page);

  if (captureEvidence) {
    const screenshot = await dialog.screenshot({
      animations: "disabled",
      path: `artifacts/acceptance/P05-05/E-VIS/helper-preview-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }

  const confirm = page.getByRole("button", { name: "确认部署" });
  const confirmButton = dialog.locator("button.primary-button");
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(confirmButton).toBeDisabled();
  await expect(confirmButton).toHaveAccessibleName("正在提交");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(panel).toHaveAttribute("data-state", "queued");
  await expect(panel).toHaveAttribute("data-state", "broadcast", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "pending", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 3_000 });
  await expect(panel).toContainText("Helper runtime 与 constructor 身份已验证");
  await expect(panel).toContainText(expectedAddress);

  expect(state.previewPayloads).toEqual([
    { chainId: 31_337, helperVersion: "WalletHelperV1", walletId },
  ]);
  expect(state.submitPayloads).toEqual([
    { chainId: 31_337, helperVersion: "WalletHelperV1", previewDigest, previewToken, walletId },
  ]);
  expect(state.idempotencyKeys).toHaveLength(1);
  expect(state.idempotencyKeys[0]).toMatch(/^helper-deploy-[0-9a-f-]{36}$/u);
  expect(JSON.stringify([...state.previewPayloads, ...state.submitPayloads])).not.toMatch(
    /bytecode|calldata|selector|target/iu,
  );
  for (const command of [/approve/iu, /broadcast/iu, /swap/iu, /批准/u, /资金/u, /转出/u]) {
    await expect(panel.getByRole("button", { name: command })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await axe(page);
  await expect(panel).toHaveScreenshot("p05-05-helper-deployment-succeeded.png", {
    animations: "disabled",
    caret: "hide",
  });
  if (captureEvidence) {
    const screenshot = await panel.screenshot({
      animations: "disabled",
      path: `artifacts/acceptance/P05-05/E-VIS/helper-succeeded-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(5_000);
  }
});

test("expires stale previews, surfaces digest conflicts, and restores keyboard focus", async ({
  page,
}) => {
  const state = fixture({ previewExpiresMs: 250 });
  await install(page, state);
  await page.goto("/wallets");
  const panel = page.getByTestId("helper-deployment-panel");
  const deploy = page.getByRole("button", { name: "部署 Helper" });
  await deploy.click();
  const dialog = page.getByRole("dialog", { name: "部署本地 Helper" });
  const confirm = page.getByRole("button", { name: "确认部署" });
  await expect(confirm).toBeDisabled({ timeout: 2_000 });
  await expect(dialog).toContainText("预览已过期");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deploy).toBeFocused();

  state.previewExpiresMs = 60_000;
  state.submitError = "PREVIEW_EXPIRED";
  await deploy.press("Enter");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "确认部署" }).click();
  await expect(dialog.getByRole("alert")).toContainText("部署预览已过期");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(deploy).toBeFocused();

  state.submitError = "IDEMPOTENCY_CONFLICT";
  await deploy.click();
  await page.getByRole("button", { name: "确认部署" }).click();
  await expect(dialog.getByRole("alert")).toContainText("重复提交内容冲突");
  await expect(panel).toHaveAttribute("data-state", "preview-ready");
  expect(state.submitPayloads).toHaveLength(2);
  expect(state.submitPayloads[0]).toEqual(state.submitPayloads[1]);
  await axe(page);
});

test("shows dropped recovery and terminal failure without exposing other Helper writes", async ({
  page,
}) => {
  const state = fixture({
    operationSequence: ["broadcast", "dropped", "reconciling", "broadcast", "succeeded"],
    submitDelayMs: 0,
  });
  await install(page, state);
  await page.goto("/wallets");
  const panel = page.getByTestId("helper-deployment-panel");
  await page.getByRole("button", { name: "部署 Helper" }).click();
  await page.getByRole("button", { name: "确认部署" }).click();
  await expect(panel).toHaveAttribute("data-state", "dropped", { timeout: 4_000 });
  await expect(panel).toHaveAttribute("data-state", "reconciling", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "broadcast", { timeout: 3_000 });
  await expect(panel).toHaveAttribute("data-state", "succeeded", { timeout: 3_000 });
  await expect(panel).toContainText(replacementHash.slice(0, 10));

  await page.reload();
  state.operationIndex = 0;
  state.operationSequence = ["failed"];
  state.previewPayloads = [];
  state.submitPayloads = [];
  await page.getByRole("button", { name: "部署 Helper" }).click();
  await page.getByRole("button", { name: "确认部署" }).click();
  await expect(panel).toHaveAttribute("data-state", "failed", { timeout: 3_000 });
  await expect(panel).toContainText("HELPER_DEPLOYMENT_REVERTED");
  await expect(page.getByRole("button", { name: "重新预览" })).toBeVisible();
  await axe(page);
});
