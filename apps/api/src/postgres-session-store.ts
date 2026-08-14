import type {
  AccessAuditEvent,
  BotLoginIntent,
  ConfirmBotLoginIntentInput,
  ConsumeBotLoginIntentInput,
  InitDataReplay,
  NewBotLoginIntent,
  NewStoredSession,
  ResolveTelegramIdentityInput,
  SessionStore,
  StoredAccount,
  StoredAccountStatus,
  StoredRole,
  StoredSession,
  StoredTier,
  TelegramBotLoginStore,
  TelegramMiniAppStore,
} from "@lpbot/security";
import type { Pool, PoolClient } from "pg";

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

interface AccountRow {
  allowed_chain_ids: number[];
  avatar_url: string | null;
  display_name: string | null;
  id: string;
  role: StoredRole;
  status: StoredAccountStatus;
  tier: StoredTier;
}

interface BotLoginIntentRow {
  allowed_chain_ids: number[] | null;
  avatar_url: string | null;
  cancelled_at: Date | null;
  confirmed_at: Date | null;
  consumed_at: Date | null;
  created_at: Date;
  display_name: string | null;
  expires_at: Date;
  id: string;
  role: StoredRole | null;
  status: BotLoginIntent["status"];
  tier: StoredTier | null;
  token_hash: string;
  user_id: string | null;
  user_status: StoredAccountStatus | null;
}

function toStoredAccount(row: AccountRow): StoredAccount {
  return {
    allowedChainIds: row.allowed_chain_ids,
    avatarUrl: row.avatar_url,
    displayName: row.display_name,
    id: row.id,
    role: row.role,
    status: row.status,
    tier: row.tier,
  };
}

function toBotLoginIntent(row: BotLoginIntentRow): BotLoginIntent {
  const account =
    row.user_id && row.role && row.tier && row.user_status && row.allowed_chain_ids
      ? {
          allowedChainIds: row.allowed_chain_ids,
          avatarUrl: row.avatar_url,
          displayName: row.display_name,
          id: row.user_id,
          role: row.role,
          status: row.user_status,
          tier: row.tier,
        }
      : null;
  return {
    account,
    cancelledAt: row.cancelled_at,
    confirmedAt: row.confirmed_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    status: row.status,
    tokenHash: row.token_hash,
    userId: row.user_id,
  };
}

export class PostgresSessionStore
  implements SessionStore, TelegramMiniAppStore, TelegramBotLoginStore
{
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async cancelBotLoginIntent(tokenHash: string, at: Date): Promise<BotLoginIntent | null> {
    return this.#transaction(async (client) => {
      await this.#lockBotLoginIntent(client, tokenHash);
      await this.#expireBotLoginIntent(client, tokenHash, at);
      await client.query(
        `UPDATE telegram_bot_login_intents
            SET status = 'cancelled', cancelled_at = $2
          WHERE token_hash = decode($1, 'hex')
            AND status IN ('pending', 'confirmed')`,
        [tokenHash, at],
      );
      return this.#findBotLoginIntent(client, tokenHash);
    });
  }

  async confirmBotLoginIntent(input: ConfirmBotLoginIntentInput): Promise<BotLoginIntent | null> {
    return this.#transaction(async (client) => {
      await this.#lockBotLoginIntent(client, input.tokenHash);
      await this.#expireBotLoginIntent(client, input.tokenHash, input.confirmedAt);
      const current = await this.#findBotLoginIntent(client, input.tokenHash);
      if (!current || current.status !== "pending") return current;

      const account = await this.#resolveTelegramIdentity(client, {
        candidateUserId: input.candidateUserId,
        createdAt: input.confirmedAt,
        subject: input.subject,
      });
      await client.query(
        `UPDATE telegram_bot_login_intents
            SET status = 'confirmed', user_id = $2, confirmed_at = $3
          WHERE token_hash = decode($1, 'hex')
            AND status = 'pending'`,
        [input.tokenHash, account.id, input.confirmedAt],
      );
      return this.#findBotLoginIntent(client, input.tokenHash);
    });
  }

  async consumeConfirmedBotLoginIntent(input: ConsumeBotLoginIntentInput): Promise<boolean> {
    return this.#transaction(async (client) => {
      await this.#lockBotLoginIntent(client, input.tokenHash);
      await this.#expireBotLoginIntent(client, input.tokenHash, input.consumedAt);
      const consumed = await client.query<{ user_id: string }>(
        `UPDATE telegram_bot_login_intents
            SET status = 'consumed', consumed_at = $2
          WHERE token_hash = decode($1, 'hex')
            AND status = 'confirmed'
            AND user_id = $3
          RETURNING user_id::text`,
        [input.tokenHash, input.consumedAt, input.session.userId],
      );
      if (consumed.rowCount !== 1) return false;

      await client.query(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, decode($3, 'hex'), $4, $5)`,
        [
          input.session.id,
          input.session.userId,
          input.session.tokenHash,
          input.session.createdAt,
          input.session.expiresAt,
        ],
      );
      return true;
    });
  }

  async consumeInitDataReplay(replay: InitDataReplay): Promise<boolean> {
    const result = await this.#pool.query(
      `INSERT INTO telegram_init_data_replays (digest, consumed_at)
       VALUES (decode($1, 'hex'), $2)
       ON CONFLICT (digest) DO NOTHING`,
      [replay.digest, replay.consumedAt],
    );
    return result.rowCount === 1;
  }

  async createBotLoginIntent(intent: NewBotLoginIntent): Promise<void> {
    await this.#pool.query(
      `INSERT INTO telegram_bot_login_intents (
         id, token_hash, status, created_at, expires_at
       ) VALUES ($1, decode($2, 'hex'), 'pending', $3, $4)`,
      [intent.id, intent.tokenHash, intent.createdAt, intent.expiresAt],
    );
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

  async findBotLoginIntent(tokenHash: string, at: Date): Promise<BotLoginIntent | null> {
    return this.#transaction(async (client) => {
      await this.#expireBotLoginIntent(client, tokenHash, at);
      return this.#findBotLoginIntent(client, tokenHash);
    });
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

  async resolveTelegramIdentity(input: ResolveTelegramIdentityInput): Promise<StoredAccount> {
    return this.#transaction((client) => this.#resolveTelegramIdentity(client, input));
  }

  async #expireBotLoginIntent(client: PoolClient, tokenHash: string, at: Date): Promise<void> {
    await client.query(
      `UPDATE telegram_bot_login_intents
          SET status = 'expired'
        WHERE token_hash = decode($1, 'hex')
          AND status IN ('pending', 'confirmed')
          AND expires_at <= $2`,
      [tokenHash, at],
    );
  }

  async #findBotLoginIntent(client: PoolClient, tokenHash: string): Promise<BotLoginIntent | null> {
    const result = await client.query<BotLoginIntentRow>(
      `SELECT i.id::text,
              encode(i.token_hash, 'hex') AS token_hash,
              i.status,
              i.user_id::text,
              i.created_at,
              i.expires_at,
              i.confirmed_at,
              i.consumed_at,
              i.cancelled_at,
              u.role,
              u.tier,
              u.status AS user_status,
              u.allowed_chain_ids,
              u.display_name,
              u.avatar_url
         FROM telegram_bot_login_intents i
         LEFT JOIN users u ON u.id = i.user_id
        WHERE i.token_hash = decode($1, 'hex')`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? toBotLoginIntent(row) : null;
  }

  async #lockBotLoginIntent(client: PoolClient, tokenHash: string): Promise<void> {
    await client.query(
      `SELECT id
         FROM telegram_bot_login_intents
        WHERE token_hash = decode($1, 'hex')
        FOR UPDATE`,
      [tokenHash],
    );
  }

  async #resolveTelegramIdentity(
    client: PoolClient,
    input: ResolveTelegramIdentityInput,
  ): Promise<StoredAccount> {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [input.subject]);
    const existing = await client.query<AccountRow>(
      `SELECT u.id::text,
              u.role,
              u.tier,
              u.status,
              u.allowed_chain_ids,
              u.display_name,
              u.avatar_url
         FROM telegram_identities ti
         JOIN users u ON u.id = ti.user_id
        WHERE ti.telegram_user_id = $1`,
      [input.subject],
    );
    const row = existing.rows[0];
    if (row) return toStoredAccount(row);

    await client.query(
      `INSERT INTO users (
         id, role, tier, status, allowed_chain_ids, display_name, avatar_url, created_at, updated_at
       ) VALUES ($1, 'user', 'normal', 'pending', '{}', NULL, NULL, $2, $2)`,
      [input.candidateUserId, input.createdAt],
    );
    await client.query(
      `INSERT INTO telegram_identities (telegram_user_id, user_id, created_at)
       VALUES ($1, $2, $3)`,
      [input.subject, input.candidateUserId, input.createdAt],
    );
    return {
      allowedChainIds: [],
      avatarUrl: null,
      displayName: null,
      id: input.candidateUserId,
      role: "user",
      status: "pending",
      tier: "normal",
    };
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
