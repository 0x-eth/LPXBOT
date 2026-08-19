import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { HelperResidualAsset, HelperResidualPage } from "@lpbot/api-contract";
import type { PositionReadRpc, PositionReadSnapshot } from "@lpbot/chain-adapters";
import {
  BSC_HELPER_RESIDUAL_ALLOWLIST,
  type BscHelperResidualAllowlist,
} from "@lpbot/chain-registry";
import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import type { WalletHelperReadStore } from "./helper-read-model.js";

export const ERC20_RESIDUAL_READ_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "amount", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const ERC721_RESIDUAL_READ_ABI = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ name: "owner", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface HelperKnownNft {
  managerAddress: Address;
  tokenId: string;
}

export interface HelperPositionInventory {
  complete: boolean;
  knownNfts: readonly HelperKnownNft[];
  tokenAddresses: readonly Address[];
}

export interface HelperWalletTokenInventory {
  complete: boolean;
  tokenAddresses: readonly Address[];
}

export interface HelperPositionInventorySource {
  list(input: { chainId: 56; userId: string; walletId: string }): Promise<HelperPositionInventory>;
}

export interface HelperWalletTokenSource {
  list(input: {
    chainId: 56;
    userId: string;
    walletId: string;
  }): Promise<HelperWalletTokenInventory>;
}

export interface HelperResidualScanInput {
  chainId: 56;
  idempotencyKey: string;
  userId: string;
  walletId: string;
}

export interface HelperResidualListInput {
  chainId: 56;
  cursor: string | null;
  limit: number;
  userId: string;
  walletId: string;
}

export interface WalletHelperResidualApplication {
  latest(input: HelperResidualListInput): Promise<Readonly<HelperResidualPage> | null>;
  scan(input: HelperResidualScanInput): Promise<Readonly<HelperResidualPage>>;
}

export interface WalletHelperResidualServiceOptions {
  allowlist?: BscHelperResidualAllowlist;
  cursorSecret: string | Uint8Array;
  now?: () => Date;
  positions: HelperPositionInventorySource;
  rpc: PositionReadRpc;
  store: WalletHelperReadStore;
  walletTokens: HelperWalletTokenSource;
}

interface ResidualCursorPayload {
  chainId: 56;
  helperAddress: Address;
  offset: number;
  scanId: string;
  snapshotDigest: Hex;
  userId: string;
  version: 1;
  walletId: string;
}

export type HelperResidualReadErrorCode = "HELPER_RESIDUAL_INPUT_INVALID" | "HELPER_UNDEPLOYED";

export class HelperResidualReadError extends Error {
  readonly code: HelperResidualReadErrorCode;

  constructor(code: HelperResidualReadErrorCode) {
    super(code);
    this.name = "HelperResidualReadError";
    this.code = code;
  }
}

export class HelperResidualCursorError extends Error {
  readonly code = "HELPER_RESIDUAL_CURSOR_INVALID";

  constructor() {
    super("HELPER_RESIDUAL_CURSOR_INVALID");
    this.name = "HelperResidualCursorError";
  }
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const idempotencyPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uniqueAddresses(values: readonly Address[]): { complete: boolean; values: Address[] } {
  const addresses = new Set<Address>();
  let complete = values.length <= 512;
  for (const value of values.slice(0, 512)) {
    const normalized = value.toLowerCase();
    if (!addressPattern.test(normalized)) {
      complete = false;
      continue;
    }
    addresses.add(normalized as Address);
  }
  return { complete, values: [...addresses].sort((left, right) => left.localeCompare(right)) };
}

function freezePage(page: HelperResidualPage): Readonly<HelperResidualPage> {
  for (const item of page.items) Object.freeze(item);
  Object.freeze(page.coverage.missingSources);
  Object.freeze(page.coverage);
  Object.freeze(page.items);
  Object.freeze(page.snapshot);
  return Object.freeze(page);
}

function itemRank(item: HelperResidualAsset): number {
  if (item.kind === "native") return 0;
  if (item.kind === "token") return 1;
  if (item.kind === "allowance") return 2;
  return 3;
}

function sortItems(left: HelperResidualAsset, right: HelperResidualAsset): number {
  const rank = itemRank(left) - itemRank(right);
  return rank === 0 ? left.assetId.localeCompare(right.assetId) : rank;
}

function residualDigest(input: {
  allowlistVersion: string;
  coverage: HelperResidualPage["coverage"];
  helperAddress: Address;
  items: readonly HelperResidualAsset[];
  scanId: string;
  snapshot: PositionReadSnapshot;
  userId: string;
  walletId: string;
}): Hex {
  return keccak256(stringToHex(JSON.stringify(input)));
}

export class WalletHelperResidualService implements WalletHelperResidualApplication {
  readonly #allowlist: BscHelperResidualAllowlist;
  readonly #cursorSecret: Uint8Array;
  readonly #inFlight = new Map<string, Promise<Readonly<HelperResidualPage>>>();
  readonly #now: () => Date;
  readonly #positions: HelperPositionInventorySource;
  readonly #rpc: PositionReadRpc;
  readonly #store: WalletHelperReadStore;
  readonly #walletTokens: HelperWalletTokenSource;

  constructor(options: WalletHelperResidualServiceOptions) {
    this.#allowlist = options.allowlist ?? BSC_HELPER_RESIDUAL_ALLOWLIST;
    const cursorSecret =
      typeof options.cursorSecret === "string"
        ? new TextEncoder().encode(options.cursorSecret)
        : new Uint8Array(options.cursorSecret);
    if (cursorSecret.byteLength < 32)
      throw new RangeError("HELPER_RESIDUAL_CURSOR_SECRET_TOO_SHORT");
    const allowlistAddresses = [
      ...this.#allowlist.tokenAddresses,
      ...this.#allowlist.spenderAddresses,
      ...this.#allowlist.nftManagerAddresses,
    ];
    if (
      this.#allowlist.chainId !== 56 ||
      this.#allowlist.registryVersion !== "p05-bsc-execution-v1" ||
      !/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u.test(this.#allowlist.version) ||
      allowlistAddresses.some(
        (value) => !addressPattern.test(value) || value !== value.toLowerCase(),
      ) ||
      this.#allowlist.tokenAddresses.length > 256 ||
      this.#allowlist.spenderAddresses.length > 64 ||
      this.#allowlist.nftManagerAddresses.length > 32
    ) {
      throw new RangeError("HELPER_RESIDUAL_ALLOWLIST_INVALID");
    }
    this.#cursorSecret = cursorSecret;
    this.#now = options.now ?? (() => new Date());
    this.#positions = options.positions;
    this.#rpc = options.rpc;
    this.#store = options.store;
    this.#walletTokens = options.walletTokens;
  }

  async scan(input: HelperResidualScanInput): Promise<Readonly<HelperResidualPage>> {
    this.#validateIdentity(input);
    if (!idempotencyPattern.test(input.idempotencyKey)) {
      throw new HelperResidualReadError("HELPER_RESIDUAL_INPUT_INVALID");
    }
    const existing = await this.#store.findResidualSnapshotByIdempotency(input);
    if (existing) return existing;
    const key = `${input.userId}:${input.walletId}:${String(input.chainId)}:${input.idempotencyKey}`;
    const current = this.#inFlight.get(key);
    if (current) return current;
    const pending = this.#performScan(input).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, pending);
    return pending;
  }

  async latest(input: HelperResidualListInput): Promise<Readonly<HelperResidualPage> | null> {
    this.#validateIdentity(input);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new HelperResidualCursorError();
    }
    const cursor = input.cursor ? this.#decodeCursor(input.cursor) : null;
    if (
      cursor &&
      (cursor.userId !== input.userId ||
        cursor.walletId !== input.walletId ||
        cursor.chainId !== input.chainId)
    ) {
      throw new HelperResidualCursorError();
    }
    const binding = await this.#store.findBinding(input);
    if (!binding) return null;
    const stored = await this.#store.latestResidualSnapshot({
      chainId: 56,
      helperAddress: binding.helperAddress,
      userId: input.userId,
      walletId: input.walletId,
    });
    if (!stored) return null;
    if (
      cursor &&
      (cursor.scanId !== stored.scanId ||
        cursor.helperAddress !== stored.helperAddress ||
        cursor.snapshotDigest !== stored.snapshot.digest)
    ) {
      throw new HelperResidualCursorError();
    }
    const offset = cursor?.offset ?? 0;
    if (offset > stored.items.length) throw new HelperResidualCursorError();
    const items = stored.items.slice(offset, offset + input.limit);
    const nextOffset = offset + items.length;
    const nextCursor =
      nextOffset < stored.items.length
        ? this.#encodeCursor({
            chainId: 56,
            helperAddress: stored.helperAddress,
            offset: nextOffset,
            scanId: stored.scanId,
            snapshotDigest: stored.snapshot.digest,
            userId: input.userId,
            version: 1,
            walletId: input.walletId,
          })
        : null;
    return freezePage({
      ...stored,
      coverage: { ...stored.coverage, missingSources: [...stored.coverage.missingSources] },
      cursor: nextCursor,
      items: [...items],
      snapshot: { ...stored.snapshot },
    });
  }

  async #performScan(input: HelperResidualScanInput): Promise<Readonly<HelperResidualPage>> {
    const binding = await this.#store.findBinding(input);
    if (!binding) throw new HelperResidualReadError("HELPER_UNDEPLOYED");
    const snapshot = await this.#rpc.getBlock("latest");
    const missing = new Set<string>();
    if (!this.#allowlist.coverageComplete) missing.add("allowlist");

    let positionInventory: HelperPositionInventory = {
      complete: false,
      knownNfts: [],
      tokenAddresses: [],
    };
    try {
      positionInventory = await this.#positions.list(input);
    } catch {
      missing.add("position-tokens");
    }
    let walletInventory: HelperWalletTokenInventory = { complete: false, tokenAddresses: [] };
    try {
      walletInventory = await this.#walletTokens.list(input);
    } catch {
      missing.add("wallet-token-registry");
    }
    if (!positionInventory.complete) missing.add("position-tokens");
    if (!walletInventory.complete) missing.add("wallet-token-registry");
    const positionTokens = uniqueAddresses(positionInventory.tokenAddresses);
    const walletTokens = uniqueAddresses(walletInventory.tokenAddresses);
    if (!positionTokens.complete) missing.add("position-tokens");
    if (!walletTokens.complete) missing.add("wallet-token-registry");
    const tokenAddresses = uniqueAddresses([
      ...this.#allowlist.tokenAddresses,
      ...positionTokens.values,
      ...walletTokens.values,
    ]).values;
    const items: HelperResidualAsset[] = [];

    try {
      const balance = await this.#rpc.getBalance(binding.helperAddress, snapshot.blockNumber);
      if (balance > 0n) {
        items.push({
          amountBaseUnit: balance.toString(),
          assetId: "native:56",
          chainId: 56,
          kind: "native",
          tokenAddress: null,
        });
      }
    } catch {
      missing.add("native-balance");
    }

    for (const tokenAddress of tokenAddresses) {
      try {
        const balance = await this.#readUint(
          ERC20_RESIDUAL_READ_ABI,
          tokenAddress,
          "balanceOf",
          [binding.helperAddress],
          snapshot.blockNumber,
        );
        if (balance > 0n) {
          items.push({
            amountBaseUnit: balance.toString(),
            assetId: `token:${tokenAddress}`,
            chainId: 56,
            kind: "token",
            tokenAddress,
          });
        }
      } catch {
        missing.add(`token:${tokenAddress}`);
      }
    }
    for (const tokenAddress of tokenAddresses) {
      for (const spenderAddress of this.#allowlist.spenderAddresses) {
        try {
          const allowance = await this.#readUint(
            ERC20_RESIDUAL_READ_ABI,
            tokenAddress,
            "allowance",
            [binding.helperAddress, spenderAddress],
            snapshot.blockNumber,
          );
          if (allowance > 0n) {
            items.push({
              amountBaseUnit: allowance.toString(),
              assetId: `allowance:${tokenAddress}:${spenderAddress}`,
              chainId: 56,
              kind: "allowance",
              spenderAddress,
              tokenAddress,
            });
          }
        } catch {
          missing.add(`allowance:${tokenAddress}:${spenderAddress}`);
        }
      }
    }

    const allowedManagers = new Set(this.#allowlist.nftManagerAddresses);
    const knownNfts = new Map<string, HelperKnownNft>();
    for (const nft of positionInventory.knownNfts.slice(0, 1_000)) {
      const managerAddress = nft.managerAddress.toLowerCase() as Address;
      if (
        !addressPattern.test(managerAddress) ||
        !decimalPattern.test(nft.tokenId) ||
        !allowedManagers.has(managerAddress)
      ) {
        missing.add("known-nft-custody");
        continue;
      }
      knownNfts.set(`${managerAddress}:${nft.tokenId}`, { managerAddress, tokenId: nft.tokenId });
    }
    if (positionInventory.knownNfts.length > 1_000) missing.add("known-nft-custody");
    for (const nft of [...knownNfts.values()].sort((left, right) =>
      `${left.managerAddress}:${left.tokenId}`.localeCompare(
        `${right.managerAddress}:${right.tokenId}`,
      ),
    )) {
      try {
        const owner = await this.#readAddress(
          ERC721_RESIDUAL_READ_ABI,
          nft.managerAddress,
          "ownerOf",
          [BigInt(nft.tokenId)],
          snapshot.blockNumber,
        );
        if (owner === binding.helperAddress) {
          items.push({
            amountBaseUnit: "1",
            assetId: `nft:${nft.managerAddress}:${nft.tokenId}`,
            chainId: 56,
            kind: "nft",
            managerAddress: nft.managerAddress,
            tokenAddress: null,
            tokenId: nft.tokenId,
          });
        }
      } catch {
        missing.add(`nft:${nft.managerAddress}:${nft.tokenId}`);
      }
    }

    try {
      const canonical = await this.#rpc.getBlock(snapshot.blockNumber);
      if (canonical.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase()) {
        missing.add("canonical-block");
        items.length = 0;
      }
    } catch {
      missing.add("canonical-block");
      items.length = 0;
    }
    items.sort(sortItems);
    const missingSources = [...missing].sort((left, right) => left.localeCompare(right));
    const coverage = {
      allowlistComplete: this.#allowlist.coverageComplete,
      complete: missingSources.length === 0,
      missingSources,
      positionTokensComplete:
        positionInventory.complete && positionTokens.complete && !missing.has("position-tokens"),
      walletTokenRegistryComplete:
        walletInventory.complete && walletTokens.complete && !missing.has("wallet-token-registry"),
    };
    const scanId = randomUUID();
    const scannedAt = this.#now().toISOString();
    const digest = residualDigest({
      allowlistVersion: this.#allowlist.version,
      coverage,
      helperAddress: binding.helperAddress,
      items,
      scanId,
      snapshot,
      userId: input.userId,
      walletId: input.walletId,
    });
    const page = freezePage({
      allowlistVersion: this.#allowlist.version,
      chainId: 56,
      coverage,
      cursor: null,
      helperAddress: binding.helperAddress,
      items,
      registryVersion: this.#allowlist.registryVersion,
      scanId,
      scannedAt,
      snapshot: { ...snapshot, digest },
      state: coverage.complete ? (items.length === 0 ? "empty" : "ready") : "partial",
      walletId: input.walletId,
    });
    return this.#store.appendResidualSnapshot({
      idempotencyKey: input.idempotencyKey,
      page,
      userId: input.userId,
    });
  }

  async #readUint(
    abi: typeof ERC20_RESIDUAL_READ_ABI,
    to: Address,
    functionName: "allowance" | "balanceOf",
    args: readonly unknown[],
    blockNumber: string,
  ): Promise<bigint> {
    const value = await this.#contractRead(abi, to, functionName, args, blockNumber);
    if (typeof value !== "bigint") throw new Error("HELPER_RESIDUAL_RESPONSE_INVALID");
    return value;
  }

  async #readAddress(
    abi: typeof ERC721_RESIDUAL_READ_ABI,
    to: Address,
    functionName: "ownerOf",
    args: readonly unknown[],
    blockNumber: string,
  ): Promise<Address> {
    const value = await this.#contractRead(abi, to, functionName, args, blockNumber);
    if (typeof value !== "string" || !addressPattern.test(value.toLowerCase())) {
      throw new Error("HELPER_RESIDUAL_RESPONSE_INVALID");
    }
    return value.toLowerCase() as Address;
  }

  async #contractRead(
    abi: typeof ERC20_RESIDUAL_READ_ABI | typeof ERC721_RESIDUAL_READ_ABI,
    to: Address,
    functionName: string,
    args: readonly unknown[],
    blockNumber: string,
  ): Promise<unknown> {
    const data = encodeFunctionData({ abi, args, functionName } as never);
    const result = await this.#rpc.call({ blockNumber, data, to });
    return decodeFunctionResult({ abi, data: result, functionName } as never) as unknown;
  }

  #validateIdentity(input: { chainId: 56; userId: string; walletId: string }): void {
    if (
      input.chainId !== 56 ||
      !uuidPattern.test(input.userId) ||
      !uuidPattern.test(input.walletId)
    ) {
      throw new HelperResidualReadError("HELPER_RESIDUAL_INPUT_INVALID");
    }
  }

  #encodeCursor(payload: ResidualCursorPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.#cursorSecret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  #decodeCursor(value: string): ResidualCursorPayload {
    const [payloadPart, signaturePart, extra] = value.split(".");
    if (!payloadPart || !signaturePart || extra !== undefined || value.length > 2_048) {
      throw new HelperResidualCursorError();
    }
    const expected = createHmac("sha256", this.#cursorSecret).update(payloadPart).digest();
    const received = Buffer.from(signaturePart, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new HelperResidualCursorError();
    }
    let valueObject: unknown;
    try {
      valueObject = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    } catch {
      throw new HelperResidualCursorError();
    }
    if (
      typeof valueObject !== "object" ||
      valueObject === null ||
      Array.isArray(valueObject) ||
      Object.keys(valueObject).sort().join(",") !==
        "chainId,helperAddress,offset,scanId,snapshotDigest,userId,version,walletId"
    ) {
      throw new HelperResidualCursorError();
    }
    const payload = valueObject as Partial<ResidualCursorPayload>;
    if (
      payload.version !== 1 ||
      payload.chainId !== 56 ||
      typeof payload.offset !== "number" ||
      !Number.isSafeInteger(payload.offset) ||
      payload.offset < 1 ||
      typeof payload.helperAddress !== "string" ||
      !addressPattern.test(payload.helperAddress) ||
      typeof payload.snapshotDigest !== "string" ||
      !hashPattern.test(payload.snapshotDigest) ||
      typeof payload.scanId !== "string" ||
      !uuidPattern.test(payload.scanId) ||
      typeof payload.userId !== "string" ||
      typeof payload.walletId !== "string"
    ) {
      throw new HelperResidualCursorError();
    }
    return payload as ResidualCursorPayload;
  }
}
