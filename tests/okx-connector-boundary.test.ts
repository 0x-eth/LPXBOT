import { readFileSync } from "node:fs";

import {
  loadOkxConnectorProductionConfig,
  okxConnectorCapabilities,
  OkxConnectorConfigurationError,
} from "../apps/okx-connector/src/index.js";
import { describe, expect, it } from "vitest";

const validEnvironment = {
  NODE_ENV: "production",
  OKX_CONNECTOR_API_TOKEN: "synthetic-api-token-at-least-32-bytes",
  OKX_CONNECTOR_CIPHERTEXT_DATABASE_URL:
    "postgresql://lpbot_okx_connector:fixture@127.0.0.1:5432/lpbot",
  OKX_CONNECTOR_HOST: "127.0.0.1",
  OKX_CONNECTOR_IDENTITY: "lpbot-okx-connector-production",
  OKX_CONNECTOR_KMS_IDENTITY_TOKEN: "synthetic-kms-identity-at-least-32-bytes",
  OKX_CONNECTOR_KMS_KEY_ID: "lpbot-okx-credential-kek",
  OKX_CONNECTOR_KMS_KEY_VERSION: "kek-v1",
  OKX_CONNECTOR_KMS_URL: "https://kms.fixture.invalid",
  OKX_CONNECTOR_PORT: "43211",
} as const;

describe("P04-07 connector ownership and production configuration", () => {
  it("defaults production egress to denied and requires dedicated KMS/store/identity inputs", () => {
    expect(loadOkxConnectorProductionConfig(validEnvironment)).toMatchObject({
      ciphertextDatabaseUrl: validEnvironment.OKX_CONNECTOR_CIPHERTEXT_DATABASE_URL,
      egressEnabled: false,
      environment: "production",
      host: "127.0.0.1",
      identity: validEnvironment.OKX_CONNECTOR_IDENTITY,
      kms: {
        keyId: validEnvironment.OKX_CONNECTOR_KMS_KEY_ID,
        keyVersion: validEnvironment.OKX_CONNECTOR_KMS_KEY_VERSION,
        url: validEnvironment.OKX_CONNECTOR_KMS_URL,
      },
      port: 43211,
    });
    expect(
      loadOkxConnectorProductionConfig({
        ...validEnvironment,
        OKX_CONNECTOR_EGRESS: "enabled",
      }),
    ).toMatchObject({ egressEnabled: true });
    for (const key of [
      "OKX_CONNECTOR_API_TOKEN",
      "OKX_CONNECTOR_CIPHERTEXT_DATABASE_URL",
      "OKX_CONNECTOR_IDENTITY",
      "OKX_CONNECTOR_KMS_IDENTITY_TOKEN",
      "OKX_CONNECTOR_KMS_KEY_ID",
      "OKX_CONNECTOR_KMS_KEY_VERSION",
      "OKX_CONNECTOR_KMS_URL",
    ] as const) {
      const environment: Record<string, string | undefined> = { ...validEnvironment };
      delete environment[key];
      expect(() => loadOkxConnectorProductionConfig(environment), key).toThrowError(
        OkxConnectorConfigurationError,
      );
    }
  });

  it("does not grant API, web, worker, dispatcher or signer a connector dependency", () => {
    for (const app of ["api", "web", "worker", "dispatcher", "signer"]) {
      const manifest = JSON.parse(readFileSync(`apps/${app}/package.json`, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(manifest.dependencies, app).not.toHaveProperty("@lpbot/okx-connector");
    }
    expect(okxConnectorCapabilities).toEqual([
      "credential-status",
      "credential-save",
      "credential-replace",
      "credential-test",
      "credential-delete",
      "fixed-read-only-okx-validation",
    ]);
    expect(okxConnectorCapabilities.join(" ")).not.toMatch(/proxy|trade|withdraw|arbitrary/iu);
  });

  it("rejects non-loopback, non-PostgreSQL and non-TLS production boundaries", () => {
    for (const override of [
      { OKX_CONNECTOR_HOST: "0.0.0.0" },
      { OKX_CONNECTOR_CIPHERTEXT_DATABASE_URL: "sqlite:///tmp/okx.db" },
      { OKX_CONNECTOR_KMS_URL: "http://kms.fixture.invalid" },
      { NODE_ENV: "development" },
    ]) {
      expect(() =>
        loadOkxConnectorProductionConfig({ ...validEnvironment, ...override }),
      ).toThrowError(OkxConnectorConfigurationError);
    }
  });
});
