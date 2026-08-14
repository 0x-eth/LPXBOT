/// <reference lib="webworker" />

import { cacheNames, clientsClaim, setCacheNameDetails } from "workbox-core";
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";

import { isOfflineShellNavigation, isPwaNetworkOnlyRequest } from "./pwa-policy.js";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

const cacheVersion = "p01-05-v1";
setCacheNameDetails({ prefix: "lpbot", suffix: cacheVersion });

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

const networkOnly = new NetworkOnly();
const scopeOrigin = self.location.origin;

for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const) {
  registerRoute(
    ({ request }) => isPwaNetworkOnlyRequest(request, scopeOrigin),
    networkOnly,
    method,
  );
}

registerRoute(({ request }) => isOfflineShellNavigation(request, scopeOrigin), networkOnly, "GET");

setCatchHandler(async ({ request }) => {
  if (isOfflineShellNavigation(request, scopeOrigin)) {
    const shell = await matchPrecache("/index.html");
    if (shell) return shell;
  }
  return Response.error();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith("lpbot-") && key !== cacheNames.precache)
          .map((key) => caches.delete(key)),
      );
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
