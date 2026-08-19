import { randomUUID } from "node:crypto";

import type {
  PricingPosition,
  PricingPositionObservation,
  PricingPositionPage,
  PricingPositionPriceStatus,
  PricingPositionStatus,
} from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  PricingPositionError,
  type PricingPositionEventStore,
  type PricingPositionOutboxEvent,
  type PricingPositionScope,
  type PricingPositionStore,
  type PricingPositionStoreImportInput,
  type PricingPositionStoreTransitionInput,
  type PricingPositionStreamSnapshot,
} from "./pricing-positions.js";

interface PricingRow extends QueryResultRow {
  chain_id: string;
  cost_amount0_base_unit: string;
  cost_amount1_base_unit: string;
  cost_price_observed_at: Date | null;
  cost_price_source: string | null;
  cost_price_status: PricingPositionPriceStatus;
  cost_usd_value_decimal: string | null;
  imported_at: Date;
  platform_id: number;
  pool_address: `0x${string}` | null;
  pool_id: `0x${string}` | null;
  position_manager: `0x${string}`;
  pricing_id: string;
  revision: string;
  state_created_at: Date;
  status: PricingPositionStatus;
  token0: `0x${string}`;
  token1: `0x${string}`;
  token_id: string;
  wallet_address: `0x${string}`;
  wallet_id: string;
}

interface ObservationRow extends QueryResultRow {
  block_hash: `0x${string}`;
  block_number: string;
  liquidity_amount0_base_unit: string;
  liquidity_amount1_base_unit: string;
  liquidity_raw: string;
  observation_id: string;
  observed_at: Date;
  observed_fee0_base_unit: string;
  observed_fee1_base_unit: string;
  page_snapshot_digest: `0x${string}`;
  recorded_at: Date;
  snapshot_digest: `0x${string}`;
}

interface StreamHeadRow extends QueryResultRow {
  epoch: string;
  latest_sequence: string;
  oldest_sequence: string;
}

interface OutboxRow extends QueryResultRow {
  created_at: Date;
  epoch: string;
  event_id: string;
  event_type: "diff" | "tombstone";
  payload: unknown;
  pricing_id: string;
  revision: string;
  sequence: string;
  tenant_id: string;
  user_id: string;
}

type Queryable = Pick<Pool | PoolClient, "query">;

const pricingColumns = `
  position.pricing_id::text, position.wallet_id::text, position.wallet_address,
  position.chain_id::text, position.platform_id, position.position_manager,
  position.token_id::text, position.pool_address, position.pool_id,
  position.token0, position.token1, position.cost_amount0_base_unit::text,
  position.cost_amount1_base_unit::text, position.cost_usd_value_decimal::text,
  position.cost_price_observed_at, position.cost_price_source,
  position.cost_price_status, position.imported_at,
  state.revision::text, state.status, state.created_at AS state_created_at`;

const observationColumns = `
  observation_id::text, page_snapshot_digest, snapshot_digest,
  block_number::text, block_hash, observed_at, recorded_at,
  liquidity_raw::text, liquidity_amount0_base_unit::text,
  liquidity_amount1_base_unit::text, observed_fee0_base_unit::text,
  observed_fee1_base_unit::text`;

function safeRevision(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new RangeError("Stored pricing position revision is invalid");
  }
  return result;
}

function decimalDto(value: string | null): string | null {
  if (value === null) return null;
  if (!value.includes(".")) return value;
  const normalized = value.replace(/0+$/u, "").replace(/\.$/u, "");
  return normalized.length === 0 ? "0" : normalized;
}

function freezePosition(value: PricingPosition): Readonly<PricingPosition> {
  Object.freeze(value.costBasis);
  for (const item of value.observations) Object.freeze(item);
  Object.freeze(value.observations);
  Object.freeze(value.pool);
  return Object.freeze(value);
}

function observationFromRow(row: ObservationRow): PricingPositionObservation {
  return {
    blockHash: row.block_hash,
    blockNumber: row.block_number,
    liquidityAmount0BaseUnit: row.liquidity_amount0_base_unit,
    liquidityAmount1BaseUnit: row.liquidity_amount1_base_unit,
    liquidityRaw: row.liquidity_raw,
    observationId: row.observation_id,
    observedAt: row.observed_at.toISOString(),
    observedFee0BaseUnit: row.observed_fee0_base_unit,
    observedFee1BaseUnit: row.observed_fee1_base_unit,
    pageSnapshotDigest: row.page_snapshot_digest,
    recordedAt: row.recorded_at.toISOString(),
    snapshotDigest: row.snapshot_digest,
  };
}

function positionFromPayload(value: unknown): Readonly<PricingPosition> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError("Stored pricing outbox payload is invalid");
  }
  const position = structuredClone(value) as PricingPosition;
  if (
    typeof position.pricingId !== "string" ||
    !Array.isArray(position.observations) ||
    typeof position.costBasis !== "object" ||
    position.costBasis === null ||
    typeof position.pool !== "object" ||
    position.pool === null
  ) {
    throw new RangeError("Stored pricing outbox payload is invalid");
  }
  return freezePosition(position);
}

export interface PostgresPricingPositionStoreOptions {
  idFactory?: () => string;
}

export class PostgresPricingPositionStore
  implements PricingPositionStore, PricingPositionEventStore
{
  readonly #idFactory: () => string;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresPricingPositionStoreOptions = {}) {
    this.#pool = pool;
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  async get(
    input: PricingPositionScope & { pricingId: string },
  ): Promise<Readonly<PricingPosition> | null> {
    return this.#get(this.#pool, input);
  }

  async list(input: PricingPositionScope): Promise<Readonly<PricingPositionPage>> {
    const result = await this.#pool.query<PricingRow>(
      `SELECT ${pricingColumns}
         FROM pricing_positions AS position
         JOIN LATERAL (
           SELECT revision, status, created_at
             FROM pricing_position_state_events
            WHERE pricing_id = position.pricing_id
            ORDER BY revision DESC
            LIMIT 1
         ) AS state ON true
        WHERE position.tenant_id = $1 AND position.user_id = $2
        ORDER BY position.imported_at, position.pricing_id`,
      [input.tenantId, input.userId],
    );
    const items: PricingPosition[] = [];
    for (const row of result.rows) {
      items.push(await this.#positionFromRow(this.#pool, row));
    }
    return Object.freeze({ items: Object.freeze(items) as unknown as PricingPosition[] });
  }

  async importPosition(input: PricingPositionStoreImportInput): Promise<Readonly<PricingPosition>> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const identity = [
        input.tenantId,
        input.userId,
        input.walletId,
        input.position.chainId,
        input.position.platformId,
        input.position.snapshot.positionManager,
        input.position.tokenId,
      ].join(":");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
      const existing = await client.query<{ pricing_id: string }>(
        `SELECT pricing_id::text
           FROM pricing_positions
          WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3
            AND chain_id = $4 AND platform_id = $5
            AND position_manager = $6 AND token_id = $7::numeric
          FOR UPDATE`,
        [
          input.tenantId,
          input.userId,
          input.walletId,
          input.position.chainId,
          input.position.platformId,
          input.position.snapshot.positionManager,
          input.position.tokenId,
        ],
      );
      if (existing.rows[0]) {
        const scope = { ...input, pricingId: existing.rows[0].pricing_id };
        const duplicate = await this.#hasObservation(
          client,
          scope.pricingId,
          input.observation.snapshotDigest,
        );
        if (duplicate) return await this.#commitCurrent(client, scope);
        const current = await this.#get(client, scope);
        if (!current) throw new Error("Pricing position identity is inconsistent");
        await this.#insertObservation(client, scope.pricingId, input);
        await this.#insertState(
          client,
          scope.pricingId,
          input,
          current.revision + 1,
          current.status,
        );
        const next = await this.#get(client, scope);
        if (!next) throw new Error("Pricing position update is inconsistent");
        await this.#appendOutbox(client, input, next, "diff");
        await client.query("COMMIT");
        return next;
      }

      const pricingId = this.#idFactory();
      await client.query(
        `INSERT INTO pricing_positions (
           pricing_id, tenant_id, user_id, wallet_id, wallet_address,
           chain_id, platform_id, position_manager, token_id, pool_address,
           pool_id, token0, token1, cost_amount0_base_unit,
           cost_amount1_base_unit, cost_usd_value_decimal,
           cost_price_observed_at, cost_price_source, cost_price_status, imported_at
         ) VALUES (
           $1, $2, $3, $4, $5, 56, $6, $7, $8::numeric, $9, $10, $11, $12,
           $13::numeric, $14::numeric, $15::numeric, $16, $17, $18, $19
         )`,
        [
          pricingId,
          input.tenantId,
          input.userId,
          input.walletId,
          input.walletAddress,
          input.position.platformId,
          input.position.snapshot.positionManager,
          input.position.tokenId,
          input.position.pool.poolAddress,
          input.position.pool.poolId,
          input.position.pool.token0,
          input.position.pool.token1,
          input.costBasis.amount0BaseUnit,
          input.costBasis.amount1BaseUnit,
          input.costBasis.usdValueDecimal,
          input.costBasis.priceObservedAt,
          input.costBasis.priceSource,
          input.costBasis.priceStatus,
          input.now,
        ],
      );
      await this.#insertObservation(client, pricingId, input);
      await this.#insertState(client, pricingId, input, 1, "active");
      const created = await this.#get(client, { ...input, pricingId });
      if (!created) throw new Error("Pricing position insert is inconsistent");
      await this.#appendOutbox(client, input, created, "diff");
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(
    input: PricingPositionStoreTransitionInput,
  ): Promise<Readonly<PricingPosition>> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ pricing_id: string }>(
        `SELECT pricing_id::text
           FROM pricing_positions
          WHERE pricing_id = $1 AND tenant_id = $2 AND user_id = $3
          FOR UPDATE`,
        [input.pricingId, input.tenantId, input.userId],
      );
      if (!locked.rows[0]) {
        throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
      }
      const current = await this.#get(client, input);
      if (!current) throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
      if (current.revision !== input.expectedRevision) {
        throw new PricingPositionError("PRICING_POSITION_REVISION_CONFLICT");
      }
      const duplicate = await this.#hasObservation(
        client,
        input.pricingId,
        input.observation.snapshotDigest,
      );
      if (current.status === input.status && duplicate) {
        await client.query("COMMIT");
        return current;
      }
      if (!duplicate) await this.#insertObservation(client, input.pricingId, input);
      const revision = current.revision + 1;
      await this.#insertState(client, input.pricingId, input, revision, input.status);
      if (input.status === "withdrawn") {
        await client.query(
          `INSERT INTO pricing_position_withdrawn_tombstones (
             tombstone_id, pricing_id, tenant_id, user_id, revision, status, created_at
           ) VALUES ($1, $2, $3, $4, $5, 'withdrawn', $6)`,
          [
            this.#idFactory(),
            input.pricingId,
            input.tenantId,
            input.userId,
            revision,
            input.now,
          ],
        );
      }
      const next = await this.#get(client, input);
      if (!next) throw new Error("Pricing position transition is inconsistent");
      await this.#appendOutbox(
        client,
        input,
        next,
        input.status === "withdrawn" ? "tombstone" : "diff",
      );
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async readOutbox(
    input: PricingPositionScope & { afterSequence: string; limit: number },
  ): Promise<Readonly<PricingPositionOutboxEvent[]>> {
    const result = await this.#pool.query<OutboxRow>(
      `SELECT event_id::text, tenant_id, user_id::text, sequence::text,
              epoch::text, pricing_id::text, revision::text, event_type,
              payload, created_at
         FROM pricing_position_outbox
        WHERE tenant_id = $1 AND user_id = $2 AND sequence > $3::bigint
        ORDER BY sequence
        LIMIT $4`,
      [input.tenantId, input.userId, input.afterSequence, input.limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          createdAt: row.created_at.toISOString(),
          epoch: row.epoch,
          eventId: row.event_id,
          eventType: row.event_type,
          payload: positionFromPayload(row.payload),
          pricingId: row.pricing_id,
          revision: safeRevision(row.revision),
          sequence: row.sequence,
          tenantId: row.tenant_id,
          userId: row.user_id,
        }),
      ),
    );
  }

  async readStreamSnapshot(input: PricingPositionScope): Promise<PricingPositionStreamSnapshot> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query(
        `INSERT INTO pricing_position_stream_heads (tenant_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, user_id) DO NOTHING`,
        [input.tenantId, input.userId],
      );
      const head = await client.query<StreamHeadRow>(
        `SELECT epoch::text, (next_sequence - 1)::text AS latest_sequence,
                oldest_sequence::text
           FROM pricing_position_stream_heads
          WHERE tenant_id = $1 AND user_id = $2`,
        [input.tenantId, input.userId],
      );
      const page = await this.#list(client, input);
      await client.query("COMMIT");
      const row = head.rows[0];
      if (!row) throw new Error("Pricing position stream head is missing");
      return Object.freeze({
        epoch: row.epoch,
        items: page.items,
        latestSequence: row.latest_sequence,
        oldestSequence: row.oldest_sequence,
      });
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #appendOutbox(
    client: PoolClient,
    scope: PricingPositionScope & { now: Date },
    position: Readonly<PricingPosition>,
    eventType: "diff" | "tombstone",
  ): Promise<void> {
    await client.query(
      `INSERT INTO pricing_position_stream_heads (tenant_id, user_id, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [scope.tenantId, scope.userId, scope.now],
    );
    const head = await client.query<{ epoch: string; sequence: string }>(
      `UPDATE pricing_position_stream_heads
          SET next_sequence = next_sequence + 1, updated_at = $3
        WHERE tenant_id = $1 AND user_id = $2
        RETURNING epoch::text, (next_sequence - 1)::text AS sequence`,
      [scope.tenantId, scope.userId, scope.now],
    );
    const row = head.rows[0];
    if (!row) throw new Error("Pricing position stream sequence allocation failed");
    await client.query(
      `INSERT INTO pricing_position_outbox (
         event_id, tenant_id, user_id, sequence, epoch, pricing_id,
         revision, event_type, payload, created_at
       ) VALUES ($1, $2, $3, $4::bigint, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        this.#idFactory(),
        scope.tenantId,
        scope.userId,
        row.sequence,
        row.epoch,
        position.pricingId,
        position.revision,
        eventType,
        JSON.stringify(position),
        scope.now,
      ],
    );
  }

  async #commitCurrent(
    client: PoolClient,
    input: PricingPositionScope & { pricingId: string },
  ): Promise<Readonly<PricingPosition>> {
    const current = await this.#get(client, input);
    if (!current) throw new Error("Pricing position is missing");
    await client.query("COMMIT");
    return current;
  }

  async #get(
    queryable: Queryable,
    input: PricingPositionScope & { pricingId: string },
  ): Promise<Readonly<PricingPosition> | null> {
    const result = await queryable.query<PricingRow>(
      `SELECT ${pricingColumns}
         FROM pricing_positions AS position
         JOIN LATERAL (
           SELECT revision, status, created_at
             FROM pricing_position_state_events
            WHERE pricing_id = position.pricing_id
            ORDER BY revision DESC
            LIMIT 1
         ) AS state ON true
        WHERE position.pricing_id = $1
          AND position.tenant_id = $2 AND position.user_id = $3`,
      [input.pricingId, input.tenantId, input.userId],
    );
    return result.rows[0] ? this.#positionFromRow(queryable, result.rows[0]) : null;
  }

  async #hasObservation(
    queryable: Queryable,
    pricingId: string,
    digest: string,
  ): Promise<boolean> {
    const result = await queryable.query(
      `SELECT 1 FROM pricing_position_observations
        WHERE pricing_id = $1 AND snapshot_digest = $2`,
      [pricingId, digest],
    );
    return result.rowCount === 1;
  }

  async #insertObservation(
    queryable: Queryable,
    pricingId: string,
    input: PricingPositionScope & { observation: PricingPositionObservation },
  ): Promise<void> {
    const value = input.observation;
    await queryable.query(
      `INSERT INTO pricing_position_observations (
         observation_id, pricing_id, tenant_id, user_id, page_snapshot_digest,
         snapshot_digest, block_number, block_hash, observed_at, recorded_at,
         liquidity_raw, liquidity_amount0_base_unit, liquidity_amount1_base_unit,
         observed_fee0_base_unit, observed_fee1_base_unit
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11::numeric,
         $12::numeric, $13::numeric, $14::numeric, $15::numeric
       )`,
      [
        value.observationId,
        pricingId,
        input.tenantId,
        input.userId,
        value.pageSnapshotDigest,
        value.snapshotDigest,
        value.blockNumber,
        value.blockHash,
        value.observedAt,
        value.recordedAt,
        value.liquidityRaw,
        value.liquidityAmount0BaseUnit,
        value.liquidityAmount1BaseUnit,
        value.observedFee0BaseUnit,
        value.observedFee1BaseUnit,
      ],
    );
  }

  async #insertState(
    queryable: Queryable,
    pricingId: string,
    input: PricingPositionScope & { now: Date },
    revision: number,
    status: PricingPositionStatus,
  ): Promise<void> {
    await queryable.query(
      `INSERT INTO pricing_position_state_events (
         state_event_id, pricing_id, tenant_id, user_id, revision, status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        this.#idFactory(),
        pricingId,
        input.tenantId,
        input.userId,
        revision,
        status,
        input.now,
      ],
    );
  }

  async #list(queryable: Queryable, input: PricingPositionScope): Promise<PricingPositionPage> {
    const result = await queryable.query<PricingRow>(
      `SELECT ${pricingColumns}
         FROM pricing_positions AS position
         JOIN LATERAL (
           SELECT revision, status, created_at
             FROM pricing_position_state_events
            WHERE pricing_id = position.pricing_id
            ORDER BY revision DESC
            LIMIT 1
         ) AS state ON true
        WHERE position.tenant_id = $1 AND position.user_id = $2
        ORDER BY position.imported_at, position.pricing_id`,
      [input.tenantId, input.userId],
    );
    const items: PricingPosition[] = [];
    for (const row of result.rows) items.push(await this.#positionFromRow(queryable, row));
    return { items };
  }

  async #positionFromRow(queryable: Queryable, row: PricingRow): Promise<PricingPosition> {
    const observations = await queryable.query<ObservationRow>(
      `SELECT ${observationColumns}
         FROM pricing_position_observations
        WHERE pricing_id = $1
        ORDER BY observed_at, observation_id`,
      [row.pricing_id],
    );
    return freezePosition({
      chainId: 56,
      costBasis: {
        amount0BaseUnit: row.cost_amount0_base_unit,
        amount1BaseUnit: row.cost_amount1_base_unit,
        priceObservedAt: row.cost_price_observed_at?.toISOString() ?? null,
        priceSource: row.cost_price_source,
        priceStatus: row.cost_price_status,
        usdValueDecimal: decimalDto(row.cost_usd_value_decimal),
      },
      importedAt: row.imported_at.toISOString(),
      observations: observations.rows.map(observationFromRow),
      platformId: row.platform_id as PricingPosition["platformId"],
      pool: {
        poolAddress: row.pool_address,
        poolId: row.pool_id,
        token0: row.token0,
        token1: row.token1,
      },
      positionManager: row.position_manager,
      pricingId: row.pricing_id,
      revision: safeRevision(row.revision),
      status: row.status,
      tokenId: row.token_id,
      updatedAt: row.state_created_at.toISOString(),
      walletAddress: row.wallet_address,
      walletId: row.wallet_id,
    });
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
  }
}
