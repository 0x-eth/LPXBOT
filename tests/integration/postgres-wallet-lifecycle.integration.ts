import { createHash, randomUUID } from "node:crypto";

import { PostgresCustodyWalletStore } from "../../apps/signer/src/postgres-custody-wallet-store.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const userId = randomUUID();
const otherUserId = randomUUID();
const address = "0x1111111111111111111111111111111111111111" as const;
const now = new Date("2026-08-18T10:00:00.000Z");

function draft(
  walletId: string,
  walletAddress: `0x${string}` = address,
  ownerId = userId,
) {
  return {
    auditAction: "wallet.import" as const,
    envelope: {
      aadVersion: 1 as const,
      algorithm: "AES-256-GCM" as const,
      ciphertext: Buffer.alloc(32, 0x11),
      createdAt: now,
      envelopeVersion: 1,
      kekId: "local-fixture",
      kekVersion: "kek-fixture-v1",
      nonce: Buffer.alloc(12, 0x12),
      tag: Buffer.alloc(16, 0x13),
      wrappedDek: Buffer.alloc(60, 0x14),
    },
    wallet: {
      address: walletAddress,
      addressLower: walletAddress.toLowerCase() as `0x${string}`,
      createdAt: now,
      envelopeVersion: 1,
      lockStatus: "ready" as const,
      mode: "server-kek" as const,
      name: "Lifecycle fixture",
      revision: 1,
      tenantId: "tenant-fixture-01",
      updatedAt: now,
      userId: ownerId,
      walletId,
    },
  };
}

function preview(user: string, walletId: string, revision = 1) {
  const token = Buffer.alloc(32, 0x55);
  return {
    assetIds: [] as string[],
    assetRiskDigest: "sha256:postgres-empty",
    complete: true,
    confirmationPhrase: "DELETE WALLET 1234ABCD",
    expiresAt: new Date(now.getTime() + 300_000),
    forceEligible: true,
    policyIds: [] as string[],
    positionIds: [] as string[],
    previewTokenDigest: createHash("sha256").update(token).digest(),
    revision,
    taskIds: [] as string[],
    userId: user,
    walletId,
  };
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'Lifecycle A', now(), now()),
       ($2, 'user', 'normal', 'active', 'Lifecycle B', now(), now())`,
    [userId, otherUserId],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [userId, otherUserId]);
  await pool.end();
});

describe("P04-04 PostgreSQL wallet lifecycle", () => {
  it("renames with CAS/no-op and atomically destroys all recoverable key material", async () => {
    const store = new PostgresCustodyWalletStore(pool);
    const walletId = randomUUID();
    await store.create(draft(walletId));
    const renamed = await store.rename({
      expectedRevision: 1,
      name: "Renamed",
      updatedAt: new Date(now.getTime() + 1_000),
      userId,
      walletId,
    });
    expect(renamed).toMatchObject({ name: "Renamed", revision: 2 });
    await expect(
      store.rename({
        expectedRevision: 2,
        name: "Renamed",
        updatedAt: new Date(now.getTime() + 2_000),
        userId,
        walletId,
      }),
    ).resolves.toMatchObject({ revision: 2 });

    const frozen = preview(userId, walletId, 2);
    await store.createWalletDeletePreview(frozen);
    expect(
      await store.getWalletDeletePreview(otherUserId, walletId, frozen.previewTokenDigest),
    ).toBeNull();
    const receipt = await store.deleteWallet({
      assetIds: [],
      assetRiskDigest: frozen.assetRiskDigest,
      complete: true,
      deletionType: "normal",
      expectedRevision: 2,
      now: new Date(now.getTime() + 3_000),
      policyIds: [],
      positionIds: [],
      previewTokenDigest: frozen.previewTokenDigest,
      taskIds: [],
      userId,
      walletId,
    });
    expect(receipt).toMatchObject({ deletionType: "normal", finalRevision: 3, walletId });
    expect(await store.get(userId, walletId)).toBeNull();
    expect(
      (
        await pool.query(
          `SELECT
             (SELECT count(*)::int FROM custody_wallet_envelopes WHERE wallet_id = $1) AS envelopes,
             (SELECT count(*)::int FROM custody_wallet_delete_previews WHERE wallet_id = $1) AS previews,
             (SELECT count(*)::int FROM custody_wallet_tombstones WHERE wallet_id = $1) AS tombstones,
             (SELECT count(*)::int FROM custody_wallet_audit_events WHERE wallet_id = $1) AS audits`,
          [walletId],
        )
      ).rows[0],
    ).toEqual({ audits: 3, envelopes: 0, previews: 0, tombstones: 1 });

    const reimported = await store.create(draft(randomUUID()));
    expect(reimported.address).toBe(address);
  });

  it("serializes concurrent deletion and rolls all rows back on an injected fault", async () => {
    const walletId = randomUUID();
    const store = new PostgresCustodyWalletStore(pool);
    await store.create(draft(walletId, "0x2222222222222222222222222222222222222222"));
    const frozen = preview(userId, walletId);
    await store.createWalletDeletePreview(frozen);
    const commit = {
      assetIds: [] as string[],
      assetRiskDigest: frozen.assetRiskDigest,
      complete: true as const,
      deletionType: "normal" as const,
      expectedRevision: 1,
      now: new Date(now.getTime() + 1_000),
      policyIds: [] as string[],
      positionIds: [] as string[],
      previewTokenDigest: frozen.previewTokenDigest,
      taskIds: [] as string[],
      userId,
      walletId,
    };
    const attempts = await Promise.allSettled([store.deleteWallet(commit), store.deleteWallet(commit)]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const faultWalletId = randomUUID();
    await store.create(draft(faultWalletId, "0x3333333333333333333333333333333333333333"));
    const faultPreview = preview(userId, faultWalletId);
    await store.createWalletDeletePreview(faultPreview);
    const faulting = new PostgresCustodyWalletStore(pool, {
      failAt: "before-lifecycle-commit",
    });
    await expect(
      faulting.deleteWallet({
        ...commit,
        assetRiskDigest: faultPreview.assetRiskDigest,
        previewTokenDigest: faultPreview.previewTokenDigest,
        walletId: faultWalletId,
      }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(await store.get(userId, faultWalletId)).not.toBeNull();
    expect(
      (
        await pool.query(
          `SELECT
             (SELECT count(*)::int FROM custody_wallet_envelopes WHERE wallet_id = $1) AS envelopes,
             (SELECT count(*)::int FROM custody_wallet_delete_previews WHERE wallet_id = $1) AS previews,
             (SELECT count(*)::int FROM custody_wallet_tombstones WHERE wallet_id = $1) AS tombstones,
             (SELECT count(*)::int FROM custody_wallet_audit_events WHERE wallet_id = $1) AS audits`,
          [faultWalletId],
        )
      ).rows[0],
    ).toEqual({ audits: 1, envelopes: 1, previews: 1, tombstones: 0 });
  });

  it("preserves the non-secret tombstone and deletion audit after its user is deleted", async () => {
    const ownerId = randomUUID();
    const walletId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
       VALUES ($1, 'user', 'normal', 'active', 'Deleted owner', now(), now())`,
      [ownerId],
    );
    const store = new PostgresCustodyWalletStore(pool);
    await store.create(draft(walletId, "0x4444444444444444444444444444444444444444", ownerId));
    const frozen = preview(ownerId, walletId);
    await store.createWalletDeletePreview(frozen);
    await store.deleteWallet({
      assetIds: [],
      assetRiskDigest: frozen.assetRiskDigest,
      complete: true,
      deletionType: "normal",
      expectedRevision: 1,
      now: new Date(now.getTime() + 1_000),
      policyIds: [],
      positionIds: [],
      previewTokenDigest: frozen.previewTokenDigest,
      taskIds: [],
      userId: ownerId,
      walletId,
    });

    await pool.query("DELETE FROM users WHERE id = $1", [ownerId]);
    expect(
      (
        await pool.query(
          `SELECT
             (SELECT count(*)::int FROM custody_wallet_tombstones WHERE wallet_id = $1) AS tombstones,
             (SELECT count(*)::int FROM custody_wallet_audit_events WHERE wallet_id = $1) AS audits`,
          [walletId],
        )
      ).rows[0],
    ).toEqual({ audits: 2, tombstones: 1 });
  });
});
