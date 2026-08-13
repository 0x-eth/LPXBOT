import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type Fixture =
  | "anonymous"
  | "user"
  | "pro"
  | "admin"
  | "pending"
  | "rejected"
  | "banned"
  | "maintenance"
  | "region-blocked";

const sessions = {
  admin: {
    allowedChainIds: [1, 56],
    avatarUrl: null,
    displayName: "Fixture Admin",
    maintenanceBypass: false,
    role: "admin",
    tier: "normal",
    userId: "00000000-0000-4000-8000-000000000003",
  },
  pro: {
    allowedChainIds: [1, 56, 8453],
    avatarUrl: null,
    displayName: "Fixture Pro",
    maintenanceBypass: false,
    role: "pro",
    tier: "pro",
    userId: "00000000-0000-4000-8000-000000000002",
  },
  user: {
    allowedChainIds: [1, 56],
    avatarUrl: null,
    displayName: "Fixture User",
    maintenanceBypass: false,
    role: "user",
    tier: "normal",
    userId: "00000000-0000-4000-8000-000000000001",
  },
} as const;

const errors = {
  anonymous: [401, "UNAUTHENTICATED"],
  banned: [403, "ACCOUNT_BANNED"],
  maintenance: [503, "MAINTENANCE"],
  pending: [403, "ACCOUNT_PENDING"],
  "region-blocked": [403, "REGION_BLOCKED"],
  rejected: [403, "ACCOUNT_REJECTED"],
} as const;

async function fulfillAuth(route: Route, fixture: Fixture): Promise<void> {
  if (fixture === "user" || fixture === "pro" || fixture === "admin") {
    await route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          isAdmin: fixture === "admin",
          maintenance: null,
          user: sessions[fixture],
        },
        requestId: "req-e2e",
      },
      status: 200,
    });
    return;
  }

  const [status, code] = errors[fixture];
  await route.fulfill({
    contentType: "application/json",
    json: {
      success: false,
      error: {
        code,
        message: `Fixture ${code.toLowerCase().replaceAll("_", " ")}`,
        requestId: "req-e2e",
        retryable: status === 503,
      },
    },
    status,
  });
}

async function useFixture(page: Page, fixture: Fixture): Promise<void> {
  await page.route("**/api/auth/me", (route) => fulfillAuth(route, fixture));
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
}

test("booting resolves to anonymous and protects application routes", async ({ page }) => {
  await useFixture(page, "anonymous");
  await page.goto("/tasks/running");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText("Choose a sign-in method")).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

for (const fixture of ["pending", "rejected", "banned"] as const) {
  test(`${fixture} accounts enter the blocked route`, async ({ page }) => {
    await useFixture(page, fixture);
    await page.goto("/tasks/running");

    await expect(page).toHaveURL(/\/blocked$/);
    await expect(page.getByRole("heading", { level: 1, name: "Account access" })).toBeVisible();
    await expect(page.getByTestId("blocked-reason")).toHaveText(fixture);
    await expectNoSeriousAxeViolations(page);
  });
}

test("maintenance receives a dedicated 503 state", async ({ page }) => {
  await useFixture(page, "maintenance");
  await page.goto("/tasks/running");

  await expect(page).toHaveURL(/\/maintenance$/);
  await expect(page.getByRole("heading", { level: 1, name: "Maintenance" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("temporarily unavailable");
  await expectNoSeriousAxeViolations(page);
});

test("region policy receives a dedicated blocked state", async ({ page }) => {
  await useFixture(page, "region-blocked");
  await page.goto("/tasks/running");

  await expect(page).toHaveURL(/\/blocked$/);
  await expect(page.getByRole("heading", { level: 1, name: "Region unavailable" })).toBeVisible();
  await expect(page.getByTestId("blocked-reason")).toHaveText("region-blocked");
  await expectNoSeriousAxeViolations(page);
});

test("user and pro are denied /users without rendering protected data", async ({ page }) => {
  await useFixture(page, "pro");
  await page.goto("/users");

  await expect(page).toHaveURL(/\/tasks\/running$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page.getByText("User administration")).toHaveCount(0);
});

test("admin can enter /users and all navigation is keyboard reachable", async ({ page }) => {
  await useFixture(page, "admin");
  await page.goto("/users");

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(page.getByText("User administration")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Tasks" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Users" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/users$/);
  await expectNoSeriousAxeViolations(page);
});

test("a later 401 clears the active SessionView and returns to login", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/auth/me", async (route) => {
    calls += 1;
    await fulfillAuth(route, calls === 1 ? "user" : "anonymous");
  });
  await page.goto("/tasks/running");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh session" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
