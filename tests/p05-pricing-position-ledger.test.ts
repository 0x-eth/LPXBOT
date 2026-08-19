import type {
  ImportPricingPositionRequest,
  PricingPosition,
  WalletPosition,
} from "../packages/api-contract/src/index.js";
import {
  MemoryPricingPositionStore,
  PricingPositionError,
  PricingPositionService,
  type PricingPositionSource,
  type PricingPositionSourceSnapshot,
} from "../apps/api/src/index.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-19T07:00:00.000Z");
const tenantId = "tenant-p05-03";
const userA = "69000000-0000-4000-8000-000000000001";
const userB = "69000000-0000-4000-8000-000000000002";
const walletId = "69000000-0000-4000-8000-000000000011";
const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const positionManager = "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613" as const;
const blockHash = `0x${"ab".repeat(32)}` as const;
const pageDigest = `0x${"cd".repeat(32)}` as const;

function position(options: {
  blockNumber?: string;
  digest?: `0x${string}`;
  fee0?: string;
  fee1?: string;
  liquidity?: string;
  tokenId?: string;
} = {}): WalletPosition {
  const tokenId = options.tokenId ?? "42";
  return {
    approval: {
      approvedAddress: null,
      approvedForAll: false,
      helperAuthorized: false,
      nftOwner: walletAddress,
      observedAtBlock: options.blockNumber ?? "116718500",
    },
    chainId: 56,
    fees: {
      estimated0BaseUnit: options.fee0 ?? "7",
      estimated1BaseUnit: options.fee1 ?? "9",
      owed0BaseUnit: options.fee0 ?? "7",
      owed1BaseUnit: options.fee1 ?? "9",
    },
    liquidity: {
      amount0BaseUnit: "100",
      amount1BaseUnit: "200",
      raw: options.liquidity ?? "300",
    },
    owner: walletAddress,
    platformId: 1,
    pool: {
      feePips: "500",
      hooks: null,
      poolAddress: "0x2222222222222222222222222222222222222222",
      poolId: null,
      tickSpacing: "10",
      token0: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      token1: "0x55d398326f99059ff775485246999027b3197955",
    },
    snapshot: {
      blockHash,
      blockNumber: options.blockNumber ?? "116718500",
      blockTimestamp: now.toISOString(),
      digest: options.digest ?? (`0x${tokenId.padStart(64, "0")}` as const),
      positionManager,
      positionManagerCodeHash: `0x${"ef".repeat(32)}`,
      registryVersion: "p05-bsc-execution-v1",
    },
    ticks: { current: "0", inRange: true, lower: "-10", upper: "10" },
    tokenId,
  };
}

class Source implements PricingPositionSource {
  state: PricingPositionSourceSnapshot["state"] = "verified";
  latestPosition = position();

  async findImportSnapshot(input: {
    snapshotDigest: `0x${string}`;
    tokenId: string;
    userId: string;
    walletId: string;
  }): Promise<PricingPositionSourceSnapshot | null> {
    if (
      input.userId !== userA ||
      input.walletId !== walletId ||
      input.snapshotDigest !== pageDigest ||
      input.tokenId !== this.latestPosition.tokenId
    ) {
      return null;
    }
    return {
      pageSnapshotDigest: pageDigest,
      position: structuredClone(this.latestPosition),
      state: this.state,
      userId: userA,
      walletAddress,
      walletId,
    };
  }

  async findLatestSnapshot(input: {
    pricingId: string;
    userId: string;
  }): Promise<PricingPositionSourceSnapshot | null> {
    if (input.userId !== userA || input.pricingId.length === 0) return null;
    return {
      pageSnapshotDigest: pageDigest,
      position: structuredClone(this.latestPosition),
      state: this.state,
      userId: userA,
      walletAddress,
      walletId,
    };
  }
}

function request(overrides: Partial<ImportPricingPositionRequest> = {}): ImportPricingPositionRequest {
  return {
    chainId: 56,
    costBasis: {
      amount0BaseUnit: "1000000000000000000",
      amount1BaseUnit: "250000000000000000000",
      priceObservedAt: "2026-08-19T06:59:00.000Z",
      priceSource: "fixture-usd-v1",
      usdValueDecimal: "500.25",
    },
    platformId: 1,
    snapshotDigest: pageDigest,
    tokenId: "42",
    walletId,
    ...overrides,
  };
}

function fixture() {
  const source = new Source();
  let id = 0;
  const store = new MemoryPricingPositionStore({
    epoch: "69000000-0000-4000-8000-000000000090",
    id: () => `69000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  const service = new PricingPositionService({
    now: () => now,
    priceMaxAgeMs: 5 * 60_000,
    source,
    store,
    tenantId,
  });
  return { service, source, store };
}

describe("P05-03 observed pricing position ledger", () => {
  it("deduplicates concurrent imports by the full user-wallet-chain-position identity", async () => {
    const { service, store } = fixture();
    const [first, second] = await Promise.all([
      service.importPosition({ request: request(), userId: userA }),
      service.importPosition({ request: request(), userId: userA }),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      chainId: 56,
      platformId: 1,
      positionManager,
      revision: 1,
      status: "active",
      tokenId: "42",
      walletAddress,
      walletId,
    });
    expect((await service.list({ userId: userA })).items).toHaveLength(1);
    expect(store.outboxFor({ tenantId, userId: userA })).toHaveLength(1);
  });

  it("rejects cross-user, quarantined, and stale P05-02 snapshots", async () => {
    const { service, source } = fixture();
    await expect(
      service.importPosition({ request: request(), userId: userB }),
    ).rejects.toMatchObject({ code: "PRICING_SNAPSHOT_NOT_FOUND" });

    source.state = "quarantined";
    await expect(
      service.importPosition({ request: request(), userId: userA }),
    ).rejects.toMatchObject({ code: "PRICING_SNAPSHOT_QUARANTINED" });
    source.state = "stale";
    await expect(
      service.importPosition({ request: request(), userId: userA }),
    ).rejects.toMatchObject({ code: "PRICING_SNAPSHOT_STALE" });
  });

  it("freezes exact cost basis and returns null USD with explicit missing or stale price status", async () => {
    const currentFixture = fixture();
    const current = await currentFixture.service.importPosition({
      request: request(),
      userId: userA,
    });
    expect(current.costBasis).toEqual({
      amount0BaseUnit: "1000000000000000000",
      amount1BaseUnit: "250000000000000000000",
      priceObservedAt: "2026-08-19T06:59:00.000Z",
      priceSource: "fixture-usd-v1",
      priceStatus: "current",
      usdValueDecimal: "500.25",
    });
    expect(Object.isFrozen(current.costBasis)).toBe(true);

    const missingFixture = fixture();
    const missing = await missingFixture.service.importPosition({
      request: request({
        costBasis: {
          amount0BaseUnit: "1",
          amount1BaseUnit: "2",
          priceObservedAt: null,
          priceSource: null,
          usdValueDecimal: null,
        },
      }),
      userId: userA,
    });
    expect(missing.costBasis).toMatchObject({ priceStatus: "missing", usdValueDecimal: null });

    const staleFixture = fixture();
    const stale = await staleFixture.service.importPosition({
      request: request({
        costBasis: {
          ...request().costBasis,
          priceObservedAt: "2026-08-19T06:54:59.999Z",
        },
      }),
      userId: userA,
    });
    expect(stale.costBasis).toMatchObject({ priceStatus: "stale", usdValueDecimal: null });
  });

  it("records fee history only as immutable on-chain observations", async () => {
    const { service, source } = fixture();
    const first = await service.importPosition({ request: request(), userId: userA });
    expect(first.observations).toHaveLength(1);
    expect(first.observations[0]).toMatchObject({
      observedFee0BaseUnit: "7",
      observedFee1BaseUnit: "9",
      snapshotDigest: position().snapshot.digest,
    });
    expect(first.observations[0]).not.toHaveProperty("claimed");
    expect(first.observations[0]).not.toHaveProperty("collected");

    source.latestPosition = position({
      blockNumber: "116718501",
      digest: `0x${"12".repeat(32)}`,
      fee0: "11",
      fee1: "13",
    });
    const second = await service.importPosition({ request: request(), userId: userA });
    expect(second.pricingId).toBe(first.pricingId);
    expect(second.revision).toBe(2);
    expect(second.observations.map(({ observedFee0BaseUnit }) => observedFee0BaseUnit)).toEqual([
      "7",
      "11",
    ]);
    expect(second.costBasis).toEqual(first.costBasis);
  });

  it("uses hidden while liquidity remains, then appends a withdrawn tombstone with optimistic revision", async () => {
    const { service, source, store } = fixture();
    const imported = await service.importPosition({ request: request(), userId: userA });
    const hidden = await service.markWithdrawn({
      expectedRevision: 1,
      pricingId: imported.pricingId,
      userId: userA,
    });
    expect(hidden).toMatchObject({ revision: 2, status: "hidden" });
    expect(hidden.observations).toHaveLength(1);

    source.latestPosition = position({
      blockNumber: "116718502",
      digest: `0x${"34".repeat(32)}`,
      fee0: "17",
      fee1: "19",
      liquidity: "0",
    });
    await expect(
      service.markWithdrawn({
        expectedRevision: 1,
        pricingId: imported.pricingId,
        userId: userA,
      }),
    ).rejects.toBeInstanceOf(PricingPositionError);
    const withdrawn = await service.markWithdrawn({
      expectedRevision: 2,
      pricingId: imported.pricingId,
      userId: userA,
    });
    expect(withdrawn).toMatchObject({ revision: 3, status: "withdrawn" });
    expect(withdrawn.observations).toHaveLength(2);
    expect((await service.list({ userId: userA })).items).toEqual([withdrawn]);

    const events = store.outboxFor({ tenantId, userId: userA });
    expect(events.map(({ eventType }) => eventType)).toEqual(["diff", "diff", "tombstone"]);
    expect(events.at(-1)).toMatchObject({ pricingId: imported.pricingId, revision: 3 });
  });

  it("never exposes another user's pricing id", async () => {
    const { service } = fixture();
    const imported = await service.importPosition({ request: request(), userId: userA });
    await expect(
      service.markWithdrawn({
        expectedRevision: imported.revision,
        pricingId: imported.pricingId,
        userId: userB,
      }),
    ).rejects.toMatchObject({ code: "PRICING_POSITION_NOT_FOUND" });
    expect((await service.list({ userId: userB })).items).toEqual([]);
  });
});
