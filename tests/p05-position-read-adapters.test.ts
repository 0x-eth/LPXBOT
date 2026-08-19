import {
  PancakeV3PositionReadAdapter,
  PancakeV4PositionReadAdapter,
  PCSV3_FACTORY_READ_ABI,
  PCSV3_POOL_READ_ABI,
  PCSV3_POSITION_MANAGER_READ_ABI,
  PCSV4_POOL_MANAGER_READ_ABI,
  PCSV4_POSITION_MANAGER_READ_ABI,
  PositionReadAdapterError,
  UniswapV3PositionReadAdapter,
  UniswapV4PositionReadAdapter,
  UNIV3_FACTORY_READ_ABI,
  UNIV3_POOL_READ_ABI,
  UNIV3_POSITION_MANAGER_READ_ABI,
  UNIV4_POOL_MANAGER_READ_ABI,
  UNIV4_POSITION_MANAGER_READ_ABI,
  type PositionReadAdapter,
  type PositionReadRpc,
  type PositionReadSnapshot,
} from "../packages/chain-adapters/src/index.js";
import {
  BSC_POSITION_READ_REGISTRY,
  type BscPositionReadDeployment,
} from "../packages/chain-registry/src/index.js";
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

const owner = "0x1111111111111111111111111111111111111111" as const;
const helper = "0x2222222222222222222222222222222222222222" as const;
const token0 = "0x0000000000000000000000000000000000000010" as const;
const token1 = "0x0000000000000000000000000000000000000020" as const;
const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const snapshot: PositionReadSnapshot = {
  blockHash: `0x${"ab".repeat(32)}`,
  blockNumber: "116718500",
  blockTimestamp: "2026-08-19T01:00:00.000Z",
};
const fixtureCode = "0x60006000" as const;

interface FixtureCall {
  blockNumber: string;
  data: Hex;
  to: Address;
}

class FixtureRpc implements PositionReadRpc {
  readonly calls: FixtureCall[] = [];
  readonly codeReads: Array<{ address: Address; blockNumber: string }> = [];
  readonly #responses = new Map<string, Hex>();

  add(abi: Abi, address: Address, functionName: string, args: readonly unknown[], result: unknown) {
    const data = encodeFunctionData({ abi, args, functionName });
    const encoded = encodeFunctionResult({ abi, functionName, result });
    this.#responses.set(`${address.toLowerCase()}:${data.toLowerCase()}`, encoded);
  }

  async call(input: FixtureCall): Promise<Hex> {
    this.calls.push(input);
    const response = this.#responses.get(`${input.to.toLowerCase()}:${input.data.toLowerCase()}`);
    if (!response) throw new Error("fixture call missing");
    return response;
  }

  async getBalance(): Promise<bigint> {
    return 0n;
  }

  async getBlock(): Promise<PositionReadSnapshot> {
    return snapshot;
  }

  async getCode(address: Address, blockNumber: string): Promise<Hex> {
    this.codeReads.push({ address, blockNumber });
    return fixtureCode;
  }

  async getLogs(): Promise<[]> {
    return [];
  }
}

function deployment(platformId: 1 | 2 | 4 | 5): BscPositionReadDeployment {
  const registered = BSC_POSITION_READ_REGISTRY.deployments.find(
    (candidate) => candidate.platformId === platformId,
  )!;
  return {
    ...registered,
    positionManager: { ...registered.positionManager, runtimeCodeHash: keccak256(fixtureCode) },
  };
}

function addErc721Reads(
  rpc: FixtureRpc,
  abi: Abi,
  manager: Address,
  tokenId: bigint,
  observedOwner: Address = owner,
) {
  rpc.add(abi, manager, "ownerOf", [tokenId], observedOwner);
  rpc.add(abi, manager, "getApproved", [tokenId], helper);
  rpc.add(abi, manager, "isApprovedForAll", [owner, helper], true);
}

function v3Fixture(platformId: 1 | 2) {
  const registered = deployment(platformId);
  const managerAbi =
    platformId === 1 ? UNIV3_POSITION_MANAGER_READ_ABI : PCSV3_POSITION_MANAGER_READ_ABI;
  const factoryAbi = platformId === 1 ? UNIV3_FACTORY_READ_ABI : PCSV3_FACTORY_READ_ABI;
  const poolAbi = platformId === 1 ? UNIV3_POOL_READ_ABI : PCSV3_POOL_READ_ABI;
  const pool = `0x00000000000000000000000000000000000010${String(platformId).padStart(2, "0")}` as Address;
  const tokenId = BigInt(100 + platformId);
  const rpc = new FixtureRpc();
  addErc721Reads(rpc, managerAbi, registered.positionManager.address, tokenId);
  rpc.add(
    managerAbi,
    registered.positionManager.address,
    "positions",
    [tokenId],
    [0n, zeroAddress, token0, token1, 3_000, -60, 60, 1_000_000n, 0n, 0n, 17n, 19n],
  );
  rpc.add(factoryAbi, registered.factory!.address, "getPool", [token0, token1, 3_000], pool);
  rpc.add(poolAbi, pool, "slot0", [], [2n ** 96n, 0, 0, 1, 1, 0, true]);
  rpc.add(poolAbi, pool, "tickSpacing", [], 60);
  return {
    adapter:
      platformId === 1
        ? new UniswapV3PositionReadAdapter({ deployment: registered, rpc })
        : new PancakeV3PositionReadAdapter({ deployment: registered, rpc }),
    expectedPoolId: null,
    expectedPoolAddress: pool.toLowerCase(),
    rpc,
    tokenId,
  };
}

function packedPositionInfo(lower: number, upper: number): bigint {
  const word = (value: number) => BigInt.asUintN(24, BigInt(value));
  return (word(upper) << 32n) | (word(lower) << 8n);
}

function v4Fixture(platformId: 4 | 5) {
  const registered = deployment(platformId);
  const managerAbi =
    platformId === 4 ? UNIV4_POSITION_MANAGER_READ_ABI : PCSV4_POSITION_MANAGER_READ_ABI;
  const poolManagerAbi =
    platformId === 4 ? UNIV4_POOL_MANAGER_READ_ABI : PCSV4_POOL_MANAGER_READ_ABI;
  const tokenId = BigInt(100 + platformId);
  const rpc = new FixtureRpc();
  addErc721Reads(rpc, managerAbi, registered.positionManager.address, tokenId);
  const parameters = `0x${(60n << 16n).toString(16).padStart(64, "0")}` as Hex;
  const poolKey =
    platformId === 4
      ? [token0, token1, 3_000, 60, zeroAddress]
      : [token0, token1, zeroAddress, registered.poolManager!.address, 2_500, parameters];
  rpc.add(
    managerAbi,
    registered.positionManager.address,
    "getPoolAndPositionInfo",
    [tokenId],
    [poolKey, packedPositionInfo(-60, 60)],
  );
  rpc.add(
    managerAbi,
    registered.positionManager.address,
    "getPositionLiquidity",
    [tokenId],
    1_000_000n,
  );
  const poolId =
    platformId === 4
      ? "0xb7a0fb68b2b106d2ad386d2221acbdb3b027b737f097dfbb8a854fa3cc08fcf2"
      : "0x7e4bd1a36123770dcf54bda7f8367fd22717babb0baf6980ac88708bda9e8e9f";
  if (platformId === 4) {
    const poolsSlot = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, 6n]),
    );
    const packedSlot0 = `0x${((3_000n << 208n) | (2n ** 96n)).toString(16).padStart(64, "0")}`;
    rpc.add(poolManagerAbi, registered.poolManager!.address, "extsload", [poolsSlot], packedSlot0);
  } else {
    rpc.add(
      poolManagerAbi,
      registered.poolManager!.address,
      "getSlot0",
      [poolId],
      [2n ** 96n, 0, 0, 2_500],
    );
  }
  return {
    adapter:
      platformId === 4
        ? new UniswapV4PositionReadAdapter({ deployment: registered, rpc })
        : new PancakeV4PositionReadAdapter({ deployment: registered, rpc }),
    expectedPoolAddress: null,
    expectedPoolId: poolId,
    rpc,
    tokenId,
  };
}

describe("P05-02 official BSC PositionManager read adapters", () => {
  it("keeps four independent manager and pool ABI definitions", () => {
    expect(UNIV3_POSITION_MANAGER_READ_ABI).not.toBe(PCSV3_POSITION_MANAGER_READ_ABI);
    expect(UNIV4_POSITION_MANAGER_READ_ABI).not.toBe(PCSV4_POSITION_MANAGER_READ_ABI);
    expect(UNIV3_POOL_READ_ABI).not.toBe(PCSV3_POOL_READ_ABI);
    expect(UNIV4_POOL_MANAGER_READ_ABI).not.toBe(PCSV4_POOL_MANAGER_READ_ABI);
  });

  it.each([1, 2, 4, 5] as const)(
    "reads platformId %s owner, ticks, liquidity, fees, and approval at one block",
    async (platformId) => {
      const fixture = platformId < 4 ? v3Fixture(platformId) : v4Fixture(platformId);
      const position = await (fixture.adapter as PositionReadAdapter).readPosition({
        helperAddress: helper,
        owner,
        snapshot,
        tokenId: fixture.tokenId.toString(),
      });

      expect(position).toMatchObject({
        approval: {
          approvedAddress: helper,
          approvedForAll: true,
          helperAuthorized: true,
          nftOwner: owner,
          observedAtBlock: snapshot.blockNumber,
        },
        chainId: 56,
        fees: {
          estimated0BaseUnit: null,
          estimated1BaseUnit: null,
          owed0BaseUnit: platformId < 4 ? "17" : "0",
          owed1BaseUnit: platformId < 4 ? "19" : "0",
        },
        liquidity: {
          amount0BaseUnit: "2995",
          amount1BaseUnit: "2995",
          raw: "1000000",
        },
        owner,
        platformId,
        pool: {
          poolAddress: fixture.expectedPoolAddress,
          poolId: fixture.expectedPoolId,
          token0,
          token1,
        },
        ticks: { current: "0", inRange: true, lower: "-60", upper: "60" },
        tokenId: fixture.tokenId.toString(),
      });
      expect(Object.isFrozen(position)).toBe(true);
      expect(Object.isFrozen(position.pool)).toBe(true);
      expect(fixture.rpc.calls.every((call) => call.blockNumber === snapshot.blockNumber)).toBe(true);
      expect(fixture.rpc.codeReads).toEqual([
        {
          address: BSC_POSITION_READ_REGISTRY.deployments[platformId === 1 ? 0 : platformId === 2 ? 1 : platformId === 4 ? 2 : 3]!
            .positionManager.address,
          blockNumber: snapshot.blockNumber,
        },
      ]);
    },
  );

  it("quarantines a mismatched Manager code hash, owner mismatch, and malformed ABI response", async () => {
    const wrongCode = v3Fixture(1);
    wrongCode.adapter = new UniswapV3PositionReadAdapter({
      deployment: BSC_POSITION_READ_REGISTRY.deployments[0]!,
      rpc: wrongCode.rpc,
    });
    await expect(
      wrongCode.adapter.readPosition({
        helperAddress: helper,
        owner,
        snapshot,
        tokenId: wrongCode.tokenId.toString(),
      }),
    ).rejects.toMatchObject<Partial<PositionReadAdapterError>>({
      reason: "position-manager-code-hash-mismatch",
    });

    const wrongOwner = v3Fixture(2);
    const manager = deployment(2).positionManager.address;
    wrongOwner.rpc.add(
      PCSV3_POSITION_MANAGER_READ_ABI,
      manager,
      "ownerOf",
      [wrongOwner.tokenId],
      zeroAddress,
    );
    await expect(
      wrongOwner.adapter.readPosition({
        helperAddress: helper,
        owner,
        snapshot,
        tokenId: wrongOwner.tokenId.toString(),
      }),
    ).rejects.toMatchObject<Partial<PositionReadAdapterError>>({ reason: "owner-mismatch" });

    const malformed = v4Fixture(4);
    malformed.rpc.add(
      UNIV4_POSITION_MANAGER_READ_ABI,
      deployment(4).positionManager.address,
      "getPositionLiquidity",
      [malformed.tokenId],
      1n,
    );
    const liquiditySelector = encodeFunctionData({
      abi: UNIV4_POSITION_MANAGER_READ_ABI,
      args: [malformed.tokenId],
      functionName: "getPositionLiquidity",
    }).slice(0, 10);
    const originalCall = malformed.rpc.call.bind(malformed.rpc);
    malformed.rpc.call = async (input) =>
      input.data.startsWith(liquiditySelector) ? "0x01" : originalCall(input);
    await expect(
      malformed.adapter.readPosition({
        helperAddress: helper,
        owner,
        snapshot,
        tokenId: malformed.tokenId.toString(),
      }),
    ).rejects.toMatchObject<Partial<PositionReadAdapterError>>({ reason: "abi-decode-failed" });
  });
});
