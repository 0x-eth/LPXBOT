export interface SignerProductionConfig {
  apiToken: string;
  ciphertextDatabaseUrl: string;
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

export class SignerConfigurationError extends Error {
  readonly code = "SIGNER_CONFIGURATION_INVALID";

  constructor() {
    super("SIGNER_CONFIGURATION_INVALID");
    this.name = "SignerConfigurationError";
  }
}

function required(environment: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): string {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) throw new SignerConfigurationError();
  return value;
}

function identity(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(value)) {
    throw new SignerConfigurationError();
  }
  return value;
}

function credential(value: string): string {
  if (value.length < 32 || value.length > 4096 || /[\r\n]/u.test(value)) {
    throw new SignerConfigurationError();
  }
  return value;
}

function databaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SignerConfigurationError();
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0 ||
    parsed.pathname.length < 2 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new SignerConfigurationError();
  }
  return value;
}

function kmsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SignerConfigurationError();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new SignerConfigurationError();
  }
  return parsed.origin;
}

export function loadSignerProductionConfig(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): SignerProductionConfig {
  if (environment.NODE_ENV !== "production") throw new SignerConfigurationError();
  const host = required(environment, "SIGNER_HOST");
  if (host !== "127.0.0.1" && host !== "::1") throw new SignerConfigurationError();
  const rawPort = required(environment, "SIGNER_PORT");
  if (!/^[1-9][0-9]{0,4}$/u.test(rawPort)) throw new SignerConfigurationError();
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port > 65_535) throw new SignerConfigurationError();

  return {
    apiToken: credential(required(environment, "SIGNER_API_TOKEN")),
    ciphertextDatabaseUrl: databaseUrl(
      required(environment, "SIGNER_CIPHERTEXT_DATABASE_URL"),
    ),
    host,
    identity: identity(required(environment, "SIGNER_IDENTITY")),
    kms: {
      identityToken: credential(required(environment, "SIGNER_KMS_IDENTITY_TOKEN")),
      keyId: identity(required(environment, "SIGNER_KMS_KEY_ID")),
      keyVersion: identity(required(environment, "SIGNER_KMS_KEY_VERSION")),
      url: kmsUrl(required(environment, "SIGNER_KMS_URL")),
    },
    port,
  };
}
