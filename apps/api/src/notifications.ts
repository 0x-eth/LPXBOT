import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import {
  notificationCategories,
  type DestinationDraft,
  type LocalSinkTestResult,
  type NotificationCategory,
  type NotificationDestination,
  type NotificationDestinationPatch,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from "@lpbot/api-contract";
import {
  buildWebhookSignature,
  compileNotificationTemplate,
  NotificationTemplateError,
  renderGetWebhook,
  renderPostWebhook,
  renderTelegramMessage,
} from "@lpbot/security";

export type NotificationValidationCode =
  | "INVALID_DESTINATION"
  | "INVALID_PREFERENCES"
  | "UNSAFE_WEBHOOK_TARGET"
  | NotificationTemplateError["code"];

export class NotificationValidationError extends Error {
  readonly code: NotificationValidationCode;

  constructor(code: NotificationValidationCode) {
    super(code);
    this.name = "NotificationValidationError";
    this.code = code;
  }
}

export interface NotificationSecretStore {
  delete(secretRef: string): Promise<void>;
  put(input: {
    kind: "telegram-bot-token" | "webhook-hmac";
    secret: string;
    userId: string;
  }): Promise<{ secretRef: string }>;
}

export type NotificationPreferenceMutationResult =
  | { status: "conflict"; current: NotificationPreferences }
  | { status: "unchanged" | "updated"; value: NotificationPreferences };

export type NotificationDestinationCreateResult =
  | { status: "capacity" | "idempotency-conflict" | "invalid" | "service-unavailable" }
  | { status: "created" | "replayed"; value: NotificationDestination };

export type NotificationDestinationMutationResult =
  | { status: "conflict"; current: NotificationDestination }
  | { status: "invalid" | "not-found" | "service-unavailable" }
  | { status: "unchanged" | "updated"; value: NotificationDestination };

export type NotificationDestinationDeleteResult =
  | { status: "conflict"; current: NotificationDestination }
  | { status: "deleted" | "not-found" };

export interface NotificationConfigurationStore {
  createDestination(input: {
    createdAt: Date;
    draft: DestinationDraft;
    idempotencyKey: string;
    userId: string;
  }): Promise<NotificationDestinationCreateResult>;
  deleteDestination(input: {
    destinationId: string;
    expectedRevision: number;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationDestinationDeleteResult>;
  getPreferences(userId: string): Promise<NotificationPreferences>;
  getTelegramIdentity(userId: string): Promise<string | null>;
  listDestinations(userId: string): Promise<NotificationDestination[]>;
  ownsTelegramIdentity(userId: string, telegramIdentityId: string): Promise<boolean>;
  patchDestination(input: {
    destinationId: string;
    patch: NotificationDestinationPatch;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationDestinationMutationResult>;
  updatePreferences(input: {
    patch: NotificationPreferencesPatch;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationPreferenceMutationResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function canonicalName(value: unknown): string {
  if (typeof value !== "string") throw new NotificationValidationError("INVALID_DESTINATION");
  const name = value.normalize("NFC").trim();
  if (name.length < 1 || [...name].length > 120 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  return name;
}

function canonicalCategories(value: unknown): NotificationCategory[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > notificationCategories.length) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  const selected = new Set<NotificationCategory>();
  for (const category of value) {
    if (
      typeof category !== "string" ||
      !notificationCategories.includes(category as NotificationCategory) ||
      selected.has(category as NotificationCategory)
    ) {
      throw new NotificationValidationError("INVALID_DESTINATION");
    }
    selected.add(category as NotificationCategory);
  }
  return notificationCategories.filter((category) => selected.has(category));
}

function canonicalSecret(
  value: unknown,
  kind: "telegram" | "webhook",
  required: boolean,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new NotificationValidationError("INVALID_DESTINATION");
  const bytes = Buffer.byteLength(value, "utf8");
  const minimum = kind === "webhook" ? 32 : 20;
  if (bytes < minimum || bytes > 4_096 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  return value;
}

function assertWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 4_096) {
    throw new NotificationValidationError("UNSAFE_WEBHOOK_TARGET");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NotificationValidationError("UNSAFE_WEBHOOK_TARGET");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.origin === "null" ||
    value.includes("{{") ||
    value.includes("}}") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIP(hostname) !== 0
  ) {
    throw new NotificationValidationError("UNSAFE_WEBHOOK_TARGET");
  }
  return url.toString();
}

function wrapTemplateError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof NotificationTemplateError) {
      throw new NotificationValidationError(error.code);
    }
    throw error;
  }
}

export function parseDestinationDraft(
  value: unknown,
  options: { telegramSecretRequired?: boolean } = {},
): DestinationDraft {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["categories", "config", "enabled", "name", "type"]) ||
    typeof value.enabled !== "boolean" ||
    !isRecord(value.config)
  ) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  const config = value.config;
  const categories = canonicalCategories(value.categories);
  const name = canonicalName(value.name);
  if (value.type === "telegram") {
    if (
      !hasExactKeys(config, ["telegramIdentityId", "template"], ["botToken"]) ||
      typeof config.telegramIdentityId !== "string" ||
      !/^[1-9][0-9]{0,18}$/u.test(config.telegramIdentityId) ||
      BigInt(config.telegramIdentityId) > 9_223_372_036_854_775_807n ||
      typeof config.template !== "string"
    ) {
      throw new NotificationValidationError("INVALID_DESTINATION");
    }
    const template = wrapTemplateError(
      () => compileNotificationTemplate("TELEGRAM", config.template).source,
    );
    const botToken = canonicalSecret(
      config.botToken,
      "telegram",
      options.telegramSecretRequired ?? true,
    );
    return {
      categories,
      config: {
        ...(botToken === undefined ? {} : { botToken }),
        telegramIdentityId: config.telegramIdentityId,
        template,
      },
      enabled: value.enabled,
      name,
      type: "telegram",
    };
  }
  if (value.type !== "webhook") {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  if (
    !hasExactKeys(config, ["method", "template", "url"], ["signingSecret"]) ||
    (config.method !== "GET" && config.method !== "POST")
  ) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  const url = assertWebhookUrl(config.url);
  const compiled = wrapTemplateError(() =>
    compileNotificationTemplate(config.method as "GET" | "POST", config.template),
  );
  if (
    compiled.method === "POST" &&
    (compiled.value === null || typeof compiled.value !== "object" || Array.isArray(compiled.value))
  ) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  const signingSecret = canonicalSecret(config.signingSecret, "webhook", false);
  return {
    categories,
    config: {
      method: config.method as "GET" | "POST",
      ...(signingSecret === undefined ? {} : { signingSecret }),
      template: compiled.method === "GET" ? compiled.source : structuredClone(compiled.value),
      url,
    },
    enabled: value.enabled,
    name,
    type: "webhook",
  };
}

export function parseNotificationPreferencesPatch(value: unknown): NotificationPreferencesPatch {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["categories", "expectedRevision"]) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 0 ||
    !isRecord(value.categories) ||
    Object.keys(value.categories).length < 1
  ) {
    throw new NotificationValidationError("INVALID_PREFERENCES");
  }
  const categories: Partial<Record<NotificationCategory, boolean>> = {};
  for (const [category, enabled] of Object.entries(value.categories)) {
    if (
      !notificationCategories.includes(category as NotificationCategory) ||
      typeof enabled !== "boolean"
    ) {
      throw new NotificationValidationError("INVALID_PREFERENCES");
    }
    categories[category as NotificationCategory] = enabled;
  }
  return { categories, expectedRevision: value.expectedRevision as number };
}

export function parseNotificationDestinationPatch(value: unknown): NotificationDestinationPatch {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["changes", "expectedRevision"]) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 1 ||
    !isRecord(value.changes) ||
    Object.keys(value.changes).length < 1 ||
    !Object.keys(value.changes).every((key) =>
      ["categories", "config", "enabled", "name"].includes(key),
    )
  ) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  if (value.changes.enabled !== undefined && typeof value.changes.enabled !== "boolean") {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  if (value.changes.name !== undefined && typeof value.changes.name !== "string") {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  if (value.changes.categories !== undefined && !Array.isArray(value.changes.categories)) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  if (
    value.changes.config !== undefined &&
    (!isRecord(value.changes.config) ||
      Object.keys(value.changes.config).length < 1 ||
      !Object.keys(value.changes.config).every((key) =>
        ["botToken", "method", "signingSecret", "telegramIdentityId", "template", "url"].includes(
          key,
        ),
      ))
  ) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  return structuredClone(value) as unknown as NotificationDestinationPatch;
}

export function parseNotificationExpectedRevision(value: unknown): number {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["expectedRevision"]) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 1
  ) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  return value.expectedRevision as number;
}

export function parseNotificationIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new NotificationValidationError("INVALID_DESTINATION");
  }
  return value;
}

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    categories: Object.fromEntries(
      notificationCategories.map((category) => [category, false]),
    ) as Record<NotificationCategory, boolean>,
    revision: 0,
    updatedAt: null,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function notificationDestinationPayloadHash(draft: DestinationDraft): string {
  return createHash("sha256").update(stableJson(draft), "utf8").digest("hex");
}

type StoredDestinationBase = Omit<NotificationDestination, "config" | "type">;

type StoredDestination = StoredDestinationBase &
  (
    | {
        config: {
        secretRef: string | null;
        telegramIdentityId: string;
        template: string;
        };
        type: "telegram";
      }
    | {
        config: {
        method: "GET" | "POST";
        secretRef: string | null;
        template: unknown;
        url: string;
        };
        type: "webhook";
      }
  );

function publicDestination(value: StoredDestination): NotificationDestination {
  return {
    ...structuredClone(value),
    config: {
      ...structuredClone(value.config),
      secretConfigured: value.config.secretRef !== null,
    },
  } as NotificationDestination;
}

export class MemoryNotificationSecretStore implements NotificationSecretStore {
  readonly #secrets = new Map<string, string>();
  #sequence = 0;

  count(): number {
    return this.#secrets.size;
  }

  async delete(secretRef: string): Promise<void> {
    this.#secrets.delete(secretRef);
  }

  async put(input: {
    kind: "telegram-bot-token" | "webhook-hmac";
    secret: string;
    userId: string;
  }): Promise<{ secretRef: string }> {
    this.#sequence += 1;
    const secretRef = `secret-ref://fixture/${input.kind}/${this.#sequence}`;
    this.#secrets.set(secretRef, input.secret);
    return { secretRef };
  }
}

interface MemoryNotificationConfigurationStoreOptions {
  capacity?: number;
  identities?: ReadonlyMap<string, string>;
  secrets: NotificationSecretStore;
}

export class MemoryNotificationConfigurationStore implements NotificationConfigurationStore {
  readonly #capacity: number;
  readonly #destinations = new Map<string, StoredDestination>();
  readonly #idempotency = new Map<string, { destinationId: string; payloadHash: string }>();
  readonly #identities: ReadonlyMap<string, string>;
  readonly #preferences = new Map<string, NotificationPreferences>();
  readonly #secrets: NotificationSecretStore;
  #mutations = 0;

  constructor(options: MemoryNotificationConfigurationStoreOptions) {
    this.#capacity = options.capacity ?? 20;
    this.#identities = options.identities ?? new Map();
    this.#secrets = options.secrets;
  }

  mutationCount(): number {
    return this.#mutations;
  }

  async getTelegramIdentity(userId: string): Promise<string | null> {
    return this.#identities.get(userId) ?? null;
  }

  async ownsTelegramIdentity(userId: string, telegramIdentityId: string): Promise<boolean> {
    return this.#identities.get(userId) === telegramIdentityId;
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    return structuredClone(this.#preferences.get(userId) ?? defaultNotificationPreferences());
  }

  async updatePreferences(input: {
    patch: NotificationPreferencesPatch;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationPreferenceMutationResult> {
    const current = await this.getPreferences(input.userId);
    if (current.revision !== input.patch.expectedRevision) return { current, status: "conflict" };
    const nextCategories = { ...current.categories, ...input.patch.categories };
    if (stableJson(nextCategories) === stableJson(current.categories)) {
      return { status: "unchanged", value: current };
    }
    const value: NotificationPreferences = {
      categories: nextCategories,
      revision: current.revision + 1,
      updatedAt: input.updatedAt.toISOString(),
    };
    this.#preferences.set(input.userId, structuredClone(value));
    this.#mutations += 1;
    return { status: "updated", value };
  }

  async listDestinations(userId: string): Promise<NotificationDestination[]> {
    return [...this.#destinations.values()]
      .filter((destination) => destination.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicDestination);
  }

  async createDestination(input: {
    createdAt: Date;
    draft: DestinationDraft;
    idempotencyKey: string;
    userId: string;
  }): Promise<NotificationDestinationCreateResult> {
    const payloadHash = notificationDestinationPayloadHash(input.draft);
    const idempotencyKey = `${input.userId}\u0000${input.idempotencyKey}`;
    const previous = this.#idempotency.get(idempotencyKey);
    if (previous) {
      if (previous.payloadHash !== payloadHash) return { status: "idempotency-conflict" };
      const existing = this.#destinations.get(previous.destinationId);
      return existing
        ? { status: "replayed", value: publicDestination(existing) }
        : { status: "service-unavailable" };
    }
    if (
      [...this.#destinations.values()].filter(({ userId }) => userId === input.userId).length >=
      this.#capacity
    ) {
      return { status: "capacity" };
    }
    if (
      input.draft.type === "telegram" &&
      !(await this.ownsTelegramIdentity(input.userId, input.draft.config.telegramIdentityId))
    ) {
      return { status: "invalid" };
    }
    let secretRef: string | null = null;
    const secret =
      input.draft.type === "telegram"
        ? input.draft.config.botToken
        : input.draft.config.signingSecret;
    if (secret !== undefined) {
      try {
        secretRef = (
          await this.#secrets.put({
            kind: input.draft.type === "telegram" ? "telegram-bot-token" : "webhook-hmac",
            secret,
            userId: input.userId,
          })
        ).secretRef;
      } catch {
        return { status: "service-unavailable" };
      }
    }
    const timestamp = input.createdAt.toISOString();
    const destinationId = randomUUID();
    const base: StoredDestinationBase = {
      categories: [...input.draft.categories],
      createdAt: timestamp,
      destinationId,
      enabled: input.draft.enabled,
      name: input.draft.name,
      revision: 1,
      updatedAt: timestamp,
      userId: input.userId,
    };
    const destination: StoredDestination =
      input.draft.type === "telegram"
        ? {
            ...base,
            config: {
              secretRef,
              telegramIdentityId: input.draft.config.telegramIdentityId,
              template: input.draft.config.template,
            },
            type: "telegram",
          }
        : {
            ...base,
            config: {
              method: input.draft.config.method,
              secretRef,
              template: structuredClone(input.draft.config.template),
              url: input.draft.config.url,
            },
            type: "webhook",
          };
    this.#destinations.set(destinationId, destination);
    this.#idempotency.set(idempotencyKey, { destinationId, payloadHash });
    this.#mutations += 1;
    return { status: "created", value: publicDestination(destination) };
  }

  async patchDestination(input: {
    destinationId: string;
    patch: NotificationDestinationPatch;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationDestinationMutationResult> {
    const current = this.#destinations.get(input.destinationId);
    if (!current || current.userId !== input.userId) return { status: "not-found" };
    const currentPublic = publicDestination(current);
    if (current.revision !== input.patch.expectedRevision) {
      return { current: currentPublic, status: "conflict" };
    }
    const configChanges = input.patch.changes.config ?? {};
    const secretValue =
      current.type === "telegram" ? configChanges.botToken : configChanges.signingSecret;
    let mergedInput: unknown;
    if (current.type === "telegram") {
      if (
        ["method", "signingSecret", "url"].some((key) =>
          Object.hasOwn(configChanges as object, key),
        )
      ) {
        return { status: "invalid" };
      }
      mergedInput = {
        categories: input.patch.changes.categories ?? current.categories,
        config: {
          ...(secretValue === undefined ? {} : { botToken: secretValue }),
          telegramIdentityId:
            configChanges.telegramIdentityId ?? current.config.telegramIdentityId,
          template: configChanges.template ?? current.config.template,
        },
        enabled: input.patch.changes.enabled ?? current.enabled,
        name: input.patch.changes.name ?? current.name,
        type: "telegram",
      };
    } else {
      if (
        ["botToken", "telegramIdentityId"].some((key) =>
          Object.hasOwn(configChanges as object, key),
        )
      ) {
        return { status: "invalid" };
      }
      mergedInput = {
        categories: input.patch.changes.categories ?? current.categories,
        config: {
          method: configChanges.method ?? current.config.method,
          ...(secretValue === undefined ? {} : { signingSecret: secretValue }),
          template: configChanges.template ?? current.config.template,
          url: configChanges.url ?? current.config.url,
        },
        enabled: input.patch.changes.enabled ?? current.enabled,
        name: input.patch.changes.name ?? current.name,
        type: "webhook",
      };
    }
    let draft: DestinationDraft;
    try {
      draft = parseDestinationDraft(mergedInput, { telegramSecretRequired: false });
    } catch {
      return { status: "invalid" };
    }
    if (
      draft.type === "telegram" &&
      !(await this.ownsTelegramIdentity(input.userId, draft.config.telegramIdentityId))
    ) {
      return { status: "invalid" };
    }
    const comparableCurrent = {
      categories: current.categories,
      config:
        current.type === "telegram"
          ? {
              telegramIdentityId: current.config.telegramIdentityId,
              template: current.config.template,
            }
          : {
              method: current.config.method,
              template: current.config.template,
              url: current.config.url,
            },
      enabled: current.enabled,
      name: current.name,
      type: current.type,
    };
    const comparableDraft = {
      ...draft,
      config: Object.fromEntries(
        Object.entries(draft.config).filter(
          ([key]) => key !== "botToken" && key !== "signingSecret",
        ),
      ),
    };
    if (secretValue === undefined && stableJson(comparableDraft) === stableJson(comparableCurrent)) {
      return { status: "unchanged", value: currentPublic };
    }
    let secretRef = current.config.secretRef;
    if (secretValue !== undefined) {
      try {
        secretRef = (
          await this.#secrets.put({
            kind: current.type === "telegram" ? "telegram-bot-token" : "webhook-hmac",
            secret: secretValue,
            userId: input.userId,
          })
        ).secretRef;
      } catch {
        return { status: "service-unavailable" };
      }
    }
    const next: StoredDestination =
      draft.type === "telegram"
        ? {
            ...current,
            categories: [...draft.categories],
            config: {
              secretRef,
              telegramIdentityId: draft.config.telegramIdentityId,
              template: draft.config.template,
            },
            enabled: draft.enabled,
            name: draft.name,
            revision: current.revision + 1,
            type: "telegram",
            updatedAt: input.updatedAt.toISOString(),
          }
        : {
            ...current,
            categories: [...draft.categories],
            config: {
              method: draft.config.method,
              secretRef,
              template: structuredClone(draft.config.template),
              url: draft.config.url,
            },
            enabled: draft.enabled,
            name: draft.name,
            revision: current.revision + 1,
            type: "webhook",
            updatedAt: input.updatedAt.toISOString(),
          };
    this.#destinations.set(input.destinationId, next);
    this.#mutations += 1;
    return { status: "updated", value: publicDestination(next) };
  }

  async deleteDestination(input: {
    destinationId: string;
    expectedRevision: number;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationDestinationDeleteResult> {
    const current = this.#destinations.get(input.destinationId);
    if (!current || current.userId !== input.userId) return { status: "not-found" };
    if (current.revision !== input.expectedRevision) {
      return { current: publicDestination(current), status: "conflict" };
    }
    this.#destinations.delete(input.destinationId);
    this.#mutations += 1;
    return { status: "deleted" };
  }
}

const localSinkValues = {
  "condition.summary": "Fee >= 10 & ready",
  "delivery.id": "local-test-delivery",
  "delivery.timestamp": "1787011800",
  "metric.version": "market-metrics/v1",
  "metrics.feeTvlRatio": "0.01",
  "metrics.feesUsd": "10",
  "metrics.transactionCount": "25",
  "metrics.tvlUsd": "1000",
  "metrics.volumeUsd": "5000",
  "monitor.id": "local-test-monitor",
  "monitor.name": "Local fixture monitor",
  "monitor.revision": "1",
  "pool.key": `56:0x${"a".repeat(40)}`,
  "pool.token0": `0x${"b".repeat(40)}`,
  "pool.token1": `0x${"c".repeat(40)}`,
  "window.end": "2026-08-18T00:10:00.000Z",
} as const;

export function renderLocalSinkTest(draft: DestinationDraft): LocalSinkTestResult {
  if (draft.type === "telegram") {
    const rendered = wrapTemplateError(() =>
      renderTelegramMessage(
        compileNotificationTemplate("TELEGRAM", draft.config.template),
        localSinkValues,
      ),
    );
    return {
      destinationType: "telegram",
      networkCalls: 0,
      rendered: { message: rendered.message, parseMode: "HTML" },
      signed: false,
      sink: "local-sink://p03-01",
    };
  }
  const compiled = wrapTemplateError(() =>
    compileNotificationTemplate(draft.config.method, draft.config.template),
  );
  if (draft.config.method === "GET") {
    const rendered = wrapTemplateError(() =>
      renderGetWebhook(compiled, localSinkValues, { baseUrl: draft.config.url }),
    );
    if (draft.config.signingSecret !== undefined) {
      buildWebhookSignature({
        body: "",
        deliveryId: localSinkValues["delivery.id"],
        fixtureKey: draft.config.signingSecret,
        method: "GET",
        pathAndQuery: `/p03-01?${rendered.query}`,
        timestamp: localSinkValues["delivery.timestamp"],
      });
    }
    return {
      destinationType: "webhook",
      networkCalls: 0,
      rendered: { body: "", method: "GET", query: rendered.query },
      signed: draft.config.signingSecret !== undefined,
      sink: "local-sink://p03-01",
    };
  }
  const rendered = wrapTemplateError(() => renderPostWebhook(compiled, localSinkValues));
  if (draft.config.signingSecret !== undefined) {
    buildWebhookSignature({
      body: rendered.body,
      deliveryId: localSinkValues["delivery.id"],
      fixtureKey: draft.config.signingSecret,
      method: "POST",
      pathAndQuery: "/p03-01",
      timestamp: localSinkValues["delivery.timestamp"],
    });
  }
  return {
    destinationType: "webhook",
    networkCalls: 0,
    rendered: { body: rendered.body, method: "POST" },
    signed: draft.config.signingSecret !== undefined,
    sink: "local-sink://p03-01",
  };
}
