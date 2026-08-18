import { readFile } from "node:fs/promises";

import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
} from "../apps/signer/src/index.js";
import { deriveArgon2idKek } from "../apps/signer/src/password-crypto.js";
import { describe, expect, it } from "vitest";

const tenantId = "tenant-fixture-01";
const userId = "45000000-0000-4000-8000-000000000001";
const sessionId = "45000000-0000-4000-8000-000000000010";
const privateKeyOne = "0000000000000000000000000000000000000000000000000000000000000001";

function ingress(value: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function fixture(options: { failLifecycleAt?: "before-commit" } = {}) {
  let id = 10;
  let random = 1;
  const store = new InMemoryCustodyWalletStore(
    options.failLifecycleAt ? { failLifecycleAt: options.failLifecycleAt } : {},
  );
  const kms = new LocalKmsFixture({
    activeVersion: "kek-fixture-v1",
    keys: { "kek-fixture-v1": Buffer.alloc(32, 0x73) },
  });
  const signer = new IsolatedWalletSigner({
    kms,
    randomBytes: () => Buffer.from("0".repeat(63) + "2", "hex"),
    secretRandomBytes: (length) => Buffer.alloc(length, random++),
  });
  const service = new CustodySignerService({
    backoffJitter: () => 0,
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
    signer,
    store,
    uuid: () => `45000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
  });
  return { service, store };
}

async function configure(service: CustodySignerService, password = "synthetic-password-one") {
  await service.createKeystorePassword({ ingress: ingress({ newPassword: password }), userId });
}

async function importPasswordWallet(
  service: CustodySignerService,
  password = "synthetic-password-one",
) {
  return service.importWallet({
    ingress: ingress({
      mode: "user-password",
      name: "Password wallet",
      password,
      privateKey: privateKeyOne,
    }),
    tenantId,
    userId,
  });
}

describe("P04-03 password-mode wallets", () => {
  it("replays the P04-01 password restart and atomic recovery lifecycle", async () => {
    const fixture = JSON.parse(
      await readFile("artifacts/acceptance/P04-01/fixtures/lifecycle-recovery.json", "utf8"),
    ) as { input: { scenarios: Array<{ id: string; expected: Record<string, unknown> }> } };
    const scenarios = new Map(fixture.input.scenarios.map((scenario) => [scenario.id, scenario]));
    expect(scenarios.get("password-mode-restart")?.expected).toMatchObject({ state: "locked" });
    expect(scenarios.get("wrong-password")?.expected).toMatchObject({
      error: "INVALID_CREDENTIALS",
      memoryZeroized: true,
    });
    expect(scenarios.get("password-change-crash-before-commit")?.expected).toMatchObject({
      oldEnvelopeUsable: true,
    });
    expect(scenarios.get("mode-switch-crash-before-commit")?.expected).toMatchObject({
      partialModeVisible: false,
    });
  });

  it("imports and generates locked password wallets with an independent versioned DEK wrap", async () => {
    const { service, store } = fixture();
    await configure(service);
    const imported = await importPasswordWallet(service);
    const generated = await service.generateWallet({
      ingress: ingress({
        mode: "user-password",
        name: "Generated password wallet",
        password: "synthetic-password-one",
      }),
      mode: "user-password",
      name: "Generated password wallet",
      tenantId,
      userId,
    });
    expect(imported).toMatchObject({ lockStatus: "locked", mode: "user-password" });
    expect(generated).toMatchObject({ lockStatus: "locked", mode: "user-password" });
    const envelope = await store.getCurrentEnvelope(imported.walletId, 1);
    expect(envelope).toMatchObject({
      dekWrapVersion: 1,
      kekId: "user-password",
      secretVersion: 1,
    });
    expect(envelope?.dekWrapNonce).toHaveLength(12);
    expect(envelope?.dekWrapTag).toHaveLength(16);
    expect(envelope?.wrappedDek).toHaveLength(32);
    expect(envelope?.nonce).not.toEqual(envelope?.dekWrapNonce);
  });

  it("requires the bound unlock capability and returns one credential error for wrong/corrupt input", async () => {
    const { service, store } = fixture();
    await configure(service);
    const wallet = await importPasswordWallet(service);
    await expect(
      service.recoverWallet({ tenantId, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await service.unlockKeystore({
      ingress: ingress({ password: "synthetic-password-one" }),
      reauthenticatedSessionId: sessionId,
      userId,
    });
    await expect(
      service.recoverWallet({
        reauthenticatedSessionId: sessionId,
        tenantId,
        userId,
        walletId: wallet.walletId,
      }),
    ).resolves.toMatchObject({ address: wallet.address, lockStatus: "ready" });
    await store.mutateEnvelopeForTest(wallet.walletId, (envelope) => ({
      ...envelope,
      dekWrapTag: Buffer.alloc(16, 0xff),
    }));
    await expect(
      service.recoverWallet({
        reauthenticatedSessionId: sessionId,
        tenantId,
        userId,
        walletId: wallet.walletId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("atomically reseals every password wallet during password change", async () => {
    const { service, store } = fixture();
    await configure(service);
    const wallet = await importPasswordWallet(service);
    await service.changeKeystorePassword({
      ingress: ingress({
        expectedVersion: 1,
        newPassword: "synthetic-password-two",
        oldPassword: "synthetic-password-one",
      }),
      userId,
    });
    expect(await store.get(userId, wallet.walletId)).toMatchObject({ envelopeVersion: 2 });
    expect(await store.getCurrentEnvelope(wallet.walletId, 2)).toMatchObject({ secretVersion: 2 });
    await expect(
      service.unlockKeystore({
        ingress: ingress({ password: "synthetic-password-one" }),
        reauthenticatedSessionId: sessionId,
        userId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      service.unlockKeystore({
        ingress: ingress({ password: "synthetic-password-two" }),
        reauthenticatedSessionId: "45000000-0000-4000-8000-000000000011",
        userId,
      }),
    ).resolves.toMatchObject({ version: 2 });
  });

  it("switches server-kek and user-password in both directions with both optimistic versions", async () => {
    const { service } = fixture();
    await configure(service);
    const wallet = await service.importWallet({
      ingress: ingress({ mode: "server-kek", name: "Server wallet", privateKey: privateKeyOne }),
      tenantId,
      userId,
    });
    const passwordMode = await service.changeWalletEncryptionMode({
      ingress: ingress({
        expectedRevision: 1,
        expectedSecretVersion: 1,
        mode: "user-password",
        password: "synthetic-password-one",
      }),
      tenantId,
      userId,
      walletId: wallet.walletId,
    });
    expect(passwordMode).toMatchObject({
      envelopeVersion: 2,
      lockStatus: "locked",
      mode: "user-password",
      revision: 2,
    });
    await expect(
      service.changeWalletEncryptionMode({
        ingress: ingress({
          expectedRevision: 1,
          expectedSecretVersion: 1,
          mode: "server-kek",
          password: "synthetic-password-one",
        }),
        tenantId,
        userId,
        walletId: wallet.walletId,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const serverMode = await service.changeWalletEncryptionMode({
      ingress: ingress({
        expectedRevision: 2,
        expectedSecretVersion: 1,
        mode: "server-kek",
        password: "synthetic-password-one",
      }),
      tenantId,
      userId,
      walletId: wallet.walletId,
    });
    expect(serverMode).toMatchObject({
      envelopeVersion: 3,
      lockStatus: "ready",
      mode: "server-kek",
      revision: 3,
    });
  });

  it("retains the old password and envelope after an injected lifecycle fault", async () => {
    const { service, store } = fixture({ failLifecycleAt: "before-commit" });
    await configure(service);
    const wallet = await importPasswordWallet(service);
    await expect(
      service.changeKeystorePassword({
        ingress: ingress({
          expectedVersion: 1,
          newPassword: "synthetic-password-two",
          oldPassword: "synthetic-password-one",
        }),
        userId,
      }),
    ).rejects.toMatchObject({ code: "CUSTODY_STORE_UNAVAILABLE" });
    expect(await store.get(userId, wallet.walletId)).toMatchObject({ envelopeVersion: 1 });
    await expect(
      service.unlockKeystore({
        ingress: ingress({ password: "synthetic-password-one" }),
        reauthenticatedSessionId: sessionId,
        userId,
      }),
    ).resolves.toMatchObject({ version: 1 });
  });
});
