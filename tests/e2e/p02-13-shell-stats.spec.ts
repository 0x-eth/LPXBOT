import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function installApplicationFixture(page: Page): Promise<void> {
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
            displayName: "P02-13 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "27000000-0000-4000-8000-000000000013",
          },
        },
        requestId: "req-p02-13-auth",
        success: true,
      },
    }),
  );
  await page.route("**/api/user/preferences", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
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
            poolColumns: [
              { key: "pool", visible: true },
              { key: "protocol", visible: true },
              { key: "fees", visible: true },
              { key: "volume", visible: true },
              { key: "feeTvl", visible: true },
              { key: "feeActiveTvl", visible: true },
              { key: "tvl", visible: true },
              { key: "txs", visible: true },
              { key: "fdv", visible: true },
              { key: "actions", visible: true },
            ],
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
        },
        requestId: "req-p02-13-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { links: [] }, requestId: "req-p02-13-wallet", success: true },
    }),
  );
  await page.route("**/api/user/pool-blocklist", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        data: {
          blocklistHash: `sha256:${"0".repeat(64)}`,
          entries: [],
          revision: 0,
          schemaVersion: 1,
          updatedAt: null,
        },
        requestId: "req-p02-13-blocklist",
        success: true,
      },
    }),
  );
}

async function installStatsFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.href);
      if (url.pathname !== "/api/stats/stream") return nativeFetch(input, init);
      if (new URL(window.location.href).searchParams.get("stats_state") === "unknown") {
        return Promise.resolve(
          new Response("{}", { headers: { "Content-Type": "application/json" }, status: 503 }),
        );
      }
      let cancelled = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const event = (payload: unknown, type: string, id?: number) =>
            `${id === undefined ? "" : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(
            encoder.encode(
              event(
                {
                  observedAt: new Date().toISOString(),
                  sequence: 10,
                  stats: {
                    fps: null,
                    gas: { baseGwei: null, ethereumGwei: null },
                    online: null,
                    pingMs: null,
                    taskCounts: { paused: 0, running: 0, stopped: 0 },
                  },
                  type: "snapshot",
                },
                "snapshot",
                10,
              ),
            ),
          );
          window.setTimeout(() => {
            if (cancelled || init?.signal?.aborted) return;
            controller.enqueue(
              encoder.encode(
                event(
                  {
                    observedAt: new Date().toISOString(),
                    sequence: 9,
                    stats: { taskCounts: { running: 999 } },
                    type: "update",
                  },
                  "update",
                  9,
                ),
              ),
            );
            controller.enqueue(
              encoder.encode(
                event(
                  {
                    observedAt: new Date().toISOString(),
                    sequence: 11,
                    stats: { taskCounts: { paused: 2, running: 12_345, stopped: 4 } },
                    type: "update",
                  },
                  "update",
                  11,
                ),
              ),
            );
          }, 700);
        },
        cancel() {
          cancelled = true;
        },
      });
      return Promise.resolve(
        new Response(stream, { headers: { "Content-Type": "text/event-stream" }, status: 200 }),
      );
    };
  });
}

test("STATS-01 keeps authoritative zero, updates and unknown state stable", async ({ page }, testInfo) => {
  await installStatsFixture(page);
  await installApplicationFixture(page);
  await page.goto("/tasks/running");

  const bar = page.getByRole("contentinfo", { name: "实时状态" });
  const badge = page.locator(".primary-navigation:visible .nav-badge-slot").first();
  await expect(badge).toHaveText("0");
  if (testInfo.project.name === "chromium-desktop") {
    await expect(bar.locator(".status-primary")).toContainText("运行 0");
    await expect(bar.locator(".status-primary")).toContainText("暂停 0");
    await expect(bar.locator(".status-primary")).toContainText("停止 0");
    await expect(bar.locator(".online-state")).toContainText("不可用");
  }
  const initialBadge = await badge.boundingBox();
  const initialBar = await bar.boundingBox();

  await expect(badge).toHaveText("12.3k");
  expect(await badge.boundingBox()).toEqual(initialBadge);
  expect((await bar.boundingBox())?.height).toBe(initialBar?.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  expect(await bar.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(false);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-13/ui/system-stats-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);

  await page.goto("/tasks/running?stats_state=unknown");
  await expect(page.locator(".primary-navigation:visible .nav-badge-slot").first()).toHaveText("--");
  if (testInfo.project.name === "chromium-desktop") {
    await expect(bar.locator(".status-primary")).toContainText("运行 --");
  }
});
