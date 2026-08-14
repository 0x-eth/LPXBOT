import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Route } from "@playwright/test";

const session = {
  allowedChainIds: [1, 56],
  avatarUrl: null,
  displayName: "Telegram Fixture",
  maintenanceBypass: false,
  role: "user",
  tier: "normal",
  userId: "30000000-0000-4000-8000-000000000001",
};
const token = "T".repeat(43);

function activeEnvelope() {
  return {
    success: true,
    data: { isAdmin: false, maintenance: null, user: session },
    requestId: "req-telegram-e2e",
  };
}

async function anonymous(route: Route): Promise<void> {
  await route.fulfill({
    contentType: "application/json",
    json: {
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: "req-anonymous",
        retryable: false,
      },
    },
    status: 401,
  });
}

test("Mini App adapter signs in on mobile without browser storage", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "Telegram", {
      configurable: true,
      value: { WebApp: { initData: "signed-mini-app-fixture", ready() {} } },
    });
  });
  let submittedBody: unknown = null;
  await page.route("**/api/auth/me", async (route) => {
    if (!route.request().postData()) {
      await anonymous(route);
      return;
    }
    submittedBody = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", json: activeEnvelope(), status: 200 });
  });

  await page.goto("/login");
  const miniApp = page.getByRole("button", { name: "Telegram Mini App" });
  await expect(miniApp).toBeEnabled();
  await miniApp.focus();
  await expect(miniApp).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/tasks\/running$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  expect(submittedBody).toEqual({ initData: "signed-mini-app-fixture" });
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
  expect(await page.evaluate(() => ({ ...sessionStorage }))).toEqual({});
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
});

test("Bot login recovers from link creation failure", async ({ page }) => {
  await page.route("**/api/auth/me", anonymous);
  let creates = 0;
  await page.route("**/api/auth/login-token", async (route) => {
    creates += 1;
    if (creates === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          success: false,
          error: {
            code: "UPSTREAM_TIMEOUT",
            message: "Login link creation timed out",
            requestId: "req-failed-create",
            retryable: true,
          },
        },
        status: 500,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          loginUrl: `https://t.me/local_fixture_bot?start=${token}`,
          token,
        },
        requestId: "req-created",
      },
      status: 200,
    });
  });
  await page.route("**/api/auth/login-status/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: { confirmed: false, session: null, status: "pending" },
        requestId: "req-pending",
      },
      status: 200,
    }),
  );

  await page.goto("/login");
  await page.getByRole("button", { name: "Telegram Bot" }).click();
  await expect(page.getByRole("alert")).toContainText("timed out");
  await page.getByRole("button", { name: "Retry Telegram login" }).click();

  const openTelegram = page.getByRole("link", { name: "Open Telegram" });
  await expect(openTelegram).toHaveAttribute(
    "href",
    `https://t.me/local_fixture_bot?start=${token}`,
  );
  await expect(page.getByRole("button", { name: "Cancel Telegram login" })).toBeVisible();
});

test("two pages converge through a credential-free BroadcastChannel message", async ({
  context,
}) => {
  await captureBroadcastMessages(context);
  let authenticated = false;
  let polls = 0;
  await context.route("**/api/auth/me", (route) =>
    authenticated
      ? route.fulfill({ contentType: "application/json", json: activeEnvelope(), status: 200 })
      : anonymous(route),
  );
  await context.route("**/api/auth/login-token", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          loginUrl: `https://t.me/local_fixture_bot?start=${token}`,
          token,
        },
        requestId: "req-cross-create",
      },
      status: 200,
    }),
  );
  await context.route("**/api/auth/login-status/**", async (route) => {
    polls += 1;
    if (polls === 1) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          success: true,
          data: { confirmed: false, session: null, status: "pending" },
          requestId: "req-cross-pending",
        },
        status: 200,
      });
      return;
    }
    authenticated = true;
    await route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: { confirmed: true, session, status: "consumed" },
        requestId: "req-cross-consumed",
      },
      status: 200,
    });
  });

  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/login"), second.goto("/login")]);
  await first.getByRole("button", { name: "Telegram Bot" }).click();

  await expect(first.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible({
    timeout: 5_000,
  });
  await expect(second.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible({
    timeout: 5_000,
  });
  const messages = await first.evaluate(
    () => (globalThis as unknown as { __authMessages: unknown[] }).__authMessages,
  );
  expect(messages).toEqual([{ type: "auth-complete" }]);
  expect(JSON.stringify(messages)).not.toContain(token);
  expect(JSON.stringify(messages)).not.toContain(session.userId);
});

async function captureBroadcastMessages(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    interface FixtureBroadcastChannel {
      postMessage(message: unknown): void;
    }
    interface FixtureBrowserGlobal {
      BroadcastChannel: new (name: string) => FixtureBroadcastChannel;
      __authMessages: unknown[];
    }
    const browser = globalThis as unknown as FixtureBrowserGlobal;
    const NativeBroadcastChannel = browser.BroadcastChannel;
    const messages: unknown[] = [];
    browser.__authMessages = messages;
    browser.BroadcastChannel = class extends NativeBroadcastChannel {
      override postMessage(message: unknown): void {
        messages.push(message);
        super.postMessage(message);
      }
    };
  });
}
