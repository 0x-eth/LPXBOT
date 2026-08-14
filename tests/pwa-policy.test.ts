import {
  isOfflineShellNavigation,
  isPwaNetworkOnlyRequest,
  type ServiceWorkerRequest,
} from "../apps/web/src/pwa-policy.js";
import { describe, expect, it } from "vitest";

function request(
  path: string,
  overrides: Partial<ServiceWorkerRequest> = {},
): ServiceWorkerRequest {
  return {
    headers: new Headers(),
    method: "GET",
    mode: "cors",
    url: `https://local.fixture${path}`,
    ...overrides,
  };
}

describe("PWA service worker request policy", () => {
  it("keeps API, authenticated, SSE and write traffic network-only", () => {
    const authorization = new Headers({ Authorization: "Bearer LOCAL_FIXTURE" });
    const eventStream = new Headers({ Accept: "text/event-stream" });

    expect(isPwaNetworkOnlyRequest(request("/api/auth/me"), "https://local.fixture")).toBe(true);
    expect(
      isPwaNetworkOnlyRequest(
        request("/private", { headers: authorization }),
        "https://local.fixture",
      ),
    ).toBe(true);
    expect(
      isPwaNetworkOnlyRequest(
        request("/events", { headers: eventStream }),
        "https://local.fixture",
      ),
    ).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        isPwaNetworkOnlyRequest(request("/anything", { method }), "https://local.fixture"),
      ).toBe(true);
    }
  });

  it("allows only same-origin non-API GET navigations to use the offline shell", () => {
    expect(
      isOfflineShellNavigation(request("/pools", { mode: "navigate" }), "https://local.fixture"),
    ).toBe(true);
    expect(
      isOfflineShellNavigation(
        request("/api/auth/me", { mode: "navigate" }),
        "https://local.fixture",
      ),
    ).toBe(false);
    expect(
      isOfflineShellNavigation(
        request("https://other.fixture/pools", {
          mode: "navigate",
          url: "https://other.fixture/pools",
        }),
        "https://local.fixture",
      ),
    ).toBe(false);
  });
});
