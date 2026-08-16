import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import type {
  LiquidityFlowBackfill,
  LiquidityFlowCanonicalEnvelope,
  LiquidityFlowFilter,
  LiquidityFlowRecord,
} from "@lpbot/api-contract";
import type { Pool } from "pg";

export interface LiquidityFlowStreamContext extends LiquidityFlowFilter {
  signal: AbortSignal;
}

export interface LiquidityFlowProvider {
  subscribe(context: LiquidityFlowStreamContext): AsyncIterable<LiquidityFlowCanonicalEnvelope>;
}

interface FlowOutboxRow {
  created_at: Date;
  cursor: string;
  payload: LiquidityFlowRecord | null;
  record_type: "event" | "heartbeat" | "tombstone";
  sequence: string;
}

interface FlowWatermark {
  cursor: string;
  sequence: string;
}

export interface PostgresLiquidityFlowProviderOptions {
  backfillLimit?: number;
  heartbeatMilliseconds?: number;
  now?: () => Date;
  pollMilliseconds?: number;
}

export function liquidityFlowStreamKey(filter: Omit<LiquidityFlowFilter, "since">): string {
  return [
    "liquidity-flow:56",
    `pool=${filter.pool ?? "*"}`,
    `token=${filter.token ?? "*"}`,
    `user=${filter.user ?? "*"}`,
    `nft=${filter.nftId ?? "*"}`,
  ].join(":");
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function matches(record: LiquidityFlowRecord, context: LiquidityFlowStreamContext): boolean {
  if (
    context.pool &&
    record.pool_address !== context.pool &&
    record.pool_id !== context.pool
  ) {
    return false;
  }
  if (
    context.token &&
    record.token0_address !== context.token &&
    record.token1_address !== context.token
  ) {
    return false;
  }
  if (context.user && record.user !== context.user) return false;
  return !context.nftId || record.nft_id === context.nftId;
}

export class PostgresLiquidityFlowProvider implements LiquidityFlowProvider {
  readonly #backfillLimit: number;
  readonly #heartbeatMilliseconds: number;
  readonly #now: () => Date;
  readonly #pollMilliseconds: number;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresLiquidityFlowProviderOptions = {}) {
    this.#pool = pool;
    this.#backfillLimit = options.backfillLimit ?? 500;
    this.#heartbeatMilliseconds = options.heartbeatMilliseconds ?? 25_000;
    this.#now = options.now ?? (() => new Date());
    this.#pollMilliseconds = options.pollMilliseconds ?? 1_000;
    if (
      !Number.isSafeInteger(this.#backfillLimit) ||
      this.#backfillLimit < 1 ||
      this.#backfillLimit > 1_000 ||
      !Number.isSafeInteger(this.#heartbeatMilliseconds) ||
      this.#heartbeatMilliseconds < 1 ||
      !Number.isSafeInteger(this.#pollMilliseconds) ||
      this.#pollMilliseconds < 1
    ) {
      throw new RangeError("Liquidity flow stream options are invalid");
    }
  }

  async *subscribe(
    context: LiquidityFlowStreamContext,
  ): AsyncIterable<LiquidityFlowCanonicalEnvelope> {
    const key = liquidityFlowStreamKey(context);
    const watermark = await this.#watermark();
    const rows = await this.#backfill(context, watermark.sequence);
    const hasMore = rows.length > this.#backfillLimit;
    const selected = (hasMore ? rows.slice(0, this.#backfillLimit) : rows).reverse();
    const records = selected
      .map(({ payload }) => payload)
      .filter((record): record is LiquidityFlowRecord => record !== null);
    const cursor = selected.at(-1)?.cursor ?? watermark.cursor ?? null;
    const sequence = selected.at(-1)?.sequence ?? watermark.sequence;
    const backfill: LiquidityFlowBackfill = {
      cursor,
      event_type: "liquidity.backfill",
      events: records,
      has_more: hasMore,
      schema_version: "1.0.0",
      stream_key: key,
    };
    yield {
      cursor: cursor ?? "flow:v1:56:0:empty",
      data: backfill,
      emittedAt: this.#validNow().toISOString(),
      epoch: "1",
      eventType: "liquidity.backfill",
      mode: "snapshot",
      schemaVersion: "1.0.0",
      sequence,
      streamKey: key,
    };

    let sequence = watermark.sequence;
    while (!context.signal.aborted) {
      const live = await this.#after(sequence);
      if (live.length > 0) {
        for (const row of live) {
          sequence = row.sequence;
          if (context.signal.aborted) return;
          if (row.record_type === "heartbeat") {
            yield this.#envelope(key, row, null, "heartbeat");
          } else if (row.payload && matches(row.payload, context)) {
            yield this.#envelope(key, row, row.payload, "liquidity.event");
          }
        }
        continue;
      }

      const heartbeat = await this.#appendHeartbeat();
      if (heartbeat) {
        sequence = heartbeat.sequence;
        yield this.#envelope(key, heartbeat, null, "heartbeat");
        continue;
      }
      try {
        await delay(this.#pollMilliseconds, undefined, { signal: context.signal });
      } catch (error) {
        if (context.signal.aborted) return;
        throw error;
      }
    }
  }

  #envelope(
    streamKey: string,
    row: FlowOutboxRow,
    data: LiquidityFlowRecord | null,
    eventType: "heartbeat" | "liquidity.event",
  ): LiquidityFlowCanonicalEnvelope {
    return {
      cursor: row.cursor,
      data,
      emittedAt: row.created_at.toISOString(),
      epoch: "1",
      eventType,
      mode: "diff",
      schemaVersion: "1.0.0",
      sequence: row.sequence,
      streamKey,
    };
  }

  async #watermark(): Promise<FlowWatermark> {
    const result = await this.#pool.query<FlowWatermark>(
      `SELECT sequence::text, cursor
         FROM liquidity_flow_outbox
        WHERE chain_id = 56
        ORDER BY liquidity_flow_outbox.sequence DESC
        LIMIT 1`,
    );
    return result.rows[0] ?? { cursor: "", sequence: "0" };
  }

  async #backfill(
    context: LiquidityFlowStreamContext,
    watermark: string,
  ): Promise<FlowOutboxRow[]> {
    const result = await this.#pool.query<FlowOutboxRow>(
      `SELECT sequence::text, cursor, record_type, payload, created_at
         FROM liquidity_flow_outbox
        WHERE chain_id = 56
          AND sequence <= $1
          AND record_type <> 'heartbeat'
          AND occurred_at_milliseconds >= $2
          AND ($3::text IS NULL OR pool_address = $3 OR pool_id = $3)
          AND ($4::text IS NULL OR token0 = $4 OR token1 = $4)
          AND ($5::text IS NULL OR user_address = $5)
          AND ($6::text IS NULL OR nft_id::text = $6)
        ORDER BY liquidity_flow_outbox.sequence DESC
        LIMIT $7`,
      [
        watermark,
        String(context.since),
        context.pool,
        context.token,
        context.user,
        context.nftId,
        this.#backfillLimit + 1,
      ],
    );
    return result.rows;
  }

  async #after(sequence: string): Promise<FlowOutboxRow[]> {
    const result = await this.#pool.query<FlowOutboxRow>(
      `SELECT sequence::text, cursor, record_type, payload, created_at
         FROM liquidity_flow_outbox
        WHERE chain_id = 56 AND sequence > $1
        ORDER BY liquidity_flow_outbox.sequence
        LIMIT 500`,
      [sequence],
    );
    return result.rows;
  }

  async #appendHeartbeat(): Promise<FlowOutboxRow | null> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [
        1_279_283_791,
        56,
      ]);
      const latest = await client.query<FlowOutboxRow>(
        `SELECT sequence::text, cursor, record_type, payload, created_at
           FROM liquidity_flow_outbox
          WHERE chain_id = 56
          ORDER BY liquidity_flow_outbox.sequence DESC
          LIMIT 1
          FOR UPDATE`,
      );
      const now = this.#validNow();
      const previous = latest.rows[0];
      if (
        previous &&
        now.getTime() - previous.created_at.getTime() < this.#heartbeatMilliseconds
      ) {
        await client.query("COMMIT");
        return null;
      }
      const sequence = previous ? (BigInt(previous.sequence) + 1n).toString() : "1";
      const cursor = `flow:v1:56:${sequence}:${fingerprint(`heartbeat:${sequence}`)}`;
      await client.query(
        `INSERT INTO liquidity_flow_outbox (
           sequence, chain_id, cursor, record_type, related_event_id,
           occurred_at_milliseconds, protocol, protocol_generation, event_type,
           pool_address, pool_id, token0, token1, user_address, nft_id,
           payload, created_at
         ) VALUES (
           $1, 56, $2, 'heartbeat', NULL, $3,
           NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $4
         )`,
        [sequence, cursor, now.getTime(), now.toISOString()],
      );
      await client.query("COMMIT");
      return {
        created_at: now,
        cursor,
        payload: null,
        record_type: "heartbeat",
        sequence,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  #validNow(): Date {
    const value = this.#now();
    if (!Number.isFinite(value.getTime())) throw new RangeError("Liquidity flow clock is invalid");
    return value;
  }
}
