import type { SecurityPasswordStatus, UpdateSecurityPasswordRequest } from "@lpbot/api-contract";
import { securityPasswordSecretMediaType } from "@lpbot/api-contract";

type SecurityPasswordFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

export class SecurityPasswordRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "SecurityPasswordRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function parseSecurityPasswordStatus(
  value: unknown,
  responseStatus = 0,
): SecurityPasswordStatus {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["configured", "status", "version"]) ||
    typeof value.configured !== "boolean" ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    (value.status !== "locked-out" &&
      value.status !== "ready" &&
      value.status !== "unconfigured") ||
    (value.configured === false && (value.status !== "unconfigured" || value.version !== 0)) ||
    (value.configured === true &&
      (value.status === "unconfigured" || (value.version as number) < 1))
  ) {
    throw new SecurityPasswordRequestError(
      "SECURITY_PASSWORD_RESPONSE_INVALID",
      true,
      responseStatus,
    );
  }
  return { ...value } as unknown as SecurityPasswordStatus;
}

export class SecurityPasswordClient {
  readonly #fetcher: SecurityPasswordFetch;
  readonly #reauthenticationProof: () => string | null;

  constructor(
    fetcher: SecurityPasswordFetch = globalThis.fetch.bind(globalThis),
    reauthenticationProof: () => string | null = () => null,
  ) {
    this.#fetcher = fetcher;
    this.#reauthenticationProof = reauthenticationProof;
  }

  async status(signal?: AbortSignal): Promise<SecurityPasswordStatus> {
    const response = await this.#request("/api/security-password/status", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseSecurityPasswordStatus(response.data, response.status);
  }

  async update(input: UpdateSecurityPasswordRequest): Promise<SecurityPasswordStatus> {
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    try {
      const response = await this.#request("/api/security-password", {
        body: bytes as unknown as BodyInit,
        headers: {
          "Content-Type": securityPasswordSecretMediaType,
          ...this.#reauthenticationHeader(),
        },
        method: "PUT",
      });
      return parseSecurityPasswordStatus(response.data, response.status);
    } finally {
      bytes.fill(0);
    }
  }

  #reauthenticationHeader(): Record<string, string> {
    const proof = this.#reauthenticationProof();
    return proof ? { "X-LPBOT-Reauthentication": proof } : {};
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try {
      response = await this.#fetcher(path, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-store",
          ...init.headers,
        },
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new SecurityPasswordRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SecurityPasswordRequestError(
        "SECURITY_PASSWORD_RESPONSE_INVALID",
        true,
        response.status,
      );
    }
    if (!response.ok) {
      const envelope = isRecord(body) ? (body as ErrorEnvelope) : null;
      const code =
        typeof envelope?.error?.code === "string"
          ? envelope.error.code
          : "SECURITY_PASSWORD_REQUEST_FAILED";
      throw new SecurityPasswordRequestError(
        code,
        envelope?.error?.retryable === true,
        response.status,
      );
    }
    if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new SecurityPasswordRequestError(
        "SECURITY_PASSWORD_RESPONSE_INVALID",
        true,
        response.status,
      );
    }
    return { data: body.data, status: response.status };
  }
}
