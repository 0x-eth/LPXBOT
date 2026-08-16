import {
  buildApiApp,
  PostgresAddressRemarkStore,
  PostgresSessionStore,
} from "../../apps/api/src/index.js";
import { SessionIssuer } from "../../packages/security/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const userIds = [
  "28000000-0000-4000-8000-000000000001",
  "28000000-0000-4000-8000-000000000002",
  "28000000-0000-4000-8000-000000000003",
] as const;
const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const now = new Date("2026-08-16T08:00:00.000Z");
const pool = new Pool({ connectionString: databaseUrl, max: 6 });

beforeAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.query(
    `INSERT INTO users (
       id, role, tier, status, display_name, avatar_url, created_at, updated_at
     ) VALUES
       ($1, 'user', 'normal', 'active', 'Remark A', NULL, $4, $4),
       ($2, 'user', 'normal', 'active', 'Remark B', NULL, $4, $4),
       ($3, 'user', 'normal', 'active', 'Remark C', NULL, $4, $4)`,
    [...userIds, now],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  await pool.end();
});

async function session(userId: string): Promise<string> {
  return (
    await new SessionIssuer(new PostgresSessionStore(pool), { now: () => now }).issue({
      expiresAt: new Date("2026-08-16T09:00:00.000Z"),
      userId,
    })
  ).token;
}

function createApp() {
  return buildApiApp({
    addressRemarkStore: new PostgresAddressRemarkStore(pool),
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: new PostgresSessionStore(pool),
  });
}

function headers(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

describe("P02-05 PostgreSQL address remarks", () => {
  it("migrates the user/chain/address key and keeps successful writes with their audits atomic", async () => {
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'address_remarks'
        ORDER BY ordinal_position`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "user_id",
      "chain_id",
      "canonical_address",
      "label",
      "watched",
      "created_at",
      "updated_at",
    ]);
    const constraint = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'address_remarks_user_chain_address_key'`,
    );
    expect(constraint.rows[0]?.definition).toContain(
      "UNIQUE (user_id, chain_id, canonical_address)",
    );

    const token = await session(userIds[0]);
    const app = createApp();
    const responses = await Promise.all([
      app.inject({
        headers: headers(token),
        method: "PUT",
        payload: { address, label: "First", watched: false },
        url: "/api/address-remarks",
      }),
      app.inject({
        headers: headers(token),
        method: "PUT",
        payload: { address, label: "Second", watched: true },
        url: "/api/address-remarks",
      }),
    ]);
    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true);
    const stored = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM address_remarks
        WHERE user_id = $1 AND chain_id = 56 AND canonical_address = $2`,
      [userIds[0], address],
    );
    expect(stored.rows).toEqual([{ count: "1" }]);
    const audits = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM address_remark_audit_events
        WHERE actor_user_id = $1 AND action = 'address-remark.put' AND outcome = 'allowed'`,
      [userIds[0]],
    );
    expect(audits.rows).toEqual([{ count: "2" }]);
    await app.close();
  });

  it("isolates personal rows and exposes only the stable winning shared label", async () => {
    const tokens = await Promise.all(userIds.map((userId) => session(userId)));
    const app = createApp();
    for (const [token, label] of [
      [tokens[0], "Zebra"],
      [tokens[1], "Alpha"],
      [tokens[2], "Alpha"],
    ] as const) {
      const response = await app.inject({
        headers: headers(token),
        method: "PUT",
        payload: { address: address.toUpperCase().replace("0X", "0x"), label, watched: false },
        url: "/api/address-remarks",
      });
      expect(response.statusCode).toBe(200);
    }

    const mine = await app.inject({
      headers: headers(tokens[0]),
      method: "GET",
      url: "/api/address-remarks",
    });
    expect(mine.json().data).toEqual({
      remarks: [{ address, label: "Zebra", watched: false }],
      shared: [{ address, label: "Alpha", votes: 2 }],
    });
    expect(mine.body).not.toContain(userIds[1]);
    expect(mine.body).not.toContain(userIds[2]);

    const deleted = await app.inject({
      headers: headers(tokens[1]),
      method: "DELETE",
      url: `/api/address-remarks/${address}`,
    });
    const absent = await app.inject({
      headers: headers(tokens[1]),
      method: "DELETE",
      url: `/api/address-remarks/${address}`,
    });
    expect(deleted.json().data).toEqual({ deleted: true });
    expect(absent.json().data).toEqual({ deleted: false });
    const stillMine = await app.inject({
      headers: headers(tokens[0]),
      method: "GET",
      url: "/api/address-remarks",
    });
    expect(stillMine.json().data.remarks).toEqual([{ address, label: "Zebra", watched: false }]);
    expect(stillMine.json().data.shared).toEqual([{ address, label: "Alpha", votes: 1 }]);
    await app.close();
  });

  it("enforces canonical and control-free labels in PostgreSQL and keeps audits append-only", async () => {
    const invalidRows = [
      ["0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "Valid", "address_remarks_canonical_address_valid"],
      ["0xcccccccccccccccccccccccccccccccccccccccc", " padded ", "address_remarks_label_valid"],
      ["0xdddddddddddddddddddddddddddddddddddddddd", "x".repeat(33), "address_remarks_label_valid"],
      ["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "line\nbreak", "address_remarks_label_valid"],
    ] as const;
    for (const [candidateAddress, label, constraint] of invalidRows) {
      await expect(
        pool.query(
          `INSERT INTO address_remarks (
             user_id, chain_id, canonical_address, label, watched, created_at, updated_at
           ) VALUES ($1, 56, $2, $3, false, $4, $4)`,
          [userIds[0], candidateAddress, label, now],
        ),
      ).rejects.toMatchObject({ constraint });
    }

    const token = await session(userIds[0]);
    const app = createApp();
    const invalid = await app.inject({
      headers: headers(token),
      method: "PUT",
      payload: { address, label: "bad\nlabel", watched: false },
      url: "/api/address-remarks",
    });
    expect(invalid.statusCode).toBe(400);
    const audit = await pool.query<{ id: string; result_code: string }>(
      `SELECT id::text, result_code
         FROM address_remark_audit_events
        WHERE actor_user_id = $1 AND outcome = 'denied'
        ORDER BY id DESC LIMIT 1`,
      [userIds[0]],
    );
    expect(audit.rows[0]?.result_code).toBe("ADDRESS_REMARK_INVALID");
    await expect(
      pool.query("UPDATE address_remark_audit_events SET result_code = 'CHANGED' WHERE id = $1", [
        audit.rows[0]?.id,
      ]),
    ).rejects.toThrow(/append-only/u);
    await app.close();
  });
});
