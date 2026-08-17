import { createHash } from "node:crypto";

import {
  poolBlocklistMaxLabelLength,
  poolBlocklistSchemaVersion,
  type PatchPoolBlocklistRequest,
  type PoolBlocklistEntry,
  type PoolBlocklistOperation,
  type PoolBlocklistSnapshot,
} from "@lpbot/api-contract";

const canonicalAddressPattern = /^0x[0-9a-f]{40}$/u;
const canonicalPoolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;

export class PoolBlocklistValidationError extends Error {
  constructor() {
    super("Pool blocklist request is invalid");
    this.name = "PoolBlocklistValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    [...value].length <= poolBlocklistMaxLabelLength &&
    !controlCharacterPattern.test(value)
  );
}

export function canonicalPoolBlocklistEntry(value: unknown): PoolBlocklistEntry {
  if (!isRecord(value)) throw new PoolBlocklistValidationError();
  const keys = Object.hasOwn(value, "label")
    ? ["chainId", "identity", "label", "scope"]
    : ["chainId", "identity", "scope"];
  if (!exactKeys(value, keys) || value.chainId !== 56) {
    throw new PoolBlocklistValidationError();
  }
  if (value.scope !== "pool" && value.scope !== "token") {
    throw new PoolBlocklistValidationError();
  }
  if (
    typeof value.identity !== "string" ||
    (value.scope === "pool"
      ? !canonicalPoolKeyPattern.test(value.identity)
      : !canonicalAddressPattern.test(value.identity))
  ) {
    throw new PoolBlocklistValidationError();
  }
  if (Object.hasOwn(value, "label") && !validLabel(value.label)) {
    throw new PoolBlocklistValidationError();
  }
  return {
    chainId: 56,
    identity: value.identity,
    ...(Object.hasOwn(value, "label") ? { label: value.label as string } : {}),
    scope: value.scope,
  } as PoolBlocklistEntry;
}

function entryKey(entry: PoolBlocklistEntry): string {
  return `${entry.chainId}\u0000${entry.scope}\u0000${entry.identity}`;
}

export function sortPoolBlocklistEntries(
  entries: readonly PoolBlocklistEntry[],
): PoolBlocklistEntry[] {
  return entries
    .map((entry) => ({ ...entry }))
    .sort((left, right) => entryKey(left).localeCompare(entryKey(right), "en"));
}

export function poolBlocklistHash(
  entries: readonly PoolBlocklistEntry[],
): `sha256:${string}` {
  const eligibilityEntries = sortPoolBlocklistEntries(entries).map(({ chainId, identity, scope }) => ({
    chainId,
    scope,
    identity,
  }));
  const serialized = JSON.stringify({
    schemaVersion: poolBlocklistSchemaVersion,
    entries: eligibilityEntries,
  });
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export function createPoolBlocklistSnapshot(input: {
  entries: readonly unknown[];
  revision: number;
  updatedAt: Date | null;
}): PoolBlocklistSnapshot {
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new PoolBlocklistValidationError();
  }
  if (input.updatedAt !== null && !Number.isFinite(input.updatedAt.getTime())) {
    throw new PoolBlocklistValidationError();
  }
  if ((input.revision === 0) !== (input.updatedAt === null)) {
    throw new PoolBlocklistValidationError();
  }
  const entries = input.entries.map(canonicalPoolBlocklistEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) throw new PoolBlocklistValidationError();
    seen.add(key);
  }
  const sorted = sortPoolBlocklistEntries(entries);
  return {
    blocklistHash: poolBlocklistHash(sorted),
    entries: sorted,
    revision: input.revision,
    schemaVersion: poolBlocklistSchemaVersion,
    updatedAt: input.updatedAt?.toISOString() ?? null,
  };
}

export function defaultPoolBlocklistSnapshot(): PoolBlocklistSnapshot {
  return createPoolBlocklistSnapshot({ entries: [], revision: 0, updatedAt: null });
}

export function parsePoolBlocklistPatch(value: unknown): PatchPoolBlocklistRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["expectedRevision", "operation"]) ||
    !Number.isSafeInteger(value.expectedRevision) ||
    (value.expectedRevision as number) < 0 ||
    !isRecord(value.operation) ||
    !exactKeys(value.operation, ["entry", "type"]) ||
    (value.operation.type !== "block" && value.operation.type !== "restore")
  ) {
    throw new PoolBlocklistValidationError();
  }
  const entry = canonicalPoolBlocklistEntry(value.operation.entry);
  if (value.operation.type === "restore" && entry.label !== undefined) {
    throw new PoolBlocklistValidationError();
  }
  const operation: PoolBlocklistOperation =
    value.operation.type === "block"
      ? { entry, type: "block" }
      : { entry: { chainId: entry.chainId, identity: entry.identity, scope: entry.scope }, type: "restore" };
  return { expectedRevision: value.expectedRevision as number, operation };
}
