import { createHash, randomUUID } from "node:crypto";

import {
  monitorConditionLimit,
  monitorSupportedMetrics,
  monitorUnresolvedMetrics,
  monitorWindowMinutes,
  type Condition,
  type CreateMonitorRequest,
  type LifecycleMonitorRequest,
  type Monitor,
  type MonitorPage,
  type PatchMonitorChanges,
  type PatchMonitorRequest,
} from "@lpbot/api-contract";

export type MonitorValidationCode = "INVALID_MONITOR" | "UNSUPPORTED_METRIC";

export class MonitorValidationError extends Error {
  readonly code: MonitorValidationCode;

  constructor(code: MonitorValidationCode = "INVALID_MONITOR") {
    super(code === "UNSUPPORTED_METRIC" ? "Monitor metric is unsupported" : "Monitor is invalid");
    this.code = code;
    this.name = "MonitorValidationError";
  }
}

export interface MonitorListQuery {
  cursor: string | null;
  enabled: boolean | null;
  limit: number;
}

export interface MonitorCreateInput {
  createdAt: Date;
  idempotencyKey: string;
  request: CreateMonitorRequest;
  userId: string;
}

export interface MonitorPatchInput {
  changes: PatchMonitorChanges;
  expectedRevision: number;
  monitorId: string;
  updatedAt: Date;
  userId: string;
}

export interface MonitorLifecycleInput {
  enabled: boolean;
  expectedRevision: number;
  monitorId: string;
  updatedAt: Date;
  userId: string;
}

export interface MonitorDeleteInput {
  expectedRevision: number;
  monitorId: string;
  userId: string;
}

export type MonitorCreateResult =
  | { status: "created" | "replayed"; value: Monitor }
  | { status: "capacity" | "idempotency-conflict" };

export type MonitorMutationResult =
  | { status: "updated" | "unchanged"; value: Monitor }
  | { current: Monitor; status: "conflict" | "invalid" | "not-ready" }
  | { status: "not-found" };

export type MonitorDeleteResult =
  { current: Monitor; status: "conflict" } | { status: "deleted" | "not-found" };

export interface MonitorStore {
  create(input: MonitorCreateInput): Promise<MonitorCreateResult>;
  delete(input: MonitorDeleteInput): Promise<MonitorDeleteResult>;
  get(userId: string, monitorId: string): Promise<Monitor | null>;
  list(userId: string, query: MonitorListQuery): Promise<MonitorPage>;
  patch(input: MonitorPatchInput): Promise<MonitorMutationResult>;
  setEnabled(input: MonitorLifecycleInput): Promise<MonitorMutationResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function canonicalName(value: unknown): string {
  if (typeof value !== "string") throw new MonitorValidationError();
  const name = value.trim().normalize("NFC");
  if (
    [...name].length < 1 ||
    [...name].length > 120 ||
    [...name].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  ) {
    throw new MonitorValidationError();
  }
  return name;
}

const canonicalPoolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const canonicalDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;
const monitorCursorPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function canonicalPoolKey(value: unknown): CreateMonitorRequest["poolKey"] {
  if (typeof value !== "string" || !canonicalPoolKeyPattern.test(value)) {
    throw new MonitorValidationError();
  }
  return value as CreateMonitorRequest["poolKey"];
}

function canonicalWindow(value: unknown): CreateMonitorRequest["windowMinutes"] {
  if (!monitorWindowMinutes.some((candidate) => candidate === value)) {
    throw new MonitorValidationError();
  }
  return value as CreateMonitorRequest["windowMinutes"];
}

function canonicalCondition(value: unknown): Condition {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["enabled", "id", "operator", "value"]) ||
    typeof value.enabled !== "boolean" ||
    typeof value.id !== "string" ||
    typeof value.value !== "string"
  ) {
    throw new MonitorValidationError();
  }
  if (monitorUnresolvedMetrics.some((metric) => metric === value.id)) {
    throw new MonitorValidationError("UNSUPPORTED_METRIC");
  }
  if (!monitorSupportedMetrics.some((metric) => metric === value.id)) {
    throw new MonitorValidationError();
  }
  if (value.id === "metricVersion") {
    if (value.operator !== "eq" || value.value.length < 1 || value.value.length > 80) {
      throw new MonitorValidationError();
    }
    return { enabled: value.enabled, id: "metricVersion", operator: "eq", value: value.value };
  }
  if (
    (value.operator !== "gte" && value.operator !== "lte") ||
    !canonicalDecimalPattern.test(value.value) ||
    value.value.length > 128
  ) {
    throw new MonitorValidationError();
  }
  if (
    value.id === "transactionCount" &&
    (!/^\d+$/u.test(value.value) || BigInt(value.value) > BigInt(Number.MAX_SAFE_INTEGER))
  ) {
    throw new MonitorValidationError();
  }
  return {
    enabled: value.enabled,
    id: value.id,
    operator: value.operator,
    value: value.value,
  } as Condition;
}

function canonicalConditions(value: unknown): Condition[] {
  if (!Array.isArray(value) || value.length > monitorConditionLimit) {
    throw new MonitorValidationError();
  }
  return value.map(canonicalCondition);
}

export function parseMonitorCreate(value: unknown): CreateMonitorRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "conditions",
      "excludeHanToken",
      "excludeHook",
      "name",
      "poolKey",
      "windowMinutes",
    ]) ||
    typeof value.excludeHanToken !== "boolean" ||
    typeof value.excludeHook !== "boolean"
  ) {
    throw new MonitorValidationError();
  }
  return {
    conditions: canonicalConditions(value.conditions),
    excludeHanToken: value.excludeHanToken,
    excludeHook: value.excludeHook,
    name: canonicalName(value.name),
    poolKey: canonicalPoolKey(value.poolKey),
    windowMinutes: canonicalWindow(value.windowMinutes),
  };
}

export function parseMonitorPatch(value: unknown): PatchMonitorRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["changes", "expectedRevision"]) ||
    !validRevision(value.expectedRevision) ||
    !isRecord(value.changes)
  ) {
    throw new MonitorValidationError();
  }
  const allowed = new Set([
    "conditions",
    "excludeHanToken",
    "excludeHook",
    "name",
    "windowMinutes",
  ]);
  const keys = Object.keys(value.changes);
  if (keys.length === 0 || keys.some((key) => !allowed.has(key))) {
    throw new MonitorValidationError();
  }
  const changes: PatchMonitorChanges = {};
  if (Object.hasOwn(value.changes, "conditions")) {
    changes.conditions = canonicalConditions(value.changes.conditions);
  }
  if (Object.hasOwn(value.changes, "excludeHanToken")) {
    if (typeof value.changes.excludeHanToken !== "boolean") throw new MonitorValidationError();
    changes.excludeHanToken = value.changes.excludeHanToken;
  }
  if (Object.hasOwn(value.changes, "excludeHook")) {
    if (typeof value.changes.excludeHook !== "boolean") throw new MonitorValidationError();
    changes.excludeHook = value.changes.excludeHook;
  }
  if (Object.hasOwn(value.changes, "name")) changes.name = canonicalName(value.changes.name);
  if (Object.hasOwn(value.changes, "windowMinutes")) {
    changes.windowMinutes = canonicalWindow(value.changes.windowMinutes);
  }
  return { changes, expectedRevision: value.expectedRevision };
}

export function parseMonitorLifecycle(value: unknown): LifecycleMonitorRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["expectedRevision"]) ||
    !validRevision(value.expectedRevision)
  ) {
    throw new MonitorValidationError();
  }
  return { expectedRevision: value.expectedRevision };
}

export function parseMonitorListQuery(value: unknown): MonitorListQuery {
  if (!isRecord(value)) throw new MonitorValidationError();
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "cursor" && key !== "enabled" && key !== "limit")) {
    throw new MonitorValidationError();
  }
  const rawLimit = value.limit ?? "50";
  if (typeof rawLimit !== "string" || !/^(?:[1-9]|[1-9]\d|100)$/u.test(rawLimit)) {
    throw new MonitorValidationError();
  }
  const enabled =
    value.enabled === undefined
      ? null
      : value.enabled === "true"
        ? true
        : value.enabled === "false"
          ? false
          : undefined;
  if (enabled === undefined) throw new MonitorValidationError();
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== "string" || !monitorCursorPattern.test(value.cursor))
  ) {
    throw new MonitorValidationError();
  }
  return { cursor: (value.cursor as string | undefined) ?? null, enabled, limit: Number(rawLimit) };
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new MonitorValidationError();
  }
  return value;
}

function cloneMonitor(value: Monitor): Monitor {
  return structuredClone(value);
}

function requestHash(request: CreateMonitorRequest): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

export class MemoryMonitorStore implements MonitorStore {
  readonly #capacity: number;
  readonly #idFactory: () => string;
  readonly #idempotency = new Map<string, { hash: string; monitorId: string }>();
  readonly #monitors = new Map<string, Monitor>();

  constructor(options: { capacity?: number; idFactory?: () => string } = {}) {
    this.#capacity = options.capacity ?? 100;
    this.#idFactory = options.idFactory ?? randomUUID;
  }

  async create(input: MonitorCreateInput): Promise<MonitorCreateResult> {
    const idempotencyKey = `${input.userId}\u0000${input.idempotencyKey}`;
    const hash = requestHash(input.request);
    const existing = this.#idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.hash !== hash) return { status: "idempotency-conflict" };
      const monitor = this.#monitors.get(existing.monitorId);
      if (!monitor) throw new Error("Monitor idempotency record is inconsistent");
      return { status: "replayed", value: cloneMonitor(monitor) };
    }
    if (
      [...this.#monitors.values()].filter(({ userId }) => userId === input.userId).length >=
      this.#capacity
    ) {
      return { status: "capacity" };
    }
    const timestamp = input.createdAt.toISOString();
    const monitor: Monitor = {
      ...structuredClone(input.request),
      createdAt: timestamp,
      disabledAt: timestamp,
      enabled: false,
      enabledAt: null,
      monitorId: this.#idFactory(),
      revision: 1,
      updatedAt: timestamp,
      userId: input.userId,
    };
    this.#monitors.set(monitor.monitorId, monitor);
    this.#idempotency.set(idempotencyKey, { hash, monitorId: monitor.monitorId });
    return { status: "created", value: cloneMonitor(monitor) };
  }

  async get(userId: string, monitorId: string): Promise<Monitor | null> {
    const value = this.#monitors.get(monitorId);
    return value?.userId === userId ? cloneMonitor(value) : null;
  }

  async list(userId: string, query: MonitorListQuery): Promise<MonitorPage> {
    const all = [...this.#monitors.values()]
      .filter((monitor) => monitor.userId === userId)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? right.monitorId.localeCompare(left.monitorId, "en")
          : right.createdAt.localeCompare(left.createdAt, "en"),
      );
    const filtered =
      query.enabled === null ? all : all.filter(({ enabled }) => enabled === query.enabled);
    const cursorIndex =
      query.cursor === null
        ? -1
        : filtered.findIndex(({ monitorId }) => monitorId === query.cursor);
    const start = cursorIndex < 0 ? 0 : cursorIndex + 1;
    const page = filtered.slice(start, start + query.limit + 1);
    return {
      enabledCount: all.filter(({ enabled }) => enabled).length,
      items: page.slice(0, query.limit).map(cloneMonitor),
      nextCursor: page.length > query.limit ? page[query.limit - 1]!.monitorId : null,
      totalCount: all.length,
    };
  }

  async patch(input: MonitorPatchInput): Promise<MonitorMutationResult> {
    const current = this.#owned(input.userId, input.monitorId);
    if (!current) return { status: "not-found" };
    if (current.revision !== input.expectedRevision) {
      return { current: cloneMonitor(current), status: "conflict" };
    }
    const nextConditions = input.changes.conditions ?? current.conditions;
    if (
      current.enabled &&
      ((input.changes.windowMinutes !== undefined &&
        input.changes.windowMinutes !== current.windowMinutes) ||
        !nextConditions.some(({ enabled }) => enabled))
    ) {
      return { current: cloneMonitor(current), status: "invalid" };
    }
    const changed = Object.entries(input.changes).some(
      ([key, value]) => JSON.stringify(current[key as keyof Monitor]) !== JSON.stringify(value),
    );
    if (!changed) return { status: "unchanged", value: cloneMonitor(current) };
    const updated: Monitor = {
      ...current,
      ...structuredClone(input.changes),
      revision: current.revision + 1,
      updatedAt: input.updatedAt.toISOString(),
    };
    this.#monitors.set(updated.monitorId, updated);
    return { status: "updated", value: cloneMonitor(updated) };
  }

  async setEnabled(input: MonitorLifecycleInput): Promise<MonitorMutationResult> {
    const current = this.#owned(input.userId, input.monitorId);
    if (!current) return { status: "not-found" };
    if (current.revision !== input.expectedRevision) {
      return { current: cloneMonitor(current), status: "conflict" };
    }
    if (current.enabled === input.enabled) {
      return { status: "unchanged", value: cloneMonitor(current) };
    }
    if (input.enabled && !current.conditions.some(({ enabled }) => enabled)) {
      return { current: cloneMonitor(current), status: "not-ready" };
    }
    const timestamp = input.updatedAt.toISOString();
    const updated: Monitor = {
      ...current,
      disabledAt: input.enabled ? current.disabledAt : timestamp,
      enabled: input.enabled,
      enabledAt: input.enabled ? timestamp : current.enabledAt,
      revision: current.revision + 1,
      updatedAt: timestamp,
    };
    this.#monitors.set(updated.monitorId, updated);
    return { status: "updated", value: cloneMonitor(updated) };
  }

  async delete(input: MonitorDeleteInput): Promise<MonitorDeleteResult> {
    const current = this.#owned(input.userId, input.monitorId);
    if (!current) return { status: "not-found" };
    if (current.revision !== input.expectedRevision) {
      return { current: cloneMonitor(current), status: "conflict" };
    }
    this.#monitors.delete(input.monitorId);
    return { status: "deleted" };
  }

  #owned(userId: string, monitorId: string): Monitor | null {
    const monitor = this.#monitors.get(monitorId);
    return monitor?.userId === userId ? monitor : null;
  }
}
