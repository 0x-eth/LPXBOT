export interface OkxConnectorProductionConfig {
  apiToken: string;
  ciphertextDatabaseUrl: string;
  egressEnabled: boolean;
  environment: "production";
  host: "127.0.0.1" | "::1";
  identity: string;
  kms: {
    identityToken: string;
    keyId: string;
    keyVersion: string;
    url: string;
  };
  port: number;
}

export class OkxConnectorConfigurationError extends Error {
  readonly code = "OKX_CONNECTOR_CONFIGURATION_INVALID" as const;
}

function required(environment: NodeJS.ProcessEnv, key: string, minimum = 1): string {
  const value = environment[key];
  if (!value || value.length < minimum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new OkxConnectorConfigurationError(`${key} is required`);
  }
  return value;
}

export function loadOkxConnectorProductionConfig(
  environment: NodeJS.ProcessEnv,
): OkxConnectorProductionConfig {
  if (environment.NODE_ENV !== "production") {
    throw new OkxConnectorConfigurationError("NODE_ENV must be production");
  }
  const host = required(environment, "OKX_CONNECTOR_HOST");
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new OkxConnectorConfigurationError("OKX connector must bind to loopback");
  }
  const port = Number(required(environment, "OKX_CONNECTOR_PORT"));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new OkxConnectorConfigurationError("OKX connector port is invalid");
  }
  const ciphertextDatabaseUrl = required(
    environment,
    "OKX_CONNECTOR_CIPHERTEXT_DATABASE_URL",
  );
  if (!ciphertextDatabaseUrl.startsWith("postgresql://")) {
    throw new OkxConnectorConfigurationError("OKX connector requires PostgreSQL");
  }
  const kmsUrl = required(environment, "OKX_CONNECTOR_KMS_URL");
  if (!kmsUrl.startsWith("https://")) {
    throw new OkxConnectorConfigurationError("OKX connector KMS requires TLS");
  }
  return {
    apiToken: required(environment, "OKX_CONNECTOR_API_TOKEN", 32),
    ciphertextDatabaseUrl,
    egressEnabled: environment.OKX_CONNECTOR_EGRESS === "enabled",
    environment: "production",
    host,
    identity: required(environment, "OKX_CONNECTOR_IDENTITY"),
    kms: {
      identityToken: required(environment, "OKX_CONNECTOR_KMS_IDENTITY_TOKEN", 32),
      keyId: required(environment, "OKX_CONNECTOR_KMS_KEY_ID"),
      keyVersion: required(environment, "OKX_CONNECTOR_KMS_KEY_VERSION"),
      url: kmsUrl.replace(/\/+$/u, ""),
    },
    port,
  };
}
