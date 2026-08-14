import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const session = {
  allowedChainIds: [56],
  avatarUrl: null,
  displayName: "Wallet Fixture",
  maintenanceBypass: false,
  role: "user",
  tier: "normal",
  userId: "00000000-0000-4000-8000-000000000001",
};
const address = "0x0000000000000000000000000000000000000001";
const signature = `0x${"ab".repeat(65)}`;

async function anonymous(route: Route): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    json: {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: "req-wallet-e2e-anonymous",
        retryable: false,
      },
    },
    status: 401,
  });
}

async function installProvider(page: Page, rejectFirstSignature = false): Promise<void> {
  await page.addInitScript(
    ({ account, rejectFirst, signed }) => {
      const browser = globalThis as typeof globalThis & {
        __walletRpcMethods: string[];
        ethereum: { request(input: { method: string }): Promise<unknown> };
      };
      let shouldReject = rejectFirst;
      browser.__walletRpcMethods = [];
      browser.ethereum = {
        async request({ method }) {
          browser.__walletRpcMethods.push(method);
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return "0x38";
          if (method === "personal_sign") {
            if (shouldReject) {
              shouldReject = false;
              throw Object.assign(new Error("User rejected"), { code: 4001 });
            }
            return signed;
          }
          throw new Error(`Unexpected RPC: ${method}`);
        },
      };
    },
    { account: address, rejectFirst: rejectFirstSignature, signed: signature },
  );
}

async function routeWalletLogin(page: Page): Promise<void> {
  await page.route("**/api/auth/me", anonymous);
  await page.route("**/api/auth/wallet/nonce", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          message: "canonical wallet login SIWE fixture",
          nonceId: "N".repeat(43),
        },
        requestId: "req-wallet-e2e-nonce",
      },
      status: 200,
    }),
  );
  await page.route("**/api/auth/wallet/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { success: true, data: { session }, requestId: "req-wallet-e2e-login" },
      status: 200,
    }),
  );
}

async function expectNoForbiddenRpc(page: Page): Promise<void> {
  const methods = await page.evaluate(
    () => (globalThis as typeof globalThis & { __walletRpcMethods: string[] }).__walletRpcMethods,
  );
  for (const forbidden of [
    "eth_sendTransaction",
    "eth_signTransaction",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
  ]) {
    expect(methods).not.toContain(forbidden);
  }
}

test("wallet login works on desktop and mobile without transaction RPC or browser storage", async ({
  page,
}, testInfo) => {
  await installProvider(page);
  await routeWalletLogin(page);
  await page.goto("/login");
  await page.screenshot({
    fullPage: true,
    path: `artifacts/acceptance/P01-04/ui/wallet-login-${testInfo.project.name}.png`,
  });

  await page.getByRole("button", { name: "Wallet" }).click();

  await expect(page).toHaveURL(/\/tasks\/running$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await expectNoForbiddenRpc(page);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
});

test("a rejected wallet signature returns to login and succeeds on retry", async ({ page }) => {
  await installProvider(page, true);
  await routeWalletLogin(page);
  await page.goto("/login");

  await page.getByRole("button", { name: "Wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("rejected");
  await page.getByRole("button", { name: "Wallet" }).click();

  await expect(page).toHaveURL(/\/tasks\/running$/u);
  await expectNoForbiddenRpc(page);
});

test("wallet login reports a missing EIP-1193 provider after the user clicks", async ({ page }) => {
  await page.route("**/api/auth/me", anonymous);
  await page.goto("/login");

  await page.getByRole("button", { name: "Wallet" }).click();

  await expect(page.getByRole("alert")).toContainText("No compatible wallet provider");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("settings lists, labels, binds and confirms deletion of login wallets", async ({
  page,
}, testInfo) => {
  await installProvider(page);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: { isAdmin: false, maintenance: null, user: session },
        requestId: "req-settings-auth",
      },
      status: 200,
    }),
  );
  const firstLink = {
    addressMasked: "0x1111...1111",
    createdAt: "2026-08-14T08:00:00.000Z",
    label: "Primary",
    linkId: "00000000-0000-4000-8000-000000000081",
    updatedAt: "2026-08-14T08:00:00.000Z",
  };
  const secondLink = {
    addressMasked: "0x0000...0001",
    createdAt: "2026-08-14T08:10:00.000Z",
    label: "<script>Login only</script>",
    linkId: "00000000-0000-4000-8000-000000000082",
    updatedAt: "2026-08-14T08:10:00.000Z",
  };
  await page.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { success: true, data: { links: [firstLink] }, requestId: "req-settings-list" },
      status: 200,
    }),
  );
  await page.route("**/api/auth/wallet/link-nonce", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          message: "canonical wallet link SIWE fixture",
          nonceId: "L".repeat(43),
        },
        requestId: "req-settings-nonce",
      },
      status: 200,
    }),
  );
  await page.route("**/api/auth/wallet/link", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      contentType: "application/json",
      json: { success: true, data: { link: secondLink }, requestId: "req-settings-link" },
      status: 200,
    });
  });
  await page.route("**/api/auth/wallet/link/*", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { success: true, data: { deleted: true }, requestId: "req-settings-delete" },
      status: 200,
    }),
  );

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByText("0x1111...1111")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: `artifacts/acceptance/P01-04/ui/settings-${testInfo.project.name}.png`,
  });
  const scriptCount = await page.locator("script").count();
  await page.getByLabel("Wallet label").fill("<script>Login only</script>");
  await page.getByRole("button", { name: "Link wallet" }).click();
  await expect(page.getByText("<script>Login only</script>", { exact: true })).toBeVisible();
  expect(await page.locator("script").count()).toBe(scriptCount);
  expect(await page.locator("script", { hasText: "Login only" }).count()).toBe(0);

  const removePrimary = page.getByRole("button", { name: "Remove Primary" });
  await removePrimary.click();
  await expect(page.getByRole("dialog", { name: "Remove login wallet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Remove login wallet" })).toHaveCount(0);
  await expect(removePrimary).toBeFocused();

  await removePrimary.click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Confirm remove" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.getByRole("button", { name: "Confirm remove" }).click();
  await expect(page.getByText("0x1111...1111")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "登录钱包已移除" })).toBeVisible();
  await expectNoForbiddenRpc(page);
});
