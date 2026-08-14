import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createErrorEnvelope, createSuccessEnvelope, type SessionView } from "@lpbot/api-contract";
import {
  authorizeAccount,
  canAccessOwnedResource,
  roleCanAccess,
  type AccessLevel,
  type AccountAccessContext,
} from "@lpbot/domain";
import {
  hashSessionToken,
  TelegramAuthenticationError,
  type SessionStore,
  type StoredAccount,
  type StoredSession,
  type TelegramBotLoginApplication,
  type TelegramMiniAppAuthenticator,
} from "@lpbot/security";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { sessionCookieName, setBrowserSessionCookie } from "./browser-session-cookie.js";

export interface MaintenanceConfig {
  enabled: boolean;
  message: string | null;
  until: string | null;
}

export interface RegionPolicyResult {
  blocked: boolean;
  code: string | null;
  message: string | null;
}

export interface ApiAppOptions {
  authRateLimits?: AuthRateLimits;
  logger?: { write(line: string): void };
  maintenance: MaintenanceConfig;
  now?: () => Date;
  regionPolicy(request: FastifyRequest): RegionPolicyResult;
  sessionStore: SessionStore;
  telegramBot?: TelegramBotLoginApplication;
  telegramBotUsername?: string;
  telegramMiniApp?: TelegramMiniAppAuthenticator;
  testRoutes?: boolean;
}

export interface AuthRateLimits {
  cancel: number;
  loginToken: number;
  miniApp: number;
  status: number;
  timeWindowMs: number;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  return match?.[1] ?? null;
}

function sessionToken(request: FastifyRequest): string | null {
  return request.cookies[sessionCookieName] ?? bearerToken(request.headers.authorization);
}

async function findValidSession(
  token: string,
  store: SessionStore,
  now: Date,
): Promise<{ session: StoredSession; tokenHash: string } | null> {
  const tokenHash = hashSessionToken(token);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
  return { session, tokenHash };
}

function accountToSessionView(account: StoredAccount, maintenanceBypass: boolean): SessionView {
  return {
    allowedChainIds: account.allowedChainIds,
    avatarUrl: account.avatarUrl,
    displayName: account.displayName,
    maintenanceBypass,
    role: account.role,
    tier: account.tier,
    userId: account.id,
  };
}

function toSessionView(session: StoredSession, maintenanceBypass: boolean): SessionView {
  return accountToSessionView(session.account, maintenanceBypass);
}

const telegramAuthenticationMessages: Readonly<
  Record<TelegramAuthenticationError["code"], string>
> = {
  AUTH_DUPLICATE_FIELD: "Telegram authentication data contains a repeated field",
  AUTH_EXPIRED: "Telegram authentication data has expired",
  AUTH_FUTURE: "Telegram authentication data has an invalid timestamp",
  AUTH_INVALID: "Telegram authentication data is invalid",
  AUTH_REPLAYED: "Telegram authentication data was already used",
};

const telegramBotUsernamePattern = /^[A-Za-z][A-Za-z0-9_]{4,31}$/u;

function telegramBotConfigured(
  options: ApiAppOptions,
): options is ApiAppOptions & {
  telegramBot: TelegramBotLoginApplication;
  telegramBotUsername: string;
} {
  return (
    options.telegramBot !== undefined &&
    typeof options.telegramBotUsername === "string" &&
    telegramBotUsernamePattern.test(options.telegramBotUsername)
  );
}

export function buildApiApp(options: ApiAppOptions): FastifyInstance {
  const now = options.now ?? (() => new Date());
  const authRateLimits: AuthRateLimits = options.authRateLimits ?? {
    cancel: 20,
    loginToken: 5,
    miniApp: 120,
    status: 120,
    timeWindowMs: 60_000,
  };
  for (const value of Object.values(authRateLimits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError("Authentication rate limits must be positive integers");
    }
  }
  const app = Fastify({
    logger: false,
  });

  void app.register(cookie);
  void app.register(rateLimit, {
    errorResponseBuilder(request) {
      return createErrorEnvelope({
        code: "RATE_LIMITED",
        message: "Too many authentication requests",
        requestId: request.id,
        retryable: true,
      });
    },
    global: false,
  });

  app.addHook("onResponse", (request, reply, done) => {
    options.logger?.write(
      JSON.stringify({
        event: "http.response",
        method: request.method,
        requestId: request.id,
        statusCode: reply.statusCode,
      }),
    );
    done();
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(
      createErrorEnvelope({
        code: "NOT_FOUND",
        message: "The requested endpoint does not exist",
        requestId: request.id,
        retryable: false,
      }),
    ),
  );

  app.setErrorHandler((_error, request, reply) =>
    reply.code(500).send(
      createErrorEnvelope({
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
        requestId: request.id,
        retryable: true,
      }),
    ),
  );

  app.after(() => {
    app.post(
    "/api/auth/me",
    {
      config: {
        rateLimit: { max: authRateLimits.miniApp, timeWindow: authRateLimits.timeWindowMs },
      },
    },
    async (request, reply) => {
    if (request.body !== undefined) {
      if (!options.telegramMiniApp) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "TELEGRAM_AUTH_UNAVAILABLE",
            message: "Telegram authentication is not configured",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      let login;
      try {
        login = await options.telegramMiniApp.authenticate(request.body, request.id);
      } catch (error) {
        if (!(error instanceof TelegramAuthenticationError)) throw error;
        return reply.code(error.code === "AUTH_REPLAYED" ? 409 : 401).send(
          createErrorEnvelope({
            code: error.code,
            message: telegramAuthenticationMessages[error.code],
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      setBrowserSessionCookie(reply, login.session);
      const decision = authorizeAccount({
        accountStatus: login.account.status,
        maintenance: options.maintenance,
        region: options.regionPolicy(request),
        role: login.account.role,
      });
      if (!decision.allowed) {
        return reply.code(decision.statusCode).send(
          createErrorEnvelope({
            code: decision.code,
            message: decision.message,
            requestId: request.id,
            retryable: decision.retryable,
          }),
        );
      }

      const user = accountToSessionView(login.account, decision.maintenanceBypass);
      return createSuccessEnvelope(
        {
          isAdmin: user.role === "admin",
          maintenance: options.maintenance.enabled ? options.maintenance : null,
          user,
        },
        request.id,
      );
    }

    const token = sessionToken(request);
    const resolved = token ? await findValidSession(token, options.sessionStore, now()) : null;
    if (!resolved) {
      await options.sessionStore.recordAccessAudit({
        action: "session.access",
        createdAt: now(),
        outcome: "denied",
        requestId: request.id,
        sessionId: null,
        userId: null,
      });
      return reply.code(401).send(
        createErrorEnvelope({
          code: token ? "AUTH_EXPIRED" : "UNAUTHENTICATED",
          message: token ? "Session is invalid or expired" : "Authentication is required",
          requestId: request.id,
          retryable: false,
        }),
      );
    }

    const { session, tokenHash } = resolved;
    const context: AccountAccessContext = {
      accountStatus: session.account.status,
      maintenance: options.maintenance,
      region: options.regionPolicy(request),
      role: session.account.role,
    };
    const decision = authorizeAccount(context);
    if (!decision.allowed) {
      await options.sessionStore.recordAccessAudit({
        action: "session.access",
        createdAt: now(),
        outcome: "denied",
        requestId: request.id,
        sessionId: session.id,
        userId: session.userId,
      });
      return reply.code(decision.statusCode).send(
        createErrorEnvelope({
          code: decision.code,
          message: decision.message,
          requestId: request.id,
          retryable: decision.retryable,
        }),
      );
    }

    const accessedAt = now();
    await options.sessionStore.touchSession(tokenHash, accessedAt);
    await options.sessionStore.recordAccessAudit({
      action: "session.access",
      createdAt: accessedAt,
      outcome: "allowed",
      requestId: request.id,
      sessionId: session.id,
      userId: session.userId,
    });
    const user = toSessionView(session, decision.maintenanceBypass);
    return createSuccessEnvelope(
      {
        isAdmin: user.role === "admin",
        maintenance: options.maintenance.enabled ? options.maintenance : null,
        user,
      },
      request.id,
    );
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = sessionToken(request);
    const revokedAt = now();
    let session: StoredSession | null = null;
    let revoked = false;

    if (token) {
      const tokenHash = hashSessionToken(token);
      session = await options.sessionStore.findSessionByTokenHash(tokenHash);
      revoked = await options.sessionStore.revokeSession(tokenHash, revokedAt);
    }

    await options.sessionStore.recordAccessAudit({
      action: "session.logout",
      createdAt: revokedAt,
      outcome: "allowed",
      requestId: request.id,
      sessionId: session?.id ?? null,
      userId: session?.userId ?? null,
    });
    reply.clearCookie(sessionCookieName, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
    return createSuccessEnvelope({ loggedOut: true, revoked }, request.id);
  });

  app.post(
    "/api/auth/login-token",
    {
      config: {
        rateLimit: {
          max: authRateLimits.loginToken,
          timeWindow: authRateLimits.timeWindowMs,
        },
      },
    },
    async (request, reply) => {
    if (!telegramBotConfigured(options)) {
      return reply.code(503).send(
        createErrorEnvelope({
          code: "TELEGRAM_BOT_UNAVAILABLE",
          message: "Telegram Bot login is not configured",
          requestId: request.id,
          retryable: false,
        }),
      );
    }

    const created = await options.telegramBot.create(request.id);
    return createSuccessEnvelope(
      {
        expiresAt: created.expiresAt.toISOString(),
        loginUrl: `https://t.me/${options.telegramBotUsername}?start=${created.token}`,
        token: created.token,
      },
      request.id,
    );
    },
  );

  app.get<{ Params: { token: string } }>(
    "/api/auth/login-status/:token",
    {
      config: {
        rateLimit: { max: authRateLimits.status, timeWindow: authRateLimits.timeWindowMs },
      },
    },
    async (request, reply) => {
      if (!telegramBotConfigured(options)) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "TELEGRAM_BOT_UNAVAILABLE",
            message: "Telegram Bot login is not configured",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      const result = await options.telegramBot.poll(request.params.token, request.id);
      if (result.status === "pending") {
        return createSuccessEnvelope(
          { confirmed: false, session: null, status: "pending" as const },
          request.id,
        );
      }
      if (!result.login) {
        const error =
          result.status === "expired"
            ? {
                code: "LOGIN_TOKEN_EXPIRED",
                message: "The Telegram login link has expired",
                statusCode: 410,
              }
            : result.status === "cancelled"
              ? {
                  code: "LOGIN_TOKEN_CANCELLED",
                  message: "The Telegram login was cancelled",
                  statusCode: 409,
                }
              : result.status === "consumed"
                ? {
                    code: "LOGIN_TOKEN_CONSUMED",
                    message: "The Telegram login link was already used",
                    statusCode: 409,
                  }
                : {
                    code: "LOGIN_TOKEN_INVALID",
                    message: "The Telegram login link is invalid",
                    statusCode: 404,
                  };
        return reply.code(error.statusCode).send(
          createErrorEnvelope({
            code: error.code,
            message: error.message,
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      setBrowserSessionCookie(reply, result.login.session);
      const decision = authorizeAccount({
        accountStatus: result.login.account.status,
        maintenance: options.maintenance,
        region: options.regionPolicy(request),
        role: result.login.account.role,
      });
      if (!decision.allowed) {
        return reply.code(decision.statusCode).send(
          createErrorEnvelope({
            code: decision.code,
            message: decision.message,
            requestId: request.id,
            retryable: decision.retryable,
          }),
        );
      }

      const user = accountToSessionView(result.login.account, decision.maintenanceBypass);
      return createSuccessEnvelope(
        { confirmed: true, session: user, status: "consumed" as const },
        request.id,
      );
    },
  );

  app.post<{ Params: { token: string } }>(
    "/api/auth/login-token/:token/cancel",
    {
      config: {
        rateLimit: { max: authRateLimits.cancel, timeWindow: authRateLimits.timeWindowMs },
      },
    },
    async (request, reply) => {
      if (!telegramBotConfigured(options)) {
        return reply.code(503).send(
          createErrorEnvelope({
            code: "TELEGRAM_BOT_UNAVAILABLE",
            message: "Telegram Bot login is not configured",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      const result = await options.telegramBot.cancel(request.params.token, request.id);
      if (result.status === "cancelled") {
        return createSuccessEnvelope({ status: "cancelled" as const }, request.id);
      }
      const error =
        result.status === "expired"
          ? {
              code: "LOGIN_TOKEN_EXPIRED",
              message: "The Telegram login link has expired",
              statusCode: 410,
            }
          : result.status === "consumed"
            ? {
                code: "LOGIN_TOKEN_CONSUMED",
                message: "The Telegram login link was already used",
                statusCode: 409,
              }
            : {
                code: "LOGIN_TOKEN_INVALID",
                message: "The Telegram login link is invalid",
                statusCode: 404,
              };
      return reply.code(error.statusCode).send(
        createErrorEnvelope({
          code: error.code,
          message: error.message,
          requestId: request.id,
          retryable: false,
        }),
      );
    },
  );

    if (options.testRoutes) {
    const authenticateTestRequest = async (request: FastifyRequest) => {
      const token = sessionToken(request);
      if (!token) return { kind: "unauthenticated" as const, code: "UNAUTHENTICATED" };
      const resolved = await findValidSession(token, options.sessionStore, now());
      if (!resolved) return { kind: "unauthenticated" as const, code: "AUTH_EXPIRED" };

      const decision = authorizeAccount({
        accountStatus: resolved.session.account.status,
        maintenance: options.maintenance,
        region: options.regionPolicy(request),
        role: resolved.session.account.role,
      });
      if (!decision.allowed) return { kind: "denied" as const, decision };
      return { kind: "allowed" as const, session: resolved.session };
    };

    app.get<{ Params: { level: string } }>("/__test/guard/:level", async (request, reply) => {
      const authentication = await authenticateTestRequest(request);
      if (authentication.kind === "unauthenticated") {
        return reply.code(401).send(
          createErrorEnvelope({
            code: authentication.code,
            message:
              authentication.code === "AUTH_EXPIRED"
                ? "Session is invalid or expired"
                : "Authentication is required",
            requestId: request.id,
            retryable: false,
          }),
        );
      }
      if (authentication.kind === "denied") {
        return reply.code(authentication.decision.statusCode).send(
          createErrorEnvelope({
            code: authentication.decision.code,
            message: authentication.decision.message,
            requestId: request.id,
            retryable: authentication.decision.retryable,
          }),
        );
      }
      const { session } = authentication;

      const level = request.params.level;
      const validLevel =
        level === "authenticated" || level === "pro" || level === "admin"
          ? (level satisfies AccessLevel)
          : null;
      if (!roleCanAccess(session.account.role, validLevel)) {
        return reply.code(403).send(
          createErrorEnvelope({
            code: "FORBIDDEN",
            message: "This role cannot access the requested resource",
            requestId: request.id,
            retryable: false,
          }),
        );
      }

      return createSuccessEnvelope({ level }, request.id);
    });

    app.get<{ Params: { ownerUserId: string } }>(
      "/__test/owned/:ownerUserId",
      async (request, reply) => {
        const authentication = await authenticateTestRequest(request);
        if (authentication.kind === "unauthenticated") {
          return reply.code(401).send(
            createErrorEnvelope({
              code: authentication.code,
              message:
                authentication.code === "AUTH_EXPIRED"
                  ? "Session is invalid or expired"
                  : "Authentication is required",
              requestId: request.id,
              retryable: false,
            }),
          );
        }
        if (authentication.kind === "denied") {
          return reply.code(authentication.decision.statusCode).send(
            createErrorEnvelope({
              code: authentication.decision.code,
              message: authentication.decision.message,
              requestId: request.id,
              retryable: authentication.decision.retryable,
            }),
          );
        }
        const { session } = authentication;

        if (
          !canAccessOwnedResource(
            session.userId,
            request.params.ownerUserId,
            session.account.role,
            false,
          )
        ) {
          return reply.code(403).send(
            createErrorEnvelope({
              code: "FORBIDDEN",
              message: "The requested resource is outside the authorized scope",
              requestId: request.id,
              retryable: false,
            }),
          );
        }

        return createSuccessEnvelope({ value: "fixture-resource" }, request.id);
      },
    );
    }
  });

  return app;
}
