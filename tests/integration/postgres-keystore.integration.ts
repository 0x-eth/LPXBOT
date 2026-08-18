import { randomUUID } from "node:crypto";

import {
  CustodySignerService,
  IsolatedWalletSigner,
  LocalKmsFixture,
  PostgresCustodyWalletStore,
} from "../../apps/signer/src/index.js";
import { deriveArgon2idKek } from "../../apps/signer/src/password-crypto.js";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");

const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const tenantId = "tenant-fixture-01";
const userId = "47000000-0000-4000-8000-000000000001";
const sessionId = "47000000-0000-4000-8000-000000000010";
const privateKeyOne = "0000000000000000000000000000000000000000000000000000000000000001";
const privateKeyTwo = "0000000000000000000000000000000000000000000000000000000000000002";
const kms = new LocalKmsFixture({
  activeVersion: "kek-fixture-v1",
  keys: { "kek-fixture-v1": Buffer.alloc(32, 0x47) },
});

function secret(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function application(store = new PostgresCustodyWalletStore(pool)) {
  let random = 1;
  return new CustodySignerService({
    backoffJitter: () => 0,
    dependencyInventory: {
      inspect: async () => ({
        assetRiskDigest: "sha256:postgres-fixture",
        complete: true,
        policyCount: 0,
        strategyCount: 0,
        taskCount: 0,
        walletsWithNonzeroAssets: 0,
        walletsWithPositions: 0,
      }),
    },
    derivePasswordKek: (password, salt) =>
      deriveArgon2idKek(password, salt, {
        argonVersion: 19,
        iterations: 2,
        memoryKiB: 32,
        outputBytes: 32,
        parallelism: 1,
      }),
    keystoreStore: store,
    randomBytes: (length) => Buffer.alloc(length, random++),
    signer: new IsolatedWalletSigner({
      kms,
      secretRandomBytes: (length) => Buffer.alloc(length, random++),
    }),
    store,
    uuid: randomUUID,
  });
}

beforeEach(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query(
    `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
     VALUES ($1, 'user', 'normal', 'active', 'Keystore fixture', now(), now())`,
    [userId],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

describe("P04-03 PostgreSQL Keystore lifecycle", () => {
  it("serializes concurrent password creation and persists session-scoped lockout", async () => {
    const first = application();
    const second = application();
    const creates = await Promise.allSettled([
      first.createKeystorePassword({
        ingress: secret({ newPassword: "synthetic-password-one" }),
        userId,
      }),
      second.createKeystorePassword({
        ingress: secret({ newPassword: "synthetic-password-two" }),
        userId,
      }),
    ]);
    expect(creates.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(creates.filter(({ status }) => status === "rejected")).toHaveLength(1);

    const configuredPassword =
      creates[0]?.status === "fulfilled" ? "synthetic-password-one" : "synthetic-password-two";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pool.query(
        `UPDATE user_keystore_failures SET backoff_until = window_started_at
          WHERE user_id = $1 AND source_session_id = $2`,
        [userId, sessionId],
      );
      await expect(
        first.unlockKeystore({
          ingress: secret({ password: "synthetic-password-wrong" }),
          reauthenticatedSessionId: sessionId,
          userId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    expect(await application().keystoreStatus(userId, sessionId)).toMatchObject({
      status: "locked-out",
    });
    expect(configuredPassword).toMatch(/^synthetic-password-(?:one|two)$/u);
  });

  it("atomically reseals password wallets and restarts locked on the new version", async () => {
    const service = application();
    await service.createKeystorePassword({
      ingress: secret({ newPassword: "synthetic-password-one" }),
      userId,
    });
    const wallet = await service.importWallet({
      ingress: secret({
        mode: "user-password",
        name: "Password",
        password: "synthetic-password-one",
        privateKey: privateKeyOne,
      }),
      tenantId,
      userId,
    });
    await service.changeKeystorePassword({
      ingress: secret({
        expectedVersion: 1,
        newPassword: "synthetic-password-two",
        oldPassword: "synthetic-password-one",
      }),
      userId,
    });
    const restarted = application();
    expect(await restarted.keystoreStatus(userId, sessionId)).toEqual({
      configured: true,
      status: "locked",
      version: 2,
    });
    await restarted.unlockKeystore({
      ingress: secret({ password: "synthetic-password-two" }),
      reauthenticatedSessionId: sessionId,
      userId,
    });
    await expect(
      restarted.recoverWallet({
        reauthenticatedSessionId: sessionId,
        tenantId,
        userId,
        walletId: wallet.walletId,
      }),
    ).resolves.toMatchObject({ envelopeVersion: 2, mode: "user-password" });
  });

  it("rolls lifecycle faults back, then resets only password-mode wallets", async () => {
    const service = application();
    await service.createKeystorePassword({
      ingress: secret({ newPassword: "synthetic-password-one" }),
      userId,
    });
    const server = await service.importWallet({
      ingress: secret({ mode: "server-kek", name: "Server", privateKey: privateKeyOne }),
      tenantId,
      userId,
    });
    const password = await service.importWallet({
      ingress: secret({
        mode: "user-password",
        name: "Password",
        password: "synthetic-password-one",
        privateKey: privateKeyTwo,
      }),
      tenantId,
      userId,
    });
    const faulting = application(
      new PostgresCustodyWalletStore(pool, { failAt: "before-lifecycle-commit" }),
    );
    await expect(
      faulting.changeKeystorePassword({
        ingress: secret({
          expectedVersion: 1,
          newPassword: "synthetic-password-two",
          oldPassword: "synthetic-password-one",
        }),
        userId,
      }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(await new PostgresCustodyWalletStore(pool).get(userId, password.walletId)).toMatchObject(
      {
        envelopeVersion: 1,
      },
    );

    const preview = await service.createKeystoreResetPreview(userId);
    await service.resetKeystore({
      ingress: secret({
        confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
        expectedVersion: 1,
        previewToken: preview.previewToken,
      }),
      userId,
    });
    const store = new PostgresCustodyWalletStore(pool);
    expect(await store.get(userId, password.walletId)).toBeNull();
    expect(await store.get(userId, server.walletId)).toMatchObject({ mode: "server-kek" });
  });
});
