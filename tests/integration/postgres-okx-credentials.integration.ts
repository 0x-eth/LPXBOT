import { randomUUID } from "node:crypto";

import {
  clearCredentialBytes,
  encryptOkxCredentials,
  LocalOkxKmsFixture,
  OkxCredentialService,
  OkxTransportFixture,
  parseCredentialIngress,
  PostgresOkxCredentialRepository,
  usableOkxFixtureValidation,
} from "../../apps/okx-connector/src/index.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const userA = "74000000-0000-4000-8000-000000000001";
const userB = "74000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-19T05:00:00.000Z");

function context(userId: string, requestId: string, at = now) {
  return { actor: "postgres-fixture", now: at, requestId, userId };
}

function credential(label: string) {
  return Buffer.from(
    JSON.stringify({
      apiKey: `synthetic-postgres-api-${label}`,
      passphrase: `synthetic-postgres-pass-${label}`,
      secretKey: `synthetic-postgres-secret-${label}`,
    }),
  );
}

function service(input?: {
  kms?: LocalOkxKmsFixture;
  repository?: PostgresOkxCredentialRepository;
  responses?: number;
}) {
  return new OkxCredentialService({
    kms: input?.kms ?? new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x61) }),
    now: () => now,
    repository: input?.repository ?? new PostgresOkxCredentialRepository(pool),
    transport: new OkxTransportFixture(
      ...Array.from({ length: input?.responses ?? 8 }, () =>
        structuredClone(usableOkxFixtureValidation),
      ),
    ),
  });
}

beforeAll(async () => {
  await pool.query("DELETE FROM okx_credential_tombstones WHERE user_id IN ($1, $2)", [
    userA,
    userB,
  ]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES
       ($1, 'user', 'normal', 'active', 'OKX fixture A', now(), now()),
       ($2, 'user', 'normal', 'active', 'OKX fixture B', now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [userA, userB],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [userA, userB]);
  await pool.query("DELETE FROM okx_credential_tombstones WHERE user_id IN ($1, $2)", [
    userA,
    userB,
  ]);
  await pool.end();
});

describe("P04-07 PostgreSQL OKX credential store", () => {
  it("stores only envelopes, isolates users and atomically selects one active version", async () => {
    const app = service();
    await app.save({ ...context(userA, "pg-save"), ingress: credential("one") });
    await expect(app.status(userA)).resolves.toEqual({
      configured: true,
      status: "usable",
      version: 1,
    });
    await expect(app.status(userB)).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });
    const repository = new PostgresOkxCredentialRepository(pool);
    await expect(repository.getActiveEnvelope(userB, 1)).resolves.toBeNull();

    const stored = await pool.query<{
      active_count: number;
      ciphertext: string;
      column_names: string[];
      wrapped_dek: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM okx_credential_versions WHERE user_id = $1 AND active) active_count,
         encode((SELECT ciphertext FROM okx_credential_versions WHERE user_id = $1 AND version = 1), 'hex') ciphertext,
         encode((SELECT wrapped_dek FROM okx_credential_versions WHERE user_id = $1 AND version = 1), 'hex') wrapped_dek,
         ARRAY(
           SELECT column_name FROM information_schema.columns
            WHERE table_name = 'user_preferences' ORDER BY column_name
         ) column_names`,
      [userA],
    );
    expect(stored.rows[0]?.active_count).toBe(1);
    expect(JSON.stringify(stored.rows[0])).not.toMatch(
      /synthetic-postgres|api_key|secret_key|passphrase/iu,
    );

    const attempts = await Promise.allSettled([
      service().replace({
        ...context(userA, "pg-replace-a"),
        expectedVersion: 1,
        ingress: credential("two-a"),
      }),
      service().replace({
        ...context(userA, "pg-replace-b"),
        expectedVersion: 1,
        ingress: credential("two-b"),
      }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const active = await pool.query<{ active: number; version: string }>(
      `SELECT count(*) FILTER (WHERE active)::int active,
              max(version) FILTER (WHERE active)::text version
         FROM okx_credential_versions WHERE user_id = $1`,
      [userA],
    );
    expect(active.rows).toEqual([{ active: 1, version: "2" }]);
  });

  it("fails closed on ciphertext/AAD tamper and never returns provider material", async () => {
    const target = randomUUID();
    await pool.query(
      `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
       VALUES ($1, 'user', 'normal', 'active', 'Tamper fixture', now(), now())`,
      [target],
    );
    const kms = new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x62) });
    const app = service({ kms });
    await app.save({ ...context(target, "tamper-save"), ingress: credential("tamper") });
    await pool.query(
      `UPDATE okx_credential_versions
          SET ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 255)
        WHERE user_id = $1 AND version = 1`,
      [target],
    );
    await expect(
      app.test({ ...context(target, "tamper-test"), expectedVersion: 1 }),
    ).resolves.toEqual({ configured: true, status: "revoked", version: 1 });
    await expect(
      app.test({ ...context(target, "tamper-repeat"), expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED" });

    const targetAad = randomUUID();
    await pool.query(
      `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
       VALUES ($1, 'user', 'normal', 'active', 'AAD fixture', now(), now())`,
      [targetAad],
    );
    const aadApp = service({ kms });
    await aadApp.save({ ...context(targetAad, "aad-save"), ingress: credential("aad") });
    await pool.query(
      `UPDATE okx_credential_versions SET environment = 'staging'
        WHERE user_id = $1 AND version = 1`,
      [targetAad],
    );
    await expect(
      aadApp.test({ ...context(targetAad, "aad-test"), expectedVersion: 1 }),
    ).resolves.toMatchObject({ status: "revoked" });
    await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [target, targetAad]);
  });

  it("recovers a deletion interruption after connector/database restart and keeps a tombstone", async () => {
    const target = randomUUID();
    await pool.query(
      `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
       VALUES ($1, 'user', 'normal', 'active', 'Recovery fixture', now(), now())`,
      [target],
    );
    const kms = new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x63) });
    const normal = service({ kms });
    await normal.save({ ...context(target, "recovery-save"), ingress: credential("recover") });
    const faulting = service({
      kms,
      repository: new PostgresOkxCredentialRepository(pool, {
        failAt: "before-complete-delete",
      }),
    });
    await expect(
      faulting.delete({ ...context(target, "recovery-delete"), expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "CONNECTOR_UNAVAILABLE" });

    const restarted = service({ kms, repository: new PostgresOkxCredentialRepository(pool) });
    await expect(restarted.status(target)).resolves.toMatchObject({ status: "deleting" });
    await expect(restarted.recover({ now })).resolves.toBe(1);
    await expect(restarted.status(target)).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      version: 1,
    });
    const destroyed = await pool.query<{
      active: boolean;
      tombstones: number;
      wrapped_dek: Buffer | null;
    }>(
      `SELECT v.active, v.wrapped_dek,
              (SELECT count(*)::int FROM okx_credential_tombstones WHERE user_id = $1) tombstones
         FROM okx_credential_versions v WHERE v.user_id = $1 AND v.version = 1`,
      [target],
    );
    expect(destroyed.rows).toEqual([{ active: false, tombstones: 1, wrapped_dek: null }]);
    await pool.query("DELETE FROM users WHERE id = $1", [target]);
    expect(
      (
        await pool.query<{ tombstones: number }>(
          "SELECT count(*)::int tombstones FROM okx_credential_tombstones WHERE user_id = $1",
          [target],
        )
      ).rows,
    ).toEqual([{ tombstones: 1 }]);
  });

  it("recovers replacement and testing interruptions without changing the active version", async () => {
    const target = randomUUID();
    await pool.query(
      `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
       VALUES ($1, 'user', 'normal', 'active', 'Interrupted replacement fixture', now(), now())`,
      [target],
    );
    const kms = new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x64) });
    const repository = new PostgresOkxCredentialRepository(pool);
    const running = service({ kms, repository });
    await running.save({ ...context(target, "interruption-save"), ingress: credential("active") });
    const head = await repository.getHead(target);
    expect(head).not.toBeNull();
    const stagedCredentials = parseCredentialIngress(credential("staged-replacement"));
    try {
      const staged = await encryptOkxCredentials({
        credentials: stagedCredentials,
        identity: {
          credentialId: head!.credentialId,
          environment: "production",
          userId: target,
          version: 2,
        },
        kms,
        now,
      });
      await repository.createStaged({
        context: context(target, "interruption-stage"),
        envelope: staged,
        expectedActiveVersion: 1,
      });
    } finally {
      clearCredentialBytes(stagedCredentials);
    }

    const restarted = service({ kms, repository: new PostgresOkxCredentialRepository(pool) });
    await expect(restarted.recover({ now, stagedTtlMilliseconds: 0 })).resolves.toBe(1);
    await expect(restarted.status(target)).resolves.toEqual({
      configured: true,
      status: "usable",
      version: 1,
    });
    const afterReplacementRecovery = await pool.query<{
      active_count: number;
      staged_count: number;
    }>(
      `SELECT count(*) FILTER (WHERE active)::int active_count,
              count(*) FILTER (WHERE version = 2)::int staged_count
         FROM okx_credential_versions WHERE user_id = $1`,
      [target],
    );
    expect(afterReplacementRecovery.rows).toEqual([{ active_count: 1, staged_count: 0 }]);
    const replacementRecoveryAudit = await pool.query<{ status: string; version: string }>(
      `SELECT status, version::text
         FROM okx_credential_audit_events
        WHERE user_id = $1 AND request_id = 'recover:2'`,
      [target],
    );
    expect(replacementRecoveryAudit.rows).toEqual([{ status: "usable", version: "2" }]);

    const testing = await repository.setStatus({
      context: context(target, "interruption-testing"),
      expectedVersion: 1,
      status: "testing",
    });
    await expect(restarted.recover({ now })).resolves.toBe(1);
    const recovered = await repository.getHead(target);
    expect(recovered).toMatchObject({
      capabilityEpoch: testing.capabilityEpoch + 1,
      configured: true,
      status: "unknown",
      version: 1,
    });
    await pool.query("DELETE FROM users WHERE id = $1", [target]);
  });

  it("grants ciphertext access only to the connector role and enforces append-only audit", async () => {
    const privileges = await pool.query<{
      connector_delete: boolean;
      connector_select: boolean;
      public_select: boolean;
    }>(
      `SELECT
         has_table_privilege('lpbot_okx_connector', 'okx_credential_versions', 'SELECT') connector_select,
         has_table_privilege('lpbot_okx_connector', 'okx_credential_versions', 'DELETE') connector_delete,
         EXISTS (
           SELECT 1 FROM information_schema.role_table_grants
            WHERE grantee = 'PUBLIC' AND table_name = 'okx_credential_versions'
              AND privilege_type = 'SELECT'
         ) public_select`,
    );
    expect(privileges.rows).toEqual([
      { connector_delete: true, connector_select: true, public_select: false },
    ]);
    await expect(
      pool.query("UPDATE okx_credential_audit_events SET changed = false WHERE user_id = $1", [
        userA,
      ]),
    ).rejects.toThrow(/append-only/iu);
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'okx_credential_audit_events' ORDER BY column_name`,
    );
    expect(columns.rows.map(({ column_name }) => column_name)).toEqual([
      "action",
      "actor",
      "audit_id",
      "changed",
      "created_at",
      "request_id",
      "status",
      "user_id",
      "version",
    ]);
  });
});
