import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import {
  marketStreamKey,
  type LiquidityFlowProtocol,
  type MarketPoolByTokenRow,
  type MarketPoolByTokenSort,
  type MarketPoolRow,
  type MarketPoolSnapshot,
  type MarketStreamEnvelope,
  type MarketWindowMinutes,
} from "@lpbot/api-contract";
import { MARKET_METRIC_VERSION, POOL_LABEL_RULE_CONTRACT } from "@lpbot/market-metrics";
import type { Pool, PoolClient } from "pg";

export interface MarketPoolsContext {
  chainId: 56;
  minutes: MarketWindowMinutes;
  protocols: readonly LiquidityFlowProtocol[];
  signal?: AbortSignal;
}

export interface MarketPoolsStreamContext extends MarketPoolsContext {
  lastEventId: string | null;
  signal: AbortSignal;
}

export interface MarketPoolsByTokenContext {
  address: `0x${string}`;
  chainId: 56;
  limit: number;
  protocols: readonly LiquidityFlowProtocol[];
  sort: MarketPoolByTokenSort;
}

export interface MarketPoolsProvider {
  getByToken(context: MarketPoolsByTokenContext): Promise<MarketPoolByTokenRow[]>;
  getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot>;
  subscribe(context: MarketPoolsStreamContext): AsyncIterable<MarketStreamEnvelope>;
}

interface SnapshotRow {
  canonical_revision: string;
  created_at: Date;
  metric_version: string;
  rows: MarketPoolRow[];
  version: string;
  window_end: Date;
  window_start: Date;
}

interface OutboxRow {
  envelope: MarketStreamEnvelope;
  epoch: string;
  sequence: string;
}

interface CatalogByTokenRow {
  fee_pips: string | null;
  five_minute: MarketPoolRow | null;
  hooks: string | null;
  one_hour: MarketPoolRow | null;
  pool_address: string | null;
  pool_id: string | null;
  pool_key: string;
  protocol: LiquidityFlowProtocol;
  tick_spacing: string | null;
  token0: string;
  token1: string;
}

export interface PostgresMarketPoolsProviderOptions {
  heartbeatMilliseconds?: number;
  now?: () => Date;
  pollMilliseconds?: number;
}

function storageStreamKey(context: Pick<MarketPoolsContext, "chainId" | "minutes">): string {
  return `top-fees:${context.chainId}:${context.minutes}`;
}

function filteredStream(context: MarketPoolsContext): boolean {
  return context.protocols.length !== 4;
}

function wrapFilteredCursor(context: MarketPoolsContext, sourceCursor: string): string {
  if (!filteredStream(context)) return sourceCursor;
  const signature = digest(context.protocols.join(","));
  return `market-filter:v1:${signature}:${Buffer.from(sourceCursor).toString("base64url")}`;
}

function unwrapFilteredCursor(context: MarketPoolsContext, cursor: string): string | null {
  if (!filteredStream(context)) return cursor;
  const [prefix, version, signature, encoded, ...extra] = cursor.split(":");
  if (
    prefix !== "market-filter" ||
    version !== "v1" ||
    signature !== digest(context.protocols.join(",")) ||
    !encoded ||
    extra.length > 0
  ) {
    return null;
  }
  try {
    return Buffer.from(encoded, "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function snapshotEnvelope(
  context: MarketPoolsContext,
  snapshot: MarketPoolSnapshot,
  epoch: string,
  sequence: string,
  emittedAt: string,
): MarketStreamEnvelope {
  const key = storageStreamKey(context);
  const cursor = `market:v1:${key}:${epoch}:${sequence}:${digest(snapshot.rows)}`;
  return {
    cursor,
    data: snapshot,
    emittedAt,
    epoch,
    eventType: "pools.snapshot",
    mode: "snapshot",
    schemaVersion: "1.0.0",
    sequence,
    streamKey: key,
  };
}

export class PostgresMarketPoolsProvider implements MarketPoolsProvider {
  readonly #heartbeatMilliseconds: number;
  readonly #now: () => Date;
  readonly #pollMilliseconds: number;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresMarketPoolsProviderOptions = {}) {
    this.#pool = pool;
    this.#heartbeatMilliseconds = options.heartbeatMilliseconds ?? 25_000;
    this.#now = options.now ?? (() => new Date());
    this.#pollMilliseconds = options.pollMilliseconds ?? 1_000;
    if (
      !Number.isSafeInteger(this.#heartbeatMilliseconds) ||
      this.#heartbeatMilliseconds < 1 ||
      !Number.isSafeInteger(this.#pollMilliseconds) ||
      this.#pollMilliseconds < 1
    ) {
      throw new RangeError("Market stream intervals must be positive integers");
    }
  }

  async getByToken(context: MarketPoolsByTokenContext): Promise<MarketPoolByTokenRow[]> {
    const metric = context.sort === "fees" ? "feesUsd" : "volumeUsd";
    const result = await this.#pool.query<CatalogByTokenRow>(
      `WITH current_windows AS (
         SELECT window_minutes, rows
           FROM market_snapshots
          WHERE chain_id = $1 AND canonical AND window_minutes IN (5, 60)
       )
       SELECT catalog.pool_key, catalog.protocol, catalog.pool_address, catalog.pool_id,
              catalog.token0, catalog.token1, catalog.fee_pips::text,
              catalog.tick_spacing::text, catalog.hooks,
              five.row AS five_minute, hour.row AS one_hour
         FROM market_pool_catalog AS catalog
         LEFT JOIN LATERAL (
           SELECT item AS row
             FROM current_windows AS snapshot_window,
                  LATERAL jsonb_array_elements(snapshot_window.rows) AS item
            WHERE snapshot_window.window_minutes = 5
              AND COALESCE(
                item->>'poolKey',
                item->>'chainId' || ':' || lower(COALESCE(item->>'poolAddress', item->>'poolId'))
              ) = catalog.pool_key
            LIMIT 1
         ) AS five ON true
         LEFT JOIN LATERAL (
           SELECT item AS row
             FROM current_windows AS snapshot_window,
                  LATERAL jsonb_array_elements(snapshot_window.rows) AS item
            WHERE snapshot_window.window_minutes = 60
              AND COALESCE(
                item->>'poolKey',
                item->>'chainId' || ':' || lower(COALESCE(item->>'poolAddress', item->>'poolId'))
              ) = catalog.pool_key
            LIMIT 1
         ) AS hour ON true
        WHERE catalog.chain_id = $1
          AND (catalog.token0 = $2 OR catalog.token1 = $2)
          AND catalog.protocol = ANY($3::text[])
        ORDER BY (five.row->>$4)::numeric DESC NULLS LAST,
                 (hour.row->>$4)::numeric DESC NULLS LAST,
                 catalog.pool_key
        LIMIT $5`,
      [context.chainId, context.address.toLowerCase(), context.protocols, metric, context.limit],
    );
    return result.rows.map((row) => {
      const current = row.five_minute ?? row.one_hour;
      const fees5m = row.five_minute?.feesUsd ?? null;
      const volume5m = row.five_minute?.volumeUsd ?? null;
      const transactionCount5m = row.five_minute?.transactionCount ?? null;
      return {
        activeTvlUsd: null,
        chainId: 56,
        fdvUsd: current?.fdvUsd ?? null,
        feeActiveTvl: null,
        feePips: row.fee_pips,
        fees1h: row.one_hour?.feesUsd ?? null,
        fees5m,
        feesUsd: fees5m,
        feeTvl: current?.feeTvl ?? null,
        hooks: row.hooks as MarketPoolByTokenRow["hooks"],
        labelRuleVersion: current?.labelRuleVersion ?? POOL_LABEL_RULE_CONTRACT.ruleVersion,
        labels: current?.labels ?? [],
        poolAddress: row.pool_address as MarketPoolByTokenRow["poolAddress"],
        poolId: row.pool_id as MarketPoolByTokenRow["poolId"],
        poolKey: row.pool_key,
        protocol: row.protocol,
        tickSpacing: row.tick_spacing,
        token0Address: row.token0 as MarketPoolByTokenRow["token0Address"],
        token0Symbol: current?.token0Symbol ?? null,
        token1Address: row.token1 as MarketPoolByTokenRow["token1Address"],
        token1Symbol: current?.token1Symbol ?? null,
        transactionCount: transactionCount5m,
        transactionCount1h: row.one_hour?.transactionCount ?? null,
        transactionCount5m,
        tvlUsd: current?.tvlUsd ?? null,
        volume1h: row.one_hour?.volumeUsd ?? null,
        volume5m,
        volumeUsd: volume5m,
      };
    });
  }

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    const result = await this.#pool.query<SnapshotRow>(
      `SELECT version::text, window_start, window_end, rows, created_at,
              canonical_revision, metric_version
         FROM market_snapshots
        WHERE stream_key = $1 AND canonical`,
      [storageStreamKey(context)],
    );
    const row = result.rows[0];
    return this.#filterSnapshot(
      context,
      row ? this.#snapshot(context, row) : this.#emptySnapshot(context),
    );
  }

  async *subscribe(context: MarketPoolsStreamContext): AsyncIterable<MarketStreamEnvelope> {
    const initial = await this.#initialEvents(context);
    let epoch = "0";
    let sequence = "0";
    for (const event of initial) {
      if (context.signal.aborted) return;
      yield this.#filterEnvelope(context, event);
      epoch = event.epoch;
      sequence = event.sequence;
    }

    while (!context.signal.aborted) {
      const events = await this.#eventsAfter(context, epoch, sequence);
      if (events.length > 0) {
        for (const event of events) {
          if (context.signal.aborted) return;
          yield this.#filterEnvelope(context, event);
          epoch = event.epoch;
          sequence = event.sequence;
        }
        continue;
      }
      const heartbeat = await this.#appendHeartbeat(context);
      if (heartbeat && BigInt(heartbeat.epoch) >= BigInt(epoch)) {
        yield this.#filterEnvelope(context, heartbeat);
        epoch = heartbeat.epoch;
        sequence = heartbeat.sequence;
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

  async #initialEvents(context: MarketPoolsStreamContext): Promise<MarketStreamEnvelope[]> {
    const key = storageStreamKey(context);
    if (context.lastEventId) {
      const sourceCursor = unwrapFilteredCursor(context, context.lastEventId);
      if (!sourceCursor) return [await this.#appendRecoverySnapshot(context)];
      const retained = await this.#pool.query<OutboxRow>(
        `SELECT o.epoch::text, o.sequence::text, o.envelope
           FROM market_stream_outbox AS o
          WHERE o.stream_key = $1 AND o.cursor = $2`,
        [key, sourceCursor],
      );
      const position = retained.rows[0];
      if (position) return this.#eventsAfter(context, position.epoch, position.sequence);
      return [await this.#appendRecoverySnapshot(context)];
    }

    const latestSnapshot = await this.#pool.query<OutboxRow>(
      `SELECT o.epoch::text, o.sequence::text, o.envelope
         FROM market_stream_outbox AS o
        WHERE o.stream_key = $1 AND o.event_type = 'pools.snapshot'
        ORDER BY o.epoch DESC, o.sequence DESC LIMIT 1`,
      [key],
    );
    const first = latestSnapshot.rows[0];
    if (!first) return [await this.#appendRecoverySnapshot(context)];
    return [first.envelope, ...(await this.#eventsAfter(context, first.epoch, first.sequence))];
  }

  async #eventsAfter(
    context: MarketPoolsContext,
    epoch: string,
    sequence: string,
  ): Promise<MarketStreamEnvelope[]> {
    const result = await this.#pool.query<OutboxRow>(
      `SELECT o.epoch::text, o.sequence::text, o.envelope
         FROM market_stream_outbox AS o
        WHERE o.stream_key = $1
          AND (o.epoch > $2 OR (o.epoch = $2 AND o.sequence > $3))
        ORDER BY o.epoch, o.sequence
        LIMIT 500`,
      [storageStreamKey(context), epoch, sequence],
    );
    return result.rows.map(({ envelope }) => envelope);
  }

  async #appendRecoverySnapshot(context: MarketPoolsContext): Promise<MarketStreamEnvelope> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await this.#lockStream(client, context);
      const latest = await client.query<{ epoch: string }>(
        `SELECT o.epoch::text FROM market_stream_outbox AS o
          WHERE o.stream_key = $1 ORDER BY o.epoch DESC, o.sequence DESC LIMIT 1`,
        [storageStreamKey(context)],
      );
      const epoch = latest.rows[0] ? (BigInt(latest.rows[0].epoch) + 1n).toString() : "1";
      const snapshot = await this.#snapshotWithClient(client, context);
      const envelope = snapshotEnvelope(
        context,
        snapshot,
        epoch,
        "1",
        this.#validNow().toISOString(),
      );
      await this.#insertOutbox(client, context, envelope);
      await client.query("COMMIT");
      return envelope;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #appendHeartbeat(context: MarketPoolsContext): Promise<MarketStreamEnvelope | null> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await this.#lockStream(client, context);
      const latest = await client.query<{
        created_at: Date;
        epoch: string;
        sequence: string;
      }>(
        `SELECT o.epoch::text, o.sequence::text, o.created_at
           FROM market_stream_outbox AS o
          WHERE o.stream_key = $1 ORDER BY o.epoch DESC, o.sequence DESC LIMIT 1`,
        [storageStreamKey(context)],
      );
      const row = latest.rows[0];
      const now = this.#validNow();
      if (!row || now.getTime() - row.created_at.getTime() < this.#heartbeatMilliseconds) {
        await client.query("COMMIT");
        return null;
      }
      const sequence = (BigInt(row.sequence) + 1n).toString();
      const key = storageStreamKey(context);
      const envelope: MarketStreamEnvelope = {
        cursor: `market:v1:${key}:${row.epoch}:${sequence}:heartbeat`,
        data: null,
        emittedAt: now.toISOString(),
        epoch: row.epoch,
        eventType: "heartbeat",
        mode: "diff",
        schemaVersion: "1.0.0",
        sequence,
        streamKey: key,
      };
      await this.#insertOutbox(client, context, envelope);
      await client.query("COMMIT");
      return envelope;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #snapshotWithClient(
    client: PoolClient,
    context: MarketPoolsContext,
  ): Promise<MarketPoolSnapshot> {
    const result = await client.query<SnapshotRow>(
      `SELECT version::text, window_start, window_end, rows, created_at,
              canonical_revision, metric_version
         FROM market_snapshots WHERE stream_key = $1 AND canonical`,
      [storageStreamKey(context)],
    );
    const row = result.rows[0];
    return row ? this.#snapshot(context, row) : this.#emptySnapshot(context);
  }

  #snapshot(context: MarketPoolsContext, row: SnapshotRow): MarketPoolSnapshot {
    return {
      canonicalRevision: row.canonical_revision,
      chainId: context.chainId,
      generatedAt: row.created_at.toISOString(),
      metricVersion: row.metric_version,
      minutes: context.minutes,
      rows: row.rows,
      version: row.version,
      windowEnd: row.window_end.toISOString(),
      windowStart: row.window_start.toISOString(),
    };
  }

  #emptySnapshot(context: MarketPoolsContext): MarketPoolSnapshot {
    const now = this.#validNow();
    return {
      canonicalRevision: "canonical:v1:empty",
      chainId: context.chainId,
      generatedAt: now.toISOString(),
      metricVersion: MARKET_METRIC_VERSION,
      minutes: context.minutes,
      rows: [],
      version: "0",
      windowEnd: now.toISOString(),
      windowStart: new Date(now.getTime() - context.minutes * 60_000).toISOString(),
    };
  }

  #filterSnapshot(context: MarketPoolsContext, snapshot: MarketPoolSnapshot): MarketPoolSnapshot {
    const protocols = new Set(context.protocols);
    return {
      ...snapshot,
      rows: snapshot.rows.filter(({ protocol }) => protocols.has(protocol)),
    };
  }

  #filterEnvelope(
    context: MarketPoolsContext,
    envelope: MarketStreamEnvelope,
  ): MarketStreamEnvelope {
    if (!filteredStream(context)) return envelope;
    let data = envelope.data;
    if (data && "rows" in data) {
      data = this.#filterSnapshot(context, data);
    } else if (data && "upserts" in data) {
      const protocols = new Set(context.protocols);
      data = {
        ...data,
        upserts: data.upserts.filter(({ protocol }) => protocols.has(protocol)),
      };
    }
    return {
      ...envelope,
      cursor: wrapFilteredCursor(context, envelope.cursor),
      data,
      streamKey: marketStreamKey(context),
    };
  }

  #validNow(): Date {
    const now = this.#now();
    if (!Number.isFinite(now.getTime())) throw new RangeError("Market provider clock is invalid");
    return now;
  }

  async #lockStream(client: PoolClient, context: MarketPoolsContext): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [
      1_294_125_907,
      context.minutes,
    ]);
  }

  async #insertOutbox(
    client: PoolClient,
    context: MarketPoolsContext,
    envelope: MarketStreamEnvelope,
  ): Promise<void> {
    await client.query(
      `INSERT INTO market_stream_outbox (
         stream_key, chain_id, window_minutes, epoch, sequence, cursor,
         event_type, mode, envelope, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        storageStreamKey(context),
        context.chainId,
        context.minutes,
        envelope.epoch,
        envelope.sequence,
        envelope.cursor,
        envelope.eventType,
        envelope.mode,
        JSON.stringify(envelope),
        envelope.emittedAt,
      ],
    );
  }
}
