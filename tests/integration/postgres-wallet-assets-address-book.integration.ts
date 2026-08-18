import {
  AddressBookError,
  PostgresAddressBookStore,
  PostgresWalletTokenStore,
  type AddressBookAllowedAudit,
} from "../../apps/api/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 6 });
const now = new Date("2026-08-18T11:30:00.000Z");
const userA = "58000000-0000-4000-8000-000000000001";
const userB = "58000000-0000-4000-8000-000000000002";
const walletA = "58000000-0000-4000-8000-000000000011";
const walletB = "58000000-0000-4000-8000-000000000012";
const sessionA = "58000000-0000-4000-8000-000000000031";
const auditRequestPrefix = `postgres-p04-05-${process.pid}`;
const addressA = "0x1111111111111111111111111111111111111111" as const;
const addressB = "0x2222222222222222222222222222222222222222" as const;
const tokenAddress = "0x3333333333333333333333333333333333333333" as const;

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
       ) VALUES ($1, 'tenant-fixture-01', $2, 'Read fixture', $3, lower($3),
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

function audit(
  action: AddressBookAllowedAudit["action"],
  sessionId = sessionA,
): AddressBookAllowedAudit {
  return {
    action,
    actorUserId: sessionId === sessionA ? userA : userB,
    address: addressA,
    chainId: 56,
    createdAt: now,
    entryId: null,
    requestId: `${auditRequestPrefix}-${action}`,
    sessionId,
  };
}

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'Wallet read A', $3, $3),
       ($2, 'user', 'normal', 'active', 'Wallet read B', $3, $3)`,
    [userA, userB, now],
  );
  await createWallet({ address: addressA, userId: userA, walletId: walletA });
  await createWallet({ address: addressB, userId: userB, walletId: walletB });
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[userA, userB]]);
  await pool.end();
});

describe("P04-05 PostgreSQL wallet asset and address-book stores", () => {
  it("stores custom token metadata per user/wallet/chain and reports duplicate metadata conflicts", async () => {
    const store = new PostgresWalletTokenStore(pool);
    const input = {
      chainId: 56,
      createdAt: now,
      decimals: 6,
      default: false as const,
      name: "Fixture Dollar",
      symbol: "FIX",
      tokenAddress,
      userId: userA,
      walletId: walletA,
    };
    await expect(store.insert(input)).resolves.toMatchObject({ status: "created" });
    await expect(store.insert(input)).resolves.toMatchObject({ status: "duplicate" });
    await expect(store.insert({ ...input, symbol: "CHANGED" })).resolves.toMatchObject({
      status: "metadata-conflict",
      value: { symbol: "FIX" },
    });
    await expect(store.list({ chainId: 56, userId: userA, walletId: walletA })).resolves.toEqual([
      expect.objectContaining({ symbol: "FIX", tokenAddress }),
    ]);
    await expect(store.list({ chainId: 56, userId: userB, walletId: walletB })).resolves.toEqual(
      [],
    );

    await expect(
      store.insert({ ...input, userId: userB, walletId: walletA }),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      store.delete({ chainId: 56, tokenAddress, userId: userB, walletId: walletB }),
    ).resolves.toBe(false);
    await expect(
      store.delete({ chainId: 56, tokenAddress, userId: userA, walletId: walletA }),
    ).resolves.toBe(true);
  });

  it("keeps address-book rows isolated from address remarks and applies optimistic revisions atomically", async () => {
    const store = new PostgresAddressBookStore(pool);
    const created = await store.create({
      address: addressA,
      audit: audit("address-book.create"),
      category: "person",
      chainId: 56,
      createdAt: now,
      label: "Fixture contact",
      note: "Independent domain",
      userId: userA,
    });
    expect(created).toMatchObject({ address: addressA, revision: 1 });
    await expect(
      store.create({
        address: addressA,
        audit: audit("address-book.create"),
        category: "other",
        chainId: 56,
        createdAt: now,
        label: "Duplicate",
        note: "",
        userId: userA,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AddressBookError>>({ code: "ADDRESS_BOOK_DUPLICATE" }),
    );

    await expect(store.list({ chainId: 56, userId: userB })).resolves.toEqual([]);
    const updated = await store.patch({
      audit: { ...audit("address-book.patch"), entryId: created.entryId },
      changes: { category: "protocol", label: "Updated contact" },
      entryId: created.entryId,
      expectedRevision: 1,
      updatedAt: new Date(now.getTime() + 1_000),
      userId: userA,
    });
    expect(updated).toMatchObject({ category: "protocol", label: "Updated contact", revision: 2 });
    await expect(
      store.patch({
        audit: { ...audit("address-book.patch"), entryId: created.entryId },
        changes: { label: "Stale" },
        entryId: created.entryId,
        expectedRevision: 1,
        updatedAt: new Date(now.getTime() + 2_000),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "ADDRESS_BOOK_REVISION_CONFLICT" });

    const remarkCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM address_remarks
        WHERE user_id = $1 AND chain_id = 56 AND canonical_address = $2`,
      [userA, addressA],
    );
    expect(remarkCount.rows).toEqual([{ count: "0" }]);

    await expect(
      store.delete({
        audit: { ...audit("address-book.delete"), entryId: created.entryId },
        deletedAt: new Date(now.getTime() + 3_000),
        entryId: created.entryId,
        userId: userA,
      }),
    ).resolves.toBe(true);
    const allowedAudits = await pool.query<{ action: string; result_code: string }>(
      `SELECT action, result_code FROM wallet_address_book_audit_events
        WHERE actor_user_id = $1 AND outcome = 'allowed' AND request_id LIKE $2
        ORDER BY audit_id`,
      [userA, `${auditRequestPrefix}-%`],
    );
    expect(allowedAudits.rows).toEqual([
      { action: "address-book.create", result_code: "CREATED" },
      { action: "address-book.patch", result_code: "UPDATED" },
      { action: "address-book.delete", result_code: "DELETED" },
    ]);
  });

  it("enforces canonical database constraints and append-only address-book audits", async () => {
    await expect(
      pool.query(
        `INSERT INTO wallet_address_book_entries (
           user_id, chain_id, canonical_address, label, note, category, created_at, updated_at
         ) VALUES ($1, 56, $2, 'Invalid', '', 'person', $3, $3)`,
        [userA, "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", now],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    const denied = await new PostgresAddressBookStore(pool).recordDenied({
      ...audit("address-book.create"),
      outcome: "denied",
      resultCode: "CHAIN_NOT_ALLOWED",
    });
    expect(denied).toBeUndefined();
    const row = await pool.query<{ audit_id: string }>(
      `SELECT audit_id::text FROM wallet_address_book_audit_events
        WHERE actor_user_id = $1 AND outcome = 'denied' AND request_id LIKE $2
        ORDER BY audit_id DESC LIMIT 1`,
      [userA, `${auditRequestPrefix}-%`],
    );
    await expect(
      pool.query(
        "UPDATE wallet_address_book_audit_events SET result_code = 'CHANGED' WHERE audit_id = $1",
        [row.rows[0]!.audit_id],
      ),
    ).rejects.toThrow(/append-only/u);
  });
});
