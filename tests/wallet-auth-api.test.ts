import {
  type NewStoredSession,
  type SessionStore,
  SessionIssuer,
  type StoredAccount,
  type StoredSession,
} from "../packages/security/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

class EmptySessionStore implements SessionStore {
  readonly account: StoredAccount = {
    avatarUrl: null,
    displayName: "Wallet User",
    id: "00000000-0000-4000-8000-000000000040",
    role: "user",
    status: "active",
    tier: "normal",
  };
  readonly sessions = new Map<string, StoredSession>();

  async createSession(session: NewStoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, {
      ...session,
      account: this.account,
      lastSeenAt: null,
      revokedAt: null,
    });
  }
  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }
  async recordAccessAudit(): Promise<void> {}
  async revokeSession(): Promise<boolean> {
    return false;
  }
  async touchSession(): Promise<void> {}
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("P01-04 login wallet HTTP API", () => {
  it("returns the server-issued SIWE challenge from POST /api/auth/wallet/nonce", async () => {
    const expiresAt = new Date("2026-08-14T08:05:00.000Z");
    const walletAuth = {
      createLinkChallenge: vi.fn(),
      createLoginChallenge: vi.fn().mockResolvedValue({
        expiresAt,
        message: "canonical-siwe-message",
        nonceId: "A".repeat(43),
      }),
      login: vi.fn(),
      link: vi.fn(),
      listLinks: vi.fn(),
      unlink: vi.fn(),
    };
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new EmptySessionStore(),
      walletAuth,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: { address: "0x0000000000000000000000000000000000000001", chainId: 56 },
      url: "/api/auth/wallet/nonce",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        expiresAt: "2026-08-14T08:05:00.000Z",
        message: "canonical-siwe-message",
        nonceId: "A".repeat(43),
      },
      requestId: expect.any(String),
      success: true,
    });
    expect(walletAuth.createLoginChallenge).toHaveBeenCalledWith({
      address: "0x0000000000000000000000000000000000000001",
      chainId: 56,
      requestId: expect.any(String),
    });
  });

  it("sets an HttpOnly session cookie after wallet login without returning credentials", async () => {
    const token = "session-token-that-must-not-enter-the-response";
    const signature = `0x${"ab".repeat(65)}`;
    const expiresAt = new Date("2026-08-14T09:00:00.000Z");
    const walletAuth = {
      createLinkChallenge: vi.fn(),
      createLoginChallenge: vi.fn(),
      login: vi.fn().mockResolvedValue({
        account: {
          avatarUrl: null,
          displayName: "Wallet User",
          id: "00000000-0000-4000-8000-000000000040",
          role: "user",
          status: "active",
          tier: "normal",
        },
        session: {
          expiresAt,
          sessionId: "00000000-0000-4000-8000-000000000041",
          token,
        },
      }),
      link: vi.fn(),
      listLinks: vi.fn(),
      unlink: vi.fn(),
    };
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new EmptySessionStore(),
      walletAuth,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: {
        address: "0x0000000000000000000000000000000000000001",
        chainId: 56,
        nonceId: "A".repeat(43),
        signature,
      },
      url: "/api/auth/wallet/login",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("lpbot_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.json()).toMatchObject({
      data: {
        session: {
          maintenanceBypass: false,
          role: "user",
          userId: "00000000-0000-4000-8000-000000000040",
        },
      },
      success: true,
    });
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(signature);
  });

  it("binds authenticated wallet-link endpoints to the session user", async () => {
    const now = new Date("2026-08-14T08:00:00.000Z");
    const store = new EmptySessionStore();
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T09:00:00.000Z"),
      userId: store.account.id,
    });
    const link = {
      addressMasked: "0x1234...5678",
      createdAt: now,
      label: "Primary",
      linkId: "00000000-0000-4000-8000-000000000080",
      updatedAt: now,
    };
    const walletAuth = {
      createLinkChallenge: vi.fn().mockResolvedValue({
        expiresAt: new Date("2026-08-14T08:05:00.000Z"),
        message: "link-siwe-message",
        nonceId: "B".repeat(43),
      }),
      createLoginChallenge: vi.fn(),
      link: vi.fn().mockResolvedValue(link),
      listLinks: vi.fn().mockResolvedValue([link]),
      login: vi.fn(),
      unlink: vi.fn().mockResolvedValue({ deleted: true }),
    };
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      walletAuth,
    });
    apps.push(app);
    const headers = { cookie: `lpbot_session=${issued.token}` };

    const listed = await app.inject({ headers, method: "GET", url: "/api/auth/wallet/links" });
    const nonce = await app.inject({
      headers,
      method: "POST",
      payload: { address: "0x1234567890123456789012345678901234565678", chainId: 56 },
      url: "/api/auth/wallet/link-nonce",
    });
    const linked = await app.inject({
      headers,
      method: "POST",
      payload: {
        address: "0x1234567890123456789012345678901234565678",
        chainId: 56,
        label: "Primary",
        nonceId: "B".repeat(43),
        signature: `0x${"ab".repeat(65)}`,
        userId: "attacker-controlled-user-id",
      },
      url: "/api/auth/wallet/link",
    });
    const removed = await app.inject({
      headers,
      method: "DELETE",
      url: `/api/auth/wallet/link/${link.linkId}`,
    });

    expect([listed.statusCode, nonce.statusCode, linked.statusCode, removed.statusCode]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(listed.json().data.links).toEqual([
      { ...link, createdAt: now.toISOString(), updatedAt: now.toISOString() },
    ]);
    expect(walletAuth.createLinkChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ userId: store.account.id }),
    );
    expect(walletAuth.link).toHaveBeenCalledWith(
      expect.objectContaining({ userId: store.account.id }),
    );
    expect(walletAuth.unlink).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: link.linkId, userId: store.account.id }),
    );
  });

  it("rate limits wallet challenge creation with a stable envelope", async () => {
    const walletAuth = {
      createLinkChallenge: vi.fn(),
      createLoginChallenge: vi.fn().mockResolvedValue({
        expiresAt: new Date("2026-08-14T08:05:00.000Z"),
        message: "rate-limited-siwe-message",
        nonceId: "R".repeat(43),
      }),
      link: vi.fn(),
      listLinks: vi.fn(),
      login: vi.fn(),
      unlink: vi.fn(),
    };
    const app = buildApiApp({
      authRateLimits: {
        cancel: 100,
        loginToken: 100,
        miniApp: 100,
        status: 100,
        timeWindowMs: 60_000,
        walletLinks: 100,
        walletLogin: 100,
        walletNonce: 1,
      },
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new EmptySessionStore(),
      walletAuth,
    });
    apps.push(app);
    const request = {
      method: "POST" as const,
      payload: { address: "0x0000000000000000000000000000000000000001", chainId: 56 },
      url: "/api/auth/wallet/nonce",
    };

    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
      success: false,
    });
  });

  it("keeps pending wallet credentials out of JSON responses and logs", async () => {
    const token = "pending-session-token-sensitive";
    const signature = `0x${"ef".repeat(65)}`;
    const nonceId = "P".repeat(43);
    const logLines: string[] = [];
    const walletAuth = {
      createLinkChallenge: vi.fn(),
      createLoginChallenge: vi.fn(),
      link: vi.fn(),
      listLinks: vi.fn(),
      login: vi.fn().mockResolvedValue({
        account: {
          avatarUrl: null,
          displayName: null,
          id: "00000000-0000-4000-8000-000000000090",
          role: "user",
          status: "pending",
          tier: "normal",
        },
        session: {
          expiresAt: new Date("2026-08-14T09:00:00.000Z"),
          sessionId: "00000000-0000-4000-8000-000000000091",
          token,
        },
      }),
      unlink: vi.fn(),
    };
    const app = buildApiApp({
      logger: { write: (line) => logLines.push(line) },
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new EmptySessionStore(),
      walletAuth,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: {
        address: "0x0000000000000000000000000000000000000001",
        chainId: 56,
        nonceId,
        signature,
      },
      url: "/api/auth/wallet/login",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "ACCOUNT_PENDING" },
      success: false,
    });
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    for (const sensitive of [token, signature, nonceId]) {
      expect(response.body).not.toContain(sensitive);
      expect(logLines.join("\n")).not.toContain(sensitive);
    }
  });
});
