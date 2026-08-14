import type {
  AccessAuditEvent,
  NewStoredSession,
  SessionStore,
  StoredAccount,
  StoredSession,
} from "../../packages/security/src/index.js";
import { SessionIssuer } from "../../packages/security/src/index.js";

export class SessionFixtureStore implements SessionStore {
  readonly audits: AccessAuditEvent[] = [];
  readonly sessions = new Map<string, StoredSession>();

  async createSession(session: NewStoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, {
      ...session,
      account: this.account(session.userId),
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

  private account(userId: string): StoredAccount {
    return {
      allowedChainIds: [1, 56],
      avatarUrl: null,
      displayName: `Fixture ${userId.slice(-4)}`,
      id: userId,
      role: "user",
      status: "active",
      tier: "normal",
    };
  }
}

export async function issueFixtureSession(
  store: SessionFixtureStore,
  userId: string,
  now = new Date("2026-08-14T02:00:00.000Z"),
): Promise<string> {
  const issued = await new SessionIssuer(store, { now: () => now }).issue({
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
    userId,
  });
  return issued.token;
}
