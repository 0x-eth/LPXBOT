import { createHash } from "node:crypto";

import {
  localSwapComponent,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  validateLocalSwapExecutionRegistry,
  type LocalSwapExecutionRegistry,
} from "@lpbot/chain-registry";
import { getAddress, type Address, type Hex } from "viem";

const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const positiveDecimalPattern = /^[1-9][0-9]*$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface LocalSwapQuoteHelperBinding {
  adapter: Address;
  address: Address;
  bindingId: string;
  helperVersion: "WalletHelperV1";
  owner: Address;
  permit2: Address;
  registryVersion: "p05-local-helper-deployment-v2";
  runtimeCodeHash: Hex;
  verifiedBlockNumber: string;
}

export interface LocalSwapQuoteInput {
  amountInBaseUnit: string;
  chainId: number;
  helper: LocalSwapQuoteHelperBinding;
  slippageBps: number;
  tokenIn: Address;
  tokenOut: Address;
  walletAddress: Address;
  walletId: string;
}

export interface LocalSwapQuoteSnapshot {
  amountOutBaseUnit: string;
  blockHash: Hex;
  blockNumber: string;
  blockTimestamp: string;
  componentCode: readonly { address: Address; role: "adapter" | "permit2" | "router"; runtimeCodeHash: Hex | null }[];
  gasLimit: string;
  helper: {
    adapter: Address;
    codeHash: Hex | null;
    owner: Address;
    permit2: Address;
  };
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  providerSnapshotId: string;
  tokenCode: readonly { address: Address; runtimeCodeHash: Hex | null }[];
}

export interface LocalSwapQuoteProvider {
  inspect(input: LocalSwapQuoteInput): Promise<LocalSwapQuoteSnapshot>;
}

export interface LocalSwapQuote {
  amountInBaseUnit: string;
  amountOutBaseUnit: string;
  blockHash: Hex;
  blockNumber: string;
  chainId: 31_337;
  deadline: string;
  digestDomain: "LPXBOT_LOCAL_SWAP_QUOTE";
  digestVersion: 2;
  executionEnabled: true;
  expiresAt: string;
  gas: {
    estimatedFeeBaseUnit: string;
    gasLimit: string;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
  };
  helper: LocalSwapQuoteHelperBinding;
  maxBlockNumber: string;
  minOutBaseUnit: string;
  providerSnapshotId: string;
  quoteDigest: `sha256:${string}`;
  quoteVersion: "p05-local-swap-quote-v2";
  quotedAt: string;
  registryDigest: `sha256:${string}`;
  registryVersion: "p05-local-swap-execution-v2";
  route: { adapter: Address; router: Address; selector: "0xbb05e388" };
  serviceFeeBps: 0;
  slippageBps: number;
  tokenIn: Address;
  tokenOut: Address;
  walletAddress: Address;
  walletId: string;
}

export type LocalSwapQuoteFailure =
  | "INVALID_INPUT"
  | "MALFORMED_SNAPSHOT"
  | "REGISTRY_MISMATCH"
  | "SNAPSHOT_EXPIRED";

export class LocalSwapQuoteError extends Error {
  constructor(readonly code: LocalSwapQuoteFailure) {
    super(`LOCAL_SWAP_QUOTE_${code}`);
    this.name = "LocalSwapQuoteError";
  }
}

function canonical(value: unknown, key?: string): unknown {
  if (key === "quoteDigest") return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entry]) => {
          const next = canonical(entry, entryKey);
          return next === undefined ? [] : [[entryKey, next]];
        }),
    );
  }
  return value;
}

export function localSwapQuoteDigest(
  quote: Omit<LocalSwapQuote, "quoteDigest"> | LocalSwapQuote,
): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("LPXBOT_LOCAL_SWAP_QUOTE\0v2\0", "utf8")
    .update(JSON.stringify(canonical(quote)), "utf8")
    .digest("hex")}`;
}

export function verifyLocalSwapQuoteDigest(quote: LocalSwapQuote): boolean {
  return localSwapQuoteDigest(quote) === quote.quoteDigest;
}

export function isLocalSwapQuoteCurrent(
  quote: Pick<LocalSwapQuote, "deadline" | "expiresAt" | "maxBlockNumber">,
  input: { blockNumber: string; now: Date },
): boolean {
  if (!decimalPattern.test(input.blockNumber) || !decimalPattern.test(quote.maxBlockNumber)) return false;
  return (
    Number.isFinite(input.now.getTime()) &&
    input.now.getTime() < Date.parse(quote.expiresAt) &&
    input.now.getTime() < Date.parse(quote.deadline) &&
    BigInt(input.blockNumber) <= BigInt(quote.maxBlockNumber)
  );
}

function address(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value).toLowerCase() as Address;
  } catch {
    return null;
  }
}

export class LocalSwapQuoteAdapter {
  readonly #now: () => Date;
  readonly #provider: LocalSwapQuoteProvider;
  readonly #registry: LocalSwapExecutionRegistry;

  constructor(input: {
    now?: () => Date;
    provider: LocalSwapQuoteProvider;
    registry?: LocalSwapExecutionRegistry;
  }) {
    this.#now = input.now ?? (() => new Date());
    this.#provider = input.provider;
    this.#registry = validateLocalSwapExecutionRegistry(
      input.registry ?? P05_LOCAL_SWAP_EXECUTION_REGISTRY,
    );
  }

  async quote(input: LocalSwapQuoteInput): Promise<Readonly<LocalSwapQuote>> {
    const walletAddress = address(input.walletAddress);
    const tokenIn = address(input.tokenIn);
    const tokenOut = address(input.tokenOut);
    const helperAddress = address(input.helper.address);
    const helperOwner = address(input.helper.owner);
    const helperAdapter = address(input.helper.adapter);
    const helperPermit2 = address(input.helper.permit2);
    const maxAmount = BigInt(this.#registry.maxAmountBaseUnit);
    if (
      input.chainId !== 31_337 ||
      !walletAddress ||
      !tokenIn ||
      !tokenOut ||
      !helperAddress ||
      !helperOwner ||
      !helperAdapter ||
      !helperPermit2 ||
      tokenIn === tokenOut ||
      !uuidPattern.test(input.walletId) ||
      !positiveDecimalPattern.test(input.amountInBaseUnit) ||
      BigInt(input.amountInBaseUnit) > maxAmount ||
      !Number.isSafeInteger(input.slippageBps) ||
      input.slippageBps < 1 ||
      input.slippageBps > 500 ||
      !this.#registry.tokens.some(({ address }) => address === tokenIn) ||
      !this.#registry.tokens.some(({ address }) => address === tokenOut) ||
      !uuidPattern.test(input.helper.bindingId) ||
      input.helper.helperVersion !== "WalletHelperV1" ||
      input.helper.registryVersion !== "p05-local-helper-deployment-v2" ||
      !hashPattern.test(input.helper.runtimeCodeHash) ||
      !decimalPattern.test(input.helper.verifiedBlockNumber) ||
      helperOwner !== walletAddress ||
      helperAdapter !== localSwapComponent("adapter", this.#registry).address ||
      helperPermit2 !== localSwapComponent("permit2", this.#registry).address
    ) {
      throw new LocalSwapQuoteError("INVALID_INPUT");
    }
    const helper: LocalSwapQuoteHelperBinding = {
      adapter: helperAdapter,
      address: helperAddress,
      bindingId: input.helper.bindingId.toLowerCase(),
      helperVersion: "WalletHelperV1",
      owner: helperOwner,
      permit2: helperPermit2,
      registryVersion: "p05-local-helper-deployment-v2",
      runtimeCodeHash: input.helper.runtimeCodeHash,
      verifiedBlockNumber: input.helper.verifiedBlockNumber,
    };
    const normalized = {
      ...input,
      chainId: 31_337,
      helper,
      tokenIn,
      tokenOut,
      walletAddress,
    } as const;
    const snapshot = await this.#provider.inspect(normalized);
    this.#validateSnapshot(snapshot, helper);
    const now = this.#now();
    const observedAt = new Date(snapshot.blockTimestamp);
    if (
      !Number.isFinite(observedAt.getTime()) ||
      observedAt.getTime() > now.getTime() + 5_000 ||
      now.getTime() - observedAt.getTime() > this.#registry.maxQuoteAgeSeconds * 1_000
    ) {
      throw new LocalSwapQuoteError("SNAPSHOT_EXPIRED");
    }
    const amountOut = BigInt(snapshot.amountOutBaseUnit);
    const minOut = (amountOut * BigInt(10_000 - input.slippageBps)) / 10_000n;
    if (minOut === 0n) throw new LocalSwapQuoteError("MALFORMED_SNAPSHOT");
    const expiresAt = new Date(now.getTime() + this.#registry.maxQuoteAgeSeconds * 1_000);
    const deadline = new Date(now.getTime() + 90_000);
    const gas = BigInt(snapshot.gasLimit);
    const maxFee = BigInt(snapshot.maxFeePerGasBaseUnit);
    const unsigned: Omit<LocalSwapQuote, "quoteDigest"> = {
      amountInBaseUnit: input.amountInBaseUnit,
      amountOutBaseUnit: snapshot.amountOutBaseUnit,
      blockHash: snapshot.blockHash,
      blockNumber: snapshot.blockNumber,
      chainId: 31_337,
      deadline: deadline.toISOString(),
      digestDomain: "LPXBOT_LOCAL_SWAP_QUOTE",
      digestVersion: 2,
      executionEnabled: true,
      expiresAt: expiresAt.toISOString(),
      gas: {
        estimatedFeeBaseUnit: (gas * maxFee).toString(),
        gasLimit: snapshot.gasLimit,
        maxFeePerGasBaseUnit: snapshot.maxFeePerGasBaseUnit,
        maxPriorityFeePerGasBaseUnit: snapshot.maxPriorityFeePerGasBaseUnit,
      },
      helper,
      maxBlockNumber: (BigInt(snapshot.blockNumber) + BigInt(this.#registry.maxBlockDrift)).toString(),
      minOutBaseUnit: minOut.toString(),
      providerSnapshotId: snapshot.providerSnapshotId,
      quoteVersion: this.#registry.quoteVersion,
      quotedAt: now.toISOString(),
      registryDigest: this.#registry.registryDigest,
      registryVersion: this.#registry.registryVersion,
      route: {
        adapter: localSwapComponent("adapter", this.#registry).address,
        router: localSwapComponent("router", this.#registry).address,
        selector: this.#registry.routerSelector,
      },
      serviceFeeBps: 0,
      slippageBps: input.slippageBps,
      tokenIn,
      tokenOut,
      walletAddress,
      walletId: input.walletId,
    };
    return Object.freeze({ ...unsigned, gas: Object.freeze(unsigned.gas), route: Object.freeze(unsigned.route), quoteDigest: localSwapQuoteDigest(unsigned) });
  }

  #validateSnapshot(
    snapshot: LocalSwapQuoteSnapshot,
    helper: LocalSwapQuoteHelperBinding,
  ): void {
    if (
      !positiveDecimalPattern.test(snapshot.amountOutBaseUnit) ||
      !decimalPattern.test(snapshot.blockNumber) ||
      !hashPattern.test(snapshot.blockHash) ||
      !positiveDecimalPattern.test(snapshot.gasLimit) ||
      !positiveDecimalPattern.test(snapshot.maxFeePerGasBaseUnit) ||
      !decimalPattern.test(snapshot.maxPriorityFeePerGasBaseUnit) ||
      BigInt(snapshot.maxPriorityFeePerGasBaseUnit) > BigInt(snapshot.maxFeePerGasBaseUnit) ||
      !uuidPattern.test(snapshot.providerSnapshotId) ||
      snapshot.helper.codeHash !== helper.runtimeCodeHash ||
      snapshot.helper.owner !== helper.owner ||
      snapshot.helper.adapter !== helper.adapter ||
      snapshot.helper.permit2 !== helper.permit2
    ) {
      throw new LocalSwapQuoteError("MALFORMED_SNAPSHOT");
    }
    for (const expected of this.#registry.components) {
      const actual = snapshot.componentCode.find(({ role }) => role === expected.role);
      if (!actual || actual.address !== expected.address || actual.runtimeCodeHash !== expected.runtimeCodeHash) {
        throw new LocalSwapQuoteError("REGISTRY_MISMATCH");
      }
    }
    for (const expected of this.#registry.tokens) {
      const actual = snapshot.tokenCode.find(({ address }) => address === expected.address);
      if (!actual || actual.runtimeCodeHash !== expected.runtimeCodeHash) {
        throw new LocalSwapQuoteError("REGISTRY_MISMATCH");
      }
    }
  }
}
