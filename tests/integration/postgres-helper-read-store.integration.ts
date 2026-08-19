import {
  PostgresWalletHelperReadStore,
  type StoredHelperVerification,
  type WalletHelperBinding,
} from "../../apps/api/src/index.js";
import type { HelperResidualPage } from "../../packages/api-contract/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const now = new Date("2026-08-19T05:00:00.000Z");
const userA = "67000000-0000-4000-8000-000000000001";
const userB = "67000000-0000-4000-8000-000000000002";
const walletA = "67000000-0000-4000-8000-000000000011";
const walletB = "67000000-0000-4000-8000-000000000012";
const bindingId = "67000000-0000-4000-8000-000000000021";
const helperAddress = "0x2222222222222222222222222222222222222222" as const;
const walletAddressA = "0x1111111111111111111111111111111111111111" as const;
const walletAddressB = "0x3333333333333333333333333333333333333333" as const;
const blockHash = `0x${"ab".repeat(32)}` as const;
const digest = `0x${"cd".repeat(32)}` as const;

async function createWallet(input: {
  address: string;
  userId: string;
  walletId: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      `INSERT INTO custody_wallets (
         wallet_id, tenant_id, user_id, name, address, address_lower, mode,
         lock_status, lifecycle_status, current_envelope_version, revision, created_at, updated_at
       ) VALUES ($1, 'tenant-p05-02', $2, 'Helper fixture', $3, lower($3),
                 'server-kek', 'ready', 'active', 1, 1, $4, $4)`,
      [input.walletId, input.userId, input.address, now],
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

function binding(): WalletHelperBinding {
  return {
    bindingId,
    boundAt: new Date("2026-08-19T04:00:00.000Z"),
    chainId: 56,
    helperAddress,
    helperVersion: "v2",
    registryVersion: "p05-bsc-execution-v1",
    source: "deployment-result",
    userId: userA,
    walletId: walletA,
  };
}

function verification(): StoredHelperVerification {
  return {
    bindingId,
    chainId: 56,
    failures: [],
    helperAddress,
    helperVersion: "v2",
    userId: userA,
    verification: {
      blockHash,
      blockNumber: "116718500",
      blockTimestamp: now.toISOString(),
      checks: {
        address: true,
        owner: true,
        runtimeCodeHash: true,
        selectorSet: true,
        version: true,
      },
      digest,
      observedOwner: walletAddressA,
      observedRuntimeCodeHash: `0x${"ef".repeat(32)}`,
      observedSelectors: ["0x8da5cb5b"],
      verifiedAt: new Date("2026-08-19T05:00:01.000Z").toISOString(),
    },
    walletId: walletA,
  };
}

function residual(scanId: string, amount = "7"): HelperResidualPage {
  return {
    allowlistVersion: "fixture-residual-v1",
    chainId: 56,
    coverage: {
      allowlistComplete: true,
      complete: true,
      missingSources: [],
      positionTokensComplete: true,
      walletTokenRegistryComplete: true,
    },
    cursor: null,
    helperAddress,
    items: [
      {
        amountBaseUnit: amount,
        assetId: "native:56",
        chainId: 56,
        kind: "native",
        tokenAddress: null,
      },
    ],
    registryVersion: "p05-bsc-execution-v1",
    scanId,
    scannedAt: new Date("2026-08-19T05:00:02.000Z").toISOString(),
    snapshot: {
      blockHash,
      blockNumber: "116718500",
      blockTimestamp: now.toISOString(),
      digest,
    },
    state: "ready",
    walletId: walletA,
  };
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'Helper read A', $3, $3),
       ($2, 'user', 'normal', 'active', 'Helper read B', $3, $3)`,
    [userA, userB, now],
  );
  await createWallet({ address: walletAddressA, userId: userA, walletId: walletA });
  await createWallet({ address: walletAddressB, userId: userB, walletId: walletB });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
  await pool.end();
});

describe("P05-02 PostgreSQL Helper read store", () => {
  it("records only trusted bindings, survives restart, and isolates custody ownership", async () => {
    const store = new PostgresWalletHelperReadStore(pool);
    await expect(store.recordTrustedBinding(binding())).resolves.toEqual(binding());
    await expect(store.recordTrustedBinding(binding())).resolves.toEqual(binding());

    const restarted = new PostgresWalletHelperReadStore(pool);
    await expect(
      restarted.findBinding({ chainId: 56, userId: userA, walletId: walletA }),
    ).resolves.toEqual(binding());
    await expect(
      restarted.findBinding({ chainId: 56, userId: userB, walletId: walletB }),
    ).resolves.toBeNull();
    await expect(
      store.recordTrustedBinding({
        ...binding(),
        bindingId: "67000000-0000-4000-8000-000000000022",
        source: "client" as "deployment-result",
      }),
    ).rejects.toThrow(/HELPER_BINDING_SOURCE_INVALID/u);
    await expect(
      store.recordTrustedBinding({
        ...binding(),
        bindingId: "67000000-0000-4000-8000-000000000023",
        helperAddress: "0x4444444444444444444444444444444444444444",
        userId: userB,
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("appends immutable verification snapshots", async () => {
    const store = new PostgresWalletHelperReadStore(pool);
    await store.appendVerification(verification());
    const rows = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM wallet_helper_verification_snapshots WHERE binding_id = $1",
      [bindingId],
    );
    expect(rows.rows).toEqual([{ count: "1" }]);
    await expect(
      pool.query(
        "UPDATE wallet_helper_verification_snapshots SET verified_at = verified_at + interval '1 second' WHERE binding_id = $1",
        [bindingId],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("deduplicates concurrent scan identities and returns the persisted winner after restart", async () => {
    const store = new PostgresWalletHelperReadStore(pool);
    const first = residual("67000000-0000-4000-8000-000000000031", "7");
    const second = residual("67000000-0000-4000-8000-000000000032", "9");
    const results = await Promise.all([
      store.appendResidualSnapshot({
        idempotencyKey: "postgres-scan-001",
        page: first,
        userId: userA,
      }),
      store.appendResidualSnapshot({
        idempotencyKey: "postgres-scan-001",
        page: second,
        userId: userA,
      }),
    ]);
    expect(results[0]).toEqual(results[1]);

    const restarted = new PostgresWalletHelperReadStore(pool);
    await expect(
      restarted.findResidualSnapshotByIdempotency({
        chainId: 56,
        idempotencyKey: "postgres-scan-001",
        userId: userA,
        walletId: walletA,
      }),
    ).resolves.toEqual(results[0]);
    await expect(
      restarted.latestResidualSnapshot({
        chainId: 56,
        helperAddress,
        userId: userA,
        walletId: walletA,
      }),
    ).resolves.toEqual(results[0]);

    const rows = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM wallet_helper_residual_snapshots WHERE user_id = $1 AND wallet_id = $2",
      [userA, walletA],
    );
    expect(rows.rows).toEqual([{ count: "1" }]);
    await expect(
      pool.query(
        "DELETE FROM wallet_helper_residual_snapshots WHERE user_id = $1 AND wallet_id = $2",
        [userA, walletA],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });
});
