import { poolBlocklistMaxEntries, type PoolBlocklistEntry } from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import {
  createPoolBlocklistSnapshot,
  defaultPoolBlocklistSnapshot,
  type PoolBlocklistMutationInput,
  type PoolBlocklistMutationResult,
  type PoolBlocklistStore,
} from "./pool-blocklist.js";

interface SnapshotRow extends QueryResultRow {
  entries: unknown;
  revision: string;
  updated_at: Date | null;
}

interface RevisionRow extends QueryResultRow {
  revision: string;
}

interface Queryable {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export interface PostgresPoolBlocklistStoreOptions {
  maxEntries?: number;
}

export class PostgresPoolBlocklistStore implements PoolBlocklistStore {
  readonly #maxEntries: number;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresPoolBlocklistStoreOptions = {}) {
    this.#pool = pool;
    this.#maxEntries = options.maxEntries ?? poolBlocklistMaxEntries;
    if (
      !Number.isSafeInteger(this.#maxEntries) ||
      this.#maxEntries < 1 ||
      this.#maxEntries > poolBlocklistMaxEntries
    ) {
      throw new RangeError("Pool blocklist capacity is invalid");
    }
  }

  async get(userId: string) {
    return this.#snapshot(this.#pool, userId);
  }

  async mutate(input: PoolBlocklistMutationInput): Promise<PoolBlocklistMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO user_pool_blocklist_state (
           user_id, schema_version, revision, created_at, updated_at
         ) VALUES ($1, 1, 0, $2, NULL)
         ON CONFLICT (user_id) DO NOTHING`,
        [input.userId, input.updatedAt],
      );
      const locked = await client.query<RevisionRow>(
        `SELECT revision::text
           FROM user_pool_blocklist_state
          WHERE user_id = $1
          FOR UPDATE`,
        [input.userId],
      );
      const currentRevision = this.#revision(locked.rows[0]?.revision);
      if (currentRevision !== input.expectedRevision) {
        const current = await this.#snapshot(client, input.userId);
        await client.query("COMMIT");
        return { current, status: "conflict" };
      }

      const entry = input.operation.entry;
      const existing = await client.query(
        `SELECT 1
           FROM user_pool_blocklist_entries
          WHERE user_id = $1 AND chain_id = $2 AND scope = $3 AND identity = $4`,
        [input.userId, entry.chainId, entry.scope, entry.identity],
      );
      const exists = existing.rowCount === 1;
      if (
        (input.operation.type === "block" && exists) ||
        (input.operation.type === "restore" && !exists)
      ) {
        const value = await this.#snapshot(client, input.userId);
        await client.query("COMMIT");
        return { status: "unchanged", value };
      }

      if (input.operation.type === "block") {
        const count = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM user_pool_blocklist_entries
            WHERE user_id = $1`,
          [input.userId],
        );
        if (Number(count.rows[0]?.count) >= this.#maxEntries) {
          const current = await this.#snapshot(client, input.userId);
          await client.query("COMMIT");
          return { current, status: "capacity" };
        }
        await client.query(
          `INSERT INTO user_pool_blocklist_entries (
             user_id, chain_id, scope, identity, label, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [
            input.userId,
            entry.chainId,
            entry.scope,
            entry.identity,
            "label" in entry ? entry.label : null,
            input.updatedAt,
          ],
        );
      } else {
        await client.query(
          `DELETE FROM user_pool_blocklist_entries
            WHERE user_id = $1 AND chain_id = $2 AND scope = $3 AND identity = $4`,
          [input.userId, entry.chainId, entry.scope, entry.identity],
        );
      }

      await client.query(
        `UPDATE user_pool_blocklist_state
            SET revision = revision + 1,
                updated_at = $2
          WHERE user_id = $1`,
        [input.userId, input.updatedAt],
      );
      const value = await this.#snapshot(client, input.userId);
      await client.query("COMMIT");
      return { status: "updated", value };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
  }

  #revision(value: string | undefined): number {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new RangeError("Stored pool blocklist revision is invalid");
    }
    return revision;
  }

  async #snapshot(queryable: Queryable, userId: string) {
    const result = await queryable.query<SnapshotRow>(
      `SELECT state.revision::text,
              state.updated_at,
              COALESCE(
                jsonb_agg(
                  jsonb_strip_nulls(jsonb_build_object(
                    'chainId', entry.chain_id,
                    'identity', entry.identity,
                    'label', entry.label,
                    'scope', entry.scope
                  ))
                  ORDER BY entry.chain_id, entry.scope, entry.identity
                ) FILTER (WHERE entry.identity IS NOT NULL),
                '[]'::jsonb
              ) AS entries
         FROM user_pool_blocklist_state AS state
         LEFT JOIN user_pool_blocklist_entries AS entry ON entry.user_id = state.user_id
        WHERE state.user_id = $1
        GROUP BY state.user_id, state.revision, state.updated_at`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return defaultPoolBlocklistSnapshot();
    if (!Array.isArray(row.entries)) throw new RangeError("Stored pool blocklist entries are invalid");
    return createPoolBlocklistSnapshot({
      entries: row.entries as PoolBlocklistEntry[],
      revision: this.#revision(row.revision),
      updatedAt: row.updated_at,
    });
  }
}
