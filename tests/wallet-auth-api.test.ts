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
});
