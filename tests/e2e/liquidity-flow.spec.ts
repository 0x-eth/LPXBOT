import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function useSession(page: Page): Promise<void> {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        data: {
          isAdmin: false,
          maintenance: null,
          user: {
            allowedChainIds: [56],
            avatarUrl: null,
            displayName: "Flow Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000054",
          },
        },
        requestId: "req-flow-e2e",
      },
      status: 200,
    }),
  );
  await page.route("**/api/address-remarks", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: { remarks: [], shared: [] },
        requestId: "req-flow-remarks-e2e",
        success: true,
      },
      status: 200,
    }),
  );
}

test("POOL-03 and FLOW-01/02 expose canonical, serializable filters", async ({ page }) => {
  await useSession(page);
  await page.goto("/pools?fixture=pools-ready");

  const dex = page.getByRole("group", { name: "DEX 过滤" });
  await expect(dex).toBeVisible();
  for (const name of ["PancakeSwap V3", "Uniswap V3", "PancakeSwap V4", "Uniswap V4"]) {
    await expect(dex.getByRole("checkbox", { name })).toBeChecked();
  }
  await dex.getByRole("checkbox", { name: "Uniswap V3" }).uncheck();
  await dex.getByRole("checkbox", { name: "PancakeSwap V4" }).uncheck();
  await expect(page).toHaveURL(/dex=pcsv3%2Cuniv4/u);

  const panel = page.getByRole("region", { name: "流动性事件" });
  await expect(panel).toBeVisible();
  await panel.getByRole("radio", { name: "撤池" }).click();
  await panel.getByRole("radio", { name: "V4" }).click();
  await panel.getByLabel("最低 USD").fill("50");
  await expect(panel.getByRole("row", { name: /Uniswap V4.*撤池.*125\.5/u })).toBeVisible();
  await expect(panel.getByRole("row", { name: /PancakeSwap V4.*撤池/u })).toHaveCount(0);

  await panel.getByLabel("Token").fill("0x2222222222222222222222222222222222222222");
  await panel.getByLabel("Pool").fill("0x1111111111111111111111111111111111111111");
  await panel.getByLabel("User").fill("0x4444444444444444444444444444444444444444");
  await panel.getByLabel("NFT").fill("42");
  await expect(page).toHaveURL(/flow_event=remove/u);
  await expect(page).toHaveURL(/flow_version=v4/u);
  await expect(page).toHaveURL(/nft_id=42/u);

  await panel.getByRole("button", { name: "清除流动性筛选" }).click();
  await expect(panel.getByLabel("最低 USD")).toHaveValue("");
  await expect(page).not.toHaveURL(/flow_event=/u);
});

test("flow pause/resume is keyboard operable and stateful", async ({ page }) => {
  await useSession(page);
  await page.goto("/pools?fixture=pools-ready");
  const panel = page.getByRole("region", { name: "流动性事件" });
  const pause = panel.getByRole("button", { name: "暂停流动性事件" });
  await pause.focus();
  await page.keyboard.press("Space");
  await expect(panel).toHaveAttribute("data-flow-state", "paused-hidden");
  await expect(panel.getByRole("button", { name: "恢复流动性事件" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-flow-state", "live");
});

for (const state of [
  "loading-backfill",
  "live",
  "paused-hidden",
  "empty",
  "error",
  "stale",
  "reconnecting",
] as const) {
  test(`flow exposes ${state} without synthesized values`, async ({ page }) => {
    await useSession(page);
    await page.goto(`/pools?fixture=pools-ready&flow_state=${state}`);
    const panel = page.getByRole("region", { name: "流动性事件" });
    await expect(panel).toHaveAttribute("data-flow-state", state);
    if (state === "loading-backfill") await expect(panel).toHaveAttribute("aria-busy", "true");
    if (state === "error") await expect(panel.getByRole("alert")).toBeVisible();
    if (state === "empty") await expect(panel.getByText("$0", { exact: true })).toHaveCount(0);
  });
}

test("flow is axe-clean and visually stable on desktop and mobile", async ({ page }, testInfo) => {
  await useSession(page);
  await page.goto("/pools?fixture=pools-ready");
  await expect(page.getByRole("region", { name: "流动性事件" })).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  await expect(page).toHaveScreenshot("liquidity-flow-ready.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixels: 80,
  });
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-05/ui/liquidity-flow-${testInfo.project.name}.png`,
  });
});
