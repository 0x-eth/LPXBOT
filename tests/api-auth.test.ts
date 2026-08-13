import type {
  AccessAuditEvent,
  NewStoredSession,
  SessionStore,
  StoredSession,
} from "../packages/security/src/index.js";
import { SessionIssuer } from "../packages/security/src/index.js";
import { buildApiApp } from "../apps/api/src/app.js";
import { afterEach, describe, expect, it } from "vitest";

class MemorySessionStore implements SessionStore {
  readonly audits: AccessAuditEvent[] = [];
  readonly sessions = new Map<string, StoredSession>();

  async createSession(session: NewStoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, {
      ...session,
      account: {
        allowedChainIds: [1, 56],
        avatarUrl: null,
        displayName: "Local User",
        id: session.userId,
        role: "user",
        status: "active",
        tier: "normal",
      },
      lastSeenAt: null,
      revokedAt: null,
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async recordAccessAudit(event: AccessAuditEvent): Promise<void> {
    this.audits.push(event);
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt) return false;
    session.revokedAt = revokedAt;
    return true;
  }

  async touchSession(tokenHash: string, lastSeenAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.lastSeenAt = lastSeenAt;
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("P01-02 Fastify auth API", () => {
  it("restores an active browser session while persisting only its hash", async () => {
    const store = new MemorySessionStore();
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issuer = new SessionIssuer(store, { now: () => now });
    const issued = await issuer.issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: "00000000-0000-4000-8000-000000000001",
    });
    const logLines: string[] = [];
    const app = buildApiApp({
      logger: { write: (line) => logLines.push(line) },
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { cookie: `lpbot_session=${issued.token}` },
      method: "POST",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        isAdmin: false,
        maintenance: null,
        user: {
          allowedChainIds: [1, 56],
          avatarUrl: null,
          displayName: "Local User",
          maintenanceBypass: false,
          role: "user",
          tier: "normal",
          userId: "00000000-0000-4000-8000-000000000001",
        },
      },
      requestId: expect.any(String),
    });
    expect([...store.sessions.keys()]).toHaveLength(1);
    expect([...store.sessions.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify([...store.sessions.values()])).not.toContain(issued.token);
    expect(logLines.join("\n")).not.toContain(issued.token);
    expect(logLines.join("\n")).not.toContain("lpbot_session");
    expect(logLines.join("\n")).not.toContain("Local User");
  });
});
