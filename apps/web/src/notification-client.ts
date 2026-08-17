import {
  notificationCategories,
  type DestinationDraft,
  type LocalSinkTestResult,
  type NotificationDestination,
  type NotificationDestinationOptions,
  type NotificationDestinationPatch,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from "@lpbot/api-contract";

type NotificationFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ErrorEnvelope {
  error?: { code?: unknown; retryable?: unknown };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const telegramIdentityPattern = /^[1-9][0-9]{0,18}$/u;

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

function validPreferenceCategories(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, notificationCategories) &&
    notificationCategories.every((category) => typeof value[category] === "boolean")
  );
}

function parseCategories(value: unknown): NotificationDestination["categories"] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > notificationCategories.length) {
    return null;
  }
  if (
    value.some(
      (category) =>
        typeof category !== "string" ||
        !notificationCategories.includes(category as (typeof notificationCategories)[number]),
    ) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  const selected = new Set(value);
  if (
    !notificationCategories
      .filter((category) => selected.has(category))
      .every((v, i) => v === value[i])
  ) {
    return null;
  }
  return value as NotificationDestination["categories"];
}

function validSecretState(config: Record<string, unknown>): boolean {
  return (
    typeof config.secretConfigured === "boolean" &&
    (config.secretRef === null ||
      (typeof config.secretRef === "string" && config.secretRef.length > 0)) &&
    (config.secretConfigured ? config.secretRef !== null : config.secretRef === null)
  );
}

export function parseNotificationPreferences(value: unknown, status = 0): NotificationPreferences {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["categories", "revision", "updatedAt"]) ||
    !validPreferenceCategories(value.categories) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !(value.updatedAt === null || isTimestamp(value.updatedAt))
  ) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  return structuredClone(value) as unknown as NotificationPreferences;
}

export function parseNotificationDestinationOptions(
  value: unknown,
  status = 0,
): NotificationDestinationOptions {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["telegramIdentityId"]) ||
    !(
      value.telegramIdentityId === null ||
      (typeof value.telegramIdentityId === "string" &&
        telegramIdentityPattern.test(value.telegramIdentityId) &&
        BigInt(value.telegramIdentityId) <= 9_223_372_036_854_775_807n)
    )
  ) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  return { telegramIdentityId: value.telegramIdentityId } as NotificationDestinationOptions;
}

export function parseNotificationDestination(value: unknown, status = 0): NotificationDestination {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "categories",
      "config",
      "createdAt",
      "destinationId",
      "enabled",
      "name",
      "revision",
      "type",
      "updatedAt",
      "userId",
    ]) ||
    parseCategories(value.categories) === null ||
    !isRecord(value.config) ||
    !isTimestamp(value.createdAt) ||
    typeof value.destinationId !== "string" ||
    !uuidPattern.test(value.destinationId) ||
    typeof value.enabled !== "boolean" ||
    typeof value.name !== "string" ||
    value.name.trim().length < 1 ||
    [...value.name].length > 120 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isTimestamp(value.updatedAt) ||
    typeof value.userId !== "string" ||
    !uuidPattern.test(value.userId)
  ) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  const config = value.config;
  if (value.type === "telegram") {
    if (
      !exactKeys(config, ["secretConfigured", "secretRef", "telegramIdentityId", "template"]) ||
      !validSecretState(config) ||
      typeof config.telegramIdentityId !== "string" ||
      !telegramIdentityPattern.test(config.telegramIdentityId) ||
      typeof config.template !== "string"
    ) {
      throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
    }
  } else if (value.type === "webhook") {
    if (
      !exactKeys(config, ["method", "secretConfigured", "secretRef", "template", "url"]) ||
      !validSecretState(config) ||
      (config.method !== "GET" && config.method !== "POST") ||
      typeof config.url !== "string" ||
      !config.url.startsWith("https://") ||
      (config.method === "GET" && typeof config.template !== "string") ||
      (config.method === "POST" && !isRecord(config.template))
    ) {
      throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
    }
  } else {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  return structuredClone(value) as unknown as NotificationDestination;
}

function parseNotificationDestinations(value: unknown, status: number): NotificationDestination[] {
  if (!Array.isArray(value)) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  const destinations = value.map((destination) =>
    parseNotificationDestination(destination, status),
  );
  if (
    new Set(destinations.map(({ destinationId }) => destinationId)).size !== destinations.length
  ) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  return destinations;
}

export function parseLocalSinkTestResult(value: unknown, status = 0): LocalSinkTestResult {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["destinationType", "networkCalls", "rendered", "signed", "sink"]) ||
    (value.destinationType !== "telegram" && value.destinationType !== "webhook") ||
    value.networkCalls !== 0 ||
    typeof value.signed !== "boolean" ||
    value.sink !== "local-sink://p03-01" ||
    !isRecord(value.rendered)
  ) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  const rendered = value.rendered;
  const validTelegram =
    value.destinationType === "telegram" &&
    exactKeys(rendered, ["message", "parseMode"]) &&
    typeof rendered.message === "string" &&
    [...rendered.message].length <= 4_096 &&
    rendered.parseMode === "HTML";
  const validGet =
    value.destinationType === "webhook" &&
    exactKeys(rendered, ["body", "method", "query"]) &&
    rendered.body === "" &&
    rendered.method === "GET" &&
    typeof rendered.query === "string";
  const validPost =
    value.destinationType === "webhook" &&
    exactKeys(rendered, ["body", "method"]) &&
    typeof rendered.body === "string" &&
    new TextEncoder().encode(rendered.body).length <= 65_536 &&
    rendered.method === "POST";
  if (!validTelegram && !validGet && !validPost) {
    throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, status);
  }
  return structuredClone(value) as unknown as LocalSinkTestResult;
}

export class NotificationRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, retryable: boolean, status: number) {
    super(code);
    this.name = "NotificationRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export class NotificationClient {
  readonly #fetcher: NotificationFetch;

  constructor(fetcher: NotificationFetch = globalThis.fetch.bind(globalThis)) {
    this.#fetcher = fetcher;
  }

  async getPreferences(signal?: AbortSignal): Promise<NotificationPreferences> {
    const response = await this.#request("/api/notification-preferences", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseNotificationPreferences(response.data, response.status);
  }

  async getDestinationOptions(signal?: AbortSignal): Promise<NotificationDestinationOptions> {
    const response = await this.#request("/api/notification-destinations/options", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseNotificationDestinationOptions(response.data, response.status);
  }

  async listDestinations(signal?: AbortSignal): Promise<NotificationDestination[]> {
    const response = await this.#request("/api/notification-destinations", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    return parseNotificationDestinations(response.data, response.status);
  }

  async patchPreferences(patch: NotificationPreferencesPatch): Promise<NotificationPreferences> {
    const response = await this.#request("/api/notification-preferences", {
      body: JSON.stringify(patch),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    return parseNotificationPreferences(response.data, response.status);
  }

  async createDestination(
    draft: DestinationDraft,
    idempotencyKey: string,
  ): Promise<NotificationDestination> {
    const response = await this.#request("/api/notification-destinations", {
      body: JSON.stringify(draft),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      method: "POST",
    });
    return parseNotificationDestination(response.data, response.status);
  }

  async patchDestination(
    destinationId: string,
    patch: NotificationDestinationPatch,
  ): Promise<NotificationDestination> {
    const response = await this.#request(
      `/api/notification-destinations/${encodeURIComponent(destinationId)}`,
      {
        body: JSON.stringify(patch),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      },
    );
    return parseNotificationDestination(response.data, response.status);
  }

  async deleteDestination(destinationId: string, expectedRevision: number): Promise<void> {
    const response = await this.#fetch(
      `/api/notification-destinations/${encodeURIComponent(destinationId)}`,
      {
        body: JSON.stringify({ expectedRevision }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    if (response.status === 204) return;
    await this.#throwResponseError(response);
  }

  async testDestination(draft: DestinationDraft): Promise<LocalSinkTestResult> {
    const response = await this.#request("/api/notification-destinations/test", {
      body: JSON.stringify(draft),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return parseLocalSinkTestResult(response.data, response.status);
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
      if (error instanceof NotificationRequestError) throw error;
      throw new NotificationRequestError("NETWORK_ERROR", true, 0);
    }
  }

  async #request(path: string, init: RequestInit): Promise<{ data: unknown; status: number }> {
    const response = await this.#fetch(path, init);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, response.status);
    }
    if (!response.ok) return this.#throwResponseError(response, body);
    if (!isRecord(body) || body.success !== true || !Object.hasOwn(body, "data")) {
      throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, response.status);
    }
    return { data: body.data, status: response.status };
  }

  async #throwResponseError(response: Response, parsedBody?: unknown): Promise<never> {
    let body = parsedBody;
    if (body === undefined) {
      try {
        body = await response.json();
      } catch {
        throw new NotificationRequestError("NOTIFICATION_RESPONSE_INVALID", true, response.status);
      }
    }
    const envelope = isRecord(body) ? (body as ErrorEnvelope) : {};
    const code =
      typeof envelope.error?.code === "string"
        ? envelope.error.code
        : "NOTIFICATION_REQUEST_FAILED";
    throw new NotificationRequestError(code, envelope.error?.retryable === true, response.status);
  }
}
