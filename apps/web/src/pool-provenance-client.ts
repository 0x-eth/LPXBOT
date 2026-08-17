import type {
  MarketProtocol,
  PoolCreationAttribution,
  PoolCreationCreatorProfile,
  PoolCreationHistoryPage,
  PoolCreationProvenanceRecord,
} from "@lpbot/api-contract";

export class PoolProvenanceRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(status: number, code: string, retryable: boolean) {
    super("Pool creation provenance request failed");
    this.name = "PoolProvenanceRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface PoolCreatorBatchView {
  malformed: Set<string>;
  records: Map<string, PoolCreationAttribution | null>;
  status: "partial" | "ready";
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const poolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const transactionPattern = /^0x[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const unsignedIntegerPattern = /^(?:0|[1-9][0-9]{0,77})$/u;
const protocolSet = new Set<MarketProtocol>(["pcsv3", "univ3", "pcsv4", "univ4"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function provenanceRecord(value: unknown): PoolCreationProvenanceRecord | null {
  if (!isRecord(value)) return null;
  if (
    !exactKeys(value, [
      "chainId",
      "completedAt",
      "creatorAddress",
      "feePips",
      "operationId",
      "outcome",
      "poolKey",
      "protocol",
      "schemaVersion",
      "txHash",
      "userId",
    ]) ||
    value.chainId !== 56 ||
    value.schemaVersion !== 1 ||
    !isIsoDate(value.completedAt) ||
    typeof value.operationId !== "string" ||
    !uuidPattern.test(value.operationId) ||
    typeof value.userId !== "string" ||
    !uuidPattern.test(value.userId) ||
    typeof value.poolKey !== "string" ||
    !poolKeyPattern.test(value.poolKey) ||
    typeof value.protocol !== "string" ||
    !protocolSet.has(value.protocol as MarketProtocol) ||
    typeof value.feePips !== "string" ||
    !unsignedIntegerPattern.test(value.feePips) ||
    (value.outcome !== "created" && value.outcome !== "already_exists") ||
    (value.creatorAddress !== null &&
      (typeof value.creatorAddress !== "string" || !addressPattern.test(value.creatorAddress))) ||
    (value.txHash !== null &&
      (typeof value.txHash !== "string" || !transactionPattern.test(value.txHash))) ||
    (value.outcome === "created" && (value.creatorAddress === null || value.txHash === null))
  ) {
    return null;
  }
  const generation = value.poolKey.length === 45 ? "v3" : "v4";
  if (!value.protocol.endsWith(generation)) return null;
  return value as unknown as PoolCreationProvenanceRecord;
}

function creatorProfile(value: unknown): PoolCreationCreatorProfile | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !exactKeys(value, ["avatarUrl", "displayName", "telegramId"]) ||
    (value.avatarUrl !== null && typeof value.avatarUrl !== "string") ||
    (value.displayName !== null && typeof value.displayName !== "string") ||
    (value.telegramId !== null &&
      (typeof value.telegramId !== "string" || !/^[1-9][0-9]*$/u.test(value.telegramId)))
  ) {
    return undefined;
  }
  return value as unknown as PoolCreationCreatorProfile;
}

function attribution(value: unknown): PoolCreationAttribution | null {
  if (!isRecord(value) || !exactKeys(value, ["creatorProfile", "record", "warning"])) return null;
  const profile = creatorProfile(value.creatorProfile);
  const record = provenanceRecord(value.record);
  if (
    profile === undefined ||
    !record ||
    (value.warning !== null && value.warning !== "ALREADY_EXISTS_NOT_PLATFORM_FIRST") ||
    (record.outcome === "created" && value.warning !== null) ||
    (record.outcome === "already_exists" && value.warning !== "ALREADY_EXISTS_NOT_PLATFORM_FIRST")
  ) {
    return null;
  }
  return {
    creatorProfile: profile,
    record,
    warning: value.warning as PoolCreationAttribution["warning"],
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const value = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(value)) throw new PoolProvenanceRequestError(response.status, "MALFORMED_RESPONSE", true);
  if (!response.ok || value.success !== true) {
    const error = isRecord(value.error) ? value.error : {};
    throw new PoolProvenanceRequestError(
      response.status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      error.retryable === true,
    );
  }
  return value;
}

export class PoolProvenanceClient {
  readonly #fetch: Fetcher;

  constructor(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
    this.#fetch = fetcher;
  }

  async history(input: {
    cursor: string | null;
    limit: number;
    signal?: AbortSignal;
  }): Promise<PoolCreationHistoryPage> {
    const parameters = new URLSearchParams({ limit: String(input.limit) });
    if (input.cursor) parameters.set("cursor", input.cursor);
    const response = await this.#fetch(`/api/pools/create-history?${parameters.toString()}`, {
      credentials: "include",
      method: "GET",
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const envelope = await responseJson(response);
    if (!isRecord(envelope.data) || !exactKeys(envelope.data, ["items", "nextCursor"])) {
      throw new PoolProvenanceRequestError(response.status, "MALFORMED_RESPONSE", true);
    }
    if (
      !Array.isArray(envelope.data.items) ||
      (envelope.data.nextCursor !== null && typeof envelope.data.nextCursor !== "string")
    ) {
      throw new PoolProvenanceRequestError(response.status, "MALFORMED_RESPONSE", true);
    }
    const items = envelope.data.items.map(attribution);
    if (items.some((item) => item === null)) {
      throw new PoolProvenanceRequestError(response.status, "MALFORMED_RESPONSE", true);
    }
    return {
      items: items as PoolCreationAttribution[],
      nextCursor: envelope.data.nextCursor,
    };
  }

  async poolCreators(
    poolKeys: readonly string[],
    signal?: AbortSignal,
  ): Promise<PoolCreatorBatchView> {
    const response = await this.#fetch("/api/admin/pool-creators", {
      body: JSON.stringify({ poolKeys }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    const envelope = await responseJson(response);
    if (!isRecord(envelope.data) || !exactKeys(envelope.data, ["results"]) || !Array.isArray(envelope.data.results)) {
      throw new PoolProvenanceRequestError(response.status, "MALFORMED_RESPONSE", true);
    }
    const requested = new Set(poolKeys);
    const records = new Map<string, PoolCreationAttribution | null>();
    const malformed = new Set<string>();
    for (const value of envelope.data.results) {
      if (!isRecord(value) || !exactKeys(value, ["creator", "identity"])) continue;
      if (typeof value.identity !== "string" || !requested.has(value.identity) || records.has(value.identity)) {
        continue;
      }
      if (value.creator === null) {
        records.set(value.identity, null);
        continue;
      }
      const parsed = attribution(value.creator);
      if (!parsed || parsed.record.poolKey !== value.identity) malformed.add(value.identity);
      else records.set(value.identity, parsed);
    }
    for (const poolKey of poolKeys) {
      if (!records.has(poolKey) && !malformed.has(poolKey)) malformed.add(poolKey);
    }
    return { malformed, records, status: malformed.size > 0 ? "partial" : "ready" };
  }
}

export class PoolProvenanceRequestManager {
  readonly #client: PoolProvenanceClient;
  #controller: AbortController | null = null;
  #generation = 0;

  constructor(client: PoolProvenanceClient) {
    this.#client = client;
  }

  async loadPoolCreators(
    poolKeys: readonly string[],
    sessionKey: string,
    apply: (view: PoolCreatorBatchView, sessionKey: string) => void,
  ): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    const generation = ++this.#generation;
    this.#controller = controller;
    try {
      const view = await this.#client.poolCreators(poolKeys, controller.signal);
      if (generation === this.#generation && !controller.signal.aborted) apply(view, sessionKey);
    } catch (error) {
      if (generation !== this.#generation || controller.signal.aborted) return;
      throw error;
    }
  }

  clear(): void {
    this.#generation += 1;
    this.#controller?.abort();
    this.#controller = null;
  }
}
