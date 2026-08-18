import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const captureEvidence = process.env.LPBOT_CAPTURE_P04_07 === "1";
const userId = "73000000-0000-4000-8000-000000000001";
const apiKey = "synthetic-e2e-api-key";
const secretKey = "synthetic-e2e-secret-key";
const passphrase = "synthetic-e2e-passphrase";

type Status =
  | "unconfigured"
  | "staged"
  | "testing"
  | "usable"
  | "invalid"
  | "revoked"
  | "insufficient-permission"
  | "unknown"
  | "deleting";

interface Fixture {
  configured: boolean;
  nextError: string | null;
  requestBodies: string[];
  status: Status;
  testDelay: number;
  version: number;
}

function envelope(data: unknown) {
  return { data, requestId: "p04-07-e2e", success: true };
}

function preferences() {
  return {
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
  };
}

async function fail(route: Route, code: string): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    json: {
      error: { code, message: "fixture provider detail", retryable: code.includes("UNAVAILABLE") },
      success: false,
    },
    status: code === "VERSION_CONFLICT" ? 409 : code === "CREDENTIAL_INVALID" ? 422 : 503,
  });
}

async function install(page: Page, fixture: Fixture): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "P04-07 Fixture",
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
      await route.fulfill({ contentType: "application/json", json: envelope(preferences()) });
      return;
    }
    if (path === "/api/settings/okx-key") {
      if (request.method() === "GET") {
        if (fixture.nextError) {
          const code = fixture.nextError;
          fixture.nextError = null;
          await fail(route, code);
        } else {
          await route.fulfill({
            contentType: "application/json",
            json: envelope({
              configured: fixture.configured,
              status: fixture.status,
              version: fixture.version,
            }),
          });
        }
        return;
      }
      expect(request.headers()["content-type"]).toBe("application/vnd.lpbot.okx-key-secret+json");
      const body = request.postData() ?? "";
      fixture.requestBodies.push(body);
      if (fixture.nextError) {
        const code = fixture.nextError;
        fixture.nextError = null;
        await fail(route, code);
        return;
      }
      const parsed = JSON.parse(body) as { expectedVersion?: number };
      if (request.method() === "POST") {
        fixture.configured = true;
        fixture.status = "usable";
        fixture.version = 1;
      } else if (request.method() === "PUT") {
        fixture.configured = true;
        fixture.status = "usable";
        fixture.version = (parsed.expectedVersion ?? 0) + 1;
      } else {
        fixture.configured = false;
        fixture.status = "unconfigured";
      }
      await route.fulfill({
        contentType: "application/json",
        json: envelope({
          configured: fixture.configured,
          status: fixture.status,
          version: fixture.version,
        }),
      });
      return;
    }
    if (path === "/api/settings/okx-key/test") {
      fixture.requestBodies.push(request.postData() ?? "");
      if (fixture.testDelay) await new Promise((resolve) => setTimeout(resolve, fixture.testDelay));
      if (fixture.nextError) {
        const code = fixture.nextError;
        fixture.nextError = null;
        await fail(route, code);
      } else {
        fixture.status = "usable";
        await route.fulfill({
          contentType: "application/json",
          json: envelope({ configured: true, status: "usable", version: fixture.version }),
        });
      }
      return;
    }
    if (path === "/api/keystore/status") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ configured: true, status: "locked", version: 1 }),
      });
      return;
    }
    if (path === "/api/security-password/status") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ configured: false, status: "unconfigured", version: 0 }),
      });
      return;
    }
    if (path === "/api/auth/wallet/links") {
      await route.fulfill({ contentType: "application/json", json: envelope({ links: [] }) });
      return;
    }
    if (path === "/api/notification-preferences") {
      await route.fulfill({
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
      });
      return;
    }
    if (path === "/api/notification-destinations") {
      await route.fulfill({ contentType: "application/json", json: envelope([]) });
      return;
    }
    if (path === "/api/notification-destinations/options") {
      await route.fulfill({
        contentType: "application/json",
        json: envelope({ telegramIdentityId: null }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { error: { code: "FIXTURE_UNAVAILABLE", retryable: false }, success: false },
      status: 503,
    });
  });
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

function emptyFixture(): Fixture {
  return {
    configured: false,
    nextError: null,
    requestBodies: [],
    status: "unconfigured",
    testDelay: 0,
    version: 0,
  };
}

test("OKX settings clears secrets across save, cancel, failure and route changes", async ({
  page,
}, testInfo) => {
  const fixture = emptyFixture();
  await install(page, fixture);
  await page.goto("/settings");
  const section = page.locator(".okx-key-settings");
  await expect(section).toHaveAttribute("data-state", "unconfigured");
  const save = section.getByRole("button", { name: "保存", exact: true });
  await save.focus();
  await page.keyboard.press("Enter");
  const apiInput = page.getByLabel("API Key", { exact: true });
  await expect(apiInput).toBeFocused();
  for (const label of ["API Key", "Secret Key", "Passphrase"]) {
    const input = page.getByLabel(label, { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "off");
    expect(
      await input.evaluate((element) => {
        const event = new ClipboardEvent("copy", { cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
  }
  await apiInput.fill(apiKey);
  await page.getByLabel("Secret Key", { exact: true }).fill(secretKey);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(save).toBeFocused();
  await save.click();
  await expect(apiInput).toHaveValue("");

  await apiInput.fill(apiKey);
  await page.getByLabel("Secret Key", { exact: true }).fill(secretKey);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  fixture.nextError = "CREDENTIAL_INVALID";
  await page.getByRole("button", { name: "保存 OKX Key" }).click();
  await expect(page.getByRole("alert")).toContainText("OKX 拒绝了该凭证");
  for (const label of ["API Key", "Secret Key", "Passphrase"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  }

  await apiInput.fill(apiKey);
  await page.getByLabel("Secret Key", { exact: true }).fill(secretKey);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.goto("/wallets");
  await page.goto("/settings");
  await section.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.getByLabel("API Key", { exact: true }).fill(apiKey);
  await page.getByLabel("Secret Key", { exact: true }).fill(secretKey);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "保存 OKX Key" }).click();
  await expect(section).toHaveAttribute("data-state", "usable");
  await expect(section.getByLabel("OKX Key 状态")).toHaveText("可用");
  await expect(page.locator("body")).not.toContainText(apiKey);
  await expect(page.locator("body")).not.toContainText(secretKey);
  await expect(page.locator("body")).not.toContainText(passphrase);
  expect(fixture.requestBodies.at(-1)).toContain(apiKey);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await axe(page);

  if (captureEvidence) {
    await section.scrollIntoViewIfNeeded();
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      path: `artifacts/acceptance/P04-07/E-VIS/okx-usable-${testInfo.project.name}.png`,
    });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
  }
});

test("OKX settings exposes testing, conflict, connector failure and destructive keyboard flow", async ({
  page,
}) => {
  const fixture: Fixture = {
    ...emptyFixture(),
    configured: true,
    status: "usable",
    testDelay: 150,
    version: 1,
  };
  await install(page, fixture);
  await page.goto("/settings");
  const section = page.locator(".okx-key-settings");
  await section.getByRole("button", { name: "测试" }).click();
  await expect(section).toHaveAttribute("data-state", "testing");
  await expect(section).toHaveAttribute("data-state", "usable");

  await section.getByRole("button", { name: "替换" }).click();
  await page.getByLabel("API Key", { exact: true }).fill(apiKey);
  await page.getByLabel("Secret Key", { exact: true }).fill(secretKey);
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  fixture.nextError = "VERSION_CONFLICT";
  await page.getByRole("button", { name: "替换 OKX Key" }).click();
  await expect(section).toHaveAttribute("data-state", "conflict");
  for (const label of ["API Key", "Secret Key", "Passphrase"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  }
  await page.keyboard.press("Escape");

  fixture.nextError = "CONNECTOR_UNAVAILABLE";
  await section.getByRole("button", { name: "刷新 OKX Key 状态" }).click();
  await expect(section).toHaveAttribute("data-state", "connector-unavailable");
  await expect(section.getByLabel("OKX Key 状态")).toHaveText("Connector 暂不可用");

  await section.getByRole("button", { name: "删除 OKX Key" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog", { name: "删除 OKX Key" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(section.getByRole("button", { name: "删除 OKX Key" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(section).toHaveAttribute("data-state", "unconfigured");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await axe(page);
});

test("OKX settings renders every stable provider status without credential fragments", async ({
  page,
}) => {
  const fixture: Fixture = {
    ...emptyFixture(),
    configured: true,
    status: "usable",
    version: 4,
  };
  await install(page, fixture);
  await page.goto("/settings");
  const section = page.locator(".okx-key-settings");
  for (const [status, label] of [
    ["invalid", "凭证无效"],
    ["revoked", "已撤销"],
    ["insufficient-permission", "权限不符合要求"],
    ["unknown", "状态未知"],
  ] as const) {
    fixture.status = status;
    await section.getByRole("button", { name: "刷新 OKX Key 状态" }).click();
    await expect(section).toHaveAttribute("data-state", status);
    await expect(section.getByLabel("OKX Key 状态")).toHaveText(label);
  }
  await expect(page.locator("body")).not.toContainText(/synthetic-e2e-(?:api|secret|pass)/u);
  await axe(page);
});
