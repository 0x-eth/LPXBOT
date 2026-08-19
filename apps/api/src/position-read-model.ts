import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  EvmAddress,
  PositionPlatformId,
  PositionQuarantineReason,
  QuarantinedPositionRead,
  WalletPosition,
  WalletPositionPage,
} from "@lpbot/api-contract";
import {
  PositionReadAdapterError,
  type PositionReadAdapter,
  type PositionReadResult,
  type PositionReadRpc,
  type PositionReadSnapshot,
} from "@lpbot/chain-adapters";
import {
  BSC_POSITION_READ_REGISTRY,
  validateBscPositionReadRegistry,
  type BscPositionReadRegistry,
} from "@lpbot/chain-registry";
import { keccak256, stringToHex, type Address, type Hex } from "viem";

export const ERC721_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const hashPattern = /^0x[0-9a-fA-F]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface PositionCursorPayload {
  address: Address;
  blockHash: Hex;
  blockNumber: string;
  blockTimestamp: string;
  chainId: 56;
  offset: number;
  platformId: PositionPlatformId | null;
  registryVersion: string;
  userId: string;
  version: 1;
  walletId: string;
}

export class PositionCursorError extends Error {
  readonly code = "POSITION_CURSOR_INVALID";

  constructor() {
    super("POSITION_CURSOR_INVALID");
    this.name = "PositionCursorError";
  }
}

export interface PositionReadScanInput {
  address: Address;
  chainId: 56;
  cursor: string | null;
  helperAddress: Address | null;
  limit: number;
  platformId: PositionPlatformId | null;
  userId: string;
  walletId: string;
}

export interface PositionReadApplication {
  scan(input: PositionReadScanInput): Promise<Readonly<WalletPositionPage>>;
}

export interface BscPositionReadServiceOptions {
  adapters: readonly PositionReadAdapter[];
  cursorSecret: string | Uint8Array;
  maxLogBlockSpan?: number;
  registry?: BscPositionReadRegistry;
  rpc: PositionReadRpc;
}

function lowerAddress(value: string): Address {
  if (!addressPattern.test(value)) throw new PositionCursorError();
  return value.toLowerCase() as Address;
}

function topicAddress(value: Address): Hex {
  return `0x${value.slice(2).padStart(64, "0")}` as Hex;
}

function tokenIdFromTopic(value: unknown): string | null {
  if (typeof value !== "string" || !hashPattern.test(value)) return null;
  return BigInt(value).toString();
}

function freezePosition(value: PositionReadResult): WalletPosition {
  const result: WalletPosition = {
    approval: Object.freeze({ ...value.approval }),
    chainId: value.chainId,
    fees: Object.freeze({ ...value.fees }),
    liquidity: Object.freeze({ ...value.liquidity }),
    owner: value.owner,
    platformId: value.platformId,
    pool: Object.freeze({ ...value.pool }),
    snapshot: Object.freeze({ ...value.snapshot }),
    ticks: Object.freeze({ ...value.ticks }),
    tokenId: value.tokenId,
  };
  return Object.freeze(result);
}

function validPositionResult(
  value: PositionReadResult,
  adapter: PositionReadAdapter,
  owner: Address,
  snapshot: PositionReadSnapshot,
  tokenId: string,
): boolean {
  const deployment = adapter.deployment;
  const poolIdentityValid =
    deployment.generation === "v3"
      ? value.pool.poolAddress !== null && value.pool.poolId === null
      : value.pool.poolAddress === null && value.pool.poolId !== null;
  const spacing = decimalPattern.test(value.pool.tickSpacing.replace(/^-/, ""))
    ? BigInt(value.pool.tickSpacing)
    : 0n;
  const lower = /^-?(?:0|[1-9][0-9]*)$/u.test(value.ticks.lower) ? BigInt(value.ticks.lower) : 0n;
  const upper = /^-?(?:0|[1-9][0-9]*)$/u.test(value.ticks.upper) ? BigInt(value.ticks.upper) : 0n;
  return (
    value.chainId === 56 &&
    value.platformId === deployment.platformId &&
    value.owner.toLowerCase() === owner &&
    value.approval.nftOwner.toLowerCase() === owner &&
    value.tokenId === tokenId &&
    poolIdentityValid &&
    spacing !== 0n &&
    lower < upper &&
    lower % spacing === 0n &&
    upper % spacing === 0n &&
    value.snapshot.blockNumber === snapshot.blockNumber &&
    value.snapshot.blockHash.toLowerCase() === snapshot.blockHash.toLowerCase() &&
    value.snapshot.positionManager.toLowerCase() ===
      deployment.positionManager.address.toLowerCase() &&
    value.snapshot.positionManagerCodeHash.toLowerCase() ===
      deployment.positionManager.runtimeCodeHash.toLowerCase() &&
    value.snapshot.registryVersion === deployment.registryVersion &&
    hashPattern.test(value.snapshot.digest)
  );
}

function quarantineReason(error: unknown): PositionQuarantineReason {
  const reason =
    typeof error === "object" && error !== null && "reason" in error
      ? (error as { reason?: unknown }).reason
      : null;
  if (reason === "position-manager-code-hash-mismatch") return reason;
  if (reason === "owner-mismatch") return reason;
  if (reason === "abi-decode-failed") return reason;
  return "provider-read-failed";
}

function sortPositions(left: WalletPosition, right: WalletPosition): number {
  if (left.platformId !== right.platformId) return left.platformId - right.platformId;
  const leftToken = BigInt(left.tokenId);
  const rightToken = BigInt(right.tokenId);
  return leftToken < rightToken ? -1 : leftToken > rightToken ? 1 : 0;
}

function freezePage(page: WalletPositionPage): Readonly<WalletPositionPage> {
  for (const item of page.quarantined) Object.freeze(item);
  Object.freeze(page.coverage.failedPlatformIds);
  Object.freeze(page.coverage.scannedPlatformIds);
  Object.freeze(page.coverage);
  Object.freeze(page.items);
  Object.freeze(page.quarantined);
  Object.freeze(page.snapshot);
  return Object.freeze(page);
}

export class BscPositionReadService implements PositionReadApplication {
  readonly #adapters: ReadonlyMap<PositionPlatformId, PositionReadAdapter>;
  readonly #cursorSecret: Uint8Array;
  readonly #maxLogBlockSpan: bigint;
  readonly #registry: BscPositionReadRegistry;
  readonly #rpc: PositionReadRpc;

  constructor(options: BscPositionReadServiceOptions) {
    this.#registry = options.registry ?? BSC_POSITION_READ_REGISTRY;
    validateBscPositionReadRegistry(this.#registry);
    const cursorSecret =
      typeof options.cursorSecret === "string"
        ? new TextEncoder().encode(options.cursorSecret)
        : new Uint8Array(options.cursorSecret);
    if (cursorSecret.byteLength < 32) throw new RangeError("POSITION_CURSOR_SECRET_TOO_SHORT");
    const maxLogBlockSpan = options.maxLogBlockSpan ?? 5_000;
    if (!Number.isSafeInteger(maxLogBlockSpan) || maxLogBlockSpan < 1) {
      throw new RangeError("POSITION_LOG_BLOCK_SPAN_INVALID");
    }
    const adapters = new Map<PositionPlatformId, PositionReadAdapter>();
    for (const adapter of options.adapters) {
      const registered = this.#registry.deployments.find(
        ({ platformId }) => platformId === adapter.deployment.platformId,
      );
      if (
        !registered ||
        registered.positionManager.address.toLowerCase() !==
          adapter.deployment.positionManager.address.toLowerCase() ||
        adapters.has(adapter.deployment.platformId)
      ) {
        throw new RangeError("POSITION_ADAPTER_REGISTRY_MISMATCH");
      }
      adapters.set(adapter.deployment.platformId, adapter);
    }
    this.#adapters = adapters;
    this.#cursorSecret = cursorSecret;
    this.#maxLogBlockSpan = BigInt(maxLogBlockSpan);
    this.#rpc = options.rpc;
  }

  async scan(input: PositionReadScanInput): Promise<Readonly<WalletPositionPage>> {
    const normalized = this.#validateInput(input);
    const cursor = normalized.cursor ? this.#decodeCursor(normalized.cursor) : null;
    if (cursor && !this.#cursorMatches(cursor, normalized)) throw new PositionCursorError();

    const requestedSnapshot = cursor
      ? {
          blockHash: cursor.blockHash,
          blockNumber: cursor.blockNumber,
          blockTimestamp: cursor.blockTimestamp,
        }
      : null;
    const observedSnapshot = await this.#rpc.getBlock(cursor ? cursor.blockNumber : "latest");
    if (
      requestedSnapshot &&
      observedSnapshot.blockHash.toLowerCase() !== requestedSnapshot.blockHash.toLowerCase()
    ) {
      return this.#stalePage(normalized, requestedSnapshot);
    }
    const snapshot = requestedSnapshot ?? observedSnapshot;
    const selected = [...this.#adapters.values()]
      .filter((adapter) =>
        normalized.platformId === null
          ? true
          : adapter.deployment.platformId === normalized.platformId,
      )
      .sort((left, right) => left.deployment.platformId - right.deployment.platformId);
    const items: WalletPosition[] = [];
    const quarantined: QuarantinedPositionRead[] = [];
    const failed = new Set<PositionPlatformId>();
    const scanned = new Set<PositionPlatformId>();

    for (const adapter of selected) {
      const platformId = adapter.deployment.platformId;
      let tokenIds: readonly string[];
      try {
        tokenIds = await this.#discover(adapter, normalized.address, snapshot, quarantined);
        scanned.add(platformId);
      } catch {
        failed.add(platformId);
        quarantined.push({
          managerAddress: adapter.deployment.positionManager.address,
          platformId,
          reason: "provider-read-failed",
          tokenId: null,
        });
        continue;
      }
      for (const tokenId of tokenIds) {
        try {
          const value = await adapter.readPosition({
            helperAddress: normalized.helperAddress,
            owner: normalized.address,
            snapshot,
            tokenId,
          });
          if (!validPositionResult(value, adapter, normalized.address, snapshot, tokenId)) {
            throw new PositionReadAdapterError("abi-decode-failed");
          }
          items.push(freezePosition(value));
        } catch (error) {
          failed.add(platformId);
          quarantined.push({
            managerAddress: adapter.deployment.positionManager.address,
            platformId,
            reason: quarantineReason(error),
            tokenId,
          });
        }
      }
    }

    const canonical = await this.#rpc.getBlock(snapshot.blockNumber);
    if (canonical.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase()) {
      return this.#stalePage(normalized, snapshot);
    }
    items.sort(sortPositions);
    const offset = cursor?.offset ?? 0;
    if (offset > items.length) throw new PositionCursorError();
    const pageItems = items.slice(offset, offset + normalized.limit);
    const nextOffset = offset + pageItems.length;
    const pageCursor =
      nextOffset < items.length
        ? this.#encodeCursor({
            address: normalized.address,
            blockHash: snapshot.blockHash,
            blockNumber: snapshot.blockNumber,
            blockTimestamp: snapshot.blockTimestamp,
            chainId: 56,
            offset: nextOffset,
            platformId: normalized.platformId,
            registryVersion: this.#registry.registryVersion,
            userId: normalized.userId,
            version: 1,
            walletId: normalized.walletId,
          })
        : null;
    const failedPlatformIds = [...failed].sort((left, right) => left - right);
    const scannedPlatformIds = [...scanned].sort((left, right) => left - right);
    const status =
      items.length === 0
        ? quarantined.length > 0
          ? "quarantined"
          : "empty"
        : failedPlatformIds.length > 0 || quarantined.length > 0
          ? "partial"
          : "ready";
    const snapshotDigest = this.#snapshotDigest(normalized, snapshot);
    return freezePage({
      address: normalized.address,
      chainId: 56,
      coverage: {
        complete: failedPlatformIds.length === 0,
        failedPlatformIds,
        scannedPlatformIds,
      },
      cursor: pageCursor,
      items: pageItems,
      quarantined,
      registryVersion: this.#registry.registryVersion,
      snapshot: { ...snapshot, digest: snapshotDigest },
      status,
      walletId: normalized.walletId,
    });
  }

  async #discover(
    adapter: PositionReadAdapter,
    owner: Address,
    snapshot: PositionReadSnapshot,
    quarantined: QuarantinedPositionRead[],
  ): Promise<readonly string[]> {
    const deployment = adapter.deployment;
    const snapshotBlock = BigInt(snapshot.blockNumber);
    const validFrom = BigInt(deployment.validFromBlock);
    if (snapshotBlock < validFrom) return [];
    const tokenIds = new Set<string>();
    for (let from = validFrom; from <= snapshotBlock; from += this.#maxLogBlockSpan) {
      const to = from + this.#maxLogBlockSpan - 1n;
      const logs = await this.#rpc.getLogs({
        address: deployment.positionManager.address,
        fromBlock: from.toString(),
        toBlock: (to < snapshotBlock ? to : snapshotBlock).toString(),
        topics: [ERC721_TRANSFER_TOPIC, null, topicAddress(owner)],
      });
      for (const log of logs) {
        const tokenId = tokenIdFromTopic(log.topics[3]);
        if (log.address.toLowerCase() !== deployment.positionManager.address.toLowerCase()) {
          quarantined.push({
            managerAddress: lowerAddress(log.address),
            platformId: deployment.platformId,
            reason: "unknown-position-manager",
            tokenId,
          });
          continue;
        }
        if (
          log.topics.length !== 4 ||
          log.topics[0]?.toLowerCase() !== ERC721_TRANSFER_TOPIC ||
          log.topics[2]?.toLowerCase() !== topicAddress(owner) ||
          tokenId === null ||
          log.data !== "0x"
        ) {
          quarantined.push({
            managerAddress: deployment.positionManager.address,
            platformId: deployment.platformId,
            reason: "invalid-transfer-log",
            tokenId,
          });
          continue;
        }
        tokenIds.add(tokenId);
      }
    }
    return [...tokenIds].sort((left, right) => {
      const a = BigInt(left);
      const b = BigInt(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  #validateInput(input: PositionReadScanInput): PositionReadScanInput {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.platformId !== null && !([1, 2, 4, 5] as const).includes(input.platformId)) ||
      (input.cursor !== null && (typeof input.cursor !== "string" || input.cursor.length > 2_048))
    ) {
      throw new PositionCursorError();
    }
    return {
      ...input,
      address: lowerAddress(input.address),
      helperAddress: input.helperAddress ? lowerAddress(input.helperAddress) : null,
      userId: input.userId.toLowerCase(),
      walletId: input.walletId.toLowerCase(),
    };
  }

  #cursorMatches(cursor: PositionCursorPayload, input: PositionReadScanInput): boolean {
    return (
      cursor.version === 1 &&
      cursor.userId === input.userId &&
      cursor.walletId === input.walletId &&
      cursor.address === input.address &&
      cursor.chainId === input.chainId &&
      cursor.platformId === input.platformId &&
      cursor.registryVersion === this.#registry.registryVersion
    );
  }

  #encodeCursor(payload: PositionCursorPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.#cursorSecret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  #decodeCursor(value: string): PositionCursorPayload {
    const parts = value.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new PositionCursorError();
    const expected = createHmac("sha256", this.#cursorSecret).update(parts[0]).digest();
    let received: Buffer;
    try {
      received = Buffer.from(parts[1], "base64url");
    } catch {
      throw new PositionCursorError();
    }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new PositionCursorError();
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch {
      throw new PositionCursorError();
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !==
        "address,blockHash,blockNumber,blockTimestamp,chainId,offset,platformId,registryVersion,userId,version,walletId" ||
      (payload as Record<string, unknown>).version !== 1 ||
      (payload as Record<string, unknown>).chainId !== 56 ||
      typeof (payload as Record<string, unknown>).offset !== "number" ||
      !Number.isSafeInteger((payload as Record<string, unknown>).offset) ||
      Number((payload as Record<string, unknown>).offset) < 1 ||
      typeof (payload as Record<string, unknown>).blockNumber !== "string" ||
      !decimalPattern.test(String((payload as Record<string, unknown>).blockNumber)) ||
      typeof (payload as Record<string, unknown>).blockHash !== "string" ||
      !hashPattern.test(String((payload as Record<string, unknown>).blockHash)) ||
      typeof (payload as Record<string, unknown>).blockTimestamp !== "string" ||
      !Number.isFinite(Date.parse(String((payload as Record<string, unknown>).blockTimestamp)))
    ) {
      throw new PositionCursorError();
    }
    return payload as PositionCursorPayload;
  }

  #snapshotDigest(input: PositionReadScanInput, snapshot: PositionReadSnapshot): Hex {
    return keccak256(
      stringToHex(
        JSON.stringify({
          address: input.address,
          blockHash: snapshot.blockHash,
          blockNumber: snapshot.blockNumber,
          chainId: 56,
          registryVersion: this.#registry.registryVersion,
          userId: input.userId,
          walletId: input.walletId,
        }),
      ),
    );
  }

  #stalePage(
    input: PositionReadScanInput,
    snapshot: PositionReadSnapshot,
  ): Readonly<WalletPositionPage> {
    return freezePage({
      address: input.address as EvmAddress,
      chainId: 56,
      coverage: { complete: false, failedPlatformIds: [], scannedPlatformIds: [] },
      cursor: null,
      items: [],
      quarantined: [],
      registryVersion: this.#registry.registryVersion,
      snapshot: { ...snapshot, digest: this.#snapshotDigest(input, snapshot) },
      status: "stale",
      walletId: input.walletId,
    });
  }
}
