import type { ErrorEnvelope, SessionView } from "../packages/api-contract/src/index.js";
import { AuthClient, canEnterRoute, type AuthFetch } from "../apps/web/src/auth-client.js";
import type { LoginWalletProviderAdapter } from "../apps/web/src/eip1193-wallet.js";
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

  it.each([
    ["ACCOUNT_PENDING", "pending", "Account approval is pending."],
    ["ACCOUNT_REJECTED", "rejected", "This account request was not approved."],
    ["ACCOUNT_BANNED", "banned", "This account is currently unavailable."],
  ] as const)(
    "preserves the server-authoritative %s state after Bot consumption",
    async (code, reason, message) => {
      const token = "F".repeat(43);
      const channel = {
        addEventListener: vi.fn(),
        close: vi.fn(),
        postMessage: vi.fn(),
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
            requestId: "req-create-blocked",
          }),
        )
        .mockResolvedValueOnce(errorResponse(403, code));
      const client = new AuthClient(fetcher, {
        broadcastChannel: channel,
        now: () => new Date("2026-08-14T03:00:00.000Z").getTime(),
      });

      await expect(client.startTelegramBotLogin()).resolves.toEqual({ status: "consumed" });

      expect(client.state).toEqual({
        status: "blocked",
        reason,
        message,
      });
      expect(JSON.stringify(client.state)).not.toContain(`Safe ${code} message`);
      expect(channel.postMessage).toHaveBeenCalledWith({ type: "auth-complete" });
      expect(JSON.stringify(channel.postMessage.mock.calls)).not.toContain(token);
      client.dispose();
    },
  );

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

  it("supports explicit cancellation and retry after a polling request failure", async () => {
    vi.useFakeTimers();
    const firstToken = "D".repeat(43);
    const secondToken = "E".repeat(43);
    const createEnvelope = (token: string, requestId: string) =>
      apiResponse(200, {
        success: true,
        data: {
          expiresAt: "2026-08-14T03:03:00.000Z",
          loginUrl: `https://t.me/local_fixture_bot?start=${token}`,
          token,
        },
        requestId,
      });
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(createEnvelope(firstToken, "req-create-cancel"))
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { confirmed: false, session: null, status: "pending" },
          requestId: "req-pending-cancel",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { status: "cancelled" },
          requestId: "req-cancel",
        }),
      )
      .mockResolvedValueOnce(createEnvelope(secondToken, "req-create-retry"))
      .mockRejectedValueOnce(new TypeError("fixture network down"))
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { confirmed: true, session, status: "consumed" },
          requestId: "req-recovered",
        }),
      );
    const client = new AuthClient(fetcher, {
      broadcastChannel: null,
      now: () => new Date("2026-08-14T03:00:00.000Z").getTime(),
      pollInitialDelayMs: 100,
    });

    await client.startTelegramBotLogin();
    const firstSignal = fetcher.mock.calls[1]?.[1]?.signal as AbortSignal;
    await expect(client.cancelTelegramBotLogin()).resolves.toEqual({ status: "cancelled" });
    expect(firstSignal.aborted).toBe(true);
    expect(fetcher.mock.calls[2]?.[0]).toBe(`/api/auth/login-token/${firstToken}/cancel`);
    expect(client.state).toEqual({ status: "anonymous" });

    await expect(client.startTelegramBotLogin()).resolves.toMatchObject({
      status: "error",
      retryable: true,
    });
    const failedSignal = fetcher.mock.calls[4]?.[1]?.signal as AbortSignal;
    expect(failedSignal.aborted).toBe(false);
    await expect(client.retryTelegramBotLogin()).resolves.toEqual({ status: "consumed" });
    expect(failedSignal.aborted).toBe(true);
    expect(fetcher.mock.calls[5]?.[0]).toBe(`/api/auth/login-status/${secondToken}`);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(client.state).toEqual({ status: "active", session });

    client.dispose();
    vi.useRealTimers();
  });

  it("restores from a credential-free BroadcastChannel event and rejects enriched messages", async () => {
    let onMessage: ((event: { data: unknown }) => void) | undefined;
    const channel = {
      addEventListener: vi.fn((_type: "message", listener: (event: { data: unknown }) => void) => {
        onMessage = listener;
      }),
      close: vi.fn(),
      postMessage: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const fetcher = vi.fn<AuthFetch>().mockResolvedValue(
      apiResponse(200, {
        success: true,
        data: { isAdmin: false, maintenance: null, user: session },
        requestId: "req-cross-tab",
      }),
    );
    const client = new AuthClient(fetcher, { broadcastChannel: channel });
    const subscriber = vi.fn();
    const unsubscribe = client.subscribe(subscriber);

    onMessage?.({ data: { token: "must-not-cross-tabs", type: "auth-complete" } });
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();

    onMessage?.({ data: { type: "auth-complete" } });
    await vi.waitFor(() => expect(client.state).toEqual({ status: "active", session }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(
      { status: "active", session },
      { kind: "ready" },
      { status: "idle" },
    );

    unsubscribe();
    client.dispose();
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

  it("surfaces Mini App request failures and recovers on a later attempt", async () => {
    const initData = "query_id=fixture&auth_date=1&hash=fixture&user=fixture";
    const fetcher = vi
      .fn<AuthFetch>()
      .mockRejectedValueOnce(new TypeError("fixture network down"))
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { isAdmin: false, maintenance: null, user: session },
          requestId: "req-mini-app-recovered",
        }),
      );
    const client = new AuthClient(fetcher, { broadcastChannel: null });
    const adapter = { getInitData: () => initData };

    await expect(client.loginWithTelegramMiniApp(adapter)).resolves.toEqual({
      status: "anonymous",
    });
    expect(client.page).toEqual({
      kind: "error",
      code: "NETWORK_ERROR",
      message: "Telegram Mini App authentication failed",
      retryable: true,
    });

    await expect(client.loginWithTelegramMiniApp(adapter)).resolves.toEqual({
      status: "active",
      session,
    });
  });

  it("surfaces a safe verifier error for rejected Mini App initData", async () => {
    const client = new AuthClient(
      vi.fn<AuthFetch>().mockResolvedValue(errorResponse(401, "AUTH_INVALID")),
      { broadcastChannel: null },
    );

    await expect(
      client.loginWithTelegramMiniApp({ getInitData: () => "invalid-init-data" }),
    ).resolves.toEqual({ status: "anonymous" });
    expect(client.page).toEqual({
      kind: "error",
      code: "AUTH_INVALID",
      message: "Safe AUTH_INVALID message",
      retryable: false,
    });
  });

  it("completes wallet nonce, personal-sign and cookie-session login without storage", async () => {
    const address = "0x0000000000000000000000000000000000000001" as const;
    const message = "canonical local SIWE challenge";
    const nonceId = "N".repeat(43);
    const signature = `0x${"ab".repeat(65)}` as const;
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: {
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            message,
            nonceId,
          },
          requestId: "req-wallet-nonce",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: { session },
          requestId: "req-wallet-login",
        }),
      );
    const adapter: LoginWalletProviderAdapter = {
      connect: vi.fn().mockResolvedValue({ address, chainId: 56 }),
      signMessage: vi.fn().mockResolvedValue(signature),
    };
    const localStorage = { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() };
    Object.defineProperties(globalThis, {
      localStorage: { configurable: true, value: localStorage },
      sessionStorage: { configurable: true, value: sessionStorage },
    });
    const client = new AuthClient(fetcher, { broadcastChannel: null });

    const login = client.loginWithWallet(adapter);
    expect(client.state).toEqual({ status: "authenticating", method: "wallet" });
    await expect(login).resolves.toEqual({ status: "active", session });

    expect(fetcher.mock.calls[0]).toEqual([
      "/api/auth/wallet/nonce",
      expect.objectContaining({
        body: JSON.stringify({ address, chainId: 56 }),
        credentials: "include",
        method: "POST",
      }),
    ]);
    expect(adapter.signMessage).toHaveBeenCalledWith({ address, chainId: 56, message });
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/auth/wallet/login",
      expect.objectContaining({
        body: JSON.stringify({ address, chainId: 56, nonceId, signature }),
        credentials: "include",
        method: "POST",
      }),
    ]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it("lists, links and deletes login wallets through typed settings operations", async () => {
    const address = "0x0000000000000000000000000000000000000001" as const;
    const message = "canonical link SIWE challenge";
    const nonceId = "L".repeat(43);
    const signature = `0x${"cd".repeat(65)}` as const;
    const link = {
      addressMasked: "0x0000...0001",
      createdAt: "2026-08-14T08:00:00.000Z",
      label: "Primary",
      linkId: "00000000-0000-4000-8000-000000000081",
      updatedAt: "2026-08-14T08:00:00.000Z",
    };
    const fetcher = vi
      .fn<AuthFetch>()
      .mockResolvedValueOnce(
        apiResponse(200, { success: true, data: { links: [link] }, requestId: "req-list" }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, {
          success: true,
          data: {
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            message,
            nonceId,
          },
          requestId: "req-link-nonce",
        }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, { success: true, data: { link }, requestId: "req-link" }),
      )
      .mockResolvedValueOnce(
        apiResponse(200, { success: true, data: { deleted: true }, requestId: "req-delete" }),
      );
    const adapter: LoginWalletProviderAdapter = {
      connect: vi.fn().mockResolvedValue({ address, chainId: 56 }),
      signMessage: vi.fn().mockResolvedValue(signature),
    };
    const client = new AuthClient(fetcher, { broadcastChannel: null });

    await expect(client.getLoginWalletLinks()).resolves.toEqual([link]);
    await expect(client.linkLoginWallet(adapter, "Primary")).resolves.toEqual(link);
    await expect(client.unlinkLoginWallet(link.linkId)).resolves.toBe(true);

    expect(adapter.signMessage).toHaveBeenCalledWith({ address, chainId: 56, message });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/wallet/links",
      "/api/auth/wallet/link-nonce",
      "/api/auth/wallet/link",
      `/api/auth/wallet/link/${link.linkId}`,
    ]);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      body: JSON.stringify({ address, chainId: 56, label: "Primary", nonceId, signature }),
      method: "POST",
    });
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: "DELETE" });
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
      message: "You do not have permission to complete this request.",
    });
    expect(JSON.stringify(client.page)).not.toContain("Safe FORBIDDEN message");
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
