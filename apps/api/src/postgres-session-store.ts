import type {
  AccessAuditEvent,
  NewStoredSession,
  SessionStore,
  StoredAccountStatus,
  StoredRole,
  StoredSession,
  StoredTier,
} from "@lpbot/security";
import type { Pool } from "pg";

interface SessionRow {
  allowed_chain_ids: number[];
  avatar_url: string | null;
  created_at: Date;
  display_name: string | null;
  expires_at: Date;
  id: string;
  last_seen_at: Date | null;
  revoked_at: Date | null;
  role: StoredRole;
  status: StoredAccountStatus;
  tier: StoredTier;
  token_hash: string;
  user_id: string;
}

export class PostgresSessionStore implements SessionStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createSession(session: NewStoredSession): Promise<void> {
    await this.#pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, decode($3, 'hex'), $4, $5)`,
      [session.id, session.userId, session.tokenHash, session.createdAt, session.expiresAt],
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.#pool.query<SessionRow>(
      `SELECT s.id::text,
              s.user_id::text,
              encode(s.token_hash, 'hex') AS token_hash,
              s.created_at,
              s.expires_at,
              s.last_seen_at,
              s.revoked_at,
              u.role,
              u.tier,
              u.status,
              u.allowed_chain_ids,
              u.display_name,
              u.avatar_url
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = decode($1, 'hex')`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      account: {
        allowedChainIds: row.allowed_chain_ids,
        avatarUrl: row.avatar_url,
        displayName: row.display_name,
        id: row.user_id,
        role: row.role,
        status: row.status,
        tier: row.tier,
      },
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      id: row.id,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      tokenHash: row.token_hash,
      userId: row.user_id,
    };
  }

  async recordAccessAudit(event: AccessAuditEvent): Promise<void> {
    await this.#pool.query(
      `INSERT INTO access_audit_events (
         user_id, session_id, action, outcome, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.userId,
        event.sessionId,
        event.action,
        event.outcome,
        event.requestId,
        event.createdAt,
      ],
    );
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE sessions
          SET revoked_at = $2
        WHERE token_hash = decode($1, 'hex')
          AND revoked_at IS NULL`,
      [tokenHash, revokedAt],
    );
    return result.rowCount === 1;
  }

  async touchSession(tokenHash: string, lastSeenAt: Date): Promise<void> {
    await this.#pool.query(
      `UPDATE sessions
          SET last_seen_at = $2
        WHERE token_hash = decode($1, 'hex')
          AND revoked_at IS NULL`,
      [tokenHash, lastSeenAt],
    );
  }
}
