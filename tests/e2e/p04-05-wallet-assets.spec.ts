import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P04_05 === "1";
const userId = "59000000-0000-4000-8000-000000000001";
const walletId = "59000000-0000-4000-8000-000000000011";
const entryId = "59000000-0000-4000-8000-000000000021";
const createdEntryId = "59000000-0000-4000-8000-000000000022";
const walletAddress = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const defaultToken = "0x55d398326f99059ff775485246999027b3197955";
const customToken = "0x1111111111111111111111111111111111111111";
const importedToken = "0x4444444444444444444444444444444444444444";
const knownAddress = "0x2222222222222222222222222222222222222222";
const newAddress = "0x3333333333333333333333333333333333333333";
const securityPassword = "synthetic-address-book-password";
const sensitiveRpcMarker = "SENSITIVE_RPC_VALUE";

interface TokenFixture {
  chainId: number;
  decimals: number;
  default: boolean;
  name: string;
  symbol: string;
  tokenAddress: string;
}

interface EntryFixture {
  address: string;
  category: "exchange" | "other" | "person" | "protocol";
  chainId: number;
  createdAt: string;
  entryId: string;
  label: string;
  note: string;
  revision: number;
  updatedAt: string;
}

interface WalletReadFixture {
  apiTraffic: string[];
  entries: EntryFixture[];
  tokens: TokenFixture[];
}

function envelope(data: unknown) {
  return { data, requestId: "p04-05-e2e", success: true };
}

function wallet() {
  return {
    address: walletAddress,
    createdAt: "2026-08-18T12:00:00.000Z",
    envelopeVersion: 1,
    lockStatus: "ready",
    mode: "server-kek",
    name: "Treasury signer",
    revision: 1,
    updatedAt: "2026-08-18T12:00:00.000Z",
    walletId,
  };
}

function initialFixture(): WalletReadFixture {
  return {
    apiTraffic: [],
    entries: [
      {
        address: knownAddress,
        category: "exchange",
        chainId: 56,
        createdAt: "2026-08-18T12:00:00.000Z",
        entryId,
        label: "Known exchange",
        note: "Local fixture",
        revision: 1,
        updatedAt: "2026-08-18T12:00:00.000Z",
      },
    ],
    tokens: [
      {
        chainId: 56,
        decimals: 18,
        default: true,
        name: "Tether USD",
        symbol: "USDT",
        tokenAddress: defaultToken,
      },
      {
        chainId: 56,
        decimals: 6,
        default: false,
        name: "Fixture Dollar",
        symbol: "FIX",
        tokenAddress: customToken,
      },
    ],
  };
}

async function installShell(page: Page, state: WalletReadFixture): Promise<void> {
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      state.apiTraffic.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
    }
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({
        isAdmin: false,
        maintenance: null,
        user: {
          allowedChainIds: [56],
          avatarUrl: null,
          displayName: "P04-05 Fixture",
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
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({ running: 0, stopped: 0, succeeded: 0, failed: 0 }),
    }),
  );
}

function balancePage(state: WalletReadFixture) {
  const items = [
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
    ...state.tokens.map((token) => {
      if (token.tokenAddress === defaultToken) {
        return {
          assetType: "erc20",
          balanceBaseUnit: "1000000000000000000",
          balanceDecimal: "1",
          decimals: token.decimals,
          default: token.default,
          name: token.name,
          priceStatus: "stale",
          symbol: token.symbol,
          tokenAddress: token.tokenAddress,
          usdPriceDecimal: "1",
          usdValueDecimal: null,
        };
      }
      return {
        assetType: "erc20",
        balanceBaseUnit: token.tokenAddress === customToken ? "1234567" : "0",
        balanceDecimal: token.tokenAddress === customToken ? "1.234567" : "0",
        decimals: token.decimals,
        default: token.default,
        name: token.name,
        priceStatus: "missing",
        symbol: token.symbol,
        tokenAddress: token.tokenAddress,
        usdPriceDecimal: null,
        usdValueDecimal: null,
      };
    }),
  ];
  return {
    address: walletAddress,
    blockNumberDecimal: "48100000",
    chainId: 56,
    items,
    readAt: "2026-08-18T12:00:00.000Z",
    totalUsdValueDecimal: null,
    walletId,
  };
}

function amountBaseUnit(amount: string, decimals: number): string {
  const [whole, fraction = ""] = amount.split(".");
  return `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=[0-9])/u, "") || "0";
}

async function installWalletRoutes(page: Page, state: WalletReadFixture): Promise<void> {
  await page.route("**/api/wallets**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/wallets") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ items: [wallet()] }),
      });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/balances")) {
      await route.fulfill({ contentType: "application/json", json: envelope(balancePage(state)) });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/tokens")) {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ chainId: 56, items: state.tokens, walletId }),
      });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/tokens")) {
      const body = JSON.parse(request.postData() ?? "{}") as { tokenAddress: string };
      const imported = {
        chainId: 56,
        decimals: 8,
        default: false,
        name: "New Fixture Token",
        symbol: "NEW",
        tokenAddress: body.tokenAddress.toLowerCase(),
      };
      state.tokens.push(imported);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(imported),
        status: 201,
      });
      return;
    }
    if (request.method() === "DELETE" && url.pathname.includes("/tokens/")) {
      const tokenAddress = decodeURIComponent(url.pathname.split("/").at(-1)!).toLowerCase();
      const index = state.tokens.findIndex((token) => token.tokenAddress === tokenAddress);
      if (index >= 0) state.tokens.splice(index, 1);
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ deleted: index >= 0 }),
      });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/receive")) {
      const tokenAddress = url.searchParams.get("tokenAddress");
      const amountDecimal = url.searchParams.get("amountDecimal");
      const token = state.tokens.find((candidate) => candidate.tokenAddress === tokenAddress);
      const amount = amountDecimal ? amountBaseUnit(amountDecimal, token?.decimals ?? 18) : null;
      const eip681 = tokenAddress
        ? `ethereum:${tokenAddress}@56/transfer?address=${walletAddress}${
            amount === null ? "" : `&uint256=${amount}`
          }`
        : `ethereum:${walletAddress}@56${amount === null ? "" : `?value=${amount}`}`;
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          address: walletAddress,
          amountBaseUnit: amount,
          amountDecimal,
          chainId: 56,
          eip681,
          tokenAddress,
          walletId,
        }),
      });
      return;
    }
    await route.abort("failed");
  });

  await page.route("**/api/address-book**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      const classify = url.searchParams.get("address")?.toLowerCase() ?? null;
      const known = state.entries.find((entry) => entry.address === classify);
      const classification =
        classify === null
          ? null
          : classify === walletAddress.toLowerCase()
            ? { address: classify, entryId: null, kind: "own-wallet", walletId }
            : known
              ? {
                  address: classify,
                  entryId: known.entryId,
                  kind: "known-external",
                  walletId: null,
                }
              : { address: classify, entryId: null, kind: "new-external", walletId: null };
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          chainId: 56,
          classification,
          entries: state.entries,
          ownWallets: [{ address: walletAddress, name: "Treasury signer", walletId }],
        }),
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/address-book") {
      expect(request.headers()["content-type"]).toBe(
        "application/vnd.lpbot.address-book-secret+json",
      );
      const body = JSON.parse(request.postData() ?? "{}") as {
        address: string;
        category: EntryFixture["category"];
        label: string;
        note: string;
        password: string;
      };
      expect(body.password).toBe(securityPassword);
      const created: EntryFixture = {
        address: body.address.toLowerCase(),
        category: body.category,
        chainId: 56,
        createdAt: "2026-08-18T12:01:00.000Z",
        entryId: createdEntryId,
        label: body.label,
        note: body.note,
        revision: 1,
        updatedAt: "2026-08-18T12:01:00.000Z",
      };
      state.entries.push(created);
      await route.fulfill({
        contentType: "application/json",
        json: envelope(created),
        status: 201,
      });
      return;
    }
    if (request.method() === "DELETE") {
      const target = url.pathname.split("/").at(-1);
      const index = state.entries.findIndex((entry) => entry.entryId === target);
      if (index >= 0) state.entries.splice(index, 1);
      await route.fulfill({ contentType: "application/json", json: envelope({ deleted: true }) });
      return;
    }
    await route.abort("failed");
  });
}

async function installSettingsRoutes(page: Page): Promise<void> {
  await page.route("**/api/keystore/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({ configured: false, status: "unconfigured", version: 0 }),
    }),
  );
  await page.route("**/api/security-password/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({ configured: false, status: "unconfigured", version: 0 }),
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
  await page.route("**/api/notification-destinations/options", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: envelope({ telegramIdentityId: null }),
    }),
  );
  await page.route("**/api/notification-destinations", (route) =>
    route.fulfill({ contentType: "application/json", json: envelope([]) }),
  );
}

async function assertVisualSafety(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("wallet assets, custom tokens, EIP-681 QR and address book work on desktop/mobile", async ({
  page,
}, testInfo) => {
  const state = initialFixture();
  await installShell(page, state);
  await installWalletRoutes(page, state);
  await page.goto("/wallets");

  await expect(page.getByRole("heading", { name: "资产" })).toBeVisible();
  await expect(page.getByText("$600", { exact: true })).toBeVisible();
  await expect(page.getByText("价格已过期")).toBeVisible();
  await expect(page.getByText("暂无价格")).toBeVisible();
  const qr = page.getByRole("img", { name: "收款二维码 Treasury signer" });
  await expect(qr).toHaveAttribute("src", /^data:image\/gif;base64,/u);
  expect(await qr.evaluate((image: HTMLImageElement) => image.naturalWidth > 0)).toBe(true);

  await page.getByLabel("收款资产").selectOption(customToken);
  await page.getByLabel("收款数量").fill("2.5");
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect(page.getByTestId("receive-content")).toContainText(
    `ethereum:${customToken}@56/transfer?address=${walletAddress}&uint256=2500000`,
  );

  await page.getByLabel("Token 合约地址").fill(importedToken);
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const walletAssets = page.getByLabel("钱包资产");
  await expect(walletAssets.getByText("NEW", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除 NEW" }).click();
  await expect(walletAssets.getByText("NEW", { exact: true })).toHaveCount(0);

  await page.getByLabel("地址簿地址").fill(newAddress);
  await page.getByLabel("地址簿名称").click();
  await expect(page.getByText("新外部地址", { exact: true })).toBeVisible();
  await page.getByLabel("地址簿名称").fill("New contact");
  await page.getByLabel("地址簿备注").fill("Local only");
  await page.getByLabel("安全密码").fill(securityPassword);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("New contact", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(securityPassword);
  await page.getByRole("button", { name: "删除 New contact" }).click();
  await expect(page.getByText("New contact", { exact: true })).toHaveCount(0);

  await assertVisualSafety(page);
  if (captureEvidence) {
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-05/E-VIS/wallet-assets-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
  expect(state.apiTraffic.join("\n")).not.toMatch(/rpc\.fixture|SENSITIVE_RPC_VALUE/iu);
});

test("custom RPC runs from an opaque sandbox and never enters API traffic or screenshots", async ({
  page,
}, testInfo) => {
  const state = initialFixture();
  const rpcRequests: Array<{ frameUrl: string; method: string; origin: string | undefined }> = [];
  await installShell(page, state);
  await installSettingsRoutes(page);
  await page.route("https://rpc.fixture/**", async (route: Route) => {
    const request = route.request();
    const cors = {
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: cors, status: 204 });
      return;
    }
    const body = JSON.parse(request.postData() ?? "{}") as { id: number; method: string };
    rpcRequests.push({
      frameUrl: request.frame().url(),
      method: body.method,
      origin: request.headers().origin,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({
      contentType: "application/json",
      headers: cors,
      json: {
        id: body.id,
        jsonrpc: "2.0",
        result: body.method === "eth_chainId" ? "0x38" : "0x2dc6c01",
      },
    });
  });

  await page.goto("/settings");
  const input = page.getByLabel("自定义 RPC URL");
  const rawUrl = `https://rpc.fixture/private?token=${sensitiveRpcMarker}`;
  await input.fill(rawUrl);
  await expect(input).toHaveAttribute("type", "password");
  await input.blur();
  await expect(input).toHaveValue("https://rpc.fixture/<redacted>");
  await page.getByRole("button", { name: "测试", exact: true }).click();
  await expect
    .poll(() => page.locator('iframe[sandbox="allow-scripts"]').count())
    .toBeGreaterThan(0);
  await expect(page.getByText("区块 48000001")).toBeVisible();
  await expect(page.locator(".rpc-state")).toContainText("可用");

  expect(rpcRequests).toHaveLength(2);
  expect(rpcRequests.map(({ method }) => method).sort()).toEqual([
    "eth_blockNumber",
    "eth_chainId",
  ]);
  expect(rpcRequests.every(({ frameUrl }) => frameUrl === "about:srcdoc")).toBe(true);
  expect(rpcRequests.every(({ origin }) => origin === "null")).toBe(true);
  expect(state.apiTraffic.join("\n")).not.toContain(sensitiveRpcMarker);
  await expect(input).toHaveValue("https://rpc.fixture/<redacted>");
  expect(await page.content()).not.toContain(sensitiveRpcMarker);
  await assertVisualSafety(page);

  if (captureEvidence) {
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-05/E-VIS/custom-rpc-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});
