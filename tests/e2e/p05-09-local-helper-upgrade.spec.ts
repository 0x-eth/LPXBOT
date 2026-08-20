import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P05_09 === "1";
const userId = "79000000-0000-4000-8000-000000000001";
const walletId = "79000000-0000-4000-8000-000000000011";
const bindingId = "79000000-0000-4000-8000-000000000012";
const operationId = "79000000-0000-4000-8000-000000000021";
const sweepBatchId = "79000000-0000-4000-8000-000000000022";
const firstTransactionId = "79000000-0000-4000-8000-000000000031";
const replacementTransactionId = "79000000-0000-4000-8000-000000000032";
const walletAddress = `0x${"1".repeat(40)}`;
const sourceHelperAddress = `0x${"2".repeat(40)}`;
const targetHelperAddress = `0x${"3".repeat(40)}`;
const targetRuntimeCodeHash = `0x${"4".repeat(64)}`;
const planDigest = `sha256:${"5".repeat(64)}`;
const previewDigest = `sha256:${"6".repeat(64)}`;
const previewToken = "U".repeat(43);
const firstTransactionHash = `0x${"7".repeat(64)}`;
const replacementTransactionHash = `0x${"8".repeat(64)}`;
const createdAt = "2099-08-21T08:00:00.000Z";
const completedAt = "2099-08-21T08:00:12.000Z";
const expiresAt = "2099-08-21T08:10:00.000Z";
const cursors = [
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
] as const;
const manualBlockers = ["NFT_CUSTODY", "NON_ZERO_ALLOWANCE", "UNKNOWN_TOKEN"];

interface FixtureState {
  idempotencyKeys: string[];
  manual: boolean;
  operationQueries: number;
  previewPayloads: Record<string, unknown>[];
  submitPayloads: Record<string, unknown>[];
  submitted: boolean;
}

function fixture(manual = false): FixtureState {
  return {
    idempotencyKeys: [],
    manual,
    operationQueries: 0,
    previewPayloads: [],
    submitPayloads: [],
    submitted: false,
  };
}

function envelope(data: unknown) {
  return { data, requestId: "p05-09-e2e", success: true };
}

function wallet() {
  return {
    address: walletAddress,
    createdAt,
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "WalletHelperV2 upgrade wallet",
    revision: 1,
    updatedAt: createdAt,
    walletId,
  };
}

function versions() {
  return {
    comparison: "upgrade-available",
    source: "WalletHelperV1",
    target: "WalletHelperV2",
  } as const;
}

function preview(manual: boolean) {
  return {
    blockers: manual ? manualBlockers : [],
    chainId: 31_337,
    expectedTargetAddress: targetHelperAddress,
    expectedTargetRuntimeCodeHash: targetRuntimeCodeHash,
    expiresAt,
    feeLimit: {
      feeCapBaseUnit: "800000000000000",
      gasLimit: "200000",
      maxFeePerGasBaseUnit: "4000000000",
      maxPriorityFeePerGasBaseUnit: "2000000000",
    },
    nonce: "17",
    previewDigest,
    previewToken,
    registryVersion: "p05-local-helper-upgrade-v3",
    residual: {
      allowanceCount: manual ? 1 : 0,
      balancesAboveDust: manual ? 0 : 3,
      nftCustodyCount: manual ? 1 : 0,
      unknownTokenCount: manual ? 1 : 0,
    },
    sourceHelperAddress,
    steps: cursors,
    upgradeable: !manual,
    versions: versions(),
    walletId,
  };
}

function transaction(
  generation: number,
  state: "confirmed" | "replaced",
  transactionId: string,
  transactionHash: string,
  active: boolean,
) {
  return {
    active,
    generation,
    maxFeePerGasBaseUnit: generation === 0 ? "2000000000" : "3000000000",
    maxPriorityFeePerGasBaseUnit: generation === 0 ? "1000000000" : "1500000000",
    state,
    transactionHash,
    transactionId,
  };
}

function operation(state: "completed" | "manual-recovery-required" | "queued") {
  const manual = state === "manual-recovery-required";
  const completed = state === "completed";
  const cursor = completed ? "completed" : manual ? "final-rescan-v1" : "preflight";
  return {
    chainId: 31_337,
    createdAt,
    cursor,
    expectedTargetAddress: targetHelperAddress,
    failureCode: manual ? "MANUAL_RECOVERY_REQUIRED" : null,
    manualRecovery: {
      blockers: manual ? manualBlockers : [],
      required: manual,
    },
    nonce: "17",
    operationId,
    planDigest,
    registryVersion: "p05-local-helper-upgrade-v3",
    sourceBindingId: bindingId,
    sourceHelperAddress,
    state,
    steps: cursors.map((step, ordinal) => ({
      cursor: step,
      failureCode: manual && ordinal === 4 ? "MANUAL_RECOVERY_REQUIRED" : null,
      state: completed
        ? "succeeded"
        : manual && ordinal === 4
          ? "manual-recovery-required"
          : manual && ordinal < 4
            ? "succeeded"
            : "pending",
      updatedAt: completed || (manual && ordinal <= 4) ? completedAt : null,
    })),
    sweepBatchId: state === "queued" ? null : sweepBatchId,
    transactions:
      state === "queued"
        ? []
        : completed
          ? [
              transaction(0, "replaced", firstTransactionId, firstTransactionHash, false),
              transaction(
                1,
                "confirmed",
                replacementTransactionId,
                replacementTransactionHash,
                true,
              ),
            ]
          : [transaction(0, "confirmed", firstTransactionId, firstTransactionHash, true)],
    updatedAt: state === "queued" ? createdAt : completedAt,
    versions: versions(),
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
            displayName: "P05-09 Fixture",
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
    if (path === `/api/wallets/${walletId}/helper-upgrade` && method === "GET") {
      if (state.manual || state.submitted) {
        await route.fulfill({
          contentType: "application/json",
          json: envelope(operation(state.manual ? "manual-recovery-required" : "completed")),
        });
      } else {
        await route.fulfill({
          contentType: "application/json",
          json: { error: { code: "HELPER_UPGRADE_NOT_FOUND", retryable: false }, success: false },
          status: 404,
        });
      }
      return;
    }
    if (path === "/api/wallets/helper/upgrade/preview" && method === "POST") {
      state.previewPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(preview(state.manual)),
      });
      return;
    }
    if (path === "/api/wallets/helper/upgrade" && method === "POST") {
      state.submitPayloads.push(JSON.parse(request.postData() ?? "{}") as Record<string, unknown>);
      state.idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      state.submitted = true;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation("queued")),
        status: 202,
      });
      return;
    }
    if (path === `/api/helper-upgrades/${operationId}` && method === "GET") {
      state.operationQueries += 1;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(operation(state.manual ? "manual-recovery-required" : "completed")),
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
  const result = await new AxeBuilder({ page })
    .include('[data-testid="local-helper-upgrade-panel"]')
    .analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

async function openPanel(page: Page, state: FixtureState) {
  await install(page, state);
  await page.goto("/wallets");
  const panel = page.getByTestId("local-helper-upgrade-panel");
  await expect(panel).toHaveAttribute(
    "data-state",
    state.manual ? "manual-recovery-required" : "idle",
  );
  return panel;
}

test("previews, submits, and renders a recovered deploy-new upgrade", async ({
  page,
}, testInfo) => {
  const state = fixture();
  const panel = await openPanel(page, state);
  await expect(panel).toContainText("WalletHelperV1");
  await expect(panel).toContainText("WalletHelperV2");

  const previewButton = panel.getByRole("button", { name: "升级到 V2" });
  await previewButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认 Helper 升级" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("list", { name: "升级预览步骤" }).locator("li")).toHaveCount(7);
  await expect(dialog).toContainText(targetHelperAddress);
  await expect(dialog).toContainText("800000000000000 wei");

  await dialog.getByRole("button", { name: "确认升级" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel).toHaveAttribute("data-state", "queued");
  await expect(panel).toHaveAttribute("data-state", "completed", { timeout: 4_000 });
  await expect(panel.getByRole("list", { name: "Helper 升级步骤" }).locator("li")).toHaveCount(7);
  await expect(panel).toContainText("交易 lineage");
  await expect(panel).toContainText("G0");
  await expect(panel).toContainText("G1");
  await expect(panel).toContainText("已替换");
  await expect(panel).toContainText("已确认");

  expect(state.previewPayloads).toEqual([{ chainId: 31_337, walletId }]);
  expect(state.submitPayloads).toEqual([
    { chainId: 31_337, previewDigest, previewToken, walletId },
  ]);
  expect(state.idempotencyKeys).toHaveLength(1);
  expect(state.idempotencyKeys[0]).toMatch(/^local-helper-upgrade-[0-9a-f-]{36}$/u);
  expect(JSON.stringify([...state.previewPayloads, ...state.submitPayloads])).not.toMatch(
    /"(?:bytecode|helper|target|selector|calldata|recipient|registry|fee)"\s*:/iu,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  await axe(page);
  await expect(panel).toHaveScreenshot("p05-09-local-helper-upgrade-completed.png", {
    animations: "disabled",
    caret: "hide",
  });
  if (captureEvidence) {
    const screenshot = await panel.screenshot({
      animations: "disabled",
      path: `artifacts/acceptance/P05-09/E-VIS/upgrade-completed-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(8_000);
  }
});

test("shows manual recovery without exposing arbitrary recovery calldata", async ({ page }) => {
  const state = fixture(true);
  const panel = await openPanel(page, state);
  await expect(panel).toContainText("需人工恢复");
  await expect(panel).toContainText("非零 allowance");
  await expect(panel).toContainText("WalletHelperV1 仍持有 NFT");
  await expect(panel).toContainText("未知 Token");
  await expect(panel).toContainText(`V1: ${sourceHelperAddress}`);

  await panel.getByRole("button", { name: "升级到 V2" }).click();
  const dialog = page.getByRole("dialog", { name: "确认 Helper 升级" });
  await expect(dialog).toContainText("需人工恢复");
  await expect(dialog.getByRole("button", { name: "确认升级" })).toBeDisabled();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭 Helper 升级预览" }).click();

  const query = panel.getByRole("textbox", { name: "Operation", exact: true });
  await query.fill(operationId);
  await panel.getByRole("button", { name: "查询 Helper 升级 operation" }).click();
  await expect.poll(() => state.operationQueries).toBeGreaterThan(0);
  expect(state.submitPayloads).toEqual([]);
  await axe(page);
});
