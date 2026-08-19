import {
  PositionHelperClient,
  PositionHelperRequestError,
  parseHelperResidualPage,
  parseWalletHelperStatus,
  parseWalletPositionPage,
} from "../apps/web/src/position-helper-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "68000000-0000-4000-8000-000000000011";
const address = "0x1111111111111111111111111111111111111111";
const helperAddress = "0x2222222222222222222222222222222222222222";
const manager = "0x3333333333333333333333333333333333333333";
const token0 = "0x4444444444444444444444444444444444444444";
const token1 = "0x5555555555555555555555555555555555555555";
const spender = "0x6666666666666666666666666666666666666666";
const blockHash = `0x${"ab".repeat(32)}`;
const digest = `0x${"cd".repeat(32)}`;
const codeHash = `0x${"ef".repeat(32)}`;
const timestamp = "2026-08-19T06:00:00.000Z";

const position = {
  approval: {
    approvedAddress: helperAddress,
    approvedForAll: false,
    helperAuthorized: true,
    nftOwner: address,
    observedAtBlock: "116718500",
  },
  chainId: 56,
  fees: {
    estimated0BaseUnit: "13",
    estimated1BaseUnit: null,
    owed0BaseUnit: "3",
    owed1BaseUnit: "5",
  },
  liquidity: { amount0BaseUnit: "1000000000000000001", amount1BaseUnit: "9", raw: "77" },
  owner: address,
  platformId: 1,
  pool: {
    feePips: "500",
    hooks: null,
    poolAddress: "0x7777777777777777777777777777777777777777",
    poolId: null,
    tickSpacing: "10",
    token0,
    token1,
  },
  snapshot: {
    blockHash,
    blockNumber: "116718500",
    blockTimestamp: timestamp,
    digest,
    positionManager: manager,
    positionManagerCodeHash: codeHash,
    registryVersion: "p05-bsc-execution-v1",
  },
  ticks: { current: "0", inRange: true, lower: "-100", upper: "100" },
  tokenId: "9",
};

const positionPage = {
  address,
  chainId: 56,
  coverage: { complete: true, failedPlatformIds: [], scannedPlatformIds: [1] },
  cursor: null,
  items: [position],
  quarantined: [],
  registryVersion: "p05-bsc-execution-v1",
  snapshot: { blockHash, blockNumber: "116718500", blockTimestamp: timestamp, digest },
  status: "ready",
  walletId,
};

const helperStatus = {
  address: helperAddress,
  chainId: 56,
  failures: [],
  helperVersion: "observed-bsc-helper-v2",
  owner: address,
  registryVersion: "p05-bsc-execution-v1",
  state: "active",
  verification: {
    blockHash,
    blockNumber: "116718500",
    blockTimestamp: timestamp,
    checks: { address: true, owner: true, runtimeCodeHash: true, selectorSet: true, version: true },
    digest,
    observedOwner: address,
    observedRuntimeCodeHash: codeHash,
    observedSelectors: ["0x8da5cb5b"],
    verifiedAt: "2026-08-19T06:00:01.000Z",
  },
  walletId,
};

const residualPage = {
  allowlistVersion: "p05-bsc-helper-residual-v1",
  chainId: 56,
  coverage: {
    allowlistComplete: true,
    complete: true,
    missingSources: [],
    positionTokensComplete: true,
    walletTokenRegistryComplete: true,
  },
  cursor: null,
  helperAddress,
  items: [
    {
      amountBaseUnit: "1",
      assetId: "native:56",
      chainId: 56,
      kind: "native",
      tokenAddress: null,
    },
    {
      amountBaseUnit: "1000000000000000001",
      assetId: `token:${token0}`,
      chainId: 56,
      kind: "token",
      tokenAddress: token0,
    },
    {
      amountBaseUnit: "7",
      assetId: `allowance:${token1}:${spender}`,
      chainId: 56,
      kind: "allowance",
      spenderAddress: spender,
      tokenAddress: token1,
    },
    {
      amountBaseUnit: "1",
      assetId: `nft:${manager}:9`,
      chainId: 56,
      kind: "nft",
      managerAddress: manager,
      tokenAddress: null,
      tokenId: "9",
    },
  ],
  registryVersion: "p05-bsc-execution-v1",
  scanId: "68000000-0000-4000-8000-000000000021",
  scannedAt: "2026-08-19T06:00:02.000Z",
  snapshot: { blockHash, blockNumber: "116718500", blockTimestamp: timestamp, digest },
  state: "ready",
  walletId,
};

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data, requestId: "p05-web-fixture", success: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("P05-02 strict position, Helper, and residual browser client", () => {
  it("parses a same-block V3 position page and rejects floats, mixed snapshots, and wrong identity", () => {
    expect(parseWalletPositionPage(positionPage)).toEqual(positionPage);
    for (const malformed of [
      {
        ...positionPage,
        items: [{ ...position, liquidity: { ...position.liquidity, raw: 77 } }],
      },
      {
        ...positionPage,
        items: [{ ...position, snapshot: { ...position.snapshot, blockNumber: "116718501" } }],
      },
      {
        ...positionPage,
        items: [{ ...position, pool: { ...position.pool, poolAddress: null, poolId: digest } }],
      },
      { ...positionPage, status: "empty" },
    ]) {
      expect(() => parseWalletPositionPage(malformed)).toThrowError(PositionHelperRequestError);
    }

    const v4 = {
      ...position,
      platformId: 4,
      pool: { ...position.pool, poolAddress: null, poolId: digest },
    };
    expect(
      parseWalletPositionPage({
        ...positionPage,
        coverage: { complete: true, failedPlatformIds: [], scannedPlatformIds: [4] },
        items: [v4],
      }).items[0]?.pool.poolId,
    ).toBe(digest);
  });

  it("enforces undeployed, active, degraded, superseded, and residual Helper semantics", () => {
    expect(parseWalletHelperStatus(helperStatus)).toEqual(helperStatus);
    expect(
      parseWalletHelperStatus({
        address: null,
        chainId: 56,
        failures: [],
        helperVersion: null,
        owner: address,
        registryVersion: "p05-bsc-execution-v1",
        state: "undeployed",
        verification: null,
        walletId,
      }).state,
    ).toBe("undeployed");
    for (const state of ["superseded", "residual"] as const) {
      expect(parseWalletHelperStatus({ ...helperStatus, state }).state).toBe(state);
    }
    expect(
      parseWalletHelperStatus({
        ...helperStatus,
        failures: ["owner-mismatch"],
        state: "degraded",
        verification: {
          ...helperStatus.verification,
          checks: { ...helperStatus.verification.checks, owner: false },
          observedOwner: helperAddress,
        },
      }).state,
    ).toBe("degraded");
    expect(() =>
      parseWalletHelperStatus({ ...helperStatus, failures: ["owner-mismatch"] }),
    ).toThrowError(PositionHelperRequestError);
  });

  it("parses native/token/allowance/NFT residuals and never accepts false empty coverage", () => {
    expect(parseHelperResidualPage(residualPage)).toEqual(residualPage);
    expect(parseHelperResidualPage(null)).toBeNull();
    for (const malformed of [
      { ...residualPage, items: [{ ...residualPage.items[0], amountBaseUnit: 1 }] },
      {
        ...residualPage,
        coverage: { ...residualPage.coverage, allowlistComplete: false, complete: false },
        items: [],
        state: "empty",
      },
      {
        ...residualPage,
        coverage: { ...residualPage.coverage, complete: false, missingSources: [] },
        state: "partial",
      },
    ]) {
      expect(() => parseHelperResidualPage(malformed)).toThrowError(PositionHelperRequestError);
    }
  });

  it("uses fixed BSC routes and sends only walletId, chainId, and idempotency key", async () => {
    const requests: Array<{ body: unknown; method: string; path: string }> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = String(input);
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        path,
      });
      if (path.includes("/positions")) return success(positionPage);
      if (path.includes("/helper?")) return success(helperStatus);
      return success(residualPage);
    });
    const client = new PositionHelperClient(fetcher);
    await expect(client.positions(address)).resolves.toEqual(positionPage);
    await expect(client.helper(address)).resolves.toEqual(helperStatus);
    await expect(client.residuals(walletId)).resolves.toEqual(residualPage);
    await expect(client.scanResiduals(walletId, "scan-fixture-001")).resolves.toEqual(residualPage);

    expect(requests).toEqual([
      { body: null, method: "GET", path: `/api/wallets/${address}/positions?chainId=56&limit=100` },
      { body: null, method: "GET", path: `/api/wallets/${address}/helper?chainId=56` },
      {
        body: null,
        method: "GET",
        path: `/api/wallets/helper-residuals?chainId=56&walletId=${walletId}&limit=100`,
      },
      {
        body: { chainId: 56, idempotencyKey: "scan-fixture-001", walletId },
        method: "POST",
        path: "/api/wallets/helper-residuals/scan",
      },
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store", credentials: "include" });
      expect(JSON.stringify(init)).not.toMatch(
        /provider|target|calldata|helperAddress|tokenAddress/u,
      );
    }
  });
});
