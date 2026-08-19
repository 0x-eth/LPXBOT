import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createServer } from "node:net";

import type {
  CustodyWallet,
  LocalSwapAuthorizationMode,
  LocalSwapExecutionOperation,
} from "../../packages/api-contract/src/index.js";
import { LocalSwapQuoteAdapter } from "../../packages/chain-adapters/src/index.js";
import {
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
  helperDeploymentComponent,
} from "../../packages/chain-registry/src/index.js";
import {
  ControlledLocalSwapQuoteService,
  HelperDeploymentService,
  LocalSwapExecutionService,
  PostgresHelperDeploymentOperationStore,
  PostgresHelperDeploymentPreviewStore,
  PostgresLocalSwapHelperBindingStore,
  PostgresLocalSwapOperationStore,
  PostgresLocalSwapPreviewStore,
  PostgresLocalSwapQuoteStore,
  RemoteLocalSwapPermit2Client,
  ViemLocalHelperDeploymentChainReader,
  ViemLocalSwapExecutionChainReader,
  ViemLocalSwapQuoteProvider,
} from "../../apps/api/src/index.js";
import {
  CustodySignerService,
  IsolatedWalletSigner,
  LocalKmsFixture,
  PostgresCustodyWalletStore,
  PostgresHelperDeploymentPlanAuthorizer,
  PostgresLocalSwapPermit2Authorizer,
  PostgresLocalSwapStepPlanAuthorizer,
  ResilientRawTransactionDelivery,
  ViemLocalHelperDeploymentPlanVerifier,
  ViemLocalSwapPlanVerifier,
  type RawTransactionBroadcastPort,
} from "../../apps/signer/src/index.js";
import { createSignerHttpServer } from "../../apps/signer/src/http-server.js";
import {
  HelperDeploymentRecoveryWorker,
  LocalSwapRecoveryWorker,
  LoopbackHelperDeploymentSignerGateway,
  LoopbackLocalSwapSignerGateway,
  PostgresHelperDeploymentRecoveryRepository,
  PostgresLocalSwapRecoveryRepository,
  ViemLocalHelperDeploymentObserver,
  ViemLocalSwapObserver,
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
const walletId = randomUUID();
const signerToken = "anvil-local-swap-signer-token-at-least-32-bytes";
const ownerPrivateKey =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const adminPrivateKey =
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

describe.skipIf(!enabled)("P05-06 local Anvil Swap execution closure", () => {
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
       VALUES ($1, 'user', 'normal', 'active', 'Anvil local Swap fixture',
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

  it("runs direct and Permit2 success, then recovers a reverted Swap through cleanup", async () => {
    const localChain = defineChain({
      id: chainId,
      name: "LPBOT local Swap Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const ownerAccount = privateKeyToAccount(ownerPrivateKey);
    const adminAccount = privateKeyToAccount(adminPrivateKey);
    const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account: ownerAccount,
      chain: localChain,
      transport: http(rpcUrl),
    });
    const adminClient = createWalletClient({
      account: adminAccount,
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
      P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens.map(({ address }) => address),
    );
    expect(permit2Address).toBe(helperDeploymentComponent("permit2").address);
    expect(adapterAddress).toBe(helperDeploymentComponent("adapter").address);
    for (const expected of [
      ...P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens,
      ...P05_LOCAL_SWAP_EXECUTION_REGISTRY.components,
    ]) {
      const runtime = await publicClient.getCode({ address: expected.address });
      expect(runtime && keccak256(runtime), expected.address).toBe(expected.runtimeCodeHash);
    }

    const wbnbAbi = parseAbi([
      "function deposit() payable",
      "function transfer(address to,uint256 amount) returns (bool)",
      "function balanceOf(address owner) view returns (uint256)",
    ]);
    const depositHash = await walletClient.writeContract({
      abi: wbnbAbi,
      address: wbnbAddress,
      functionName: "deposit",
      value: 1_000_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    const fundHash = await walletClient.writeContract({
      abi: wbnbAbi,
      address: wbnbAddress,
      args: [routerAddress, 1_000_000n],
      functionName: "transfer",
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });

    const kms = new LocalKmsFixture({
      activeVersion: "local-v1",
      keys: { "local-v1": Buffer.alloc(32, 0x42) },
    });
    const isolatedSigner = new IsolatedWalletSigner({ kms });
    const custodyStore = new PostgresCustodyWalletStore(pool);
    const ingress = Buffer.from(
      JSON.stringify({ mode: "server-kek", name: "Local Swap owner", privateKey: ownerPrivateKey }),
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
        name: "Local Swap owner",
        revision: 1,
        tenantId,
        updatedAt: clock,
        userId,
        walletId,
      },
    });
    const providers = [
      { providerId: "anvil-local-swap-a", rpcUrl },
      { providerId: "anvil-local-swap-b", rpcUrl },
    ] as const;
    const broadcastPort: RawTransactionBroadcastPort = {
      broadcast: async ({ chainId: requestedChain, rawTransaction }) => {
        if (requestedChain !== chainId) throw new Error("wrong local chain");
        const transactionHash = await publicClient.sendRawTransaction({
          serializedTransaction: toHex(rawTransaction),
        });
        return { status: "accepted" as const, transactionHash };
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
      adapterId: "anvil-local-swap",
      broadcast: broadcastPort,
    });
    const planVerifier = new ViemLocalSwapPlanVerifier({
      chainId,
      provider: { providerId: "anvil-local-swap-signer", rpcUrl },
    });
    const signerService = new CustodySignerService({
      helperDeploymentPlanAuthorizer: new PostgresHelperDeploymentPlanAuthorizer({
        chain: new ViemLocalHelperDeploymentPlanVerifier({
          chainId,
          provider: { providerId: "anvil-helper-signer", rpcUrl },
        }),
        pool,
      }),
      localSwapPermit2Authorizer: new PostgresLocalSwapPermit2Authorizer(pool, planVerifier),
      localSwapStepPlanAuthorizer: new PostgresLocalSwapStepPlanAuthorizer(pool, planVerifier),
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
    const signerBaseUrl = `http://127.0.0.1:${signerAddress.port}`;

    const helperService = new HelperDeploymentService({
      chain: new ViemLocalHelperDeploymentChainReader({ chainId, providers }),
      now: () => clock,
      operations: new PostgresHelperDeploymentOperationStore(pool, { now: () => clock }),
      previews: new PostgresHelperDeploymentPreviewStore(pool),
    });
    const helperRequest = {
      chainId: 31_337 as const,
      helperVersion: "WalletHelperV1" as const,
      walletId,
    };
    const helperPreview = await helperService.preview({
      request: helperRequest,
      tenantId,
      userId,
      wallet,
    });
    const helperSubmission = await helperService.submit({
      idempotencyKey: "anvil-local-swap-helper-0001",
      request: {
        ...helperRequest,
        previewDigest: helperPreview.previewDigest,
        previewToken: helperPreview.previewToken,
      },
      requestId: "request-anvil-local-swap-helper",
      sessionId,
      tenantId,
      userId,
      wallet,
    });
    const helperWorker = (workerId: string) =>
      new HelperDeploymentRecoveryWorker({
        now: () => clock,
        observer: new ViemLocalHelperDeploymentObserver({ chainId, providers }),
        repository: new PostgresHelperDeploymentRecoveryRepository(pool, {
          confirmedPollMilliseconds: 1_000,
          pollMilliseconds: 1_000,
        }),
        requiredConfirmations: 1,
        signer: new LoopbackHelperDeploymentSignerGateway({
          apiToken: signerToken,
          url: signerBaseUrl,
        }),
        workerId,
      });
    expect(await helperWorker("local-swap-helper-broadcast").processBatch()).toMatchObject({
      broadcast: 1,
      failed: 0,
    });
    clock = new Date(clock.getTime() + 1_001);
    expect(await helperWorker("local-swap-helper-restart").processBatch()).toMatchObject({
      observed: 1,
    });
    expect(
      await helperService.get({
        operationId: helperSubmission.operation.operationId,
        tenantId,
        userId,
      }),
    ).toMatchObject({ state: "succeeded" });

    const bindings = new PostgresLocalSwapHelperBindingStore(pool);
    const binding = await bindings.getActive({ tenantId, userId, walletId });
    if (!binding) throw new Error("P05-05 active Helper binding was not created");
    const quoteStore = new PostgresLocalSwapQuoteStore(pool);
    const quotes = new ControlledLocalSwapQuoteService({
      adapter: new LocalSwapQuoteAdapter({
        now: () => clock,
        provider: new ViemLocalSwapQuoteProvider({
          chainId,
          provider: { providerId: "anvil-local-swap-quote", rpcUrl },
        }),
      }),
      bindings,
      store: quoteStore,
    });
    const operationStore = new PostgresLocalSwapOperationStore(pool, { now: () => clock });
    const executions = new LocalSwapExecutionService({
      bindings,
      chain: new ViemLocalSwapExecutionChainReader({ chainId, providers }),
      now: () => clock,
      operations: operationStore,
      permit2Signatures: new RemoteLocalSwapPermit2Client({
        endpoint: `${signerBaseUrl}/v1/local-swap/permit2/sign`,
        token: signerToken,
      }),
      previews: new PostgresLocalSwapPreviewStore(pool),
      quotes: quoteStore,
    });
    const localSigner = new LoopbackLocalSwapSignerGateway({
      endpoint: `${signerBaseUrl}/v1/local-swap/steps/sign-and-deliver`,
      token: signerToken,
    });
    const swapObserver = new ViemLocalSwapObserver({ chainId, providers });
    const worker = (workerId: string) =>
      new LocalSwapRecoveryWorker({
        dropAfterMilliseconds: 1_000,
        leaseMilliseconds: 1_000,
        now: () => clock,
        observer: swapObserver,
        repository: new PostgresLocalSwapRecoveryRepository(pool, {
          confirmedPollMilliseconds: 1_000,
          pollMilliseconds: 1_000,
        }),
        requiredConfirmations: 1,
        signer: localSigner,
        workerId,
      });
    const submitSwap = async (mode: LocalSwapAuthorizationMode, key: string) => {
      const quote = await quotes.quote({
        amountInBaseUnit: "1000",
        chainId: 31_337,
        slippageBps: 100,
        tenantId,
        tokenIn: tokenAddress,
        tokenOut: wbnbAddress,
        userId,
        walletAddress: wallet.address,
        walletId,
      });
      const request = {
        authorizationMode: mode,
        quoteDigest: quote.quoteDigest,
        walletId,
      };
      const preview = await executions.preview({ request, tenantId, userId, wallet });
      const submitted = await executions.submit({
        idempotencyKey: key,
        request: {
          ...request,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
        },
        requestId: `request-${key}`,
        sessionId,
        tenantId,
        userId,
        wallet,
      });
      return { operation: submitted.operation, preview, quote };
    };
    const runUntilTerminal = async (operationId: string, prefix: string) => {
      let operation: LocalSwapExecutionOperation | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        clock = new Date(clock.getTime() + 1_001);
        await worker(`${prefix}-${attempt}`).processBatch();
        operation = await executions.get({ operationId, tenantId, userId });
        if (operation.state === "succeeded" || operation.state === "failed") return operation;
      }
      throw new Error(`local Swap operation did not finish: ${operation?.state ?? "unknown"}`);
    };

    const directBefore = await publicClient.readContract({
      abi: wbnbAbi,
      address: wbnbAddress,
      args: [ownerAccount.address],
      functionName: "balanceOf",
    });
    const direct = await submitSwap("direct", "anvil-local-swap-direct-0001");
    const crashedRepository = new PostgresLocalSwapRecoveryRepository(pool, {
      confirmedPollMilliseconds: 1_000,
      pollMilliseconds: 1_000,
    });
    const abandoned = await crashedRepository.claimDue({
      leaseMilliseconds: 1_000,
      limit: 10,
      now: clock,
      workerId: "local-swap-crashed-worker",
    });
    expect(
      abandoned.some(({ operation }) => operation.operationId === direct.operation.operationId),
    ).toBe(true);
    const directResult = await runUntilTerminal(direct.operation.operationId, "direct-restart");
    expect(directResult).toMatchObject({ authorizationMode: "direct", state: "succeeded" });
    expect(directResult.steps.map(({ kind, state }) => [kind, state])).toEqual([
      ["approve", "succeeded"],
      ["swap", "succeeded"],
      ["cleanup", "skipped"],
    ]);
    const directAfter = await publicClient.readContract({
      abi: wbnbAbi,
      address: wbnbAddress,
      args: [ownerAccount.address],
      functionName: "balanceOf",
    });
    expect(directAfter - directBefore).toBeGreaterThanOrEqual(BigInt(direct.quote.minOutBaseUnit));

    const permit = await submitSwap("permit2", "anvil-local-swap-permit2-0001");
    const permitResult = await runUntilTerminal(permit.operation.operationId, "permit2-restart");
    expect(permitResult).toMatchObject({ authorizationMode: "permit2", state: "succeeded" });
    expect(permitResult.steps.map(({ kind, state }) => [kind, state])).toEqual([
      ["approve", "succeeded"],
      ["swap", "succeeded"],
      ["cleanup", "skipped"],
    ]);
    const permitNonceAbi = parseAbi([
      "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
    ]);
    const [remainingPermit, , usedPermitNonce] = await publicClient.readContract({
      abi: permitNonceAbi,
      address: permit2Address,
      args: [ownerAccount.address, tokenAddress, binding.helperAddress],
      functionName: "allowance",
    });
    expect(remainingPermit).toBe(0n);
    expect(usedPermitNonce).toBe(1);

    const reverted = await submitSwap("direct", "anvil-local-swap-revert-0001");
    const routerAdminAbi = parseAbi(["function setAmountOutBps(uint256 value)"]);
    const rateHash = await adminClient.writeContract({
      abi: routerAdminAbi,
      address: routerAddress,
      args: [0n],
      functionName: "setAmountOutBps",
    });
    await publicClient.waitForTransactionReceipt({ hash: rateHash });
    let cleanupBroadcastSeen = false;
    let revertedResult: LocalSwapExecutionOperation | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      clock = new Date(clock.getTime() + 1_001);
      await worker(`revert-restart-${attempt}`).processBatch();
      revertedResult = await executions.get({
        operationId: reverted.operation.operationId,
        tenantId,
        userId,
      });
      const cleanup = revertedResult.steps.find(({ kind }) => kind === "cleanup");
      if (cleanup?.state === "broadcast" || cleanup?.state === "pending") {
        cleanupBroadcastSeen = true;
        expect(revertedResult).toMatchObject({
          reconciliationReason: "ALLOWANCE_CLEANUP_REQUIRED",
          state: "reconciling",
        });
      }
      if (revertedResult.state === "failed") break;
    }
    expect(cleanupBroadcastSeen).toBe(true);
    expect(revertedResult).toMatchObject({
      failureCode: "SWAP_REVERTED",
      reconciliationReason: null,
      state: "failed",
    });
    expect(revertedResult!.steps.map(({ kind, state }) => [kind, state])).toEqual([
      ["approve", "succeeded"],
      ["swap", "failed"],
      ["cleanup", "succeeded"],
    ]);
    const erc20AllowanceAbi = parseAbi([
      "function allowance(address owner,address spender) view returns (uint256)",
    ]);
    expect(
      await publicClient.readContract({
        abi: erc20AllowanceAbi,
        address: tokenAddress,
        args: [ownerAccount.address, binding.helperAddress],
        functionName: "allowance",
      }),
    ).toBe(0n);
    const evidence = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM local_swap_receipt_evidence
        WHERE operation_id IN ($1, $2, $3)`,
      [direct.operation.operationId, permit.operation.operationId, reverted.operation.operationId],
    );
    expect(evidence.rows).toEqual([{ count: "7" }]);
  });
});
