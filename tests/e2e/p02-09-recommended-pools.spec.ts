import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

declare global {
  var __p0209StatsRequests: Array<{ lastEventId: string | null; url: string }>;
}

async function installShellFixture(page: Page): Promise<void> {
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
            displayName: "P02-09 Fixture",
            maintenanceBypass: false,
            role: "user",
            tier: "normal",
            userId: "00000000-0000-4000-8000-000000000059",
          },
        },
        requestId: "req-p02-09-auth",
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
        requestId: "req-p02-09-preferences",
        success: true,
      },
    }),
  );
  await page.route("**/api/auth/wallet/links", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { data: { links: [] }, requestId: "req-p02-09-wallets", success: true },
    }),
  );
}

async function installStatsFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const browser = globalThis as typeof globalThis & {
      __p0209StatsRequests: Array<{ lastEventId: string | null; url: string }>;
    };
    browser.__p0209StatsRequests = [];
    const nativeFetch = globalThis.fetch.bind(globalThis);
    let servedInitialSnapshot = false;
    globalThis.fetch = (input, init) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.href);
      if (url.pathname !== "/api/stats/stream") return nativeFetch(input, init);
      const headers = new Headers(init?.headers);
      browser.__p0209StatsRequests.push({
        lastEventId: headers.get("Last-Event-ID"),
        url: `${url.pathname}${url.search}`,
      });
      const mode = new URL(window.location.href).searchParams.get("rec_state") ?? "ready";
      if (mode === "unavailable") {
        return Promise.resolve(
          new Response("{}", { headers: { "Content-Type": "application/json" }, status: 503 }),
        );
      }
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (mode === "loading" || servedInitialSnapshot) return;
          window.setTimeout(() => {
            if (cancelled || init?.signal?.aborted || servedInitialSnapshot) return;
            servedInitialSnapshot = true;
            const encoder = new TextEncoder();
            const base64url = (value: string) =>
              btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
            const windowEnd = new Date(Date.now() - 5 * 60_000).toISOString();
            const observedAt = new Date(Date.now() - (mode === "stale" ? 31_000 : 0)).toISOString();
            const pool = (digit: string, feesUsd: string, token0Symbol: string | null) => ({
              chainId: 56,
              feePips: "500",
              feesUsd,
              poolAddress: `0x${digit.repeat(40)}`,
              poolId: null,
              poolKey: `56:0x${digit.repeat(40)}`,
              protocol: "pcsv3",
              token0Address: `0x${digit === "1" ? "a".repeat(40) : digit.repeat(40)}`,
              token0Symbol,
              token1Address: `0x${"b".repeat(40)}`,
              token1Symbol: "USDT",
            });
            const initialPools =
              mode === "empty"
                ? []
                : [
                    pool("1", "12.5000", "WBNB"),
                    pool("2", "11.25", null),
                    pool("3", "10", "USDC"),
                    pool("4", "9", "FOURTH"),
                  ];
            const event = (version: string, hashDigit: string, pools: unknown[]) => {
              const selectionHash = `sha256:${hashDigit.repeat(64)}`;
              const cursor = `rec-pools:v1:bsc:3:${base64url(version)}:${base64url(windowEnd)}:${selectionHash.slice(7)}`;
              const payload = {
                cursor,
                observedAt,
                pools,
                selectionHash,
                sourceVersion: version,
                sourceWindow: 5,
                sourceWindowEnd: windowEnd,
                type: "rec_pools_snapshot",
              };
              return `id: ${cursor}\nevent: rec_pools_snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
            };
            controller.enqueue(encoder.encode(event("7", "a", initialPools)));
            controller.enqueue(
              encoder.encode(
                `event: snapshot\ndata: ${JSON.stringify({
                  observedAt,
                  sequence: 20,
                  stats: {
                    fps: null,
                    gas: { baseGwei: null, ethereumGwei: null },
                    online: null,
                    pingMs: null,
                    taskCounts: { paused: null, running: null, stopped: null },
                  },
                  type: "snapshot",
                })}\n\n`,
              ),
            );
            if (mode === "reconnecting" || mode === "stale") {
              controller.close();
              return;
            }
            if (mode === "ready") {
              window.setTimeout(() => {
                if (cancelled) return;
                controller.enqueue(
                  encoder.encode(
                    event("8", "b", [
                      pool("1", "99", "WBNB"),
                      pool("3", "10", "USDC"),
                      pool("2", "8", null),
                    ]),
                  ),
                );
              }, 1_500);
            }
          }, 0);
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

test("STATS-02 renders and navigates recommended pools without layout shifts", async ({
  page,
}, testInfo) => {
  await installStatsFixture(page);
  await installShellFixture(page);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/tasks") && request.method() !== "GET") {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto("/tasks/running");

  const bar = page.getByRole("contentinfo", { name: "实时状态" });
  await expect(bar).toBeVisible();
  await expect(bar.locator(".status-pool-link")).toHaveCount(3);
  await expect(bar).toContainText("WBNB / USDT");
  await expect(bar).toContainText("0x2222...2222 / USDT");
  await expect(bar).toContainText("5m Fees $12.50");
  const initialHeight = await bar.evaluate((element) => element.getBoundingClientRect().height);

  await expect(bar).toContainText("5m Fees $99.00", { timeout: 5_000 });
  expect(await bar.evaluate((element) => element.getBoundingClientRect().height)).toBe(
    initialHeight,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  expect(await bar.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(false);
  expect(await page.evaluate(() => globalThis.__p0209StatsRequests[0]?.url)).toBe(
    "/api/stats/stream?chain=bsc&limit=3",
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
  ).toEqual([]);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: `artifacts/acceptance/P02-09/ui/recommended-pools-${testInfo.project.name}.png`,
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);

  const first = bar.getByRole("link", { name: /查看推荐池 WBNB \/ USDT/u });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    /\/pools\?pool_search_mode=pool&pool_search=0x1111111111111111111111111111111111111111$/u,
  );
  expect(mutations).toEqual([]);
});

test("STATS-02 covers loading, empty, unavailable, reconnecting and stale states", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-desktop", "The state matrix runs once.");
  await installStatsFixture(page);
  await installShellFixture(page);
  const expected = {
    empty: "暂无推荐池",
    loading: "推荐池加载中",
    reconnecting: "推荐池重连中",
    stale: "推荐池数据陈旧",
    unavailable: "推荐池不可用",
  } as const;
  const heights: number[] = [];
  for (const [state, label] of Object.entries(expected)) {
    await page.goto(`/tasks/running?rec_state=${state}`);
    const bar = page.getByRole("contentinfo", { name: "实时状态" });
    await expect(bar.locator(".status-pools-state").first()).toHaveText(label);
    await expect(bar).toHaveAttribute("data-recommendation-state", state);
    heights.push(await bar.evaluate((element) => element.getBoundingClientRect().height));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
  }
  expect(new Set(heights)).toEqual(new Set([32]));
});
