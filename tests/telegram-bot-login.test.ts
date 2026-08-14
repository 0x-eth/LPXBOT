import {
  TelegramBotLoginService,
  hashSessionToken,
  type AccessAuditEvent,
  type BotLoginIntent,
  type ConfirmBotLoginIntentInput,
  type ConsumeBotLoginIntentInput,
  type NewBotLoginIntent,
  type NewStoredSession,
  type StoredAccount,
  type StoredSession,
  type TelegramBotLoginStore,
} from "../packages/security/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import { telegramBotCancelContract } from "../packages/api-contract/src/index.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-14T03:00:00.000Z");

interface MemoryIntent extends NewBotLoginIntent {
  account: StoredAccount | null;
  cancelledAt: Date | null;
  confirmedAt: Date | null;
  consumedAt: Date | null;
  status: BotLoginIntent["status"];
  userId: string | null;
}

class MemoryBotLoginStore implements TelegramBotLoginStore {
  readonly audits: AccessAuditEvent[] = [];
  readonly identities = new Map<string, StoredAccount>();
  readonly intents = new Map<string, MemoryIntent>();
  readonly sessions = new Map<string, StoredSession>();

  async cancelBotLoginIntent(tokenHash: string, at: Date): Promise<BotLoginIntent | null> {
    const intent = this.#expire(this.intents.get(tokenHash) ?? null, at);
    if (!intent) return null;
    if (intent.status === "pending" || intent.status === "confirmed") {
      intent.status = "cancelled";
      intent.cancelledAt = at;
    }
    return intent;
  }

  async confirmBotLoginIntent(input: ConfirmBotLoginIntentInput): Promise<BotLoginIntent | null> {
    const intent = this.#expire(this.intents.get(input.tokenHash) ?? null, input.confirmedAt);
    if (!intent) return null;
    if (intent.status === "pending") {
      let account = this.identities.get(input.subject);
      if (!account) {
        account = {
          allowedChainIds: [],
          avatarUrl: null,
          displayName: null,
          id: input.candidateUserId,
          role: "user",
          status: "pending",
          tier: "normal",
        };
        this.identities.set(input.subject, account);
      }
      intent.account = account;
      intent.userId = account.id;
      intent.confirmedAt = input.confirmedAt;
      intent.status = "confirmed";
    }
    return intent;
  }

  async consumeConfirmedBotLoginIntent(input: ConsumeBotLoginIntentInput): Promise<boolean> {
    const intent = this.#expire(this.intents.get(input.tokenHash) ?? null, input.consumedAt);
    if (!intent || intent.status !== "confirmed" || intent.userId !== input.session.userId) {
      return false;
    }
    intent.status = "consumed";
    intent.consumedAt = input.consumedAt;
    if (!intent.account) throw new Error("Confirmed intent has no account");
    this.sessions.set(input.session.tokenHash, {
      ...input.session,
      account: intent.account,
      lastSeenAt: null,
      revokedAt: null,
    });
    return true;
  }

  async createBotLoginIntent(intent: NewBotLoginIntent): Promise<void> {
    this.intents.set(intent.tokenHash, {
      ...intent,
      account: null,
      cancelledAt: null,
      confirmedAt: null,
      consumedAt: null,
      status: "pending",
      userId: null,
    });
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

  async findBotLoginIntent(tokenHash: string, at: Date): Promise<BotLoginIntent | null> {
    return this.#expire(this.intents.get(tokenHash) ?? null, at);
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

  #expire(intent: MemoryIntent | null, at: Date): MemoryIntent | null {
    if (
      intent &&
      (intent.status === "pending" || intent.status === "confirmed") &&
      intent.expiresAt.getTime() <= at.getTime()
    ) {
      intent.status = "expired";
    }
    return intent;
  }
}

function service(store: MemoryBotLoginStore, at: () => Date = () => now): TelegramBotLoginService {
  return new TelegramBotLoginService(store, {
    intentTtlSeconds: 180,
    now: at,
    sessionTtlSeconds: 3_600,
  });
}

describe("Telegram Bot one-time login application service", () => {
  it("creates a cryptographically random pending token while storing only its hash", async () => {
    const store = new MemoryBotLoginStore();

    const created = await service(store).create("request-create");

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(created.expiresAt).toEqual(new Date("2026-08-14T03:03:00.000Z"));
    expect(store.intents.get(hashSessionToken(created.token))).toMatchObject({ status: "pending" });
    expect(JSON.stringify([...store.intents.values()])).not.toContain(created.token);
    expect(store.audits).toContainEqual(
      expect.objectContaining({ action: "telegram.bot.intent.create", outcome: "allowed" }),
    );
  });

  it("confirms through a Telegram subject and gives exactly one concurrent poll a session", async () => {
    const store = new MemoryBotLoginStore();
    store.identities.set("42", {
      allowedChainIds: [1, 56],
      avatarUrl: null,
      displayName: "Fixture User",
      id: "00000000-0000-4000-8000-000000000042",
      role: "user",
      status: "active",
      tier: "normal",
    });
    const loginService = service(store);
    const created = await loginService.create("request-create");

    await expect(loginService.poll(created.token, "request-pending")).resolves.toEqual({
      login: null,
      status: "pending",
    });
    await expect(
      loginService.confirmLogin({
        requestId: "telegram-update-100",
        telegramSubject: "42",
        token: created.token,
      }),
    ).resolves.toEqual({ status: "confirmed" });

    const polls = await Promise.all([
      loginService.poll(created.token, "request-poll-a"),
      loginService.poll(created.token, "request-poll-b"),
    ]);
    const winner = polls.find(({ login }) => login !== null);
    const loser = polls.find(({ login }) => login === null);

    expect(winner).toMatchObject({
      login: {
        account: { id: "00000000-0000-4000-8000-000000000042" },
        session: { token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) },
      },
      status: "consumed",
    });
    expect(loser).toEqual({ login: null, status: "consumed" });
    expect(store.sessions).toHaveProperty("size", 1);
    expect(store.intents.get(hashSessionToken(created.token))?.status).toBe("consumed");
  });

  it("exposes create and one-winner polling endpoints without returning a credential", async () => {
    const store = new MemoryBotLoginStore();
    store.identities.set("42", {
      allowedChainIds: [1, 56],
      avatarUrl: null,
      displayName: "Fixture User",
      id: "00000000-0000-4000-8000-000000000042",
      role: "user",
      status: "active",
      tier: "normal",
    });
    const botLogin = service(store);
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      telegramBot: botLogin,
      telegramBotUsername: "local_fixture_bot",
    });

    const create = await app.inject({ method: "POST", url: "/api/auth/login-token" });
    expect(create.statusCode).toBe(200);
    expect(create.json()).toMatchObject({
      data: {
        expiresAt: "2026-08-14T03:03:00.000Z",
        loginUrl: expect.stringMatching(/^https:\/\/t\.me\/local_fixture_bot\?start=/u),
        token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      },
      success: true,
    });
    const token = create.json().data.token as string;

    const pending = await app.inject({
      method: "GET",
      url: `/api/auth/login-status/${token}`,
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data).toEqual({ confirmed: false, session: null, status: "pending" });

    await botLogin.confirmLogin({
      requestId: "telegram-update-200",
      telegramSubject: "42",
      token,
    });
    const [first, second] = await Promise.all([
      app.inject({ method: "GET", url: `/api/auth/login-status/${token}` }),
      app.inject({ method: "GET", url: `/api/auth/login-status/${token}` }),
    ]);
    const success = [first, second].find(({ statusCode }) => statusCode === 200);
    const consumed = [first, second].find(({ statusCode }) => statusCode === 409);

    expect(success?.headers["set-cookie"]).toContain("lpbot_session=");
    expect(success?.json()).toMatchObject({
      data: {
        confirmed: true,
        session: { userId: "00000000-0000-4000-8000-000000000042" },
        status: "consumed",
      },
      success: true,
    });
    expect(JSON.stringify(success?.json())).not.toContain("credential");
    expect(JSON.stringify(success?.json())).not.toContain(token);
    expect(consumed?.json()).toMatchObject({
      error: { code: "LOGIN_TOKEN_CONSUMED" },
      success: false,
    });
    expect(
      (await app.inject({ method: "POST", url: "/api/auth/dev-confirm" })).statusCode,
    ).toBe(404);

    await app.close();
  });

  it("cancels an open intent through an explicitly replica-internal contract", async () => {
    expect(telegramBotCancelContract).toMatchObject({
      method: "POST",
      path: "/api/auth/login-token/{token}/cancel",
      replicaInternal: true,
    });
    const store = new MemoryBotLoginStore();
    const botLogin = service(store);
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: store,
      telegramBot: botLogin,
      telegramBotUsername: "local_fixture_bot",
    });
    const created = await app.inject({ method: "POST", url: "/api/auth/login-token" });
    const token = created.json().data.token as string;

    await botLogin.confirmLogin({
      requestId: "telegram-update-cancel",
      telegramSubject: "77",
      token,
    });
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/auth/login-token/${token}/cancel`,
    });
    const polled = await app.inject({
      method: "GET",
      url: `/api/auth/login-status/${token}`,
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data).toEqual({ status: "cancelled" });
    expect(polled.statusCode).toBe(409);
    expect(polled.json().error.code).toBe("LOGIN_TOKEN_CANCELLED");
    expect(store.sessions).toHaveProperty("size", 0);

    await app.close();
  });
});
