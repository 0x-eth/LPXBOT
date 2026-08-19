import {
  ERC20_RESIDUAL_READ_ABI,
  ERC721_RESIDUAL_READ_ABI,
  HelperResidualCursorError,
  MemoryWalletHelperReadStore,
  WalletHelperResidualService,
  type HelperPositionInventorySource,
  type HelperWalletTokenSource,
} from "../apps/api/src/index.js";
import type {
  PositionReadLog,
  PositionReadRpc,
  PositionReadSnapshot,
} from "../packages/chain-adapters/src/index.js";
import type { BscHelperResidualAllowlist } from "../packages/chain-registry/src/index.js";
import { encodeFunctionData, encodeFunctionResult, type Abi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

const userId = "65000000-0000-4000-8000-000000000001";
const otherUserId = "65000000-0000-4000-8000-000000000002";
const walletId = "65000000-0000-4000-8000-000000000011";
const bindingId = "65000000-0000-4000-8000-000000000021";
const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const helperAddress = "0x2222222222222222222222222222222222222222" as const;
const tokenA = "0x4444444444444444444444444444444444444444" as const;
const tokenB = "0x5555555555555555555555555555555555555555" as const;
const spender = "0x6666666666666666666666666666666666666666" as const;
const nftManager = "0x7777777777777777777777777777777777777777" as const;
const snapshot: PositionReadSnapshot = {
  blockHash: `0x${"ab".repeat(32)}`,
  blockNumber: "116718500",
  blockTimestamp: "2026-08-19T03:00:00.000Z",
};
const cursorSecret = "p05-helper-residual-cursor-secret-at-least-32-bytes";

const completeAllowlist: BscHelperResidualAllowlist = {
  chainId: 56,
  coverageComplete: true,
  nftManagerAddresses: [nftManager],
  registryVersion: "p05-bsc-execution-v1",
  spenderAddresses: [spender],
  tokenAddresses: [tokenA],
  version: "fixture-residual-v1",
};

class ResidualRpc implements PositionReadRpc {
  readonly calls: Array<{ blockNumber: string; data: Hex; to: Address }> = [];
  readonly balances: Array<{ address: Address; blockNumber: string }> = [];
  readonly responses = new Map<string, Hex>();
  blockReads: Array<string | "latest"> = [];
  nativeBalance = 5n;
  reorg = false;

  add(abi: Abi, to: Address, functionName: string, args: readonly unknown[], result: unknown) {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    this.responses.set(
      `${to}:${data}`,
      encodeFunctionResult({ abi, functionName, result } as never),
    );
  }

  async call(input: { blockNumber: string; data: Hex; to: Address }): Promise<Hex> {
    this.calls.push(input);
    const response = this.responses.get(`${input.to}:${input.data}`);
    if (!response) throw new Error("fixture controlled read unavailable");
    return response;
  }

  async getBalance(address: Address, blockNumber: string): Promise<bigint> {
    this.balances.push({ address, blockNumber });
    return this.nativeBalance;
  }

  async getBlock(blockNumber: string | "latest"): Promise<PositionReadSnapshot> {
    this.blockReads.push(blockNumber);
    return this.reorg && this.blockReads.length > 1
      ? { ...snapshot, blockHash: `0x${"cd".repeat(32)}` }
      : snapshot;
  }

  async getCode(): Promise<Hex> {
    return "0x";
  }

  async getLogs(): Promise<readonly PositionReadLog[]> {
    return [];
  }
}

class Positions implements HelperPositionInventorySource {
  complete = true;
  fail = false;

  async list() {
    if (this.fail) throw new Error("position inventory unavailable");
    return {
      complete: this.complete,
      knownNfts: [{ managerAddress: nftManager, tokenId: "9" }],
      tokenAddresses: [tokenA, tokenB],
    };
  }
}

class WalletTokens implements HelperWalletTokenSource {
  complete = true;
  fail = false;

  async list() {
    if (this.fail) throw new Error("wallet token registry unavailable");
    return { complete: this.complete, tokenAddresses: [tokenA] };
  }
}

async function storeWithBinding() {
  const store = new MemoryWalletHelperReadStore();
  await store.recordTrustedBinding({
    bindingId,
    boundAt: new Date("2026-08-19T01:00:00.000Z"),
    chainId: 56,
    helperAddress,
    helperVersion: "fixture-v2",
    registryVersion: "p05-bsc-execution-v1",
    source: "deployment-result",
    userId,
    walletId,
  });
  return store;
}

function fixtureResponses(rpc: ResidualRpc) {
  rpc.add(ERC20_RESIDUAL_READ_ABI, tokenA, "balanceOf", [helperAddress], 10n);
  rpc.add(ERC20_RESIDUAL_READ_ABI, tokenB, "balanceOf", [helperAddress], 0n);
  rpc.add(ERC20_RESIDUAL_READ_ABI, tokenA, "allowance", [helperAddress, spender], 3n);
  rpc.add(ERC20_RESIDUAL_READ_ABI, tokenB, "allowance", [helperAddress, spender], 0n);
  rpc.add(ERC721_RESIDUAL_READ_ABI, nftManager, "ownerOf", [9n], helperAddress);
}

function service(input: {
  allowlist?: BscHelperResidualAllowlist;
  positions?: Positions;
  rpc: ResidualRpc;
  store: MemoryWalletHelperReadStore;
  walletTokens?: WalletTokens;
}) {
  return new WalletHelperResidualService({
    allowlist: input.allowlist ?? completeAllowlist,
    cursorSecret,
    now: () => new Date("2026-08-19T03:00:01.000Z"),
    positions: input.positions ?? new Positions(),
    rpc: input.rpc,
    store: input.store,
    walletTokens: input.walletTokens ?? new WalletTokens(),
  });
}

function scanInput(idempotencyKey = "residual-fixture-001") {
  return { chainId: 56 as const, idempotencyKey, userId, walletId };
}

describe("P05-02 bounded Helper residual read model", () => {
  it("scans native, controlled token, registered allowance, and known NFT at one block", async () => {
    const rpc = new ResidualRpc();
    fixtureResponses(rpc);
    const store = await storeWithBinding();
    const page = await service({ rpc, store }).scan(scanInput());
    expect(page).toMatchObject({
      allowlistVersion: "fixture-residual-v1",
      chainId: 56,
      coverage: { complete: true, missingSources: [] },
      helperAddress,
      registryVersion: "p05-bsc-execution-v1",
      state: "ready",
      walletId,
    });
    expect(page.items).toEqual([
      {
        amountBaseUnit: "5",
        assetId: "native:56",
        chainId: 56,
        kind: "native",
        tokenAddress: null,
      },
      {
        amountBaseUnit: "10",
        assetId: `token:${tokenA}`,
        chainId: 56,
        kind: "token",
        tokenAddress: tokenA,
      },
      {
        amountBaseUnit: "3",
        assetId: `allowance:${tokenA}:${spender}`,
        chainId: 56,
        kind: "allowance",
        spenderAddress: spender,
        tokenAddress: tokenA,
      },
      {
        amountBaseUnit: "1",
        assetId: `nft:${nftManager}:9`,
        chainId: 56,
        kind: "nft",
        managerAddress: nftManager,
        tokenAddress: null,
        tokenId: "9",
      },
    ]);
    expect(rpc.calls.every(({ blockNumber }) => blockNumber === snapshot.blockNumber)).toBe(true);
    expect(rpc.balances).toEqual([{ address: helperAddress, blockNumber: snapshot.blockNumber }]);
    expect(rpc.blockReads).toEqual(["latest", snapshot.blockNumber]);
    expect(Object.isFrozen(page.items)).toBe(true);
  });

  it("returns empty only when every bounded source is complete and every amount is zero", async () => {
    const rpc = new ResidualRpc();
    rpc.nativeBalance = 0n;
    fixtureResponses(rpc);
    rpc.responses.clear();
    rpc.add(ERC20_RESIDUAL_READ_ABI, tokenA, "balanceOf", [helperAddress], 0n);
    rpc.add(ERC20_RESIDUAL_READ_ABI, tokenB, "balanceOf", [helperAddress], 0n);
    rpc.add(ERC20_RESIDUAL_READ_ABI, tokenA, "allowance", [helperAddress, spender], 0n);
    rpc.add(ERC20_RESIDUAL_READ_ABI, tokenB, "allowance", [helperAddress, spender], 0n);
    rpc.add(ERC721_RESIDUAL_READ_ABI, nftManager, "ownerOf", [9n], walletAddress);
    const page = await service({ rpc, store: await storeWithBinding() }).scan(scanInput());
    expect(page).toMatchObject({ items: [], state: "empty" });
    expect(page.coverage.complete).toBe(true);
  });

  it("never claims empty when allowlist or inventory coverage is incomplete", async () => {
    const rpc = new ResidualRpc();
    rpc.nativeBalance = 0n;
    const positions = new Positions();
    positions.complete = false;
    positions.fail = true;
    const walletTokens = new WalletTokens();
    walletTokens.fail = true;
    const page = await service({
      allowlist: { ...completeAllowlist, coverageComplete: false, tokenAddresses: [] },
      positions,
      rpc,
      store: await storeWithBinding(),
      walletTokens,
    }).scan(scanInput());
    expect(page.items).toEqual([]);
    expect(page.state).toBe("partial");
    expect(page.coverage).toMatchObject({
      allowlistComplete: false,
      complete: false,
      positionTokensComplete: false,
      walletTokenRegistryComplete: false,
    });
    expect(page.coverage.missingSources).toEqual(
      expect.arrayContaining(["allowlist", "position-tokens", "wallet-token-registry"]),
    );
  });

  it("coalesces concurrent idempotency keys and survives service restart without more RPC", async () => {
    const rpc = new ResidualRpc();
    fixtureResponses(rpc);
    const store = await storeWithBinding();
    const firstService = service({ rpc, store });
    const [first, concurrent] = await Promise.all([
      firstService.scan(scanInput()),
      firstService.scan(scanInput()),
    ]);
    expect(concurrent).toEqual(first);
    expect(rpc.blockReads).toHaveLength(2);

    const restarted = service({ rpc, store });
    await expect(restarted.scan(scanInput())).resolves.toEqual(first);
    expect(rpc.blockReads).toHaveLength(2);
  });

  it("paginates the persisted snapshot without duplicates and binds its cursor", async () => {
    const rpc = new ResidualRpc();
    fixtureResponses(rpc);
    const store = await storeWithBinding();
    const residuals = service({ rpc, store });
    await residuals.scan(scanInput());
    const first = await residuals.latest({
      chainId: 56,
      cursor: null,
      limit: 2,
      userId,
      walletId,
    });
    expect(first?.items).toHaveLength(2);
    expect(first?.cursor).toEqual(expect.any(String));
    const second = await residuals.latest({
      chainId: 56,
      cursor: first!.cursor,
      limit: 2,
      userId,
      walletId,
    });
    expect(second?.items).toHaveLength(2);
    expect(second?.cursor).toBeNull();
    expect(new Set([...first!.items, ...second!.items].map(({ assetId }) => assetId)).size).toBe(4);
    await expect(
      residuals.latest({
        chainId: 56,
        cursor: first!.cursor,
        limit: 2,
        userId: otherUserId,
        walletId,
      }),
    ).rejects.toBeInstanceOf(HelperResidualCursorError);
  });

  it("discards values and persists partial coverage when the snapshot reorgs", async () => {
    const rpc = new ResidualRpc();
    rpc.reorg = true;
    fixtureResponses(rpc);
    const page = await service({ rpc, store: await storeWithBinding() }).scan(scanInput());
    expect(page).toMatchObject({ items: [], state: "partial" });
    expect(page.coverage.missingSources).toContain("canonical-block");
  });

  it("requires an internally bound Helper and accepts no token list in scan intent", async () => {
    const rpc = new ResidualRpc();
    const residuals = service({ rpc, store: new MemoryWalletHelperReadStore() });
    await expect(residuals.scan(scanInput())).rejects.toMatchObject({
      code: "HELPER_UNDEPLOYED",
    });
    expect(Object.keys(scanInput()).sort()).toEqual([
      "chainId",
      "idempotencyKey",
      "userId",
      "walletId",
    ]);
    expect(rpc.blockReads).toEqual([]);
  });
});
