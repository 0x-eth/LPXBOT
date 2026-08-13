import cookie from "@fastify/cookie";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  type SessionView,
} from "@lpbot/api-contract";
import { authorizeAccount, type AccountAccessContext } from "@lpbot/domain";
import { hashSessionToken, type SessionStore, type StoredSession } from "@lpbot/security";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

const sessionCookieName = "lpbot_session";

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
  request: FastifyRequest,
  store: SessionStore,
  now: Date,
): Promise<{ session: StoredSession; tokenHash: string } | null> {
  const token = sessionToken(request);
  if (!token) return null;

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
    disableRequestLogging: true,
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

  app.post("/api/auth/me", async (request, reply) => {
    const resolved = await findValidSession(request, options.sessionStore, now());
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
          code: "AUTH_EXPIRED",
          message: "Session is missing or expired",
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

  return app;
}
