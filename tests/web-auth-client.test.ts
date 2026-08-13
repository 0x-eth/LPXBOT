import type { ErrorEnvelope, SessionView } from "../packages/api-contract/src/index.js";
import {
  AuthClient,
  canEnterRoute,
  type AuthFetch,
} from "../apps/web/src/auth-client.js";
import { describe, expect, it, vi } from "vitest";

const session: SessionView = {
  allowedChainIds: [1, 56],
  avatarUrl: null,
  displayName: "Local User",
  maintenanceBypass: false,
  role: "user",
  tier: "normal",
  userId: "00000000-0000-4000-8000-000000000001",
};

function apiResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function errorResponse(status: number, code: string): Response {
  const envelope: ErrorEnvelope = {
    success: false,
    error: {
      code,
      message: `Safe ${code} message`,
      requestId: "req-client-1",
      retryable: status === 503,
    },
  };
  return apiResponse(status, envelope);
}

describe("P01-02 web auth client", () => {
  it("starts booting and restores an active SessionView", async () => {
    const fetcher = vi.fn<AuthFetch>().mockResolvedValue(
      apiResponse(200, {
        success: true,
        data: { isAdmin: false, maintenance: null, user: session },
        requestId: "req-client-1",
      }),
    );
    const client = new AuthClient(fetcher);

    expect(client.state).toEqual({ status: "booting" });
    await expect(client.restore()).resolves.toEqual({ status: "active", session });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
  });

  it("clears SessionView and enters anonymous on 401", async () => {
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { isAdmin: false, maintenance: null, user: session },
          requestId: null,
        }),
      )
      .mockResolvedValueOnce(errorResponse(401, "AUTH_EXPIRED"));
    const client = new AuthClient(fetcher);

    await client.restore();
    expect(client.session).toEqual(session);
    await expect(client.restore()).resolves.toEqual({ status: "anonymous" });
    expect(client.session).toBeNull();
  });

  it.each([
    [403, "ACCOUNT_PENDING", { status: "blocked", reason: "pending" }],
    [403, "ACCOUNT_REJECTED", { status: "blocked", reason: "rejected" }],
    [403, "ACCOUNT_BANNED", { status: "blocked", reason: "banned" }],
    [403, "REGION_BLOCKED", { status: "region-blocked" }],
    [503, "MAINTENANCE", { status: "maintenance" }],
  ] as const)("maps %i %s to a stable auth state", async (status, code, expected) => {
    const client = new AuthClient(vi.fn<AuthFetch>().mockResolvedValue(errorResponse(status, code)));
    await expect(client.restore()).resolves.toMatchObject(expected);
  });

  it("keeps generic 403 as a forbidden page state", async () => {
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { isAdmin: false, maintenance: null, user: session },
          requestId: null,
        }),
      )
      .mockResolvedValueOnce(errorResponse(403, "FORBIDDEN"));
    const client = new AuthClient(fetcher);
    await client.restore();

    await client.request("/api/protected");

    expect(client.state).toEqual({ status: "active", session });
    expect(client.page).toEqual({
      kind: "forbidden",
      code: "FORBIDDEN",
      message: "Safe FORBIDDEN message",
    });
  });

  it("keeps bearer compatibility in memory and never writes localStorage", async () => {
    const fetcher = vi.fn<AuthFetch>().mockResolvedValue(errorResponse(401, "AUTH_EXPIRED"));
    const client = new AuthClient(fetcher);
    const storage = {
      getItem: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });

    client.setBearerToken("memory-only-token");
    await client.restore();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        headers: { authorization: "Bearer memory-only-token" },
      }),
    );
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("guards protected and admin routes on the client without replacing server checks", () => {
    expect(canEnterRoute("/tasks/running", { status: "anonymous" })).toBe(false);
    expect(canEnterRoute("/tasks/running", { status: "active", session })).toBe(true);
    expect(canEnterRoute("/users", { status: "active", session })).toBe(false);
    expect(
      canEnterRoute("/users", {
        status: "active",
        session: { ...session, role: "admin" },
      }),
    ).toBe(true);
  });
});
