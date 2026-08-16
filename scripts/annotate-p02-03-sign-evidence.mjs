#!/usr/bin/env node
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const GOLDEN_ROOT = path.join(ROOT, "artifacts/acceptance/P02-03/golden");
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const PANCAKE_VAULT = "0x238a358808379702088667322f80ac48bad5e6c4";

function topicAddress(topic) {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function transferDelta(receipt, token, account) {
  let delta = 0n;
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== token ||
      log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      log.topics.length !== 3 ||
      log.data === "0x"
    ) {
      continue;
    }
    const amount = BigInt(log.data);
    if (topicAddress(log.topics[1]) === account) delta -= amount;
    if (topicAddress(log.topics[2]) === account) delta += amount;
  }
  return delta;
}

function evidenceFor(raw, normalized) {
  if (normalized.amount0 === null && normalized.amount1 === null && normalized.liquidityDelta === null) {
    return {
      method: "event-has-no-amount-or-liquidity-delta",
      status: "not-applicable",
    };
  }
  const custodyAddress =
    normalized.protocol === "pcsv4"
      ? PANCAKE_VAULT
      : normalized.protocol === "univ4"
        ? normalized.contractAddress
        : normalized.pool.poolAddress;
  if (!custodyAddress || !normalized.pool.token0 || !normalized.pool.token1) {
    throw new Error(`${normalized.protocol}/${raw.eventName}: custody or token identity missing`);
  }
  const delta0 = transferDelta(raw.receipt, normalized.pool.token0, custodyAddress);
  const delta1 = transferDelta(raw.receipt, normalized.pool.token1, custodyAddress);
  const base = {
    custodyAddress,
    receiptTokenDelta0: String(delta0),
    receiptTokenDelta1: String(delta1),
    token0: normalized.pool.token0,
    token1: normalized.pool.token1,
  };
  if (normalized.kind === "swap") {
    const multiplier = normalized.protocolGeneration === "v4" ? -1n : 1n;
    const exact =
      BigInt(normalized.amount0) === delta0 * multiplier &&
      BigInt(normalized.amount1) === delta1 * multiplier;
    if (!exact) throw new Error(`${normalized.protocol}/Swap: receipt delta mismatch`);
    return {
      ...base,
      convention:
        normalized.protocolGeneration === "v4"
          ? "event BalanceDelta is the inverse of custody token flow"
          : "event amount is the pool token flow",
      normalizedAmount0: normalized.amount0,
      normalizedAmount1: normalized.amount1,
      status: "verified-exact",
    };
  }
  if (normalized.kind === "liquidity.add" && normalized.protocolGeneration === "v3") {
    const exact = BigInt(normalized.amount0) === delta0 && BigInt(normalized.amount1) === delta1;
    if (!exact) throw new Error(`${normalized.protocol}/Mint: receipt delta mismatch`);
    return {
      ...base,
      convention: "mint amounts are positive pool inflows",
      normalizedAmount0: normalized.amount0,
      normalizedAmount1: normalized.amount1,
      status: "verified-exact",
    };
  }
  if (normalized.kind === "collect") {
    const exact = BigInt(normalized.amount0) === delta0 && BigInt(normalized.amount1) === delta1;
    if (!exact) throw new Error(`${normalized.protocol}/Collect: receipt delta mismatch`);
    return {
      ...base,
      convention: "collected amounts are normalized as negative pool outflows",
      normalizedAmount0: normalized.amount0,
      normalizedAmount1: normalized.amount1,
      status: "verified-exact",
    };
  }
  if (normalized.kind === "liquidity.remove" && normalized.protocolGeneration === "v3") {
    const direction = delta0 <= 0n && delta1 <= 0n && BigInt(normalized.liquidityDelta) < 0n;
    if (!direction) throw new Error(`${normalized.protocol}/Burn: receipt direction mismatch`);
    return {
      ...base,
      convention:
        "burn principal and liquidity are normalized negative; paired Collect includes principal plus accrued fees",
      normalizedAmount0: normalized.amount0,
      normalizedAmount1: normalized.amount1,
      normalizedLiquidityDelta: normalized.liquidityDelta,
      status: "verified-direction",
    };
  }
  const liquidityDelta = BigInt(normalized.liquidityDelta);
  const direction =
    liquidityDelta === 0n ||
    (liquidityDelta > 0n ? delta0 >= 0n && delta1 >= 0n : delta0 <= 0n && delta1 <= 0n);
  if (!direction) throw new Error(`${normalized.protocol}/ModifyLiquidity: receipt direction mismatch`);
  return {
    ...base,
    convention: "positive liquidityDelta is add; negative liquidityDelta is remove",
    normalizedLiquidityDelta: normalized.liquidityDelta,
    status: "verified-direction",
  };
}

async function main() {
  const protocols = (await readdir(path.join(GOLDEN_ROOT, "raw"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  let count = 0;
  for (const protocol of protocols) {
    const directory = path.join(GOLDEN_ROOT, "raw", protocol);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
    for (const file of files) {
      const rawPath = path.join(directory, file);
      const normalizedPath = path.join(GOLDEN_ROOT, "normalized", protocol, file);
      const [raw, normalized] = await Promise.all([
        readFile(rawPath, "utf8").then(JSON.parse),
        readFile(normalizedPath, "utf8").then(JSON.parse),
      ]);
      const artifact = {
        ...raw,
        amountSignEvidence: evidenceFor(raw, normalized),
      };
      await writeFile(rawPath, `${JSON.stringify(artifact, null, 2)}\n`);
      count += 1;
    }
  }
  process.stdout.write(`Annotated ${String(count)} golden events with receipt-delta evidence.\n`);
}

main().catch((error) => {
  process.stderr.write(`P02-03 sign annotation failed: ${error.message}\n`);
  process.exitCode = 1;
});
