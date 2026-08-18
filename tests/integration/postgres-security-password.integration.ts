import { randomUUID } from "node:crypto";

import {
  CustodySignerService,
  deriveSecurityPasswordKey,
  IsolatedWalletSigner,
  LocalKmsFixture,
  PostgresCustodyWalletStore,
} from "../../apps/signer/src/index.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const userA = randomUUID();
const userB = randomUUID();
const passwordOne = "synthetic-security-password-one";
const passwordTwo = "synthetic-security-password-two";
let currentUserAPassword = passwordOne;

function secret(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function application(store = new PostgresCustodyWalletStore(pool)) {
  let random = 1;
  return new CustodySignerService({
    deriveSecurityPasswordKey: (password, salt) =>
      deriveSecurityPasswordKey(password, salt, {
        argonVersion: 19,
        iterations: 2,
        memoryKiB: 32,
        outputBytes: 32,
        parallelism: 1,
      }),
    randomBytes: (length) => Buffer.alloc(length, random++),
    securityPasswordStore: store,
    signer: new IsolatedWalletSigner({
      kms: new LocalKmsFixture({
        activeVersion: "kek-fixture-v1",
        keys: { "kek-fixture-v1": Buffer.alloc(32, 0x56) },
      }),
    }),
    store,
  });
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'Security A', now(), now()),
       ($2, 'user', 'normal', 'active', 'Security B', now(), now())`,
    [userA, userB],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [userA, userB]);
  await pool.end();
});

describe("P04-04 PostgreSQL security password lifecycle", () => {
  it("serializes creation, preserves immutable versions, and persists failures", async () => {
    const first = application();
    const second = application();
    const attempts = await Promise.allSettled([
      first.putSecurityPassword({
        ingress: secret({ expectedVersion: 0, newPassword: passwordOne, oldPassword: null }),
        userId: userA,
      }),
      second.putSecurityPassword({
        ingress: secret({ expectedVersion: 0, newPassword: passwordTwo, oldPassword: null }),
        userId: userA,
      }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const currentPassword = attempts[0]?.status === "fulfilled" ? passwordOne : passwordTwo;
    const nextPassword = currentPassword === passwordOne ? passwordTwo : passwordOne;

    await expect(
      first.putSecurityPassword({
        ingress: secret({
          expectedVersion: 1,
          newPassword: nextPassword,
          oldPassword: "synthetic-security-password-wrong",
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(
      (await new PostgresCustodyWalletStore(pool).getSecurityPassword(userA))!.failureCount,
    ).toBe(1);

    await first.putSecurityPassword({
      ingress: secret({
        expectedVersion: 1,
        newPassword: nextPassword,
        oldPassword: currentPassword,
      }),
      userId: userA,
    });
    currentUserAPassword = nextPassword;
    expect(
      (
        await pool.query(
          `SELECT
             (SELECT current_version::int FROM user_security_passwords WHERE user_id = $1) AS version,
             (SELECT count(*)::int FROM user_security_password_versions WHERE user_id = $1) AS versions,
             (SELECT count(*)::int FROM security_password_audit_events WHERE user_id = $1) AS audits`,
          [userA],
        )
      ).rows[0],
    ).toEqual({ audits: 3, version: 2, versions: 2 });
    await expect(
      pool.query(
        "UPDATE user_security_password_versions SET verifier = $2 WHERE user_id = $1 AND version = 1",
        [userA, Buffer.alloc(32, 0x99)],
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("rolls a version rotation fault back without changing the current verifier", async () => {
    const store = new PostgresCustodyWalletStore(pool);
    const before = await store.getSecurityPassword(userA);
    const faulting = application(
      new PostgresCustodyWalletStore(pool, { failAt: "before-lifecycle-commit" }),
    );
    await expect(
      faulting.putSecurityPassword({
        ingress: secret({
          expectedVersion: 2,
          newPassword: passwordOne,
          oldPassword: currentUserAPassword,
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    const after = await store.getSecurityPassword(userA);
    expect(after!.current.version).toBe(2);
    expect(after!.current.verifier).toEqual(before!.current.verifier);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM user_security_password_versions WHERE user_id = $1",
          [userA],
        )
      ).rows[0].count,
    ).toBe(2);
  });

  it("keeps users isolated and stores no plaintext or derived-key columns", async () => {
    expect(await application().securityPasswordStatus(userB)).toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('user_security_passwords', 'user_security_password_versions')`,
    );
    expect(columns.rows.map(({ column_name }) => column_name).join(" ")).not.toMatch(
      /plaintext|password$|derived_key|derived_kek|private_key/iu,
    );
  });
});
