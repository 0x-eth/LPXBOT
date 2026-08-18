import {
  SignerConfigurationError,
  loadSignerProductionConfig,
} from "../apps/signer/src/production-config.js";
import { signerCapabilities } from "../apps/signer/src/index.js";
import { describe, expect, it } from "vitest";

const validEnvironment = {
  NODE_ENV: "production",
  SIGNER_API_TOKEN: "fixture-api-identity-token-with-32-bytes",
  SIGNER_CIPHERTEXT_DATABASE_URL: "postgresql://signer:fixture@127.0.0.1:5432/lpbot",
  SIGNER_HOST: "127.0.0.1",
  SIGNER_IDENTITY: "lpbot-signer-production",
  SIGNER_KMS_IDENTITY_TOKEN: "fixture-kms-identity-token-with-32-bytes",
  SIGNER_KMS_KEY_ID: "lpbot-wallet-kek",
  SIGNER_KMS_KEY_VERSION: "kek-v1",
  SIGNER_KMS_URL: "https://kms.fixture.invalid",
  SIGNER_PORT: "43210",
} as const;

describe("P04-02 signer production boundary", () => {
  it("exports no signing, raw transaction, broadcast, or RPC capability", () => {
    expect(signerCapabilities).toEqual(["import", "generate", "seal", "open-verify"]);
    expect(signerCapabilities.join(" ")).not.toMatch(
      /digest|message|transaction|broadcast|rpc|sign/u,
    );
  });

  it("fails closed when KMS, ciphertext store, or signer identity configuration is missing", () => {
    for (const key of [
      "SIGNER_CIPHERTEXT_DATABASE_URL",
      "SIGNER_IDENTITY",
      "SIGNER_KMS_IDENTITY_TOKEN",
      "SIGNER_KMS_KEY_ID",
      "SIGNER_KMS_KEY_VERSION",
      "SIGNER_KMS_URL",
    ] as const) {
      const environment: Record<string, string | undefined> = { ...validEnvironment };
      delete environment[key];
      expect(() => loadSignerProductionConfig(environment), key).toThrowError(
        expect.objectContaining<Partial<SignerConfigurationError>>({
          code: "SIGNER_CONFIGURATION_INVALID",
        }),
      );
    }
  });

  it("requires TLS KMS, PostgreSQL ciphertext storage, loopback binding, and explicit identity", () => {
    expect(loadSignerProductionConfig(validEnvironment)).toMatchObject({
      ciphertextDatabaseUrl: validEnvironment.SIGNER_CIPHERTEXT_DATABASE_URL,
      host: "127.0.0.1",
      identity: validEnvironment.SIGNER_IDENTITY,
      kms: {
        keyId: validEnvironment.SIGNER_KMS_KEY_ID,
        keyVersion: validEnvironment.SIGNER_KMS_KEY_VERSION,
        url: validEnvironment.SIGNER_KMS_URL,
      },
      port: 43210,
    });
    for (const override of [
      { SIGNER_KMS_URL: "http://kms.fixture.invalid" },
      { SIGNER_CIPHERTEXT_DATABASE_URL: "sqlite:///tmp/wallets.db" },
      { SIGNER_HOST: "0.0.0.0" },
      { SIGNER_IDENTITY: "" },
    ]) {
      expect(() => loadSignerProductionConfig({ ...validEnvironment, ...override })).toThrowError(
        SignerConfigurationError,
      );
    }
  });
});
