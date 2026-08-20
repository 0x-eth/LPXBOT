import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import {
  buildWalletHelperV1DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
} from "../../packages/chain-registry/src/index.js";
import type { LocalHelperSweepBinding } from "../../packages/domain/src/local-helper-sweep.js";
import {
  LocalHelperSweepService,
  MemoryLocalHelperResidualSnapshotStore,
  MemoryLocalHelperSweepBindingStore,
  MemoryLocalHelperSweepOperationStore,
  MemoryLocalHelperSweepPreviewStore,
  ViemLocalHelperResidualChainReader,
} from "../../apps/api/src/index.js";
import {
  IsolatedWalletSigner,
  LocalKmsFixture,
  type RawTransactionDelivery,
  type StoredCustodyWallet,
} from "../../apps/signer/src/index.js";
import {
  decideLocalHelperSweepObservation,
  ViemLocalHelperSweepObserver,
  type LocalHelperSweepTransactionReference,
  type LocalHelperSweepWorkOperation,
} from "../../apps/worker/src/index.js";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_ANVIL_INTEGRATION === "1";
const chainId = 31_337;
const tenantId = "tenant-fixture-01";
const userId = randomUUID();
const walletId = randomUUID();
const sessionId = randomUUID();
const ownerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;

interface ForgeArtifact {
  abi: Abi;
  bytecode: { object: Hex };
}

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
  const body = (await response.json()) as {
    error?: { code: number; message: string };
    result?: T;
  };
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
      // The local process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Anvil did not become ready");
}

async function artifact(path: string): Promise<ForgeArtifact> {
  return JSON.parse(await readFile(path, "utf8")) as ForgeArtifact;
}

describe.skipIf(!enabled)("P05-08 local Anvil Helper residual sweep closure", () => {
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

  afterAll(() => {
    anvil?.kill("SIGTERM");
  });

  it("sweeps native, TestOnlyERC20, WBNB, and a mixed batch through canonical rescan", async () => {
    const localChain = defineChain({
      id: chainId,
      name: "LPBOT Helper sweep local Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const owner = privateKeyToAccount(ownerPrivateKey);
    const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account: owner,
      chain: localChain,
      transport: http(rpcUrl),
    });
    const [token, wbnb, permit2, router, position, adapter, managerV2] = await Promise.all([
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
      return receipt.contractAddress.toLowerCase() as Address;
    };

    const tokenAddress = await deploy({
      abi: token.abi,
      args: [1_000_000_000n],
      bytecode: token.bytecode.object,
    });
    const wbnbAddress = await deploy({ abi: wbnb.abi, bytecode: wbnb.bytecode.object });
    const permit2Address = await deploy({ abi: permit2.abi, bytecode: permit2.bytecode.object });
    const routerAddress = await deploy({ abi: router.abi, bytecode: router.bytecode.object });
    const positionAddress = await deploy({
      abi: position.abi,
      bytecode: position.bytecode.object,
    });
    const adapterAddress = await deploy({
      abi: adapter.abi,
      args: [routerAddress, positionAddress],
      bytecode: adapter.bytecode.object,
    });
    expect([tokenAddress, wbnbAddress]).toEqual(registry.tokens.map(({ address }) => address));
    expect(permit2Address).toBe(
      registry.components.find(({ role }) => role === "permit2")!.address,
    );
    expect(adapterAddress).toBe(
      registry.components.find(({ role }) => role === "adapter")!.address,
    );

    const helperMaterial = buildWalletHelperV1DeploymentMaterial(
      owner.address.toLowerCase() as Address,
    );
    const helperDeploymentHash = await walletClient.sendTransaction({
      data: helperMaterial.initCode,
    });
    const helperDeploymentReceipt = await publicClient.waitForTransactionReceipt({
      hash: helperDeploymentHash,
    });
    if (!helperDeploymentReceipt.contractAddress || helperDeploymentReceipt.status !== "success") {
      throw new Error("P05-05 WalletHelperV1 deployment failed");
    }
    const helperAddress = helperDeploymentReceipt.contractAddress.toLowerCase() as Address;

    await deploy({ abi: position.abi, bytecode: position.bytecode.object });
    const managerAddress = await deploy({
      abi: managerV2.abi,
      bytecode: managerV2.bytecode.object,
    });
    expect(managerAddress).toBe(
      registry.components.find(({ role }) => role === "manager")!.address,
    );
    for (const expected of [...registry.tokens, ...registry.components]) {
      const code = await publicClient.getCode({ address: expected.address });
      expect(code && keccak256(code), expected.address).toBe(expected.runtimeCodeHash);
    }
    const helperCode = await publicClient.getCode({ address: helperAddress });
    expect(helperCode && keccak256(helperCode)).toBe(
      P05_HELPER_DEPLOYMENT_REGISTRY.helperTemplate.runtimeTemplateHash,
    );

    const helperAbi = parseAbi([
      "function depositNative() payable",
      "function owner() view returns (address)",
    ]);
    const erc20Abi = parseAbi([
      "function balanceOf(address owner) view returns (uint256)",
      "function transfer(address to,uint256 amount) returns (bool)",
    ]);
    const wbnbAbi = parseAbi(["function deposit() payable"]);
    expect(
      (
        await publicClient.readContract({
          abi: helperAbi,
          address: helperAddress,
          functionName: "owner",
        })
      ).toLowerCase(),
    ).toBe(owner.address.toLowerCase());

    const bindingStore = new MemoryLocalHelperSweepBindingStore([
      {
        adapterAddress,
        bindingId: randomUUID(),
        deploymentRegistryVersion: "p05-local-helper-deployment-v2",
        helperAddress,
        helperVersion: "WalletHelperV1",
        ownerAddress: owner.address.toLowerCase() as Address,
        permit2Address,
        runtimeCodeHash: P05_HELPER_DEPLOYMENT_REGISTRY.helperTemplate.runtimeTemplateHash,
        state: "active",
        tenantId,
        userId,
        verifiedBlockNumber: helperDeploymentReceipt.blockNumber.toString(),
        walletId,
      } satisfies LocalHelperSweepBinding & { tenantId: string; userId: string },
    ]);
    const wallet: CustodyWallet = {
      address: owner.address.toLowerCase() as Address,
      createdAt: new Date().toISOString(),
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: "P05-08 Anvil sweep wallet",
      revision: 1,
      updatedAt: new Date().toISOString(),
      walletId,
    };
    const kms = new LocalKmsFixture({
      activeVersion: "local-v1",
      keys: { "local-v1": Buffer.alloc(32, 0x42) },
    });
    const signer = new IsolatedWalletSigner({ kms });
    const ingress = Buffer.from(
      JSON.stringify({
        mode: "server-kek",
        name: "P05-08 Anvil sweep wallet",
        privateKey: ownerPrivateKey,
      }),
      "utf8",
    );
    const sealed = await signer.importAndSeal({
      envelopeVersion: 1,
      ingress,
      tenantId,
      userId,
      walletId,
    });
    expect(ingress.every((byte) => byte === 0)).toBe(true);
    const storedWallet: StoredCustodyWallet = {
      address: sealed.address,
      addressLower: sealed.addressLower,
      createdAt: new Date(),
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: wallet.name,
      revision: 1,
      tenantId,
      updatedAt: new Date(),
      userId,
      walletId,
    };
    const providers = [
      { providerId: "anvil-helper-sweep-a", rpcUrl },
      { providerId: "anvil-helper-sweep-b", rpcUrl },
    ] as const;
    const chain = new ViemLocalHelperResidualChainReader({
      chainId,
      inventory: {
        async list() {
          return {
            complete: true,
            knownNfts: [],
            tokenAddresses: registry.tokens.map(({ address }) => address),
          };
        },
      },
      providers,
    });
    const observer = new ViemLocalHelperSweepObserver({ chainId, providers });
    let deliverySequence = 0;
    const deliveredReceipts = new Map<
      Hex,
      Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>
    >();
    const delivery: RawTransactionDelivery = {
      async deliver(input) {
        expect(input.chainId).toBe(chainId);
        const transactionHash = await publicClient.sendRawTransaction({
          serializedTransaction: toHex(input.rawTransaction),
        });
        expect(transactionHash).toBe(input.transactionHash);
        deliveredReceipts.set(
          transactionHash,
          await publicClient.waitForTransactionReceipt({ hash: transactionHash }),
        );
        return { deliveryId: `anvil-helper-sweep-${deliverySequence++}`, status: "accepted" };
      },
    };

    const waitWrite = async (promise: Promise<Hex>) => {
      const hash = await promise;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    };
    const fund = async (assetIds: readonly string[]) => {
      if (assetIds.includes("native:31337")) {
        await waitWrite(
          walletClient.writeContract({
            abi: helperAbi,
            address: helperAddress,
            functionName: "depositNative",
            value: 5_000n,
          }),
        );
      }
      if (assetIds.includes(`token:${tokenAddress}`)) {
        await waitWrite(
          walletClient.writeContract({
            abi: erc20Abi,
            address: tokenAddress,
            args: [helperAddress, 20n],
            functionName: "transfer",
          }),
        );
      }
      if (assetIds.includes(`token:${wbnbAddress}`)) {
        await waitWrite(
          walletClient.writeContract({
            abi: wbnbAbi,
            address: wbnbAddress,
            functionName: "deposit",
            value: 30n,
          }),
        );
        await waitWrite(
          walletClient.writeContract({
            abi: erc20Abi,
            address: wbnbAddress,
            args: [helperAddress, 30n],
            functionName: "transfer",
          }),
        );
      }
    };

    let cycle = 0;
    const execute = async (requestedAssetIds: readonly string[]) => {
      cycle += 1;
      await fund(requestedAssetIds);
      const operations = new MemoryLocalHelperSweepOperationStore();
      const service = new LocalHelperSweepService({
        bindings: bindingStore,
        chain,
        operations,
        previews: new MemoryLocalHelperSweepPreviewStore(),
        snapshots: new MemoryLocalHelperResidualSnapshotStore(),
      });
      const snapshot = await service.scan({
        idempotencyKey: `anvil-helper-sweep-scan-${cycle}`,
        tenantId,
        userId,
        wallet,
      });
      expect(snapshot).toMatchObject({
        binding: { state: "degraded" },
        coverage: { complete: true },
        degradationReasons: ["residual-above-dust"],
        manualRecoveryRequired: false,
      });
      const request = {
        assetIds: [...requestedAssetIds],
        chainId: 31_337 as const,
        snapshotDigest: snapshot.snapshotDigest,
        walletId,
      };
      const preview = await service.preview({ request, tenantId, userId, wallet });
      expect(preview.assets.map(({ assetId }) => assetId)).toEqual(
        [...requestedAssetIds].sort((left, right) => left.localeCompare(right)),
      );
      const submitted = await service.sweep({
        idempotencyKey: `anvil-helper-sweep-batch-${cycle}`,
        request: {
          ...request,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
        },
        requestId: `anvil-helper-sweep-request-${cycle}`,
        sessionId,
        tenantId,
        userId,
        wallet,
      });
      expect(submitted.batch.operations).toHaveLength(requestedAssetIds.length);
      expect(new Set(submitted.batch.operations.map(({ nonce }) => nonce)).size).toBe(
        requestedAssetIds.length,
      );

      for (const publicOperation of submitted.batch.operations) {
        const operation = await operations.getOperation({
          operationId: publicOperation.operationId,
          tenantId,
          userId,
        });
        if (!operation) throw new Error("sweep operation plan was not stored");
        const result = await signer.signAndDeliverLocalHelperSweep({
          delivery,
          envelope: sealed.envelope,
          generation: 0,
          maxFeePerGasBaseUnit: operation.plan.feeLimit.maxFeePerGasBaseUnit,
          maxPriorityFeePerGasBaseUnit: operation.plan.feeLimit.maxPriorityFeePerGasBaseUnit,
          operationId: operation.operationId,
          plan: operation.plan,
          planDigest: operation.planDigest,
          wallet: storedWallet,
        });
        expect(deliveredReceipts.get(result.transactionHash)?.status).toBe("success");
        const observed = await observer.observe({
          plan: operation.plan,
          transactionHash: result.transactionHash,
        });
        const transaction: LocalHelperSweepTransactionReference = {
          active: true,
          amountBaseUnit: operation.amountBaseUnit,
          assetId: operation.assetId,
          dataDigest: operation.plan.transaction.dataDigest,
          fee: {
            maxFeePerGasBaseUnit: operation.plan.feeLimit.maxFeePerGasBaseUnit,
            maxPriorityFeePerGasBaseUnit: operation.plan.feeLimit.maxPriorityFeePerGasBaseUnit,
          },
          generation: 0,
          nonce: operation.nonce,
          planDigest: operation.planDigest,
          recipient: operation.recipient,
          semanticDigest: operation.plan.semanticDigest,
          target: helperAddress,
          transactionHash: result.transactionHash,
          transactionId: randomUUID(),
          updatedAt: new Date().toISOString(),
        };
        const workOperation: LocalHelperSweepWorkOperation = {
          activeTransaction: transaction,
          batchId: operation.batchId,
          operationId: operation.operationId,
          plan: operation.plan,
          planDigest: operation.planDigest,
          reauthenticatedSessionId: sessionId,
          state: "pending",
          tenantId,
          transactionLineage: [transaction],
          userId,
        };
        const decision = decideLocalHelperSweepObservation({
          dropAfterMilliseconds: 60_000,
          now: new Date(),
          observation: observed,
          operation: workOperation,
          requiredConfirmations: 1,
        });
        expect(decision).toMatchObject({
          failureCode: null,
          kind: "receipt",
          operationState: "succeeded",
          reason: null,
        });
        if (decision.kind !== "receipt") throw new Error("canonical receipt was not returned");
        expect(decision.receipt.blockCanonical).toBe(true);
        expect(decision.receipt.helperBalanceAfter).toBe("0");
        if (operation.assetKind === "token") {
          expect(decision.receipt).toMatchObject({
            tokenAddress: operation.tokenAddress,
            transferAmountBaseUnit: operation.amountBaseUnit,
            transferFrom: helperAddress,
            transferTo: wallet.address,
          });
          expect(
            BigInt(decision.receipt.ownerBalanceAfter) -
              BigInt(decision.receipt.ownerBalanceBefore),
          ).toBe(BigInt(operation.amountBaseUnit));
        } else {
          const gasCost =
            BigInt(decision.receipt.gasUsed) * BigInt(decision.receipt.effectiveGasPrice);
          expect(
            BigInt(decision.receipt.ownerBalanceAfter) -
              BigInt(decision.receipt.ownerBalanceBefore),
          ).toBe(BigInt(operation.amountBaseUnit) - gasCost);
        }
        operations.markSucceeded(operation.operationId);
      }

      await expect(
        service.getBatch({ batchId: submitted.batch.batchId, tenantId, userId }),
      ).resolves.toMatchObject({ state: "succeeded" });
      const clean = await service.scan({
        idempotencyKey: `anvil-helper-sweep-rescan-${cycle}`,
        tenantId,
        userId,
        wallet,
      });
      expect(clean).toMatchObject({
        allowances: expect.arrayContaining([]),
        binding: { state: "active" },
        coverage: { complete: true },
        degradationReasons: [],
        manualRecoveryRequired: false,
        nftCustody: [],
        unknownTokens: [],
      });
      expect(
        clean.balances.every(
          ({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) <= BigInt(dustBaseUnit),
        ),
      ).toBe(true);
    };

    const nativeAsset = "native:31337";
    const tokenAsset = `token:${tokenAddress}`;
    const wbnbAsset = `token:${wbnbAddress}`;
    await execute([nativeAsset, tokenAsset, wbnbAsset]);
    await execute([nativeAsset]);
    await execute([tokenAsset]);
    await execute([wbnbAsset]);

    expect(deliverySequence).toBe(6);
    expect(
      await publicClient.readContract({
        abi: erc20Abi,
        address: tokenAddress,
        args: [helperAddress],
        functionName: "balanceOf",
      }),
    ).toBe(0n);
    expect(
      await publicClient.readContract({
        abi: erc20Abi,
        address: wbnbAddress,
        args: [helperAddress],
        functionName: "balanceOf",
      }),
    ).toBe(0n);
    expect(await publicClient.getBalance({ address: helperAddress })).toBe(0n);
  });
});
