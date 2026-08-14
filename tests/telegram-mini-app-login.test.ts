import { createHmac } from "node:crypto";

import { buildApiApp } from "../apps/api/src/index.js";
import {
  TelegramAuthenticationError,
  TelegramInitDataVerifier,
  TelegramMiniAppLoginService,
  type AccessAuditEvent,
  type InitDataReplay,
  type NewStoredSession,
  type ResolveTelegramIdentityInput,
  type StoredAccount,
  type StoredSession,
  type TelegramMiniAppStore,
} from "../packages/security/src/index.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-14T03:00:00.000Z");
const botToken = "123456789:LOCAL_FIXTURE_TELEGRAM_TOKEN";

function signedInitData(subject = 42): string {
  const fields = {
    auth_date: String(Math.floor(now.getTime() / 1_000)),
    query_id: "MINI_APP_QUERY",
    user: JSON.stringify({ first_name: "Not persisted", id: subject }),
  };
  const check = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return `${new URLSearchParams(fields).toString()}&hash=${hash}`;
}

class MemoryMiniAppStore implements TelegramMiniAppStore {
  readonly audits: AccessAuditEvent[] = [];
  readonly identities = new Map<string, StoredAccount>();
  readonly replays = new Map<string, InitDataReplay>();
  readonly sessions = new Map<string, StoredSession>();

  async consumeInitDataReplay(replay: InitDataReplay): Promise<boolean> {
    if (this.replays.has(replay.digest)) return false;
    this.replays.set(replay.digest, replay);
    return true;
  }

  async createSession(session: NewStoredSession): Promise<void> {
    const account = [...this.identities.values()].find(({ id }) => id === session.userId);
    if (!account) throw new Error("Missing fixture account");
    this.sessions.set(session.tokenHash, {
      ...session,
      account,
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

  async resolveTelegramIdentity(input: ResolveTelegramIdentityInput): Promise<StoredAccount> {
    const existing = this.identities.get(input.subject);
    if (existing) return existing;
    const account: StoredAccount = {
      avatarUrl: null,
      displayName: null,
      id: input.candidateUserId,
      role: "user",
      status: "pending",
      tier: "normal",
    };
    this.identities.set(input.subject, account);
    return account;
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

function service(store: MemoryMiniAppStore): TelegramMiniAppLoginService {
  const verifier = new TelegramInitDataVerifier({
    botToken,
    maxAgeSeconds: 300,
    maxFutureSkewSeconds: 30,
    now: () => now,
  });
  return new TelegramMiniAppLoginService(store, verifier, {
    now: () => now,
    sessionTtlSeconds: 3_600,
  });
}

describe("Telegram Mini App login application service", () => {
  it("atomically consumes verified initData and issues a hashed local session", async () => {
    const store = new MemoryMiniAppStore();
    store.identities.set("42", {
      avatarUrl: null,
      displayName: "Fixture User",
      id: "00000000-0000-4000-8000-000000000042",
      role: "user",
      status: "active",
      tier: "normal",
    });
    const initData = signedInitData();

    const login = await service(store).authenticate({ initData }, "request-mini-app");

    expect(login.account.status).toBe("active");
    expect(login.session.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect([...store.sessions.keys()]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/u)]);
    expect(
      JSON.stringify({
        replays: [...store.replays.values()],
        sessions: [...store.sessions.values()],
      }),
    ).not.toContain(initData);
    expect(JSON.stringify([...store.sessions.values()])).not.toContain(login.session.token);
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        action: "telegram.mini_app.login",
        outcome: "allowed",
        requestId: "request-mini-app",
      }),
    );
  });

  it("allows only one winner when the same initData is submitted concurrently", async () => {
    const store = new MemoryMiniAppStore();
    const loginService = service(store);
    const initData = signedInitData(99);

    const attempts = await Promise.allSettled([
      loginService.authenticate({ initData }, "request-a"),
      loginService.authenticate({ initData }, "request-b"),
    ]);

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: "AUTH_REPLAYED" }),
      status: "rejected",
    });
    expect((rejected as PromiseRejectedResult | undefined)?.reason).toBeInstanceOf(
      TelegramAuthenticationError,
    );
    expect(store.sessions).toHaveProperty("size", 1);
    expect(store.identities.get("99")?.status).toBe("pending");
  });

  it("extends POST /api/auth/me with a Cookie-only Mini App login response", async () => {
    const store = new MemoryMiniAppStore();
    store.identities.set("42", {
      avatarUrl: null,
      displayName: "Fixture User",
      id: "00000000-0000-4000-8000-000000000042",
      role: "user",
      status: "active",
      tier: "normal",
    });
    const logLines: string[] = [];
    const initData = signedInitData();
    const app = buildApiApp({
      logger: { write: (line) => logLines.push(line) },
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      telegramMiniApp: service(store),
    });

    const response = await app.inject({
      method: "POST",
      payload: { initData },
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("lpbot_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(response.json()).toMatchObject({
      data: {
        isAdmin: false,
        user: { role: "user", userId: "00000000-0000-4000-8000-000000000042" },
      },
      success: true,
    });
    const credential = [...store.sessions.values()][0]?.tokenHash;
    expect(JSON.stringify(response.json())).not.toContain("token");
    expect(JSON.stringify(response.json())).not.toContain(initData);
    expect(logLines.join("\n")).not.toContain(initData);
    expect(logLines.join("\n")).not.toContain(credential);

    await app.close();
  });

  it("allows only one API request to consume equivalent initData concurrently", async () => {
    const store = new MemoryMiniAppStore();
    store.identities.set("42", {
      avatarUrl: null,
      displayName: "Fixture User",
      id: "00000000-0000-4000-8000-000000000042",
      role: "user",
      status: "active",
      tier: "normal",
    });
    const initData = signedInitData();
    const reordered = [...new URLSearchParams(initData).entries()]
      .reverse()
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      telegramMiniApp: service(store),
    });

    const responses = await Promise.all([
      app.inject({ method: "POST", payload: { initData }, url: "/api/auth/me" }),
      app.inject({ method: "POST", payload: { initData: reordered }, url: "/api/auth/me" }),
    ]);

    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(store.sessions).toHaveProperty("size", 1);
    expect(store.replays).toHaveProperty("size", 1);
    await app.close();
  });

  it.each([
    ["active", 200, null],
    ["pending", 403, "ACCOUNT_PENDING"],
    ["rejected", 403, "ACCOUNT_REJECTED"],
    ["banned", 403, "ACCOUNT_BANNED"],
  ] as const)(
    "applies the %s account policy after verified Mini App login",
    async (status, expectedStatus, expectedCode) => {
      const store = new MemoryMiniAppStore();
      store.identities.set("42", {
        avatarUrl: null,
        displayName: null,
        id: "00000000-0000-4000-8000-000000000042",
        role: "user",
        status,
        tier: "normal",
      });
      const app = buildApiApp({
        maintenance: { enabled: false, message: null, until: null },
        now: () => now,
        regionPolicy: () => ({ blocked: false, code: null, message: null }),
        sessionStore: store,
        telegramMiniApp: service(store),
      });

      const response = await app.inject({
        method: "POST",
        payload: { initData: signedInitData() },
        url: "/api/auth/me",
      });

      expect(response.statusCode).toBe(expectedStatus);
      expect(response.headers["set-cookie"]).toContain("lpbot_session=");
      if (expectedCode) expect(response.json().error.code).toBe(expectedCode);
      else expect(response.json().success).toBe(true);
      expect(JSON.stringify(response.json())).not.toContain("token");
      await app.close();
    },
  );
});
