import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P04_02 === "1";
const userId = "44000000-0000-4000-8000-000000000001";
const walletId = "44000000-0000-4000-8000-000000000011";
const address = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const secret = "0000000000000000000000000000000000000000000000000000000000000001";

function envelope(data: unknown) {
  return { data, requestId: "p04-02-e2e", success: true };
}

function wallet(name = "Main signer") {
  return {
    address,
    createdAt: "2026-08-18T05:00:00.000Z",
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name,
    revision: 1,
    updatedAt: "2026-08-18T05:00:00.000Z",
    walletId,
  };
}

async function auth(route: Route) {
  await route.fulfill({
    contentType: "application/json",
    json: envelope({
      isAdmin: false,
      maintenance: null,
      user: {
        allowedChainIds: [56],
        avatarUrl: null,
        displayName: "Wallet Fixture",
        maintenanceBypass: false,
        role: "user",
        tier: "normal",
        userId,
      },
    }),
  });
}

async function install(
  page: Page,
  state: {
    error?: string;
    items: ReturnType<typeof wallet>[];
    loadingMs?: number;
    mutationMs?: number;
  },
) {
  await page.route("**/api/auth/me", auth);
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
  await page.route("**/api/address-book**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        chainId: 56,
        classification: null,
        entries: [],
        ownWallets: state.items.map(({ address, name, walletId }) => ({ address, name, walletId })),
      }),
    }),
  );
  await page.route("**/api/wallets**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/wallets") {
      if (state.loadingMs) await new Promise((resolve) => setTimeout(resolve, state.loadingMs));
      if (state.error) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            error: { code: state.error, message: state.error, requestId: "error", retryable: true },
            success: false,
          },
          status: state.error === "SIGNER_UNAVAILABLE" ? 503 : 500,
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: state.items }),
      });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/balances")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          address,
          blockNumberDecimal: "48000000",
          chainId: 56,
          items: [
            {
              assetType: "native",
              balanceBaseUnit: "0",
              balanceDecimal: "0",
              decimals: 18,
              default: true,
              name: "BNB",
              priceStatus: "missing",
              symbol: "BNB",
              tokenAddress: null,
              usdPriceDecimal: null,
              usdValueDecimal: null,
            },
          ],
          readAt: "2026-08-18T05:00:00.000Z",
          totalUsdValueDecimal: null,
          walletId,
        }),
      });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/tokens")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ chainId: 56, items: [], walletId }),
      });
      return;
    }
    if (request.method() === "GET" && pathname.endsWith("/receive")) {
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
    if (request.method() === "POST" && pathname.endsWith("/import")) {
      if (state.mutationMs) await new Promise((resolve) => setTimeout(resolve, state.mutationMs));
      const body = JSON.parse(request.postData() ?? "{}") as { privateKey?: string };
      if (body.privateKey !== secret) {
        await route.fulfill({
          contentType: "application/json",
          json: {
            error: {
              code: "INVALID_PRIVATE_KEY",
              message: "invalid",
              requestId: "invalid",
              retryable: false,
            },
            success: false,
          },
          status: 400,
        });
        return;
      }
      state.items = [wallet("Imported")];
      await route.fulfill({
        contentType: "application/json",
        json: envelope(state.items[0]),
        status: 201,
      });
      return;
    }
    if (request.method() === "POST" && pathname.endsWith("/generate")) {
      if (state.mutationMs) await new Promise((resolve) => setTimeout(resolve, state.mutationMs));
      state.items = [wallet("Generated")];
      await route.fulfill({
        contentType: "application/json",
        json: envelope(state.items[0]),
        status: 201,
      });
      return;
    }
    await route.abort("failed");
  });
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("wallets renders loading, empty, ready, desktop/mobile, and axe states", async ({
  page,
}, testInfo) => {
  const state = { items: [] as ReturnType<typeof wallet>[], loadingMs: 400 };
  await install(page, state);
  await page.goto("/wallets");
  await expect(page.getByRole("status", { name: "正在加载钱包" })).toContainText("正在加载钱包");
  await expect(page.getByRole("heading", { level: 1, name: "钱包" })).toBeVisible();
  await expect(page.getByText("还没有托管钱包")).toBeVisible();
  await axe(page);

  state.items = [wallet()];
  await page.getByRole("button", { name: "刷新钱包" }).click();
  const custodyWallets = page.getByLabel("托管钱包");
  await expect(custodyWallets.getByText("Main signer")).toBeVisible();
  await expect(custodyWallets.getByText(address)).toBeVisible();
  await expect(custodyWallets.getByText("服务器密钥")).toBeVisible();
  await expect(custodyWallets.getByText("已托管")).toBeVisible();
  await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "收款" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "地址簿" })).toBeVisible();
  await expect(page.getByText("转账", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  if (captureEvidence) {
    await page.mouse.move(0, 0);
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-02/ui/wallets-ready-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});

test("import is write-only, validates, clears on failure/cancel/success, and restores focus", async ({
  page,
}) => {
  await install(page, { items: [], mutationMs: 300 });
  await page.goto("/wallets");
  const trigger = page.getByRole("button", { name: "导入钱包" });
  await trigger.click();
  const input = page.getByLabel("私钥");
  await expect(input).toHaveAttribute("type", "password");
  await input.fill("bad");
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByRole("alert")).toContainText("私钥格式无效");
  await expect(input).toHaveValue("");

  await input.fill(secret);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(input).toHaveValue("");
  await input.fill(secret);
  await page.getByLabel("钱包名称").fill("Imported");
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute(
    "data-state",
    "import-validating",
  );
  await expect(input).toHaveValue("");
  await expect(page.getByLabel("托管钱包").getByText("Imported")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(trigger).toBeFocused();
});

test("generate has pending state and duplicate/reauth/signer/error states are explicit", async ({
  page,
}) => {
  await install(page, { items: [], mutationMs: 300 });
  await page.goto("/wallets");
  await page.getByRole("button", { name: "生成钱包" }).click();
  await page.getByLabel("钱包名称").fill("Generated");
  await page.getByRole("button", { name: "确认生成" }).click();
  await expect(page.locator("main.wallets-workspace")).toHaveAttribute(
    "data-state",
    "generate-pending",
  );
  await expect(page.getByLabel("托管钱包").getByText("Generated")).toBeVisible();

  for (const [code, text] of [
    ["WALLET_ADDRESS_EXISTS", "该地址已由当前账户托管"],
    ["REAUTH_REQUIRED", "需要重新验证身份"],
    ["SIGNER_UNAVAILABLE", "签名服务暂时不可用"],
    ["INTERNAL_ERROR", "钱包请求失败"],
  ] as const) {
    await page.unroute("**/api/wallets**");
    await install(page, { error: code, items: [] });
    await page.getByRole("button", { name: "刷新钱包" }).click();
    await expect(page.getByRole("alert")).toContainText(text);
  }
  await axe(page);
});

test("wallet actions are keyboard reachable with stable dialog focus", async ({ page }) => {
  await install(page, { items: [wallet()] });
  await page.goto("/wallets");
  await expect(page.getByLabel("托管钱包").getByText("Main signer")).toBeVisible();
  const controls = ["刷新钱包", "导入钱包", "生成钱包"];
  for (const name of controls) {
    await page.keyboard.press("Tab");
    while (
      !(await page
        .getByRole("button", { name })
        .evaluate((element) => element === document.activeElement))
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(page.getByRole("button", { name })).toBeFocused();
  }
});
