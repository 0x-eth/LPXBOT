import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_SWEEP_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
} from "../../packages/chain-registry/src/index.js";
import {
  HelperDeploymentService,
  LocalHelperSweepApplicationRescanner,
  LocalHelperSweepService,
  LocalHelperUpgradeService,
  LocalHelperUpgradeSweepGateway,
  LocalHelperUpgradeSweepResidualReader,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  PostgresLocalHelperResidualSnapshotStore,
  PostgresLocalHelperSweepBindingStore,
  PostgresLocalHelperSweepOperationStore,
  PostgresLocalHelperSweepPreviewStore,
  PostgresLocalHelperUpgradeBindingStore,
  PostgresLocalHelperUpgradeOperationStore,
  PostgresLocalHelperUpgradePreviewStore,
  PostgresWalletDirectory,
  ViemLocalHelperDeploymentChainReader,
  ViemLocalHelperResidualChainReader,
  ViemLocalHelperUpgradeChainReader,
} from "../../apps/api/src/index.js";
import {
  CustodySignerService,
  IsolatedWalletSigner,
  LocalKmsFixture,
  PostgresCustodyWalletStore,
  PostgresLocalHelperSweepPlanAuthorizer,
  PostgresLocalHelperUpgradePlanAuthorizer,
  ResilientRawTransactionDelivery,
  ViemLocalHelperSweepPlanVerifier,
  ViemLocalHelperUpgradePlanVerifier,
  type RawTransactionBroadcastPort,
} from "../../apps/signer/src/index.js";
import { createSignerHttpServer } from "../../apps/signer/src/http-server.js";
import {
  LocalHelperSweepRecoveryWorker,
  LocalHelperUpgradeRecoveryWorker,
  LoopbackLocalHelperSweepSignerGateway,
  LoopbackLocalHelperUpgradeSignerGateway,
  PostgresLocalHelperSweepRecoveryRepository,
  PostgresLocalHelperUpgradeRecoveryRepository,
  ViemLocalHelperSweepObserver,
  ViemLocalHelperUpgradeObserver,
} from "../../apps/worker/src/index.js";
import { Pool } from "pg";
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
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://lpbot:lpbot_postgres_local_only@127.0.0.1:15432/lpbot?sslmode=disable";
const chainId = 31_337;
const tenantId = "tenant-fixture-01";
const userId = randomUUID();
const walletId = randomUUID();
const sessionId = randomUUID();
const signerToken = "anvil-helper-upgrade-signer-token-at-least-32-bytes";
const fixturePrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ownerPrivateKey =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

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

describe.skipIf(!enabled)("P05-09 local Anvil Helper deploy-new upgrade closure", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 16 });
  let anvil: ChildProcess | undefined;
  let rpcUrl = "";
  let signerServer: Server | undefined;

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
    await pool.query(
      `INSERT INTO users (id, role, tier, status, display_name, created_at, updated_at)
       VALUES ($1, 'user', 'normal', 'active', 'Anvil Helper upgrade fixture',
               clock_timestamp(), clock_timestamp())`,
      [userId],
    );
  });

  afterAll(async () => {
    signerServer?.closeAllConnections();
    if (signerServer) {
      await new Promise<void>((resolve) => signerServer!.close(() => resolve()));
    }
    await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => undefined);
    await pool.end();
    anvil?.kill("SIGTERM");
  });

  it("deploys V2, sweeps V1, atomically switches bindings, and resumes without replay", async () => {
    const localChain = defineChain({
      id: chainId,
      name: "LPBOT Helper upgrade local Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const fixtureAccount = privateKeyToAccount(fixturePrivateKey);
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);
    const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
    const fixtureClient = createWalletClient({
      account: fixtureAccount,
      chain: localChain,
      transport: http(rpcUrl),
    });
    const ownerClient = createWalletClient({
      account: ownerAccount,
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
    const deployFixture = async (input: { abi: Abi; args?: readonly unknown[]; bytecode: Hex }) => {
      const hash = await fixtureClient.deployContract({
        abi: input.abi,
        ...(input.args ? { args: input.args } : {}),
        bytecode: input.bytecode,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress || receipt.status !== "success") {
        throw new Error("synthetic fixture deployment failed");
      }
      return receipt.contractAddress.toLowerCase() as Address;
    };

    const tokenAddress = await deployFixture({
      abi: token.abi,
      args: [1_000_000_000n],
      bytecode: token.bytecode.object,
    });
    const wbnbAddress = await deployFixture({ abi: wbnb.abi, bytecode: wbnb.bytecode.object });
    const permit2Address = await deployFixture({
      abi: permit2.abi,
      bytecode: permit2.bytecode.object,
    });
    const routerAddress = await deployFixture({
      abi: router.abi,
      bytecode: router.bytecode.object,
    });
    const oldManagerAddress = await deployFixture({
      abi: position.abi,
      bytecode: position.bytecode.object,
    });
    const adapterAddress = await deployFixture({
      abi: adapter.abi,
      args: [routerAddress, oldManagerAddress],
      bytecode: adapter.bytecode.object,
    });
    await deployFixture({ abi: position.abi, bytecode: position.bytecode.object });
    const managerAddress = await deployFixture({
      abi: managerV2.abi,
      bytecode: managerV2.bytecode.object,
    });

    expect([tokenAddress, wbnbAddress]).toEqual(
      P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address }) => address),
    );
    expect(adapterAddress).toBe(
      P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "adapter")!.address,
    );
    expect(permit2Address).toBe(
      P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "permit2")!.address,
    );
    expect(managerAddress).toBe(
      P05_LOCAL_HELPER_SWEEP_REGISTRY.components.find(({ role }) => role === "manager")!.address,
    );
    for (const expected of [
      ...P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens,
      ...P05_LOCAL_HELPER_SWEEP_REGISTRY.components,
    ]) {
      const code = await publicClient.getCode({ address: expected.address });
      expect(code && keccak256(code), expected.address).toBe(expected.runtimeCodeHash);
    }

    const kms = new LocalKmsFixture({
      activeVersion: "local-v1",
      keys: { "local-v1": Buffer.alloc(32, 0x51) },
    });
    const isolatedSigner = new IsolatedWalletSigner({ kms });
    const custodyStore = new PostgresCustodyWalletStore(pool);
    const ingress = Buffer.from(
      JSON.stringify({
        mode: "server-kek",
        name: "Anvil Helper V1 owner",
        privateKey: ownerPrivateKey,
      }),
      "utf8",
    );
    const sealed = await isolatedSigner.importAndSeal({
      envelopeVersion: 1,
      ingress,
      tenantId,
      userId,
      walletId,
    });
    expect(ingress.every((byte) => byte === 0)).toBe(true);
    let clock = new Date();
    const wallet: CustodyWallet = await custodyStore.create({
      auditAction: "wallet.import",
      envelope: sealed.envelope,
      wallet: {
        address: sealed.address,
        addressLower: sealed.addressLower,
        createdAt: clock,
        envelopeVersion: 1,
        lockStatus: "ready",
        mode: "server-kek",
        name: "Anvil Helper V1 owner",
        revision: 1,
        tenantId,
        updatedAt: clock,
        userId,
        walletId,
      },
    });
    expect(wallet.address).toBe(ownerAccount.address);

    const providers = [
      { providerId: "anvil-helper-upgrade-a", rpcUrl },
      { providerId: "anvil-helper-upgrade-b", rpcUrl },
    ] as const;
    const deploymentOperations = new PostgresHelperDeploymentOperationStore(pool, {
      now: () => clock,
    });
    const deploymentService = new HelperDeploymentService({
      chain: new ViemLocalHelperDeploymentChainReader({ chainId, providers }),
      now: () => clock,
      operations: deploymentOperations,
      previews: new PostgresHelperDeploymentPreviewStore(pool),
    });
    const deploymentRequest = {
      chainId: 31_337 as const,
      helperVersion: "WalletHelperV1" as const,
      walletId,
    };
    const deploymentPreview = await deploymentService.preview({
      request: deploymentRequest,
      tenantId,
      userId,
      wallet,
    });
    const deployment = await deploymentService.submit({
      idempotencyKey: "anvil-helper-v1-upgrade-source-0001",
      request: {
        ...deploymentRequest,
        previewDigest: deploymentPreview.previewDigest,
        previewToken: deploymentPreview.previewToken,
      },
      requestId: "anvil-helper-v1-upgrade-source-request",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    const storedDeployment = await deploymentOperations.get({
      operationId: deployment.operation.operationId,
      tenantId,
      userId,
    });
    if (!storedDeployment) throw new Error("WalletHelperV1 deployment plan was not stored");
    const v1Hash = await ownerClient.sendTransaction({
      data: storedDeployment.plan.transaction.data,
    });
    const v1Receipt = await publicClient.waitForTransactionReceipt({ hash: v1Hash });
    if (!v1Receipt.contractAddress || v1Receipt.status !== "success") {
      throw new Error("WalletHelperV1 source deployment failed");
    }
    const v1Address = v1Receipt.contractAddress.toLowerCase() as Address;
    expect(v1Address).toBe(storedDeployment.expectedAddress);
    const v1Code = await publicClient.getCode({ address: v1Address });
    if (!v1Code) throw new Error("WalletHelperV1 runtime is missing");
    const v1RuntimeHash = keccak256(v1Code);
    expect(v1RuntimeHash).toBe(storedDeployment.plan.deployment.expectedRuntimeCodeHash);
    await pool.query(
      `UPDATE chain_operations SET state = 'succeeded', updated_at = clock_timestamp()
        WHERE operation_id = $1`,
      [storedDeployment.operationId],
    );
    await pool.query(
      `UPDATE wallet_helper_deployment_bindings
          SET state = 'active', deployment_transaction_hash = $2,
              verified_block_number = $3, failure_code = NULL, updated_at = clock_timestamp()
        WHERE operation_id = $1`,
      [storedDeployment.operationId, v1Hash, v1Receipt.blockNumber.toString()],
    );

    const erc20Abi = parseAbi([
      "function balanceOf(address owner) view returns (uint256)",
      "function transfer(address to,uint256 amount) returns (bool)",
    ]);
    const wbnbAbi = parseAbi(["function deposit() payable"]);
    const waitWrite = async (promise: Promise<Hex>) => {
      const hash = await promise;
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      expect(receipt.status).toBe("success");
    };
    await rpc(rpcUrl, "anvil_setBalance", [v1Address, toHex(5_000n)]);
    await waitWrite(
      fixtureClient.writeContract({
        abi: erc20Abi,
        address: tokenAddress,
        args: [v1Address, 20n],
        functionName: "transfer",
      }),
    );
    await waitWrite(
      fixtureClient.writeContract({
        abi: wbnbAbi,
        address: wbnbAddress,
        functionName: "deposit",
        value: 30n,
      }),
    );
    await waitWrite(
      fixtureClient.writeContract({
        abi: erc20Abi,
        address: wbnbAddress,
        args: [v1Address, 30n],
        functionName: "transfer",
      }),
    );
    expect(await publicClient.getTransactionCount({ address: ownerAccount.address })).toBe(1);

    const inventory = {
      async list() {
        return {
          complete: true,
          knownNfts: [],
          tokenAddresses: P05_LOCAL_HELPER_SWEEP_REGISTRY.tokens.map(({ address }) => address),
        };
      },
    };
    const residualChain = new ViemLocalHelperResidualChainReader({
      chainId,
      inventory,
      providers,
    });
    const upgradeOperations = new PostgresLocalHelperUpgradeOperationStore(pool, {
      now: () => clock,
    });
    const upgradeService = new LocalHelperUpgradeService({
      bindings: new PostgresLocalHelperUpgradeBindingStore(pool),
      chain: new ViemLocalHelperUpgradeChainReader({ chainId, providers }),
      now: () => clock,
      operations: upgradeOperations,
      previews: new PostgresLocalHelperUpgradePreviewStore(pool),
      residuals: new LocalHelperUpgradeSweepResidualReader({
        chain: residualChain,
        now: () => clock,
      }),
    });
    const upgradeRequest = { chainId: 31_337 as const, walletId };
    const upgradePreview = await upgradeService.preview({
      request: upgradeRequest,
      tenantId,
      userId,
      wallet,
    });
    expect(upgradePreview).toMatchObject({
      blockers: [],
      chainId,
      upgradeable: true,
      versions: {
        comparison: "upgrade-available",
        source: "WalletHelperV1",
        target: "WalletHelperV2",
      },
    });
    expect(upgradePreview.residual).toEqual({
      allowanceCount: 0,
      balancesAboveDust: 3,
      nftCustodyCount: 0,
      unknownTokenCount: 0,
    });
    const submitted = await upgradeService.submit({
      idempotencyKey: "anvil-helper-v2-upgrade-0001",
      request: {
        ...upgradeRequest,
        previewDigest: upgradePreview.previewDigest,
        previewToken: upgradePreview.previewToken,
      },
      requestId: "anvil-helper-v2-upgrade-request",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    const storedUpgrade = await upgradeOperations.get({
      operationId: submitted.operation.operationId,
      tenantId,
      userId,
    });
    if (!storedUpgrade) throw new Error("WalletHelperV2 upgrade plan was not stored");
    expect(storedUpgrade.plan).toMatchObject({
      nonce: "1",
      registry: { digest: P05_LOCAL_HELPER_UPGRADE_REGISTRY.registryDigest },
      target: {
        abiHash: P05_LOCAL_HELPER_UPGRADE_REGISTRY.target.abiHash,
        creationCodeHash: P05_LOCAL_HELPER_UPGRADE_REGISTRY.target.creationCodeHash,
        helperVersion: "WalletHelperV2",
      },
      transaction: { to: null, valueBaseUnit: "0" },
    });

    const broadcastPort: RawTransactionBroadcastPort = {
      async broadcast(input) {
        if (input.chainId !== chainId) throw new Error("wrong local chain");
        const transactionHash = await publicClient.sendRawTransaction({
          serializedTransaction: toHex(input.rawTransaction),
        });
        await publicClient.waitForTransactionReceipt({ hash: transactionHash });
        return { status: "accepted", transactionHash };
      },
      async transactionKnown(input) {
        if (input.chainId !== chainId) return false;
        try {
          await publicClient.getTransaction({ hash: input.transactionHash });
          return true;
        } catch {
          return false;
        }
      },
    };
    const delivery = new ResilientRawTransactionDelivery({
      adapterId: "anvil-helper-upgrade",
      broadcast: broadcastPort,
    });
    const upgradePlanVerifier = new ViemLocalHelperUpgradePlanVerifier({
      chainId,
      provider: { providerId: "anvil-helper-upgrade-signer", rpcUrl },
    });
    const upgradePlanAuthorizer = new PostgresLocalHelperUpgradePlanAuthorizer(
      pool,
      upgradePlanVerifier,
      { now: () => clock },
    );
    const signerService = new CustodySignerService({
      localHelperSweepPlanAuthorizer: new PostgresLocalHelperSweepPlanAuthorizer(
        pool,
        new ViemLocalHelperSweepPlanVerifier({
          chainId,
          provider: { providerId: "anvil-helper-sweep-signer", rpcUrl },
        }),
        { now: () => clock },
      ),
      localHelperUpgradePlanAuthorizer: upgradePlanAuthorizer,
      now: () => clock,
      rawTransactionDelivery: delivery,
      signer: isolatedSigner,
      store: custodyStore,
    });
    signerServer = createSignerHttpServer({ apiToken: signerToken, service: signerService });
    await new Promise<void>((resolve) => signerServer!.listen(0, "127.0.0.1", resolve));
    const signerAddress = signerServer.address();
    if (!signerAddress || typeof signerAddress === "string") {
      throw new Error("Signer HTTP fixture did not bind");
    }
    const signerUrl = `http://127.0.0.1:${signerAddress.port}`;
    const sweepService = new LocalHelperSweepService({
      bindings: new PostgresLocalHelperSweepBindingStore(pool),
      chain: residualChain,
      now: () => clock,
      operations: new PostgresLocalHelperSweepOperationStore(pool, { now: () => clock }),
      previews: new PostgresLocalHelperSweepPreviewStore(pool),
      snapshots: new PostgresLocalHelperResidualSnapshotStore(pool),
    });
    const wallets = new PostgresWalletDirectory(pool);
    const upgradeSweeper = new LocalHelperUpgradeSweepGateway({ sweeps: sweepService, wallets });
    const upgradeObserver = new ViemLocalHelperUpgradeObserver({ chainId, providers });
    const makeUpgradeWorker = (workerId: string) =>
      new LocalHelperUpgradeRecoveryWorker({
        now: () => clock,
        observer: upgradeObserver,
        repository: new PostgresLocalHelperUpgradeRecoveryRepository(pool, {
          pollMilliseconds: 100,
        }),
        requiredConfirmations: 1,
        signer: new LoopbackLocalHelperUpgradeSignerGateway({
          apiToken: signerToken,
          url: signerUrl,
        }),
        sweeper: upgradeSweeper,
        workerId,
      });
    const makeSweepWorker = (workerId: string) =>
      new LocalHelperSweepRecoveryWorker({
        now: () => clock,
        observer: new ViemLocalHelperSweepObserver({ chainId, providers }),
        repository: new PostgresLocalHelperSweepRecoveryRepository(pool, {
          pollMilliseconds: 100,
        }),
        requiredConfirmations: 1,
        rescanner: new LocalHelperSweepApplicationRescanner(sweepService, wallets),
        signer: new LoopbackLocalHelperSweepSignerGateway({
          endpoint: `${signerUrl}/v1/local-helper-sweeps/sign-and-deliver`,
          token: signerToken,
        }),
        workerId,
      });
    const tick = () => {
      clock = new Date(clock.getTime() + 1_000);
    };

    expect(await makeUpgradeWorker("upgrade-preflight").processBatch()).toMatchObject({
      claimed: 1,
      completed: 1,
    });
    const chainVerification = await upgradePlanVerifier.verify(storedUpgrade.plan);
    expect(chainVerification).toMatchObject({
      canonicalSnapshotBlockHash: storedUpgrade.plan.snapshot.blockHash,
      componentCodeMatches: true,
      expectedTargetCode: "0x",
      latestNonce: "1",
      pendingNonce: "1",
      simulatedRuntimeCodeHash: storedUpgrade.plan.target.expectedRuntimeCodeHash,
      source: {
        adapter: storedUpgrade.plan.target.adapter,
        owner: storedUpgrade.plan.wallet.address,
        permit2: storedUpgrade.plan.target.permit2,
        runtimeCodeHash: storedUpgrade.plan.source.runtimeCodeHash,
      },
      tokenCodeMatches: true,
    });
    const initialMaxFee = BigInt(storedUpgrade.plan.feeLimit.maxFeePerGasBaseUnit);
    const initialPriority = BigInt(storedUpgrade.plan.feeLimit.maxPriorityFeePerGasBaseUnit);
    await expect(
      upgradePlanAuthorizer.authorize({
        generation: 0,
        maxFeePerGasBaseUnit: (initialMaxFee > 1n ? initialMaxFee / 2n : initialMaxFee).toString(),
        maxPriorityFeePerGasBaseUnit: (initialPriority > 1n
          ? initialPriority / 2n
          : initialPriority
        ).toString(),
        operationId: storedUpgrade.operationId,
        plan: storedUpgrade.plan,
        planDigest: storedUpgrade.planDigest,
        tenantId,
        userId,
      }),
    ).resolves.toBe(true);
    tick();
    const initialFee = {
      maxFeePerGasBaseUnit: (initialMaxFee > 1n ? initialMaxFee / 2n : initialMaxFee).toString(),
      maxPriorityFeePerGasBaseUnit: (initialPriority > 1n
        ? initialPriority / 2n
        : initialPriority
      ).toString(),
    };
    await expect(
      upgradePlanAuthorizer.authorize({
        generation: 0,
        ...initialFee,
        operationId: storedUpgrade.operationId,
        plan: storedUpgrade.plan,
        planDigest: storedUpgrade.planDigest,
        tenantId,
        userId,
      }),
    ).resolves.toBe(true);
    const storedWallet = await custodyStore.get(userId, walletId);
    if (!storedWallet) throw new Error("stored custody wallet is missing");
    await expect(
      isolatedSigner.signAndDeliverLocalHelperUpgrade({
        delivery: {
          async deliver() {
            return { deliveryId: "anvil-upgrade-signing-probe", status: "accepted" as const };
          },
        },
        envelope: sealed.envelope,
        generation: 0,
        ...initialFee,
        now: clock,
        operationId: storedUpgrade.operationId,
        plan: storedUpgrade.plan,
        planDigest: storedUpgrade.planDigest,
        wallet: storedWallet,
      }),
    ).resolves.toMatchObject({
      deliveryId: "anvil-upgrade-signing-probe",
      planDigest: storedUpgrade.planDigest,
      status: "accepted",
    });
    const deployResult = await makeUpgradeWorker("upgrade-deploy").processBatch();
    if (deployResult.broadcast !== 1) {
      const failedOperation = await upgradeService.get({
        operationId: submitted.operation.operationId,
        tenantId,
        userId,
      });
      throw new Error(
        `upgrade deployment did not broadcast: ${JSON.stringify({
          cursor: failedOperation.cursor,
          deployResult,
          failureCode: failedOperation.failureCode,
          state: failedOperation.state,
        })}`,
      );
    }
    expect(deployResult).toMatchObject({
      broadcast: 1,
      claimed: 1,
    });
    const afterBroadcast = await upgradeService.get({
      operationId: submitted.operation.operationId,
      tenantId,
      userId,
    });
    const v2TransactionHash = afterBroadcast.transactions[0]?.transactionHash;
    if (!v2TransactionHash) throw new Error("WalletHelperV2 transaction hash is missing");
    const v2Transaction = await publicClient.getTransaction({ hash: v2TransactionHash });
    expect(v2Transaction).toMatchObject({
      from: ownerAccount.address,
      input: storedUpgrade.plan.transaction.data,
      nonce: 1,
      to: null,
      value: 0n,
    });
    tick();
    expect(await makeUpgradeWorker("upgrade-observe-after-restart").processBatch()).toMatchObject({
      claimed: 1,
      observed: 1,
    });
    tick();
    expect(await makeUpgradeWorker("upgrade-verify-after-restart").processBatch()).toMatchObject({
      claimed: 1,
      completed: 1,
    });

    const v2Address = storedUpgrade.plan.target.expectedAddress;
    const v2Code = await publicClient.getCode({ address: v2Address });
    expect(v2Code && keccak256(v2Code)).toBe(storedUpgrade.plan.target.expectedRuntimeCodeHash);
    const v2Abi = parseAbi([
      "function ATOMIC_LIQUIDITY_EXECUTION_ENABLED() view returns (bool)",
      "function adapter() view returns (address)",
      "function allowedTokenA() view returns (address)",
      "function allowedTokenACodeHash() view returns (bytes32)",
      "function allowedTokenB() view returns (address)",
      "function allowedTokenBCodeHash() view returns (bytes32)",
      "function owner() view returns (address)",
      "function permit2() view returns (address)",
    ]);
    const readV2 = async (functionName: (typeof v2Abi)[number]["name"]) =>
      publicClient.readContract({ abi: v2Abi, address: v2Address, functionName });
    await expect(readV2("owner")).resolves.toBe(ownerAccount.address);
    await expect(readV2("adapter")).resolves.toBe(adapterAddress);
    await expect(readV2("permit2")).resolves.toBe(permit2Address);
    await expect(readV2("allowedTokenA")).resolves.toBe(tokenAddress);
    await expect(readV2("allowedTokenACodeHash")).resolves.toBe(
      P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0].runtimeCodeHash,
    );
    await expect(readV2("allowedTokenB")).resolves.toBe(wbnbAddress);
    await expect(readV2("allowedTokenBCodeHash")).resolves.toBe(
      P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1].runtimeCodeHash,
    );
    await expect(readV2("ATOMIC_LIQUIDITY_EXECUTION_ENABLED")).resolves.toBe(false);
    expect(P05_LOCAL_HELPER_UPGRADE_REGISTRY.target.selectors).toHaveLength(18);

    tick();
    expect(
      await makeUpgradeWorker("upgrade-sweep-submit-after-restart").processBatch(),
    ).toMatchObject({
      claimed: 1,
      observed: 1,
    });
    const sweeping = await upgradeService.get({
      operationId: submitted.operation.operationId,
      tenantId,
      userId,
    });
    expect(sweeping).toMatchObject({ cursor: "sweep-v1", state: "running" });
    const sweepBatchId = (
      await pool.query<{ sweep_batch_id: string }>(
        `SELECT sweep_batch_id::text FROM local_helper_upgrade_operations WHERE operation_id = $1`,
        [submitted.operation.operationId],
      )
    ).rows[0]?.sweep_batch_id;
    expect(sweepBatchId).toEqual(expect.any(String));

    tick();
    expect(await makeSweepWorker("upgrade-v1-sweep-broadcast").processBatch()).toMatchObject({
      broadcast: 3,
      claimed: 3,
    });
    tick();
    expect(
      await makeSweepWorker("upgrade-v1-sweep-observe-after-restart").processBatch(),
    ).toMatchObject({
      claimed: 3,
      observed: 3,
    });
    tick();
    expect(
      await makeSweepWorker("upgrade-v1-sweep-rescan-after-restart").processBatch(),
    ).toMatchObject({
      claimed: 1,
      rescanned: 1,
    });
    expect(await publicClient.getBalance({ address: v1Address })).toBe(0n);
    await expect(
      publicClient.readContract({
        abi: erc20Abi,
        address: tokenAddress,
        args: [v1Address],
        functionName: "balanceOf",
      }),
    ).resolves.toBe(0n);
    await expect(
      publicClient.readContract({
        abi: erc20Abi,
        address: wbnbAddress,
        args: [v1Address],
        functionName: "balanceOf",
      }),
    ).resolves.toBe(0n);

    tick();
    expect(
      await makeUpgradeWorker("upgrade-sweep-complete-after-restart").processBatch(),
    ).toMatchObject({
      claimed: 1,
      completed: 1,
    });
    tick();
    expect(
      await makeUpgradeWorker("upgrade-final-rescan-after-restart").processBatch(),
    ).toMatchObject({
      claimed: 1,
      completed: 1,
    });
    tick();
    expect(
      await makeUpgradeWorker("upgrade-binding-switch-after-restart").processBatch(),
    ).toMatchObject({
      claimed: 1,
      completed: 1,
    });

    await expect(
      upgradeService.get({
        operationId: submitted.operation.operationId,
        tenantId,
        userId,
      }),
    ).resolves.toMatchObject({
      cursor: "completed",
      manualRecovery: { blockers: [], required: false },
      state: "completed",
      steps: [
        { cursor: "preflight", state: "succeeded" },
        { cursor: "deploy-v2", state: "succeeded" },
        { cursor: "verify-v2", state: "succeeded" },
        { cursor: "sweep-v1", state: "succeeded" },
        { cursor: "final-rescan-v1", state: "succeeded" },
        { cursor: "atomic-binding-switch", state: "succeeded" },
        { cursor: "completed", state: "succeeded" },
      ],
      transactions: [
        { active: true, generation: 0, state: "confirmed", transactionHash: v2TransactionHash },
      ],
    });
    const bindings = await pool.query<{
      active_count: string;
      helper_address: Address;
      helper_version: string;
      state: string;
      superseded_by_binding_id: string | null;
    }>(
      `SELECT helper_version, state, helper_address, superseded_by_binding_id::text,
              count(*) FILTER (WHERE state = 'active') OVER ()::text AS active_count
         FROM wallet_helper_deployment_bindings WHERE wallet_id = $1 ORDER BY helper_version`,
      [walletId],
    );
    expect(bindings.rows).toEqual([
      {
        active_count: "1",
        helper_address: v1Address,
        helper_version: "WalletHelperV1",
        state: "superseded",
        superseded_by_binding_id: expect.any(String),
      },
      {
        active_count: "1",
        helper_address: v2Address,
        helper_version: "WalletHelperV2",
        state: "active",
        superseded_by_binding_id: null,
      },
    ]);
    const provenance = await pool.query<{
      sweep_count: string;
      upgrade_operation_id: string;
      upgrade_transaction_count: string;
    }>(
      `SELECT batch.upgrade_operation_id::text,
              (SELECT count(*)::text FROM local_helper_sweep_batches b
                WHERE b.upgrade_operation_id = batch.upgrade_operation_id) AS sweep_count,
              (SELECT count(*)::text FROM local_helper_upgrade_transactions tx
                WHERE tx.operation_id = batch.upgrade_operation_id) AS upgrade_transaction_count
         FROM local_helper_sweep_batches batch WHERE batch.batch_id = $1`,
      [sweepBatchId],
    );
    expect(provenance.rows).toEqual([
      {
        sweep_count: "1",
        upgrade_operation_id: submitted.operation.operationId,
        upgrade_transaction_count: "1",
      },
    ]);

    const nonceAfterCompletion = await publicClient.getTransactionCount({
      address: ownerAccount.address,
    });
    expect(nonceAfterCompletion).toBe(5);
    tick();
    expect(await makeUpgradeWorker("upgrade-completed-restart").processBatch()).toMatchObject({
      claimed: 0,
    });
    expect(await makeSweepWorker("upgrade-sweep-completed-restart").processBatch()).toMatchObject({
      claimed: 0,
    });
    expect(await publicClient.getTransactionCount({ address: ownerAccount.address })).toBe(
      nonceAfterCompletion,
    );
  });
});
