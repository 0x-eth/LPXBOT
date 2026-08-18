import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P04_03 === "1";
const userId = "4a000000-0000-4000-8000-000000000001";
const serverWalletId = "4a000000-0000-4000-8000-000000000011";
const passwordWalletId = "4a000000-0000-4000-8000-000000000012";
const privateKey = "0000000000000000000000000000000000000000000000000000000000000001";
const passwordOne = "synthetic-password-one";
const passwordTwo = "synthetic-password-two";

type KeystoreState = "locked" | "locked-out" | "unconfigured" | "unlocked";

interface FixtureState {
  autoLockMinutes: number;
  configured: boolean;
  nextError: string | null;
  requestBodies: string[];
  status: KeystoreState;
  version: number;
  wallets: Array<ReturnType<typeof wallet>>;
}

function envelope(data: unknown) {
  return { data, requestId: "p04-03-e2e", success: true };
}

function wallet(
  walletId: string,
  mode: "server-kek" | "user-password",
  lockStatus: "locked" | "ready" = mode === "server-kek" ? "ready" : "locked",
) {
  return {
    address:
      walletId === serverWalletId
        ? "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
        : "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
    createdAt: "2026-08-18T11:00:00.000Z",
    envelopeVersion: 1,
    lockStatus,
    mode,
    name: mode === "server-kek" ? "Server wallet" : "Password wallet",
    revision: 1,
    updatedAt: "2026-08-18T11:00:00.000Z",
    walletId,
  };
}

function status(state: FixtureState) {
  return {
    configured: state.configured,
    status: state.status,
    version: state.version,
  };
}

async function fail(route: Route, code: string): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    json: {
      error: {
        code,
        message: "fixture detail must not render",
        requestId: "fixture",
        retryable: false,
      },
      success: false,
    },
    status:
      code === "INVALID_CREDENTIALS"
        ? 401
        : code === "LOCKED_OUT"
          ? 429
          : code.includes("CONFLICT") || code.startsWith("PREVIEW_")
            ? 409
            : 500,
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
          displayName: "Keystore Fixture",
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
}

async function install(page: Page, state: FixtureState): Promise<void> {
  await installShell(page);
  await page.route("**/api/keystore/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ?? "";
    if (body) state.requestBodies.push(body);
    if (state.nextError && request.method() !== "GET") {
      const code = state.nextError;
      state.nextError = null;
      await fail(route, code);
      return;
    }
    if (path === "/api/keystore/status" && request.method() === "GET") {
      await route.fulfill({ contentType: "application/json", json: envelope(status(state)) });
      return;
    }
    if (path === "/api/keystore/password" && request.method() === "POST") {
      expect(request.headers()["content-type"]).toBe("application/vnd.lpbot.keystore-secret+json");
      state.configured = true;
      state.status = "locked";
      state.version = 1;
      await route.fulfill({ contentType: "application/json", json: envelope(status(state)) });
      return;
    }
    if (path === "/api/keystore/password" && request.method() === "PUT") {
      state.status = "locked";
      state.version += 1;
      await route.fulfill({ contentType: "application/json", json: envelope(status(state)) });
      return;
    }
    if (path === "/api/keystore/unlock") {
      state.status = "unlocked";
      state.wallets = state.wallets.map((item) =>
        item.mode === "user-password" ? { ...item, lockStatus: "ready" as const } : item,
      );
      await route.fulfill({ contentType: "application/json", json: envelope(status(state)) });
      return;
    }
    if (path === "/api/keystore/lock") {
      state.status = "locked";
      state.wallets = state.wallets.map((item) =>
        item.mode === "user-password" ? { ...item, lockStatus: "locked" as const } : item,
      );
      await route.fulfill({ contentType: "application/json", json: envelope(status(state)) });
      return;
    }
    if (path === "/api/keystore/auto-lock") {
      state.autoLockMinutes = Number((JSON.parse(body) as { minutes: number }).minutes);
      await route.fulfill({ contentType: "application/json", json: envelope(status(state)) });
      return;
    }
    if (path === "/api/keystore/reset-preview" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
          expiresAt: "2026-08-18T11:05:00.000Z",
          policyCount: 2,
          previewToken: "preview-token-fixture-at-least-32-bytes",
          secretVersion: state.version,
          strategyCount: 1,
          taskCount: 3,
          walletCount: state.wallets.filter(({ mode }) => mode === "user-password").length,
          walletsWithNonzeroAssets: 1,
          walletsWithPositions: 1,
        }),
      });
      return;
    }
    if (path === "/api/keystore/reset" && request.method() === "POST") {
      state.wallets = state.wallets.filter(({ mode }) => mode === "server-kek");
      state.configured = false;
      state.status = "unconfigured";
      state.version = 0;
      await route.fulfill({
        contentType: "application/json",
        json: envelope(status(state)),
        status: 202,
      });
      return;
    }
    await route.abort("failed");
  });
  await page.route("**/api/wallets**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/wallets") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: state.wallets }),
      });
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    state.requestBodies.push(request.postData() ?? "");
    if (path.endsWith("/encryption-mode")) {
      const walletId = path.split("/").at(-2)!;
      const current = state.wallets.find((item) => item.walletId === walletId)!;
      const mode = body.mode as "server-kek" | "user-password";
      const changed = {
        ...current,
        lockStatus: mode === "server-kek" ? ("ready" as const) : ("locked" as const),
        mode,
        revision: current.revision + 1,
      };
      state.wallets = state.wallets.map((item) => (item.walletId === walletId ? changed : item));
      await route.fulfill({
        contentType: "application/json",
        json: envelope(changed),
        status: 202,
      });
      return;
    }
    const next = {
      ...wallet(
        `4a000000-0000-4000-8000-${String(state.wallets.length + 20).padStart(12, "0")}`,
        body.mode as "server-kek" | "user-password",
      ),
      name: String(body.name),
    };
    state.wallets = [next, ...state.wallets];
    await route.fulfill({ contentType: "application/json", json: envelope(next), status: 201 });
  });
}

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

function fixture(overrides: Partial<FixtureState> = {}): FixtureState {
  return {
    autoLockMinutes: 15,
    configured: false,
    nextError: null,
    requestBodies: [],
    status: "unconfigured",
    version: 0,
    wallets: [],
    ...overrides,
  };
}

test("settings creates, unlocks, locks, changes password and clears every password field", async ({
  page,
}, testInfo) => {
  const state = fixture();
  await install(page, state);
  await page.goto("/settings");
  const section = page.locator(".keystore-settings");
  await expect(page.getByRole("heading", { level: 2, name: "Keystore 安全" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Keystore 状态" })).toContainText("未设置");

  const create = page.getByRole("button", { name: "创建密码" });
  await create.click();
  const newPassword = page.getByLabel("新密码", { exact: true });
  await expect(newPassword).toBeFocused();
  await newPassword.fill(passwordOne);
  await page.getByLabel("确认新密码").fill(passwordOne);
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByRole("status", { name: "Keystore 状态" })).toContainText("已锁定");
  const unlock = page.getByRole("button", { name: "解锁" });
  await expect(unlock).toBeFocused();
  await unlock.click();
  await page.getByLabel("密码", { exact: true }).fill(passwordOne);
  await page.getByRole("button", { name: "确认解锁" }).click();
  await expect(page.getByRole("status", { name: "Keystore 状态" })).toContainText("已解锁");
  await page.getByLabel("自动锁定时间").selectOption("5");
  await expect.poll(() => state.autoLockMinutes).toBe(5);
  await page.getByRole("button", { name: "锁定" }).click();
  await expect(page.getByRole("status", { name: "Keystore 状态" })).toContainText("已锁定");

  await page.getByRole("button", { name: "修改密码" }).click();
  await page.getByLabel("当前密码").fill(passwordOne);
  await page.getByLabel("新密码", { exact: true }).fill(passwordTwo);
  await page.getByLabel("确认新密码").fill(passwordTwo);
  state.nextError = "SECRET_VERSION_CONFLICT";
  await page.getByRole("button", { name: "确认修改" }).click();
  await expect(section).toHaveAttribute("data-state", "conflict");
  await expect(page.getByRole("alert")).toContainText("密码版本已变化");
  await expect(page.getByLabel("当前密码")).toHaveValue("");
  await expect(page.getByLabel("新密码", { exact: true })).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(passwordOne);
  await expect(page.locator("body")).not.toContainText(passwordTwo);
  expect(
    await page.evaluate(() => `${location.href}\n${JSON.stringify(localStorage)}`),
  ).not.toContain("synthetic-password");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await axe(page);

  if (captureEvidence) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "修改密码" })).toBeFocused();
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      path: `artifacts/acceptance/P04-03/ui/settings-keystore-${testInfo.project.name}.png`,
    });
  }
});

test("settings handles locked-out, reset preview changes, confirmation and atomic reset", async ({
  page,
}) => {
  const state = fixture({
    configured: true,
    status: "locked-out",
    version: 2,
    wallets: [wallet(serverWalletId, "server-kek"), wallet(passwordWalletId, "user-password")],
  });
  await install(page, state);
  await page.goto("/settings");
  await expect(page.getByRole("status", { name: "Keystore 状态" })).toContainText("暂时锁定");
  await expect(page.getByRole("button", { name: "解锁" })).toHaveCount(0);

  const resetTrigger = page.getByRole("button", { name: "忘记密码" });
  await resetTrigger.click();
  await expect(page.locator(".keystore-settings")).toHaveAttribute("data-state", "reset-preview");
  await expect(page.getByText("1 个密码钱包")).toBeVisible();
  await expect(page.getByText("3 个任务")).toBeVisible();
  const phrase = page.getByLabel("确认短语");
  await phrase.fill("WRONG_PHRASE");
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByRole("alert")).toContainText("确认短语不正确");
  await expect(phrase).toHaveValue("");

  await phrase.fill("I_LOSE_ALL_PASSWORD_WALLETS");
  state.nextError = "PREVIEW_CHANGED";
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByRole("alert")).toContainText("重置内容已变化");
  await expect(phrase).toHaveValue("");
  await phrase.fill("I_LOSE_ALL_PASSWORD_WALLETS");
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect(page.getByRole("status", { name: "Keystore 状态" })).toContainText("未设置");
  expect(state.wallets).toEqual([expect.objectContaining({ mode: "server-kek" })]);
  await expect(page.getByRole("button", { name: "创建密码" })).toBeFocused();
});

test("wallets selects password mode, shows lock state, and switches modes with stable focus", async ({
  page,
}, testInfo) => {
  const state = fixture({
    configured: true,
    status: "locked",
    version: 2,
    wallets: [wallet(serverWalletId, "server-kek"), wallet(passwordWalletId, "user-password")],
  });
  await install(page, state);
  await page.goto("/wallets");
  await expect(page.getByText("服务器密钥")).toBeVisible();
  await expect(page.getByText("用户密码")).toBeVisible();
  await expect(page.getByText("已锁定")).toBeVisible();

  const switchTrigger = page.getByRole("button", { name: "切换 Server wallet 加密模式" });
  await switchTrigger.click();
  await expect(page.getByRole("dialog", { name: "切换加密模式" })).toBeVisible();
  await expect(page.getByLabel("Keystore 密码")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(switchTrigger).toBeFocused();
  await switchTrigger.click();
  await page.getByLabel("Keystore 密码").fill(passwordOne);
  await page.getByRole("button", { name: "确认切换" }).click();
  await expect(page.getByText("用户密码")).toHaveCount(2);

  const generateTrigger = page.getByRole("button", { name: "生成钱包" });
  await generateTrigger.click();
  await page.getByLabel("钱包名称").fill("Generated password wallet");
  await page.getByRole("radio", { name: "用户密码" }).click();
  const generatePassword = page.getByLabel("Keystore 密码");
  await generatePassword.fill(passwordOne);
  await page.getByRole("button", { name: "确认生成" }).click();
  const custodyWallets = page.getByLabel("托管钱包");
  await expect(custodyWallets.getByText("Generated password wallet")).toBeVisible();

  const importTrigger = page.getByRole("button", { name: "导入钱包" });
  await importTrigger.click();
  await page.getByLabel("钱包名称").fill("Imported password wallet");
  await page.getByRole("radio", { name: "用户密码" }).click();
  await page.getByLabel("私钥").fill(privateKey);
  await page.getByLabel("Keystore 密码").fill(passwordOne);
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(custodyWallets.getByText("Imported password wallet")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(passwordOne);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await axe(page);

  if (captureEvidence) {
    await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-03/ui/wallets-password-mode-${testInfo.project.name}.png`,
    });
  }
});
