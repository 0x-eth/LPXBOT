import type {
  PricingPositionCostBasis,
  PricingPositionObservation,
  WalletPosition,
} from "../../packages/api-contract/src/index.js";
import {
  PostgresPricingPositionStore,
  PostgresSwapQuoteSnapshotStore,
  PricingPositionStreamService,
} from "../../apps/api/src/index.js";
import {
  BscSwapQuoteAdapter,
  DeterministicSwapQuoteProvider,
} from "../../packages/chain-adapters/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const now = new Date("2026-08-19T08:00:00.000Z");
const tenantId = "tenant-p05-03";
const userA = "72000000-0000-4000-8000-000000000001";
const userB = "72000000-0000-4000-8000-000000000002";
const walletA = "72000000-0000-4000-8000-000000000011";
const walletB = "72000000-0000-4000-8000-000000000012";
const walletAddressA = "0x1111111111111111111111111111111111111111" as const;
const walletAddressB = "0x3333333333333333333333333333333333333333" as const;
const cursorSecret = "postgres-pricing-position-cursor-secret-minimum";

async function createWallet(input: { address: string; userId: string; walletId: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      `INSERT INTO custody_wallets (
         wallet_id, tenant_id, user_id, name, address, address_lower, mode,
         lock_status, lifecycle_status, current_envelope_version, revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 'Pricing fixture', $4, lower($4),
                 'server-kek', 'ready', 'active', 1, 1, $5, $5)`,
      [input.walletId, tenantId, input.userId, input.address, now],
    );
    await client.query(
      `INSERT INTO custody_wallet_envelopes (
         wallet_id, envelope_version, algorithm, ciphertext, nonce, authentication_tag,
         aad_version, wrapped_dek, kek_id, kek_version, created_at
       ) VALUES ($1, 1, 'AES-256-GCM', $2, $3, $4, 1, $5,
                 'local-fixture', 'kek-fixture-v1', $6)`,
      [
        input.walletId,
        Buffer.alloc(32, 1),
        Buffer.alloc(12, 2),
        Buffer.alloc(16, 3),
        Buffer.alloc(60, 4),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function chainPosition(liquidity = "300"): WalletPosition {
  return {
    approval: {
      approvedAddress: null,
      approvedForAll: false,
      helperAuthorized: false,
      nftOwner: walletAddressA,
      observedAtBlock: "116718500",
    },
    chainId: 56,
    fees: {
      estimated0BaseUnit: "7",
      estimated1BaseUnit: "9",
      owed0BaseUnit: "7",
      owed1BaseUnit: "9",
    },
    liquidity: { amount0BaseUnit: "100", amount1BaseUnit: "200", raw: liquidity },
    owner: walletAddressA,
    platformId: 1,
    pool: {
      feePips: "500",
      hooks: null,
      poolAddress: "0x2222222222222222222222222222222222222222",
      poolId: null,
      tickSpacing: "10",
      token0: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      token1: "0x55d398326f99059ff775485246999027b3197955",
    },
    snapshot: {
      blockHash: `0x${"ab".repeat(32)}`,
      blockNumber: "116718500",
      blockTimestamp: now.toISOString(),
      digest: `0x${liquidity.padStart(64, "0")}`,
      positionManager: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
      positionManagerCodeHash: "0xbc0177f23ffd65c41e41fb201e170cb253489d7d637f8f6a15743a1f861160f5",
      registryVersion: "p05-bsc-execution-v1",
    },
    ticks: { current: "0", inRange: true, lower: "-10", upper: "10" },
    tokenId: "42",
  };
}

const costBasis: PricingPositionCostBasis = {
  amount0BaseUnit: "100",
  amount1BaseUnit: "200",
  priceObservedAt: null,
  priceSource: null,
  priceStatus: "missing",
  usdValueDecimal: null,
};

function observation(
  id: string,
  digestByte: string,
  liquidity = "300",
): PricingPositionObservation {
  return {
    blockHash: `0x${"ab".repeat(32)}`,
    blockNumber: "116718500",
    liquidityAmount0BaseUnit: "100",
    liquidityAmount1BaseUnit: "200",
    liquidityRaw: liquidity,
    observationId: id,
    observedAt: now.toISOString(),
    observedFee0BaseUnit: "7",
    observedFee1BaseUnit: "9",
    pageSnapshotDigest: `0x${"cd".repeat(32)}`,
    recordedAt: now.toISOString(),
    snapshotDigest: `0x${digestByte.repeat(32)}`,
  };
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'Pricing A', $3, $3),
       ($2, 'user', 'normal', 'active', 'Pricing B', $3, $3)`,
    [userA, userB, now],
  );
  await createWallet({ address: walletAddressA, userId: userA, walletId: walletA });
  await createWallet({ address: walletAddressB, userId: userB, walletId: walletB });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
  await pool.end();
});

describe("P05-03 PostgreSQL quote and pricing position stores", () => {
  it("deduplicates concurrent imports and commits observations, state, and outbox atomically", async () => {
    const firstStore = new PostgresPricingPositionStore(pool);
    const secondStore = new PostgresPricingPositionStore(pool);
    const input = {
      costBasis,
      now,
      observation: observation("72000000-0000-4000-8000-000000000031", "01"),
      position: chainPosition(),
      tenantId,
      userId: userA,
      walletAddress: walletAddressA,
      walletId: walletA,
    };
    const [first, second] = await Promise.all([
      firstStore.importPosition(input),
      secondStore.importPosition(input),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ revision: 1, status: "active" });
    expect(await firstStore.list({ tenantId, userId: userB })).toEqual({ items: [] });
    expect(
      await secondStore.get({ pricingId: first.pricingId, tenantId, userId: userB }),
    ).toBeNull();

    const counts = await pool.query<{
      observations: string;
      outbox: string;
      positions: string;
      states: string;
    }>(
      `SELECT
         (SELECT count(*) FROM pricing_positions WHERE user_id = $1)::text AS positions,
         (SELECT count(*) FROM pricing_position_observations WHERE user_id = $1)::text AS observations,
         (SELECT count(*) FROM pricing_position_state_events WHERE user_id = $1)::text AS states,
         (SELECT count(*) FROM pricing_position_outbox WHERE user_id = $1)::text AS outbox`,
      [userA],
    );
    expect(counts.rows[0]).toEqual({ observations: "1", outbox: "1", positions: "1", states: "1" });
  });

  it("recovers SSE from PostgreSQL after restart and preserves withdrawn history", async () => {
    const store = new PostgresPricingPositionStore(pool);
    const page = await store.list({ tenantId, userId: userA });
    const imported = page.items[0]!;
    const before = new PricingPositionStreamService({
      cursorSecret,
      finite: true,
      now: () => now,
      store,
    });
    const initial = await before.open({ lastEventId: null, tenantId, userId: userA });

    const hidden = await store.transition({
      expectedRevision: imported.revision,
      now,
      observation: observation("72000000-0000-4000-8000-000000000031", "01"),
      pricingId: imported.pricingId,
      status: "hidden",
      tenantId,
      userId: userA,
    });
    await store.transition({
      expectedRevision: hidden.revision,
      now: new Date(now.getTime() + 1_000),
      observation: observation("72000000-0000-4000-8000-000000000032", "02", "0"),
      pricingId: imported.pricingId,
      status: "withdrawn",
      tenantId,
      userId: userA,
    });

    const restartedStore = new PostgresPricingPositionStore(pool);
    const restarted = new PricingPositionStreamService({
      cursorSecret,
      finite: true,
      now: () => new Date(now.getTime() + 2_000),
      store: restartedStore,
    });
    const resume = await restarted.open({
      lastEventId: initial.initialEvent!.cursor,
      tenantId,
      userId: userA,
    });
    const events = [];
    for await (const event of restarted.subscribe({
      ...resume,
      signal: new AbortController().signal,
      tenantId,
      userId: userA,
    })) {
      events.push(event);
    }
    expect(events.map(({ type }) => type)).toEqual(["diff", "tombstone", "heartbeat"]);
    const recovered = (await restartedStore.list({ tenantId, userId: userA })).items[0]!;
    expect(recovered).toMatchObject({ revision: 3, status: "withdrawn" });
    expect(recovered.observations).toHaveLength(2);

    const tombstones = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pricing_position_withdrawn_tombstones WHERE user_id = $1",
      [userA],
    );
    expect(tombstones.rows).toEqual([{ count: "1" }]);
    await expect(
      pool.query(
        "UPDATE pricing_position_observations SET observed_fee0_base_unit = 999 WHERE user_id = $1",
        [userA],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("stores only the controlled non-executable quote snapshot DTO", async () => {
    const quote = await new BscSwapQuoteAdapter({
      now: () => now,
      provider: new DeterministicSwapQuoteProvider(),
      readRuntimeCodeHash: async ({ expectedRuntimeCodeHash }) => expectedRuntimeCodeHash,
    }).quote({
      amountInBaseUnit: "1000000000000000000",
      chainId: 56,
      platformId: 2,
      slippageBps: 50,
      tokenIn: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      tokenOut: "0x55d398326f99059ff775485246999027b3197955",
      walletAddress: walletAddressA,
      walletId: walletA,
    });
    const store = new PostgresSwapQuoteSnapshotStore(pool);
    await store.append({ quote, tenantId, userId: userA });
    await store.append({ quote, tenantId, userId: userA });
    const rows = await pool.query<{ body: unknown }>(
      `SELECT to_jsonb(snapshot) AS body
         FROM swap_quote_snapshots AS snapshot
        WHERE tenant_id = $1 AND user_id = $2 AND digest = $3`,
      [tenantId, userA, quote.digest],
    );
    expect(rows.rows).toHaveLength(1);
    const persisted = JSON.stringify(rows.rows[0]!.body).toLowerCase();
    expect(persisted).not.toContain("raw_calldata");
    expect(persisted).not.toContain("private_key");
    expect(persisted).not.toContain("okx");
    expect(persisted).not.toContain("secret");
    expect(persisted).toContain('"execution_enabled":false');
  });
});
