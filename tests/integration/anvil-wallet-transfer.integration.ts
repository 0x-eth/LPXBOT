import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";

import type { CustodyWallet, EvmAddress } from "../../packages/api-contract/src/index.js";
import { walletTransferPlanDigest } from "../../packages/domain/src/wallet-transfer.js";
import {
  MemoryWalletTransferOperationStore,
  MemoryWalletTransferPreviewStore,
  ViemLocalWalletTransferChainReader,
  WalletTransferService,
  type WalletTransferAssetDefinition,
} from "../../apps/api/src/index.js";
import {
  IsolatedWalletSigner,
  LocalKmsFixture,
  ResilientRawTransactionDelivery,
  type RawTransactionBroadcastPort,
  type StoredCustodyWallet,
} from "../../apps/signer/src/index.js";
import { ViemLocalWalletTransferObserver } from "../../apps/worker/src/index.js";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_ANVIL_INTEGRATION === "1";
const chainId = 31_337;
const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const recipient = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
const userId = "54000000-0000-4000-8000-000000000001";
const walletId = "54000000-0000-4000-8000-000000000011";
const tenantId = "tenant-fixture-01";
const erc20Abi = parseAbi([
  "constructor(uint256 initialSupply)",
  "function balanceOf(address owner) view returns (uint256)",
]);

interface ForgeArtifact {
  abi: readonly unknown[];
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

async function waitForRpc(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_chainId", params: [] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) return;
    } catch {
      // The fixture is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Anvil did not become ready");
}

describe.skipIf(!enabled)("P04-06 local Anvil transfer closure", () => {
  let anvil: ChildProcess;
  let rpcUrl: string;

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

  it("reconciles native and standard ERC-20 balances, nonces, receipts, and logs", async () => {
    const localChain = defineChain({
      id: chainId,
      name: "LPBOT local Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const account = privateKeyToAccount(privateKey);
    const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain: localChain,
      transport: http(rpcUrl),
    });
    const artifact = JSON.parse(
      await readFile("contracts/out/TestOnlyERC20.sol/TestOnlyERC20.json", "utf8"),
    ) as ForgeArtifact;
    const deploymentHash = await walletClient.deployContract({
      abi: erc20Abi,
      args: [1_000_000_000n],
      bytecode: artifact.bytecode.object,
    });
    const deployment = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
    const tokenAddress = deployment.contractAddress!;
    const chain = new ViemLocalWalletTransferChainReader({
      chainId,
      providers: [
        { providerId: "anvil-a", rpcUrl },
        { providerId: "anvil-b", rpcUrl },
      ],
    });
    const operations = new MemoryWalletTransferOperationStore();
    const token: WalletTransferAssetDefinition = {
      chainId,
      decimals: 6,
      default: false,
      feeOnTransfer: false,
      name: "Fixture USD",
      symbol: "FIX",
      tokenAddress: tokenAddress.toLowerCase() as EvmAddress,
    };
    const transferService = new WalletTransferService({
      addresses: { classify: async () => "known-external" },
      assets: {
        native: async () => ({ decimals: 18, name: "Ether", symbol: "ETH" }),
        token: async ({ tokenAddress: requested }) =>
          requested === token.tokenAddress ? token : null,
      },
      chain,
      localChainIds: [chainId],
      operations,
      policies: {
        current: async () => ({
          executionMode: "local-auto",
          policyDigest: `sha256:${"d".repeat(64)}`,
          policyVersion: "local-anvil-policy-v1",
          registryVersion: "local-anvil-registry-v1",
        }),
      },
      previews: new MemoryWalletTransferPreviewStore(),
    });
    const wallet: CustodyWallet = {
      address: account.address,
      createdAt: new Date().toISOString(),
      envelopeVersion: 1,
      lockStatus: "ready",
      mode: "server-kek",
      name: "Anvil transfer wallet",
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
      JSON.stringify({ mode: "server-kek", name: wallet.name, privateKey }),
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
      name: sealed.name,
      revision: 1,
      tenantId,
      updatedAt: new Date(),
      userId,
      walletId,
    };
    const broadcastPort: RawTransactionBroadcastPort = {
      broadcast: async ({ rawTransaction }) => {
        const hash = await publicClient.sendRawTransaction({
          serializedTransaction: toHex(rawTransaction),
        });
        return { status: "accepted", transactionHash: hash };
      },
      transactionKnown: async ({ transactionHash: hash }) => {
        try {
          await publicClient.getTransaction({ hash });
          return true;
        } catch {
          return false;
        }
      },
    };
    const delivery = new ResilientRawTransactionDelivery({
      adapterId: "anvil-local",
      broadcast: broadcastPort,
    });
    const observer = new ViemLocalWalletTransferObserver({
      chainId,
      providers: [
        { providerId: "anvil-a", rpcUrl },
        { providerId: "anvil-b", rpcUrl },
      ],
    });

    const nativeAmount = "1000000000000000";
    const nativeSenderBefore = await publicClient.getBalance({ address: account.address });
    const nativeRecipientBefore = await publicClient.getBalance({ address: recipient });
    const nativePreview = await transferService.preview({
      request: {
        amount: { amountBaseUnit: nativeAmount, kind: "exact" },
        asset: { kind: "native" },
        chainId,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    const nativeSubmit = await transferService.submit({
      idempotencyKey: "anvil-native-transfer-0001",
      password: null,
      request: {
        previewDigest: nativePreview.previewDigest,
        previewToken: nativePreview.previewToken,
        walletId,
      },
      requestId: "anvil-native-request",
      secretIngress: false,
      sessionId: userId,
      userId,
      wallet,
    });
    const nativeStored = await operations.get({
      operationId: nativeSubmit.operation.operationId,
      userId,
    });
    expect(nativeStored?.plan).not.toBeNull();
    const nativeSigned = await signer.signAndDeliverTransfer({
      delivery,
      envelope: sealed.envelope,
      plan: nativeStored!.plan!,
      planDigest: nativeStored!.planDigest,
      wallet: storedWallet,
    });
    const nativeReceipt = await publicClient.waitForTransactionReceipt({
      hash: nativeSigned.transactionHash,
    });
    const nativeObservation = await observer.observe({
      plan: nativeStored!.plan!,
      transactionHash: nativeSigned.transactionHash,
    });
    expect(nativeObservation.providers).toHaveLength(2);
    expect(nativeObservation.providers[0]?.receipt).toMatchObject({
      balanceReconciled: true,
      blockCanonical: true,
      nonce: nativeStored!.plan!.nonce,
      receiptStatus: "success",
      tokenTransferLogReconciled: true,
    });
    const nativeSenderAfter = await publicClient.getBalance({ address: account.address });
    const nativeRecipientAfter = await publicClient.getBalance({ address: recipient });
    const nativeFee = nativeReceipt.gasUsed * nativeReceipt.effectiveGasPrice;
    expect(nativeSenderBefore - nativeSenderAfter).toBe(BigInt(nativeAmount) + nativeFee);
    expect(nativeRecipientAfter - nativeRecipientBefore).toBe(BigInt(nativeAmount));

    const tokenAmount = "123456";
    const tokenSenderBefore = await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress,
      args: [account.address],
      functionName: "balanceOf",
    });
    const tokenRecipientBefore = await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress,
      args: [recipient],
      functionName: "balanceOf",
    });
    const tokenPreview = await transferService.preview({
      request: {
        amount: { amountBaseUnit: tokenAmount, kind: "exact" },
        asset: { kind: "erc20", tokenAddress: token.tokenAddress },
        chainId,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    const tokenSubmit = await transferService.submit({
      idempotencyKey: "anvil-token-transfer-0001",
      password: null,
      request: {
        previewDigest: tokenPreview.previewDigest,
        previewToken: tokenPreview.previewToken,
        walletId,
      },
      requestId: "anvil-token-request",
      secretIngress: false,
      sessionId: userId,
      userId,
      wallet,
    });
    const tokenStored = await operations.get({
      operationId: tokenSubmit.operation.operationId,
      userId,
    });
    expect(tokenStored?.plan?.nonce).toBe((BigInt(nativeStored!.plan!.nonce) + 1n).toString());
    expect(walletTransferPlanDigest(tokenStored!.plan!)).toBe(tokenStored!.planDigest);
    const tokenSigned = await signer.signAndDeliverTransfer({
      delivery,
      envelope: sealed.envelope,
      plan: tokenStored!.plan!,
      planDigest: tokenStored!.planDigest,
      wallet: storedWallet,
    });
    const tokenReceipt = await publicClient.waitForTransactionReceipt({
      hash: tokenSigned.transactionHash,
    });
    const tokenObservation = await observer.observe({
      plan: tokenStored!.plan!,
      transactionHash: tokenSigned.transactionHash,
    });
    expect(tokenReceipt.status).toBe("success");
    expect(tokenObservation.providers[0]?.receipt).toMatchObject({
      balanceReconciled: true,
      blockCanonical: true,
      nonce: tokenStored!.plan!.nonce,
      receiptStatus: "success",
      tokenTransferLogReconciled: true,
      transactionTarget: token.tokenAddress,
    });
    const tokenSenderAfter = await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress,
      args: [account.address],
      functionName: "balanceOf",
    });
    const tokenRecipientAfter = await publicClient.readContract({
      abi: erc20Abi,
      address: tokenAddress,
      args: [recipient],
      functionName: "balanceOf",
    });
    expect(tokenSenderBefore - tokenSenderAfter).toBe(BigInt(tokenAmount));
    expect(tokenRecipientAfter - tokenRecipientBefore).toBe(BigInt(tokenAmount));
    expect(await publicClient.getTransactionCount({ address: account.address })).toBe(
      Number(BigInt(tokenStored!.plan!.nonce) + 1n),
    );
  });
});
