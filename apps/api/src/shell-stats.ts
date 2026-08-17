import { createHash } from "node:crypto";

import type { ShellStatsEvent, ShellStatsSnapshot } from "@lpbot/api-contract";
import type { Pool, PoolClient } from "pg";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const telegramUserIdPattern = /^[1-9][0-9]{0,18}$/u;
const maximumPostgresBigint = 9_223_372_036_854_775_807n;

export interface AuthoritativeTaskStatusStatsInput {
  observedAt: string;
  paused: number;
  running: number;
  sourceRevision: number;
  stopped: number;
  userId: string;
}

export interface CanonicalTaskStatusStatsInput extends AuthoritativeTaskStatusStatsInput {
  total: number;
}

export interface TaskStatusStatsPublishResult {
  changed: boolean;
  globalSequence: number;
  status: "applied" | "conflict" | "idempotent" | "stale";
  userSequence: number;
}

export interface TaskStatusStatsPublisher {
  completeBackfill(input: { observedAt: string }): Promise<{ changed: boolean }>;
  publish(input: AuthoritativeTaskStatusStatsInput): Promise<TaskStatusStatsPublishResult>;
}

export type ShellStatsScope = { type: "global" } | { type: "user"; userId: string };

export interface ShellStatsContext {
  scope: ShellStatsScope;
}

export interface ShellStatsSubscriptionContext extends ShellStatsContext {
  afterSequence: number;
  signal: AbortSignal;
}

export interface ShellStatsAdminQueryAudit {
  actorUserId: string;
  createdAt: string;
  outcome: "allowed" | "not_found";
  requestId: string;
  targetTelegramUserId: string;
  targetUserId: string | null;
  transport: "http" | "sse";
}

export interface ShellStatsProvider {
  getSnapshot(context: ShellStatsContext): Promise<ShellStatsSnapshot>;
  recordAdminQueryAudit(audit: ShellStatsAdminQueryAudit): Promise<void>;
  resolveTelegramUserId(telegramUserId: string): Promise<string | null>;
  subscribe(context: ShellStatsSubscriptionContext): AsyncIterable<ShellStatsEvent>;
}

export interface PostgresShellStatsProviderOptions {
  heartbeatMilliseconds?: number;
  now?: () => Date;
  pollMilliseconds?: number;
}

export class TaskStatusStatsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskStatusStatsValidationError";
  }
}

export class ShellStatsUnavailableError extends Error {
  readonly code = "STATS_UNAVAILABLE";

  constructor(message = "Shell statistics are temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "ShellStatsUnavailableError";
  }
}

interface ProjectionStateRow {
  backfill_completed_at: Date | null;
  ready: boolean;
}

interface UserSnapshotRow {
  observed_at: Date;
  paused: string;
  payload_hash: string;
  running: string;
  source_revision: string;
  stopped: string;
}

interface SequenceRow {
  sequence: string;
}

interface HeadReadRow {
  aggregate_paused: string;
  aggregate_running: string;
  aggregate_stopped: string;
  backfill_completed_at: Date | null;
  content_hash: string | null;
  head_exists: boolean;
  observed_at: Date | null;
  paused: string | null;
  ready: boolean;
  running: string | null;
  sequence: string | null;
  snapshot_exists: boolean;
  snapshot_paused: string | null;
  snapshot_running: string | null;
  snapshot_stopped: string | null;
  stopped: string | null;
}

interface HeadSnapshot {
  observedAt: string;
  paused: number;
  running: number;
  sequence: number;
  stopped: number;
}

function canonicalIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TaskStatusStatsValidationError(`${field} is invalid`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new TaskStatusStatsValidationError(`${field} is invalid`);
  }
  return value;
}

function canonicalUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new TaskStatusStatsValidationError(`${field} is invalid`);
  }
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TaskStatusStatsValidationError(`${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function storedSafeInteger(value: string | null | undefined, field: string): number {
  if (value === null || value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new ShellStatsUnavailableError(`Stored ${field} is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ShellStatsUnavailableError(`Stored ${field} is invalid`);
  }
  return parsed;
}

function validClock(now: () => Date): Date {
  const value = now();
  if (!Number.isFinite(value.getTime())) {
    throw new ShellStatsUnavailableError("Shell statistics clock is invalid");
  }
  return value;
}

function taskCountsHash(running: number, paused: number, stopped: number): string {
  return `sha256:${createHash("sha256")
    .update(`task-status-stats/v1:${running}:${paused}:${stopped}`)
    .digest("hex")}`;
}

function taskPayloadHash(input: AuthoritativeTaskStatusStatsInput): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        observedAt: input.observedAt,
        paused: input.paused,
        running: input.running,
        sourceRevision: input.sourceRevision,
        stopped: input.stopped,
        userId: input.userId,
      }),
    )
    .digest("hex")}`;
}

function canonicalTelegramUserId(value: string): string {
  if (!telegramUserIdPattern.test(value)) {
    throw new TaskStatusStatsValidationError("Telegram user ID is invalid");
  }
  const parsed = BigInt(value);
  if (parsed > maximumPostgresBigint) {
    throw new TaskStatusStatsValidationError("Telegram user ID is invalid");
  }
  return parsed.toString();
}

function canonicalScope(scope: ShellStatsScope): ShellStatsScope {
  if (scope.type === "global") return { type: "global" };
  if (scope.type === "user") return { type: "user", userId: canonicalUuid(scope.userId, "userId") };
  throw new TaskStatusStatsValidationError("Shell statistics scope is invalid");
}

export function canonicalTaskStatusStatsInput(
  input: AuthoritativeTaskStatusStatsInput,
): CanonicalTaskStatusStatsInput {
  const running = safeInteger(input.running, "running");
  const paused = safeInteger(input.paused, "paused");
  const stopped = safeInteger(input.stopped, "stopped");
  const total = running + paused + stopped;
  if (!Number.isSafeInteger(total)) {
    throw new TaskStatusStatsValidationError("Task status total exceeds the safe integer range");
  }
  return {
    observedAt: canonicalIsoTimestamp(input.observedAt, "observedAt"),
    paused,
    running,
    sourceRevision: safeInteger(input.sourceRevision, "sourceRevision"),
    stopped,
    total,
    userId: canonicalUuid(input.userId, "userId"),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}

export class PostgresTaskStatusStatsPublisher implements TaskStatusStatsPublisher {
  readonly #now: () => Date;
  readonly #pool: Pool;

  constructor(pool: Pool, options: { now?: () => Date } = {}) {
    this.#pool = pool;
    this.#now = options.now ?? (() => new Date());
  }

  async completeBackfill(input: { observedAt: string }): Promise<{ changed: boolean }> {
    const observedAt = canonicalIsoTimestamp(input.observedAt, "observedAt");
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const state = await client.query<ProjectionStateRow>(
        `SELECT ready, backfill_completed_at
           FROM task_status_stats_projection_state
          WHERE singleton = true
          FOR UPDATE`,
      );
      const row = state.rows[0];
      if (!row) throw new ShellStatsUnavailableError("Task statistics readiness row is missing");
      if (row.ready) {
        await client.query("COMMIT");
        return { changed: false };
      }
      await client.query(
        `UPDATE task_status_stats_projection_state
            SET ready = true, backfill_completed_at = $1, updated_at = $1
          WHERE singleton = true`,
        [observedAt],
      );
      await client.query(
        `UPDATE task_status_stats_stream_heads
            SET observed_at = $1
          WHERE scope_key = 'global'
            AND sequence = 0
            AND content_hash = task_status_stats_counts_hash(0, 0, 0)`,
        [observedAt],
      );
      await client.query("COMMIT");
      return { changed: true };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async publish(input: AuthoritativeTaskStatusStatsInput): Promise<TaskStatusStatsPublishResult> {
    const canonical = canonicalTaskStatusStatsInput(input);
    const payloadHash = taskPayloadHash(canonical);
    const contentHash = taskCountsHash(canonical.running, canonical.paused, canonical.stopped);
    const recordedAt = validClock(this.#now);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const readiness = await client.query<ProjectionStateRow>(
        `SELECT ready, backfill_completed_at
           FROM task_status_stats_projection_state
          WHERE singleton = true
          FOR UPDATE`,
      );
      if (!readiness.rows[0]) {
        throw new ShellStatsUnavailableError("Task statistics readiness row is missing");
      }
      const currentResult = await client.query<UserSnapshotRow>(
        `SELECT running::text, paused::text, stopped::text, source_revision::text,
                payload_hash, observed_at
           FROM task_status_stats_user_snapshots
          WHERE user_id = $1
          FOR UPDATE`,
        [canonical.userId],
      );
      const current = currentResult.rows[0];

      await client.query(
        `INSERT INTO task_status_stats_stream_heads (
           scope_key, scope, user_id, sequence, running, paused, stopped, content_hash, observed_at
         ) VALUES (
           'user:' || $1::uuid::text, 'user', $1, 0, 0, 0, 0,
           task_status_stats_counts_hash(0, 0, 0), $2
         )
         ON CONFLICT (scope_key) DO NOTHING`,
        [canonical.userId, canonical.observedAt],
      );
      await client.query(
        `SELECT sequence
           FROM task_status_stats_stream_heads
          WHERE scope_key IN ('global', 'user:' || $1::uuid::text)
          ORDER BY scope_key
          FOR UPDATE`,
        [canonical.userId],
      );

      const currentRevision = current
        ? storedSafeInteger(current.source_revision, "source revision")
        : null;
      if (current && currentRevision === canonical.sourceRevision) {
        if (current.payload_hash === payloadHash) {
          return await this.#finishWithoutChange(client, canonical.userId, "idempotent");
        }
        await client.query(
          `INSERT INTO task_status_stats_conflicts (
             user_id, source_revision, existing_payload_hash, attempted_payload_hash,
             attempted_observed_at, recorded_at
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            canonical.userId,
            canonical.sourceRevision,
            current.payload_hash,
            payloadHash,
            canonical.observedAt,
            recordedAt,
          ],
        );
        return await this.#finishWithoutChange(client, canonical.userId, "conflict");
      }
      if (currentRevision !== null && canonical.sourceRevision < currentRevision) {
        return await this.#finishWithoutChange(client, canonical.userId, "stale");
      }

      const payloadChanged = current === undefined || current.payload_hash !== payloadHash;
      const publicContentChanged =
        current === undefined
          ? contentHash !== taskCountsHash(0, 0, 0)
          : contentHash !== taskCountsHash(
              storedSafeInteger(current.running, "running count"),
              storedSafeInteger(current.paused, "paused count"),
              storedSafeInteger(current.stopped, "stopped count"),
            );
      await client.query(
        `INSERT INTO task_status_stats_user_snapshots (
           user_id, running, paused, stopped, source_revision, payload_hash, observed_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id) DO UPDATE
           SET running = EXCLUDED.running,
               paused = EXCLUDED.paused,
               stopped = EXCLUDED.stopped,
               source_revision = EXCLUDED.source_revision,
               payload_hash = EXCLUDED.payload_hash,
               observed_at = EXCLUDED.observed_at,
               updated_at = EXCLUDED.updated_at`,
        [
          canonical.userId,
          canonical.running,
          canonical.paused,
          canonical.stopped,
          canonical.sourceRevision,
          payloadHash,
          canonical.observedAt,
          recordedAt,
        ],
      );
      if (publicContentChanged) {
        await client.query(
          `UPDATE task_status_stats_stream_heads
              SET sequence = sequence + 1,
                  running = $2,
                  paused = $3,
                  stopped = $4,
                  content_hash = $5,
                  observed_at = $6
            WHERE scope_key = 'user:' || $1::uuid::text`,
          [
            canonical.userId,
            canonical.running,
            canonical.paused,
            canonical.stopped,
            contentHash,
            canonical.observedAt,
          ],
        );
      }

      const aggregate = await client.query<{
        paused: string;
        running: string;
        stopped: string;
      }>(
        `SELECT COALESCE(sum(running), 0)::text AS running,
                COALESCE(sum(paused), 0)::text AS paused,
                COALESCE(sum(stopped), 0)::text AS stopped
           FROM task_status_stats_user_snapshots`,
      );
      const aggregateRow = aggregate.rows[0];
      const globalRunning = storedSafeInteger(aggregateRow?.running, "global running count");
      const globalPaused = storedSafeInteger(aggregateRow?.paused, "global paused count");
      const globalStopped = storedSafeInteger(aggregateRow?.stopped, "global stopped count");
      if (!Number.isSafeInteger(globalRunning + globalPaused + globalStopped)) {
        throw new TaskStatusStatsValidationError("Global task status total exceeds safe integer range");
      }
      const globalHash = taskCountsHash(globalRunning, globalPaused, globalStopped);
      await client.query(
        `UPDATE task_status_stats_stream_heads
            SET sequence = sequence + 1,
                running = $1,
                paused = $2,
                stopped = $3,
                content_hash = $4,
                observed_at = $5
          WHERE scope_key = 'global'
            AND content_hash <> $4`,
        [globalRunning, globalPaused, globalStopped, globalHash, canonical.observedAt],
      );
      const sequences = await this.#sequences(client, canonical.userId);
      await client.query("COMMIT");
      return { changed: payloadChanged && publicContentChanged, ...sequences, status: "applied" };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #finishWithoutChange(
    client: PoolClient,
    userId: string,
    status: "conflict" | "idempotent" | "stale",
  ): Promise<TaskStatusStatsPublishResult> {
    const sequences = await this.#sequences(client, userId);
    await client.query("COMMIT");
    return { changed: false, ...sequences, status };
  }

  async #sequences(
    client: PoolClient,
    userId: string,
  ): Promise<{ globalSequence: number; userSequence: number }> {
    const result = await client.query<SequenceRow>(
      `SELECT sequence::text
         FROM task_status_stats_stream_heads
        WHERE scope_key IN ('global', 'user:' || $1::uuid::text)
        ORDER BY scope_key`,
      [userId],
    );
    if (result.rows.length !== 2) {
      throw new ShellStatsUnavailableError("Task statistics stream head is missing");
    }
    return {
      globalSequence: storedSafeInteger(result.rows[0]?.sequence, "global sequence"),
      userSequence: storedSafeInteger(result.rows[1]?.sequence, "user sequence"),
    };
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class PostgresShellStatsProvider implements ShellStatsProvider {
  readonly #heartbeatMilliseconds: number;
  readonly #now: () => Date;
  readonly #pollMilliseconds: number;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresShellStatsProviderOptions = {}) {
    this.#pool = pool;
    this.#heartbeatMilliseconds = options.heartbeatMilliseconds ?? 25_000;
    this.#now = options.now ?? (() => new Date());
    this.#pollMilliseconds = options.pollMilliseconds ?? 500;
    if (
      !Number.isSafeInteger(this.#pollMilliseconds) ||
      this.#pollMilliseconds <= 0 ||
      !Number.isSafeInteger(this.#heartbeatMilliseconds) ||
      this.#heartbeatMilliseconds <= 0 ||
      this.#pollMilliseconds > this.#heartbeatMilliseconds
    ) {
      throw new RangeError("Shell statistics polling configuration is invalid");
    }
  }

  async getSnapshot(context: ShellStatsContext): Promise<ShellStatsSnapshot> {
    try {
      const head = await this.#readHead(canonicalScope(context.scope));
      return {
        observedAt: head.observedAt,
        sequence: head.sequence,
        stats: {
          fps: null,
          gas: { baseGwei: null, ethereumGwei: null },
          online: null,
          pingMs: null,
          taskCounts: { paused: head.paused, running: head.running, stopped: head.stopped },
        },
      };
    } catch (error) {
      if (error instanceof ShellStatsUnavailableError) throw error;
      throw new ShellStatsUnavailableError(undefined, { cause: error });
    }
  }

  async resolveTelegramUserId(telegramUserId: string): Promise<string | null> {
    const canonical = canonicalTelegramUserId(telegramUserId);
    try {
      const result = await this.#pool.query<{ user_id: string }>(
        `SELECT user_id::text
           FROM telegram_identities
          WHERE telegram_user_id = $1::bigint`,
        [canonical],
      );
      const userId = result.rows[0]?.user_id;
      return userId === undefined ? null : canonicalUuid(userId, "stored userId");
    } catch (error) {
      if (error instanceof TaskStatusStatsValidationError) throw error;
      throw new ShellStatsUnavailableError(undefined, { cause: error });
    }
  }

  async recordAdminQueryAudit(audit: ShellStatsAdminQueryAudit): Promise<void> {
    const actorUserId = canonicalUuid(audit.actorUserId, "actorUserId");
    const targetUserId =
      audit.targetUserId === null ? null : canonicalUuid(audit.targetUserId, "targetUserId");
    const telegramUserId = canonicalTelegramUserId(audit.targetTelegramUserId);
    const createdAt = canonicalIsoTimestamp(audit.createdAt, "createdAt");
    if (
      (audit.transport !== "http" && audit.transport !== "sse") ||
      (audit.outcome !== "allowed" && audit.outcome !== "not_found") ||
      typeof audit.requestId !== "string" ||
      audit.requestId.length < 1 ||
      audit.requestId.length > 256
    ) {
      throw new TaskStatusStatsValidationError("Statistics audit summary is invalid");
    }
    try {
      await this.#pool.query(
        `INSERT INTO task_status_stats_query_audit_events (
           actor_user_id, target_user_id, target_telegram_user_id,
           transport, outcome, request_id, created_at
         ) VALUES ($1, $2, $3::bigint, $4, $5, $6, $7)`,
        [
          actorUserId,
          targetUserId,
          telegramUserId,
          audit.transport,
          audit.outcome,
          audit.requestId,
          createdAt,
        ],
      );
    } catch (error) {
      if (error instanceof TaskStatusStatsValidationError) throw error;
      throw new ShellStatsUnavailableError(undefined, { cause: error });
    }
  }

  async *subscribe(context: ShellStatsSubscriptionContext): AsyncIterable<ShellStatsEvent> {
    const scope = canonicalScope(context.scope);
    let sequence = safeInteger(context.afterSequence, "afterSequence");
    let lastEmission = validClock(this.#now).getTime();
    while (!context.signal.aborted) {
      let head: HeadSnapshot;
      try {
        head = await abortable(this.#readHead(scope), context.signal);
      } catch (error) {
        if (context.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        if (error instanceof ShellStatsUnavailableError) throw error;
        throw new ShellStatsUnavailableError(undefined, { cause: error });
      }
      if (head.sequence < sequence) {
        throw new ShellStatsUnavailableError("Task statistics sequence regressed");
      }
      if (head.sequence > sequence) {
        sequence = head.sequence;
        lastEmission = validClock(this.#now).getTime();
        yield {
          observedAt: head.observedAt,
          sequence,
          stats: {
            taskCounts: { paused: head.paused, running: head.running, stopped: head.stopped },
          },
          type: "update",
        };
      } else {
        const currentTime = validClock(this.#now).getTime();
        if (currentTime - lastEmission >= this.#heartbeatMilliseconds) {
          lastEmission = currentTime;
          yield {
            observedAt: new Date(currentTime).toISOString(),
            sequence: null,
            type: "heartbeat",
          };
        }
      }
      if (context.signal.aborted) return;
      const remainingHeartbeat = Math.max(
        1,
        this.#heartbeatMilliseconds - (validClock(this.#now).getTime() - lastEmission),
      );
      await abortableDelay(Math.min(this.#pollMilliseconds, remainingHeartbeat), context.signal);
    }
  }

  async #readHead(scope: ShellStatsScope): Promise<HeadSnapshot> {
    const scopeKey = scope.type === "global" ? "global" : `user:${scope.userId}`;
    const userId = scope.type === "user" ? scope.userId : null;
    const result = await this.#pool.query<HeadReadRow>(
      `SELECT state.ready,
              state.backfill_completed_at,
              (head.scope_key IS NOT NULL) AS head_exists,
              head.sequence::text,
              head.running::text,
              head.paused::text,
              head.stopped::text,
              head.content_hash,
              head.observed_at,
              (snapshot.user_id IS NOT NULL) AS snapshot_exists,
              snapshot.running::text AS snapshot_running,
              snapshot.paused::text AS snapshot_paused,
              snapshot.stopped::text AS snapshot_stopped,
              aggregate.running::text AS aggregate_running,
              aggregate.paused::text AS aggregate_paused,
              aggregate.stopped::text AS aggregate_stopped
         FROM task_status_stats_projection_state AS state
         LEFT JOIN task_status_stats_stream_heads AS head ON head.scope_key = $1
         LEFT JOIN task_status_stats_user_snapshots AS snapshot ON snapshot.user_id = $2::uuid
         CROSS JOIN LATERAL (
           SELECT COALESCE(sum(running), 0) AS running,
                  COALESCE(sum(paused), 0) AS paused,
                  COALESCE(sum(stopped), 0) AS stopped
             FROM task_status_stats_user_snapshots
         ) AS aggregate
        WHERE state.singleton = true`,
      [scopeKey, userId],
    );
    const row = result.rows[0];
    if (!row || !row.ready || !row.backfill_completed_at) {
      throw new ShellStatsUnavailableError("Task statistics projection is not ready");
    }
    if (!row.head_exists) {
      if (scope.type === "global" || row.snapshot_exists) {
        throw new ShellStatsUnavailableError("Task statistics stream head is missing");
      }
      return {
        observedAt: row.backfill_completed_at.toISOString(),
        paused: 0,
        running: 0,
        sequence: 0,
        stopped: 0,
      };
    }
    const head: HeadSnapshot = {
      observedAt: row.observed_at?.toISOString() ?? "",
      paused: storedSafeInteger(row.paused, "paused count"),
      running: storedSafeInteger(row.running, "running count"),
      sequence: storedSafeInteger(row.sequence, "sequence"),
      stopped: storedSafeInteger(row.stopped, "stopped count"),
    };
    if (!row.observed_at || !Number.isSafeInteger(head.running + head.paused + head.stopped)) {
      throw new ShellStatsUnavailableError("Stored task statistics are invalid");
    }
    if (row.content_hash !== taskCountsHash(head.running, head.paused, head.stopped)) {
      throw new ShellStatsUnavailableError("Stored task statistics hash is invalid");
    }
    if (scope.type === "global") {
      const aggregateRunning = storedSafeInteger(row.aggregate_running, "aggregate running count");
      const aggregatePaused = storedSafeInteger(row.aggregate_paused, "aggregate paused count");
      const aggregateStopped = storedSafeInteger(row.aggregate_stopped, "aggregate stopped count");
      if (
        aggregateRunning !== head.running ||
        aggregatePaused !== head.paused ||
        aggregateStopped !== head.stopped
      ) {
        throw new ShellStatsUnavailableError("Global task statistics aggregate is inconsistent");
      }
    } else if (row.snapshot_exists) {
      if (
        storedSafeInteger(row.snapshot_running, "snapshot running count") !== head.running ||
        storedSafeInteger(row.snapshot_paused, "snapshot paused count") !== head.paused ||
        storedSafeInteger(row.snapshot_stopped, "snapshot stopped count") !== head.stopped
      ) {
        throw new ShellStatsUnavailableError("User task statistics snapshot is inconsistent");
      }
    } else if (head.running !== 0 || head.paused !== 0 || head.stopped !== 0) {
      throw new ShellStatsUnavailableError("Deleted user task statistics tombstone is invalid");
    }
    return head;
  }
}
