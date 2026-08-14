import { randomUUID } from "node:crypto";

import {
  SessionIssuer,
  type AccessAuditEvent,
  type IssuedSession,
  type SessionStore,
  type StoredAccount,
} from "./index.js";
import { TelegramInitDataError, type TelegramInitDataVerifier } from "./telegram-init-data.js";

export interface InitDataReplay {
  consumedAt: Date;
  digest: string;
}

export interface ResolveTelegramIdentityInput {
  candidateUserId: string;
  createdAt: Date;
  subject: string;
}

export interface TelegramMiniAppStore extends SessionStore {
  consumeInitDataReplay(replay: InitDataReplay): Promise<boolean>;
  resolveTelegramIdentity(input: ResolveTelegramIdentityInput): Promise<StoredAccount>;
}

export type TelegramAuthenticationErrorCode =
  "AUTH_DUPLICATE_FIELD" | "AUTH_EXPIRED" | "AUTH_FUTURE" | "AUTH_INVALID" | "AUTH_REPLAYED";

export class TelegramAuthenticationError extends Error {
  readonly code: TelegramAuthenticationErrorCode;

  constructor(code: TelegramAuthenticationErrorCode) {
    super(code);
    this.name = "TelegramAuthenticationError";
    this.code = code;
  }
}

export interface TelegramMiniAppLoginResult {
  account: StoredAccount;
  session: IssuedSession;
}

export interface TelegramMiniAppAuthenticator {
  authenticate(body: unknown, requestId: string): Promise<TelegramMiniAppLoginResult>;
}

export interface TelegramMiniAppLoginOptions {
  now?: () => Date;
  sessionTtlSeconds: number;
}

export class TelegramMiniAppLoginService implements TelegramMiniAppAuthenticator {
  readonly #issuer: SessionIssuer;
  readonly #now: () => Date;
  readonly #sessionTtlMilliseconds: number;
  readonly #store: TelegramMiniAppStore;
  readonly #verifier: TelegramInitDataVerifier;

  constructor(
    store: TelegramMiniAppStore,
    verifier: TelegramInitDataVerifier,
    options: TelegramMiniAppLoginOptions,
  ) {
    if (!Number.isSafeInteger(options.sessionTtlSeconds) || options.sessionTtlSeconds <= 0) {
      throw new RangeError("Session TTL must be a positive integer");
    }
    this.#store = store;
    this.#verifier = verifier;
    this.#now = options.now ?? (() => new Date());
    this.#issuer = new SessionIssuer(store, { now: this.#now });
    this.#sessionTtlMilliseconds = options.sessionTtlSeconds * 1_000;
  }

  async authenticate(body: unknown, requestId: string): Promise<TelegramMiniAppLoginResult> {
    const attemptedAt = this.#now();
    let verified;
    try {
      verified = this.#verifier.verifyRequestBody(body);
    } catch (error) {
      await this.#audit("denied", requestId, attemptedAt, null, null);
      if (error instanceof TelegramInitDataError) {
        throw new TelegramAuthenticationError(error.code);
      }
      throw error;
    }

    const consumed = await this.#store.consumeInitDataReplay({
      consumedAt: attemptedAt,
      digest: verified.replayDigest,
    });
    if (!consumed) {
      await this.#audit("denied", requestId, attemptedAt, null, null);
      throw new TelegramAuthenticationError("AUTH_REPLAYED");
    }

    const account = await this.#store.resolveTelegramIdentity({
      candidateUserId: randomUUID(),
      createdAt: attemptedAt,
      subject: verified.subject,
    });
    const session = await this.#issuer.issue({
      expiresAt: new Date(attemptedAt.getTime() + this.#sessionTtlMilliseconds),
      userId: account.id,
    });
    await this.#audit("allowed", requestId, attemptedAt, session.sessionId, account.id);
    return { account, session };
  }

  async #audit(
    outcome: AccessAuditEvent["outcome"],
    requestId: string,
    createdAt: Date,
    sessionId: string | null,
    userId: string | null,
  ): Promise<void> {
    await this.#store.recordAccessAudit({
      action: "telegram.mini_app.login",
      createdAt,
      outcome,
      requestId,
      sessionId,
      userId,
    });
  }
}
