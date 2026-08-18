import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
  type RawTransactionDelivery,
  type WalletTransferPlanAuthorizer,
} from "../apps/signer/src/index.js";
import { deriveArgon2idKek } from "../apps/signer/src/password-crypto.js";
import {
  walletTransferPlanDigest,
  type WalletTransferPlan,
} from "../packages/domain/src/wallet-transfer.js";
import { describe, expect, it } from "vitest";

const userA = "44000000-0000-4000-8000-000000000001";
const userB = "44000000-0000-4000-8000-000000000002";
const sessionA = "44000000-0000-4000-8000-000000000011";
const sessionB = "44000000-0000-4000-8000-000000000012";

function secret(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function fixture(
  options: {
    derivePasswordKek?: (password: Uint8Array, salt: Uint8Array) => Buffer;
    rawTransactionDelivery?: RawTransactionDelivery;
    transferPlanAuthorizer?: WalletTransferPlanAuthorizer;
  } = {},
) {
  let wall = Date.parse("2026-08-18T06:00:00.000Z");
  let monotonic = 10_000;
  let randomSeed = 1;
  const zeroized: Array<{ bytes: Uint8Array; label: string }> = [];
  const store = new InMemoryCustodyWalletStore();
  const kms = new LocalKmsFixture({
    activeVersion: "kek-fixture-v1",
    keys: { "kek-fixture-v1": Buffer.alloc(32, 0x33) },
  });
  const signer = new IsolatedWalletSigner({ kms });
  const makeService = () =>
    new CustodySignerService({
      backoffJitter: () => 0,
      derivePasswordKek:
        options.derivePasswordKek ??
        ((password, salt) =>
          deriveArgon2idKek(password, salt, {
            argonVersion: 19,
            iterations: 2,
            memoryKiB: 32,
            outputBytes: 32,
            parallelism: 1,
          })),
      keystoreStore: store,
      monotonicNow: () => monotonic,
      now: () => new Date(wall),
      onZeroize: (label, bytes) => zeroized.push({ bytes: Uint8Array.from(bytes), label }),
      randomBytes: (length) => Buffer.alloc(length, randomSeed++),
      ...(options.rawTransactionDelivery
        ? { rawTransactionDelivery: options.rawTransactionDelivery }
        : {}),
      signer,
      store,
      ...(options.transferPlanAuthorizer
        ? { transferPlanAuthorizer: options.transferPlanAuthorizer }
        : {}),
      uuid: () => "44000000-0000-4000-8000-000000000099",
    });
  const service = makeService();
  return {
    advance(milliseconds: number) {
      wall += milliseconds;
      monotonic += milliseconds;
    },
    makeService,
    service,
    store,
    zeroized,
  };
}

async function createPassword(service: CustodySignerService, userId: string, password: string) {
  const ingress = secret({ newPassword: password });
  const result = await service.createKeystorePassword({ ingress, userId });
  expect(ingress.every((byte) => byte === 0)).toBe(true);
  return result;
}

async function unlock(
  service: CustodySignerService,
  userId: string,
  reauthenticatedSessionId: string,
  password: string,
) {
  return service.unlockKeystore({
    ingress: secret({ password }),
    reauthenticatedSessionId,
    userId,
  });
}

describe("P04-03 user-password lifecycle", () => {
  it("creates and atomically changes a versioned password with a fresh salt", async () => {
    const { service, store } = fixture();
    await expect(createPassword(service, userA, "synthetic-password-one")).resolves.toEqual({
      configured: true,
      status: "locked",
      version: 1,
    });
    const first = await store.getKeystore(userA);
    expect(first?.current.parameterVersion).toBe(1);
    expect(first?.current.salt).toHaveLength(16);

    await unlock(service, userA, sessionA, "synthetic-password-one");
    await expect(
      service.changeKeystorePassword({
        ingress: secret({
          expectedVersion: 1,
          newPassword: "synthetic-password-two",
          oldPassword: "synthetic-password-one",
        }),
        userId: userA,
      }),
    ).resolves.toEqual({ configured: true, status: "locked", version: 2 });
    const second = await store.getKeystore(userA);
    expect(second?.current.salt).not.toEqual(first?.current.salt);
    await expect(unlock(service, userA, sessionA, "synthetic-password-one")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("rejects duplicate creation, wrong old passwords and concurrent expectedVersion changes", async () => {
    const { advance, service } = fixture();
    await createPassword(service, userA, "synthetic-password-one");
    await expect(createPassword(service, userA, "synthetic-password-other")).rejects.toMatchObject({
      code: "PASSWORD_ALREADY_CONFIGURED",
    });
    await expect(
      service.changeKeystorePassword({
        ingress: secret({
          expectedVersion: 1,
          newPassword: "synthetic-password-three",
          oldPassword: "wrong-password-value",
        }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    advance(2_000);

    const changes = await Promise.allSettled(
      ["synthetic-password-two", "synthetic-password-three"].map((newPassword) =>
        service.changeKeystorePassword({
          ingress: secret({
            expectedVersion: 1,
            newPassword,
            oldPassword: "synthetic-password-one",
          }),
          userId: userA,
        }),
      ),
    );
    expect(changes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(changes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(changes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "SECRET_VERSION_CONFLICT" },
    });
  });

  it("applies exponential backoff and locks only the failing user/session after five errors", async () => {
    const { advance, service } = fixture();
    await Promise.all([
      createPassword(service, userA, "synthetic-password-one"),
      createPassword(service, userB, "synthetic-password-two"),
    ]);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(unlock(service, userA, sessionA, "wrong-password-value")).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
      if (attempt < 5) advance(2 ** (attempt - 1) * 1_000);
    }
    await expect(service.keystoreStatus(userA, sessionA)).resolves.toEqual({
      configured: true,
      status: "locked-out",
      version: 1,
    });
    await expect(unlock(service, userA, sessionA, "synthetic-password-one")).rejects.toMatchObject({
      code: "LOCKED_OUT",
    });
    await expect(unlock(service, userA, sessionB, "synthetic-password-one")).resolves.toMatchObject(
      {
        status: "unlocked",
      },
    );
    await expect(unlock(service, userB, sessionA, "synthetic-password-two")).resolves.toMatchObject(
      {
        status: "unlocked",
      },
    );
    advance(15 * 60_000);
    await expect(unlock(service, userA, sessionA, "synthetic-password-one")).resolves.toMatchObject(
      {
        status: "unlocked",
      },
    );
  });

  it("starts a fresh failure window after 15 minutes", async () => {
    const { advance, service, store } = fixture();
    await createPassword(service, userA, "synthetic-password-one");
    await expect(unlock(service, userA, sessionA, "wrong-password-value")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    advance(15 * 60_000);
    await expect(unlock(service, userA, sessionA, "wrong-password-value")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(store.getKeystoreFailure(userA, sessionA)).resolves.toMatchObject({
      failureCount: 1,
      lockedUntil: null,
    });
  });

  it("binds capabilities to the reauthenticated session and revokes them on manual/auto lock", async () => {
    const { advance, service, zeroized } = fixture();
    await createPassword(service, userA, "synthetic-password-one");
    await unlock(service, userA, sessionA, "synthetic-password-one");
    expect((await service.keystoreStatus(userA, sessionA)).status).toBe("unlocked");
    expect((await service.keystoreStatus(userA, sessionB)).status).toBe("locked");

    await service.lockKeystore(userA);
    expect((await service.keystoreStatus(userA, sessionA)).status).toBe("locked");
    await expect(
      service.updateKeystoreAutoLock({
        expectedVersion: 1,
        minutes: 1,
        reauthenticatedSessionId: sessionA,
        userId: userA,
      }),
    ).resolves.toMatchObject({ status: "locked" });
    await unlock(service, userA, sessionA, "synthetic-password-one");
    await expect(
      service.updateKeystoreAutoLock({
        expectedVersion: 1,
        minutes: 1,
        reauthenticatedSessionId: sessionA,
        userId: userA,
      }),
    ).resolves.toMatchObject({ status: "unlocked" });
    advance(60_001);
    expect((await service.keystoreStatus(userA, sessionA)).status).toBe("locked");
    expect(zeroized.some(({ label }) => label === "derived-kek")).toBe(true);
    expect(zeroized.every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("requires the matching unlock session for plan-bound signing and clears delivered raw bytes", async () => {
    const deliveredRaw: Uint8Array[] = [];
    const authorizer: WalletTransferPlanAuthorizer = {
      authorize: async ({ plan, planDigest }) => walletTransferPlanDigest(plan) === planDigest,
    };
    const delivery: RawTransactionDelivery = {
      async deliver(input) {
        deliveredRaw.push(input.rawTransaction);
        return { deliveryId: "anvil-local:session-bound", status: "accepted" };
      },
    };
    const { service } = fixture({
      rawTransactionDelivery: delivery,
      transferPlanAuthorizer: authorizer,
    });
    const password = "synthetic-password-one";
    await createPassword(service, userA, password);
    const wallet = await service.importWallet({
      ingress: secret({
        mode: "user-password",
        name: "Signing fixture",
        password,
        privateKey: "0000000000000000000000000000000000000000000000000000000000000001",
      }),
      tenantId: "tenant-fixture-01",
      userId: userA,
    });
    await unlock(service, userA, sessionA, password);
    const plan: WalletTransferPlan = {
      amountBaseUnit: "1000",
      asset: { kind: "native" },
      chainId: 31_337,
      deadline: "2026-08-18T06:01:00.000Z",
      feeLimit: {
        feeCapBaseUnit: "42000",
        gasLimit: "21000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      fencingToken: "1",
      nonce: "0",
      operationId: "44000000-0000-4000-8000-000000000088",
      policyDigest: `sha256:${"a".repeat(64)}`,
      recipient: "0x1111111111111111111111111111111111111111",
      transactionData: "0x",
      transactionTarget: "0x1111111111111111111111111111111111111111",
      transactionValueBaseUnit: "1000",
      walletAddress: wallet.address.toLowerCase() as `0x${string}`,
      walletId: wallet.walletId,
    };
    const planDigest = walletTransferPlanDigest(plan);

    await expect(
      service.signWalletTransfer({
        plan,
        planDigest,
        reauthenticatedSessionId: sessionB,
        tenantId: "tenant-fixture-01",
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const signed = await service.signWalletTransfer({
      plan,
      planDigest,
      reauthenticatedSessionId: sessionA,
      tenantId: "tenant-fixture-01",
      userId: userA,
    });
    expect(signed).toMatchObject({
      deliveryId: "anvil-local:session-bound",
      planDigest,
      status: "accepted",
    });
    expect(JSON.stringify(signed)).not.toContain("rawTransaction");
    expect(deliveredRaw).toHaveLength(1);
    expect(deliveredRaw[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it("starts locked after signer restart and clears password/KEK buffers on every path", async () => {
    const { makeService, service, zeroized } = fixture();
    await createPassword(service, userA, "synthetic-password-one");
    await unlock(service, userA, sessionA, "synthetic-password-one");
    const restarted = makeService();
    expect(await restarted.keystoreStatus(userA, sessionA)).toEqual({
      configured: true,
      status: "locked",
      version: 1,
    });
    await service.shutdown();
    expect(zeroized.some(({ label }) => label === "password")).toBe(true);
    expect(zeroized.some(({ label }) => label === "derived-kek")).toBe(true);
    expect(zeroized.every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("clears ingress, password and partial KEK material when derivation fails", async () => {
    const partialKek = Buffer.alloc(31, 0xa5);
    const { service, zeroized } = fixture({ derivePasswordKek: () => partialKek });
    const ingress = secret({ newPassword: "synthetic-password-one" });
    await expect(service.createKeystorePassword({ ingress, userId: userA })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(ingress.every((byte) => byte === 0)).toBe(true);
    expect(partialKek.every((byte) => byte === 0)).toBe(true);
    expect(zeroized.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["password", "derived-kek", "secret-ingress"]),
    );
    expect(zeroized.every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);
  });
});
