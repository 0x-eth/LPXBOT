import { createHash, randomBytes, randomUUID } from "node:crypto";

export { TelegramInitDataError, TelegramInitDataVerifier } from "./telegram-init-data.js";
export type {
  TelegramInitDataErrorCode,
  TelegramInitDataVerifierOptions,
  VerifiedTelegramInitData,
} from "./telegram-init-data.js";
export {
  TelegramAuthenticationError,
  TelegramMiniAppLoginService,
} from "./telegram-mini-app-login.js";
export type {
  InitDataReplay,
  ResolveTelegramIdentityInput,
  TelegramAuthenticationErrorCode,
  TelegramMiniAppLoginOptions,
  TelegramMiniAppLoginResult,
  TelegramMiniAppAuthenticator,
  TelegramMiniAppStore,
} from "./telegram-mini-app-login.js";
export { TelegramBotLoginService } from "./telegram-bot-login.js";
export type {
  BotLoginIntent,
  BotLoginIntentStatus,
  ConfirmBotLoginInput,
  ConfirmBotLoginIntentInput,
  ConfirmBotLoginResult,
  ConsumeBotLoginIntentInput,
  CreatedBotLogin,
  NewBotLoginIntent,
  PollBotLoginResult,
  TelegramBotLoginOptions,
  TelegramBotLoginApplication,
  TelegramBotLoginStore,
} from "./telegram-bot-login.js";
export {
  LoginWalletAuthenticationService,
  WalletAuthenticationError,
} from "./login-wallet-auth.js";
export type {
  AuthWalletChallengePurpose,
  ConsumeAuthWalletLoginInput,
  ConsumeAuthWalletLoginResult,
  CreatedLoginWalletChallenge,
  CreateLoginWalletChallengeInput,
  LoginWithWalletInput,
  LoginWithWalletResult,
  LoginWalletAuthenticationApplication,
  LoginWalletAuthenticationOptions,
  LoginWalletAuthStore,
  NewAuthWalletChallenge,
  StoredAuthWalletChallenge,
  WalletAuthenticationErrorCode,
} from "./login-wallet-auth.js";

export const securityPackage = {
  name: "@lpbot/security",
} as const;

export type StoredRole = "user" | "pro" | "admin";
export type StoredTier = "normal" | "pro";
export type StoredAccountStatus = "active" | "pending" | "rejected" | "banned";

export interface StoredAccount {
  allowedChainIds: number[];
  avatarUrl: string | null;
  displayName: string | null;
  id: string;
  role: StoredRole;
  status: StoredAccountStatus;
  tier: StoredTier;
}

export interface NewStoredSession {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  tokenHash: string;
  userId: string;
}

export interface StoredSession extends NewStoredSession {
  account: StoredAccount;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}

export interface AccessAuditEvent {
  action:
    | "session.access"
    | "session.logout"
    | "telegram.mini_app.login"
    | "telegram.bot.intent.create"
    | "telegram.bot.intent.confirm"
    | "telegram.bot.intent.cancel"
    | "telegram.bot.intent.consume"
    | "wallet.login";
  createdAt: Date;
  outcome: "allowed" | "denied";
  requestId: string;
  sessionId: string | null;
  userId: string | null;
}

export interface SessionStore {
  createSession(session: NewStoredSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  recordAccessAudit(event: AccessAuditEvent): Promise<void>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<boolean>;
  touchSession(tokenHash: string, lastSeenAt: Date): Promise<void>;
}

export interface IssueSessionInput {
  expiresAt: Date;
  userId: string;
}

export interface IssuedSession {
  expiresAt: Date;
  sessionId: string;
  token: string;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class SessionIssuer {
  readonly #now: () => Date;
  readonly #store: SessionStore;

  constructor(store: SessionStore, options: { now?: () => Date } = {}) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
  }

  async issue(input: IssueSessionInput): Promise<IssuedSession> {
    const { issued, stored } = this.#prepare(input);
    await this.#store.createSession(stored);
    return issued;
  }

  async issueIf(
    input: IssueSessionInput,
    persist: (session: NewStoredSession) => Promise<boolean>,
  ): Promise<IssuedSession | null> {
    const { issued, stored } = this.#prepare(input);
    return (await persist(stored)) ? issued : null;
  }

  #prepare(input: IssueSessionInput): {
    issued: IssuedSession;
    stored: NewStoredSession;
  } {
    const createdAt = this.#now();
    if (input.expiresAt.getTime() <= createdAt.getTime()) {
      throw new RangeError("Session expiry must be in the future");
    }

    const token = randomBytes(32).toString("base64url");
    const sessionId = randomUUID();
    const stored = {
      createdAt,
      expiresAt: input.expiresAt,
      id: sessionId,
      tokenHash: hashSessionToken(token),
      userId: input.userId,
    };

    return {
      issued: { expiresAt: input.expiresAt, sessionId, token },
      stored,
    };
  }
}
