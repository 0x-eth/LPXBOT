import { okxKeyStatuses, type OkxKeyStatus, type OkxKeyStatusName } from "@lpbot/api-contract";

export type OkxKeyErrorCode =
  | "CAPABILITY_EXPIRED"
  | "CONNECTOR_UNAVAILABLE"
  | "CREDENTIAL_ALREADY_CONFIGURED"
  | "CREDENTIAL_INTEGRITY_FAILED"
  | "CREDENTIAL_INVALID"
  | "CREDENTIAL_NOT_CONFIGURED"
  | "CREDENTIAL_REVOKED"
  | "EGRESS_DENIED"
  | "INSUFFICIENT_PERMISSION"
  | "INVALID_CREDENTIAL_INGRESS"
  | "KMS_UNAVAILABLE"
  | "PROVIDER_UNKNOWN"
  | "VERSION_CONFLICT";

export class OkxKeyError extends Error {
  readonly code: OkxKeyErrorCode;
  readonly retryable: boolean;

  constructor(code: OkxKeyErrorCode, retryable = false) {
    super(code);
    this.name = "OkxKeyError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface OkxKeyConnectorContext {
  actor: string;
  requestId: string;
  userId: string;
}

export interface OkxKeyApplication {
  delete(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus>;
  replace(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus>;
  save(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus>;
  status(input: OkxKeyConnectorContext): Promise<OkxKeyStatus>;
  test(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function publicOkxKeyStatus(value: unknown): OkxKeyStatus {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "configured,status,version") {
    throw new OkxKeyError("CONNECTOR_UNAVAILABLE", true);
  }
  if (
    typeof value.configured !== "boolean" ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    typeof value.status !== "string" ||
    !okxKeyStatuses.includes(value.status as OkxKeyStatusName) ||
    (value.configured && value.version < 1)
  ) {
    throw new OkxKeyError("CONNECTOR_UNAVAILABLE", true);
  }
  return {
    configured: value.configured,
    status: value.status as OkxKeyStatusName,
    version: value.version,
  };
}

function connectorErrorCode(value: unknown): OkxKeyErrorCode {
  const allowed = new Set<OkxKeyErrorCode>([
    "CAPABILITY_EXPIRED",
    "CONNECTOR_UNAVAILABLE",
    "CREDENTIAL_ALREADY_CONFIGURED",
    "CREDENTIAL_INTEGRITY_FAILED",
    "CREDENTIAL_INVALID",
    "CREDENTIAL_NOT_CONFIGURED",
    "CREDENTIAL_REVOKED",
    "EGRESS_DENIED",
    "INSUFFICIENT_PERMISSION",
    "INVALID_CREDENTIAL_INGRESS",
    "KMS_UNAVAILABLE",
    "PROVIDER_UNKNOWN",
    "VERSION_CONFLICT",
  ]);
  return typeof value === "string" && allowed.has(value as OkxKeyErrorCode)
    ? (value as OkxKeyErrorCode)
    : "CONNECTOR_UNAVAILABLE";
}

export class RemoteOkxKeyConnectorClient implements OkxKeyApplication {
  readonly #apiToken: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(input: { apiToken: string; baseUrl: string; fetch?: typeof fetch }) {
    const url = new URL(input.baseUrl);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]" && url.hostname !== "::1") ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new TypeError("OKX connector must use a loopback HTTP endpoint");
    }
    this.#apiToken = input.apiToken;
    this.#baseUrl = input.baseUrl.replace(/\/+$/u, "");
    this.#fetch = input.fetch ?? fetch;
  }

  status(input: OkxKeyConnectorContext): Promise<OkxKeyStatus> {
    return this.#request("GET", "/v1/okx-key", input);
  }

  save(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    return this.#request("POST", "/v1/okx-key", input);
  }

  replace(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    return this.#request("PUT", "/v1/okx-key", input);
  }

  delete(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    return this.#request("DELETE", "/v1/okx-key", input);
  }

  test(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    return this.#request("POST", "/v1/okx-key/test", input);
  }

  async #request(
    method: "DELETE" | "GET" | "POST" | "PUT",
    path: "/v1/okx-key" | "/v1/okx-key/test",
    input: OkxKeyConnectorContext & { ingress?: Buffer },
  ): Promise<OkxKeyStatus> {
    const body = input.ingress ? Buffer.from(input.ingress) : null;
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...(body ? { body } : {}),
        headers: {
          Authorization: `Bearer ${this.#apiToken}`,
          ...(body ? { "Content-Type": "application/vnd.lpbot.okx-key-secret+json" } : {}),
          "X-LPBOT-Actor": input.actor,
          "X-LPBOT-Request-Id": input.requestId,
          "X-LPBOT-User-Id": input.userId,
        },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const envelope: unknown = await response.json();
      if (!isRecord(envelope)) throw new OkxKeyError("CONNECTOR_UNAVAILABLE", true);
      if (response.ok && envelope.success === true) return publicOkxKeyStatus(envelope.data);
      const error = isRecord(envelope.error) ? envelope.error : {};
      throw new OkxKeyError(
        connectorErrorCode(error.code),
        typeof error.retryable === "boolean" ? error.retryable : response.status >= 500,
      );
    } catch (error) {
      if (error instanceof OkxKeyError) throw error;
      throw new OkxKeyError("CONNECTOR_UNAVAILABLE", true);
    } finally {
      body?.fill(0);
    }
  }
}
