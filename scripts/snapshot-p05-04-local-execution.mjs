#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  http,
  keccak256,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAIN_ID = 31_337;
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_ADDRESSES = {
  adapter: "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707",
  helper: "0x0165878a594ca255338adfa4d48449f69242eb8f",
  permit2: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
  positionManager: "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9",
  router: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
  token: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  wbnb: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
};

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("port allocation failed");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${method}: ${JSON.stringify(body.error ?? body)}`);
  }
  return body.result;
}

async function waitForRpc(rpcUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await rpc(rpcUrl, "eth_chainId")) === "0x7a69") return;
    } catch {
      // Anvil is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Anvil did not become ready");
}

function startAnvil(port, statePath, loadState) {
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    String(CHAIN_ID),
    "--silent",
    "--dump-state",
    statePath,
  ];
  if (loadState) args.push("--load-state", statePath);
  return spawn("anvil", args, { stdio: "ignore" });
}

async function stopAnvil(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => process.once("exit", resolve));
}

async function artifact(contractName) {
  const value = JSON.parse(
    await readFile(path.join(ROOT, `contracts/out/${contractName}.sol/${contractName}.json`), "utf8"),
  );
  return {
    abi: value.abi,
    abiHash: sha256(Buffer.from(JSON.stringify(value.abi))),
    bytecode: value.bytecode.object,
    creationCodeHash: keccak256(value.bytecode.object),
    deployedBytecode: value.deployedBytecode.object,
    selectors: value.abi
      .filter((item) => item.type === "function")
      .map((item) => toFunctionSelector(item))
      .sort(),
  };
}

async function deployedCodeIdentity(publicClient, address, contractArtifact) {
  const code = await publicClient.getCode({ address });
  if (!code || code === "0x") throw new Error(`empty runtime at ${address}`);
  return {
    abiHash: contractArtifact.abiHash,
    address,
    runtimeCodeBytes: (code.length - 2) / 2,
    runtimeCodeHash: keccak256(code),
  };
}

async function deploy(walletClient, publicClient, contractArtifact, args = []) {
  const hash = await walletClient.deployContract({
    abi: contractArtifact.abi,
    args,
    bytecode: contractArtifact.bytecode,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`deployment failed ${hash}`);
  }
  return { address: receipt.contractAddress.toLowerCase(), hash, receipt };
}

async function swapState(publicClient, artifacts, addresses) {
  const balanceOf = (abi, tokenAddress, accountAddress) =>
    publicClient.readContract({
      abi,
      address: tokenAddress,
      args: [accountAddress],
      functionName: "balanceOf",
    });
  const allowance = (owner, spender) =>
    publicClient.readContract({
      abi: artifacts.TestOnlyERC20.abi,
      address: addresses.token,
      args: [owner, spender],
      functionName: "allowance",
    });
  const accounts = ["owner", "helper", "adapter", "router"];
  const balanceEntries = await Promise.all(
    accounts.map(async (label) => {
      const accountAddress = addresses[label];
      const [tokenIn, tokenOut] = await Promise.all([
        balanceOf(artifacts.TestOnlyERC20.abi, addresses.token, accountAddress),
        balanceOf(artifacts.TestOnlyWBNB.abi, addresses.wbnb, accountAddress),
      ]);
      return [label, { tokenIn: tokenIn.toString(), tokenOut: tokenOut.toString() }];
    }),
  );
  const [ownerToHelper, helperToAdapter, adapterToRouter] = await Promise.all([
    allowance(addresses.owner, addresses.helper),
    allowance(addresses.helper, addresses.adapter),
    allowance(addresses.adapter, addresses.router),
  ]);
  return {
    allowances: {
      adapterToRouter: adapterToRouter.toString(),
      helperToAdapter: helperToAdapter.toString(),
      ownerToHelper: ownerToHelper.toString(),
    },
    balances: Object.fromEntries(balanceEntries),
  };
}

function assertStateEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} state changed`);
  }
}

function assertAddress(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} address ${actual} != ${expected}`);
}

async function main() {
  execFileSync("forge", ["build"], { cwd: ROOT, stdio: "pipe" });
  const outputFlag = process.argv.indexOf("--output");
  const outputPath = outputFlag === -1 ? null : path.resolve(ROOT, process.argv[outputFlag + 1]);
  const statePath = path.join(tmpdir(), `lpbot-p05-04-${process.pid}.json`);
  await rm(statePath, { force: true });
  const port = await freePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  let anvil = startAnvil(port, statePath, false);

  try {
    await waitForRpc(rpcUrl);
    const account = privateKeyToAccount(PRIVATE_KEY);
    const chain = {
      id: CHAIN_ID,
      name: "LPBOT P05-04 local Anvil",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
    let publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
    const artifacts = Object.fromEntries(
      await Promise.all(
        [
          "LocalExecutionAdapter",
          "TestOnlyERC20",
          "TestOnlyPermit2",
          "TestOnlyPositionManager",
          "TestOnlySwapRouter",
          "TestOnlyWBNB",
          "WalletHelperV1",
        ].map(async (name) => [name, await artifact(name)]),
      ),
    );

    const token = await deploy(walletClient, publicClient, artifacts.TestOnlyERC20, [10n ** 30n]);
    const wbnb = await deploy(walletClient, publicClient, artifacts.TestOnlyWBNB);
    const permit2 = await deploy(walletClient, publicClient, artifacts.TestOnlyPermit2);
    const router = await deploy(walletClient, publicClient, artifacts.TestOnlySwapRouter);
    const positionManager = await deploy(
      walletClient,
      publicClient,
      artifacts.TestOnlyPositionManager,
    );
    const adapter = await deploy(walletClient, publicClient, artifacts.LocalExecutionAdapter, [
      router.address,
      positionManager.address,
    ]);
    for (const [label, deployment] of Object.entries({
      adapter,
      permit2,
      positionManager,
      router,
      token,
      wbnb,
    })) {
      assertAddress(deployment.address, EXPECTED_ADDRESSES[label], label);
    }

    const tokenIdentity = await deployedCodeIdentity(
      publicClient,
      token.address,
      artifacts.TestOnlyERC20,
    );
    const wbnbIdentity = await deployedCodeIdentity(
      publicClient,
      wbnb.address,
      artifacts.TestOnlyWBNB,
    );
    const helperArguments = [
      account.address,
      adapter.address,
      permit2.address,
      token.address,
      tokenIdentity.runtimeCodeHash,
      wbnb.address,
      wbnbIdentity.runtimeCodeHash,
    ];
    const helperCreationInput = encodeDeployData({
      abi: artifacts.WalletHelperV1.abi,
      args: helperArguments,
      bytecode: artifacts.WalletHelperV1.bytecode,
    });
    const helper = await deploy(
      walletClient,
      publicClient,
      artifacts.WalletHelperV1,
      helperArguments,
    );
    assertAddress(helper.address, EXPECTED_ADDRESSES.helper, "helper");

    const componentIdentities = {
      adapter: await deployedCodeIdentity(
        publicClient,
        adapter.address,
        artifacts.LocalExecutionAdapter,
      ),
      helper: await deployedCodeIdentity(publicClient, helper.address, artifacts.WalletHelperV1),
      permit2: await deployedCodeIdentity(
        publicClient,
        permit2.address,
        artifacts.TestOnlyPermit2,
      ),
      positionManager: await deployedCodeIdentity(
        publicClient,
        positionManager.address,
        artifacts.TestOnlyPositionManager,
      ),
      router: await deployedCodeIdentity(
        publicClient,
        router.address,
        artifacts.TestOnlySwapRouter,
      ),
    };

    const depositHash = await walletClient.writeContract({
      abi: artifacts.TestOnlyWBNB.abi,
      address: wbnb.address,
      functionName: "deposit",
      value: 10n ** 20n,
    });
    await publicClient.waitForTransactionReceipt({ hash: depositHash });
    const liquidityHash = await walletClient.writeContract({
      abi: artifacts.TestOnlyWBNB.abi,
      address: wbnb.address,
      args: [router.address, 5n * 10n ** 19n],
      functionName: "transfer",
    });
    await publicClient.waitForTransactionReceipt({ hash: liquidityHash });
    const approveHash = await walletClient.writeContract({
      abi: artifacts.TestOnlyERC20.abi,
      address: token.address,
      args: [helper.address, 10n ** 18n],
      functionName: "approve",
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const latestBlock = await publicClient.getBlock();
    const planDigest = keccak256(Buffer.from("p05-04-local-anvil-swap-v1"));
    const swapPlan = {
      amountIn: 10n ** 18n,
      deadline: latestBlock.timestamp + 600n,
      minAmountOut: 10n ** 18n,
      serviceFeeBps: 0,
      tokenIn: token.address,
      tokenOut: wbnb.address,
    };
    const emptyPermit = {
      enabled: false,
      permitSingle: {
        details: { amount: 0, expiration: 0, nonce: 0, token: zeroAddress },
        sigDeadline: 0n,
        spender: zeroAddress,
      },
      signature: "0x",
    };
    const stateAddresses = {
      adapter: adapter.address,
      helper: helper.address,
      owner: account.address,
      router: router.address,
      token: token.address,
      wbnb: wbnb.address,
    };
    const swapStateBefore = await swapState(publicClient, artifacts, stateAddresses);
    const swapHash = await walletClient.writeContract({
      abi: artifacts.WalletHelperV1.abi,
      address: helper.address,
      args: [planDigest, swapPlan, emptyPermit],
      functionName: "executeSwap",
    });
    const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
    const swapTransaction = await publicClient.getTransaction({ hash: swapHash });
    const swapStateAfter = await swapState(publicClient, artifacts, stateAddresses);
    if (
      BigInt(swapStateBefore.balances.owner.tokenIn) - BigInt(swapStateAfter.balances.owner.tokenIn)
        !== swapPlan.amountIn ||
      BigInt(swapStateAfter.balances.owner.tokenOut)
          - BigInt(swapStateBefore.balances.owner.tokenOut)
        !== swapPlan.minAmountOut ||
      swapStateAfter.allowances.helperToAdapter !== "0" ||
      swapStateAfter.allowances.adapterToRouter !== "0" ||
      swapStateAfter.balances.helper.tokenIn !== "0" ||
      swapStateAfter.balances.adapter.tokenIn !== "0"
    ) {
      throw new Error("successful swap balance or allowance reconciliation mismatch");
    }

    const failedApprovalHash = await walletClient.writeContract({
      abi: artifacts.TestOnlyERC20.abi,
      address: token.address,
      args: [helper.address, swapPlan.amountIn],
      functionName: "approve",
    });
    await publicClient.waitForTransactionReceipt({ hash: failedApprovalHash });
    const failedPlanDigest = keccak256(Buffer.from("p05-04-local-anvil-swap-revert-v1"));
    const failedSwapPlan = { ...swapPlan, minAmountOut: swapPlan.amountIn + 1n };
    const failedStateBefore = await swapState(publicClient, artifacts, stateAddresses);
    const failedSwapHash = await walletClient.writeContract({
      abi: artifacts.WalletHelperV1.abi,
      address: helper.address,
      args: [failedPlanDigest, failedSwapPlan, emptyPermit],
      functionName: "executeSwap",
      gas: 1_000_000n,
    });
    const failedSwapReceipt = await publicClient.waitForTransactionReceipt({
      hash: failedSwapHash,
    });
    const failedSwapTransaction = await publicClient.getTransaction({ hash: failedSwapHash });
    const failedStateAfter = await swapState(publicClient, artifacts, stateAddresses);
    const failedPlanRecorded = await publicClient.readContract({
      abi: artifacts.WalletHelperV1.abi,
      address: helper.address,
      args: [failedPlanDigest],
      functionName: "executedPlans",
    });
    if (failedSwapReceipt.status !== "reverted" || failedPlanRecorded) {
      throw new Error("failed swap did not preserve plan atomicity");
    }
    assertStateEqual(failedStateAfter, failedStateBefore, "failed swap");
    let duplicatePlanRejected = false;
    try {
      await publicClient.simulateContract({
        abi: artifacts.WalletHelperV1.abi,
        account,
        address: helper.address,
        args: [planDigest, swapPlan, emptyPermit],
        functionName: "executeSwap",
      });
    } catch {
      duplicatePlanRejected = true;
    }
    if (!duplicatePlanRejected) throw new Error("duplicate on-chain plan was accepted");

    const duplicateNonce = await publicClient.getTransactionCount({ address: account.address });
    const duplicateRaw = await account.signTransaction({
      chainId: CHAIN_ID,
      gas: 21_000n,
      gasPrice: 1_000_000_000n,
      nonce: duplicateNonce,
      to: account.address,
      value: 0n,
    });
    const duplicateExpectedHash = keccak256(duplicateRaw);
    const duplicateFirstHash = await publicClient.sendRawTransaction({
      serializedTransaction: duplicateRaw,
    });
    await publicClient.waitForTransactionReceipt({ hash: duplicateFirstHash });
    let duplicateTransportRejected = false;
    try {
      await publicClient.sendRawTransaction({ serializedTransaction: duplicateRaw });
    } catch {
      duplicateTransportRejected = true;
    }
    if (!duplicateTransportRejected || duplicateFirstHash !== duplicateExpectedHash) {
      throw new Error("raw transaction duplicate behavior mismatch");
    }

    await rpc(rpcUrl, "evm_setAutomine", [false]);
    const replacementNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const firstRaw = await account.signTransaction({
      chainId: CHAIN_ID,
      gas: 21_000n,
      gasPrice: 1_000_000_000n,
      nonce: replacementNonce,
      to: account.address,
      value: 1n,
    });
    const replacementRaw = await account.signTransaction({
      chainId: CHAIN_ID,
      gas: 21_000n,
      gasPrice: 2_000_000_000n,
      nonce: replacementNonce,
      to: account.address,
      value: 2n,
    });
    const firstHash = await publicClient.sendRawTransaction({ serializedTransaction: firstRaw });
    const replacementHash = await publicClient.sendRawTransaction({
      serializedTransaction: replacementRaw,
    });
    await rpc(rpcUrl, "evm_mine");
    await rpc(rpcUrl, "evm_setAutomine", [true]);
    const replacementReceipt = await publicClient.waitForTransactionReceipt({
      hash: replacementHash,
    });
    let firstReceiptMissing = false;
    try {
      await publicClient.getTransactionReceipt({ hash: firstHash });
    } catch {
      firstReceiptMissing = true;
    }
    if (!firstReceiptMissing || replacementReceipt.status !== "success") {
      throw new Error("nonce replacement did not reconcile");
    }

    const nonceBeforeRestart = await publicClient.getTransactionCount({ address: account.address });
    await stopAnvil(anvil);
    anvil = startAnvil(port, statePath, true);
    await waitForRpc(rpcUrl);
    publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const recoveredCode = await publicClient.getCode({ address: helper.address });
    const recoveredOwner = await publicClient.readContract({
      abi: artifacts.WalletHelperV1.abi,
      address: helper.address,
      functionName: "owner",
    });
    const recoveredPlan = await publicClient.readContract({
      abi: artifacts.WalletHelperV1.abi,
      address: helper.address,
      args: [planDigest],
      functionName: "executedPlans",
    });
    const recoveredNonce = await publicClient.getTransactionCount({ address: account.address });
    if (
      !recoveredCode ||
      keccak256(recoveredCode) !== componentIdentities.helper.runtimeCodeHash ||
      recoveredOwner.toLowerCase() !== account.address.toLowerCase() ||
      recoveredPlan !== true ||
      recoveredNonce !== nonceBeforeRestart
    ) {
      throw new Error("restart recovery mismatch");
    }

    const result = {
      schemaVersion: 1,
      workItemId: "P05-04",
      classification: "LOCAL-DECISION",
      environment: "foundry-anvil-only",
      compiler: {
        optimizer: true,
        optimizerRuns: 200,
        solcVersion: "0.8.26",
      },
      dependencyPins: {
        openzeppelin: {
          commit: "c64a1edb67b6e3f4a15cca8909c9482ad33a02b0",
          version: "v5.4.0",
        },
        permit2: { commit: "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219" },
      },
      network: { chainId: CHAIN_ID, forked: false, wallet: account.address.toLowerCase() },
      deploymentOrder: [
        { contract: "TestOnlyERC20", ...tokenIdentity, transactionHash: token.hash },
        { contract: "TestOnlyWBNB", ...wbnbIdentity, transactionHash: wbnb.hash },
        {
          contract: "TestOnlyPermit2",
          ...componentIdentities.permit2,
          transactionHash: permit2.hash,
        },
        {
          contract: "TestOnlySwapRouter",
          ...componentIdentities.router,
          transactionHash: router.hash,
        },
        {
          contract: "TestOnlyPositionManager",
          ...componentIdentities.positionManager,
          transactionHash: positionManager.hash,
        },
        {
          contract: "LocalExecutionAdapter",
          ...componentIdentities.adapter,
          transactionHash: adapter.hash,
        },
        {
          contract: "WalletHelperV1",
          ...componentIdentities.helper,
          transactionHash: helper.hash,
        },
      ],
      helperBaseline: {
        abiHash: artifacts.WalletHelperV1.abiHash,
        abiSelectors: artifacts.WalletHelperV1.selectors,
        businessSelectors: {
          executePosition: "0xf285ba97",
          executeSwap: "0x5a547e89",
          sweepNative: "0x6971b189",
          sweepToken: "0x3609afa9",
        },
        creationCodeBytes: (artifacts.WalletHelperV1.bytecode.length - 2) / 2,
        creationCodeHash: artifacts.WalletHelperV1.creationCodeHash,
        creationInputBytes: (helperCreationInput.length - 2) / 2,
        creationInputHash: keccak256(helperCreationInput),
        runtimeCodeBytes: componentIdentities.helper.runtimeCodeBytes,
        runtimeCodeHash: componentIdentities.helper.runtimeCodeHash,
      },
      routerBaseline: {
        abiHash: artifacts.TestOnlySwapRouter.abiHash,
        allowedSelectors: ["0xbb05e388"],
        selectorSet: artifacts.TestOnlySwapRouter.selectors,
      },
      operationEvidence: {
        duplicatePlanRejected,
        duplicateRawTransaction: {
          firstHash: duplicateFirstHash,
          repeatedHash: duplicateExpectedHash,
          secondSubmissionRejected: duplicateTransportRejected,
        },
        nonceReplacement: {
          firstHash,
          firstReceiptState: "replaced",
          nonce: String(replacementNonce),
          replacementHash,
          replacementReceiptStatus: replacementReceipt.status,
        },
        restartRecovery: {
          executedPlanRecovered: recoveredPlan,
          helperCodeHash: keccak256(recoveredCode),
          nonceBeforeRestart: String(nonceBeforeRestart),
          nonceRecovered: String(recoveredNonce),
          owner: recoveredOwner.toLowerCase(),
        },
        swap: {
          failure: {
            amountInBaseUnit: failedSwapPlan.amountIn.toString(),
            balanceAndAllowanceStateAfter: failedStateAfter,
            balanceAndAllowanceStateBefore: failedStateBefore,
            executedPlanRecorded: failedPlanRecorded,
            minAmountOutBaseUnit: failedSwapPlan.minAmountOut.toString(),
            planDigest: failedPlanDigest,
            receiptStatus: failedSwapReceipt.status,
            recipient: account.address.toLowerCase(),
            tokenPath: [token.address, wbnb.address],
            transactionHash: failedSwapHash,
            valueBaseUnit: failedSwapTransaction.value.toString(),
          },
          success: {
            amountInBaseUnit: swapPlan.amountIn.toString(),
            balanceAndAllowanceStateAfter: swapStateAfter,
            balanceAndAllowanceStateBefore: swapStateBefore,
            minAmountOutBaseUnit: swapPlan.minAmountOut.toString(),
            planDigest,
            receiptStatus: swapReceipt.status,
            recipient: account.address.toLowerCase(),
            tokenPath: [token.address, wbnb.address],
            transactionHash: swapHash,
            valueBaseUnit: swapTransaction.value.toString(),
          },
        },
      },
      executionCounters: {
        localChainWrites: 14,
        localRevertedTransactions: 1,
        localTransactionBroadcastsAccepted: 16,
        mainnetBroadcasts: 0,
        mainnetSignatures: 0,
        realFundOperations: 0,
        testnetBroadcasts: 0,
        testnetSignatures: 0,
      },
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, serialized);
    process.stdout.write(serialized);
  } finally {
    await stopAnvil(anvil);
    await rm(statePath, { force: true });
  }
}

main().catch((error) => {
  console.error(`P05-04 local execution snapshot failed: ${error.message}`);
  process.exitCode = 1;
});
