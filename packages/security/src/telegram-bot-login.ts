import { randomBytes, randomUUID } from "node:crypto";

import {
  SessionIssuer,
  hashSessionToken,
  type AccessAuditEvent,
  type IssuedSession,
  type NewStoredSession,
  type SessionStore,
  type StoredAccount,
} from "./index.js";

export type BotLoginIntentStatus = "pending" | "confirmed" | "consumed" | "cancelled" | "expired";

export interface NewBotLoginIntent {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  tokenHash: string;
}

export interface BotLoginIntent extends NewBotLoginIntent {
  account: StoredAccount | null;
  cancelledAt: Date | null;
  confirmedAt: Date | null;
  consumedAt: Date | null;
  status: BotLoginIntentStatus;
  userId: string | null;
}

export interface ConfirmBotLoginIntentInput {
  candidateUserId: string;
  confirmedAt: Date;
  subject: string;
  tokenHash: string;
}

export interface ConsumeBotLoginIntentInput {
  consumedAt: Date;
  session: NewStoredSession;
  tokenHash: string;
}

export interface TelegramBotLoginStore extends SessionStore {
  cancelBotLoginIntent(tokenHash: string, at: Date): Promise<BotLoginIntent | null>;
  confirmBotLoginIntent(input: ConfirmBotLoginIntentInput): Promise<BotLoginIntent | null>;
  consumeConfirmedBotLoginIntent(input: ConsumeBotLoginIntentInput): Promise<boolean>;
  createBotLoginIntent(intent: NewBotLoginIntent): Promise<void>;
  findBotLoginIntent(tokenHash: string, at: Date): Promise<BotLoginIntent | null>;
}

export interface TelegramBotLoginOptions {
  intentTtlSeconds: number;
  now?: () => Date;
  sessionTtlSeconds: number;
}

export interface CreatedBotLogin {
  expiresAt: Date;
  token: string;
}

export interface ConfirmBotLoginInput {
  requestId: string;
  telegramSubject: string;
  token: string;
}

export interface ConfirmBotLoginResult {
  status: BotLoginIntentStatus | "invalid";
}

export interface PollBotLoginResult {
  login: { account: StoredAccount; session: IssuedSession } | null;
  status: BotLoginIntentStatus | "invalid";
}

export interface TelegramBotLoginApplication {
  cancel(token: string, requestId: string): Promise<ConfirmBotLoginResult>;
  confirmLogin(input: ConfirmBotLoginInput): Promise<ConfirmBotLoginResult>;
  create(requestId: string): Promise<CreatedBotLogin>;
  poll(token: string, requestId: string): Promise<PollBotLoginResult>;
}

const oneTimeTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const telegramSubjectPattern = /^[1-9][0-9]{0,15}$/u;

export class TelegramBotLoginService implements TelegramBotLoginApplication {
  readonly #intentTtlMilliseconds: number;
  readonly #issuer: SessionIssuer;
  readonly #now: () => Date;
  readonly #sessionTtlMilliseconds: number;
  readonly #store: TelegramBotLoginStore;

  constructor(store: TelegramBotLoginStore, options: TelegramBotLoginOptions) {
    if (!Number.isSafeInteger(options.intentTtlSeconds) || options.intentTtlSeconds <= 0) {
      throw new RangeError("Bot login intent TTL must be a positive integer");
    }
    if (!Number.isSafeInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new RangeError("Session TTL must be a positive integer");
    }
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#issuer = new SessionIssuer(store, { now: this.#now });
    this.#intentTtlMilliseconds = options.intentTtlSeconds * 1_000;
    this.#sessionTtlMilliseconds = options.sessionTtlSeconds * 1_000;
  }

  async create(requestId: string): Promise<CreatedBotLogin> {
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + this.#intentTtlMilliseconds);
    const token = randomBytes(32).toString("base64url");
    await this.#store.createBotLoginIntent({
      createdAt,
      expiresAt,
      id: randomUUID(),
      tokenHash: hashSessionToken(token),
    });
    await this.#audit("telegram.bot.intent.create", "allowed", requestId, createdAt, null, null);
    return { expiresAt, token };
  }

  async confirmLogin(input: ConfirmBotLoginInput): Promise<ConfirmBotLoginResult> {
    const confirmedAt = this.#now();
    if (
      !oneTimeTokenPattern.test(input.token) ||
      !telegramSubjectPattern.test(input.telegramSubject)
    ) {
      await this.#audit(
        "telegram.bot.intent.confirm",
        "denied",
        input.requestId,
        confirmedAt,
        null,
        null,
      );
      return { status: "invalid" };
    }

    const intent = await this.#store.confirmBotLoginIntent({
      candidateUserId: randomUUID(),
      confirmedAt,
      subject: input.telegramSubject,
      tokenHash: hashSessionToken(input.token),
    });
    const allowed = intent?.status === "confirmed";
    await this.#audit(
      "telegram.bot.intent.confirm",
      allowed ? "allowed" : "denied",
      input.requestId,
      confirmedAt,
      null,
      intent?.userId ?? null,
    );
    return { status: intent?.status ?? "invalid" };
  }

  async poll(token: string, requestId: string): Promise<PollBotLoginResult> {
    const polledAt = this.#now();
    if (!oneTimeTokenPattern.test(token)) {
      await this.#audit("telegram.bot.intent.consume", "denied", requestId, polledAt, null, null);
      return { login: null, status: "invalid" };
    }

    const tokenHash = hashSessionToken(token);
    const intent = await this.#store.findBotLoginIntent(tokenHash, polledAt);
    if (!intent || intent.status !== "confirmed" || !intent.account || !intent.userId) {
      const status = intent?.status ?? "invalid";
      if (status !== "pending") {
        await this.#audit(
          "telegram.bot.intent.consume",
          "denied",
          requestId,
          polledAt,
          null,
          intent?.userId ?? null,
        );
      }
      return { login: null, status };
    }

    const session = await this.#issuer.issueIf(
      {
        expiresAt: new Date(polledAt.getTime() + this.#sessionTtlMilliseconds),
        userId: intent.userId,
      },
      (storedSession) =>
        this.#store.consumeConfirmedBotLoginIntent({
          consumedAt: polledAt,
          session: storedSession,
          tokenHash,
        }),
    );
    if (!session) {
      const latest = await this.#store.findBotLoginIntent(tokenHash, polledAt);
      await this.#audit(
        "telegram.bot.intent.consume",
        "denied",
        requestId,
        polledAt,
        null,
        latest?.userId ?? intent.userId,
      );
      return { login: null, status: latest?.status ?? "invalid" };
    }

    await this.#audit(
      "telegram.bot.intent.consume",
      "allowed",
      requestId,
      polledAt,
      session.sessionId,
      intent.userId,
    );
    return { login: { account: intent.account, session }, status: "consumed" };
  }

  async cancel(token: string, requestId: string): Promise<ConfirmBotLoginResult> {
    const cancelledAt = this.#now();
    if (!oneTimeTokenPattern.test(token)) {
      await this.#audit("telegram.bot.intent.cancel", "denied", requestId, cancelledAt, null, null);
      return { status: "invalid" };
    }
    const intent = await this.#store.cancelBotLoginIntent(hashSessionToken(token), cancelledAt);
    const allowed = intent?.status === "cancelled";
    await this.#audit(
      "telegram.bot.intent.cancel",
      allowed ? "allowed" : "denied",
      requestId,
      cancelledAt,
      null,
      intent?.userId ?? null,
    );
    return { status: intent?.status ?? "invalid" };
  }

  async #audit(
    action: AccessAuditEvent["action"],
    outcome: AccessAuditEvent["outcome"],
    requestId: string,
    createdAt: Date,
    sessionId: string | null,
    userId: string | null,
  ): Promise<void> {
    await this.#store.recordAccessAudit({
      action,
      createdAt,
      outcome,
      requestId,
      sessionId,
      userId,
    });
  }
}
