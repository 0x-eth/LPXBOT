import cookie from "@fastify/cookie";
import { createErrorEnvelope, createSuccessEnvelope, type SessionView } from "@lpbot/api-contract";
import {
  authorizeAccount,
  canAccessOwnedResource,
  roleCanAccess,
  type AccessLevel,
  type AccountAccessContext,
} from "@lpbot/domain";
import { hashSessionToken, type SessionStore, type StoredSession } from "@lpbot/security";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { sessionCookieName } from "./browser-session-cookie.js";

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
  logger?: { write(line: string): void };
  maintenance: MaintenanceConfig;
  now?: () => Date;
  regionPolicy(request: FastifyRequest): RegionPolicyResult;
  sessionStore: SessionStore;
  testRoutes?: boolean;
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

function toSessionView(session: StoredSession, maintenanceBypass: boolean): SessionView {
  return {
    allowedChainIds: session.account.allowedChainIds,
    avatarUrl: session.account.avatarUrl,
    displayName: session.account.displayName,
    maintenanceBypass,
    role: session.account.role,
    tier: session.account.tier,
    userId: session.account.id,
  };
}

export function buildApiApp(options: ApiAppOptions): FastifyInstance {
  const now = options.now ?? (() => new Date());
  const app = Fastify({
    logger: false,
  });

  void app.register(cookie);

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

  app.post("/api/auth/me", async (request, reply) => {
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
  });

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

  return app;
}
