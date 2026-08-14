import {
  type AccessAuditEvent,
  type NewStoredSession,
  type SessionStore,
  type StoredSession,
} from "../packages/security/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

class EmptySessionStore implements SessionStore {
  async createSession(_session: NewStoredSession): Promise<void> {}
  async findSessionByTokenHash(_tokenHash: string): Promise<StoredSession | null> {
    return null;
  }
  async recordAccessAudit(_event: AccessAuditEvent): Promise<void> {}
  async revokeSession(_tokenHash: string, _revokedAt: Date): Promise<boolean> {
    return false;
  }
  async touchSession(_tokenHash: string, _lastSeenAt: Date): Promise<void> {}
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("P01-04 login wallet HTTP API", () => {
  it("returns the server-issued SIWE challenge from POST /api/auth/wallet/nonce", async () => {
    const expiresAt = new Date("2026-08-14T08:05:00.000Z");
    const walletAuth = {
      createLoginChallenge: vi.fn().mockResolvedValue({
        expiresAt,
        message: "canonical-siwe-message",
        nonceId: "A".repeat(43),
      }),
      login: vi.fn(),
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
      createLoginChallenge: vi.fn(),
      login: vi.fn().mockResolvedValue({
        account: {
          allowedChainIds: [56],
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
});
