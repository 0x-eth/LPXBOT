import {
  poolBlocklistMaxEntries,
  poolBlocklistMaxLabelLength,
  type PatchPoolBlocklistRequest,
  type PoolBlocklistEntry,
  type PoolBlocklistSnapshot,
} from "@lpbot/api-contract";

type PoolBlocklistFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorBody {
  current?: unknown;
  error?: { code?: unknown; message?: unknown; retryable?: unknown };
  success?: unknown;
}

const hashPattern = /^sha256:[0-9a-f]{64}$/u;
const poolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const controlPattern = /[\u0000-\u001f\u007f-\u009f]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function parseEntry(value: unknown): PoolBlocklistEntry | null {
  if (!isRecord(value)) return null;
  const keys = Object.hasOwn(value, "label")
    ? ["chainId", "identity", "label", "scope"]
    : ["chainId", "identity", "scope"];
  if (
    !exactKeys(value, keys) ||
    value.chainId !== 56 ||
    (value.scope !== "pool" && value.scope !== "token") ||
    typeof value.identity !== "string" ||
    (value.scope === "pool"
      ? !poolKeyPattern.test(value.identity)
      : !addressPattern.test(value.identity))
  ) {
    return null;
  }
  if (
    Object.hasOwn(value, "label") &&
    (typeof value.label !== "string" ||
      value.label !== value.label.trim() ||
      value.label.length === 0 ||
      [...value.label].length > poolBlocklistMaxLabelLength ||
      controlPattern.test(value.label))
  ) {
    return null;
  }
  return value as unknown as PoolBlocklistEntry;
}

function entryKey(entry: PoolBlocklistEntry): string {
  return `${entry.chainId}\u0000${entry.scope}\u0000${entry.identity}`;
}

export function parsePoolBlocklistSnapshot(value: unknown): PoolBlocklistSnapshot {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["blocklistHash", "entries", "revision", "schemaVersion", "updatedAt"]) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !hashPattern.test(String(value.blocklistHash)) ||
    !Array.isArray(value.entries) ||
    value.entries.length > poolBlocklistMaxEntries ||
    !(
      value.updatedAt === null ||
      (typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)))
    ) ||
    (((value.revision as number) === 0) !== (value.updatedAt === null))
  ) {
    throw new PoolBlocklistRequestError("POOL_BLOCKLIST_RESPONSE_INVALID", 0);
  }
  const entries = value.entries.map(parseEntry);
  if (entries.some((entry) => entry === null)) {
    throw new PoolBlocklistRequestError("POOL_BLOCKLIST_RESPONSE_INVALID", 0);
  }
  const canonical = entries as PoolBlocklistEntry[];
  const keys = canonical.map(entryKey);
  if (
    new Set(keys).size !== keys.length ||
    keys.some((key, index) => index > 0 && keys[index - 1]!.localeCompare(key, "en") > 0)
  ) {
    throw new PoolBlocklistRequestError("POOL_BLOCKLIST_RESPONSE_INVALID", 0);
  }
  return { ...value, entries: canonical } as unknown as PoolBlocklistSnapshot;
}

export class PoolBlocklistRequestError extends Error {
  readonly code: string;
  readonly current: PoolBlocklistSnapshot | null;
  readonly status: number;

  constructor(code: string, status: number, current: PoolBlocklistSnapshot | null = null) {
    super(code);
    this.name = "PoolBlocklistRequestError";
    this.code = code;
    this.current = current;
    this.status = status;
  }
}

export class PoolBlocklistClient {
  readonly #fetcher: PoolBlocklistFetch;

  constructor(fetcher: PoolBlocklistFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async get(signal?: AbortSignal): Promise<PoolBlocklistSnapshot> {
    return this.#request({ method: "GET", ...(signal ? { signal } : {}) });
  }

  async patch(
    request: PatchPoolBlocklistRequest,
    signal?: AbortSignal,
  ): Promise<PoolBlocklistSnapshot> {
    return this.#request({
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      ...(signal ? { signal } : {}),
    });
  }

  async #request(init: RequestInit): Promise<PoolBlocklistSnapshot> {
    let response: Response;
    try {
      response = await this.#fetcher("/api/user/pool-blocklist", {
        ...init,
        credentials: "include",
        headers: { Accept: "application/json", ...init.headers },
      });
    } catch (error) {
      if (error instanceof PoolBlocklistRequestError) throw error;
      throw new PoolBlocklistRequestError("NETWORK_ERROR", 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PoolBlocklistRequestError("POOL_BLOCKLIST_RESPONSE_INVALID", response.status);
    }
    if (response.ok && isRecord(body) && body.success === true && Object.hasOwn(body, "data")) {
      return parsePoolBlocklistSnapshot(body.data);
    }
    const errorBody = isRecord(body) ? (body as ErrorBody) : {};
    const code =
      typeof errorBody.error?.code === "string"
        ? errorBody.error.code
        : "POOL_BLOCKLIST_REQUEST_FAILED";
    let current: PoolBlocklistSnapshot | null = null;
    if (errorBody.current !== undefined) {
      try {
        current = parsePoolBlocklistSnapshot(errorBody.current);
      } catch {
        throw new PoolBlocklistRequestError("POOL_BLOCKLIST_RESPONSE_INVALID", response.status);
      }
    }
    throw new PoolBlocklistRequestError(code, response.status, current);
  }
}
