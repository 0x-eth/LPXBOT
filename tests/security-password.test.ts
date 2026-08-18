import {
  createPasswordVerifier,
  createSecurityPasswordVerifier,
  CustodySignerService,
  deriveArgon2idKek,
  deriveSecurityPasswordKey,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
  securityPasswordKdfV1,
} from "../apps/signer/src/index.js";
import { describe, expect, it } from "vitest";

const userA = "54000000-0000-4000-8000-000000000001";
const userB = "54000000-0000-4000-8000-000000000002";
const sessionId = "54000000-0000-4000-8000-000000000010";
const passwordOne = "synthetic-shared-password";
const passwordTwo = "synthetic-security-password-two";
const parameters = {
  argonVersion: 19,
  iterations: 2,
  memoryKiB: 32,
  outputBytes: 32,
  parallelism: 1,
};

function secret(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

describe("P04-04 security password domain", () => {
  it("uses a distinct KDF input domain and verifier domain from Keystore", () => {
    const password = Buffer.from(passwordOne);
    const salt = Buffer.alloc(16, 0x54);
    const keystoreKey = deriveArgon2idKek(password, salt, parameters);
    const securityKey = deriveSecurityPasswordKey(password, salt, parameters);
    try {
      expect(securityPasswordKdfV1.domain).toBe("lpbot-security-password-kdf/v1");
      expect(securityKey.equals(keystoreKey)).toBe(false);
      const keystoreVerifier = createPasswordVerifier(keystoreKey, {
        secretVersion: 1,
        userId: userA,
      });
      const securityVerifier = createSecurityPasswordVerifier(securityKey, {
        userId: userA,
        version: 1,
      });
      try {
        expect(securityVerifier.equals(keystoreVerifier)).toBe(false);
      } finally {
        keystoreVerifier.fill(0);
        securityVerifier.fill(0);
      }
    } finally {
      password.fill(0);
      salt.fill(0);
      keystoreKey.fill(0);
      securityKey.fill(0);
    }
  });

  it("keeps salt, storage, failures, audit, and sessions independent", async () => {
    const salts = [Buffer.alloc(16, 0x11), Buffer.alloc(16, 0x11), Buffer.alloc(16, 0x22)];
    const zeroized: Array<{ bytes: Uint8Array; label: string }> = [];
    const store = new InMemoryCustodyWalletStore();
    const service = new CustodySignerService({
      backoffJitter: () => 0,
      derivePasswordKek: (password, salt) => deriveArgon2idKek(password, salt, parameters),
      deriveSecurityPasswordKey: (password, salt) =>
        deriveSecurityPasswordKey(password, salt, parameters),
      onZeroize: (label, bytes) => zeroized.push({ bytes: Uint8Array.from(bytes), label }),
      randomBytes: (length) => {
        if (length === 16 && salts.length > 0) return salts.shift()!;
        return Buffer.alloc(length, 0x33);
      },
      signer: new IsolatedWalletSigner({
        kms: new LocalKmsFixture({
          activeVersion: "kek-fixture-v1",
          keys: { "kek-fixture-v1": Buffer.alloc(32, 0x54) },
        }),
      }),
      store,
    });

    await service.createKeystorePassword({
      ingress: secret({ newPassword: passwordOne }),
      userId: userA,
    });
    await service.unlockKeystore({
      ingress: secret({ password: passwordOne }),
      reauthenticatedSessionId: sessionId,
      userId: userA,
    });
    await service.putSecurityPassword({
      ingress: secret({ expectedVersion: 0, newPassword: passwordOne, oldPassword: null }),
      userId: userA,
    });

    const keystore = await store.getKeystore(userA);
    const security = await store.getSecurityPassword(userA);
    expect(keystore).not.toBeNull();
    expect(security).not.toBeNull();
    expect(security!.current.salt.equals(keystore!.current.salt)).toBe(false);
    expect(security!.current.verifier.equals(keystore!.current.verifier)).toBe(false);
    expect(await service.keystoreStatus(userA, sessionId)).toMatchObject({ status: "unlocked" });
    expect(await service.securityPasswordStatus(userA)).toEqual({
      configured: true,
      status: "ready",
      version: 1,
    });
    expect(await service.securityPasswordStatus(userB)).toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });

    await service.putSecurityPassword({
      ingress: secret({
        expectedVersion: 1,
        newPassword: passwordTwo,
        oldPassword: passwordOne,
      }),
      userId: userA,
    });
    expect(await service.keystoreStatus(userA, sessionId)).toMatchObject({ status: "unlocked" });

    await expect(
      service.verifySecurityPassword({
        ingress: secret({ password: passwordOne }),
        userId: userA,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await store.getSecurityPassword(userA))!.failureCount).toBe(1);
    await expect(
      service.verifySecurityPassword({
        ingress: secret({ password: passwordTwo }),
        userId: userA,
      }),
    ).resolves.toEqual({ verified: true, version: 2 });
    expect((await store.getSecurityPassword(userA))!.failureCount).toBe(0);
    expect(store.securityPasswordAuditCount).toBe(4);
    expect(zeroized.every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);
  });
});
