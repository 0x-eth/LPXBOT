import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const addressA = "0x4444444444444444444444444444444444444444";
const addressB = "0x5555555555555555555555555555555555555555";
const idleAddress = "0x7777777777777777777777777777777777777777";

async function useSession(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "P02-05 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000055",
          },
        },
        requestId: "req-p02-05-e2e",
        success: true,
      },
      status: 200,
    }),
  );
}

function remarkPayload() {
  return {
    remarks: [
      { address: addressA, label: "核心 LP", watched: true },
      { address: idleAddress, label: "观察地址", watched: true },
    ],
    shared: [{ address: addressB, label: "<b>共享鲸鱼</b>", votes: 2 }],
  };
}

async function useRemarks(page: Page): Promise<void> {
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: remarkPayload(), requestId: "remark-list", success: true },
      status: 200,
    }),
  );
}

async function openAddressView(page: Page): Promise<void> {
  const panel = page.getByRole("region", { name: "流动性事件" });
  await panel.getByRole("radio", { exact: true, name: "地址" }).click();
  await expect(panel.getByRole("table", { name: "地址聚合" })).toBeVisible();
}

test("FLOW-03/04 share filtered projection and expose stable watched address operations", async ({
  page,
}, testInfo) => {
  await useSession(page);
  await useRemarks(page);
  await page.goto("/pools?fixture=pools-ready");

  const panel = page.getByRole("region", { name: "流动性事件" });
  const stats = panel.getByRole("group", { name: "流动性统计" });
  await expect(stats.locator('[data-metric="inflow"]')).toContainText("250.125");
  await expect(stats.locator('[data-metric="outflow"]')).toContainText("125.5");
  await expect(stats.locator('[data-metric="net"]')).toContainText("124.625");
  await expect(stats.locator('[data-metric="events"]')).toContainText("4");
  await expect(stats.locator('[data-metric="addresses"]')).toContainText("3");
  await expect(stats.locator('[data-metric="completeness"]')).toContainText("1 未估值");
  await expect(stats).toHaveAttribute("data-completeness", "partial");

  await panel.getByRole("radio", { exact: true, name: "V4" }).click();
  await expect(stats.locator('[data-metric="inflow"]')).toContainText("0");
  await expect(stats.locator('[data-metric="outflow"]')).toContainText("125.5");
  await expect(stats.locator('[data-metric="events"]')).toContainText("2");
  await expect(stats.locator('[data-metric="addresses"]')).toContainText("2");
  await panel.getByRole("radio", { exact: true, name: "全部版本" }).click();

  const streamTable = panel.getByRole("table", { name: "流动性事件列表" });
  const addressTable = panel.getByRole("table", { name: "地址聚合" });
  if (testInfo.project.name === "chromium-desktop") {
    await expect(streamTable).toBeVisible();
    await expect(addressTable).toBeVisible();
  } else {
    await expect(streamTable).toBeVisible();
    await expect(addressTable).toBeHidden();
    await openAddressView(page);
    await expect(streamTable).toBeHidden();
  }

  await expect(addressTable.getByText("核心 LP", { exact: true })).toBeVisible();
  await expect(addressTable.getByText("<b>共享鲸鱼</b>", { exact: true })).toBeVisible();
  await expect(addressTable.locator("b")).toHaveCount(0);
  await expect(addressTable.getByText("partial", { exact: true })).toBeVisible();

  const watchedOnly = panel.getByRole("button", { name: "只看关注地址" });
  await watchedOnly.click();
  await expect(watchedOnly).toHaveAttribute("aria-pressed", "true");
  await expect(addressTable.getByText("观察地址", { exact: true })).toBeVisible();
  await expect(addressTable.getByText("idle", { exact: true })).toBeVisible();
  await expect(addressTable.getByText("<b>共享鲸鱼</b>", { exact: true })).toHaveCount(0);

  for (const sort of ["净额", "笔数", "最近"]) {
    await panel.getByRole("radio", { exact: true, name: sort }).click();
    await expect(panel.getByRole("radio", { exact: true, name: sort })).toBeChecked();
  }
  await expect(
    addressTable.getByRole("link", { name: `在 BscScan 查看 ${addressA}` }),
  ).toHaveAttribute("href", `https://bscscan.com/address/${addressA}`);
  for (const action of ["筛选", "复制", "编辑备注", "取消关注"]) {
    await expect(addressTable.getByRole("button", { name: new RegExp(`^${action}`, "u") })).toBeVisible();
  }
  await expect(addressTable.getByRole("button", { name: /资金|任务|转账|建仓/u })).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
});

test("FLOW-05 optimistic save rolls back exactly and preserves the user's input", async ({ page }) => {
  await useSession(page);
  let failNextPut = true;
  let personal = { address: addressA, label: "核心 LP", watched: true };
  await page.route("**/api/address-remarks", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: { ...remarkPayload(), remarks: [personal] },
          requestId: "remark-list",
          success: true,
        },
        status: 200,
      });
      return;
    }
    if (failNextPut) {
      failNextPut = false;
      await route.fulfill({
        contentType: "application/json",
        json: {
          error: { code: "REMARK_WRITE_FAILED", retryable: true },
          success: false,
        },
        status: 503,
      });
      return;
    }
    personal = JSON.parse(route.request().postData()!) as typeof personal;
    await route.fulfill({
      contentType: "application/json",
      json: { data: { remark: personal }, requestId: "remark-put", success: true },
      status: 200,
    });
  });
  await page.goto("/pools?fixture=pools-ready");
  await openAddressView(page);

  await page.getByRole("button", { name: `编辑备注 ${addressA}` }).click();
  const dialog = page.getByRole("dialog", { name: "地址备注" });
  const input = dialog.getByLabel("备注标签");
  await input.fill("保留的用户输入");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.getByRole("alert")).toContainText("备注保存失败");
  await expect(input).toHaveValue("保留的用户输入");
  await expect(page.getByRole("table", { name: "地址聚合" }).getByText("核心 LP")).toBeVisible();

  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("table", { name: "地址聚合" }).getByText("保留的用户输入"),
  ).toBeVisible();
});

test("FLOW-05 exposes remark loading and retryable error states", async ({ page }) => {
  await useSession(page);
  let pendingRoute: Route | null = null;
  await page.route("**/api/address-remarks", (route) => {
    pendingRoute = route;
  });
  await page.goto("/pools?fixture=pools-ready");
  await openAddressView(page);
  await expect(page.getByRole("status")).toContainText("正在加载备注");
  await pendingRoute!.fulfill({
    contentType: "application/json",
    json: {
      error: { code: "ADDRESS_REMARKS_UNAVAILABLE", retryable: true },
      success: false,
    },
    status: 503,
  });
  await expect(page.getByRole("alert")).toContainText("备注加载失败");
  await expect(page.getByRole("button", { name: "重试加载备注" })).toBeVisible();
});
