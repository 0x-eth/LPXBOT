import { readFileSync } from "node:fs";
import path from "node:path";

import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const migration = readFileSync(
  path.resolve("infra/migrations/20260818000300_create_custody_wallets.sql"),
  "utf8",
);
const [up, down] = migration.split("-- migrate:down");
const walletAssetMigration = readFileSync(
  path.resolve("infra/migrations/20260818000600_create_wallet_assets_address_book.sql"),
  "utf8",
);
const [, walletAssetDown] = walletAssetMigration.split("-- migrate:down");
const userA = "43000000-0000-4000-8000-000000000001";
const userB = "43000000-0000-4000-8000-000000000002";
const address = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";

function draft(walletId: string, userId: string, walletAddress = address) {
  const createdAt = new Date("2026-08-18T05:00:00.000Z");
  return {
    auditAction: "wallet.import" as const,
    envelope: {
      aadVersion: 1 as const,
      algorithm: "AES-256-GCM" as const,
      ciphertext: Buffer.alloc(32, 1),
      createdAt,
      envelopeVersion: 1,
      kekId: "local-fixture",
      kekVersion: "kek-fixture-v1",
      nonce: Buffer.alloc(12, 2),
      tag: Buffer.alloc(16, 3),
      wrappedDek: Buffer.alloc(60, 4),
    },
    wallet: {
      address: walletAddress as `0x${string}`,
      addressLower: walletAddress.toLowerCase() as `0x${string}`,
      createdAt,
      envelopeVersion: 1,
      lockStatus: "ready" as const,
      mode: "server-kek" as const,
      name: "Fixture",
      revision: 1,
      tenantId: "tenant-fixture-01",
      updatedAt: createdAt,
      userId,
      walletId,
    },
  };
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [userA, userB]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'A', now(), now()),
       ($2, 'user', 'normal', 'active', 'B', now(), now())`,
    [userA, userB],
  );
  const exists = await pool.query("SELECT to_regclass('custody_wallets') AS table_name");
  if (!exists.rows[0].table_name) await pool.query(up!);
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [userA, userB]);
  await pool.end();
});

describe("P04-02 PostgreSQL custody wallet store", () => {
  it("runs migration down/up and preserves constraints", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(walletAssetDown!);
      await client.query(down!);
      await client.query(up!);
      expect(
        (await client.query("SELECT to_regclass('custody_wallet_envelopes') AS table_name")).rows[0]
          .table_name,
      ).toBe("custody_wallet_envelopes");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("allows cross-user custody while serializing same-user duplicates", async () => {
    const store = new PostgresCustodyWalletStore(pool);
    const attempts = await Promise.allSettled([
      store.create(draft("43000000-0000-4000-8000-000000000011", userA)),
      store.create(draft("43000000-0000-4000-8000-000000000012", userA)),
      store.create(draft("43000000-0000-4000-8000-000000000013", userB)),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect((await store.list(userA)).items).toHaveLength(1);
    expect((await store.list(userB)).items).toHaveLength(1);
  });

  it("rolls back wallet, envelope, pointer, and audit after a transaction fault", async () => {
    const store = new PostgresCustodyWalletStore(pool, { failAt: "before-commit" });
    const walletId = "43000000-0000-4000-8000-000000000099";
    await expect(
      store.create(draft(walletId, userA, "0x1111111111111111111111111111111111111111")),
    ).rejects.toThrow("CUSTODY_STORE_FAULT");
    for (const table of [
      "custody_wallets",
      "custody_wallet_envelopes",
      "custody_wallet_audit_events",
    ]) {
      expect(
        (
          await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE wallet_id = $1`, [
            walletId,
          ])
        ).rows[0].count,
      ).toBe(0);
    }
  });
});
