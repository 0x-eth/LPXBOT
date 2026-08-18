#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "artifacts/acceptance/P05-01/fixtures/observed-helper");
const RPC_URL = process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org";
const CAPTURED_AT = "2026-08-19T00:00:00.000Z";
const OWNER_SELECTOR = "0x8da5cb5b";

const paths = [
  {
    helper: "0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5",
    name: "observed-v4-path-a",
    selector: "0x71fa74ed",
    sourcePage:
      "https://bscscan.com/txs?a=0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5&ps=100&p=1",
    transactionHashes: [
      "0xf5ae222e80cfe0e90304587ca8e890f6e7ddea51f38e16adb87b49cbb195ff74",
      "0x26155d3816e9dbd982796cea48aa225eda0190eaceede52db1b4c317452b9b17",
      "0x231013cbd4dbdd474f4db8e5327f8b5bc180ee6685c2bf56b4546a41eb7576a0",
      "0x878494f69ad1c3e25221865a94754584885e1a528767563ce48e6c1bd53779b3",
      "0xfba497df5f4fd6c90c383c22e2b8e2866b32c6d45c8203244a1d04ec509309bf",
      "0xf87853b69fce4c5e186726eb973de1c57b7259a44c573d5fb68e291513765780",
      "0x2649091e47981a7e210a34c1f70a8ae980f26ef1a8f599866b3f36e40f409ea1",
      "0x42f77af13617cf0f1465b9fc76a108633fd3a30905e181a715788a88d6bcd2e6",
      "0x8c17f35f3accdf274f7509300330a89b387e3b9ce25f524458bb3cccc6b58287",
      "0xf287785a2ba02dcefdc9b56d3a0af7d9f3c081be07930ca23e8bffbafccf15a2",
    ],
  },
  {
    helper: "0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5",
    name: "observed-v4-path-b",
    selector: "0x5dfd8e50",
    sourcePage:
      "https://bscscan.com/txs?a=0x30df22a0afb4167bad5c1af4aa0b6bf81506e0a5&ps=100&p=1",
    transactionHashes: [
      "0x920a5ed8864ed70d6638dcc0bc035b51f6bcdf27c04c9688663a6127bc67010e",
      "0x8cf90270cb4305b38c2d6183b55fb3395d66c6669c446ed625736510aa8e2b92",
      "0x8bb6e51c33f9d00155bbefe093a5b006ce89a49af4760700162f64f2986de243",
      "0x593220d7ca375d2b8d4feac518b3c77f3cdf84dee52bdb4abb2e33fd917188b0",
      "0xdef5e2616059588408af9d9ae2a1942b3ab5c861cade1f4d759177663dcda7dc",
      "0x733be11433f6b82f36048e6fd09bd9b3cc774816eb46dd44631c5ddb022c3c9e",
      "0x4f1852568e452605f9c5852060d03f90beacf6205521af82c71f8c0cfa34048e",
      "0xe9090479db16f6b80407c8fb9db1fcab1d1b2480fe573d5fc5993f25f9063085",
      "0x171fd0e1b153c687cd4cfef56276943a846a297825e638dd105fddc2cd4c2194",
      "0x4d43a3375bd5f12bef9f6797ff078118ad176c09ef189dc54390b086f3210fc6",
    ],
  },
  {
    helper: "0xaba69194bb40f3eeca3e27ce4f4fe526e6ef4139",
    name: "observed-v3-path-a",
    selector: "0xadc3f25c",
    sourcePage:
      "https://bscscan.com/txs?a=0xaba69194bb40f3eeca3e27ce4f4fe526e6ef4139&ps=100&p=1",
    transactionHashes: [
      "0x55cae52b9f02ce0a2bfdc61acd6038f7b594cb4809c379cdfe055ee9393afbed",
      "0x7c2c7c8a6f64b6358dff0b1f4f457a1ef9bf1d480e3580e03c985184ca18a853",
      "0xdf890b9acb1abac79e3589fe1debf23ccafa490b054d4249007e2cfbee1ec5",
      "0x0e98d381fc79d4b63a7877c554627a40b42de90320752473a7664fd271afedcd",
      "0xae1ded2d7dda2989df7e62be12531ffff311bd7a3022cd34cc562d5a32b78dd7",
      "0x12d9423bb1e132e23d9a860cc4fe3535707b6f49f8a19f9468a2a111f8e75eb5",
      "0xfd1bf1f062d52020cc8e8333bad35ce617d7137bc42cfa99d4588b29cd748e0b",
      "0x744d5a557bfc2b0f39aafc391dcff841da773a526b49697c266cfa43d0f42e9d",
      "0x1dadc87765d61b20e6fbf6fe3a8562af82bc8e452591b6e0abfbd595048b2a85",
      "0xd7d9f8969c5430727c5fe7beb21bc9ba6b2ea5e7dd4f5728cf2e65ea8dae755e",
    ],
  },
  {
    helper: "0xaba69194bb40f3eeca3e27ce4f4fe526e6ef4139",
    name: "observed-v3-path-b",
    selector: "0xfb691fd9",
    sourcePage:
      "https://bscscan.com/txs?a=0xaba69194bb40f3eeca3e27ce4f4fe526e6ef4139&ps=100&p=1",
    transactionHashes: [
      "0x324eb34bdf52a73782317821a4c07610d94339d6bdcde42ec42b63240d7952f5",
      "0xfdd05018d7ab6b27f92c4b683bb0d19d7499f7006f31c7cde9ebea63ff674c28",
      "0x25a3c6d6a95b6de346345453de5cab67db9b155beb273ca2d2c7f6d3e6ae79cb",
      "0x5f2213e5f76cf3cc5b6c604f6fe7c44976ebdf74b3472778c270a0b3feedd456",
      "0xe5ea58cf17cec6b5c345ad33ba2ae68dd681f0fcb020c059caa2a4d4f99e4c88",
      "0x754003d3e0f82f80b9b5d4fa1816930a0f9970ee5b4916ce238402710769f6a8",
      "0xe462ffc9d892754b99c5e2541e36597e79e6708be4f1dfad92d4c1499a5c6251",
      "0x1f3c56771eb4e02ed43acaa59703e62a1d3c6128f589e93a7d8ff332d92d9f40",
      "0xd2e0eecd4d60a1c5c068d5a0e08b17fb48ee8e540c62a2c752d55ed249ab359d",
      "0xb7c6df87b14fed8857785bdbc9929b506ef988b817520e63cffb9fc938b87289",
    ],
  },
];

let requestId = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rpc(method, params) {
  const id = ++requestId;
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        body: JSON.stringify({ id, jsonrpc: "2.0", method, params }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(JSON.stringify(payload.error));
      return payload.result;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw new Error(`${method} failed after retries: ${lastError?.message ?? "unknown error"}`);
}

function decodeOwner(result) {
  assert(/^0x[0-9a-f]{64}$/u.test(result), "owner() returned malformed data");
  return `0x${result.slice(-40)}`;
}

async function capture(pathFixture, transactionHash) {
  const transaction = await rpc("eth_getTransactionByHash", [transactionHash]);
  assert(transaction, `${transactionHash}: transaction missing`);
  assert(transaction.hash === transactionHash, `${transactionHash}: transaction hash mismatch`);
  assert(transaction.to?.toLowerCase() === pathFixture.helper, `${transactionHash}: Helper mismatch`);
  assert(transaction.input.slice(0, 10) === pathFixture.selector, `${transactionHash}: selector mismatch`);

  const [chainId, receipt, block, runtimeCode, ownerResult] = await Promise.all([
    rpc("eth_chainId", []),
    rpc("eth_getTransactionReceipt", [transactionHash]),
    rpc("eth_getBlockByHash", [transaction.blockHash, false]),
    rpc("eth_getCode", [pathFixture.helper, transaction.blockNumber]),
    rpc("eth_call", [{ data: OWNER_SELECTOR, to: pathFixture.helper }, transaction.blockNumber]),
  ]);
  assert(chainId === "0x38", `${transactionHash}: expected chainId 56`);
  assert(receipt?.transactionHash === transactionHash, `${transactionHash}: receipt missing`);
  assert(receipt.status === "0x1", `${transactionHash}: receipt is not successful`);
  assert(receipt.blockHash === transaction.blockHash, `${transactionHash}: receipt block mismatch`);
  assert(block?.hash === transaction.blockHash, `${transactionHash}: block missing`);
  assert(block.transactions.includes(transactionHash), `${transactionHash}: block omits transaction`);
  assert(runtimeCode !== "0x", `${transactionHash}: Helper runtime is empty`);
  assert(
    receipt.logs.every((log) => log.transactionHash === transactionHash),
    `${transactionHash}: foreign log in receipt`,
  );
  const owner = decodeOwner(ownerResult);
  assert(transaction.from.toLowerCase() === owner, `${transactionHash}: sender is not Helper owner`);

  return {
    schemaVersion: 1,
    classification: "OBSERVED",
    observedPath: pathFixture.name,
    selector: pathFixture.selector,
    network: {
      blockHash: transaction.blockHash,
      blockNumber: BigInt(transaction.blockNumber).toString(),
      chainId: 56,
      name: "BNB Smart Chain",
    },
    helper: {
      address: pathFixture.helper,
      owner,
      ownerCallResult: ownerResult,
      ownerSelector: OWNER_SELECTOR,
      runtimeCodeBytes: (runtimeCode.length - 2) / 2,
      runtimeCodeHash: keccak256(runtimeCode),
    },
    rawInput: transaction.input,
    transaction,
    receipt,
    logs: receipt.logs,
    block,
    sources: [
      {
        kind: "bscscan-transaction-index",
        retrievedAt: CAPTURED_AT,
        url: pathFixture.sourcePage,
      },
      {
        kind: "bscscan-transaction",
        retrievedAt: CAPTURED_AT,
        url: `https://bscscan.com/tx/${transactionHash}`,
      },
      {
        endpoint: RPC_URL,
        kind: "bsc-json-rpc",
        methods: [
          "eth_chainId",
          "eth_getTransactionByHash",
          "eth_getTransactionReceipt",
          "eth_getBlockByHash",
          "eth_getCode",
          "eth_call",
        ],
        retrievedAt: CAPTURED_AT,
      },
    ],
    executionCounters: {
      chainWrites: 0,
      realFundOperations: 0,
      transactionBroadcasts: 0,
      transactionSignatures: 0,
    },
  };
}

async function main() {
  if (process.env.CAPTURE_P05_READONLY !== "1") {
    throw new Error("set CAPTURE_P05_READONLY=1 to acknowledge the BSC read-only capture");
  }
  assert(paths.length === 4, "exactly four observed paths are required");
  assert(
    paths.every((entry) => entry.transactionHashes.length >= 10),
    "every observed path requires at least ten independent samples",
  );
  const hashes = paths.flatMap((entry) => entry.transactionHashes);
  assert(new Set(hashes).size === hashes.length, "transaction hashes must be independent");

  for (const pathFixture of paths) {
    const directory = path.join(OUTPUT, pathFixture.name);
    await mkdir(directory, { recursive: true });
    for (const transactionHash of pathFixture.transactionHashes) {
      const fixture = await capture(pathFixture, transactionHash);
      await writeFile(
        path.join(directory, `${transactionHash.slice(2)}.json`),
        `${JSON.stringify(fixture, null, 2)}\n`,
      );
      console.log(`${pathFixture.name} ${transactionHash}`);
    }
  }
}

main().catch((error) => {
  console.error(`P05-01 read-only fixture capture failed: ${error.message}`);
  process.exitCode = 1;
});
