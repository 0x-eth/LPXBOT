#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { keccak256 } from "viem";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "artifacts/acceptance/P02-03/golden/raw");
const CHAIN_ID = 56;
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionReceipt",
]);

const TOPICS = {
  Burn: "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c",
  Collect: "0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0",
  InitializePancake:
    "0x426cc62fe6a33a40ba2788c2c87a9c34ee4582b95bc9fa5a7bb7ae70b750b99c",
  InitializeUniswap:
    "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438",
  Mint: "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",
  ModifyLiquidity:
    "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec",
  PoolCreated: "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
  SwapPancakeV3:
    "0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83",
  SwapPancakeV4:
    "0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237",
  SwapUniswapV3:
    "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  SwapUniswapV4:
    "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
};

const contracts = {
  pcsv3Factory: "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865",
  pcsv3Pool: "0xab058332a7279f1e64162be08f59ac0cd9601759",
  pcsv4Manager: "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b",
  univ3BurnPool: "0x8fa4f1148a6e8af175bebe052b76cd39c649ee16",
  univ3Factory: "0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7",
  univ3MintPool: "0xa36e5b863c5570d5d2d43fa48eaba6464ed731fb",
  univ4Manager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
};

const poolCreated = (protocol, transactionHash, factory) => ({
  address: factory,
  eventName: "PoolCreated",
  protocol,
  topic0: TOPICS.PoolCreated,
  transactionHash,
});

const UNIV3_BURN_POOL_CREATED = poolCreated(
  "univ3",
  "0x84b411f05a4433311645052f01b2ed1e85e2faec26027de57de488e9e7b33309",
  contracts.univ3Factory,
);
const UNIV3_MINT_POOL_CREATED = poolCreated(
  "univ3",
  "0x3bcf1cafb86eb8d0d37ed3178698d1c1a648f6a77086e69c20e474a87eb8f982",
  contracts.univ3Factory,
);
const PCSV3_POOL_CREATED = poolCreated(
  "pcsv3",
  "0x528bffbe589099a65e8d1021341a551faf531089fd71f7c9359b162f090e84d8",
  contracts.pcsv3Factory,
);

const plans = [
  UNIV3_BURN_POOL_CREATED,
  {
    address: contracts.univ3MintPool,
    eventName: "Mint",
    logIndex: "0x1ca",
    prerequisites: [UNIV3_MINT_POOL_CREATED],
    protocol: "univ3",
    topic0: TOPICS.Mint,
    transactionHash: "0x8b7c305fc9dfc36874a59b8c5dd5be80bf8eff352534ab37488607b4958b4bf8",
  },
  {
    address: contracts.univ3BurnPool,
    eventName: "Burn",
    logIndex: "0x9d",
    prerequisites: [UNIV3_BURN_POOL_CREATED],
    protocol: "univ3",
    topic0: TOPICS.Burn,
    transactionHash: "0xb19cc0a69a4e3a9c2f5316dde2706926f26cf9fdfa21c0722febecc7de6d1635",
  },
  {
    address: contracts.univ3BurnPool,
    eventName: "Collect",
    logIndex: "0xa1",
    prerequisites: [UNIV3_BURN_POOL_CREATED],
    protocol: "univ3",
    topic0: TOPICS.Collect,
    transactionHash: "0xb19cc0a69a4e3a9c2f5316dde2706926f26cf9fdfa21c0722febecc7de6d1635",
  },
  {
    address: contracts.univ3BurnPool,
    eventName: "Swap",
    logIndex: "0xc9",
    prerequisites: [UNIV3_BURN_POOL_CREATED],
    protocol: "univ3",
    topic0: TOPICS.SwapUniswapV3,
    transactionHash: "0xba987e6b4e9c01ef85e4908cb433755a0f6450a396ebba2ad82da47da1709cd7",
  },
  PCSV3_POOL_CREATED,
  {
    address: contracts.pcsv3Pool,
    eventName: "Mint",
    logIndex: "0xee",
    prerequisites: [PCSV3_POOL_CREATED],
    protocol: "pcsv3",
    topic0: TOPICS.Mint,
    transactionHash: "0x56e5f975c3b7ce51860dc42e76a78528655834922e0a56b87ad1e531fc5c36f2",
  },
  {
    address: contracts.pcsv3Pool,
    eventName: "Burn",
    logIndex: "0x11e",
    prerequisites: [PCSV3_POOL_CREATED],
    protocol: "pcsv3",
    topic0: TOPICS.Burn,
    transactionHash: "0xde0b0e5f0ff631224b4f0656078471258843e3d8dc00f53678e250c93b6f8aa8",
  },
  {
    address: contracts.pcsv3Pool,
    eventName: "Collect",
    logIndex: "0x123",
    prerequisites: [PCSV3_POOL_CREATED],
    protocol: "pcsv3",
    topic0: TOPICS.Collect,
    transactionHash: "0xde0b0e5f0ff631224b4f0656078471258843e3d8dc00f53678e250c93b6f8aa8",
  },
  {
    address: contracts.pcsv3Pool,
    eventName: "Swap",
    logIndex: "0x14d",
    prerequisites: [PCSV3_POOL_CREATED],
    protocol: "pcsv3",
    topic0: TOPICS.SwapPancakeV3,
    transactionHash: "0x7ab78033c69e7b2e0bb901b9f878d161b9fae512d37267586d00300a14b28463",
  },
  {
    address: contracts.univ4Manager,
    eventName: "Initialize",
    logIndex: "0x235",
    protocol: "univ4",
    topic0: TOPICS.InitializeUniswap,
    transactionHash: "0x2cb3a2ddcfb9e8c9bfcb0ccb4fa598a714970e5fe12af26d71abb92d97c25bc5",
  },
  {
    address: contracts.univ4Manager,
    eventName: "ModifyLiquidity",
    logIndex: "0x135",
    prerequisiteEvent: "Initialize",
    protocol: "univ4",
    topic0: TOPICS.ModifyLiquidity,
    transactionHash: "0x24f165417f15a91e607ceefddc12e7abb999b0192735a774401ac90ac9cec513",
  },
  {
    address: contracts.univ4Manager,
    eventName: "Swap",
    logIndex: "0xa9",
    prerequisiteEvent: "Initialize",
    protocol: "univ4",
    topic0: TOPICS.SwapUniswapV4,
    transactionHash: "0x9584fd7b9474b8cf0fc7c6b30dc1cb2ba8f476fbf026cf4c775e3d4bd261c333",
  },
  {
    address: contracts.pcsv4Manager,
    eventName: "Initialize",
    logIndex: "0x1a9",
    protocol: "pcsv4",
    topic0: TOPICS.InitializePancake,
    transactionHash: "0x2022fdb2fdfef6f0cd1436437d02bb3d2822e633ddfea679c7f84fa10eabca46",
  },
  {
    address: contracts.pcsv4Manager,
    eventName: "ModifyLiquidity",
    logIndex: "0x1ac",
    prerequisiteEvent: "Initialize",
    protocol: "pcsv4",
    topic0: TOPICS.ModifyLiquidity,
    transactionHash: "0x2022fdb2fdfef6f0cd1436437d02bb3d2822e633ddfea679c7f84fa10eabca46",
  },
  {
    address: contracts.pcsv4Manager,
    eventName: "Swap",
    logIndex: "0x3a",
    prerequisiteEvent: "Initialize",
    protocol: "pcsv4",
    topic0: TOPICS.SwapPancakeV4,
    transactionHash: "0x0d8b6e16d7423372b96382461fd7c5210d5c20808668cd24ae0f5db2c87d07c2",
  },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function rpc(method, params) {
  if (!ALLOWED_METHODS.has(method)) throw new Error(`capture RPC method forbidden: ${method}`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(process.env.BSC_RPC_URL, {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload.error) {
          throw new Error(`RPC error ${String(payload.error.code)} for ${method}`);
        }
        return payload.result;
      }
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`RPC HTTP ${String(response.status)}`);
      }
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 3) await sleep(100 * 2 ** (attempt - 1));
  }
  throw new Error(`capture RPC retries exhausted for ${method}`);
}

function findLog(receipt, plan) {
  const matches = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === plan.address &&
      log.topics[0]?.toLowerCase() === plan.topic0 &&
      (!plan.logIndex || log.logIndex.toLowerCase() === plan.logIndex),
  );
  if (matches.length !== 1) {
    throw new Error(`${plan.protocol}/${plan.eventName}: expected one log, found ${matches.length}`);
  }
  return matches[0];
}

function delivery(log, header) {
  return {
    block: {
      blockHash: log.blockHash.toLowerCase(),
      blockNumber: String(BigInt(log.blockNumber)),
      blockTimestamp: String(BigInt(header.timestamp)),
      chainId: CHAIN_ID,
      parentHash: header.parentHash.toLowerCase(),
    },
    log: {
      address: log.address.toLowerCase(),
      blockHash: log.blockHash.toLowerCase(),
      blockNumber: String(BigInt(log.blockNumber)),
      chainId: CHAIN_ID,
      data: log.data.toLowerCase(),
      logIndex: Number(BigInt(log.logIndex)),
      removed: Boolean(log.removed),
      topics: log.topics.map((topic) => topic.toLowerCase()),
      transactionHash: log.transactionHash.toLowerCase(),
      transactionIndex: Number(BigInt(log.transactionIndex)),
    },
  };
}

function headerProjection(header) {
  return {
    baseFeePerGas: header.baseFeePerGas ?? null,
    gasLimit: header.gasLimit,
    gasUsed: header.gasUsed,
    hash: header.hash.toLowerCase(),
    milliTimestamp: header.milliTimestamp ?? null,
    number: header.number,
    parentHash: header.parentHash.toLowerCase(),
    receiptsRoot: header.receiptsRoot,
    stateRoot: header.stateRoot,
    timestamp: header.timestamp,
    transactionsRoot: header.transactionsRoot,
  };
}

const captureCache = new Map();

async function capturePlan(plan, capturedAt) {
  const key = `${plan.transactionHash}:${plan.address}:${plan.topic0}:${plan.logIndex ?? ""}`;
  if (captureCache.has(key)) return captureCache.get(key);
  const receipt = await rpc("eth_getTransactionReceipt", [plan.transactionHash]);
  if (!receipt || receipt.status !== "0x1") throw new Error(`${plan.protocol}/${plan.eventName}: receipt missing or failed`);
  const log = findLog(receipt, plan);
  const [header, observationHeader, code] = await Promise.all([
    rpc("eth_getBlockByNumber", [log.blockNumber, false]),
    rpc("eth_getBlockByNumber", ["latest", false]),
    rpc("eth_getCode", [log.address, "latest"]),
  ]);
  if (!header || !observationHeader || code === "0x") {
    throw new Error(`${plan.protocol}/${plan.eventName}: header or code missing`);
  }
  const result = {
    blockHeader: headerProjection(header),
    capturedAt,
    contractCode: {
      address: log.address.toLowerCase(),
      observedAtBlock: String(BigInt(observationHeader.number)),
      runtimeCodeHash: keccak256(code),
    },
    delivery: delivery(log, header),
    eventName: plan.eventName,
    protocol: plan.protocol,
    receipt,
    schemaVersion: 1,
  };
  captureCache.set(key, result);
  return result;
}

async function main() {
  if (process.env.P02_03_CAPTURE_LIVE_BSC !== "1") {
    throw new Error("P02_03_CAPTURE_LIVE_BSC=1 is required for the explicit live capture");
  }
  if (!process.env.BSC_RPC_URL) throw new Error("BSC_RPC_URL is required");
  const chainId = await rpc("eth_chainId", []);
  if (BigInt(chainId) !== BigInt(CHAIN_ID)) throw new Error("capture endpoint is not BSC chainId 56");
  const capturedAt = new Date().toISOString();
  const initialized = new Map();
  for (const plan of plans) {
    const captured = await capturePlan(plan, capturedAt);
    const prerequisites = [];
    for (const prerequisite of plan.prerequisites ?? []) {
      prerequisites.push(await capturePlan(prerequisite, capturedAt));
    }
    if (plan.prerequisiteEvent) {
      const prerequisite = initialized.get(`${plan.protocol}:${plan.prerequisiteEvent}`);
      if (!prerequisite) throw new Error(`${plan.protocol}: prerequisite ${plan.prerequisiteEvent} not captured`);
      prerequisites.push(prerequisite);
    }
    const artifact = {
      ...captured,
      ...(prerequisites.length > 0 ? { prerequisites } : {}),
    };
    if (plan.eventName === "Initialize") {
      initialized.set(`${plan.protocol}:${plan.eventName}`, captured);
    }
    const directory = path.join(OUTPUT, plan.protocol);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, `${plan.eventName}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
  }
  process.stdout.write(`Captured ${String(plans.length)} BSC golden events without writing the RPC URL.\n`);
}

main().catch((error) => {
  process.stderr.write(`P02-03 capture failed: ${error.message}\n`);
  process.exitCode = 1;
});
