import type {
  MarketPoolRow,
  MarketPoolSnapshot,
  RecommendedPoolRow,
} from "@lpbot/api-contract";
import { Decimal } from "decimal.js";

const evmAddressPattern = /^0x[0-9a-f]{40}$/u;
const poolIdPattern = /^0x[0-9a-f]{64}$/u;

function normalizedIdentity(row: MarketPoolRow): string | null {
  if (
    row.chainId !== 56 ||
    !row.token0Address ||
    !evmAddressPattern.test(row.token0Address) ||
    !row.token1Address ||
    !evmAddressPattern.test(row.token1Address)
  ) {
    return null;
  }

  if (row.protocol === "pcsv3" || row.protocol === "univ3") {
    if (!row.poolAddress || !evmAddressPattern.test(row.poolAddress) || row.poolId !== null) {
      return null;
    }
    return row.poolAddress;
  }
  if (!row.poolId || !poolIdPattern.test(row.poolId) || row.poolAddress !== null) return null;
  return row.poolId;
}

function candidate(row: MarketPoolRow, index: number) {
  const identity = normalizedIdentity(row);
  if (!identity || row.poolKey !== `56:${identity}` || row.feesUsd === null) return null;

  let fees: Decimal;
  try {
    fees = new Decimal(row.feesUsd);
  } catch {
    return null;
  }
  if (!fees.isFinite() || !fees.isPositive()) return null;
  return { fees, index, row };
}

function toWireRow(row: MarketPoolRow): RecommendedPoolRow {
  return {
    chainId: 56,
    feePips: row.feePips,
    feesUsd: row.feesUsd!,
    poolAddress: row.poolAddress,
    poolId: row.poolId,
    poolKey: row.poolKey,
    protocol: row.protocol,
    token0Address: row.token0Address!,
    token0Symbol: row.token0Symbol,
    token1Address: row.token1Address!,
    token1Symbol: row.token1Symbol,
  };
}

export function selectRecommendedPools(
  snapshot: MarketPoolSnapshot,
  limit: number,
): RecommendedPoolRow[] {
  if (snapshot.chainId !== 56 || snapshot.minutes !== 5) {
    throw new RangeError("RECOMMENDATION_SOURCE_INVALID");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError("RECOMMENDATION_LIMIT_INVALID");
  }

  const ordered = snapshot.rows
    .map(candidate)
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((left, right) => {
      const feeOrder = right.fees.comparedTo(left.fees);
      return feeOrder || left.row.poolKey.localeCompare(right.row.poolKey) || left.index - right.index;
    });
  const seen = new Set<string>();
  const selected: RecommendedPoolRow[] = [];
  for (const { row } of ordered) {
    if (seen.has(row.poolKey)) continue;
    seen.add(row.poolKey);
    selected.push(toWireRow(row));
    if (selected.length === limit) break;
  }
  return selected;
}
