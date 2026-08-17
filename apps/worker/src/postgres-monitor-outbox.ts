import type { MonitorCandidate } from "@lpbot/domain/monitor-evaluator";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  candidateEvidenceDecision,
  notificationDedupeKey,
  outboxRetryDelaySeconds,
  type MonitorDestinationSelection,
  type NotificationOutboxState,
} from "./monitoring.js";

export interface MonitorOutboxDestination extends MonitorDestinationSelection {
  payload: Record<string, unknown>;
}

export interface CommitMonitorCandidateInput {
  candidate: MonitorCandidate;
  destinations: MonitorOutboxDestination[];
}

export type CandidateEvidenceAction =
  | "inserted"
  | "unchanged"
  | "replaced"
  | "deferred"
  | "suppressed";

export interface NotificationOutboxDelivery {
  attemptCount: number;
  candidateKey: string;
  channel: MonitorDestinationSelection["channel"];
  createdAt: string;
  dedupeKey: string;
  deliveryId: string;
  destinationId: string;
  destinationRevision: number;
  lastErrorCode: string | null;
  leaseExpiresAt: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  nextAttemptAt: string | null;
  payload: Record<string, unknown>;
  state: NotificationOutboxState;
  updatedAt: string;
}

export interface CommitMonitorCandidateResult {
  candidateKey: string;
  deliveries: NotificationOutboxDelivery[];
  evidenceAction: CandidateEvidenceAction;
}

interface CandidateRow extends QueryResultRow {
  generated_at: Date;
  monitor_id: string;
  monitor_revision: string;
  pool_key: string;
  source_generation_id: string;
  user_id: string;
}

interface StateRow extends QueryResultRow {
  effective_state: NotificationOutboxState;
}

interface DeliveryRow extends QueryResultRow {
  attempt_count: number;
  candidate_key: string;
  channel: MonitorDestinationSelection["channel"];
  created_at: Date;
  dedupe_key: string;
  delivery_id: string;
  destination_id: string;
  destination_revision: string;
  last_error_code: string | null;
  lease_expires_at: Date | null;
  lease_owner: string | null;
  lease_token: string | null;
  next_attempt_at: Date | null;
  payload: unknown;
  state: NotificationOutboxState;
  updated_at: Date;
}

const deliveryColumns = `
  delivery_id::text, dedupe_key, candidate_key, destination_id,
  destination_revision::text, channel, payload, state, attempt_count,
  next_attempt_at, lease_owner, lease_token::text, lease_expires_at,
  created_at, updated_at, last_error_code`;

const claimedDeliveryColumns = `
  outbox.delivery_id::text, outbox.dedupe_key, outbox.candidate_key,
  outbox.destination_id, outbox.destination_revision::text, outbox.channel,
  outbox.payload, outbox.state, outbox.attempt_count, outbox.next_attempt_at,
  outbox.lease_owner, outbox.lease_token::text, outbox.lease_expires_at,
  outbox.created_at, outbox.updated_at, outbox.last_error_code`;

const forbiddenPayloadFields = new Set([
  "apikey",
  "authorization",
  "bottoken",
  "credential",
  "notificationkey",
  "secret",
  "secretref",
  "token",
  "webhooksecret",
]);

function assertCredentialFree(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) throw new RangeError("OUTBOX_PAYLOAD_INVALID");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertCredentialFree(child, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenPayloadFields.has(key.toLowerCase())) {
      throw new RangeError("OUTBOX_SECRET_FIELD_FORBIDDEN");
    }
    assertCredentialFree(child, seen);
  }
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError(`Stored ${field} is invalid`);
  return parsed;
}

function deliveryFromRow(row: DeliveryRow): NotificationOutboxDelivery {
  if (typeof row.payload !== "object" || row.payload === null || Array.isArray(row.payload)) {
    throw new RangeError("Stored outbox payload is invalid");
  }
  return {
    attemptCount: row.attempt_count,
    candidateKey: row.candidate_key,
    channel: row.channel,
    createdAt: row.created_at.toISOString(),
    dedupeKey: row.dedupe_key,
    deliveryId: row.delivery_id,
    destinationId: row.destination_id,
    destinationRevision: safeInteger(row.destination_revision, "destination revision"),
    lastErrorCode: row.last_error_code,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
    payload: structuredClone(row.payload) as Record<string, unknown>,
    state: row.state,
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresMonitorCandidateOutboxRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async commitCandidate(input: CommitMonitorCandidateInput): Promise<CommitMonitorCandidateResult> {
    for (const destination of input.destinations) assertCredentialFree(destination.payload);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.candidate.candidateKey,
      ]);
      const existing = await client.query<CandidateRow>(
        `SELECT monitor_id::text, user_id::text, monitor_revision::text, pool_key,
                generated_at, source_generation_id
           FROM monitor_candidates
          WHERE candidate_key = $1
          FOR UPDATE`,
        [input.candidate.candidateKey],
      );
      let evidenceAction: CandidateEvidenceAction;
      if (!existing.rows[0]) {
        await this.#insertCandidate(client, input.candidate);
        evidenceAction = "inserted";
      } else {
        const current = existing.rows[0];
        if (
          current.monitor_id !== input.candidate.monitorId ||
          current.user_id !== input.candidate.userId ||
          safeInteger(current.monitor_revision, "candidate monitor revision") !==
            input.candidate.monitorRevision ||
          current.pool_key !== input.candidate.poolKey
        ) {
          throw new RangeError("CANDIDATE_IDENTITY_CONFLICT");
        }
        const states = await client.query<StateRow>(
          `SELECT CASE
                    WHEN state = 'leased' AND lease_expires_at <= clock_timestamp()
                      THEN 'pending'
                    ELSE state
                  END AS effective_state
             FROM notification_outbox
            WHERE candidate_key = $1`,
          [input.candidate.candidateKey],
        );
        const decision = candidateEvidenceDecision({
          current: {
            generatedAt: current.generated_at.toISOString(),
            sourceGenerationId: current.source_generation_id,
          },
          incoming: {
            generatedAt: input.candidate.generatedAt,
            sourceGenerationId: input.candidate.sourceGenerationId,
          },
          outboxStates: states.rows.map(({ effective_state }) => effective_state),
        });
        evidenceAction =
          decision === "replace"
            ? "replaced"
            : decision === "defer"
              ? "deferred"
              : decision === "suppress"
                ? "suppressed"
                : "unchanged";
        if (evidenceAction === "replaced") {
          await this.#replaceEvidence(client, input.candidate, input.destinations);
        } else if (evidenceAction === "suppressed") {
          await client.query(
            `INSERT INTO monitor_candidate_suppressions (
               candidate_key, attempted_source_generation_id, attempted_generated_at,
               reason, recorded_at
             ) VALUES ($1, $2, $3, 'terminal-outbox', clock_timestamp())
             ON CONFLICT (candidate_key, attempted_source_generation_id) DO NOTHING`,
            [
              input.candidate.candidateKey,
              input.candidate.sourceGenerationId,
              input.candidate.generatedAt,
            ],
          );
        }
      }

      const deliveries: NotificationOutboxDelivery[] = [];
      if (evidenceAction !== "suppressed" && evidenceAction !== "deferred") {
        for (const destination of input.destinations) {
          deliveries.push(await this.#upsertDelivery(client, input.candidate, destination));
        }
      }
      await this.#advanceWatermark(client, input.candidate);
      await client.query("COMMIT");
      return { candidateKey: input.candidate.candidateKey, deliveries, evidenceAction };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimDue(input: {
    leaseOwner: string;
    limit: number;
  }): Promise<NotificationOutboxDelivery[]> {
    if (
      input.leaseOwner.length < 1 ||
      input.leaseOwner.length > 120 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new RangeError("OUTBOX_CLAIM_INVALID");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE notification_outbox
            SET state = 'dead',
                next_attempt_at = NULL,
                lease_owner = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                updated_at = clock_timestamp(),
                last_error_code = 'MAX_ATTEMPTS'
          WHERE attempt_count >= 6
            AND (
              state = 'pending'
              OR (state = 'retry-wait' AND next_attempt_at <= clock_timestamp())
              OR (state = 'leased' AND lease_expires_at <= clock_timestamp())
            )`,
      );
      const claimed = await client.query<DeliveryRow>(
        `WITH due AS (
           SELECT delivery_id
             FROM notification_outbox
            WHERE attempt_count < 6
              AND (
                state = 'pending'
                OR (state = 'retry-wait' AND next_attempt_at <= clock_timestamp())
                OR (state = 'leased' AND lease_expires_at <= clock_timestamp())
              )
            ORDER BY created_at, delivery_id
            FOR UPDATE SKIP LOCKED
            LIMIT $2
         )
         UPDATE notification_outbox AS outbox
            SET state = 'leased',
                attempt_count = outbox.attempt_count + 1,
                next_attempt_at = NULL,
                lease_owner = $1,
                lease_token = gen_random_uuid(),
                lease_expires_at = clock_timestamp() + interval '60 seconds',
                updated_at = clock_timestamp(),
                last_error_code = NULL,
                last_error_summary = NULL
           FROM due
          WHERE outbox.delivery_id = due.delivery_id
          RETURNING ${claimedDeliveryColumns}`,
        [input.leaseOwner, input.limit],
      );
      await client.query("COMMIT");
      return claimed.rows.map(deliveryFromRow);
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(input: { deliveryId: string; leaseToken: string }): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE notification_outbox
          SET state = 'delivered',
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              delivered_at = clock_timestamp(),
              updated_at = clock_timestamp(),
              last_error_code = NULL,
              last_error_summary = NULL
        WHERE delivery_id = $1
          AND state = 'leased'
          AND lease_token = $2
          AND lease_expires_at > clock_timestamp()`,
      [input.deliveryId, input.leaseToken],
    );
    return result.rowCount === 1;
  }

  async markRetry(input: {
    deliveryId: string;
    errorCode: string;
    errorSummary?: string | null;
    leaseToken: string;
    retryAfterSeconds?: number | null;
  }): Promise<boolean> {
    const current = await this.#pool.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM notification_outbox
        WHERE delivery_id = $1 AND state = 'leased' AND lease_token = $2
          AND lease_expires_at > clock_timestamp()`,
      [input.deliveryId, input.leaseToken],
    );
    const row = current.rows[0];
    if (!row) return false;
    const delay = Math.max(
      outboxRetryDelaySeconds(input.deliveryId, row.attempt_count),
      Math.min(3_600, Math.max(0, input.retryAfterSeconds ?? 0)),
    );
    const result = await this.#pool.query(
      `UPDATE notification_outbox
          SET state = 'retry-wait',
              next_attempt_at = clock_timestamp() + make_interval(secs => $3),
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = clock_timestamp(),
              last_error_code = $4,
              last_error_summary = $5
        WHERE delivery_id = $1 AND state = 'leased' AND lease_token = $2
          AND lease_expires_at > clock_timestamp()`,
      [
        input.deliveryId,
        input.leaseToken,
        delay,
        input.errorCode.slice(0, 80),
        input.errorSummary?.slice(0, 240) ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async markDead(input: {
    deliveryId: string;
    errorCode: string;
    errorSummary?: string | null;
    leaseToken: string;
  }): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE notification_outbox
          SET state = 'dead',
              next_attempt_at = NULL,
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = clock_timestamp(),
              last_error_code = $3,
              last_error_summary = $4
        WHERE delivery_id = $1 AND state = 'leased' AND lease_token = $2
          AND lease_expires_at > clock_timestamp()`,
      [
        input.deliveryId,
        input.leaseToken,
        input.errorCode.slice(0, 80),
        input.errorSummary?.slice(0, 240) ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async #insertCandidate(client: PoolClient, candidate: MonitorCandidate): Promise<void> {
    await client.query(
      `INSERT INTO monitor_candidates (
         candidate_key, monitor_id, user_id, monitor_revision, pool_key, window_end,
         generated_at, metric_version, source_generation_id, replaces_generation_id,
         canonical_block_hash, blocklist_hash, matched_conditions, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12::jsonb, $13, $13
       )`,
      [
        candidate.candidateKey,
        candidate.monitorId,
        candidate.userId,
        candidate.monitorRevision,
        candidate.poolKey,
        candidate.windowEnd,
        candidate.generatedAt,
        candidate.metricVersion,
        candidate.sourceGenerationId,
        candidate.canonicalBlockHash,
        candidate.blocklistHash,
        JSON.stringify(candidate.matchedConditions),
        candidate.createdAt,
      ],
    );
  }

  async #replaceEvidence(
    client: PoolClient,
    candidate: MonitorCandidate,
    destinations: readonly MonitorOutboxDestination[],
  ): Promise<void> {
    await client.query(
      `UPDATE monitor_candidates
          SET generated_at = $2,
              source_generation_id = $3,
              replaces_generation_id = source_generation_id,
              canonical_block_hash = $4,
              blocklist_hash = $5,
              matched_conditions = $6::jsonb,
              updated_at = $7
        WHERE candidate_key = $1`,
      [
        candidate.candidateKey,
        candidate.generatedAt,
        candidate.sourceGenerationId,
        candidate.canonicalBlockHash,
        candidate.blocklistHash,
        JSON.stringify(candidate.matchedConditions),
        candidate.createdAt,
      ],
    );
    for (const destination of destinations) {
      const dedupeKey = notificationDedupeKey({
        candidateKey: candidate.candidateKey,
        destinationId: destination.destinationId,
        destinationRevision: destination.destinationRevision,
      });
      await client.query(
        `UPDATE notification_outbox
            SET payload = $2::jsonb,
                state = CASE
                  WHEN state = 'leased' AND lease_expires_at <= clock_timestamp()
                    THEN 'pending'
                  ELSE state
                END,
                lease_owner = CASE
                  WHEN state = 'leased' AND lease_expires_at <= clock_timestamp() THEN NULL
                  ELSE lease_owner
                END,
                lease_token = CASE
                  WHEN state = 'leased' AND lease_expires_at <= clock_timestamp() THEN NULL
                  ELSE lease_token
                END,
                lease_expires_at = CASE
                  WHEN state = 'leased' AND lease_expires_at <= clock_timestamp() THEN NULL
                  ELSE lease_expires_at
                END,
                updated_at = $3
          WHERE dedupe_key = $1
            AND (
              state IN ('pending', 'retry-wait')
              OR (state = 'leased' AND lease_expires_at <= clock_timestamp())
            )`,
        [dedupeKey, JSON.stringify(destination.payload), candidate.createdAt],
      );
    }
  }

  async #upsertDelivery(
    client: PoolClient,
    candidate: MonitorCandidate,
    destination: MonitorOutboxDestination,
  ): Promise<NotificationOutboxDelivery> {
    const dedupeKey = notificationDedupeKey({
      candidateKey: candidate.candidateKey,
      destinationId: destination.destinationId,
      destinationRevision: destination.destinationRevision,
    });
    await client.query(
      `INSERT INTO notification_outbox (
         dedupe_key, candidate_key, monitor_id, user_id, destination_id,
         destination_revision, channel, category, payload, state, attempt_count,
         next_attempt_at, lease_owner, lease_token, lease_expires_at, created_at,
         updated_at, delivered_at, last_error_code, last_error_summary
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'monitor-match', $8::jsonb, 'pending', 0,
         NULL, NULL, NULL, NULL, $9, $9, NULL, NULL, NULL
       )
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        dedupeKey,
        candidate.candidateKey,
        candidate.monitorId,
        candidate.userId,
        destination.destinationId,
        destination.destinationRevision,
        destination.channel,
        JSON.stringify(destination.payload),
        candidate.createdAt,
      ],
    );
    const row = await client.query<DeliveryRow>(
      `SELECT ${deliveryColumns} FROM notification_outbox WHERE dedupe_key = $1`,
      [dedupeKey],
    );
    if (!row.rows[0]) throw new Error("Outbox delivery insert failed");
    return deliveryFromRow(row.rows[0]);
  }

  async #advanceWatermark(client: PoolClient, candidate: MonitorCandidate): Promise<void> {
    await client.query(
      `INSERT INTO monitor_evaluation_watermarks (
         monitor_id, user_id, pool_key, metric_version, window_end, generated_at,
         source_generation_id, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (monitor_id, pool_key, metric_version) DO UPDATE
         SET window_end = EXCLUDED.window_end,
             generated_at = EXCLUDED.generated_at,
             source_generation_id = EXCLUDED.source_generation_id,
             updated_at = EXCLUDED.updated_at
       WHERE (
         monitor_evaluation_watermarks.window_end,
         monitor_evaluation_watermarks.generated_at,
         monitor_evaluation_watermarks.source_generation_id
       ) < (EXCLUDED.window_end, EXCLUDED.generated_at, EXCLUDED.source_generation_id)`,
      [
        candidate.monitorId,
        candidate.userId,
        candidate.poolKey,
        candidate.metricVersion,
        candidate.windowEnd,
        candidate.generatedAt,
        candidate.sourceGenerationId,
        candidate.createdAt,
      ],
    );
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the transaction error.
    }
  }
}
