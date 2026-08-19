import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import { P05_LOCAL_POSITION_EXECUTION_REGISTRY } from "../../packages/chain-registry/src/index.js";
import {
  buildLocalPositionSnapshot,
  LocalPositionExecutionService,
  MemoryLocalPositionOperationStore,
  MemoryLocalPositionPreviewStore,
  MemoryLocalPositionSnapshotStore,
  ViemLocalPositionExecutionChainReader,
} from "../../apps/api/src/index.js";
import {
  decideLocalPositionObservation,
  ViemLocalPositionObserver,
  type LocalPositionStepWorkOperation,
  type LocalPositionTransactionReference,
} from "../../apps/worker/src/index.js";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_ANVIL_INTEGRATION === "1";
const chainId = 31_337;
const registry = P05_LOCAL_POSITION_EXECUTION_REGISTRY;
const ownerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const adminPrivateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

interface ForgeArtifact {
  abi: Abi;
  bytecode: { object: Hex };
}

const erc20Abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
const wbnbAbi = parseAbi(["function deposit() payable"]);
const managerAbi = parseAbi([
  "function nextTokenId() view returns (uint256)",
  "function mintFixture((address owner,uint8 platformId,address token0,address token1,address poolAddress,bytes32 poolId,int24 tickLower,int24 tickUpper,int24 tickSpacing,uint24 feePips,uint128 liquidity,uint128 reserve0,uint128 reserve1,uint128 tokensOwed0,uint128 tokensOwed1) fixture) returns (uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address owner)",
  "function getApproved(uint256 tokenId) view returns (address approved)",
  "function positions(uint256 tokenId) view returns ((uint8 platformId,address token0,address token1,address poolAddress,bytes32 poolId,int24 tickLower,int24 tickUpper,int24 tickSpacing,uint24 feePips,uint128 liquidity,uint128 reserve0,uint128 reserve1,uint128 tokensOwed0,uint128 tokensOwed1) position)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) returns (uint256 amount0,uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) returns (uint256 amount0,uint256 amount1)",
  "function burn(uint256 tokenId)",
]);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port allocation failed");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function rpc<T>(url: string, method: string, params: readonly unknown[]): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = (await response.json()) as { error?: unknown; result?: T };
  if (!response.ok || body.error || body.result === undefined) {
    throw new Error(`Anvil RPC failed: ${method}`);
  }
  return body.result;
}

async function waitForRpc(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await rpc<string>(url, "eth_chainId", [])) === "0x7a69") return;
    } catch {
      // The isolated local process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Anvil did not become ready");
}

async function artifact(path: string): Promise<ForgeArtifact> {
  return JSON.parse(await readFile(path, "utf8")) as ForgeArtifact;
}

describe.skipIf(!enabled)("P05-07 local Anvil position execution closure", () => {
  let anvil: ChildProcess | undefined;
  let rpcUrl = "";

  beforeAll(async () => {
    execFileSync("forge", ["build"], { stdio: "pipe" });
    const port = await freePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    anvil = spawn(
      "anvil",
      ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--silent"],
      { stdio: "ignore" },
    );
    await waitForRpc(rpcUrl);
  });

  afterAll(() => anvil?.kill("SIGTERM"));

  it("executes V3/V4 collect, partial/full exits and reconciles an opaque ordered plan", async () => {
    const chain = defineChain({
      id: chainId,
      name: "LPBOT local Position Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const owner = privateKeyToAccount(ownerPrivateKey);
    const admin = privateKeyToAccount(adminPrivateKey);
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account: owner, chain, transport: http(rpcUrl) });
    const [token, wbnb, permit2, router, oldPosition, adapter, managerV2] = await Promise.all([
      artifact("contracts/out/TestOnlyERC20.sol/TestOnlyERC20.json"),
      artifact("contracts/out/TestOnlyWBNB.sol/TestOnlyWBNB.json"),
      artifact("contracts/out/TestOnlyPermit2.sol/TestOnlyPermit2.json"),
      artifact("contracts/out/TestOnlySwapRouter.sol/TestOnlySwapRouter.json"),
      artifact("contracts/out/TestOnlyPositionManager.sol/TestOnlyPositionManager.json"),
      artifact("contracts/out/LocalExecutionAdapter.sol/LocalExecutionAdapter.json"),
      artifact("contracts/out/TestOnlyPositionManagerV2.sol/TestOnlyPositionManagerV2.json"),
    ]);
    const deploy = async (input: { abi: Abi; args?: readonly unknown[]; bytecode: Hex }) => {
      const hash = await walletClient.deployContract({
        abi: input.abi,
        ...(input.args ? { args: input.args } : {}),
        bytecode: input.bytecode,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress || receipt.status !== "success") {
        throw new Error("fixture deployment failed");
      }
      return receipt.contractAddress.toLowerCase() as `0x${string}`;
    };
    const token0 = await deploy({
      abi: token.abi,
      args: [1_000_000_000n],
      bytecode: token.bytecode.object,
    });
    const token1 = await deploy({ abi: wbnb.abi, bytecode: wbnb.bytecode.object });
    const permit2Address = await deploy({ abi: permit2.abi, bytecode: permit2.bytecode.object });
    const routerAddress = await deploy({ abi: router.abi, bytecode: router.bytecode.object });
    const oldPositionAddress = await deploy({
      abi: oldPosition.abi,
      bytecode: oldPosition.bytecode.object,
    });
    await deploy({
      abi: adapter.abi,
      args: [routerAddress, oldPositionAddress],
      bytecode: adapter.bytecode.object,
    });
    await deploy({ abi: oldPosition.abi, bytecode: oldPosition.bytecode.object });
    const manager = await deploy({ abi: managerV2.abi, bytecode: managerV2.bytecode.object });
    expect([token0, token1]).toEqual(registry.tokenPolicy.tokens.map(({ address }) => address));
    expect(permit2Address).not.toBe(manager);
    expect(manager).toBe(registry.manager.address);
    const managerCode = await publicClient.getCode({ address: manager });
    expect(managerCode && keccak256(managerCode)).toBe(registry.manager.runtimeCodeHash);

    const deposit = await walletClient.writeContract({
      abi: wbnbAbi,
      address: token1,
      functionName: "deposit",
      value: 10_000_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: deposit });
    for (const tokenAddress of [token0, token1]) {
      const hash = await walletClient.writeContract({
        abi: erc20Abi,
        address: tokenAddress,
        args: [manager, 1_000_000_000n],
        functionName: "approve",
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    const waitWrite = async (promise: Promise<Hex>) => {
      const hash = await promise;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
      return hash;
    };
    const mint = async (platformId: 1 | 2 | 4 | 5, liquidity = 101n) => {
      const tokenId = await publicClient.readContract({
        abi: managerAbi,
        address: manager,
        functionName: "nextTokenId",
      });
      const v3 = platformId === 1 || platformId === 2;
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [
            {
              feePips: 3000,
              liquidity,
              owner: owner.address,
              platformId,
              poolAddress: v3 ? "0x0000000000000000000000000000000000001234" : zeroAddress,
              poolId: v3
                ? (`0x${"00".repeat(32)}` as Hex)
                : (`0x${platformId.toString(16).padStart(64, "0")}` as Hex),
              reserve0: 1001n,
              reserve1: 2003n,
              tickLower: -120,
              tickSpacing: 60,
              tickUpper: 120,
              token0,
              token1,
              tokensOwed0: 11n,
              tokensOwed1: 13n,
            },
          ],
          functionName: "mintFixture",
        }),
      );
      return tokenId;
    };
    const balances = async (): Promise<readonly [bigint, bigint]> =>
      Promise.all([
        publicClient.readContract({
          abi: erc20Abi,
          address: token0,
          args: [owner.address],
          functionName: "balanceOf",
        }),
        publicClient.readContract({
          abi: erc20Abi,
          address: token1,
          args: [owner.address],
          functionName: "balanceOf",
        }),
      ]);
    const position = (tokenId: bigint) =>
      publicClient.readContract({
        abi: managerAbi,
        address: manager,
        args: [tokenId],
        functionName: "positions",
      });
    const deadline = BigInt(Math.floor(Date.now() / 1_000) + 3_600);

    for (const platformId of [1, 2, 4, 5] as const) {
      const collectId = await mint(platformId);
      const collectBefore = await balances();
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [
            { amount0Max: 11n, amount1Max: 13n, recipient: owner.address, tokenId: collectId },
          ],
          functionName: "collect",
        }),
      );
      const collectAfter = await balances();
      expect([collectAfter[0] - collectBefore[0], collectAfter[1] - collectBefore[1]]).toEqual([
        11n,
        13n,
      ]);
      expect((await position(collectId)).liquidity).toBe(101n);
      expect(
        await publicClient.readContract({
          abi: managerAbi,
          address: manager,
          args: [collectId],
          functionName: "ownerOf",
        }),
      ).toBe(owner.address);

      const partialId = await mint(platformId);
      const partialBefore = await balances();
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [
            { amount0Min: 244n, amount1Min: 490n, deadline, liquidity: 25n, tokenId: partialId },
          ],
          functionName: "decreaseLiquidity",
        }),
      );
      expect(await balances()).toEqual(partialBefore);
      const decreased = await position(partialId);
      expect(decreased).toMatchObject({ liquidity: 76n, tokensOwed0: 258n, tokensOwed1: 508n });
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [
            { amount0Max: 258n, amount1Max: 508n, recipient: owner.address, tokenId: partialId },
          ],
          functionName: "collect",
        }),
      );
      const partialAfter = await balances();
      expect([partialAfter[0] - partialBefore[0], partialAfter[1] - partialBefore[1]]).toEqual([
        258n,
        508n,
      ]);

      const fullId = await mint(platformId);
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [
            { amount0Min: 991n, amount1Min: 1982n, deadline, liquidity: 101n, tokenId: fullId },
          ],
          functionName: "decreaseLiquidity",
        }),
      );
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [
            { amount0Max: 1012n, amount1Max: 2016n, recipient: owner.address, tokenId: fullId },
          ],
          functionName: "collect",
        }),
      );
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [fullId],
          functionName: "burn",
        }),
      );
      await expect(
        publicClient.readContract({
          abi: managerAbi,
          address: manager,
          args: [fullId],
          functionName: "ownerOf",
        }),
      ).rejects.toThrow();
    }

    for (const [percent, expectedDelta] of [
      [1, 1n],
      [25, 25n],
      [50, 50n],
      [99, 99n],
      [100, 101n],
    ] as const) {
      const tokenId = await mint(2);
      await waitWrite(
        walletClient.writeContract({
          abi: managerAbi,
          address: manager,
          args: [{ amount0Min: 0n, amount1Min: 0n, deadline, liquidity: expectedDelta, tokenId }],
          functionName: "decreaseLiquidity",
        }),
      );
      expect((await position(tokenId)).liquidity).toBe(101n - expectedDelta);
      expect(Number(percent)).toBeGreaterThan(0);
    }

    const injectionId = await mint(1);
    await expect(
      publicClient.simulateContract({
        account: owner,
        abi: managerAbi,
        address: manager,
        args: [
          { amount0Max: 11n, amount1Max: 13n, recipient: admin.address, tokenId: injectionId },
        ],
        functionName: "collect",
      }),
    ).rejects.toThrow();
    await expect(
      publicClient.simulateContract({
        account: admin,
        abi: managerAbi,
        address: manager,
        args: [
          { amount0Max: 11n, amount1Max: 13n, recipient: owner.address, tokenId: injectionId },
        ],
        functionName: "collect",
      }),
    ).rejects.toThrow();
    await expect(
      publicClient.simulateContract({
        account: owner,
        abi: managerAbi,
        address: manager,
        args: [
          { amount0Min: 248n, amount1Min: 496n, deadline, liquidity: 25n, tokenId: injectionId },
        ],
        functionName: "decreaseLiquidity",
      }),
    ).rejects.toThrow();
    await expect(
      publicClient.simulateContract({
        account: owner,
        abi: managerAbi,
        address: manager,
        args: [
          { amount0Min: 0n, amount1Min: 0n, deadline: 1n, liquidity: 25n, tokenId: injectionId },
        ],
        functionName: "decreaseLiquidity",
      }),
    ).rejects.toThrow();

    const plannedId = await mint(5);
    const plannedPosition = await position(plannedId);
    const block = await publicClient.getBlock();
    const observedAt = new Date(Number(block.timestamp) * 1_000);
    const wallet: CustodyWallet = {
      address: owner.address.toLowerCase() as `0x${string}`,
      createdAt: observedAt.toISOString(),
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: "Anvil Position owner",
      revision: 1,
      updatedAt: observedAt.toISOString(),
      walletId: "a7400000-0000-4000-8000-000000000001",
    };
    const snapshot = buildLocalPositionSnapshot({
      block: {
        hash: block.hash,
        number: block.number.toString(),
        timestamp: observedAt.toISOString(),
      },
      chainId: 31_337,
      expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
      manager: structuredClone(registry.manager),
      observedAt: observedAt.toISOString(),
      position: {
        approval: { approvedAddress: null, approvedForAll: false, operator: null },
        liquidity: plannedPosition.liquidity.toString(),
        owner: wallet.address,
        platformId: 5,
        pool: {
          feePips: plannedPosition.feePips.toString(),
          poolAddress: null,
          poolId: plannedPosition.poolId,
          tickSpacing: plannedPosition.tickSpacing.toString(),
          token0,
          token1,
        },
        reserve0BaseUnit: plannedPosition.reserve0.toString(),
        reserve1BaseUnit: plannedPosition.reserve1.toString(),
        ticks: {
          lower: plannedPosition.tickLower.toString(),
          upper: plannedPosition.tickUpper.toString(),
        },
        tokenId: plannedId.toString(),
        tokensOwed0BaseUnit: plannedPosition.tokensOwed0.toString(),
        tokensOwed1BaseUnit: plannedPosition.tokensOwed1.toString(),
      },
      registry: { digest: registry.registryDigest, version: registry.registryVersion },
      tokens: [
        {
          address: registry.tokenPolicy.tokens[0]!.address,
          runtimeCodeHash: registry.tokenPolicy.tokens[0]!.runtimeCodeHash,
        },
        {
          address: registry.tokenPolicy.tokens[1]!.address,
          runtimeCodeHash: registry.tokenPolicy.tokens[1]!.runtimeCodeHash,
        },
      ],
      wallet: { address: wallet.address, walletId: wallet.walletId },
    });
    const providers = [
      { providerId: "anvil-position-a", rpcUrl },
      { providerId: "anvil-position-b", rpcUrl },
    ] as const;
    const reader = new ViemLocalPositionExecutionChainReader({ chainId, providers });
    const inspected = await reader.inspect({ snapshot, walletAddress: wallet.address });
    expect(inspected.manager.runtimeCodeHash).toBe(registry.manager.runtimeCodeHash);
    const operations = new MemoryLocalPositionOperationStore({ now: () => observedAt });
    const service = new LocalPositionExecutionService({
      chain: reader,
      now: () => observedAt,
      operations,
      previews: new MemoryLocalPositionPreviewStore(),
      snapshots: new MemoryLocalPositionSnapshotStore([
        { snapshot, tenantId: "anvil-position", userId: "a7400000-0000-4000-8000-000000000002" },
      ]),
    });
    const request = {
      burnIfEmpty: true,
      percent: 100,
      platformId: 5 as const,
      slippageBps: 100,
      snapshotDigest: snapshot.snapshotDigest,
      tokenId: plannedId.toString(),
      walletId: wallet.walletId,
    };
    const preview = await service.previewRemoveLiquidity({
      request,
      tenantId: "anvil-position",
      userId: "a7400000-0000-4000-8000-000000000002",
      wallet,
    });
    const submitted = await service.removeLiquidity({
      idempotencyKey: "anvil-position-opaque-plan-0001",
      request: {
        ...request,
        previewDigest: preview.previewDigest,
        previewToken: preview.previewToken,
      },
      requestId: "anvil-position-plan",
      sessionId: "a7400000-0000-4000-8000-000000000003",
      tenantId: "anvil-position",
      userId: "a7400000-0000-4000-8000-000000000002",
      wallet,
    });
    const stored = await operations.get({
      operationId: submitted.operation.operationId,
      tenantId: "anvil-position",
      userId: "a7400000-0000-4000-8000-000000000002",
    });
    if (!stored) throw new Error("opaque position plan was not stored");
    const observer = new ViemLocalPositionObserver({ chainId, providers });
    const succeeded: string[] = [];
    for (const step of stored.plan.steps) {
      const hash = await walletClient.sendTransaction({
        data: step.transaction.data,
        nonce: Number(step.nonce),
        to: step.transaction.to,
        value: 0n,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const transaction: LocalPositionTransactionReference = {
        active: true,
        dataDigest: step.transaction.dataDigest,
        fee: { maxFeePerGasBaseUnit: "2000000000", maxPriorityFeePerGasBaseUnit: "1000000000" },
        generation: 0,
        nonce: step.nonce,
        planDigest: stored.plan.planDigest,
        semanticDigest: step.semanticDigest,
        target: step.transaction.to,
        transactionHash: hash,
        transactionId: `a7400000-0000-4000-8000-00000000001${step.ordinal}`,
        updatedAt: observedAt.toISOString(),
      };
      const operation: LocalPositionStepWorkOperation = {
        activeTransaction: transaction,
        operationId: stored.plan.operationId,
        operationState: "pending",
        plan: stored.plan,
        planDigest: stored.plan.planDigest,
        priorSucceededStepIds: succeeded,
        reauthenticatedSessionId: null,
        step,
        stepState: "pending",
        tenantId: "anvil-position",
        transactionLineage: [transaction],
        userId: "a7400000-0000-4000-8000-000000000002",
      };
      const decision = decideLocalPositionObservation({
        dropAfterMilliseconds: 1_000,
        now: new Date(observedAt.getTime() + 1_000),
        observation: await observer.observe({ plan: stored.plan, step, transactionHash: hash }),
        operation,
        requiredConfirmations: 1,
      });
      expect(decision).toMatchObject({
        next: step.kind === "burn" ? "complete-success" : "advance",
        stepState: "succeeded",
      });
      succeeded.push(step.stepId);
    }
  });
});
