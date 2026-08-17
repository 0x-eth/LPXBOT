import { createHash } from "node:crypto";

import {
  poolCreationProvenanceSchemaVersion,
  type MarketProtocol,
  type PoolCreationAttribution,
  type PoolCreationCreatorProfile,
  type PoolCreationHistoryPage,
  type PoolCreationProvenanceRecord,
} from "@lpbot/api-contract";

export type {
  PoolCreationAttribution,
  PoolCreationCreatorProfile,
  PoolCreationHistoryPage,
  PoolCreationProvenanceRecord,
};

export const poolCreationProvenanceBatchLimit = 100 as const;
export const poolCreationProvenanceHistoryLimit = 100 as const;

export type PoolCreationAdminAuditAction = "pool-creator.batch" | "pool-creator.single";
export type PoolCreationAdminAuditOutcome = "allowed" | "denied";

export interface PoolCreationAdminAuditInput {
  action: PoolCreationAdminAuditAction;
  actorUserId: string;
  createdAt: Date;
  identityCount: number;
  identityDigest: `sha256:${string}`;
  outcome: PoolCreationAdminAuditOutcome;
  requestId: string;
  resultCode: string;
  sessionId: string;
}

export interface PoolCreationProvenanceRecordResult {
  record: PoolCreationProvenanceRecord;
  status: "idempotent" | "inserted";
}

export interface PoolCreationProvenanceRecorder {
  record(record: PoolCreationProvenanceRecord): Promise<PoolCreationProvenanceRecordResult>;
}

export interface PoolCreationProvenanceReadStore {
  findAttribution(poolKey: string): Promise<PoolCreationAttribution | null>;
  findAttributions(
    poolKeys: readonly string[],
  ): Promise<ReadonlyMap<string, PoolCreationAttribution | null>>;
  listByUser(input: {
    cursor: string | null;
    limit: number;
    userId: string;
  }): Promise<PoolCreationHistoryPage>;
  recordAdminQueryAudit(input: PoolCreationAdminAuditInput): Promise<void>;
}

export type PoolCreationProvenanceStore = PoolCreationProvenanceReadStore &
  PoolCreationProvenanceRecorder;

export interface ParsedPoolCreatorBatch {
  identities: string[];
  identityType: "address" | "poolKey";
  poolKeys: string[];
}

export class PoolCreationProvenanceValidationError extends Error {
  readonly code = "POOL_PROVENANCE_INVALID";

  constructor(message = "Pool creation provenance input is invalid") {
    super(message);
    this.name = "PoolCreationProvenanceValidationError";
  }
}

export class PoolCreationProvenanceConflictError extends Error {
  readonly code = "OPERATION_PAYLOAD_CONFLICT";
  readonly operationId: string;

  constructor(operationId: string) {
    super("The operation ID is already bound to a different provenance payload");
    this.name = "PoolCreationProvenanceConflictError";
    this.operationId = operationId;
  }
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const poolIdPattern = /^0x[0-9a-fA-F]{64}$/u;
const canonicalPoolKeyPattern = /^56:(0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64}))$/u;
const transactionHashPattern = /^0x[0-9a-fA-F]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unsignedIntegerPattern = /^(?:0|[1-9][0-9]{0,77})$/u;
const protocols = new Set<MarketProtocol>(["pcsv3", "univ3", "pcsv4", "univ4"]);

function recordValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PoolCreationProvenanceValidationError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new PoolCreationProvenanceValidationError();
  }
}

export function canonicalPoolCreationAddress(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new PoolCreationProvenanceValidationError();
  }
  return value.toLowerCase() as `0x${string}`;
}

export function canonicalPoolCreationPoolKey(value: unknown): `56:0x${string}` {
  if (typeof value !== "string") throw new PoolCreationProvenanceValidationError();
  const identity = canonicalPoolKeyPattern.exec(value)?.[1] ?? value;
  if (!addressPattern.test(identity) && !poolIdPattern.test(identity)) {
    throw new PoolCreationProvenanceValidationError();
  }
  return `56:${identity.toLowerCase()}` as `56:0x${string}`;
}

function canonicalTransactionHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !transactionHashPattern.test(value)) {
    throw new PoolCreationProvenanceValidationError();
  }
  return value.toLowerCase() as `0x${string}`;
}

function canonicalUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new PoolCreationProvenanceValidationError();
  }
  return value.toLowerCase();
}

function canonicalCompletedAt(value: unknown): string {
  if (typeof value !== "string") throw new PoolCreationProvenanceValidationError();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new PoolCreationProvenanceValidationError();
  }
  return value;
}

export function canonicalPoolCreationRecord(value: unknown): PoolCreationProvenanceRecord {
  const input = recordValue(value);
  exactKeys(input, [
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
  ]);
  if (
    input.chainId !== 56 ||
    input.schemaVersion !== poolCreationProvenanceSchemaVersion ||
    (input.outcome !== "created" && input.outcome !== "already_exists") ||
    typeof input.protocol !== "string" ||
    !protocols.has(input.protocol as MarketProtocol) ||
    typeof input.feePips !== "string" ||
    !unsignedIntegerPattern.test(input.feePips)
  ) {
    throw new PoolCreationProvenanceValidationError();
  }
  const poolKey = canonicalPoolCreationPoolKey(input.poolKey);
  const generation = poolKey.length === 45 ? "v3" : "v4";
  if (!input.protocol.endsWith(generation)) throw new PoolCreationProvenanceValidationError();
  const creatorAddress =
    input.creatorAddress === null ? null : canonicalPoolCreationAddress(input.creatorAddress);
  const txHash = input.txHash === null ? null : canonicalTransactionHash(input.txHash);
  if (input.outcome === "created" && (creatorAddress === null || txHash === null)) {
    throw new PoolCreationProvenanceValidationError();
  }
  return {
    chainId: 56,
    completedAt: canonicalCompletedAt(input.completedAt),
    creatorAddress,
    feePips: input.feePips,
    operationId: canonicalUuid(input.operationId),
    outcome: input.outcome,
    poolKey,
    protocol: input.protocol as MarketProtocol,
    schemaVersion: poolCreationProvenanceSchemaVersion,
    txHash,
    userId: canonicalUuid(input.userId),
  };
}

export function parsePoolCreatorQuery(value: unknown): { identity: string; poolKey: string } {
  const input = recordValue(value);
  exactKeys(input, ["address", "chainId"]);
  if (input.chainId !== "56") throw new PoolCreationProvenanceValidationError();
  const identity = canonicalPoolCreationAddress(input.address);
  return { identity, poolKey: canonicalPoolCreationPoolKey(identity) };
}

export function parsePoolCreatorBatchRequest(
  value: unknown,
  maximum = poolCreationProvenanceBatchLimit,
): ParsedPoolCreatorBatch {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError("Pool creator batch maximum must be a positive integer");
  }
  const input = recordValue(value);
  const keys = Object.keys(input);
  if (keys.length !== 1 || (keys[0] !== "addresses" && keys[0] !== "poolKeys")) {
    throw new PoolCreationProvenanceValidationError();
  }
  const identityType = keys[0] === "addresses" ? "address" : "poolKey";
  const values = input[keys[0]!];
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) {
    throw new PoolCreationProvenanceValidationError();
  }
  const identities = values.map((entry) =>
    identityType === "address"
      ? canonicalPoolCreationAddress(entry)
      : (() => {
          if (typeof entry !== "string" || !canonicalPoolKeyPattern.test(entry)) {
            throw new PoolCreationProvenanceValidationError();
          }
          return canonicalPoolCreationPoolKey(entry);
        })(),
  );
  if (new Set(identities).size !== identities.length) {
    throw new PoolCreationProvenanceValidationError();
  }
  return {
    identities,
    identityType,
    poolKeys: identities.map((identity) => canonicalPoolCreationPoolKey(identity)),
  };
}

export function parsePoolCreationHistoryQuery(value: unknown): {
  cursor: string | null;
  limit: number;
} {
  const input = recordValue(value);
  if (Object.keys(input).some((key) => key !== "cursor" && key !== "limit")) {
    throw new PoolCreationProvenanceValidationError();
  }
  const rawLimit = input.limit ?? "20";
  if (
    typeof rawLimit !== "string" ||
    !/^[1-9][0-9]{0,2}$/u.test(rawLimit) ||
    Number(rawLimit) > poolCreationProvenanceHistoryLimit
  ) {
    throw new PoolCreationProvenanceValidationError();
  }
  const cursor = input.cursor ?? null;
  if (
    cursor !== null &&
    (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(cursor))
  ) {
    throw new PoolCreationProvenanceValidationError();
  }
  return { cursor, limit: Number(rawLimit) };
}

export function poolCreationIdentityDigest(poolKeys: readonly string[]): `sha256:${string}` {
  const canonical = poolKeys.map((poolKey) => canonicalPoolCreationPoolKey(poolKey)).sort();
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export function publicPoolCreationAttribution(
  value: PoolCreationAttribution,
): PoolCreationAttribution {
  const profile: PoolCreationCreatorProfile | null = value.creatorProfile
    ? {
        avatarUrl: value.creatorProfile.avatarUrl,
        displayName: value.creatorProfile.displayName,
        telegramId: value.creatorProfile.telegramId,
      }
    : null;
  return {
    creatorProfile: profile,
    record: canonicalPoolCreationRecord(value.record),
    warning: value.warning === "ALREADY_EXISTS_NOT_PLATFORM_FIRST" ? value.warning : null,
  };
}
