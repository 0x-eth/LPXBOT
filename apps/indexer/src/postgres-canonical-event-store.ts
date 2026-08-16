import { createHash } from "node:crypto";

import type {
  LiquidityFlowEvent,
  LiquidityFlowTombstone,
  MarketPoolDiff,
  MarketPoolRow,
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "@lpbot/api-contract";
import {
  MARKET_METRIC_VERSION,
  POOL_LABEL_RULE_CONTRACT,
  computePoolLabels,
  computeMarketWindows,
  poolMetricKey,
  type ComputedPoolLabel,
  type MarketMetricEvent,
  type MarketWindowResult,
  type PoolMetricRow,
} from "@lpbot/market-metrics";
import type { Pool, PoolClient } from "pg";

import {
  PostgresCandleTickReadModelProjector,
  addCandleTickReadModelImpact,
  createCandleTickReadModelImpact,
  type CandleTickReadModelImpact,
} from "./candle-tick-read-model.js";
import { projectLiquidityFlowEvent } from "./liquidity-flow.js";
import type {
  CanonicalCommit,
  CanonicalEventStore,
  IndexerCursor,
  IndexerRunResult,
  NormalizedPoolEvent,
  RawLogDelivery,
} from "./types.js";

interface StoredRawLog {
  payload_hash: string;
  raw_payload: unknown;
}

interface StoredMetricEvent {
  block_timestamp: Date;
  chain_id: string;
  event_id: string;
  fee_pips: string | null;
  finality: string;
  hooks: string | null;
  kind: MarketMetricEvent["kind"];
  market_data: MarketMetricEvent["market"] & {
    token0Symbol?: string | null;
    token1Symbol?: string | null;
  };
  pool_address: string | null;
  pool_id: string | null;
  protocol: MarketMetricEvent["pool"]["protocol"];
  liquidity_delta: string | null;
  sqrt_price_x96: string | null;
  tick_spacing: string | null;
  token0: string | null;
  token1: string | null;
  transaction_hash: string;
}

interface ProjectedPoolMetricRow extends PoolMetricRow {
  labelRuleVersion: string;
  labels: ComputedPoolLabel[];
}

interface CurrentSnapshotRow {
  rows: ProjectedPoolMetricRow[];
  snapshot_hash: string;
  version: string;
}

interface OutboxPosition {
  epoch: string;
  sequence: string;
}

interface AffectedPoolRow {
  block_timestamp: Date;
  chain_id: string;
  kind: NormalizedPoolEvent["kind"];
  pool_address: string | null;
  pool_id: string | null;
}

interface StoredFlowEvent {
  record: LiquidityFlowEvent;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function payloadHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function toMarketPoolRow(row: ProjectedPoolMetricRow): MarketPoolRow {
  if (row.chainId !== 56) throw new RangeError("MARKET_CHAIN_UNSUPPORTED");
  return {
    ...row,
    chainId: 56,
    hooks: row.hooks as MarketPoolRow["hooks"],
    poolAddress: row.poolAddress as MarketPoolRow["poolAddress"],
    poolId: row.poolId as MarketPoolRow["poolId"],
    token0Address: row.token0Address as MarketPoolRow["token0Address"],
    token1Address: row.token1Address as MarketPoolRow["token1Address"],
  };
}

function identityFromAffected(row: AffectedPoolRow): string | null {
  const identity = row.pool_address ?? row.pool_id;
  return identity ? `${row.chain_id}:${identity.toLowerCase()}` : null;
}

function changedRows(
  previous: readonly ProjectedPoolMetricRow[],
  current: readonly ProjectedPoolMetricRow[],
) {
  const previousByKey = new Map(previous.map((row) => [poolMetricKey(row), stableJson(row)]));
  return current.filter((row) => previousByKey.get(poolMetricKey(row)) !== stableJson(row));
}

function removedRows(
  previous: readonly ProjectedPoolMetricRow[],
  current: readonly ProjectedPoolMetricRow[],
) {
  const currentKeys = new Set(current.map(poolMetricKey));
  return previous.map(poolMetricKey).filter((key) => !currentKeys.has(key));
}

function cursorFromRow(row: {
  block_hash: string;
  block_number: string;
  chain_id: string;
  cursor: string;
  log_index: string;
  transaction_index: string;
}): IndexerCursor {
  return {
    blockHash: row.block_hash,
    blockNumber: row.block_number,
    chainId: Number(row.chain_id),
    logIndex: Number(row.log_index),
    transactionIndex: Number(row.transaction_index),
    value: row.cursor,
  };
}

export class PostgresCanonicalEventStore implements CanonicalEventStore {
  readonly #pool: Pool;
  readonly #readModels = new PostgresCandleTickReadModelProjector();

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async getCursor(chainId: number): Promise<IndexerCursor | null> {
    const result = await this.#pool.query<{
      block_hash: string;
      block_number: string;
      chain_id: string;
      cursor: string;
      log_index: string;
      transaction_index: string;
    }>(
      `SELECT chain_id::text, block_number::text, block_hash,
              transaction_index::text, log_index::text, cursor
         FROM indexer_cursors
        WHERE chain_id = $1`,
      [chainId],
    );
    return result.rows[0] ? cursorFromRow(result.rows[0]) : null;
  }

  async commit(commit: CanonicalCommit): Promise<IndexerRunResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [
        1_279_283_791,
        commit.chainId,
      ]);
      let acceptedCount = 0;
      let conflictCount = 0;
      let duplicateCount = 0;
      let revertedCount = 0;
      let pending = false;
      const pendingPoolKeys = new Set<string>();
      let pendingReadModels = createCandleTickReadModelImpact();
      let lastAccepted: NormalizedPoolEvent | null = null;

      const flushAccepted = async () => {
        if (!pending || !lastAccepted) return;
        await this.#writeCursor(client, lastAccepted.cursor, commit.evaluationTime);
        await this.#rebuildPoolCatalog(
          client,
          commit.chainId,
          pendingPoolKeys,
          commit.evaluationTime,
        );
        await this.#readModels.rebuild(client, {
          evaluationTime: commit.evaluationTime,
          impact: pendingReadModels,
          sourceCursor: lastAccepted.cursor.value,
        });
        await this.#recomputeAndPersist(client, commit, new Set());
        pendingPoolKeys.clear();
        pendingReadModels = createCandleTickReadModelImpact();
        pending = false;
      };

      for (let index = 0; index < commit.events.length; index += 1) {
        const event = commit.events[index]!;
        const delivery = commit.deliveries[index]!;
        if (event.removed) {
          await flushAccepted();
          const reverted = await this.#revertFromHeight(
            client,
            commit,
            event.blockNumber,
            event.blockHash,
          );
          revertedCount += reverted.count;
          if (reverted.count > 0) {
            await this.#rebuildPoolCatalog(
              client,
              commit.chainId,
              reverted.poolKeys,
              commit.evaluationTime,
            );
            const rewoundCursor = await this.#getCursor(client, commit.chainId);
            await this.#readModels.rebuild(client, {
              evaluationTime: commit.evaluationTime,
              impact: reverted.readModels,
              sourceCursor: rewoundCursor?.value ?? null,
            });
            await this.#recomputeAndPersist(client, commit, reverted.poolKeys);
          }
          continue;
        }

        const incomingPayload = { block: delivery.block, event, log: delivery.log };
        const incomingHash = payloadHash(incomingPayload);
        const existing = await client.query<StoredRawLog>(
          `SELECT payload_hash, raw_payload
             FROM raw_chain_logs
            WHERE chain_id = $1 AND block_hash = $2
              AND transaction_hash = $3 AND log_index = $4
            FOR UPDATE`,
          [event.chainId, event.blockHash, event.transactionHash, event.logIndex],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].payload_hash === incomingHash) duplicateCount += 1;
          else {
            conflictCount += 1;
            await client.query(
              `INSERT INTO integrity_quarantine (
                 chain_id, block_hash, transaction_hash, log_index,
                 existing_payload_hash, incoming_payload_hash,
                 existing_payload, incoming_payload, reason, status, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
                         'same-key-different-payload', 'quarantined', $9)
               ON CONFLICT DO NOTHING`,
              [
                event.chainId,
                event.blockHash,
                event.transactionHash,
                event.logIndex,
                existing.rows[0].payload_hash,
                incomingHash,
                stableJson(existing.rows[0].raw_payload),
                stableJson(incomingPayload),
                commit.evaluationTime,
              ],
            );
          }
          continue;
        }

        const reorgHeight = await this.#reorgHeight(client, delivery);
        if (reorgHeight !== null) {
          await flushAccepted();
          const reverted = await this.#revertFromHeight(client, commit, reorgHeight, null);
          revertedCount += reverted.count;
          if (reverted.count > 0) {
            await this.#rebuildPoolCatalog(
              client,
              commit.chainId,
              reverted.poolKeys,
              commit.evaluationTime,
            );
            const rewoundCursor = await this.#getCursor(client, commit.chainId);
            await this.#readModels.rebuild(client, {
              evaluationTime: commit.evaluationTime,
              impact: reverted.readModels,
              sourceCursor: rewoundCursor?.value ?? null,
            });
            await this.#recomputeAndPersist(client, commit, reverted.poolKeys);
          }
        }

        await this.#upsertBlock(client, delivery, commit.evaluationTime);
        await this.#insertRawLog(
          client,
          delivery,
          incomingHash,
          incomingPayload,
          commit.evaluationTime,
        );
        await this.#insertEvent(client, event, incomingHash, commit.evaluationTime);
        await this.#insertFlowEvent(client, event, commit.evaluationTime);
        acceptedCount += 1;
        lastAccepted = event;
        pendingPoolKeys.add(
          poolMetricKey({
            chainId: event.chainId,
            poolAddress: event.pool.poolAddress,
            poolId: event.pool.poolId,
          }),
        );
        addCandleTickReadModelImpact(pendingReadModels, {
          blockTimestamp: event.blockTimestamp,
          chainId: event.chainId,
          kind: event.kind,
          poolAddress: event.pool.poolAddress,
          poolId: event.pool.poolId,
        });
        pending = true;
      }

      await flushAccepted();
      const cursor = await this.#getCursor(client, commit.chainId);
      await client.query("COMMIT");
      return { acceptedCount, conflictCount, cursor, duplicateCount, revertedCount };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #getCursor(client: PoolClient, chainId: number): Promise<IndexerCursor | null> {
    const result = await client.query<{
      block_hash: string;
      block_number: string;
      chain_id: string;
      cursor: string;
      log_index: string;
      transaction_index: string;
    }>(
      `SELECT chain_id::text, block_number::text, block_hash,
              transaction_index::text, log_index::text, cursor
         FROM indexer_cursors WHERE chain_id = $1`,
      [chainId],
    );
    return result.rows[0] ? cursorFromRow(result.rows[0]) : null;
  }

  async #insertRawLog(
    client: PoolClient,
    delivery: RawLogDelivery,
    hash: string,
    rawPayload: unknown,
    observedAt: string,
  ): Promise<void> {
    const log = delivery.log;
    await client.query(
      `INSERT INTO raw_chain_logs (
         chain_id, block_number, block_hash, transaction_hash, transaction_index,
         log_index, contract_address, topics, data, removed, canonical,
         payload_hash, raw_payload, observed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, false, true,
                 $10, $11::jsonb, $12)`,
      [
        log.chainId,
        log.blockNumber,
        log.blockHash,
        log.transactionHash,
        log.transactionIndex,
        log.logIndex,
        log.address,
        stableJson(log.topics),
        log.data,
        hash,
        stableJson(rawPayload),
        observedAt,
      ],
    );
  }

  async #insertEvent(
    client: PoolClient,
    event: NormalizedPoolEvent,
    hash: string,
    createdAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO normalized_pool_events (
         event_id, schema_version, chain_id, block_number, block_hash, block_timestamp,
         transaction_hash, transaction_index, log_index, contract_address,
         protocol, protocol_generation, kind, finality, canonical, cursor,
         pool_address, pool_id, token0, token1, fee_pips, tick_spacing, hooks,
         amount0, amount1, liquidity_delta, sqrt_price_x96,
         payload, market_data, raw_ref, payload_hash, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, 'observed', true, $14,
         $15, $16, $17, $18, $19, $20, $21,
         $22, $23, $24, $25, $26::jsonb, $27::jsonb, $28, $29, $30
       )`,
      [
        event.eventId,
        event.schemaVersion,
        event.chainId,
        event.blockNumber,
        event.blockHash,
        event.blockTimestamp,
        event.transactionHash,
        event.transactionIndex,
        event.logIndex,
        event.contractAddress,
        event.protocol,
        event.protocolGeneration,
        event.kind,
        event.cursor.value,
        event.pool.poolAddress,
        event.pool.poolId,
        event.pool.token0,
        event.pool.token1,
        event.pool.feePips,
        event.pool.tickSpacing,
        event.pool.hooks,
        event.amount0,
        event.amount1,
        event.liquidityDelta,
        event.sqrtPriceX96,
        stableJson(event.payload),
        stableJson(event.market),
        event.rawRef,
        hash,
        createdAt,
      ],
    );
  }

  async #insertFlowEvent(
    client: PoolClient,
    event: NormalizedPoolEvent,
    createdAt: string,
  ): Promise<void> {
    const projected = projectLiquidityFlowEvent(event);
    if (!projected) return;
    const sourceCursor = projected.cursor;
    const position = await this.#nextFlowPosition(client, projected.id, "event");
    const record: LiquidityFlowEvent = { ...projected, cursor: position.cursor };
    await client.query(
      `INSERT INTO liquidity_flow_events (
         event_id, schema_version, chain_id, block_number, block_hash,
         transaction_hash, transaction_index, log_index, occurred_at_milliseconds,
         protocol, protocol_generation, event_type, finality, canonical,
         source_cursor, replay_cursor, pool_address, pool_id, token0, token1,
         user_address, nft_id, usd_value, in_range, amount0, amount1,
         liquidity_delta, record, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, 'observed', true, $13, $14, $15, $16, $17, $18,
         $19, NULL, NULL, NULL, $20, $21, $22, $23::jsonb, $24
       )`,
      [
        record.id,
        record.schema_version,
        record.chain_id,
        record.block_number,
        record.block_hash,
        record.tx_hash,
        record.tx_index,
        record.log_index,
        record.ts,
        record.dex,
        record.version,
        record.event_type,
        sourceCursor,
        record.cursor,
        record.pool_address,
        record.pool_id,
        record.token0_address,
        record.token1_address,
        record.user,
        record.amount0,
        record.amount1,
        record.liquidity_delta,
        stableJson(record),
        createdAt,
      ],
    );
    await this.#insertFlowOutbox(client, position.sequence, record, record.id, createdAt);
  }

  async #nextFlowPosition(
    client: PoolClient,
    relatedEventId: string,
    recordType: "event" | "heartbeat" | "tombstone",
  ): Promise<{ cursor: string; sequence: string }> {
    const latest = await client.query<{ sequence: string }>(
      `SELECT sequence::text
         FROM liquidity_flow_outbox
        WHERE chain_id = 56
        ORDER BY liquidity_flow_outbox.sequence DESC
        LIMIT 1
        FOR UPDATE`,
    );
    const sequence = latest.rows[0] ? (BigInt(latest.rows[0].sequence) + 1n).toString() : "1";
    const digest = payloadHash({ recordType, relatedEventId, sequence }).slice(0, 16);
    return { cursor: `flow:v1:56:${sequence}:${digest}`, sequence };
  }

  async #insertFlowOutbox(
    client: PoolClient,
    sequence: string,
    record: LiquidityFlowEvent | LiquidityFlowTombstone,
    relatedEventId: string,
    createdAt: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO liquidity_flow_outbox (
         sequence, chain_id, cursor, record_type, related_event_id,
         occurred_at_milliseconds, protocol, protocol_generation, event_type,
         pool_address, pool_id, token0, token1, user_address, nft_id,
         payload, created_at
       ) VALUES (
         $1, 56, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, NULL, $14::jsonb, $15
       )`,
      [
        sequence,
        record.cursor,
        record.record_type,
        relatedEventId,
        record.ts,
        record.dex,
        record.version,
        record.record_type === "event" ? record.event_type : null,
        record.pool_address,
        record.pool_id,
        record.token0_address,
        record.token1_address,
        record.user,
        stableJson(record),
        createdAt,
      ],
    );
  }

  async #appendFlowTombstones(
    client: PoolClient,
    commit: CanonicalCommit,
    blockNumber: string,
    blockHash: string | null,
  ): Promise<void> {
    const parameters: unknown[] = [commit.chainId, blockNumber];
    const hashClause = blockHash ? " AND block_hash = $3" : "";
    if (blockHash) parameters.push(blockHash);
    const affected = await client.query<StoredFlowEvent>(
      `SELECT record
         FROM liquidity_flow_events
        WHERE chain_id = $1 AND block_number >= $2 AND canonical${hashClause}
        ORDER BY block_number, transaction_index, log_index, transaction_hash, event_id
        FOR UPDATE`,
      parameters,
    );
    for (const { record: event } of affected.rows) {
      const id = payloadHash({ recordType: "tombstone", revertedId: event.id });
      const position = await this.#nextFlowPosition(client, event.id, "tombstone");
      const tombstone: LiquidityFlowTombstone = {
        cursor: position.cursor,
        dex: event.dex,
        finality: "reverted",
        id,
        nft_id: null,
        pool_address: event.pool_address,
        pool_id: event.pool_id,
        reason: "reorg",
        record_type: "tombstone",
        reverted_id: event.id,
        schema_version: "1.0.0",
        token0_address: event.token0_address,
        token1_address: event.token1_address,
        ts: event.ts,
        user: event.user,
        version: event.version,
      };
      await this.#insertFlowOutbox(
        client,
        position.sequence,
        tombstone,
        event.id,
        commit.evaluationTime,
      );
    }
  }

  async #upsertBlock(
    client: PoolClient,
    delivery: RawLogDelivery,
    observedAt: string,
  ): Promise<void> {
    const block = delivery.block;
    await client.query(
      `INSERT INTO canonical_chain_blocks (
         chain_id, block_number, block_hash, parent_hash, block_timestamp,
         canonical, observed_at, reverted_at
       ) VALUES ($1, $2, $3, $4, $5, true, $6, NULL)
       ON CONFLICT (chain_id, block_hash) DO UPDATE SET
         block_number = EXCLUDED.block_number,
         parent_hash = EXCLUDED.parent_hash,
         block_timestamp = EXCLUDED.block_timestamp,
         canonical = true,
         reverted_at = NULL`,
      [
        block.chainId,
        block.blockNumber,
        block.blockHash,
        block.parentHash,
        block.blockTimestamp,
        observedAt,
      ],
    );
  }

  async #reorgHeight(client: PoolClient, delivery: RawLogDelivery): Promise<string | null> {
    const sameHeight = await client.query<{ block_hash: string }>(
      `SELECT block_hash FROM canonical_chain_blocks
        WHERE chain_id = $1 AND block_number = $2 AND canonical
        FOR UPDATE`,
      [delivery.block.chainId, delivery.block.blockNumber],
    );
    if (sameHeight.rows[0] && sameHeight.rows[0].block_hash !== delivery.block.blockHash) {
      return delivery.block.blockNumber;
    }
    if (!delivery.block.parentHash) return null;
    const latest = await client.query<{ block_hash: string; block_number: string }>(
      `SELECT block_number::text, block_hash
         FROM canonical_chain_blocks
        WHERE chain_id = $1 AND block_number < $2 AND canonical
        ORDER BY block_number DESC LIMIT 1
        FOR UPDATE`,
      [delivery.block.chainId, delivery.block.blockNumber],
    );
    if (
      latest.rows[0] &&
      BigInt(latest.rows[0].block_number) + 1n !== BigInt(delivery.block.blockNumber)
    ) {
      return null;
    }
    if (!latest.rows[0] || latest.rows[0].block_hash === delivery.block.parentHash) return null;
    const ancestor = await client.query<{ block_number: string }>(
      `SELECT block_number::text
         FROM canonical_chain_blocks
        WHERE chain_id = $1 AND block_hash = $2 AND canonical`,
      [delivery.block.chainId, delivery.block.parentHash],
    );
    return ancestor.rows[0]
      ? (BigInt(ancestor.rows[0].block_number) + 1n).toString()
      : delivery.block.blockNumber;
  }

  async #revertFromHeight(
    client: PoolClient,
    commit: CanonicalCommit,
    blockNumber: string,
    blockHash: string | null,
  ): Promise<{
    count: number;
    poolKeys: Set<string>;
    readModels: CandleTickReadModelImpact;
  }> {
    const parameters: unknown[] = [commit.chainId, blockNumber];
    const hashClause = blockHash ? " AND block_hash = $3" : "";
    const timeParameter = blockHash ? "$4" : "$3";
    if (blockHash) parameters.push(blockHash);
    const affected = await client.query<AffectedPoolRow>(
      `SELECT chain_id::text, pool_address, pool_id, block_timestamp, kind
         FROM normalized_pool_events
        WHERE chain_id = $1 AND block_number >= $2 AND canonical${hashClause}
        ORDER BY block_number, transaction_index, log_index
        FOR UPDATE`,
      parameters,
    );
    if (affected.rowCount === 0) {
      return {
        count: 0,
        poolKeys: new Set(),
        readModels: createCandleTickReadModelImpact(),
      };
    }

    await this.#appendFlowTombstones(client, commit, blockNumber, blockHash);
    await client.query(
      `UPDATE normalized_pool_events
          SET canonical = false, finality = 'reverted', reverted_at = ${timeParameter}
        WHERE chain_id = $1 AND block_number >= $2 AND canonical${hashClause}`,
      blockHash
        ? [commit.chainId, blockNumber, blockHash, commit.evaluationTime]
        : [commit.chainId, blockNumber, commit.evaluationTime],
    );
    await client.query(
      `UPDATE liquidity_flow_events
          SET canonical = false, finality = 'reverted', reverted_at = ${timeParameter}
        WHERE chain_id = $1 AND block_number >= $2 AND canonical${hashClause}`,
      blockHash
        ? [commit.chainId, blockNumber, blockHash, commit.evaluationTime]
        : [commit.chainId, blockNumber, commit.evaluationTime],
    );
    await client.query(
      `UPDATE raw_chain_logs
          SET canonical = false, removed = true, reverted_at = ${timeParameter}
        WHERE chain_id = $1 AND block_number >= $2 AND canonical${hashClause}`,
      blockHash
        ? [commit.chainId, blockNumber, blockHash, commit.evaluationTime]
        : [commit.chainId, blockNumber, commit.evaluationTime],
    );
    await client.query(
      `UPDATE canonical_chain_blocks
          SET canonical = false, reverted_at = ${timeParameter}
        WHERE chain_id = $1 AND block_number >= $2 AND canonical${hashClause}`,
      blockHash
        ? [commit.chainId, blockNumber, blockHash, commit.evaluationTime]
        : [commit.chainId, blockNumber, commit.evaluationTime],
    );
    await this.#rewindCursor(client, commit.chainId, blockNumber, commit.evaluationTime);
    const readModels = createCandleTickReadModelImpact();
    for (const row of affected.rows) {
      addCandleTickReadModelImpact(readModels, {
        blockTimestamp: row.block_timestamp,
        chainId: Number(row.chain_id),
        kind: row.kind,
        poolAddress: row.pool_address,
        poolId: row.pool_id,
      });
    }
    return {
      count: affected.rowCount ?? 0,
      poolKeys: new Set(
        affected.rows.map(identityFromAffected).filter((key): key is string => !!key),
      ),
      readModels,
    };
  }

  async #rewindCursor(
    client: PoolClient,
    chainId: number,
    beforeBlock: string,
    updatedAt: string,
  ): Promise<void> {
    const ancestor = await client.query<{
      block_hash: string;
      block_number: string;
      cursor: string;
      log_index: string;
      transaction_index: string;
    }>(
      `SELECT block_number::text, block_hash, transaction_index::text,
              log_index::text, cursor
         FROM normalized_pool_events
        WHERE chain_id = $1 AND block_number < $2 AND canonical
        ORDER BY block_number DESC, transaction_index DESC, log_index DESC,
                 transaction_hash DESC
        LIMIT 1`,
      [chainId, beforeBlock],
    );
    if (!ancestor.rows[0]) {
      await client.query("DELETE FROM indexer_cursors WHERE chain_id = $1", [chainId]);
      return;
    }
    await client.query(
      `INSERT INTO indexer_cursors (
         chain_id, block_number, block_hash, transaction_index, log_index, cursor, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chain_id) DO UPDATE SET
         block_number = EXCLUDED.block_number,
         block_hash = EXCLUDED.block_hash,
         transaction_index = EXCLUDED.transaction_index,
         log_index = EXCLUDED.log_index,
         cursor = EXCLUDED.cursor,
         updated_at = EXCLUDED.updated_at`,
      [
        chainId,
        ancestor.rows[0].block_number,
        ancestor.rows[0].block_hash,
        ancestor.rows[0].transaction_index,
        ancestor.rows[0].log_index,
        ancestor.rows[0].cursor,
        updatedAt,
      ],
    );
  }

  async #writeCursor(client: PoolClient, cursor: IndexerCursor, updatedAt: string): Promise<void> {
    await client.query(
      `INSERT INTO indexer_cursors (
         chain_id, block_number, block_hash, transaction_index, log_index, cursor, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chain_id) DO UPDATE SET
         block_number = EXCLUDED.block_number,
         block_hash = EXCLUDED.block_hash,
         transaction_index = EXCLUDED.transaction_index,
         log_index = EXCLUDED.log_index,
         cursor = EXCLUDED.cursor,
         updated_at = EXCLUDED.updated_at`,
      [
        cursor.chainId,
        cursor.blockNumber,
        cursor.blockHash,
        cursor.transactionIndex,
        cursor.logIndex,
        cursor.value,
        updatedAt,
      ],
    );
  }

  async #rebuildPoolCatalog(
    client: PoolClient,
    chainId: number,
    poolKeys: ReadonlySet<string>,
    updatedAt: string,
  ): Promise<void> {
    const keys = [...poolKeys].sort();
    if (keys.length === 0) return;
    await client.query(
      `DELETE FROM market_pool_catalog
        WHERE chain_id = $1 AND pool_key = ANY($2::text[])`,
      [chainId, keys],
    );
    await client.query(
      `INSERT INTO market_pool_catalog (
         pool_key, chain_id, protocol, protocol_generation, pool_address, pool_id,
         token0, token1, fee_pips, tick_spacing, hooks, first_observed_block,
         first_observed_at, first_observed_transaction_hash, created_event_id, updated_at
       )
       SELECT DISTINCT ON (identity.pool_key)
         identity.pool_key, event.chain_id, event.protocol, event.protocol_generation,
         lower(event.pool_address), lower(event.pool_id), lower(event.token0), lower(event.token1),
         event.fee_pips, event.tick_spacing, lower(event.hooks), event.block_number,
         event.block_timestamp, lower(event.transaction_hash), event.event_id, $3
       FROM normalized_pool_events AS event
       CROSS JOIN LATERAL (
         SELECT event.chain_id::text || ':' || lower(COALESCE(event.pool_address, event.pool_id))
           AS pool_key
       ) AS identity
       WHERE event.chain_id = $1
         AND event.canonical
         AND event.token0 IS NOT NULL
         AND event.token1 IS NOT NULL
         AND identity.pool_key = ANY($2::text[])
       ORDER BY identity.pool_key, event.block_number, event.transaction_index,
                event.log_index, event.transaction_hash, event.event_id`,
      [chainId, keys, updatedAt],
    );
  }

  async #metricEvents(client: PoolClient, evaluationTime: string): Promise<MarketMetricEvent[]> {
    const result = await client.query<StoredMetricEvent>(
      `SELECT event_id, chain_id::text, block_timestamp, transaction_hash, kind,
              protocol, pool_address, pool_id, token0, token1, fee_pips::text,
              tick_spacing::text, hooks, market_data, finality,
              liquidity_delta::text, sqrt_price_x96::text
         FROM normalized_pool_events
        WHERE chain_id = 56 AND canonical AND block_timestamp < $1
        ORDER BY block_timestamp, block_number, transaction_index, log_index, transaction_hash`,
      [evaluationTime],
    );
    return result.rows.map((row) => ({
      blockTimestamp: row.block_timestamp.toISOString(),
      chainId: Number(row.chain_id),
      eventId: row.event_id,
      kind: row.kind,
      liquidityDelta: row.liquidity_delta,
      market: row.market_data,
      pool: {
        feePips: row.fee_pips,
        hooks: row.hooks,
        poolAddress: row.pool_address,
        poolId: row.pool_id,
        protocol: row.protocol,
        tickSpacing: row.tick_spacing,
        token0Address: row.token0,
        token0Symbol: row.market_data.token0Symbol ?? null,
        token1Address: row.token1,
        token1Symbol: row.market_data.token1Symbol ?? null,
      },
      reverted: row.finality === "reverted",
      sqrtPriceX96: row.sqrt_price_x96,
      transactionHash: row.transaction_hash,
    }));
  }

  async #recomputeAndPersist(
    client: PoolClient,
    commit: CanonicalCommit,
    forcedTombstones: ReadonlySet<string>,
  ): Promise<void> {
    const events = await this.#metricEvents(client, commit.evaluationTime);
    const windows = computeMarketWindows(events, {
      end: commit.evaluationTime,
      windowComplete: true,
    });
    const canonicalRevision = `canonical:v1:${payloadHash(events)}`;
    const sourceCursor = await this.#getCursor(client, commit.chainId);
    for (const window of windows) {
      const projected: MarketWindowResult & { rows: ProjectedPoolMetricRow[] } = {
        ...window,
        rows: window.rows.map((row) => ({
          ...row,
          labelRuleVersion: POOL_LABEL_RULE_CONTRACT.ruleVersion,
          labels: computePoolLabels({
            canonicalRevision,
            events,
            metricVersion: MARKET_METRIC_VERSION,
            row,
            windowEnd: window.end,
            windowMinutes: window.minutes,
            windowStart: window.start,
          }),
        })),
      };
      await this.#persistWindow(
        client,
        commit,
        projected,
        canonicalRevision,
        sourceCursor?.value ?? null,
        forcedTombstones,
      );
    }
  }

  async #persistWindow(
    client: PoolClient,
    commit: CanonicalCommit,
    window: MarketWindowResult & { rows: ProjectedPoolMetricRow[] },
    canonicalRevision: string,
    sourceCursor: string | null,
    forcedTombstones: ReadonlySet<string>,
  ): Promise<void> {
    const streamKey = `top-fees:${commit.chainId}:${window.minutes}`;
    const current = await client.query<CurrentSnapshotRow>(
      `SELECT version::text, snapshot_hash, rows
         FROM market_snapshots
        WHERE stream_key = $1 AND canonical
        FOR UPDATE`,
      [streamKey],
    );
    const previous = current.rows[0];
    const rows = window.rows;
    const hash = payloadHash(rows);
    if (previous && previous.snapshot_hash === hash && forcedTombstones.size === 0) return;

    const version = previous ? (BigInt(previous.version) + 1n).toString() : "1";
    if (previous) {
      await client.query(
        `UPDATE market_snapshots
            SET canonical = false, superseded_at = $2
          WHERE stream_key = $1 AND canonical`,
        [streamKey, commit.evaluationTime],
      );
    }
    await client.query(
      `INSERT INTO market_snapshots (
         stream_key, chain_id, window_minutes, window_start, window_end,
         version, source_cursor, canonical_revision, metric_version, label_rule_version,
         snapshot_hash, rows, canonical, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, true, $13)`,
      [
        streamKey,
        commit.chainId,
        window.minutes,
        window.start,
        window.end,
        version,
        sourceCursor,
        canonicalRevision,
        MARKET_METRIC_VERSION,
        POOL_LABEL_RULE_CONTRACT.ruleVersion,
        hash,
        stableJson(rows),
        commit.evaluationTime,
      ],
    );

    const lastOutbox = await client.query<OutboxPosition>(
      `SELECT o.epoch::text, o.sequence::text
         FROM market_stream_outbox AS o
        WHERE o.stream_key = $1
        ORDER BY o.epoch DESC, o.sequence DESC LIMIT 1
        FOR UPDATE`,
      [streamKey],
    );
    const epoch = lastOutbox.rows[0]?.epoch ?? "1";
    const sequence = lastOutbox.rows[0]
      ? (BigInt(lastOutbox.rows[0].sequence) + 1n).toString()
      : "1";
    const cursor = `market:v1:${streamKey}:${epoch}:${sequence}:${hash.slice(0, 16)}`;
    const marketRows = rows.map(toMarketPoolRow);
    let data: MarketPoolSnapshot | MarketPoolDiff;
    let eventType: MarketStreamEnvelope["eventType"];
    let mode: MarketStreamEnvelope["mode"];
    if (!previous) {
      data = {
        canonicalRevision,
        chainId: 56,
        generatedAt: commit.evaluationTime,
        metricVersion: MARKET_METRIC_VERSION,
        minutes: window.minutes,
        rows: marketRows,
        version,
        windowEnd: window.end,
        windowStart: window.start,
      };
      eventType = "pools.snapshot";
      mode = "snapshot";
    } else {
      const tombstones = new Set([...removedRows(previous.rows, rows), ...forcedTombstones]);
      data = {
        canonicalRevision,
        metricVersion: MARKET_METRIC_VERSION,
        tombstones: [...tombstones].sort(),
        upserts: changedRows(previous.rows, rows)
          .filter((row) => !forcedTombstones.has(poolMetricKey(row)))
          .map(toMarketPoolRow),
        version,
        windowEnd: window.end,
      };
      eventType = "pools.diff";
      mode = "diff";
    }
    const envelope: MarketStreamEnvelope = {
      cursor,
      data,
      emittedAt: commit.evaluationTime,
      epoch,
      eventType,
      mode,
      schemaVersion: "1.0.0",
      sequence,
      streamKey,
    };
    await client.query(
      `INSERT INTO market_stream_outbox (
         stream_key, chain_id, window_minutes, epoch, sequence, cursor,
         event_type, mode, envelope, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        streamKey,
        commit.chainId,
        window.minutes,
        epoch,
        sequence,
        cursor,
        eventType,
        mode,
        stableJson(envelope),
        commit.evaluationTime,
      ],
    );
  }
}
