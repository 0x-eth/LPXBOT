import {
  BscSwapQuoteAdapter,
  DeterministicSwapQuoteProvider,
  SwapQuoteAdapterError,
  isSwapQuoteCurrent,
  verifySwapQuoteDigest,
  type SwapQuoteProvider,
  type SwapQuoteProviderSnapshot,
  type SwapQuote,
} from "../packages/chain-adapters/src/index.js";
import {
  BSC_SWAP_QUOTE_REGISTRY,
  P05_BSC_EXECUTION_REGISTRY_VERSION,
} from "../packages/chain-registry/src/index.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-19T06:00:00.000Z");
const walletId = "68000000-0000-4000-8000-000000000011";
const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const tokenIn = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" as const;
const tokenOut = "0x55d398326f99059ff775485246999027b3197955" as const;

function input(platformId: 1 | 2 | 4 | 5 = 1) {
  return {
    amountInBaseUnit: "1000000000000000001",
    chainId: 56 as const,
    platformId,
    slippageBps: 37,
    tokenIn,
    tokenOut,
    walletAddress,
    walletId,
  };
}

function adapter(provider: SwapQuoteProvider = new DeterministicSwapQuoteProvider()) {
  return new BscSwapQuoteAdapter({
    now: () => now,
    provider,
    readRuntimeCodeHash: async ({ expectedRuntimeCodeHash }) => expectedRuntimeCodeHash,
    timeoutMs: 100,
  });
}

describe("P05-03 controlled BSC swap quote adapter", () => {
  it("rejects non-canonical base units, equal tokens, slippage outside 0..500, and unknown tokens", async () => {
    const quoteAdapter = adapter();
    for (const invalid of [
      { ...input(), amountInBaseUnit: "0" },
      { ...input(), amountInBaseUnit: "1.1" },
      { ...input(), amountInBaseUnit: "01" },
      { ...input(), tokenOut: tokenIn },
      { ...input(), slippageBps: -1 },
      { ...input(), slippageBps: 501 },
      { ...input(), tokenOut: "0x9999999999999999999999999999999999999999" as const },
    ]) {
      await expect(quoteAdapter.quote(invalid)).rejects.toBeInstanceOf(SwapQuoteAdapterError);
    }

    await expect(quoteAdapter.quote({ ...input(), slippageBps: 0 })).resolves.toBeDefined();
    await expect(quoteAdapter.quote({ ...input(), slippageBps: 500 })).resolves.toBeDefined();
  });

  it("quotes all four platforms with server-resolved routes, integer minOut, impact, and gas", async () => {
    for (const platformId of [1, 2, 4, 5] as const) {
      const quote = await adapter().quote(input(platformId));
      expect(quote).toMatchObject({
        amountInBaseUnit: "1000000000000000001",
        chainId: 56,
        executionEnabled: false,
        platformId,
        priceImpactBps: 23 + platformId,
        registryVersion: P05_BSC_EXECUTION_REGISTRY_VERSION,
        slippageBps: 37,
        tokenIn,
        tokenOut,
        walletAddress,
        walletId,
      });
      expect(quote.route.tokens.at(0)).toBe(tokenIn);
      expect(quote.route.tokens.at(-1)).toBe(tokenOut);
      expect(quote.route.poolPath.length).toBeGreaterThan(0);
      expect(quote.gas.gasLimit).toMatch(/^[1-9][0-9]*$/u);
      expect(quote.gas.gasPriceWei).toMatch(/^[1-9][0-9]*$/u);
      expect(quote.gas.estimatedFeeWei).toBe(
        (BigInt(quote.gas.gasLimit) * BigInt(quote.gas.gasPriceWei)).toString(),
      );
      expect(quote.minOutBaseUnit).toBe(
        ((BigInt(quote.amountOutBaseUnit) * 9_963n) / 10_000n).toString(),
      );
      expect(quote).not.toHaveProperty("calldata");
      expect(quote).not.toHaveProperty("rawCalldata");
    }
    expect(BSC_SWAP_QUOTE_REGISTRY.executionRouterSelectorAllowlist).toEqual([]);
  });

  it("expires when expiresAt, deadline, or maxBlockNumber crosses its independent boundary", async () => {
    const quote = await adapter().quote(input());
    expect(isSwapQuoteCurrent(quote, { blockNumber: "116718500", now })).toBe(true);
    expect(
      isSwapQuoteCurrent(quote, {
        blockNumber: "116718500",
        now: new Date(quote.expiresAt),
      }),
    ).toBe(false);
    expect(
      isSwapQuoteCurrent(quote, {
        blockNumber: "116718500",
        now: new Date(quote.deadline),
      }),
    ).toBe(false);
    expect(
      isSwapQuoteCurrent(quote, {
        blockNumber: (BigInt(quote.maxBlockNumber) + 1n).toString(),
        now,
      }),
    ).toBe(false);
  });

  it("binds every returned quote field to LPXBOT_SWAP_QUOTE v1 digest", async () => {
    const quote = await adapter().quote(input(4));
    expect(quote.digestDomain).toBe("LPXBOT_SWAP_QUOTE");
    expect(quote.digestVersion).toBe(1);
    expect(verifySwapQuoteDigest(quote)).toBe(true);

    const mutations = [
      { amountInBaseUnit: "2" },
      { amountOutBaseUnit: "2" },
      { blockNumber: "116718499" },
      { minOutBaseUnit: "2" },
      { priceImpactBps: quote.priceImpactBps + 1 },
      { expiresAt: "2026-08-19T06:00:31.000Z" },
      { deadline: "2026-08-19T06:01:01.000Z" },
      { maxBlockNumber: "116718506" },
      { registryVersion: "tampered" },
      { router: "0x2222222222222222222222222222222222222222" },
      { spender: "0x2222222222222222222222222222222222222222" },
      { selector: "0x12345678" },
      { calldataDigest: `0x${"11".repeat(32)}` },
      { route: { ...quote.route, poolPath: [...quote.route.poolPath, `0x${"22".repeat(32)}`] } },
      { gas: { ...quote.gas, gasLimit: (BigInt(quote.gas.gasLimit) + 1n).toString() } },
    ];
    for (const mutation of mutations) {
      expect(verifySwapQuoteDigest({ ...quote, ...mutation } as SwapQuote)).toBe(false);
    }
  });

  it("fails closed for Registry/code hash mismatch, timeout, malformed, oversized, and stale provider snapshots", async () => {
    const baselineProvider = new DeterministicSwapQuoteProvider();
    const baseline = await baselineProvider.quote(input(), AbortSignal.timeout(100));
    const providers: SwapQuoteProvider[] = [
      {
        quote: async () => ({ ...baseline, registryVersion: "untrusted-registry" }),
      },
      {
        quote: async () => ({ ...baseline, amountOutBaseUnit: "not-an-integer" }),
      },
      {
        quote: async () => ({ ...baseline, responseBytes: 65_537 }),
      },
      {
        quote: async () => ({
          ...baseline,
          sourceExpiresAt: "2026-08-19T05:59:59.999Z",
        }),
      },
      {
        quote: async (_request, signal) =>
          await new Promise<SwapQuoteProviderSnapshot>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      },
    ];
    for (const provider of providers) {
      await expect(adapter(provider).quote(input())).rejects.toBeInstanceOf(SwapQuoteAdapterError);
    }
    await expect(
      new BscSwapQuoteAdapter({
        now: () => now,
        provider: baselineProvider,
        readRuntimeCodeHash: async () => `0x${"ff".repeat(32)}`,
        timeoutMs: 100,
      }).quote(input()),
    ).rejects.toMatchObject({ reason: "registry-code-hash-mismatch" });
  });
});
