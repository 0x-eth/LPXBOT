import {
  decryptOkxCredentials,
  encryptOkxCredentials,
  LocalOkxKmsFixture,
  OkxConnectorError,
  parseCredentialIngress,
} from "../apps/okx-connector/src/index.js";
import { describe, expect, it } from "vitest";

const identity = {
  credentialId: "70000000-0000-4000-8000-000000000010",
  environment: "production",
  userId: "70000000-0000-4000-8000-000000000001",
  version: 1,
};
const now = new Date("2026-08-19T01:00:00.000Z");

function ingress() {
  return Buffer.from(
    JSON.stringify({
      apiKey: "synthetic-api-key",
      passphrase: "synthetic-passphrase",
      secretKey: "synthetic-secret-key",
    }),
  );
}

describe("P04-07 OKX envelope cryptography", () => {
  it("uses an independent random DEK and authenticates all five fixed AAD fields", async () => {
    const kms = new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x41) });
    const firstCredentials = parseCredentialIngress(ingress());
    const secondCredentials = parseCredentialIngress(ingress());
    const first = await encryptOkxCredentials({ credentials: firstCredentials, identity, kms, now });
    const second = await encryptOkxCredentials({
      credentials: secondCredentials,
      identity: { ...identity, version: 2 },
      kms,
      now,
    });
    expect(first.algorithm).toBe("AES-256-GCM");
    expect(first.nonce).toHaveLength(12);
    expect(first.tag).toHaveLength(16);
    expect(first.wrappedDek).not.toEqual(second.wrappedDek);

    const opened = await decryptOkxCredentials(first, kms);
    expect(opened.apiKey.toString()).toBe("synthetic-api-key");
    expect(opened.secretKey.toString()).toBe("synthetic-secret-key");
    expect(opened.passphrase.toString()).toBe("synthetic-passphrase");

    for (const tampered of [
      { ...first, ciphertext: Buffer.from(first.ciphertext) },
      { ...first, userId: "70000000-0000-4000-8000-000000000002" },
      { ...first, credentialId: "70000000-0000-4000-8000-000000000099" },
      { ...first, version: 2 },
      { ...first, environment: "staging" },
    ]) {
      if (tampered.ciphertext !== first.ciphertext) tampered.ciphertext[0]! ^= 0xff;
      await expect(decryptOkxCredentials(tampered, kms)).rejects.toMatchObject({
        code: "CREDENTIAL_INTEGRITY_FAILED",
        message: "CREDENTIAL_INTEGRITY_FAILED",
      });
    }

    for (const bytes of [
      firstCredentials.apiKey,
      firstCredentials.secretKey,
      firstCredentials.passphrase,
      secondCredentials.apiKey,
      secondCredentials.secretKey,
      secondCredentials.passphrase,
      opened.apiKey,
      opened.secretKey,
      opened.passphrase,
    ]) {
      bytes.fill(0);
    }
  });

  it("fails closed when KMS availability or the connector decrypt grant is missing", async () => {
    const kms = new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x42) });
    const credentials = parseCredentialIngress(ingress());
    const envelope = await encryptOkxCredentials({ credentials, identity, kms, now });

    kms.setAvailable(false);
    await expect(decryptOkxCredentials(envelope, kms)).rejects.toBeInstanceOf(OkxConnectorError);
    kms.setAvailable(true);
    kms.setDecryptGrant(false);
    await expect(decryptOkxCredentials(envelope, kms)).rejects.toMatchObject({
      code: "KMS_UNAVAILABLE",
      retryable: true,
    });
    credentials.apiKey.fill(0);
    credentials.secretKey.fill(0);
    credentials.passphrase.fill(0);
  });

  it("accepts only the complete exact tuple and never derives displayable metadata", () => {
    for (const value of [
      {},
      { apiKey: "synthetic", passphrase: "synthetic" },
      { apiKey: "synthetic", extra: "x", passphrase: "synthetic", secretKey: "synthetic" },
      { apiKey: "", passphrase: "synthetic", secretKey: "synthetic" },
    ]) {
      expect(() => parseCredentialIngress(Buffer.from(JSON.stringify(value)))).toThrowError(
        "INVALID_CREDENTIAL_INGRESS",
      );
    }
  });
});
