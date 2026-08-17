import {
  monitorConditionLimit,
  monitorSupportedMetrics,
  monitorWindowMinutes,
  type Condition,
  type CreateMonitorRequest,
  type Monitor,
  type MonitorPage,
  type PatchMonitorRequest,
} from "@lpbot/api-contract";

type MonitorFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  current?: unknown;
  error?: { code?: unknown; retryable?: unknown };
}

export interface MonitorListOptions {
  cursor?: string;
  enabled?: boolean;
  limit?: number;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const poolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseCondition(value: unknown): Condition | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["enabled", "id", "operator", "value"]) ||
    typeof value.enabled !== "boolean" ||
    typeof value.id !== "string" ||
    !monitorSupportedMetrics.some((metric) => metric === value.id) ||
    typeof value.value !== "string"
  ) {
    return null;
  }
  if (value.id === "metricVersion") {
    return value.operator === "eq" && value.value.length > 0 && value.value.length <= 80
      ? {
          enabled: value.enabled,
          id: "metricVersion",
          operator: "eq",
          value: value.value,
        }
      : null;
  }
  if (
    (value.operator !== "gte" && value.operator !== "lte") ||
    !decimalPattern.test(value.value) ||
    value.value.length > 128
  ) {
    return null;
  }
  if (
    value.id === "transactionCount" &&
    (!/^\d+$/u.test(value.value) || BigInt(value.value) > BigInt(Number.MAX_SAFE_INTEGER))
  ) {
    return null;
  }
  return value as unknown as Condition;
}

export function parseMonitor(value: unknown, status = 0): Monitor {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "conditions",
      "createdAt",
      "destinationIds",
      "disabledAt",
      "enabled",
      "enabledAt",
      "excludeHanToken",
      "excludeHook",
      "monitorId",
      "name",
      "poolKey",
      "revision",
      "updatedAt",
      "userId",
      "windowMinutes",
    ]) ||
    !Array.isArray(value.conditions) ||
    value.conditions.length > monitorConditionLimit ||
    !Array.isArray(value.destinationIds) ||
    value.destinationIds.some(
      (destinationId) => typeof destinationId !== "string" || !uuidPattern.test(destinationId),
    ) ||
    new Set(value.destinationIds).size !== value.destinationIds.length ||
    !isTimestamp(value.createdAt) ||
    !(value.disabledAt === null || isTimestamp(value.disabledAt)) ||
    typeof value.enabled !== "boolean" ||
    !(value.enabledAt === null || isTimestamp(value.enabledAt)) ||
    typeof value.excludeHanToken !== "boolean" ||
    typeof value.excludeHook !== "boolean" ||
    typeof value.monitorId !== "string" ||
    !uuidPattern.test(value.monitorId) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    typeof value.poolKey !== "string" ||
    !poolKeyPattern.test(value.poolKey) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isTimestamp(value.updatedAt) ||
    typeof value.userId !== "string" ||
    value.userId.length === 0 ||
    !monitorWindowMinutes.some((minutes) => minutes === value.windowMinutes)
  ) {
    throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, status);
  }
  const conditions = value.conditions.map(parseCondition);
  if (conditions.some((condition) => condition === null)) {
    throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, status);
  }
  return { ...value, conditions } as unknown as Monitor;
}

export function parseMonitorPage(value: unknown, status = 0): MonitorPage {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["enabledCount", "items", "nextCursor", "totalCount"]) ||
    !Number.isSafeInteger(value.enabledCount) ||
    (value.enabledCount as number) < 0 ||
    !Number.isSafeInteger(value.totalCount) ||
    (value.totalCount as number) < 0 ||
    (value.enabledCount as number) > (value.totalCount as number) ||
    !Array.isArray(value.items) ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" && uuidPattern.test(value.nextCursor))
    )
  ) {
    throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, status);
  }
  const items = value.items.map((item) => parseMonitor(item, status));
  if (new Set(items.map(({ monitorId }) => monitorId)).size !== items.length) {
    throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, status);
  }
  return {
    enabledCount: value.enabledCount as number,
    items,
    nextCursor: value.nextCursor,
    totalCount: value.totalCount as number,
  };
}

export class MonitorRequestError extends Error {
  readonly code: string;
  readonly current: Monitor | null;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number, current: Monitor | null = null) {
    super(code);
    this.name = "MonitorRequestError";
    this.code = code;
    this.current = current;
    this.retryable = retryable;
    this.status = status;
  }
}

export class MonitorClient {
  readonly #fetcher: MonitorFetch;

  constructor(fetcher: MonitorFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async list(options: MonitorListOptions = {}, signal?: AbortSignal): Promise<MonitorPage> {
    const parameters = new URLSearchParams();
    if (options.cursor !== undefined) parameters.set("cursor", options.cursor);
    if (options.enabled !== undefined) parameters.set("enabled", String(options.enabled));
    if (options.limit !== undefined) parameters.set("limit", String(options.limit));
    const query = parameters.size > 0 ? `?${parameters.toString()}` : "";
    const response = await this.#request(`/api/monitors${query}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseMonitorPage(response.data, response.status);
  }

  async get(monitorId: string, signal?: AbortSignal): Promise<Monitor> {
    const response = await this.#request(`/api/monitors/${encodeURIComponent(monitorId)}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseMonitor(response.data, response.status);
  }

  async create(request: CreateMonitorRequest, idempotencyKey: string): Promise<Monitor> {
    const response = await this.#request("/api/monitors", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
    return parseMonitor(response.data, response.status);
  }

  async patch(monitorId: string, request: PatchMonitorRequest): Promise<Monitor> {
    const response = await this.#request(`/api/monitors/${encodeURIComponent(monitorId)}`, {
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return parseMonitor(response.data, response.status);
  }

  async enable(monitorId: string, expectedRevision: number): Promise<Monitor> {
    return this.#lifecycle(monitorId, "enable", expectedRevision);
  }

  async disable(monitorId: string, expectedRevision: number): Promise<Monitor> {
    return this.#lifecycle(monitorId, "disable", expectedRevision);
  }

  async delete(monitorId: string, expectedRevision: number): Promise<void> {
    const response = await this.#fetch(`/api/monitors/${encodeURIComponent(monitorId)}`, {
      body: JSON.stringify({ expectedRevision }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "DELETE",
    });
    if (response.status === 204) return;
    await this.#throwResponseError(response);
  }

  async #lifecycle(
    monitorId: string,
    action: "enable" | "disable",
    expectedRevision: number,
  ): Promise<Monitor> {
    const response = await this.#request(
      `/api/monitors/${encodeURIComponent(monitorId)}/${action}`,
      {
        body: JSON.stringify({ expectedRevision }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return parseMonitor(response.data, response.status);
  }

  async #fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetcher(path, {
        ...init,
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json", ...init.headers },
      });
    } catch (error) {
      if (error instanceof MonitorRequestError) throw error;
      throw new MonitorRequestError("NETWORK_ERROR", true, 0);
    }
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    const response = await this.#fetch(path, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, response.status);
    }
    if (!response.ok) return this.#throwResponseError(response, body);
    if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, response.status);
    }
    return { data: body.data, status: response.status };
  }

  async #throwResponseError(response: Response, parsedBody?: unknown): Promise<never> {
    let body = parsedBody;
    if (body === undefined) {
      try {
        body = await response.json();
      } catch {
        throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, response.status);
      }
    }
    const envelope = isRecord(body) ? (body as ErrorEnvelope) : {};
    const code =
      typeof envelope.error?.code === "string" ? envelope.error.code : "MONITOR_REQUEST_FAILED";
    let current: Monitor | null = null;
    if (envelope.current !== undefined) {
      try {
        current = parseMonitor(envelope.current);
      } catch {
        throw new MonitorRequestError("MONITOR_RESPONSE_INVALID", true, response.status);
      }
    }
    throw new MonitorRequestError(
      code,
      envelope.error?.retryable === true,
      response.status,
      current,
    );
  }
}
