import type { ErrorEnvelope, SessionView } from "../packages/api-contract/src/index.js";
import { AuthClient, canEnterRoute, type AuthFetch } from "../apps/web/src/auth-client.js";
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
  it("polls Bot login with abortable backoff and broadcasts only session availability", async () => {
    vi.useFakeTimers();
    const token = "B".repeat(43);
    const messages: unknown[] = [];
    const channel = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      postMessage: vi.fn((message: unknown) => messages.push(message)),
      removeEventListener: vi.fn(),
    };
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: {
            expiresAt: "2026-08-14T03:03:00.000Z",
            loginUrl: `https://t.me/local_fixture_bot?start=${token}`,
            token,
          },
          requestId: "req-create",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { confirmed: false, session: null, status: "pending" },
          requestId: "req-pending",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { confirmed: true, session, status: "consumed" },
          requestId: "req-consumed",
        }),
      );
    const storage = { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() };
    Object.defineProperties(globalThis, {
      localStorage: { configurable: true, value: storage },
      sessionStorage: { configurable: true, value: storage },
    });
    const client = new AuthClient(fetcher, {
      broadcastChannel: channel,
      now: () => new Date("2026-08-14T03:00:00.000Z").getTime(),
      pollInitialDelayMs: 100,
    });

    await expect(client.startTelegramBotLogin()).resolves.toMatchObject({
      expiresAt: "2026-08-14T03:03:00.000Z",
      loginUrl: expect.stringContaining("https://t.me/local_fixture_bot"),
      status: "pending",
    });
    expect(client.state).toEqual({ status: "authenticating", method: "telegram-bot-link" });
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(99);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    expect(client.state).toEqual({ status: "active", session });
    expect(messages).toEqual([{ type: "auth-complete" }]);
    expect(JSON.stringify(messages)).not.toContain(token);
    expect(JSON.stringify(messages)).not.toContain(session.userId);
    expect(storage.setItem).not.toHaveBeenCalled();
    client.dispose();
    expect(channel.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancels the server intent when finite Bot polling times out", async () => {
    vi.useFakeTimers();
    const token = "C".repeat(43);
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: {
            expiresAt: "2026-08-14T03:03:00.000Z",
            loginUrl: `https://t.me/local_fixture_bot?start=${token}`,
            token,
          },
          requestId: "req-create-timeout",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { confirmed: false, session: null, status: "pending" },
          requestId: "req-pending-timeout",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { status: "cancelled" },
          requestId: "req-cancel-timeout",
        }),
      );
    const client = new AuthClient(fetcher, {
      broadcastChannel: null,
      maxPollAttempts: 1,
      now: () => new Date("2026-08-14T03:00:00.000Z").getTime(),
      pollInitialDelayMs: 100,
    });

    await client.startTelegramBotLogin();
    const pollingSignal = fetcher.mock.calls[1]?.[1]?.signal as AbortSignal;
    expect(pollingSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);

    expect(pollingSignal.aborted).toBe(true);
    expect(fetcher.mock.calls[2]?.[0]).toBe(`/api/auth/login-token/${token}/cancel`);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: "POST" });
    expect(client.botLogin).toEqual({ status: "expired" });
    expect(client.state).toEqual({ status: "anonymous" });
    client.dispose();
    vi.useRealTimers();
  });

  it("authenticates from the Mini App adapter without persisting initData", async () => {
    const initData = "query_id=fixture&auth_date=1&hash=fixture&user=fixture";
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<AuthFetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const adapter = { getInitData: vi.fn(() => initData) };
    const localStorage = { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() };
    Object.defineProperties(globalThis, {
      localStorage: { configurable: true, value: localStorage },
      sessionStorage: { configurable: true, value: sessionStorage },
    });
    const client = new AuthClient(fetcher);

    const login = client.loginWithTelegramMiniApp(adapter);
    expect(client.state).toEqual({ status: "authenticating", method: "telegram-mini-app" });
    expect(adapter.getInitData).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        body: JSON.stringify({ initData }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    resolveRequest?.(
      apiResponse(200, {
        success: true,
        data: { isAdmin: false, maintenance: null, user: session },
        requestId: "req-mini-app",
      }),
    );
    await expect(login).resolves.toEqual({ status: "active", session });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

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

  it("coalesces concurrent restore calls into one session request", async () => {
    const fetcher = vi.fn<AuthFetch>().mockResolvedValue(
      apiResponse(200, {
        success: true,
        data: { isAdmin: false, maintenance: null, user: session },
        requestId: "req-client-1",
      }),
    );
    const client = new AuthClient(fetcher);

    const [first, second] = await Promise.all([client.restore(), client.restore()]);

    expect(first).toEqual({ status: "active", session });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
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
    const client = new AuthClient(
      vi.fn<AuthFetch>().mockResolvedValue(errorResponse(status, code)),
    );
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

  it("logs out and clears both SessionView and the in-memory bearer", async () => {
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { isAdmin: false, maintenance: null, user: session },
          requestId: null,
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { loggedOut: true, revoked: true },
          requestId: null,
        }),
      )
      .mockResolvedValueOnce(errorResponse(401, "UNAUTHENTICATED"));
    const client = new AuthClient(fetcher);
    await client.restore();
    client.setBearerToken("memory-only-token");

    await expect(client.logout()).resolves.toEqual({ status: "anonymous" });
    await client.restore();

    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/auth/logout");
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      credentials: "include",
      headers: { authorization: "Bearer memory-only-token" },
      method: "POST",
    });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ headers: {} });
    expect(client.session).toBeNull();
    expect(client.state).toEqual({ status: "anonymous" });
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
