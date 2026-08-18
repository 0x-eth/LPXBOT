import { readFile } from "node:fs/promises";

import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
  SECP256K1_ORDER,
  SignerError,
  buildWalletAad,
  deriveEvmAddress,
  generatePrivateKey,
  openEnvelope,
  parsePrivateKey,
  sealEnvelope,
} from "../apps/signer/src/index.js";
import { describe, expect, it, vi } from "vitest";

const fixtureRoot = new URL("../artifacts/acceptance/P04-01/fixtures/", import.meta.url);
const privateKeyOne = "0000000000000000000000000000000000000000000000000000000000000001";
const privateKeyTwo = "0000000000000000000000000000000000000000000000000000000000000002";
const tenantId = "tenant-fixture-01";
const userA = "user-fixture-01";
const userB = "user-fixture-02";

async function jsonFixture(name: string): Promise<any> {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), "utf8"));
}

function ingress(name: string, privateKey = privateKeyOne): Uint8Array {
  return Buffer.from(JSON.stringify({ mode: "server-kek", name, privateKey }), "utf8");
}

function service(
  options: {
    candidates?: string[];
    kms?: LocalKmsFixture;
    store?: InMemoryCustodyWalletStore;
  } = {},
) {
  const candidates = [...(options.candidates ?? [])];
  const randomBytes = (length: number): Buffer => {
    if (length !== 32 || candidates.length === 0) throw new Error("fixture random exhausted");
    return Buffer.from(candidates.shift()!, "hex");
  };
  const kms =
    options.kms ??
    new LocalKmsFixture({
      activeVersion: "kek-fixture-v1",
      keys: { "kek-fixture-v1": Buffer.alloc(32, 0x42) },
    });
  const store = options.store ?? new InMemoryCustodyWalletStore();
  const signer = new IsolatedWalletSigner({
    kms,
    randomBytes: options.candidates ? randomBytes : undefined,
  });
  return { application: new CustodySignerService({ signer, store }), kms, signer, store };
}

describe("P04-02 isolated signer cryptography", () => {
  it("accepts only exact private-key hex and enforces secp256k1 scalar boundaries", () => {
    expect(parsePrivateKey(privateKeyOne)).toEqual(Buffer.from(privateKeyOne, "hex"));
    expect(parsePrivateKey(`0x${privateKeyOne.toUpperCase()}`)).toEqual(
      Buffer.from(privateKeyOne, "hex"),
    );

    const order = SECP256K1_ORDER.toString(16).padStart(64, "0");
    const last = (SECP256K1_ORDER - 1n).toString(16).padStart(64, "0");
    expect(parsePrivateKey(last)).toHaveLength(32);
    for (const invalid of [
      "0".repeat(64),
      order,
      ` ${privateKeyOne}`,
      `${privateKeyOne}\n`,
      privateKeyOne.slice(2),
      `0X${privateKeyOne}`,
      "g".repeat(64),
      "test test test test test test test test test test test junk",
    ]) {
      expect(() => parsePrivateKey(invalid), invalid).toThrowError(
        expect.objectContaining({ code: "INVALID_PRIVATE_KEY" }),
      );
    }
  });

  it("derives the frozen EVM address and EIP-55 known answer", async () => {
    const fixture = await jsonFixture("crypto-known-answer.json");
    const key = parsePrivateKey(fixture.input.syntheticPrivateKeyHex);
    try {
      expect(deriveEvmAddress(key)).toEqual({
        checksumAddress: fixture.expected.checksumAddress,
        lowercaseAddress: fixture.expected.lowercaseAddress,
      });
    } finally {
      key.fill(0);
    }
  });

  it("uses rejection sampling instead of modulo reduction", () => {
    const candidates = [
      Buffer.alloc(32),
      Buffer.from(SECP256K1_ORDER.toString(16).padStart(64, "0"), "hex"),
      Buffer.from(privateKeyTwo, "hex"),
    ];
    const random = vi.fn(() => candidates.shift()!);
    const selected = generatePrivateKey(random);
    expect(random).toHaveBeenCalledTimes(3);
    expect(selected.toString("hex")).toBe(privateKeyTwo);
    expect(candidates).toHaveLength(0);
    selected.fill(0);
  });

  it("replays the P04-01 AES-GCM and LF-separated AAD fixture", async () => {
    const fixture = await jsonFixture("crypto-known-answer.json");
    const aad = Buffer.from(fixture.input.aes256Gcm.aadUtf8, "utf8");
    expect(
      buildWalletAad({
        address: fixture.expected.lowercaseAddress,
        envelopeVersion: 1,
        kekVersion: "kek-fixture-v1",
        tenantId,
        userId: userA,
        walletId: "wallet-fixture-01",
      }).toString("utf8"),
    ).toBe(fixture.input.aes256Gcm.aadUtf8);

    const envelope = sealEnvelope({
      aad,
      dek: Buffer.from(fixture.input.aes256Gcm.keyHex, "hex"),
      nonce: Buffer.from(fixture.input.aes256Gcm.nonceHex, "hex"),
      plaintext: Buffer.from(fixture.input.aes256Gcm.plaintextHex, "hex"),
    });
    expect(envelope.ciphertext.toString("hex")).toBe(fixture.expected.aes256Gcm.ciphertextHex);
    expect(envelope.tag.toString("hex")).toBe(fixture.expected.aes256Gcm.tagHex);
    const opened = openEnvelope({
      ...envelope,
      aad,
      dek: Buffer.from(fixture.input.aes256Gcm.keyHex, "hex"),
    });
    expect(opened.toString("hex")).toBe(fixture.input.aes256Gcm.plaintextHex);
    opened.fill(0);
  });

  it("rejects AAD, ciphertext, tag, and nonce tampering without fallback", async () => {
    const fixture = await jsonFixture("aad-tamper.json");
    const original = fixture.input.original;
    const sealed = {
      ciphertext: Buffer.from(fixture.expected.original.ciphertextHex, "hex"),
      nonce: Buffer.from(original.nonceHex, "hex"),
      tag: Buffer.from(fixture.expected.original.tagHex, "hex"),
    };
    const key = Buffer.from(original.keyHex, "hex");
    const mutations = [
      { ...sealed, aad: Buffer.from(fixture.input.tamperedAadUtf8, "utf8"), dek: key },
      {
        ...sealed,
        aad: Buffer.from(original.aadUtf8, "utf8"),
        ciphertext: Buffer.from(fixture.expected.tamperedCiphertextHex, "hex"),
        dek: key,
      },
      {
        ...sealed,
        aad: Buffer.from(original.aadUtf8, "utf8"),
        dek: key,
        tag: Buffer.from(sealed.tag).fill(0, 0, 1),
      },
      {
        ...sealed,
        aad: Buffer.from(original.aadUtf8, "utf8"),
        dek: key,
        nonce: Buffer.from(sealed.nonce).fill(0, 0, 1),
      },
    ];
    for (const mutation of mutations) {
      expect(() => openEnvelope(mutation)).toThrowError(
        expect.objectContaining({ code: "KEYSTORE_CORRUPTED" }),
      );
    }
  });

  it("zeroizes ingress, private-key, and DEK buffers on success and every failure path", async () => {
    const seen: Array<{ label: string; bytes: Uint8Array }> = [];
    const kms = new LocalKmsFixture({
      activeVersion: "kek-fixture-v1",
      keys: { "kek-fixture-v1": Buffer.alloc(32, 0x33) },
    });
    const signer = new IsolatedWalletSigner({
      kms,
      onZeroize: (label, bytes) => seen.push({ bytes: Uint8Array.from(bytes), label }),
    });
    const input = ingress("Fixture wallet");
    await signer.importAndSeal({
      envelopeVersion: 1,
      ingress: input,
      tenantId,
      userId: userA,
      walletId: "wallet-fixture-01",
    });
    expect(input.every((byte) => byte === 0)).toBe(true);
    expect(new Set(seen.map(({ label }) => label))).toEqual(
      new Set(["dek", "ingress", "private-key"]),
    );
    expect(seen.every(({ bytes }) => bytes.every((byte) => byte === 0))).toBe(true);

    const invalid = ingress("Invalid", "0".repeat(64));
    await expect(
      signer.importAndSeal({
        envelopeVersion: 1,
        ingress: invalid,
        tenantId,
        userId: userA,
        walletId: "wallet-fixture-02",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PRIVATE_KEY" });
    expect(invalid.every((byte) => byte === 0)).toBe(true);
  });

  it("recovers after signer restart and fails closed for unavailable/wrong KEK versions", async () => {
    const { application, kms, store } = service();
    const wallet = await application.importWallet({
      ingress: ingress("Restart fixture"),
      tenantId,
      userId: userA,
    });
    const restarted = new CustodySignerService({
      signer: new IsolatedWalletSigner({ kms }),
      store,
    });
    await expect(
      restarted.recoverWallet({ tenantId, userId: userA, walletId: wallet.walletId }),
    ).resolves.toMatchObject({
      address: wallet.address,
      lockStatus: "ready",
    });

    kms.setAvailable(false);
    await expect(
      restarted.recoverWallet({ tenantId, userId: userA, walletId: wallet.walletId }),
    ).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
    });
    expect((await store.get(userA, wallet.walletId))?.lockStatus).toBe("locked");

    kms.setAvailable(true);
    await store.mutateEnvelopeForTest(wallet.walletId, (envelope) => ({
      ...envelope,
      kekVersion: "kek-fixture-missing",
    }));
    await expect(
      restarted.recoverWallet({ tenantId, userId: userA, walletId: wallet.walletId }),
    ).rejects.toMatchObject({
      code: "KEK_VERSION_UNAVAILABLE",
    });
    expect((await store.get(userA, wallet.walletId))?.lockStatus).toBe("locked");
  });

  it("quarantines authentication failures and never opens an older envelope", async () => {
    const { application, store } = service();
    const wallet = await application.importWallet({
      ingress: ingress("Tamper fixture"),
      tenantId,
      userId: userA,
    });
    await store.mutateEnvelopeForTest(wallet.walletId, (envelope) => {
      const tag = Buffer.from(envelope.tag);
      tag[0] ^= 1;
      return { ...envelope, tag };
    });
    await expect(
      application.recoverWallet({ tenantId, userId: userA, walletId: wallet.walletId }),
    ).rejects.toMatchObject({
      code: "KEYSTORE_CORRUPTED",
    });
    expect((await store.get(userA, wallet.walletId))?.lockStatus).toBe("quarantined");
    expect(store.openAttempts).toEqual([1]);
  });
});

describe("P04-02 custody creation invariants", () => {
  it("rejects same-user duplicate imports but permits the same address across users", async () => {
    const { application, store } = service();
    await application.importWallet({ ingress: ingress("A"), tenantId, userId: userA });
    await expect(
      application.importWallet({ ingress: ingress("A duplicate"), tenantId, userId: userA }),
    ).rejects.toMatchObject({ code: "WALLET_ADDRESS_EXISTS" });
    await expect(
      application.importWallet({ ingress: ingress("B"), tenantId, userId: userB }),
    ).resolves.toMatchObject({ address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf" });
    expect((await store.list(userA)).items).toHaveLength(1);
    expect((await store.list(userB)).items).toHaveLength(1);
  });

  it("resamples generated same-user collisions and commits one envelope per wallet", async () => {
    const { application, store } = service({
      candidates: [privateKeyOne, privateKeyOne, privateKeyTwo],
    });
    const [first, second] = await Promise.all([
      application.generateWallet({ mode: "server-kek", name: "One", tenantId, userId: userA }),
      application.generateWallet({ mode: "server-kek", name: "Two", tenantId, userId: userA }),
    ]);
    expect(new Set([first.address.toLowerCase(), second.address.toLowerCase()]).size).toBe(2);
    expect(store.envelopeCount).toBe(2);
    expect(store.auditCount).toBe(2);
  });

  it("rolls back metadata, envelope, pointer, and audit together", async () => {
    const store = new InMemoryCustodyWalletStore({ failBeforeCommit: true });
    const { application } = service({ store });
    await expect(
      application.importWallet({ ingress: ingress("Rollback"), tenantId, userId: userA }),
    ).rejects.toBeInstanceOf(SignerError);
    expect((await store.list(userA)).items).toEqual([]);
    expect(store.envelopeCount).toBe(0);
    expect(store.auditCount).toBe(0);
  });
});
