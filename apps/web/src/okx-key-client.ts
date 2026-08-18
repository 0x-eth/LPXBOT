import {
  okxKeySecretMediaType,
  okxKeyStatuses,
  type OkxKeyStatus,
  type OkxKeyStatusName,
} from "@lpbot/api-contract";

export interface OkxCredentialDraft {
  apiKey: string;
  passphrase: string;
  secretKey: string;
}

type OkxKeyFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OkxKeyRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "OkxKeyRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function parseOkxKeyStatus(value: unknown, responseStatus = 0): OkxKeyStatus {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "configured,status,version" ||
    typeof value.configured !== "boolean" ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    typeof value.status !== "string" ||
    !okxKeyStatuses.includes(value.status as OkxKeyStatusName) ||
    (value.configured && (value.version < 1 || value.status === "unconfigured")) ||
    (!value.configured && value.status !== "unconfigured" && value.status !== "staged")
  ) {
    throw new OkxKeyRequestError("OKX_KEY_RESPONSE_INVALID", true, responseStatus);
  }
  return value as unknown as OkxKeyStatus;
}

export class OkxKeyClient {
  readonly #fetcher: OkxKeyFetch;
  readonly #reauthenticationProof: () => string | null;

  constructor(
    fetcher: OkxKeyFetch = globalThis.fetch.bind(globalThis),
    reauthenticationProof: () => string | null = () => null,
  ) {
    this.#fetcher = fetcher;
    this.#reauthenticationProof = reauthenticationProof;
  }

  async status(signal?: AbortSignal): Promise<OkxKeyStatus> {
    const response = await this.#request("/api/settings/okx-key", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseOkxKeyStatus(response.data, response.status);
  }

  save(credentials: OkxCredentialDraft): Promise<OkxKeyStatus> {
    return this.#mutation("POST", "/api/settings/okx-key", credentials);
  }

  replace(credentials: OkxCredentialDraft, expectedVersion: number): Promise<OkxKeyStatus> {
    return this.#mutation("PUT", "/api/settings/okx-key", {
      ...credentials,
      expectedVersion,
    });
  }

  test(expectedVersion: number): Promise<OkxKeyStatus> {
    return this.#mutation("POST", "/api/settings/okx-key/test", { expectedVersion });
  }

  delete(expectedVersion: number): Promise<OkxKeyStatus> {
    return this.#mutation("DELETE", "/api/settings/okx-key", { expectedVersion });
  }

  async #mutation(
    method: "DELETE" | "POST" | "PUT",
    path: string,
    body: object,
  ): Promise<OkxKeyStatus> {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    try {
      const response = await this.#request(path, {
        body: bytes as unknown as BodyInit,
        headers: {
          "Content-Type": okxKeySecretMediaType,
          ...this.#reauthenticationHeader(),
        },
        method,
      });
      return parseOkxKeyStatus(response.data, response.status);
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
      throw new OkxKeyRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OkxKeyRequestError("OKX_KEY_RESPONSE_INVALID", true, response.status);
    }
    if (!response.ok) {
      const envelope = isRecord(body) && isRecord(body.error) ? body.error : null;
      throw new OkxKeyRequestError(
        typeof envelope?.code === "string" ? envelope.code : "OKX_KEY_REQUEST_FAILED",
        envelope?.retryable === true,
        response.status,
      );
    }
    if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new OkxKeyRequestError("OKX_KEY_RESPONSE_INVALID", true, response.status);
    }
    return { data: body.data, status: response.status };
  }
}
