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
