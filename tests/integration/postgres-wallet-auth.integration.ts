import { randomBytes } from "node:crypto";

import { PostgresSessionStore } from "../../apps/api/src/index.js";
import {
  LoginWalletAuthenticationService,
  WalletAuthenticationError,
} from "../../packages/security/src/index.js";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const now = new Date("2026-08-14T10:00:00.000Z");
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const account = privateKeyToAccount(generatePrivateKey());
const linkAccount = privateKeyToAccount(generatePrivateKey());
const linkUserIds = [
  "30000000-0000-4000-8000-000000000071",
  "30000000-0000-4000-8000-000000000072",
] as const;
const telegramSubject = "430000000071";

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [linkUserIds]);
  await pool.query(
    `DELETE FROM users
      WHERE id IN (
        SELECT user_id FROM auth_login_wallets WHERE address = decode($1, 'hex')
      )`,
    [account.address.slice(2).toLowerCase()],
  );
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Link User A', NULL, $3, $3),
       ($2, 'user', 'normal', 'active', 'Link User B', NULL, $3, $3)`,
    [...linkUserIds, now],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [linkUserIds]);
  await pool.query(
    `DELETE FROM users
      WHERE id IN (
        SELECT user_id FROM auth_login_wallets WHERE address = decode($1, 'hex')
      )`,
    [account.address.slice(2).toLowerCase()],
  );
  await pool.end();
});

describe("P01-04 PostgreSQL login wallet authentication", () => {
  it("persists hash-only challenges and atomically permits one concurrent EOA login", async () => {
    const store = new PostgresSessionStore(pool);
    const service = new LoginWalletAuthenticationService(store, {
      challengeKey: randomBytes(32),
      challengeTtlSeconds: 300,
      domain: "lpbot.local",
      now: () => now,
      sessionTtlSeconds: 3_600,
      uri: "https://lpbot.local/login",
    });
    const challenge = await service.createLoginChallenge({
      address: account.address,
      chainId: 56,
      requestId: "postgres-wallet-nonce",
    });
    const signature = await account.signMessage({ message: challenge.message });

    const persistence = await pool.query<{
      address_size: number;
      id_hash_size: number;
      message_hash_size: number;
      nonce_hash_size: number;
      persisted: string;
    }>(
      `SELECT octet_length(address)::int AS address_size,
              octet_length(id_hash)::int AS id_hash_size,
              octet_length(message_hash)::int AS message_hash_size,
              octet_length(nonce_hash)::int AS nonce_hash_size,
              row_to_json(c)::text AS persisted
         FROM auth_wallet_challenges c
        WHERE address = decode($1, 'hex')`,
      [account.address.slice(2).toLowerCase()],
    );
    expect(persistence.rows[0]).toMatchObject({
      address_size: 20,
      id_hash_size: 32,
      message_hash_size: 32,
      nonce_hash_size: 32,
    });
    for (const sensitive of [challenge.nonceId, challenge.message, signature]) {
      expect(persistence.rows[0]?.persisted).not.toContain(sensitive);
    }

    const attempts = await Promise.allSettled(
      ["postgres-wallet-login-a", "postgres-wallet-login-b"].map((requestId) =>
        service.login({
          address: account.address,
          chainId: 56,
          nonceId: challenge.nonceId,
          requestId,
          signature,
        }),
      ),
    );
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: "NONCE_REPLAYED" }),
      status: "rejected",
    });
    expect(
      rejected?.status === "rejected" && rejected.reason instanceof WalletAuthenticationError,
    ).toBe(true);

    const winner = attempts.find(({ status }) => status === "fulfilled");
    expect(winner?.status === "fulfilled" && winner.value.account.status).toBe("pending");
    const rows = await pool.query<{
      consumed_count: number;
      identity_count: number;
      session_count: number;
      user_count: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM auth_wallet_challenges
           WHERE address = decode($1, 'hex') AND consumed_at IS NOT NULL) AS consumed_count,
         (SELECT count(*)::int FROM auth_login_wallets
           WHERE address = decode($1, 'hex')) AS identity_count,
         (SELECT count(*)::int FROM sessions s JOIN auth_login_wallets w ON w.user_id = s.user_id
           WHERE w.address = decode($1, 'hex')) AS session_count,
         (SELECT count(*)::int FROM users u JOIN auth_login_wallets w ON w.user_id = u.id
           WHERE w.address = decode($1, 'hex') AND u.status = 'pending'
             AND u.role = 'user' AND u.tier = 'normal') AS user_count`,
      [account.address.slice(2).toLowerCase()],
    );
    expect(rows.rows[0]).toEqual({
      consumed_count: 1,
      identity_count: 1,
      session_count: 1,
      user_count: 1,
    });
  });

  it("isolates link challenges, unique addresses, owned deletion and last-login protection", async () => {
    const store = new PostgresSessionStore(pool);
    const service = new LoginWalletAuthenticationService(store, {
      challengeKey: randomBytes(32),
      challengeTtlSeconds: 300,
      domain: "lpbot.local",
      now: () => now,
      sessionTtlSeconds: 3_600,
      uri: "https://lpbot.local/login",
    });
    const challenge = await service.createLinkChallenge({
      address: linkAccount.address,
      chainId: 56,
      requestId: "postgres-link-nonce-a",
      userId: linkUserIds[0],
    });
    const signature = await linkAccount.signMessage({ message: challenge.message });

    await expect(
      service.link({
        address: linkAccount.address,
        chainId: 56,
        label: "Primary login",
        nonceId: challenge.nonceId,
        requestId: "postgres-cross-user-link",
        signature,
        userId: linkUserIds[1],
      }),
    ).rejects.toMatchObject({ code: "NONCE_MISMATCH" });
    const linked = await service.link({
      address: linkAccount.address,
      chainId: 56,
      label: "Primary login",
      nonceId: challenge.nonceId,
      requestId: "postgres-link-valid",
      signature,
      userId: linkUserIds[0],
    });
    expect(await service.listLinks(linkUserIds[0])).toEqual([linked]);
    expect(await service.listLinks(linkUserIds[1])).toEqual([]);

    await expect(
      service.createLinkChallenge({
        address: linkAccount.address,
        chainId: 56,
        requestId: "postgres-link-duplicate",
        userId: linkUserIds[1],
      }),
    ).rejects.toMatchObject({ code: "ADDRESS_ALREADY_LINKED" });
    await expect(
      service.unlink({
        linkId: linked.linkId,
        requestId: "postgres-link-delete-cross-user",
        userId: linkUserIds[1],
      }),
    ).rejects.toMatchObject({ code: "LINK_NOT_FOUND" });
    await expect(
      service.unlink({
        linkId: linked.linkId,
        requestId: "postgres-link-delete-last",
        userId: linkUserIds[0],
      }),
    ).rejects.toMatchObject({ code: "LAST_LOGIN_METHOD" });

    await pool.query(
      `INSERT INTO telegram_identities (telegram_user_id, user_id, created_at)
       VALUES ($1, $2, $3)`,
      [telegramSubject, linkUserIds[0], now],
    );
    await expect(
      service.unlink({
        linkId: linked.linkId,
        requestId: "postgres-link-delete-valid",
        userId: linkUserIds[0],
      }),
    ).resolves.toEqual({ deleted: true });
    expect(await service.listLinks(linkUserIds[0])).toEqual([]);
  });
});
