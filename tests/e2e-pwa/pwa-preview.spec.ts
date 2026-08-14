import { expect, test } from "@playwright/test";

test("SHELL-06 build preview exposes the local manifest and active service worker", async ({
  page,
  request,
}) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({
    background_color: "#ffffff",
    display: "standalone",
    name: "LP Bot",
    short_name: "LP Bot",
    start_url: "/",
    theme_color: "#171717",
  });
  expect(manifest.icons).toEqual([
    { sizes: "192x192", src: "/pwa-192x192.png", type: "image/png" },
    { sizes: "512x512", src: "/pwa-512x512.png", type: "image/png" },
    {
      purpose: "maskable",
      sizes: "512x512",
      src: "/pwa-maskable-512x512.png",
      type: "image/png",
    },
  ]);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          requestId: "req-pwa-preview",
          retryable: false,
        },
      },
      status: 401,
    }),
  );
  await page.goto("/");
  const scriptUrl = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? "";
  });
  expect(scriptUrl).toMatch(/\/sw\.js$/u);
});

test("SHELL-06 offline navigation falls back to a safe unauthenticated shell", async ({
  context,
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          requestId: "req-pwa-install",
          retryable: false,
        },
      },
      status: 401,
    }),
  );
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.unroute("**/api/auth/me");

  await context.setOffline(true);
  await page.goto("/pools");

  await expect(
    page.getByRole("heading", { level: 1, name: "Connection unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("The application could not reach the service.");
  await expect(page.getByRole("heading", { level: 1, name: "Pools" })).toHaveCount(0);
  await expect(page.getByText(/signed in|session restored/iu)).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("SHELL-06 activation removes obsolete LP Bot caches", async ({ page }) => {
  await page.goto("/manifest.webmanifest");
  await page.evaluate(async () => {
    const cache = await caches.open("lpbot-navigation-obsolete");
    await cache.put("/stale-shell", new Response("stale local shell"));
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          requestId: "req-pwa-cache-cleanup",
          retryable: false,
        },
      },
      status: 401,
    }),
  );

  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);

  await expect
    .poll(() =>
      page.evaluate(async () => (await caches.keys()).includes("lpbot-navigation-obsolete")),
    )
    .toBe(false);
});

test("SHELL-06 never stores API, auth, SSE, writes or runtime navigation responses", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: {
        success: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication is required",
          requestId: "req-pwa-network-only",
          retryable: false,
        },
      },
      status: 401,
    }),
  );
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  const paths: [string, string, string, string] = [
    "/api/cache-fixture",
    "/authorization-cache-fixture",
    "/sse-cache-fixture",
    "/write-cache-fixture",
  ];
  const cached = await page.evaluate(async ([api, authorization, sse, write]) => {
    await Promise.allSettled([
      fetch(api),
      fetch(authorization, { headers: { Authorization: "Bearer LOCAL_FIXTURE" } }),
      fetch(sse, { headers: { Accept: "text/event-stream" } }),
      fetch(write, { method: "POST" }),
    ]);
    const cacheNames = await caches.keys();
    return Promise.all(
      [api, authorization, sse, write].map(async (path) => {
        for (const cacheName of cacheNames) {
          if (await (await caches.open(cacheName)).match(path)) return true;
        }
        return false;
      }),
    );
  }, paths);
  expect(cached).toEqual([false, false, false, false]);

  await page.goto("/runtime-navigation-fixture");
  const runtimeNavigationCached = await page.evaluate(async () => {
    for (const cacheName of await caches.keys()) {
      if (await (await caches.open(cacheName)).match("/runtime-navigation-fixture")) return true;
    }
    return false;
  });
  expect(runtimeNavigationCached).toBe(false);
});
