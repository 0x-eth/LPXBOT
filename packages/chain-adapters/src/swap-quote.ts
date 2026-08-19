import { createHash } from "node:crypto";

import {
  BSC_SWAP_QUOTE_REGISTRY,
  type BscSwapQuoteRegistry,
  type ProtocolId,
} from "@lpbot/chain-registry";
import type { Address, Hex } from "viem";

const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const selectorPattern = /^0x[0-9a-f]{8}$/u;
const positiveDecimalPattern = /^[1-9][0-9]*$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const platformIds = new Set<ProtocolId>([1, 2, 4, 5]);

export interface SwapQuoteInput {
  amountInBaseUnit: string;
  chainId: number;
  platformId: number;
  slippageBps: number;
  tokenIn: Address;
  tokenOut: Address;
  walletAddress: Address;
  walletId: string;
}

export interface SwapQuoteProviderSnapshot {
  amountOutBaseUnit: string;
  blockNumber: string;
  calldataDigest: Hex;
  gasLimit: string;
  gasPriceWei: string;
  poolPath: Hex[];
  priceImpactBps: number;
  providerSnapshotId: string;
  quotedAt: string;
  registryVersion: string;
  responseBytes: number;
  routeTokens: Address[];
  router: Address;
  routerRuntimeCodeHash: Hex;
  selector: Hex;
  sourceExpiresAt: string;
  spender: Address;
}

export interface SwapQuoteProvider {
  quote(input: SwapQuoteInput, signal: AbortSignal): Promise<SwapQuoteProviderSnapshot>;
}

export interface SwapQuote {
  amountInBaseUnit: string;
  amountOutBaseUnit: string;
  blockNumber: string;
  calldataDigest: Hex;
  chainId: 56;
  deadline: string;
  digest: Hex;
  digestDomain: "LPXBOT_SWAP_QUOTE";
  digestVersion: 1;
  executionEnabled: false;
  expiresAt: string;
  gas: {
    estimatedFeeWei: string;
    gasLimit: string;
    gasPriceWei: string;
  };
  maxBlockNumber: string;
  minOutBaseUnit: string;
  platformId: ProtocolId;
  priceImpactBps: number;
  providerSnapshotId: string;
  quotedAt: string;
  registryVersion: string;
  route: {
    poolPath: Hex[];
    tokens: Address[];
  };
  router: Address;
  selector: Hex;
  slippageBps: number;
  spender: Address;
  tokenIn: Address;
  tokenOut: Address;
  walletAddress: Address;
  walletId: string;
}

export type SwapQuoteAdapterFailureReason =
  | "invalid-input"
  | "malformed-provider-response"
  | "provider-response-too-large"
  | "provider-snapshot-expired"
  | "provider-timeout"
  | "provider-unavailable"
  | "registry-code-hash-mismatch"
  | "registry-mismatch";

export class SwapQuoteAdapterError extends Error {
  readonly reason: SwapQuoteAdapterFailureReason;

  constructor(reason: SwapQuoteAdapterFailureReason) {
    super(`SWAP_QUOTE_${reason.replaceAll("-", "_").toUpperCase()}`);
    this.name = "SwapQuoteAdapterError";
    this.reason = reason;
  }
}

export interface BscSwapQuoteAdapterOptions {
  now?: () => Date;
  provider: SwapQuoteProvider;
  readRuntimeCodeHash(input: {
    address: Address;
    blockNumber: string;
    expectedRuntimeCodeHash: Hex;
  }): Promise<Hex>;
  registry?: BscSwapQuoteRegistry;
  timeoutMs?: number;
}

function plusMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function isCanonicalAddress(value: unknown): value is Address {
  return typeof value === "string" && addressPattern.test(value);
}

function isHash(value: unknown): value is Hex {
  return typeof value === "string" && hashPattern.test(value);
}

function isPositiveDecimal(value: unknown): value is string {
  return typeof value === "string" && positiveDecimalPattern.test(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function quotePayload(quote: Omit<SwapQuote, "digest"> | SwapQuote): Record<string, unknown> {
  return {
    amountInBaseUnit: quote.amountInBaseUnit,
    amountOutBaseUnit: quote.amountOutBaseUnit,
    blockNumber: quote.blockNumber,
    calldataDigest: quote.calldataDigest,
    chainId: quote.chainId,
    deadline: quote.deadline,
    digestDomain: quote.digestDomain,
    digestVersion: quote.digestVersion,
    executionEnabled: quote.executionEnabled,
    expiresAt: quote.expiresAt,
    gas: {
      estimatedFeeWei: quote.gas.estimatedFeeWei,
      gasLimit: quote.gas.gasLimit,
      gasPriceWei: quote.gas.gasPriceWei,
    },
    maxBlockNumber: quote.maxBlockNumber,
    minOutBaseUnit: quote.minOutBaseUnit,
    platformId: quote.platformId,
    priceImpactBps: quote.priceImpactBps,
    providerSnapshotId: quote.providerSnapshotId,
    quotedAt: quote.quotedAt,
    registryVersion: quote.registryVersion,
    route: { poolPath: [...quote.route.poolPath], tokens: [...quote.route.tokens] },
    router: quote.router,
    selector: quote.selector,
    slippageBps: quote.slippageBps,
    spender: quote.spender,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    walletAddress: quote.walletAddress,
    walletId: quote.walletId,
  };
}

export function computeSwapQuoteDigest(quote: Omit<SwapQuote, "digest"> | SwapQuote): Hex {
  return `0x${createHash("sha256")
    .update("LPXBOT_SWAP_QUOTE\u0000v1\u0000", "utf8")
    .update(JSON.stringify(quotePayload(quote)), "utf8")
    .digest("hex")}`;
}

export function verifySwapQuoteDigest(quote: SwapQuote): boolean {
  return hashPattern.test(quote.digest) && computeSwapQuoteDigest(quote) === quote.digest;
}

export function isSwapQuoteCurrent(
  quote: Pick<SwapQuote, "deadline" | "expiresAt" | "maxBlockNumber">,
  input: { blockNumber: string; now: Date },
): boolean {
  if (!isPositiveDecimal(input.blockNumber) || !isPositiveDecimal(quote.maxBlockNumber)) {
    return false;
  }
  const now = input.now.getTime();
  return (
    Number.isFinite(now) &&
    now < Date.parse(quote.expiresAt) &&
    now < Date.parse(quote.deadline) &&
    BigInt(input.blockNumber) <= BigInt(quote.maxBlockNumber)
  );
}

function freezeQuote(quote: SwapQuote): Readonly<SwapQuote> {
  Object.freeze(quote.gas);
  Object.freeze(quote.route.poolPath);
  Object.freeze(quote.route.tokens);
  Object.freeze(quote.route);
  return Object.freeze(quote);
}

export class BscSwapQuoteAdapter {
  readonly #now: () => Date;
  readonly #provider: SwapQuoteProvider;
  readonly #readRuntimeCodeHash: BscSwapQuoteAdapterOptions["readRuntimeCodeHash"];
  readonly #registry: BscSwapQuoteRegistry;
  readonly #timeoutMs: number;

  constructor(options: BscSwapQuoteAdapterOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#provider = options.provider;
    this.#readRuntimeCodeHash = options.readRuntimeCodeHash;
    this.#registry = options.registry ?? BSC_SWAP_QUOTE_REGISTRY;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
    if (
      this.#registry.executionEnabled !== false ||
      this.#registry.executionRouterSelectorAllowlist.length !== 0 ||
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1
    ) {
      throw new SwapQuoteAdapterError("registry-mismatch");
    }
  }

  async quote(input: SwapQuoteInput): Promise<Readonly<SwapQuote>> {
    const normalized = this.#validateInput(input);
    const route = this.#registry.routes.find(
      (candidate) => candidate.platformId === normalized.platformId,
    );
    if (!route) throw new SwapQuoteAdapterError("registry-mismatch");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("SWAP_QUOTE_PROVIDER_TIMEOUT"));
    }, this.#timeoutMs);
    let snapshot: SwapQuoteProviderSnapshot;
    try {
      snapshot = await Promise.race([
        this.#provider.quote(normalized, controller.signal),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
            once: true,
          });
        }),
      ]);
    } catch {
      throw new SwapQuoteAdapterError(timedOut ? "provider-timeout" : "provider-unavailable");
    } finally {
      clearTimeout(timer);
    }
    this.#validateSnapshot(snapshot, normalized, route);
    const observedCodeHash = await this.#readRuntimeCodeHash({
      address: route.router.address,
      blockNumber: snapshot.blockNumber,
      expectedRuntimeCodeHash: route.router.runtimeCodeHash,
    });
    if (
      observedCodeHash.toLowerCase() !== route.router.runtimeCodeHash.toLowerCase() ||
      snapshot.routerRuntimeCodeHash.toLowerCase() !== route.router.runtimeCodeHash.toLowerCase()
    ) {
      throw new SwapQuoteAdapterError("registry-code-hash-mismatch");
    }
    const now = this.#now();
    const amountOut = BigInt(snapshot.amountOutBaseUnit);
    const minOut = (amountOut * BigInt(10_000 - normalized.slippageBps)) / 10_000n;
    const gasFee = BigInt(snapshot.gasLimit) * BigInt(snapshot.gasPriceWei);
    const unsigned: Omit<SwapQuote, "digest"> = {
      ...normalized,
      amountOutBaseUnit: snapshot.amountOutBaseUnit,
      blockNumber: snapshot.blockNumber,
      calldataDigest: snapshot.calldataDigest,
      chainId: 56,
      deadline: plusMilliseconds(now, 60_000),
      digestDomain: "LPXBOT_SWAP_QUOTE",
      digestVersion: 1,
      executionEnabled: false,
      expiresAt: plusMilliseconds(now, 30_000),
      gas: {
        estimatedFeeWei: gasFee.toString(),
        gasLimit: snapshot.gasLimit,
        gasPriceWei: snapshot.gasPriceWei,
      },
      maxBlockNumber: (BigInt(snapshot.blockNumber) + 5n).toString(),
      minOutBaseUnit: minOut.toString(),
      platformId: normalized.platformId,
      priceImpactBps: snapshot.priceImpactBps,
      providerSnapshotId: snapshot.providerSnapshotId,
      quotedAt: snapshot.quotedAt,
      registryVersion: snapshot.registryVersion,
      route: { poolPath: [...snapshot.poolPath], tokens: [...snapshot.routeTokens] },
      router: snapshot.router,
      selector: snapshot.selector,
      spender: snapshot.spender,
    };
    return freezeQuote({ ...unsigned, digest: computeSwapQuoteDigest(unsigned) });
  }

  #validateInput(input: SwapQuoteInput): SwapQuoteInput & { chainId: 56; platformId: ProtocolId } {
    if (
      input.chainId !== 56 ||
      !platformIds.has(input.platformId as ProtocolId) ||
      !positiveDecimalPattern.test(input.amountInBaseUnit) ||
      !Number.isSafeInteger(input.slippageBps) ||
      input.slippageBps < 0 ||
      input.slippageBps > 500 ||
      !uuidPattern.test(input.walletId) ||
      !isCanonicalAddress(input.walletAddress) ||
      !isCanonicalAddress(input.tokenIn) ||
      !isCanonicalAddress(input.tokenOut) ||
      input.tokenIn === input.tokenOut ||
      !this.#registry.tokens.some(({ address }) => address === input.tokenIn) ||
      !this.#registry.tokens.some(({ address }) => address === input.tokenOut)
    ) {
      throw new SwapQuoteAdapterError("invalid-input");
    }
    return { ...input, chainId: 56, platformId: input.platformId as ProtocolId };
  }

  #validateSnapshot(
    snapshot: SwapQuoteProviderSnapshot,
    input: SwapQuoteInput & { chainId: 56; platformId: ProtocolId },
    route: BscSwapQuoteRegistry["routes"][number],
  ): void {
    if (snapshot.responseBytes > 65_536) {
      throw new SwapQuoteAdapterError("provider-response-too-large");
    }
    const sourceExpiry = Date.parse(snapshot.sourceExpiresAt);
    if (!Number.isFinite(sourceExpiry) || sourceExpiry <= this.#now().getTime()) {
      throw new SwapQuoteAdapterError("provider-snapshot-expired");
    }
    if (
      snapshot.registryVersion !== this.#registry.registryVersion ||
      snapshot.router !== route.router.address ||
      snapshot.spender !== route.spender ||
      snapshot.selector !== route.selector
    ) {
      throw new SwapQuoteAdapterError("registry-mismatch");
    }
    if (
      !isPositiveDecimal(snapshot.amountOutBaseUnit) ||
      !isPositiveDecimal(snapshot.blockNumber) ||
      !isPositiveDecimal(snapshot.gasLimit) ||
      !isPositiveDecimal(snapshot.gasPriceWei) ||
      !Number.isSafeInteger(snapshot.priceImpactBps) ||
      snapshot.priceImpactBps < 0 ||
      snapshot.priceImpactBps > 10_000 ||
      !Number.isSafeInteger(snapshot.responseBytes) ||
      snapshot.responseBytes < 1 ||
      !uuidPattern.test(snapshot.providerSnapshotId) ||
      !validDate(snapshot.quotedAt) ||
      !isHash(snapshot.calldataDigest) ||
      !isHash(snapshot.routerRuntimeCodeHash) ||
      !isCanonicalAddress(snapshot.router) ||
      !isCanonicalAddress(snapshot.spender) ||
      !selectorPattern.test(snapshot.selector) ||
      snapshot.routeTokens.length < 2 ||
      snapshot.routeTokens[0] !== input.tokenIn ||
      snapshot.routeTokens.at(-1) !== input.tokenOut ||
      snapshot.routeTokens.some((token) => !isCanonicalAddress(token)) ||
      snapshot.poolPath.length === 0 ||
      snapshot.poolPath.some((pool) => !isHash(pool))
    ) {
      throw new SwapQuoteAdapterError("malformed-provider-response");
    }
  }
}

export class DeterministicSwapQuoteProvider implements SwapQuoteProvider {
  async quote(input: SwapQuoteInput, signal: AbortSignal): Promise<SwapQuoteProviderSnapshot> {
    signal.throwIfAborted();
    const route = BSC_SWAP_QUOTE_REGISTRY.routes.find(
      ({ platformId }) => platformId === input.platformId,
    );
    if (!route) throw new SwapQuoteAdapterError("invalid-input");
    const impact = 23 + route.platformId;
    const amountOut = (BigInt(input.amountInBaseUnit) * 2n * BigInt(10_000 - impact)) / 10_000n;
    const idSuffix = route.platformId.toString().padStart(12, "0");
    return {
      amountOutBaseUnit: amountOut.toString(),
      blockNumber: "116718500",
      calldataDigest: `0x${route.platformId.toString(16).padStart(2, "0").repeat(32)}`,
      gasLimit: (180_000 + route.platformId * 1_000).toString(),
      gasPriceWei: "3000000000",
      poolPath: [`0x${(80 + route.platformId).toString(16).repeat(64).slice(0, 64)}`],
      priceImpactBps: impact,
      providerSnapshotId: `68000000-0000-4000-8000-${idSuffix}`,
      quotedAt: "2026-08-19T06:00:00.000Z",
      registryVersion: BSC_SWAP_QUOTE_REGISTRY.registryVersion,
      responseBytes: 2_048,
      routeTokens: [input.tokenIn, input.tokenOut],
      router: route.router.address,
      routerRuntimeCodeHash: route.router.runtimeCodeHash,
      selector: route.selector,
      sourceExpiresAt: "2099-01-01T00:00:00.000Z",
      spender: route.spender,
    };
  }
}
