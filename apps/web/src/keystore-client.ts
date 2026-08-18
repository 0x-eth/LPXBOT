import type {
  ChangeKeystorePasswordRequest,
  CreateKeystorePasswordRequest,
  KeystoreResetPreview,
  KeystoreResetRequest,
  KeystoreStatus,
  UnlockKeystoreRequest,
  UpdateKeystoreAutoLockRequest,
} from "@lpbot/api-contract";
import { keystoreResetConfirmationPhrase, keystoreSecretMediaType } from "@lpbot/api-contract";

type KeystoreFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const statusKeys = ["configured", "status", "version"] as const;
const previewKeys = [
  "confirmationPhrase",
  "expiresAt",
  "policyCount",
  "previewToken",
  "secretVersion",
  "strategyCount",
  "taskCount",
  "walletCount",
  "walletsWithNonzeroAssets",
  "walletsWithPositions",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export class KeystoreRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "KeystoreRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function parseKeystoreStatus(value: unknown, status = 0): KeystoreStatus {
  if (
    !isRecord(value) ||
    !exactKeys(value, statusKeys) ||
    typeof value.configured !== "boolean" ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 0 ||
    (value.status !== "locked" &&
      value.status !== "locked-out" &&
      value.status !== "unconfigured" &&
      value.status !== "unlocked") ||
    (value.configured === false && (value.status !== "unconfigured" || value.version !== 0)) ||
    (value.configured === true &&
      (value.status === "unconfigured" || (value.version as number) < 1))
  ) {
    throw new KeystoreRequestError("KEYSTORE_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as KeystoreStatus;
}

export function parseKeystoreResetPreview(value: unknown, status = 0): KeystoreResetPreview {
  if (
    !isRecord(value) ||
    !exactKeys(value, previewKeys) ||
    value.confirmationPhrase !== keystoreResetConfirmationPhrase ||
    typeof value.previewToken !== "string" ||
    value.previewToken.length < 32 ||
    !timestamp(value.expiresAt) ||
    !Number.isSafeInteger(value.secretVersion) ||
    (value.secretVersion as number) < 1 ||
    ![
      value.policyCount,
      value.strategyCount,
      value.taskCount,
      value.walletCount,
      value.walletsWithNonzeroAssets,
      value.walletsWithPositions,
    ].every((count) => Number.isSafeInteger(count) && (count as number) >= 0)
  ) {
    throw new KeystoreRequestError("KEYSTORE_RESPONSE_INVALID", true, status);
  }
  return { ...value } as unknown as KeystoreResetPreview;
}

export class KeystoreClient {
  readonly #fetcher: KeystoreFetch;

  constructor(fetcher: KeystoreFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async status(signal?: AbortSignal): Promise<KeystoreStatus> {
    const response = await this.#request("/api/keystore/status", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseKeystoreStatus(response.data, response.status);
  }

  async createPassword(input: CreateKeystorePasswordRequest): Promise<KeystoreStatus> {
    return this.#secretStatus("/api/keystore/password", "POST", input);
  }

  async changePassword(input: ChangeKeystorePasswordRequest): Promise<KeystoreStatus> {
    return this.#secretStatus("/api/keystore/password", "PUT", input);
  }

  async unlock(input: UnlockKeystoreRequest): Promise<KeystoreStatus> {
    return this.#secretStatus("/api/keystore/unlock", "POST", input);
  }

  async lock(): Promise<KeystoreStatus> {
    const response = await this.#request("/api/keystore/lock", { method: "POST" });
    return parseKeystoreStatus(response.data, response.status);
  }

  async updateAutoLock(input: UpdateKeystoreAutoLockRequest): Promise<KeystoreStatus> {
    const response = await this.#request("/api/keystore/auto-lock", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return parseKeystoreStatus(response.data, response.status);
  }

  async resetPreview(signal?: AbortSignal): Promise<KeystoreResetPreview> {
    const response = await this.#request("/api/keystore/reset-preview", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseKeystoreResetPreview(response.data, response.status);
  }

  async reset(input: KeystoreResetRequest): Promise<KeystoreStatus> {
    return this.#secretStatus("/api/keystore/reset", "POST", input);
  }

  async #secretStatus(
    path: string,
    method: "POST" | "PUT",
    input:
      | ChangeKeystorePasswordRequest
      | CreateKeystorePasswordRequest
      | KeystoreResetRequest
      | UnlockKeystoreRequest,
  ): Promise<KeystoreStatus> {
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    try {
      const response = await this.#request(path, {
        body: bytes as unknown as BodyInit,
        headers: { "Content-Type": keystoreSecretMediaType },
        method,
      });
      return parseKeystoreStatus(response.data, response.status);
    } finally {
      bytes.fill(0);
    }
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
      throw new KeystoreRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new KeystoreRequestError("KEYSTORE_RESPONSE_INVALID", true, response.status);
    }
    if (!response.ok) {
      const envelope = isRecord(body) ? (body as ErrorEnvelope) : null;
      const code =
        typeof envelope?.error?.code === "string" ? envelope.error.code : "KEYSTORE_REQUEST_FAILED";
      throw new KeystoreRequestError(code, envelope?.error?.retryable === true, response.status);
    }
    if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new KeystoreRequestError("KEYSTORE_RESPONSE_INVALID", true, response.status);
    }
    return { data: body.data, status: response.status };
  }
}
