import type {
  AccessAuditEvent,
  NewStoredSession,
  SessionStore,
  StoredAccount,
  StoredSession,
} from "../packages/security/src/index.js";
import { SessionIssuer } from "../packages/security/src/index.js";
import { buildApiApp, setBrowserSessionCookie } from "../apps/api/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";

class MemorySessionStore implements SessionStore {
  readonly audits: AccessAuditEvent[] = [];
  readonly sessions = new Map<string, StoredSession>();
  account: StoredAccount = {
    avatarUrl: null,
    displayName: "Local User",
    id: "00000000-0000-4000-8000-000000000001",
    role: "user",
    status: "active",
    tier: "normal",
  };

  async createSession(session: NewStoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, {
      ...session,
      account: { ...this.account, id: session.userId },
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
  it("sets the browser credential with strict cookie attributes", () => {
    const setCookie = vi.fn();
    const expiresAt = new Date("2026-08-14T03:00:00.000Z");

    setBrowserSessionCookie(
      { setCookie },
      {
        expiresAt,
        sessionId: "00000000-0000-4000-8000-000000000099",
        token: "opaque-session-credential",
      },
    );

    expect(setCookie).toHaveBeenCalledWith("lpbot_session", "opaque-session-credential", {
      expires: expiresAt,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

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
          allowedChainIds: [],
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

  it.each([
    ["missing", undefined],
    ["invalid", "not-a-session"],
  ] as const)("returns a stable 401 envelope for a %s session", async (_, token) => {
    const store = new MemorySessionStore();
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });
    apps.push(app);

    const response = await app.inject({
      headers: token ? { authorization: `Bearer ${token}` } : {},
      method: "POST",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: token ? "AUTH_EXPIRED" : "UNAUTHENTICATED",
        message: expect.any(String),
        requestId: expect.any(String),
        retryable: false,
      },
    });
  });

  it("supports an in-memory Authorization bearer without returning it", async () => {
    const store = new MemorySessionStore();
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { authorization: `Bearer ${issued.token}` },
      method: "POST",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(issued.token);
  });

  it.each([
    ["pending", "ACCOUNT_PENDING"],
    ["rejected", "ACCOUNT_REJECTED"],
    ["banned", "ACCOUNT_BANNED"],
  ] as const)("maps the %s account state to 403 %s", async (status, code) => {
    const store = new MemorySessionStore();
    store.account = { ...store.account, status };
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
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

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({ code, retryable: false });
  });

  it("maps region policy denial to 403 REGION_BLOCKED", async () => {
    const store = new MemorySessionStore();
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: true, code: "ZZ", message: "Region unavailable" }),
      sessionStore: store,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { cookie: `lpbot_session=${issued.token}` },
      method: "POST",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({
      code: "REGION_BLOCKED",
      message: "Region unavailable",
      retryable: false,
    });
  });

  it.each(["user", "pro"] as const)("returns 503 maintenance for %s", async (role) => {
    const store = new MemorySessionStore();
    store.account = { ...store.account, role, tier: role === "pro" ? "pro" : "normal" };
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
      maintenance: {
        enabled: true,
        message: "Scheduled maintenance",
        until: "2026-08-14T05:00:00.000Z",
      },
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

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({ code: "MAINTENANCE", retryable: true });
  });

  it("lets admin bypass maintenance and reports that decision", async () => {
    const store = new MemorySessionStore();
    store.account = { ...store.account, role: "admin" };
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
      maintenance: { enabled: true, message: "Scheduled", until: null },
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
    expect(response.json().data).toMatchObject({
      isAdmin: true,
      maintenance: { enabled: true },
      user: { maintenanceBypass: true, role: "admin" },
    });
  });

  it("expires, logs out and revokes sessions without affecting another user", async () => {
    const store = new MemorySessionStore();
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issuer = new SessionIssuer(store, { now: () => now });
    const first = await issuer.issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: "00000000-0000-4000-8000-000000000001",
    });
    const second = await issuer.issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: "00000000-0000-4000-8000-000000000002",
    });
    const expired = await issuer.issue({
      expiresAt: new Date("2026-08-14T02:30:00.000Z"),
      userId: "00000000-0000-4000-8000-000000000003",
    });
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => new Date("2026-08-14T02:45:00.000Z"),
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });
    apps.push(app);

    const logout = await app.inject({
      headers: { cookie: `lpbot_session=${first.token}` },
      method: "POST",
      url: "/api/auth/logout",
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toMatchObject({ success: true, data: { loggedOut: true } });
    expect(logout.headers["set-cookie"]).toContain("HttpOnly");
    expect(logout.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(logout.headers["set-cookie"]).toContain("Secure");

    for (const token of [first.token, expired.token]) {
      const response = await app.inject({
        headers: { cookie: `lpbot_session=${token}` },
        method: "POST",
        url: "/api/auth/me",
      });
      expect(response.statusCode).toBe(401);
    }
    const isolated = await app.inject({
      headers: { cookie: `lpbot_session=${second.token}` },
      method: "POST",
      url: "/api/auth/me",
    });
    expect(isolated.statusCode).toBe(200);
    expect(isolated.json().data.user.userId).toBe("00000000-0000-4000-8000-000000000002");
  });

  it.each([
    ["user", [200, 403, 403]],
    ["pro", [200, 200, 403]],
    ["admin", [200, 200, 200]],
  ] as const)("enforces test guard routes for %s", async (role, expected) => {
    const store = new MemorySessionStore();
    store.account = { ...store.account, role, tier: role === "pro" ? "pro" : "normal" };
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      testRoutes: true,
    });
    apps.push(app);

    const statuses = await Promise.all(
      ["authenticated", "pro", "admin"].map(async (level) => {
        const response = await app.inject({
          headers: { cookie: `lpbot_session=${issued.token}` },
          method: "GET",
          url: `/__test/guard/${level}`,
        });
        return response.statusCode;
      }),
    );
    expect(statuses).toEqual(expected);
  });

  it("defaults test guards to unauthenticated and omits them from production apps", async () => {
    const store = new MemorySessionStore();
    const testApp = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      testRoutes: true,
    });
    const productionApp = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });
    apps.push(testApp, productionApp);

    const [anonymous, omitted] = await Promise.all([
      testApp.inject({ method: "GET", url: "/__test/guard/authenticated" }),
      productionApp.inject({ method: "GET", url: "/__test/guard/authenticated" }),
    ]);

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("UNAUTHENTICATED");
    expect(omitted.statusCode).toBe(404);
    expect(omitted.json().error.code).toBe("NOT_FOUND");
  });

  it.each([
    ["pending", false, "user", 403, "ACCOUNT_PENDING"],
    ["rejected", false, "pro", 403, "ACCOUNT_REJECTED"],
    ["banned", false, "admin", 403, "ACCOUNT_BANNED"],
    ["active", true, "user", 403, "REGION_BLOCKED"],
    ["active", false, "user", 503, "MAINTENANCE"],
    ["active", false, "admin", 200, null],
  ] as const)(
    "propagates %s/region=%s/%s account policy through guards",
    async (status, regionBlocked, role, expectedStatus, expectedCode) => {
      const store = new MemorySessionStore();
      store.account = { ...store.account, role, status };
      const now = new Date("2026-08-14T02:00:00.000Z");
      const issued = await new SessionIssuer(store, { now: () => now }).issue({
        expiresAt: new Date("2026-08-14T03:00:00.000Z"),
        userId: store.account.id,
      });
      const maintenanceEnabled =
        status === "active" && !regionBlocked && (role === "user" || role === "admin");
      const app = buildApiApp({
        maintenance: {
          enabled: maintenanceEnabled,
          message: "Scheduled maintenance",
          until: null,
        },
        now: () => now,
        regionPolicy: () => ({
          blocked: regionBlocked,
          code: regionBlocked ? "ZZ" : null,
          message: regionBlocked ? "Region unavailable" : null,
        }),
        sessionStore: store,
        testRoutes: true,
      });
      apps.push(app);

      const response = await app.inject({
        headers: { cookie: `lpbot_session=${issued.token}` },
        method: "GET",
        url: "/__test/guard/authenticated",
      });

      expect(response.statusCode).toBe(expectedStatus);
      if (expectedCode) expect(response.json().error.code).toBe(expectedCode);
    },
  );

  it("rejects cross-user fixture resources before the handler returns data", async () => {
    const store = new MemorySessionStore();
    const now = new Date("2026-08-14T02:00:00.000Z");
    const issued = await new SessionIssuer(store, { now: () => now }).issue({
      expiresAt: new Date("2026-08-14T03:00:00.000Z"),
      userId: store.account.id,
    });
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      testRoutes: true,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { cookie: `lpbot_session=${issued.token}` },
      method: "GET",
      url: "/__test/owned/00000000-0000-4000-8000-000000000002",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
    expect(response.body).not.toContain("fixture-resource");
  });

  it("uses the error envelope for unknown routes", async () => {
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new MemorySessionStore(),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/not-registered" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested endpoint does not exist",
        requestId: expect.any(String),
        retryable: false,
      },
    });
  });

  it("redacts credentials and personal data from unexpected errors and logs", async () => {
    const token = "credential-that-must-not-leak";
    const displayName = "Sensitive Fixture Name";
    const store = new MemorySessionStore();
    store.findSessionByTokenHash = async () => {
      throw new Error(`database failure ${token} ${displayName}`);
    };
    const logLines: string[] = [];
    const app = buildApiApp({
      logger: { write: (line) => logLines.push(line) },
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
    });
    apps.push(app);

    const response = await app.inject({
      headers: { authorization: `Bearer ${token}` },
      method: "POST",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
        requestId: expect.any(String),
        retryable: true,
      },
    });
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(displayName);
    expect(logLines.join("\n")).not.toContain(token);
    expect(logLines.join("\n")).not.toContain(displayName);
    expect(logLines.join("\n")).not.toContain("authorization");
  });
});
