import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { CustodyWallet } from "../../packages/api-contract/src/index.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  helperDeploymentComponent,
} from "../../packages/chain-registry/src/index.js";
import {
  HelperDeploymentService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  ViemLocalHelperDeploymentChainReader,
} from "../../apps/api/src/index.js";
import {
  CustodySignerService,
  IsolatedWalletSigner,
  LocalKmsFixture,
  PostgresCustodyWalletStore,
  PostgresHelperDeploymentPlanAuthorizer,
  ResilientRawTransactionDelivery,
  ViemLocalHelperDeploymentPlanVerifier,
  type RawTransactionBroadcastPort,
} from "../../apps/signer/src/index.js";
import { createSignerHttpServer } from "../../apps/signer/src/http-server.js";
import {
  HelperDeploymentRecoveryWorker,
  LoopbackHelperDeploymentSignerGateway,
  PostgresHelperDeploymentRecoveryRepository,
  ViemLocalHelperDeploymentObserver,
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
const sessionId = randomUUID();
const successWalletId = randomUUID();
const revertWalletId = randomUUID();
const signerToken = "anvil-helper-signer-token-at-least-32-bytes";
const ownerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const revertPrivateKey =
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

describe.skipIf(!enabled)("P05-05 local Anvil Helper deployment closure", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 12 });
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
       VALUES ($1, 'user', 'normal', 'active', 'Anvil Helper deployment fixture',
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

  it("deploys through API, PostgreSQL, restarted Worker, isolated Signer, and receipt recovery", async () => {
    const localChain = defineChain({
      id: chainId,
      name: "LPBOT Helper local Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);
    const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account: ownerAccount,
      chain: localChain,
      transport: http(rpcUrl),
    });
    const [
      tokenArtifact,
      wbnbArtifact,
      permit2Artifact,
      routerArtifact,
      positionArtifact,
      adapterArtifact,
    ] = await Promise.all([
      artifact("contracts/out/TestOnlyERC20.sol/TestOnlyERC20.json"),
      artifact("contracts/out/TestOnlyWBNB.sol/TestOnlyWBNB.json"),
      artifact("contracts/out/TestOnlyPermit2.sol/TestOnlyPermit2.json"),
      artifact("contracts/out/TestOnlySwapRouter.sol/TestOnlySwapRouter.json"),
      artifact("contracts/out/TestOnlyPositionManager.sol/TestOnlyPositionManager.json"),
      artifact("contracts/out/LocalExecutionAdapter.sol/LocalExecutionAdapter.json"),
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
    const tokenAddress = await deploy({
      abi: tokenArtifact.abi,
      args: [1_000_000_000n],
      bytecode: tokenArtifact.bytecode.object,
    });
    const wbnbAddress = await deploy({
      abi: wbnbArtifact.abi,
      bytecode: wbnbArtifact.bytecode.object,
    });
    const permit2Address = await deploy({
      abi: permit2Artifact.abi,
      bytecode: permit2Artifact.bytecode.object,
    });
    const routerAddress = await deploy({
      abi: routerArtifact.abi,
      bytecode: routerArtifact.bytecode.object,
    });
    const positionAddress = await deploy({
      abi: positionArtifact.abi,
      bytecode: positionArtifact.bytecode.object,
    });
    const adapterAddress = await deploy({
      abi: adapterArtifact.abi,
      args: [routerAddress, positionAddress],
      bytecode: adapterArtifact.bytecode.object,
    });
    expect([tokenAddress, wbnbAddress]).toEqual(
      P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address }) => address),
    );
    expect(permit2Address).toBe(helperDeploymentComponent("permit2").address);
    expect(adapterAddress).toBe(helperDeploymentComponent("adapter").address);
    for (const expected of [
      ...P05_HELPER_DEPLOYMENT_REGISTRY.tokens,
      ...P05_HELPER_DEPLOYMENT_REGISTRY.components,
    ]) {
      const runtime = await publicClient.getCode({ address: expected.address });
      expect(runtime && keccak256(runtime), expected.address).toBe(expected.runtimeCodeHash);
    }
    expect(await publicClient.getTransactionCount({ address: ownerAccount.address })).toBe(6);

    const kms = new LocalKmsFixture({
      activeVersion: "local-v1",
      keys: { "local-v1": Buffer.alloc(32, 0x42) },
    });
    const isolatedSigner = new IsolatedWalletSigner({ kms });
    const custodyStore = new PostgresCustodyWalletStore(pool);
    const registerWallet = async (
      privateKey: Hex,
      walletId: string,
      name: string,
    ): Promise<CustodyWallet> => {
      const ingress = Buffer.from(JSON.stringify({ mode: "server-kek", name, privateKey }), "utf8");
      const sealed = await isolatedSigner.importAndSeal({
        envelopeVersion: 1,
        ingress,
        tenantId,
        userId,
        walletId,
      });
      expect(ingress.every((byte) => byte === 0)).toBe(true);
      const now = new Date();
      return custodyStore.create({
        auditAction: "wallet.import",
        envelope: sealed.envelope,
        wallet: {
          address: sealed.address,
          addressLower: sealed.addressLower,
          createdAt: now,
          envelopeVersion: 1,
          lockStatus: "ready",
          mode: "server-kek",
          name,
          revision: 1,
          tenantId,
          updatedAt: now,
          userId,
          walletId,
        },
      });
    };
    const successWallet = await registerWallet(
      ownerPrivateKey,
      successWalletId,
      "Anvil Helper success",
    );
    const revertWallet = await registerWallet(
      revertPrivateKey,
      revertWalletId,
      "Anvil Helper revert",
    );

    const providers = [
      { providerId: "anvil-helper-a", rpcUrl },
      { providerId: "anvil-helper-b", rpcUrl },
    ] as const;
    const chainReader = new ViemLocalHelperDeploymentChainReader({
      chainId,
      providers,
    });
    const operationStore = new PostgresHelperDeploymentOperationStore(pool);
    const helperService = new HelperDeploymentService({
      chain: chainReader,
      operations: operationStore,
      previews: new PostgresHelperDeploymentPreviewStore(pool),
    });
    const submit = async (wallet: CustodyWallet, idempotencyKey: string) => {
      const request = {
        chainId: 31_337 as const,
        helperVersion: "WalletHelperV1" as const,
        walletId: wallet.walletId,
      };
      const preview = await helperService.preview({ request, tenantId, userId, wallet });
      const submitted = await helperService.submit({
        idempotencyKey,
        request: {
          ...request,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
        },
        requestId: `request-${idempotencyKey}`,
        sessionId,
        tenantId,
        userId,
        wallet,
      });
      const stored = await operationStore.get({
        operationId: submitted.operation.operationId,
        tenantId,
        userId,
      });
      if (!stored) throw new Error("submitted Helper operation was not stored");
      return { preview, stored };
    };

    let failNextBroadcast = false;
    const originalAdapterCode = await publicClient.getCode({ address: adapterAddress });
    if (!originalAdapterCode) throw new Error("adapter runtime is missing");
    const broadcastPort: RawTransactionBroadcastPort = {
      broadcast: async ({ chainId: requestedChain, rawTransaction }) => {
        if (requestedChain !== chainId) throw new Error("wrong local chain");
        const sabotage = failNextBroadcast;
        failNextBroadcast = false;
        if (sabotage) await rpc(rpcUrl, "anvil_setCode", [adapterAddress, "0x"]);
        try {
          const transactionHash = await publicClient.sendRawTransaction({
            serializedTransaction: toHex(rawTransaction),
          });
          return { status: "accepted" as const, transactionHash };
        } finally {
          if (sabotage) {
            await rpc(rpcUrl, "anvil_setCode", [adapterAddress, originalAdapterCode]);
          }
        }
      },
      transactionKnown: async ({ chainId: requestedChain, transactionHash }) => {
        if (requestedChain !== chainId) return false;
        try {
          await publicClient.getTransaction({ hash: transactionHash });
          return true;
        } catch {
          return false;
        }
      },
    };
    const delivery = new ResilientRawTransactionDelivery({
      adapterId: "anvil-helper",
      broadcast: broadcastPort,
    });
    const authorizer = new PostgresHelperDeploymentPlanAuthorizer({
      chain: new ViemLocalHelperDeploymentPlanVerifier({
        chainId,
        provider: { providerId: "anvil-helper-signer", rpcUrl },
      }),
      pool,
    });
    const signerService = new CustodySignerService({
      helperDeploymentPlanAuthorizer: authorizer,
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
    const signerGateway = new LoopbackHelperDeploymentSignerGateway({
      apiToken: signerToken,
      url: `http://127.0.0.1:${signerAddress.port}`,
    });
    const observer = new ViemLocalHelperDeploymentObserver({ chainId, providers });
    let clock = new Date();
    const worker = (workerId: string) =>
      new HelperDeploymentRecoveryWorker({
        now: () => clock,
        observer,
        repository: new PostgresHelperDeploymentRecoveryRepository(pool, {
          confirmedPollMilliseconds: 1_000,
          pollMilliseconds: 1_000,
        }),
        requiredConfirmations: 1,
        signer: signerGateway,
        workerId,
      });

    const successful = await submit(successWallet, "anvil-helper-success-0001");
    expect(successful.preview).toMatchObject({
      chainId,
      nonce: "6",
    });
    expect(successful.stored.plan.deployment.owner).toBe(ownerAccount.address.toLowerCase());
    expect(successful.stored.plan.transaction).toMatchObject({ to: null, valueBaseUnit: "0" });
    clock = new Date(Date.now() + 1_000);
    expect(await worker("helper-before-restart").processBatch()).toMatchObject({
      broadcast: 1,
      claimed: 1,
      failed: 0,
    });
    const broadcastState = await helperService.get({
      operationId: successful.stored.operationId,
      tenantId,
      userId,
    });
    expect(broadcastState.state).toBe("broadcast");
    const successHash = broadcastState.transactions[0]!.transactionHash!;
    const createTransaction = await publicClient.getTransaction({ hash: successHash });
    expect(createTransaction.to).toBeNull();
    expect(createTransaction.value).toBe(0n);
    expect(createTransaction.input.toLowerCase()).toBe(successful.stored.plan.transaction.data);

    clock = new Date(clock.getTime() + 2_000);
    expect(await worker("helper-after-restart").processBatch()).toMatchObject({
      claimed: 1,
      observed: 1,
    });
    const succeeded = await helperService.get({
      operationId: successful.stored.operationId,
      tenantId,
      userId,
    });
    expect(succeeded).toMatchObject({ state: "succeeded" });
    const helperAddress = successful.stored.expectedAddress;
    const helperRuntime = await publicClient.getCode({ address: helperAddress });
    expect(helperRuntime && keccak256(helperRuntime)).toBe(
      successful.stored.plan.deployment.expectedRuntimeCodeHash,
    );
    const helperIdentityAbi = parseAbi([
      "function owner() view returns (address)",
      "function adapter() view returns (address)",
      "function permit2() view returns (address)",
    ]);
    expect(
      (
        await publicClient.readContract({
          abi: helperIdentityAbi,
          address: helperAddress,
          functionName: "owner",
        })
      ).toLowerCase(),
    ).toBe(ownerAccount.address.toLowerCase());
    expect(
      (
        await publicClient.readContract({
          abi: helperIdentityAbi,
          address: helperAddress,
          functionName: "adapter",
        })
      ).toLowerCase(),
    ).toBe(adapterAddress);
    expect(
      (
        await publicClient.readContract({
          abi: helperIdentityAbi,
          address: helperAddress,
          functionName: "permit2",
        })
      ).toLowerCase(),
    ).toBe(permit2Address);

    const reverted = await submit(revertWallet, "anvil-helper-revert-0001");
    expect(reverted.stored.nonce).toBe("0");
    failNextBroadcast = true;
    clock = new Date(clock.getTime() + 2_000);
    expect(await worker("helper-revert-broadcast").processBatch()).toMatchObject({
      broadcast: 1,
      failed: 0,
    });
    const revertedBroadcast = await helperService.get({
      operationId: reverted.stored.operationId,
      tenantId,
      userId,
    });
    const revertedHash = revertedBroadcast.transactions[0]!.transactionHash!;
    expect((await publicClient.getTransactionReceipt({ hash: revertedHash })).status).toBe(
      "reverted",
    );
    clock = new Date(clock.getTime() + 2_000);
    expect(await worker("helper-revert-recovery").processBatch()).toMatchObject({
      claimed: 1,
      observed: 1,
    });
    const failed = await helperService.get({
      operationId: reverted.stored.operationId,
      tenantId,
      userId,
    });
    expect(failed).toMatchObject({
      failureCode: "HELPER_DEPLOYMENT_REVERTED",
      state: "failed",
    });
    expect(
      await publicClient.getCode({ address: reverted.stored.expectedAddress }),
    ).toBeUndefined();
    const failedBinding = await pool.query<{
      failure_code: string;
      last_confirmed_nonce: string;
      state: string;
    }>(
      `SELECT b.state, b.failure_code, l.last_confirmed_nonce::text
         FROM wallet_helper_deployment_bindings b
         JOIN wallet_nonce_ledgers l ON l.chain_id = b.chain_id AND l.wallet_id = b.wallet_id
        WHERE b.operation_id = $1`,
      [reverted.stored.operationId],
    );
    expect(failedBinding.rows).toEqual([
      {
        failure_code: "HELPER_DEPLOYMENT_REVERTED",
        last_confirmed_nonce: "0",
        state: "degraded",
      },
    ]);
    expect(
      await publicClient.getTransactionCount({
        address: privateKeyToAccount(revertPrivateKey).address,
      }),
    ).toBe(1);
    const retry = await submit(revertWallet, "anvil-helper-revert-0002");
    expect(retry.stored).toMatchObject({ nonce: "1", state: "queued" });
    const recoveryRepository = new PostgresHelperDeploymentRecoveryRepository(pool);
    const retryClaims = await recoveryRepository.claimDue({
      leaseMilliseconds: 10_000,
      limit: 10,
      now: clock,
      workerId: "helper-retry-cleanup",
    });
    const retryClaim = retryClaims.find(
      ({ operation }) => operation.operationId === retry.stored.operationId,
    );
    if (!retryClaim) throw new Error("retry operation was not claimable");
    await recoveryRepository.failClaim({
      claim: retryClaim,
      code: "LOCAL_FIXTURE_COMPLETE",
      failedAt: clock,
      retryable: false,
    });
  });
});
