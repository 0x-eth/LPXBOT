import type {
  PricingPosition,
  PricingPositionStreamEvent,
  SwapQuoteView,
} from "../packages/api-contract/src/index.js";
import {
  SwapPricingClient,
  SwapPricingRequestError,
  initialPricingPositionStreamState,
  parsePricingPositionPage,
  parsePricingPositionStreamEvent,
  parseSwapQuoteView,
  quoteTimeState,
  reducePricingPositionStream,
} from "../apps/web/src/swap-pricing-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "73000000-0000-4000-8000-000000000011";
const pricingId = "73000000-0000-4000-8000-000000000021";
const tokenIn = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const tokenOut = "0x55d398326f99059ff775485246999027b3197955";
const hash: `0x${string}` = `0x${"ab".repeat(32)}`;

const quote: SwapQuoteView = {
  amountInBaseUnit: "1001",
  amountOutBaseUnit: "2000",
  blockNumber: "116718500",
  calldataDigest: hash,
  chainId: 56,
  deadline: "2026-08-19T08:01:00.000Z",
  digest: `0x${"cd".repeat(32)}`,
  digestDomain: "LPXBOT_SWAP_QUOTE",
  digestVersion: 1,
  executionEnabled: false,
  expiresAt: "2026-08-19T08:00:30.000Z",
  gas: { estimatedFeeWei: "543000000000000", gasLimit: "181000", gasPriceWei: "3000000000" },
  maxBlockNumber: "116718505",
  minOutBaseUnit: "1990",
  platformId: 1,
  priceImpactBps: 24,
  providerSnapshotId: "73000000-0000-4000-8000-000000000031",
  quotedAt: "2026-08-19T08:00:00.000Z",
  registryVersion: "p05-bsc-execution-v1",
  route: { poolPath: [hash], tokens: [tokenIn, tokenOut] },
  router: "0x1111111111111111111111111111111111110051",
  selector: "0x01000051",
  slippageBps: 50,
  spender: "0x1111111111111111111111111111111111110151",
  tokenIn,
  tokenOut,
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletId,
};

const position: PricingPosition = {
  chainId: 56,
  costBasis: {
    amount0BaseUnit: "100",
    amount1BaseUnit: "200",
    priceObservedAt: null,
    priceSource: null,
    priceStatus: "missing",
    usdValueDecimal: null,
  },
  importedAt: "2026-08-19T08:00:00.000Z",
  observations: [
    {
      blockHash: hash,
      blockNumber: "116718500",
      liquidityAmount0BaseUnit: "100",
      liquidityAmount1BaseUnit: "200",
      liquidityRaw: "300",
      observationId: "73000000-0000-4000-8000-000000000041",
      observedAt: "2026-08-19T08:00:00.000Z",
      observedFee0BaseUnit: "7",
      observedFee1BaseUnit: "9",
      pageSnapshotDigest: hash,
      recordedAt: "2026-08-19T08:00:01.000Z",
      snapshotDigest: `0x${"ef".repeat(32)}`,
    },
  ],
  platformId: 1,
  pool: {
    poolAddress: "0x2222222222222222222222222222222222222222",
    poolId: null,
    token0: tokenIn,
    token1: tokenOut,
  },
  positionManager: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
  pricingId,
  revision: 1,
  status: "active",
  tokenId: "42",
  updatedAt: "2026-08-19T08:00:00.000Z",
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletId,
};

function event<T extends PricingPositionStreamEvent["type"]>(
  value: Extract<PricingPositionStreamEvent, { type: T }>,
) {
  return value;
}

describe("P05-03 strict swap and pricing browser client", () => {
  it("parses integer quote invariants and rejects any executable or malformed response field", () => {
    expect(parseSwapQuoteView(quote)).toEqual(quote);
    for (const malformed of [
      { ...quote, calldata: "0x1234" },
      { ...quote, amountOutBaseUnit: "2.5" },
      { ...quote, minOutBaseUnit: "1991" },
      { ...quote, gas: { ...quote.gas, estimatedFeeWei: "1" } },
      { ...quote, route: { ...quote.route, tokens: [tokenOut, tokenIn] } },
      { ...quote, expiresAt: quote.quotedAt },
      { ...quote, maxBlockNumber: "116718499" },
      { ...quote, executionEnabled: true },
    ]) {
      expect(() => parseSwapQuoteView(malformed)).toThrowError(SwapPricingRequestError);
    }
    expect(quoteTimeState(quote, new Date("2026-08-19T08:00:29.999Z"))).toBe("quoted");
    expect(quoteTimeState(quote, new Date(quote.expiresAt))).toBe("expired");
    expect(quoteTimeState(quote, new Date(quote.deadline))).toBe("expired");
  });

  it("sends exactly the seven allowed quote fields", async () => {
    const requests: Array<{ body: unknown; init?: RequestInit; path: string }> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        ...(init ? { init } : {}),
        path: String(input),
      });
      return new Response(JSON.stringify({ data: quote, requestId: "fixture", success: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    const client = new SwapPricingClient(fetcher);
    await expect(
      client.quote({
        amountInBaseUnit: "1001",
        chainId: 56,
        platformId: 1,
        slippageBps: 50,
        tokenIn,
        tokenOut,
        walletId,
      }),
    ).resolves.toEqual(quote);
    expect(requests[0]).toMatchObject({
      body: {
        amountInBaseUnit: "1001",
        chainId: 56,
        platformId: 1,
        slippageBps: 50,
        tokenIn,
        tokenOut,
        walletId,
      },
      path: "/api/swap/quote",
    });
    expect(requests[0]!.init).toMatchObject({
      cache: "no-store",
      credentials: "include",
      method: "POST",
    });
    expect(JSON.stringify(requests[0]!.body)).not.toMatch(/router|spender|selector|calldata|okx/iu);
  });

  it("parses immutable cost and observed fees without collected-income semantics", () => {
    expect(parsePricingPositionPage({ items: [position] })).toEqual({ items: [position] });
    for (const malformed of [
      { items: [{ ...position, claimedUsd: "999" }] },
      { items: [{ ...position, costBasis: { ...position.costBasis, priceStatus: "current" } }] },
      {
        items: [
          {
            ...position,
            observations: [{ ...position.observations[0], observedFee0BaseUnit: 7 }],
          },
        ],
      },
    ]) {
      expect(() => parsePricingPositionPage(malformed)).toThrowError(SwapPricingRequestError);
    }
  });

  it("applies snapshot/diff/tombstone/heartbeat once and requires a snapshot on epoch change", () => {
    const snapshot = event({
      cursor: "cursor-1",
      epoch: "73000000-0000-4000-8000-000000000090",
      items: [position],
      sequence: "1",
      type: "snapshot",
    });
    const ready = reducePricingPositionStream(
      initialPricingPositionStreamState(),
      parsePricingPositionStreamEvent(snapshot),
    );
    expect(ready).toMatchObject({ connection: "live", cursor: "cursor-1", items: [position] });

    const changed = { ...position, revision: 2, status: "hidden" as const };
    const diff = event({
      cursor: "cursor-2",
      epoch: snapshot.epoch,
      position: changed,
      sequence: "2",
      type: "diff",
    });
    const afterDiff = reducePricingPositionStream(ready, diff);
    expect(afterDiff.items[0]).toMatchObject({ revision: 2, status: "hidden" });
    expect(reducePricingPositionStream(afterDiff, diff)).toEqual(afterDiff);

    const tombstone = event({
      cursor: "cursor-3",
      epoch: snapshot.epoch,
      pricingId,
      revision: 3,
      sequence: "3",
      status: "withdrawn",
      type: "tombstone",
    });
    const withdrawn = reducePricingPositionStream(afterDiff, tombstone);
    expect(withdrawn.items[0]).toMatchObject({ revision: 3, status: "withdrawn" });
    const heartbeat = event({
      cursor: "cursor-3",
      epoch: snapshot.epoch,
      observedAt: "2026-08-19T08:00:15.000Z",
      sequence: "3",
      type: "heartbeat",
    });
    expect(reducePricingPositionStream(withdrawn, heartbeat).connection).toBe("live");

    const wrongEpoch = { ...diff, epoch: "73000000-0000-4000-8000-000000000091" };
    expect(reducePricingPositionStream(withdrawn, wrongEpoch).connection).toBe("stale");
  });
});
