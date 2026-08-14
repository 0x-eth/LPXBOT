import {
  type ChainAccessMode,
  type ManagedChainView,
  type UpdateChainAccessRequest,
} from "@lpbot/api-contract";

interface SuccessEnvelope {
  data: unknown;
  success: true;
}

export interface ChainConfigUpdateView {
  chains: ManagedChainView[];
  status: "unchanged" | "updated";
}

export class ChainConfigRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super("The chain configuration request could not be completed");
    this.code = code;
    this.name = "ChainConfigRequestError";
    this.retryable = retryable;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAccessMode(value: unknown): value is ChainAccessMode {
  return value === "off" || value === "pro" || value === "all";
}

function parseNullableDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  return undefined;
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function parseManagedChain(value: unknown): ManagedChainView | null {
  if (!isRecord(value)) return null;
  const activePositionCount = value.activePositionCount;
  const missingConfiguration = value.missingConfiguration;
  const previousAccess = value.previousAccess;
  const reason = parseNullableString(value.reason);
  const updatedAt = parseNullableDate(value.updatedAt);
  const updatedBy = parseNullableString(value.updatedBy);
  if (
    !Number.isSafeInteger(value.chainId) ||
    (value.chainId as number) <= 0 ||
    typeof value.displayName !== "string" ||
    value.displayName.trim().length === 0 ||
    !isAccessMode(value.access) ||
    !(
      activePositionCount === null ||
      (Number.isSafeInteger(activePositionCount) && (activePositionCount as number) >= 0)
    ) ||
    typeof value.configurationComplete !== "boolean" ||
    typeof value.isDefault !== "boolean" ||
    !Array.isArray(missingConfiguration) ||
    !missingConfiguration.every((item) => typeof item === "string" && item.length > 0) ||
    !(previousAccess === null || isAccessMode(previousAccess)) ||
    reason === undefined ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    updatedAt === undefined ||
    updatedBy === undefined
  ) {
    return null;
  }
  return {
    access: value.access,
    activePositionCount: activePositionCount as number | null,
    chainId: value.chainId as number,
    configurationComplete: value.configurationComplete,
    displayName: value.displayName,
    isDefault: value.isDefault,
    missingConfiguration: [...missingConfiguration],
    previousAccess,
    reason,
    revision: value.revision as number,
    updatedAt,
    updatedBy,
  };
}

function parseChains(value: unknown): ManagedChainView[] | null {
  if (!isRecord(value) || !Array.isArray(value.chains)) return null;
  const chains: ManagedChainView[] = [];
  const ids = new Set<number>();
  for (const item of value.chains) {
    const chain = parseManagedChain(item);
    if (!chain || ids.has(chain.chainId)) return null;
    ids.add(chain.chainId);
    chains.push(chain);
  }
  return chains;
}

function responseError(body: unknown, status: number): ChainConfigRequestError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return new ChainConfigRequestError(
    error && typeof error.code === "string" ? error.code : "REQUEST_FAILED",
    error?.retryable === true,
    status,
  );
}

export class ChainConfigClient {
  readonly #fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async get(): Promise<ManagedChainView[]> {
    const data = await this.#request("/api/system-config/chains", {
      cache: "no-store",
      method: "GET",
    });
    const chains = parseChains(data);
    if (!chains) throw new ChainConfigRequestError("INVALID_RESPONSE", true, 200);
    return chains;
  }

  async update(request: UpdateChainAccessRequest): Promise<ChainConfigUpdateView> {
    const data = await this.#request("/api/system-config/chains", {
      body: JSON.stringify(request),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const chains = parseChains(data);
    if (!chains || !isRecord(data) || (data.status !== "unchanged" && data.status !== "updated")) {
      throw new ChainConfigRequestError("INVALID_RESPONSE", true, 200);
    }
    return { chains, status: data.status };
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetcher(path, { ...init, credentials: "include" });
    } catch {
      throw new ChainConfigRequestError("NETWORK_ERROR", true, 0);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ChainConfigRequestError("INVALID_RESPONSE", true, response.status);
    }
    if (!response.ok) throw responseError(body, response.status);
    if (!isRecord(body) || body.success !== true || !("data" in body)) {
      throw new ChainConfigRequestError("INVALID_RESPONSE", true, response.status);
    }
    return (body as unknown as SuccessEnvelope).data;
  }
}
