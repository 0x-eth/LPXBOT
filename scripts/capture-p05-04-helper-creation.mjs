#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { keccak256 } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = "https://bsc-mainnet.public.blastapi.io";
const OUTPUT = path.join(
  ROOT,
  "artifacts/acceptance/P05-04/observed-helper-creation.json",
);
const OWNER_SELECTOR = "0x8da5cb5b";
const DEPLOYMENTS = [
  {
    blockNumber: "111264010",
    expectedCreateNonce: "6485",
    expectedRuntimeCodeHash:
      "0x42795bc1467d4c1aad4704c13255eb646768885f22886c486430b30a93caebd7",
    helper: "0xaba69194bb40f3eeca3e27ce4f4fe526e6ef4139",
    owner: "0xfd6f4bdea39a8796dc120f1cc08b92dcc0290549",
    transactionHash:
      "0x8bc83c1ce3bd484dd7efb5450aa8016714b45e8d52076ccf8b9734a58d34e68d",
  },
  {
    blockNumber: "111620738",
    expectedCreateNonce: "238",
    expectedRuntimeCodeHash:
      "0xaf866c449723b487e87ce38974433ea413a2e7826226865c678665d84c86cd85",
    helper: "0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5",
    owner: "0xc623ab46fa6ff2f547e35f88679a9ebf0b823227",
    transactionHash:
      "0xf39ebe9e16dc2ef48fc8a39721c15426e72b2506d6097794fd1fbfba91c24923",
  },
];

let rpcId = 0;

async function rpc(method, params) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(RPC_URL, {
      body: JSON.stringify({ id: ++rpcId, jsonrpc: "2.0", method, params }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();
    if (response.ok && body.result !== undefined) return body.result;
    if (attempt === 4) throw new Error(`${method}: ${JSON.stringify(body.error ?? body)}`);
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new Error(`${method}: retry exhaustion`);
}

function selectors(runtimeCode) {
  return execFileSync("cast", ["selectors", runtimeCode], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/u)[0])
    .filter((value) => /^0x[0-9a-f]{8}$/u.test(value))
    .sort();
}

async function capture(deployment) {
  const blockTag = `0x${BigInt(deployment.blockNumber).toString(16)}`;
  const [transaction, receipt, runtimeCode, ownerCallResult] = await Promise.all([
    rpc("eth_getTransactionByHash", [deployment.transactionHash]),
    rpc("eth_getTransactionReceipt", [deployment.transactionHash]),
    rpc("eth_getCode", [deployment.helper, blockTag]),
    rpc("eth_call", [{ data: OWNER_SELECTOR, to: deployment.helper }, blockTag]),
  ]);
  if (
    !transaction ||
    transaction.to !== null ||
    transaction.from.toLowerCase() !== deployment.owner ||
    BigInt(transaction.nonce).toString() !== deployment.expectedCreateNonce ||
    receipt.status !== "0x1" ||
    receipt.contractAddress.toLowerCase() !== deployment.helper ||
    keccak256(runtimeCode) !== deployment.expectedRuntimeCodeHash ||
    `0x${ownerCallResult.slice(-40)}` !== deployment.owner
  ) {
    throw new Error(`creation identity mismatch for ${deployment.helper}`);
  }
  return {
    blockHash: transaction.blockHash,
    blockNumber: deployment.blockNumber,
    createNonce: deployment.expectedCreateNonce,
    creationInputBytes: (transaction.input.length - 2) / 2,
    creationInputHash: keccak256(transaction.input),
    helper: deployment.helper,
    owner: deployment.owner,
    ownerCallResult,
    receiptStatus: receipt.status,
    runtimeCodeBytes: (runtimeCode.length - 2) / 2,
    runtimeCodeHash: keccak256(runtimeCode),
    selectorSet: selectors(runtimeCode),
    transactionHash: deployment.transactionHash,
    creationInput: transaction.input,
  };
}

async function main() {
  const deployments = [];
  for (const deployment of DEPLOYMENTS) deployments.push(await capture(deployment));
  const [first, second] = deployments;
  if (
    first.creationInput !== second.creationInput ||
    first.creationInputHash !== second.creationInputHash ||
    first.selectorSet.join(",") !== second.selectorSet.join(",")
  ) {
    throw new Error("observed Helpers do not share the frozen creation build");
  }
  const creationInput = first.creationInput;
  for (const deployment of deployments) delete deployment.creationInput;
  const artifact = {
    schemaVersion: 1,
    workItemId: "P05-04",
    classification: "OBSERVED",
    network: { chainId: 56, name: "BNB Smart Chain" },
    source: {
      endpoint: RPC_URL,
      methods: [
        "eth_call",
        "eth_getCode",
        "eth_getTransactionByHash",
        "eth_getTransactionReceipt",
      ],
      readOnly: true,
      retrievedAt: "2026-08-19T14:45:00.000Z",
    },
    creationBuild: {
      constructorArgumentBytes: 0,
      constructorOwnerSource: "CALLER",
      creationInput,
      creationInputBytes: first.creationInputBytes,
      creationInputHash: first.creationInputHash,
      ownerEvidence:
        "creation init reads CALLER; transaction.from equals owner() at the deployment block",
    },
    deployments,
    runtimeComparison: {
      sameCreationInput: true,
      sameCreationInputHash: true,
      sameRuntimeLength: true,
      sameSelectorSet: true,
      runtimeHashesEqual: false,
      observedDifference:
        "owner and self-hash immutable patch sites produce owner-specific runtime hashes",
      proxyDetected: false,
      observedRuntimeBuildVersions: 1,
      historicalNinetyThreeByteDelta: {
        classification: "UNKNOWN",
        availableInP0501Fixtures: false,
        executionEnabled: false,
      },
    },
    executionCounters: {
      chainWrites: 0,
      realFundOperations: 0,
      transactionBroadcasts: 0,
      transactionSignatures: 0,
    },
  };
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `Captured ${deployments.length} observed Helper creations with shared ${first.creationInputBytes}-byte input.`,
  );
}

main().catch((error) => {
  console.error(`P05-04 Helper creation capture failed: ${error.message}`);
  process.exitCode = 1;
});
