import { createHash } from "node:crypto";

import type {
  MarketProtocol,
  PoolCreationAttribution,
  PoolCreationCreatorProfile,
  PoolCreationProvenanceRecord,
} from "@lpbot/api-contract";
import type { Pool } from "pg";

import {
  canonicalPoolCreationPoolKey,
  canonicalPoolCreationRecord,
  PoolCreationProvenanceConflictError,
  PoolCreationProvenanceValidationError,
  type PoolCreationAdminAuditInput,
  type PoolCreationHistoryPage,
  type PoolCreationProvenanceStore,
  type PoolCreationProvenanceRecordResult,
} from "./pool-creation-provenance.js";

interface ProvenanceRow {
  avatar_url: string | null;
  completed_at: Date;
  creator_address: `0x${string}` | null;
  display_name: string | null;
  fee_pips: string;
  id: string;
  operation_id: string;
  outcome: "already_exists" | "created";
  payload_sha256: `sha256:${string}`;
  pool_key: `56:0x${string}`;
  profile_user_id: string | null;
  protocol: MarketProtocol;
  schema_version: number;
  telegram_id: string | null;
  tx_hash: `0x${string}` | null;
  user_id: string;
}

interface RequestedProvenanceRow extends ProvenanceRow {
  requested_pool_key: string;
}

interface PageCursor {
  completedAt: string;
  id: string;
}

const provenanceColumns = `
  provenance.id::text,
  provenance.operation_id::text,
  provenance.user_id::text,
  provenance.pool_key,
  provenance.protocol,
  provenance.creator_address,
  provenance.fee_pips::text,
  provenance.tx_hash,
  provenance.outcome,
  provenance.completed_at,
  provenance.schema_version,
  provenance.payload_sha256,
  profile.id::text AS profile_user_id,
  profile.display_name,
  profile.avatar_url,
  telegram.telegram_user_id::text AS telegram_id`;

function payloadHash(record: PoolCreationProvenanceRecord): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(record)).digest("hex")}`;
}

function rowRecord(row: ProvenanceRow): PoolCreationProvenanceRecord {
  return canonicalPoolCreationRecord({
    chainId: 56,
    completedAt: row.completed_at.toISOString(),
    creatorAddress: row.creator_address,
    feePips: row.fee_pips,
    operationId: row.operation_id,
    outcome: row.outcome,
    poolKey: row.pool_key,
    protocol: row.protocol,
    schemaVersion: row.schema_version,
    txHash: row.tx_hash,
    userId: row.user_id,
  });
}

function rowAttribution(row: ProvenanceRow): PoolCreationAttribution {
  const creatorProfile: PoolCreationCreatorProfile | null = row.profile_user_id
    ? {
        avatarUrl: row.avatar_url,
        displayName: row.display_name,
        telegramId: row.telegram_id,
      }
    : null;
  return {
    creatorProfile,
    record: rowRecord(row),
    warning: row.outcome === "already_exists" ? "ALREADY_EXISTS_NOT_PLATFORM_FIRST" : null,
  };
}

function encodeCursor(row: ProvenanceRow): string {
  const value: PageCursor = { completedAt: row.completed_at.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | null): PageCursor | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    const cursor = parsed as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(",") !== "completedAt,id" ||
      typeof cursor.completedAt !== "string" ||
      new Date(cursor.completedAt).toISOString() !== cursor.completedAt ||
      typeof cursor.id !== "string" ||
      !/^[1-9][0-9]*$/u.test(cursor.id)
    ) {
      throw new Error();
    }
    return { completedAt: cursor.completedAt, id: cursor.id };
  } catch {
    throw new PoolCreationProvenanceValidationError("Pool creation history cursor is invalid");
  }
}

function differingFields(
  existing: PoolCreationProvenanceRecord,
  attempted: PoolCreationProvenanceRecord,
): string[] {
  return Object.keys(existing).filter(
    (key) =>
      existing[key as keyof PoolCreationProvenanceRecord] !==
      attempted[key as keyof PoolCreationProvenanceRecord],
  );
}

export class PostgresPoolCreationProvenanceStore implements PoolCreationProvenanceStore {
  readonly #pool: Pool;
  readonly #now: () => Date;

  constructor(pool: Pool, options: { now?: () => Date } = {}) {
    this.#pool = pool;
    this.#now = options.now ?? (() => new Date());
  }

  async record(input: PoolCreationProvenanceRecord): Promise<PoolCreationProvenanceRecordResult> {
    const record = canonicalPoolCreationRecord(input);
    const attemptedHash = payloadHash(record);
    const recordedAt = this.#now();
    if (recordedAt.getTime() < Date.parse(record.completedAt)) {
      throw new PoolCreationProvenanceValidationError(
        "Pool creation completion cannot be later than ledger recording",
      );
    }
    const inserted = await this.#pool.query<{ operation_id: string }>(
      `INSERT INTO pool_creation_provenance (
         operation_id, user_id, chain_id, pool_key, protocol, creator_address,
         fee_pips, tx_hash, outcome, completed_at, schema_version, payload_sha256, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (operation_id) DO NOTHING
       RETURNING operation_id::text`,
      [
        record.operationId,
        record.userId,
        record.chainId,
        record.poolKey,
        record.protocol,
        record.creatorAddress,
        record.feePips,
        record.txHash,
        record.outcome,
        record.completedAt,
        record.schemaVersion,
        attemptedHash,
        recordedAt,
      ],
    );
    if (inserted.rowCount === 1) return { record, status: "inserted" };

    const existingResult = await this.#pool.query<ProvenanceRow>(
      `SELECT ${provenanceColumns}
         FROM pool_creation_provenance AS provenance
         LEFT JOIN users AS profile ON profile.id = provenance.user_id
         LEFT JOIN telegram_identities AS telegram ON telegram.user_id = profile.id
        WHERE provenance.operation_id = $1`,
      [record.operationId],
    );
    const existingRow = existingResult.rows[0];
    if (!existingRow) throw new Error("Conflicting provenance operation disappeared");
    const existing = rowRecord(existingRow);
    if (JSON.stringify(existing) === JSON.stringify(record)) {
      return { record: existing, status: "idempotent" };
    }

    const mismatchFields = differingFields(existing, record);
    await this.#pool.query(
      `INSERT INTO pool_creation_provenance_conflicts (
         operation_id, existing_payload_sha256, attempted_payload_sha256,
         mismatch_fields, observed_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [record.operationId, existingRow.payload_sha256, attemptedHash, mismatchFields, recordedAt],
    );
    throw new PoolCreationProvenanceConflictError(record.operationId);
  }

  async listByUser(input: {
    cursor: string | null;
    limit: number;
    userId: string;
  }): Promise<PoolCreationHistoryPage> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new PoolCreationProvenanceValidationError();
    }
    const cursor = decodeCursor(input.cursor);
    const result = await this.#pool.query<ProvenanceRow>(
      `SELECT ${provenanceColumns}
         FROM pool_creation_provenance AS provenance
         LEFT JOIN users AS profile ON profile.id = provenance.user_id
         LEFT JOIN telegram_identities AS telegram ON telegram.user_id = profile.id
        WHERE provenance.user_id = $1
          AND (
            $2::timestamptz IS NULL
            OR (provenance.completed_at, provenance.id) < ($2::timestamptz, $3::bigint)
          )
        ORDER BY provenance.completed_at DESC, provenance.id DESC
        LIMIT $4`,
      [input.userId, cursor?.completedAt ?? null, cursor?.id ?? null, input.limit + 1],
    );
    const hasMore = result.rows.length > input.limit;
    const rows = result.rows.slice(0, input.limit);
    return {
      items: rows.map(rowAttribution),
      nextCursor: hasMore && rows.length > 0 ? encodeCursor(rows.at(-1)!) : null,
    };
  }

  async findAttribution(poolKey: string): Promise<PoolCreationAttribution | null> {
    return (
      (await this.findAttributions([poolKey])).get(canonicalPoolCreationPoolKey(poolKey)) ?? null
    );
  }

  async findAttributions(
    poolKeys: readonly string[],
  ): Promise<ReadonlyMap<string, PoolCreationAttribution | null>> {
    const canonical = poolKeys.map(canonicalPoolCreationPoolKey);
    if (new Set(canonical).size !== canonical.length || canonical.length > 100) {
      throw new PoolCreationProvenanceValidationError();
    }
    if (canonical.length === 0) return new Map();
    const result = await this.#pool.query<RequestedProvenanceRow>(
      `WITH requested AS (
         SELECT pool_key, ordinal
           FROM unnest($1::text[]) WITH ORDINALITY AS item(pool_key, ordinal)
       ), ranked AS (
         SELECT provenance.*,
                row_number() OVER (
                  PARTITION BY provenance.pool_key
                  ORDER BY
                    CASE WHEN provenance.outcome = 'created' THEN 0 ELSE 1 END,
                    provenance.completed_at ASC,
                    provenance.id ASC
                ) AS attribution_rank
           FROM pool_creation_provenance AS provenance
          WHERE provenance.pool_key = ANY($1::text[])
       )
       SELECT requested.pool_key AS requested_pool_key,
              ${provenanceColumns}
         FROM requested
         LEFT JOIN ranked AS provenance
           ON provenance.pool_key = requested.pool_key AND provenance.attribution_rank = 1
         LEFT JOIN users AS profile ON profile.id = provenance.user_id
         LEFT JOIN telegram_identities AS telegram ON telegram.user_id = profile.id
        ORDER BY requested.ordinal`,
      [canonical],
    );
    return new Map(
      result.rows.map((row) => [
        row.requested_pool_key,
        row.operation_id === null ? null : rowAttribution(row),
      ]),
    );
  }

  async recordAdminQueryAudit(input: PoolCreationAdminAuditInput): Promise<void> {
    await this.#pool.query(
      `INSERT INTO pool_creator_query_audit_events (
         actor_user_id, session_id, action, outcome, result_code,
         identity_count, identity_digest, request_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.actorUserId,
        input.sessionId,
        input.action,
        input.outcome,
        input.resultCode,
        input.identityCount,
        input.identityDigest,
        input.requestId,
        input.createdAt,
      ],
    );
  }
}
