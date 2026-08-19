import type { WalletPosition } from "../packages/api-contract/src/index.js";
import {
  PositionReadAdapterError,
  type PositionReadAdapter,
  type PositionReadInput,
  type PositionReadLog,
  type PositionReadResult,
  type PositionReadRpc,
  type PositionReadSnapshot,
} from "../packages/chain-adapters/src/index.js";
import {
  BSC_POSITION_READ_REGISTRY,
  type BscPositionReadDeployment,
} from "../packages/chain-registry/src/index.js";
import {
  BscPositionReadService,
  ERC721_TRANSFER_TOPIC,
  PositionCursorError,
} from "../apps/api/src/index.js";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";

const owner = "0x1111111111111111111111111111111111111111" as const;
const otherOwner = "0x2222222222222222222222222222222222222222" as const;
const walletId = "62000000-0000-4000-8000-000000000011";
const userId = "62000000-0000-4000-8000-000000000001";
const snapshot: PositionReadSnapshot = {
  blockHash: `0x${"ab".repeat(32)}`,
  blockNumber: "116718500",
  blockTimestamp: "2026-08-19T01:00:00.000Z",
};
const token0 = "0x0000000000000000000000000000000000000010" as const;
const token1 = "0x0000000000000000000000000000000000000020" as const;
const cursorSecret = "p05-position-cursor-fixture-secret-at-least-32-bytes";

function deployment(platformId: 1 | 2 | 4 | 5): BscPositionReadDeployment {
  return BSC_POSITION_READ_REGISTRY.deployments.find(
    (candidate) => candidate.platformId === platformId,
  )!;
}

function topicAddress(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

function topicTokenId(tokenId: bigint): Hex {
  return `0x${tokenId.toString(16).padStart(64, "0")}` as Hex;
}

function transferLog(
  manager: Address,
  tokenId: bigint,
  options: { observedAddress?: Address } = {},
): PositionReadLog {
  return {
    address: options.observedAddress ?? manager,
    blockHash: snapshot.blockHash,
    blockNumber: snapshot.blockNumber,
    data: "0x",
    logIndex: Number(tokenId),
    topics: [
      ERC721_TRANSFER_TOPIC,
      topicAddress(otherOwner),
      topicAddress(owner),
      topicTokenId(tokenId),
    ],
    transactionHash: `0x${tokenId.toString(16).padStart(64, "0")}` as Hex,
  };
}

function position(
  registered: BscPositionReadDeployment,
  tokenId: string,
  readSnapshot: PositionReadSnapshot,
): Readonly<PositionReadResult> {
  const value: PositionReadResult = {
    approval: {
      approvedAddress: null,
      approvedForAll: false,
      helperAuthorized: false,
      nftOwner: owner,
      observedAtBlock: readSnapshot.blockNumber,
    },
    chainId: 56,
    fees: {
      estimated0BaseUnit: null,
      estimated1BaseUnit: null,
      owed0BaseUnit: "17",
      owed1BaseUnit: "19",
    },
    liquidity: { amount0BaseUnit: "2995", amount1BaseUnit: "2995", raw: "1000000" },
    owner,
    platformId: registered.platformId,
    pool: {
      feePips: "3000",
      hooks: null,
      poolAddress:
        registered.generation === "v3" ? "0x0000000000000000000000000000000000001000" : null,
      poolId: registered.generation === "v4" ? (`0x${"12".repeat(32)}` as Hex) : null,
      tickSpacing: "60",
      token0,
      token1,
    },
    snapshot: {
      ...readSnapshot,
      digest: `0x${tokenId.padStart(64, "0")}` as Hex,
      positionManager: registered.positionManager.address,
      positionManagerCodeHash: registered.positionManager.runtimeCodeHash,
      registryVersion: registered.registryVersion,
    },
    ticks: { current: "0", inRange: true, lower: "-60", upper: "60" },
    tokenId,
  };
  Object.freeze(value.approval);
  Object.freeze(value.fees);
  Object.freeze(value.liquidity);
  Object.freeze(value.pool);
  Object.freeze(value.snapshot);
  Object.freeze(value.ticks);
  return Object.freeze(value);
}

class FakeAdapter implements PositionReadAdapter {
  readonly deployment: BscPositionReadDeployment;
  readonly inputs: PositionReadInput[] = [];
  readonly failures = new Map<string, PositionReadAdapterError>();

  constructor(platformId: 1 | 2 | 4 | 5) {
    this.deployment = deployment(platformId);
  }

  async readPosition(input: PositionReadInput): Promise<Readonly<PositionReadResult>> {
    this.inputs.push(input);
    const failure = this.failures.get(input.tokenId);
    if (failure) throw failure;
    return position(this.deployment, input.tokenId, input.snapshot);
  }
}

class FakeRpc implements PositionReadRpc {
  readonly logs = new Map<string, readonly PositionReadLog[]>();
  readonly logFailures = new Set<string>();
  readonly blockReads: Array<string | "latest"> = [];
  reorgAfterRead = false;

  async call(): Promise<Hex> {
    throw new Error("unused");
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }

  async getBlock(blockNumber: string | "latest"): Promise<PositionReadSnapshot> {
    this.blockReads.push(blockNumber);
    if (this.reorgAfterRead && this.blockReads.length > 1) {
      return { ...snapshot, blockHash: `0x${"cd".repeat(32)}` };
    }
    return snapshot;
  }

  async getCode(): Promise<Hex> {
    return "0x";
  }

  async getLogs(input: { address: Address }): Promise<readonly PositionReadLog[]> {
    const key = input.address.toLowerCase();
    if (this.logFailures.has(key)) throw new Error("fixture provider unavailable");
    return this.logs.get(key) ?? [];
  }
}

function service(rpc: FakeRpc, adapters: readonly FakeAdapter[]) {
  return new BscPositionReadService({ adapters, cursorSecret, rpc });
}

describe("P05-02 canonical BSC position scanning", () => {
  it("deduplicates and paginates without changing the snapshot or repeating a position", async () => {
    const rpc = new FakeRpc();
    const adapters = [1, 2, 4, 5].map((platformId) => new FakeAdapter(platformId as 1 | 2 | 4 | 5));
    const manager = deployment(1).positionManager.address;
    rpc.logs.set(manager, [
      transferLog(manager, 3n),
      transferLog(manager, 1n),
      transferLog(manager, 2n),
      transferLog(manager, 2n),
    ]);
    const scanner = service(rpc, adapters);

    const first = await scanner.scan({
      address: owner,
      chainId: 56,
      cursor: null,
      helperAddress: null,
      limit: 2,
      platformId: null,
      userId,
      walletId,
    });
    expect(first).toMatchObject({
      address: owner,
      chainId: 56,
      coverage: { complete: true, failedPlatformIds: [], scannedPlatformIds: [1, 2, 4, 5] },
      items: [{ tokenId: "1" }, { tokenId: "2" }],
      quarantined: [],
      registryVersion: "p05-bsc-execution-v1",
      status: "ready",
      walletId,
    });
    expect(first.cursor).toEqual(expect.any(String));
    expect(first.snapshot).toMatchObject(snapshot);
    expect(first.snapshot.digest).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
    expect(Object.isFrozen(first.items[0]!.snapshot)).toBe(true);

    const second = await scanner.scan({
      address: owner,
      chainId: 56,
      cursor: first.cursor,
      helperAddress: null,
      limit: 2,
      platformId: null,
      userId,
      walletId,
    });
    expect(second.items.map(({ tokenId }) => tokenId)).toEqual(["3"]);
    expect(second.cursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(({ tokenId }) => tokenId)).size).toBe(3);
    expect(
      adapters
        .flatMap(({ inputs }) => inputs)
        .every((input) => input.snapshot.blockHash === snapshot.blockHash),
    ).toBe(true);
    expect(rpc.blockReads).toEqual([
      "latest",
      snapshot.blockNumber,
      snapshot.blockNumber,
      snapshot.blockNumber,
    ]);
  });

  it("binds cursor integrity to user, wallet, chain, platform, Registry, and snapshot", async () => {
    const rpc = new FakeRpc();
    const adapter = new FakeAdapter(1);
    const manager = adapter.deployment.positionManager.address;
    rpc.logs.set(manager, [transferLog(manager, 1n), transferLog(manager, 2n)]);
    const scanner = service(rpc, [adapter]);
    const first = await scanner.scan({
      address: owner,
      chainId: 56,
      cursor: null,
      helperAddress: null,
      limit: 1,
      platformId: null,
      userId,
      walletId,
    });
    const cursor = first.cursor!;
    const payload = JSON.parse(
      Buffer.from(cursor.split(".")[0]!, "base64url").toString(),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      blockHash: snapshot.blockHash,
      blockNumber: snapshot.blockNumber,
      chainId: 56,
      platformId: null,
      registryVersion: "p05-bsc-execution-v1",
      userId,
      walletId,
    });

    const base = {
      address: owner,
      chainId: 56 as const,
      cursor,
      helperAddress: null,
      limit: 1,
      platformId: null,
      userId,
      walletId,
    };
    for (const changed of [
      { ...base, userId: "62000000-0000-4000-8000-000000000002" },
      { ...base, walletId: "62000000-0000-4000-8000-000000000012" },
      { ...base, platformId: 1 as const },
      { ...base, cursor: `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}` },
    ]) {
      await expect(scanner.scan(changed)).rejects.toBeInstanceOf(PositionCursorError);
    }
  });

  it("isolates provider, code-hash, owner/ABI, and unknown-manager failures", async () => {
    const rpc = new FakeRpc();
    const one = new FakeAdapter(1);
    const two = new FakeAdapter(2);
    const four = new FakeAdapter(4);
    const five = new FakeAdapter(5);
    one.failures.set("1", new PositionReadAdapterError("position-manager-code-hash-mismatch"));
    five.failures.set("11", new PositionReadAdapterError("abi-decode-failed"));
    rpc.logs.set(one.deployment.positionManager.address, [
      transferLog(one.deployment.positionManager.address, 1n),
    ]);
    rpc.logFailures.add(two.deployment.positionManager.address);
    rpc.logs.set(four.deployment.positionManager.address, [
      transferLog(four.deployment.positionManager.address, 9n),
    ]);
    rpc.logs.set(five.deployment.positionManager.address, [
      transferLog(five.deployment.positionManager.address, 10n, { observedAddress: otherOwner }),
      transferLog(five.deployment.positionManager.address, 11n),
    ]);

    const page = await service(rpc, [one, two, four, five]).scan({
      address: owner,
      chainId: 56,
      cursor: null,
      helperAddress: null,
      limit: 20,
      platformId: null,
      userId,
      walletId,
    });
    expect(page.status).toBe("partial");
    expect(page.items.map(({ platformId, tokenId }) => [platformId, tokenId])).toEqual([[4, "9"]]);
    expect(page.coverage).toEqual({
      complete: false,
      failedPlatformIds: [1, 2, 5],
      scannedPlatformIds: [1, 4, 5],
    });
    expect(page.quarantined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platformId: 1,
          reason: "position-manager-code-hash-mismatch",
          tokenId: "1",
        }),
        expect.objectContaining({ platformId: 2, reason: "provider-read-failed", tokenId: null }),
        expect.objectContaining({
          platformId: 5,
          reason: "unknown-position-manager",
          tokenId: "10",
        }),
        expect.objectContaining({ platformId: 5, reason: "abi-decode-failed", tokenId: "11" }),
      ]),
    );
  });

  it("discards scanned positions when the canonical hash changes", async () => {
    const rpc = new FakeRpc();
    rpc.reorgAfterRead = true;
    const adapter = new FakeAdapter(1);
    rpc.logs.set(adapter.deployment.positionManager.address, [
      transferLog(adapter.deployment.positionManager.address, 1n),
    ]);
    const page = await service(rpc, [adapter]).scan({
      address: owner,
      chainId: 56,
      cursor: null,
      helperAddress: null,
      limit: 20,
      platformId: null,
      userId,
      walletId,
    });
    expect(page).toMatchObject({ cursor: null, items: [], quarantined: [], status: "stale" });
    expect(page.coverage.complete).toBe(false);
  });

  it("returns quarantined rather than empty when every discovered NFT is unverified", async () => {
    const rpc = new FakeRpc();
    const adapter = new FakeAdapter(2);
    adapter.failures.set("7", new PositionReadAdapterError("owner-mismatch"));
    rpc.logs.set(adapter.deployment.positionManager.address, [
      transferLog(adapter.deployment.positionManager.address, 7n),
    ]);
    const page = await service(rpc, [adapter]).scan({
      address: owner,
      chainId: 56,
      cursor: null,
      helperAddress: null,
      limit: 20,
      platformId: 2,
      userId,
      walletId,
    });
    expect(page.status).toBe("quarantined");
    expect(page.items).toEqual([]);
    expect(page.quarantined).toEqual([
      expect.objectContaining({ platformId: 2, reason: "owner-mismatch", tokenId: "7" }),
    ]);
  });

  it("keeps the public DTO structurally assignable to the frozen API contract", () => {
    const value = position(deployment(1), "1", snapshot);
    const dto: WalletPosition = value;
    expect(dto.liquidity.raw).toBe("1000000");
  });
});
