import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P04_06 === "1";
const userId = "5b000000-0000-4000-8000-000000000001";
const walletId = "5b000000-0000-4000-8000-000000000011";
const entryId = "5b000000-0000-4000-8000-000000000021";
const operationId = "5b000000-0000-4000-8000-000000000031";
const firstTransactionId = "5b000000-0000-4000-8000-000000000041";
const replacementTransactionId = "5b000000-0000-4000-8000-000000000042";
const walletAddress = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const tokenAddress = "0x1111111111111111111111111111111111111111";
const knownAddress = "0x2222222222222222222222222222222222222222";
const newAddress = "0x3333333333333333333333333333333333333333";
const digest = `sha256:${"ab".repeat(32)}`;
const policyDigest = `sha256:${"cd".repeat(32)}`;
const securityPassword = "synthetic-transfer-password";

type Asset = { kind: "native" } | { kind: "erc20"; tokenAddress: string };
type TransferState =
  | "ready-for-approval"
  | "queued"
  | "signed"
  | "broadcast"
  | "pending"
  | "confirmed"
  | "failed"
  | "dropped"
  | "replaced"
  | "reconciling";
type ObservedState = TransferState | "replacement-broadcast";

interface TransferPreviewRequest {
  amount: { amountBaseUnit: string; kind: "exact" } | { kind: "preset"; preset: string };
  asset: Asset;
  chainId: number;
  recipient: string;
  walletId: string;
}

interface TransferFixture {
  initialState: TransferState;
  pollSequence: ObservedState[];
  pollCount: number;
  previewRequests: TransferPreviewRequest[];
  submitBodies: Array<Record<string, unknown>>;
  submitHeaders: Array<Record<string, string>>;
  submitStatus?: number;
}

function envelope(data: unknown) {
  return { data, requestId: "p04-06-e2e", success: true };
}

function errorEnvelope(code: string, retryable = false) {
  return {
    error: { code, message: "local fixture detail", requestId: "p04-06-e2e", retryable },
    success: false,
  };
}

function wallet() {
  return {
    address: walletAddress,
    createdAt: "2026-08-18T14:00:00.000Z",
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Treasury signer",
    revision: 1,
    updatedAt: "2026-08-18T14:00:00.000Z",
    walletId,
  };
}

function balances() {
  return {
    address: walletAddress,
    blockNumberDecimal: "42",
    chainId: 56,
    items: [
      {
        assetType: "native",
        balanceBaseUnit: "2000000000000000000",
        balanceDecimal: "2",
        decimals: 18,
        default: true,
        name: "BNB",
        priceStatus: "current",
        symbol: "BNB",
        tokenAddress: null,
        usdPriceDecimal: "300",
        usdValueDecimal: "600",
      },
      {
        assetType: "erc20",
        balanceBaseUnit: "5000000",
        balanceDecimal: "5",
        decimals: 6,
        default: false,
        name: "Fixture Dollar",
        priceStatus: "current",
        symbol: "FIX",
        tokenAddress,
        usdPriceDecimal: "1",
        usdValueDecimal: "5",
      },
    ],
    readAt: "2026-08-18T14:00:00.000Z",
    totalUsdValueDecimal: "605",
    walletId,
  };
}

function addressBook() {
  return {
    chainId: 56,
    classification: null,
    entries: [
      {
        address: knownAddress,
        category: "exchange",
        chainId: 56,
        createdAt: "2026-08-18T14:00:00.000Z",
        entryId,
        label: "Known exchange",
        note: "Local fixture",
        revision: 1,
        updatedAt: "2026-08-18T14:00:00.000Z",
      },
    ],
    ownWallets: [{ address: walletAddress, name: "Treasury signer", walletId }],
  };
}

function resolvedAmount(request: TransferPreviewRequest): string {
  if (request.amount.kind === "exact") return request.amount.amountBaseUnit;
  if (request.asset.kind === "erc20") {
    if (request.amount.preset === "MAX") return "5000000";
    return ((5_000_000n * BigInt(request.amount.preset)) / 100n).toString();
  }
  if (request.amount.preset === "MAX") return "1999979000000000000";
  return ((2_000_000_000_000_000_000n * BigInt(request.amount.preset)) / 100n).toString();
}

function feeLimit(asset: Asset) {
  const gasLimit = asset.kind === "native" ? "21000" : "65000";
  return {
    feeCapBaseUnit: (BigInt(gasLimit) * 1_000_000_000n).toString(),
    gasLimit,
    maxFeePerGasBaseUnit: "1000000000",
    maxPriorityFeePerGasBaseUnit: "100000000",
  };
}

function preview(request: TransferPreviewRequest, expiresInMs = 60_000) {
  const amountBaseUnit = resolvedAmount(request);
  const native = request.asset.kind === "native";
  const before = native ? "2000000000000000000" : "5000000";
  const after = (BigInt(before) - BigInt(amountBaseUnit)).toString();
  return {
    addressClassification: request.recipient === knownAddress ? "known-external" : "new-external",
    amountBaseUnit,
    asset: native
      ? { decimals: 18, kind: "native", name: "BNB", symbol: "BNB" }
      : {
          decimals: 6,
          kind: "erc20",
          name: "Fixture Dollar",
          symbol: "FIX",
          tokenAddress,
        },
    balanceChange: {
      assetAfterBaseUnit: after,
      assetBeforeBaseUnit: before,
      assetDeltaBaseUnit: `-${amountBaseUnit}`,
      nativeAfterMinimumBaseUnit: native ? after : "1999935000000000000",
      nativeBeforeBaseUnit: "2000000000000000000",
      nativeDeltaMaximumBaseUnit: `-${feeLimit(request.asset).feeCapBaseUnit}`,
      recipientAssetDeltaBaseUnit: amountBaseUnit,
    },
    chainId: 56,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    feeLimit: feeLimit(request.asset),
    policyDigest,
    policyVersion: "policy-local-v4",
    previewDigest: digest,
    previewToken: "P".repeat(43),
    recipient: request.recipient,
    registryVersion: "registry-local-v3",
    requiresSecurityPassword: request.recipient !== knownAddress,
    walletId,
  };
}

function transaction(
  generation: number,
  state: "signed" | "broadcast" | "pending" | "confirmed" | "failed" | "dropped" | "replaced",
  active: boolean,
) {
  const replacement = generation === 1;
  return {
    active,
    createdAt: new Date(Date.now() - (2 - generation) * 1_000).toISOString(),
    generation,
    maxFeePerGasBaseUnit: replacement ? "1200000000" : "1000000000",
    maxPriorityFeePerGasBaseUnit: replacement ? "120000000" : "100000000",
    nonce: "7",
    replacedByTransactionId:
      generation === 0 && state === "replaced" ? replacementTransactionId : null,
    replacesTransactionId: replacement ? firstTransactionId : null,
    state,
    transactionHash: `0x${(replacement ? "22" : "11").repeat(32)}`,
    transactionId: replacement ? replacementTransactionId : firstTransactionId,
  };
}

function operation(request: TransferPreviewRequest, state: ObservedState) {
  const amountBaseUnit = resolvedAmount(request);
  const publicState = state === "replacement-broadcast" ? "broadcast" : state;
  let transactions: ReturnType<typeof transaction>[] = [];
  if (state === "signed" || state === "broadcast") {
    transactions = [transaction(0, state, true)];
  } else if (state === "pending" || state === "reconciling") {
    transactions = [transaction(0, "pending", true)];
  } else if (state === "confirmed") {
    transactions = [transaction(0, "replaced", false), transaction(1, "confirmed", true)];
  } else if (state === "replacement-broadcast") {
    transactions = [transaction(0, "replaced", false), transaction(1, "broadcast", true)];
  } else if (state === "replaced") {
    transactions = [transaction(0, "replaced", false), transaction(1, "pending", true)];
  } else if (state === "failed" || state === "dropped") {
    transactions = [transaction(0, state, true)];
  }
  const active = transactions.find((item) => item.active) ?? null;
  return {
    activeTransactionId: active?.transactionId ?? null,
    addressClassification: request.recipient === knownAddress ? "known-external" : "new-external",
    amountBaseUnit,
    asset: request.asset,
    chainId: 56,
    createdAt: new Date(Date.now() - 5_000).toISOString(),
    failureCode: publicState === "failed" ? "BROADCAST_REJECTED" : null,
    feeLimit: feeLimit(request.asset),
    nonce: transactions.length === 0 ? null : "7",
    operationId,
    planDigest: digest,
    policyDigest,
    recipient: request.recipient,
    reconciliationReason: publicState === "reconciling" ? "PROVIDER_DIVERGENCE" : null,
    state: publicState,
    transactions,
    updatedAt: new Date().toISOString(),
    walletId,
  };
}

function jsonBody(request: Request): Record<string, unknown> {
  return JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
}

async function installApi(page: Page, fixture: TransferFixture): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    if (pathname === "/api/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "P04-06 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId,
          },
        }),
      });
      return;
    }
    if (pathname === "/api/user/preferences") {
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
    if (pathname === "/api/stats") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ failed: 0, running: 0, stopped: 0, succeeded: 0 }),
      });
      return;
    }
    if (pathname === "/api/keystore/status") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ configured: true, status: "unlocked", version: 1 }),
      });
      return;
    }
    if (pathname === "/api/wallets" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: [wallet()] }),
      });
      return;
    }
    if (pathname.endsWith("/balances")) {
      await route.fulfill({ contentType: "application/json", json: envelope(balances()) });
      return;
    }
    if (pathname.endsWith("/tokens")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          chainId: 56,
          items: [
            {
              chainId: 56,
              decimals: 6,
              default: false,
              name: "Fixture Dollar",
              symbol: "FIX",
              tokenAddress,
            },
          ],
          walletId,
        }),
      });
      return;
    }
    if (pathname === "/api/address-book") {
      await route.fulfill({ contentType: "application/json", json: envelope(addressBook()) });
      return;
    }
    if (pathname === "/api/wallets/transfers/preview" && request.method() === "POST") {
      const body = jsonBody(request) as unknown as TransferPreviewRequest;
      fixture.previewRequests.push(body);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(preview(body, fixture.submitStatus === 408 ? 450 : 60_000)),
      });
      return;
    }
    if (pathname === "/api/wallets/transfers" && request.method() === "POST") {
      fixture.submitBodies.push(jsonBody(request));
      fixture.submitHeaders.push(request.headers());
      if (fixture.submitStatus === 409) {
        await route.fulfill({
          contentType: "application/json",
          json: errorEnvelope("IDEMPOTENCY_CONFLICT"),
          status: 409,
        });
        return;
      }
      const transferRequest = fixture.previewRequests.at(-1)!;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(transferRequest, fixture.initialState)),
        status: 202,
      });
      return;
    }
    if (pathname === `/api/wallets/transfers/${operationId}` && request.method() === "GET") {
      const transferRequest = fixture.previewRequests.at(-1)!;
      const next =
        fixture.pollSequence[Math.min(fixture.pollCount, fixture.pollSequence.length - 1)]!;
      fixture.pollCount += 1;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(transferRequest, next)),
      });
      return;
    }
    console.error(`[P04-06 unhandled API] ${request.method()} ${pathname}`);
    await route.abort("failed");
  });
}

async function assertVisualSafety(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

function fixture(overrides: Partial<TransferFixture> = {}): TransferFixture {
  return {
    initialState: "ready-for-approval",
    pollCount: 0,
    pollSequence: ["confirmed"],
    previewRequests: [],
    submitBodies: [],
    submitHeaders: [],
    ...overrides,
  };
}

test("native/ERC-20 preview, MAX, secret ingress and approval boundary work by keyboard", async ({
  page,
}, testInfo) => {
  const state = fixture();
  await installApi(page, state);
  await page.goto("/wallets");

  const nativeTrigger = page.getByRole("button", { name: "转账 BNB" });
  await nativeTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "转账 BNB" })).toBeVisible();
  await expect(page.getByLabel("转账收款地址")).toBeFocused();
  await page.getByLabel("转账地址簿").selectOption(knownAddress);
  await page.getByLabel("转账金额（base unit）").fill("1e17");
  await expect(page.getByRole("button", { name: "预览转账" })).toBeDisabled();
  await page.getByLabel("转账金额（base unit）").fill("100000000000000000");
  await page.getByRole("button", { name: "预览转账" }).click();
  await expect(page.getByTestId("transfer-preview-summary")).toContainText("0.1");
  await expect(page.getByTestId("transfer-preview-summary")).toContainText("已知外部地址");
  await expect(page.getByTestId("transfer-preview-summary")).toContainText("21000000000000");
  await expect(page.getByLabel("转账安全密码")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(nativeTrigger).toBeFocused();

  const tokenTrigger = page.getByRole("button", { name: "转账 FIX" });
  await tokenTrigger.click();
  await page.getByLabel("转账收款地址").fill(newAddress);
  await page.getByRole("button", { name: "MAX", exact: true }).click();
  await page.getByRole("button", { name: "预览转账" }).click();
  await expect(page.getByTestId("transfer-preview-summary")).toContainText("5");
  await expect(page.getByTestId("transfer-preview-summary")).toContainText("5000000 base units");
  await expect(page.getByTestId("transfer-preview-summary")).toContainText("新外部地址");
  await page.getByLabel("转账安全密码").fill(securityPassword);
  await page.getByRole("button", { name: "确认转账" }).click();
  await expect(page.getByText("等待授权", { exact: true }).first()).toBeVisible();

  expect(state.previewRequests).toHaveLength(2);
  expect(state.previewRequests[0]).toMatchObject({
    amount: { amountBaseUnit: "100000000000000000", kind: "exact" },
    asset: { kind: "native" },
  });
  expect(state.previewRequests[1]).toEqual({
    amount: { kind: "preset", preset: "MAX" },
    asset: { kind: "erc20", tokenAddress },
    chainId: 56,
    recipient: newAddress,
    walletId,
  });
  expect(state.submitHeaders[0]?.["content-type"]).toBe(
    "application/vnd.lpbot.wallet-transfer-secret+json",
  );
  expect(state.submitHeaders[0]?.["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/u);
  expect(state.submitBodies[0]?.securityPassword).toBe(securityPassword);
  expect(state.submitBodies[0]).not.toHaveProperty("requestId");
  await expect(page.locator("body")).not.toContainText(securityPassword);
  await page.waitForTimeout(1_700);
  expect(state.pollCount).toBe(0);
  await assertVisualSafety(page);

  if (captureEvidence) {
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-06/E-VIS/transfer-approval-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});

test("signed, broadcast, reconciliation, replacement lineage and confirmation stay observable", async ({
  page,
}, testInfo) => {
  const state = fixture({
    initialState: "queued",
    pollSequence: ["signed", "broadcast", "reconciling", "replacement-broadcast", "confirmed"],
  });
  await installApi(page, state);
  await page.goto("/wallets");
  await page.getByRole("button", { name: "转账 BNB" }).click();
  await page.getByLabel("转账地址簿").selectOption(knownAddress);
  await page.getByRole("button", { name: "25%", exact: true }).click();
  await page.getByRole("button", { name: "预览转账" }).click();
  await page.getByRole("button", { name: "确认转账" }).click();

  await expect(page.getByText("已签名", { exact: true }).first()).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("已广播", { exact: true }).first()).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("对账中", { exact: true }).first()).toBeVisible({ timeout: 6_000 });
  await expect(page.getByText("PROVIDER_DIVERGENCE", { exact: true })).toBeVisible();
  await expect(page.getByText("已替换", { exact: true }).first()).toBeVisible({ timeout: 6_000 });
  const lineage = page.getByLabel("交易替换链");
  await expect(lineage.getByRole("listitem")).toHaveCount(2);
  await expect(lineage.locator("li[data-active='true']")).toHaveCount(1);
  await expect(lineage.locator("li[data-active='true']")).toContainText("第 2 代");
  await expect(page.getByText("已确认", { exact: true }).first()).toBeVisible({ timeout: 6_000 });
  await expect(page.locator(".transfer-live-region")).toHaveText("转账状态：已确认");
  expect(state.pollCount).toBe(5);
  await assertVisualSafety(page);

  if (captureEvidence) {
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-06/E-VIS/transfer-confirmed-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});

test("expired previews and idempotency conflicts disable blind resubmission", async ({ page }) => {
  const state = fixture({ submitStatus: 408 });
  await installApi(page, state);
  await page.goto("/wallets");
  await page.getByRole("button", { name: "转账 FIX" }).click();
  await page.getByLabel("转账收款地址").fill(newAddress);
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await page.getByRole("button", { name: "预览转账" }).click();
  await expect(page.getByText("预览已过期", { exact: true })).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("button", { name: "确认转账" })).toBeDisabled();

  await page.getByRole("button", { name: "返回", exact: true }).click();
  state.submitStatus = 409;
  await page.getByRole("button", { name: "MAX", exact: true }).click();
  await page.getByRole("button", { name: "预览转账" }).click();
  await page.getByLabel("转账安全密码").fill(securityPassword);
  const submit = page.getByRole("button", { name: "确认转账" });
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("提交键与原请求冲突");
  await expect(submit).toBeDisabled();
  await submit.click({ force: true });
  await page.waitForTimeout(100);
  expect(state.submitBodies).toHaveLength(1);
  await assertVisualSafety(page);
});
