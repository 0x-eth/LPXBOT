import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P04_04 === "1";
const userId = "4b000000-0000-4000-8000-000000000001";
const safeWalletId = "4b000000-0000-4000-8000-000000000011";
const riskyWalletId = "4b000000-0000-4000-8000-000000000012";
const securityPasswordOne = "synthetic-security-password-one";
const securityPasswordTwo = "synthetic-security-password-two";

interface FixtureState {
  nextSecurityError: string | null;
  nextWalletError: string | null;
  requestBodies: string[];
  security: { configured: boolean; status: "ready" | "unconfigured"; version: number };
  wallets: Array<ReturnType<typeof wallet>>;
}

function envelope(data: unknown) {
  return { data, requestId: "p04-04-e2e", success: true };
}

function wallet(walletId: string, name: string) {
  return {
    address:
      walletId === safeWalletId
        ? "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
        : "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
    createdAt: "2026-08-18T12:00:00.000Z",
    envelopeVersion: 1,
    lockStatus: "ready" as const,
    mode: walletId === safeWalletId ? ("server-kek" as const) : ("user-password" as const),
    name,
    revision: 1,
    updatedAt: "2026-08-18T12:00:00.000Z",
    walletId,
  };
}

function preview(target: ReturnType<typeof wallet>) {
  const risky = target.walletId === riskyWalletId;
  const dependencies = {
    assetIds: risky ? ["asset-usdt"] : [],
    policyIds: risky ? ["policy-dca"] : [],
    positionIds: risky ? ["position-lp-7"] : [],
    taskIds: risky ? ["task-rebalance-3"] : [],
  };
  return {
    assetCount: dependencies.assetIds.length,
    assetRiskDigest: risky ? "sha256:risky-fixture" : "sha256:empty-fixture",
    confirmationPhrase: risky ? "DELETE WALLET A1B2C3D4" : "DELETE WALLET 11223344",
    dependencies,
    expiresAt: "2026-08-18T12:05:00.000Z",
    forceEligible: true,
    policyCount: dependencies.policyIds.length,
    positionCount: dependencies.positionIds.length,
    previewToken: risky ? "B".repeat(43) : "A".repeat(43),
    revision: target.revision,
    taskCount: dependencies.taskIds.length,
    walletId: target.walletId,
  };
}

async function fail(route: Route, code: string): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    json: {
      error: { code, message: "fixture detail must not render", retryable: false },
      success: false,
    },
    status:
      code === "INVALID_CREDENTIALS"
        ? 401
        : code === "REAUTH_REQUIRED"
          ? 403
          : code === "SIGNER_UNAVAILABLE"
            ? 503
            : 409,
  });
}

async function installShell(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        isAdmin: false,
        maintenance: null,
        user: {
          allowedChainIds: [56],
          avatarUrl: null,
          displayName: "P04-04 Fixture",
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
  await page.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({ contentType: "application/json", json: envelope({ links: [] }) }),
  );
  await page.route("**/api/notification-preferences", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        categories: {
          "feedback-replied": false,
          "monitor-match": false,
          "operation-failed": false,
          "position-closed": false,
          "position-moved": false,
          "task-created": false,
        },
        revision: 0,
        updatedAt: null,
      }),
    }),
  );
  await page.route("**/api/notification-destinations", (route) =>
    route.fulfill({ contentType: "application/json", json: envelope([]) }),
  );
  await page.route("**/api/notification-destinations/options", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({ telegramIdentityId: null }),
    }),
  );
  await page.route("**/api/keystore/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({ configured: true, status: "locked", version: 1 }),
    }),
  );
}

async function install(page: Page, state: FixtureState): Promise<void> {
  await installShell(page);
  await page.route("**/api/security-password**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/security-password/status" && request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: envelope(state.security) });
      return;
    }
    if (path === "/api/security-password" && request.method() === "PUT") {
      const body = request.postData() ?? "";
      state.requestBodies.push(body);
      expect(request.headers()["content-type"]).toBe(
        "application/vnd.lpbot.security-password-secret+json",
      );
      if (state.nextSecurityError) {
        const code = state.nextSecurityError;
        state.nextSecurityError = null;
        await fail(route, code);
        return;
      }
      const input = JSON.parse(body) as { expectedVersion: number };
      state.security = {
        configured: true,
        status: "ready",
        version: input.expectedVersion + 1,
      };
      await route.fulfill({ contentType: "application/json", json: envelope(state.security) });
      return;
    }
    await route.abort("failed");
  });
  await page.route("**/api/wallets**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const segments = path.split("/");
    const targetId = segments[3];
    if (request.method() === "GET" && path === "/api/wallets") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: state.wallets }),
      });
      return;
    }
    if (request.method() === "PATCH" && targetId) {
      if (state.nextWalletError) {
        const code = state.nextWalletError;
        state.nextWalletError = null;
        await fail(route, code);
        return;
      }
      const input = JSON.parse(request.postData() ?? "{}") as {
        expectedRevision: number;
        name: string;
      };
      const index = state.wallets.findIndex(({ walletId }) => walletId === targetId);
      const current = state.wallets[index]!;
      const renamed = {
        ...current,
        name: input.name,
        revision: input.expectedRevision + 1,
        updatedAt: "2026-08-18T12:01:00.000Z",
      };
      state.wallets[index] = renamed;
      await route.fulfill({ contentType: "application/json", json: envelope(renamed) });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/delete-preview") && targetId) {
      if (state.nextWalletError) {
        const code = state.nextWalletError;
        state.nextWalletError = null;
        await fail(route, code);
        return;
      }
      const target = state.wallets.find(({ walletId }) => walletId === targetId)!;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(preview(target)),
        status: 201,
      });
      return;
    }
    if (request.method() === "DELETE" && targetId) {
      const body = request.postData() ?? "";
      state.requestBodies.push(body);
      if (state.nextWalletError) {
        const code = state.nextWalletError;
        state.nextWalletError = null;
        await fail(route, code);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      const target = state.wallets.find(({ walletId }) => walletId === targetId)!;
      const input = JSON.parse(body) as { force: boolean };
      state.wallets = state.wallets.filter(({ walletId }) => walletId !== targetId);
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          address: target.address,
          auditId: "42",
          deletedAt: "2026-08-18T12:02:00.000Z",
          deletionType: input.force ? "force" : "normal",
          finalRevision: target.revision + 1,
          walletId: target.walletId,
        }),
      });
      return;
    }
    await route.abort("failed");
  });
}

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

function fixture(): FixtureState {
  return {
    nextSecurityError: null,
    nextWalletError: null,
    requestBodies: [],
    security: { configured: false, status: "unconfigured", version: 0 },
    wallets: [wallet(safeWalletId, "Main signer"), wallet(riskyWalletId, "Automation wallet")],
  };
}

test("wallet rename is keyboard reachable, revision aware, and restores focus", async ({ page }) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  const trigger = page.getByRole("button", { name: "重命名 Main signer" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "重命名钱包" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("钱包名称")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByLabel("钱包名称").fill("Renamed signer");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByText("Renamed signer")).toBeVisible();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute("data-state", "ready");

  state.nextWalletError = "REVISION_CONFLICT";
  await page.getByRole("button", { name: "重命名 Renamed signer" }).click();
  await page.getByLabel("钱包名称").fill("Stale rename");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute("data-state", "conflict");
  await expect(page.getByRole("alert")).toContainText("钱包版本已变化");
});

test("normal deletion shows zero-risk preview, deleting, and deleted states", async ({ page }) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  const trigger = page.getByRole("button", { name: "删除 Main signer" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "删除钱包预览" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("任务 0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("策略 0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("非零资产 0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("仓位 0", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute("data-state", "deleting");
  await expect(page.getByRole("button", { name: "正在删除" })).toBeDisabled();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute("data-state", "deleted");
  await expect(page.getByText("Main signer")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("钱包已彻底删除");
});

test("force deletion requires the exact phrase and full dependency inventory", async ({ page }) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  const trigger = page.getByRole("button", { name: "删除 Automation wallet" });
  await trigger.click();
  const previewDialog = page.getByRole("dialog", { name: "删除钱包预览" });
  await expect(previewDialog.getByText("任务 1", { exact: true })).toBeVisible();
  await expect(previewDialog.getByText("策略 1", { exact: true })).toBeVisible();
  await expect(previewDialog.getByText("非零资产 1", { exact: true })).toBeVisible();
  await expect(previewDialog.getByText("仓位 1", { exact: true })).toBeVisible();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute(
    "data-state",
    "delete-blocked",
  );
  await page.getByRole("button", { name: "继续强制删除" }).click();

  const forceDialog = page.getByRole("dialog", { name: "强制删除钱包" });
  await expect(forceDialog.getByText("task-rebalance-3")).toBeVisible();
  await expect(forceDialog.getByText("policy-dca")).toBeVisible();
  await expect(forceDialog.getByText("asset-usdt")).toBeVisible();
  await expect(forceDialog.getByText("position-lp-7")).toBeVisible();
  const phrase = page.getByLabel("输入确认短语");
  await expect(phrase).toBeFocused();
  await phrase.fill("DELETE WALLET WRONG000");
  await page.getByRole("button", { name: "强制删除", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("确认短语不一致");
  await expect(phrase).toHaveValue("");

  state.nextWalletError = "PREVIEW_EXPIRED";
  await phrase.fill("DELETE WALLET A1B2C3D4");
  await page.getByRole("button", { name: "强制删除", exact: true }).click();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute(
    "data-state",
    "preview-expired",
  );
  await expect(page.getByRole("alert")).toContainText("删除预览已过期");
  await expect(phrase).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("button", { name: "继续强制删除" }).click();
  await page.getByLabel("输入确认短语").fill("DELETE WALLET A1B2C3D4");
  await page.getByRole("button", { name: "强制删除", exact: true }).click();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute("data-state", "deleting");
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute("data-state", "deleted");
  const deletion = JSON.parse(state.requestBodies.at(-1)!) as Record<string, unknown>;
  expect(deletion).toMatchObject({
    confirmationPhrase: "DELETE WALLET A1B2C3D4",
    dependencies: preview(wallet(riskyWalletId, "Automation wallet")).dependencies,
    force: true,
  });
});

test("security password stays separate, clears secrets, and handles errors and conflicts", async ({
  page,
}, testInfo) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/settings");
  const section = page.locator(".security-password-settings");
  await expect(section).toHaveAttribute("data-state", "security-unconfigured");
  await expect(section.getByRole("heading", { name: "安全密码" })).toBeVisible();
  await expect(page.locator(".keystore-settings").getByRole("heading", { name: "Keystore" })).toBeVisible();

  const create = page.getByRole("button", { name: "创建安全密码" });
  await create.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("新安全密码")).toBeFocused();
  await page.getByLabel("新安全密码").fill(securityPasswordOne);
  await page.getByLabel("确认安全密码").fill(securityPasswordTwo);
  await page.getByRole("button", { name: "确认创建安全密码" }).click();
  await expect(page.getByRole("alert")).toContainText("两次输入的安全密码不一致");
  await expect(page.getByLabel("新安全密码")).toHaveValue("");
  await expect(page.getByLabel("确认安全密码")).toHaveValue("");

  await page.getByLabel("新安全密码").fill(securityPasswordOne);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(create).toBeFocused();
  await create.click();
  await expect(page.getByLabel("新安全密码")).toHaveValue("");
  await page.getByLabel("新安全密码").fill(securityPasswordOne);
  await page.getByLabel("确认安全密码").fill(securityPasswordOne);
  await page.getByRole("button", { name: "确认创建安全密码" }).click();
  await expect(section).toHaveAttribute("data-state", "ready");

  const change = page.getByRole("button", { name: "修改安全密码" });
  await change.click();
  await page.getByLabel("当前安全密码").fill("synthetic-security-password-wrong");
  await page.getByLabel("新安全密码").fill(securityPasswordTwo);
  await page.getByLabel("确认安全密码").fill(securityPasswordTwo);
  state.nextSecurityError = "INVALID_CREDENTIALS";
  await page.getByRole("button", { name: "确认修改安全密码" }).click();
  await expect(section).toHaveAttribute("data-state", "error");
  await expect(page.getByRole("alert")).toContainText("安全密码不正确");
  for (const label of ["当前安全密码", "新安全密码", "确认安全密码"]) {
    await expect(page.getByLabel(label)).toHaveValue("");
  }

  state.nextSecurityError = "SECURITY_PASSWORD_VERSION_CONFLICT";
  await page.getByLabel("当前安全密码").fill(securityPasswordOne);
  await page.getByLabel("新安全密码").fill(securityPasswordTwo);
  await page.getByLabel("确认安全密码").fill(securityPasswordTwo);
  await page.getByRole("button", { name: "确认修改安全密码" }).click();
  await expect(section).toHaveAttribute("data-state", "conflict");
  await expect(page.getByRole("alert")).toContainText("安全密码版本已变化");
  for (const label of ["当前安全密码", "新安全密码", "确认安全密码"]) {
    await expect(page.getByLabel(label)).toHaveValue("");
  }
  await page.keyboard.press("Escape");
  await expect(change).toBeFocused();

  await expect(page.locator("body")).not.toContainText(securityPasswordOne);
  await expect(page.locator("body")).not.toContainText(securityPasswordTwo);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await axe(page);

  if (captureEvidence) {
    await section.scrollIntoViewIfNeeded();
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-04/ui/security-password-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});

test("wallet lifecycle remains responsive and axe clean on desktop and mobile", async ({
  page,
}, testInfo) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/wallets");
  await expect(page.getByText("Main signer")).toBeVisible();
  await page.getByRole("button", { name: "删除 Automation wallet" }).click();
  await expect(page.getByRole("dialog", { name: "删除钱包预览" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await axe(page);

  if (captureEvidence) {
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-04/ui/wallet-delete-preview-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});
