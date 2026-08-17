import { createHash, randomUUID } from "node:crypto";

import type { Condition, CreateMonitorRequest, Monitor, PatchMonitorChanges } from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import type {
  MonitorCreateInput,
  MonitorCreateResult,
  MonitorDeleteInput,
  MonitorDeleteResult,
  MonitorLifecycleInput,
  MonitorListQuery,
  MonitorMutationResult,
  MonitorPatchInput,
  MonitorStore,
} from "./monitors.js";

interface MonitorRow extends QueryResultRow {
  condition_count: number;
  conditions: unknown;
  created_at: Date;
  disabled_at: Date | null;
  enabled_at: Date | null;
  enabled_condition_count: number;
  exclude_han_token: boolean;
  exclude_hook: boolean;
  monitor_id: string;
  name: string;
  pool_key: string;
  revision: string;
  status: "disabled" | "enabled";
  updated_at: Date;
  user_id: string;
  window_minutes: number;
}

interface IdempotencyRow extends QueryResultRow {
  monitor_id: string;
  payload_hash: string;
}

interface CountRow extends QueryResultRow {
  enabled_count: string;
  total_count: string;
}

interface Queryable {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export interface PostgresMonitorStoreOptions {
  capacity?: number;
  idFactory?: () => string;
}

function payloadHash(request: CreateMonitorRequest): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError(`Stored ${field} is invalid`);
  return parsed;
}

function monitorFromRow(row: MonitorRow): Monitor {
  if (!Array.isArray(row.conditions)) throw new RangeError("Stored monitor conditions are invalid");
  return {
    conditions: structuredClone(row.conditions) as Condition[],
    createdAt: row.created_at.toISOString(),
    disabledAt: row.disabled_at?.toISOString() ?? null,
    enabled: row.status === "enabled",
    enabledAt: row.enabled_at?.toISOString() ?? null,
    excludeHanToken: row.exclude_han_token,
    excludeHook: row.exclude_hook,
    monitorId: row.monitor_id,
    name: row.name,
    poolKey: row.pool_key as Monitor["poolKey"],
    revision: safeInteger(row.revision, "monitor revision"),
    updatedAt: row.updated_at.toISOString(),
    userId: row.user_id,
    windowMinutes: row.window_minutes as Monitor["windowMinutes"],
  };
}

const monitorColumns = `
  monitor_id, user_id, revision::text, name, pool_key, window_minutes, status,
  conditions, condition_count, enabled_condition_count, exclude_han_token, exclude_hook,
  created_at, updated_at, enabled_at, disabled_at`;

export class PostgresMonitorStore implements MonitorStore {
  readonly #capacity: number;
  readonly #idFactory: () => string;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresMonitorStoreOptions = {}) {
    this.#pool = pool;
    this.#capacity = options.capacity ?? 100;
    this.#idFactory = options.idFactory ?? randomUUID;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity < 1 || this.#capacity > 10_000) {
      throw new RangeError("Monitor capacity is invalid");
    }
  }

  async create(input: MonitorCreateInput): Promise<MonitorCreateResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.userId,
      ]);
      const hash = payloadHash(input.request);
      const existing = await client.query<IdempotencyRow>(
        `SELECT payload_hash, monitor_id::text
           FROM monitor_create_idempotency
          WHERE user_id = $1 AND idempotency_key = $2`,
        [input.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].payload_hash !== hash) {
          await client.query("COMMIT");
          return { status: "idempotency-conflict" };
        }
        const monitor = await this.#get(client, input.userId, existing.rows[0].monitor_id);
        if (!monitor) throw new Error("Monitor idempotency record is inconsistent");
        await client.query("COMMIT");
        return { status: "replayed", value: monitor };
      }
      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM monitors WHERE user_id = $1",
        [input.userId],
      );
      if (safeInteger(count.rows[0]?.count ?? "0", "monitor count") >= this.#capacity) {
        await client.query("COMMIT");
        return { status: "capacity" };
      }
      const monitorId = this.#idFactory();
      const conditionCount = input.request.conditions.length;
      const enabledConditionCount = input.request.conditions.filter(({ enabled }) => enabled).length;
      const inserted = await client.query<MonitorRow>(
        `INSERT INTO monitors (
           monitor_id, user_id, revision, name, pool_key, window_minutes, status,
           conditions, condition_count, enabled_condition_count, exclude_han_token,
           exclude_hook, created_at, updated_at, enabled_at, disabled_at
         ) VALUES (
           $1, $2, 1, $3, $4, $5, 'disabled', $6::jsonb, $7, $8, $9, $10,
           $11, $11, NULL, $11
         )
         RETURNING ${monitorColumns}`,
        [
          monitorId,
          input.userId,
          input.request.name,
          input.request.poolKey,
          input.request.windowMinutes,
          JSON.stringify(input.request.conditions),
          conditionCount,
          enabledConditionCount,
          input.request.excludeHanToken,
          input.request.excludeHook,
          input.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO monitor_create_idempotency (
           user_id, idempotency_key, payload_hash, monitor_id, created_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.idempotencyKey, hash, monitorId, input.createdAt],
      );
      await client.query("COMMIT");
      return { status: "created", value: monitorFromRow(inserted.rows[0]!) };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async get(userId: string, monitorId: string): Promise<Monitor | null> {
    return this.#get(this.#pool, userId, monitorId);
  }

  async list(userId: string, query: MonitorListQuery) {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const counts = await client.query<CountRow>(
        `SELECT count(*)::text AS total_count,
                count(*) FILTER (WHERE status = 'enabled')::text AS enabled_count
           FROM monitors
          WHERE user_id = $1`,
        [userId],
      );
      const rows = await client.query<MonitorRow>(
        `SELECT ${monitorColumns}
           FROM monitors
          WHERE user_id = $1
            AND ($2::boolean IS NULL OR status = CASE WHEN $2 THEN 'enabled' ELSE 'disabled' END)
            AND (
              $3::uuid IS NULL
              OR (created_at, monitor_id) < (
                SELECT created_at, monitor_id FROM monitors
                 WHERE user_id = $1 AND monitor_id = $3
              )
            )
          ORDER BY created_at DESC, monitor_id DESC
          LIMIT $4`,
        [userId, query.enabled, query.cursor, query.limit + 1],
      );
      await client.query("COMMIT");
      const count = counts.rows[0] ?? { enabled_count: "0", total_count: "0" };
      const items = rows.rows.slice(0, query.limit).map(monitorFromRow);
      return {
        enabledCount: safeInteger(count.enabled_count, "enabled monitor count"),
        items,
        nextCursor: rows.rows.length > query.limit ? items.at(-1)!.monitorId : null,
        totalCount: safeInteger(count.total_count, "monitor count"),
      };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async patch(input: MonitorPatchInput): Promise<MonitorMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.#locked(client, input.userId, input.monitorId);
      if (!current) return await this.#finish(client, { status: "not-found" });
      if (current.revision !== input.expectedRevision) {
        return await this.#finish(client, { current, status: "conflict" });
      }
      if (
        current.enabled &&
        input.changes.windowMinutes !== undefined &&
        input.changes.windowMinutes !== current.windowMinutes
      ) {
        return await this.#finish(client, { current, status: "invalid" });
      }
      if (!this.#changesValue(current, input.changes)) {
        return await this.#finish(client, { status: "unchanged", value: current });
      }
      const next = { ...current, ...structuredClone(input.changes) };
      const result = await client.query<MonitorRow>(
        `UPDATE monitors
            SET revision = revision + 1,
                name = $3,
                window_minutes = $4,
                conditions = $5::jsonb,
                condition_count = $6,
                enabled_condition_count = $7,
                exclude_han_token = $8,
                exclude_hook = $9,
                updated_at = $10
          WHERE monitor_id = $1 AND user_id = $2
          RETURNING ${monitorColumns}`,
        [
          input.monitorId,
          input.userId,
          next.name,
          next.windowMinutes,
          JSON.stringify(next.conditions),
          next.conditions.length,
          next.conditions.filter(({ enabled }) => enabled).length,
          next.excludeHanToken,
          next.excludeHook,
          input.updatedAt,
        ],
      );
      return await this.#finish(client, { status: "updated", value: monitorFromRow(result.rows[0]!) });
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async setEnabled(input: MonitorLifecycleInput): Promise<MonitorMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.#locked(client, input.userId, input.monitorId);
      if (!current) return await this.#finish(client, { status: "not-found" });
      if (current.revision !== input.expectedRevision) {
        return await this.#finish(client, { current, status: "conflict" });
      }
      if (current.enabled === input.enabled) {
        return await this.#finish(client, { status: "unchanged", value: current });
      }
      if (input.enabled && !current.conditions.some(({ enabled }) => enabled)) {
        return await this.#finish(client, { current, status: "not-ready" });
      }
      const result = await client.query<MonitorRow>(
        `UPDATE monitors
            SET revision = revision + 1,
                status = CASE WHEN $3 THEN 'enabled' ELSE 'disabled' END,
                enabled_at = CASE WHEN $3 THEN $4 ELSE enabled_at END,
                disabled_at = CASE WHEN $3 THEN disabled_at ELSE $4 END,
                updated_at = $4
          WHERE monitor_id = $1 AND user_id = $2
          RETURNING ${monitorColumns}`,
        [input.monitorId, input.userId, input.enabled, input.updatedAt],
      );
      return await this.#finish(client, { status: "updated", value: monitorFromRow(result.rows[0]!) });
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(input: MonitorDeleteInput): Promise<MonitorDeleteResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.#locked(client, input.userId, input.monitorId);
      if (!current) return await this.#finish(client, { status: "not-found" });
      if (current.revision !== input.expectedRevision) {
        return await this.#finish(client, { current, status: "conflict" });
      }
      await client.query("DELETE FROM monitors WHERE monitor_id = $1 AND user_id = $2", [
        input.monitorId,
        input.userId,
      ]);
      return await this.#finish(client, { status: "deleted" });
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  #changesValue(current: Monitor, changes: PatchMonitorChanges): boolean {
    return Object.entries(changes).some(
      ([key, value]) => JSON.stringify(current[key as keyof Monitor]) !== JSON.stringify(value),
    );
  }

  async #finish<T>(client: PoolClient, value: T): Promise<T> {
    await client.query("COMMIT");
    return value;
  }

  async #get(queryable: Queryable, userId: string, monitorId: string): Promise<Monitor | null> {
    const result = await queryable.query<MonitorRow>(
      `SELECT ${monitorColumns} FROM monitors WHERE user_id = $1 AND monitor_id = $2`,
      [userId, monitorId],
    );
    return result.rows[0] ? monitorFromRow(result.rows[0]) : null;
  }

  async #locked(client: PoolClient, userId: string, monitorId: string): Promise<Monitor | null> {
    const result = await client.query<MonitorRow>(
      `SELECT ${monitorColumns}
         FROM monitors
        WHERE user_id = $1 AND monitor_id = $2
        FOR UPDATE`,
      [userId, monitorId],
    );
    return result.rows[0] ? monitorFromRow(result.rows[0]) : null;
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the transaction error.
    }
  }
}
