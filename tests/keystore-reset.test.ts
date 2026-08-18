import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
} from "../apps/signer/src/index.js";
import { deriveArgon2idKek } from "../apps/signer/src/password-crypto.js";
import { describe, expect, it } from "vitest";

const tenantId = "tenant-fixture-01";
const userA = "46000000-0000-4000-8000-000000000001";
const userB = "46000000-0000-4000-8000-000000000002";
const privateKeyOne = "0000000000000000000000000000000000000000000000000000000000000001";
const privateKeyTwo = "0000000000000000000000000000000000000000000000000000000000000002";

function secret(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function fixture(options: { failLifecycleAt?: "before-commit"; inventory?: boolean } = {}) {
  let now = Date.parse("2026-08-18T07:00:00.000Z");
  let id = 10;
  let random = 1;
  const dependencyState = {
    assetRiskDigest: "sha256:fixture-risk-v1",
    complete: true,
    policyCount: 2,
    strategyCount: 1,
    taskCount: 3,
    walletsWithNonzeroAssets: 1,
    walletsWithPositions: 1,
  };
  const store = new InMemoryCustodyWalletStore(
    options.failLifecycleAt ? { failLifecycleAt: options.failLifecycleAt } : {},
  );
  const signer = new IsolatedWalletSigner({
    kms: new LocalKmsFixture({
      activeVersion: "kek-fixture-v1",
      keys: { "kek-fixture-v1": Buffer.alloc(32, 0x61) },
    }),
    secretRandomBytes: (length) => Buffer.alloc(length, random++),
  });
  const service = new CustodySignerService({
    backoffJitter: () => 0,
    dependencyInventory:
      options.inventory === false
        ? undefined
        : { inspect: async () => structuredClone(dependencyState) },
    derivePasswordKek: (password, salt) =>
      deriveArgon2idKek(password, salt, {
        argonVersion: 19,
        iterations: 2,
        memoryKiB: 32,
        outputBytes: 32,
        parallelism: 1,
      }),
    keystoreStore: store,
    now: () => new Date(now),
    randomBytes: (length) => Buffer.alloc(length, random++),
    signer,
    store,
    uuid: () => `46000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
  });
  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
    dependencyState,
    service,
    store,
  };
}

async function seed(service: CustodySignerService) {
  await service.createKeystorePassword({
    ingress: secret({ newPassword: "synthetic-password-one" }),
    userId: userA,
  });
  const server = await service.importWallet({
    ingress: secret({ mode: "server-kek", name: "Server", privateKey: privateKeyOne }),
    tenantId,
    userId: userA,
  });
  const password = await service.importWallet({
    ingress: secret({
      mode: "user-password",
      name: "Password",
      password: "synthetic-password-one",
      privateKey: privateKeyTwo,
    }),
    tenantId,
    userId: userA,
  });
  return { password, server };
}

describe("P04-03 forgotten-password reset", () => {
  it("binds a five-minute preview to user, version, counts and asset-risk content", async () => {
    const { service } = fixture();
    await seed(service);
    const preview = await service.createKeystoreResetPreview(userA);
    expect(preview).toMatchObject({
      confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
      policyCount: 2,
      secretVersion: 1,
      strategyCount: 1,
      taskCount: 3,
      walletCount: 1,
      walletsWithNonzeroAssets: 1,
      walletsWithPositions: 1,
    });
    expect(Date.parse(preview.expiresAt) - Date.parse("2026-08-18T07:00:00.000Z")).toBe(300_000);
    expect(preview.previewToken.length).toBeGreaterThanOrEqual(32);
  });

  it("rejects expiry, changed dependencies, cross-user tokens and a wrong phrase", async () => {
    const { advance, dependencyState, service } = fixture();
    await seed(service);
    const wrongPhrase = await service.createKeystoreResetPreview(userA);
    await expect(
      service.resetKeystore({
        ingress: secret({
          confirmationPhrase: "WRONG",
          expectedVersion: 1,
          previewToken: wrongPhrase.previewToken,
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });

    await expect(
      service.resetKeystore({
        ingress: secret({
          confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
          expectedVersion: 1,
          previewToken: wrongPhrase.previewToken,
        }),
        userId: userB,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });

    const changed = await service.createKeystoreResetPreview(userA);
    dependencyState.taskCount += 1;
    await expect(
      service.resetKeystore({
        ingress: secret({
          confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
          expectedVersion: 1,
          previewToken: changed.previewToken,
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_CHANGED" });

    dependencyState.taskCount -= 1;
    const expired = await service.createKeystoreResetPreview(userA);
    advance(300_001);
    await expect(
      service.resetKeystore({
        ingress: secret({
          confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
          expectedVersion: 1,
          previewToken: expired.previewToken,
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });
  });

  it("atomically destroys password-mode recovery material and preserves server-kek wallets", async () => {
    const { service, store } = fixture();
    const { password, server } = await seed(service);
    const preview = await service.createKeystoreResetPreview(userA);
    await expect(
      service.resetKeystore({
        ingress: secret({
          confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
          expectedVersion: 1,
          previewToken: preview.previewToken,
        }),
        userId: userA,
      }),
    ).resolves.toEqual({ configured: false, status: "unconfigured", version: 0 });
    expect(await store.get(userA, password.walletId)).toBeNull();
    expect(await store.getCurrentEnvelope(password.walletId, 1)).toBeNull();
    expect(await store.get(userA, server.walletId)).toMatchObject({ mode: "server-kek" });
    expect(await store.getCurrentEnvelope(server.walletId, 1)).not.toBeNull();
  });

  it("rolls back every destruction when the lifecycle transaction faults", async () => {
    const { service, store } = fixture({ failLifecycleAt: "before-commit" });
    const { password, server } = await seed(service);
    const preview = await service.createKeystoreResetPreview(userA);
    await expect(
      service.resetKeystore({
        ingress: secret({
          confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
          expectedVersion: 1,
          previewToken: preview.previewToken,
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(await store.get(userA, password.walletId)).not.toBeNull();
    expect(await store.get(userA, server.walletId)).not.toBeNull();
    expect(await store.getKeystore(userA)).not.toBeNull();
  });

  it("fails closed when task/asset/policy inventory is unavailable or incomplete", async () => {
    const missing = fixture({ inventory: false });
    await seed(missing.service);
    await expect(missing.service.createKeystoreResetPreview(userA)).rejects.toMatchObject({
      code: "CUSTODY_STORE_UNAVAILABLE",
    });

    const incomplete = fixture();
    incomplete.dependencyState.complete = false;
    await seed(incomplete.service);
    await expect(incomplete.service.createKeystoreResetPreview(userA)).rejects.toMatchObject({
      code: "CUSTODY_STORE_UNAVAILABLE",
    });
  });
});
