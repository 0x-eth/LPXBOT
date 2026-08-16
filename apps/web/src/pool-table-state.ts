import type { EvmAddress, MarketPoolRow } from "@lpbot/api-contract";

export const BSC_QUOTE_TOKEN_ADDRESSES = Object.freeze([
  "0x55d398326f99059ff775485246999027b3197955",
  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",
] as const satisfies readonly EvmAddress[]);

const quoteTokens = new Set<string>(BSC_QUOTE_TOKEN_ADDRESSES);

export type PoolGroupingMode =
  | { type: "default" }
  | { tokenAddress: EvmAddress; type: "token-search" };

export interface PoolRowGroup {
  additionalCount: number;
  groupKey: string;
  header: MarketPoolRow;
  members: MarketPoolRow[];
}

export interface VisiblePoolRow {
  additionalCount: number;
  groupKey: string;
  isHeader: boolean;
  row: MarketPoolRow;
}

function canonicalAddress(value: string | null): string | null {
  return value?.toLowerCase() ?? null;
}

function defaultGroupToken(row: MarketPoolRow): string | null {
  const token0 = canonicalAddress(row.token0Address);
  const token1 = canonicalAddress(row.token1Address);
  if (!token0 || !token1) return null;
  const token0IsQuote = quoteTokens.has(token0);
  const token1IsQuote = quoteTokens.has(token1);
  if (token0IsQuote === token1IsQuote) return null;
  return token0IsQuote ? token1 : token0;
}

function tokenSearchGroup(row: MarketPoolRow, tokenAddress: EvmAddress): string | null {
  const token = tokenAddress.toLowerCase();
  return canonicalAddress(row.token0Address) === token || canonicalAddress(row.token1Address) === token
    ? token
    : null;
}

function groupKeyForRow(row: MarketPoolRow, mode: PoolGroupingMode): string {
  const token =
    mode.type === "token-search"
      ? tokenSearchGroup(row, mode.tokenAddress)
      : defaultGroupToken(row);
  return token ? `${row.chainId}:${token}` : `pool:${row.poolKey}`;
}

export function groupPoolRows(
  rows: readonly MarketPoolRow[],
  mode: PoolGroupingMode,
): PoolRowGroup[] {
  const grouped = new Map<string, MarketPoolRow[]>();
  for (const row of rows) {
    const groupKey = groupKeyForRow(row, mode);
    const members = grouped.get(groupKey) ?? [];
    members.push(row);
    grouped.set(groupKey, members);
  }
  return [...grouped].map(([groupKey, members]) => ({
    additionalCount: members.length - 1,
    groupKey,
    header: members[0]!,
    members,
  }));
}

export function flattenPoolGroups(
  groups: readonly PoolRowGroup[],
  expandedGroupKeys: ReadonlySet<string>,
): VisiblePoolRow[] {
  return groups.flatMap((group) => {
    const expanded = group.members.length > 1 && expandedGroupKeys.has(group.groupKey);
    const members = expanded ? group.members : [group.header];
    return members.map((row, index) => ({
      additionalCount: index === 0 && !expanded ? group.additionalCount : 0,
      groupKey: group.groupKey,
      isHeader: index === 0,
      row,
    }));
  });
}

export function reconcileExpandedPoolGroups(
  expandedGroupKeys: ReadonlySet<string>,
  groups: readonly PoolRowGroup[],
): Set<string> {
  const expandable = new Set(
    groups.filter(({ members }) => members.length > 1).map(({ groupKey }) => groupKey),
  );
  return new Set([...expandedGroupKeys].filter((groupKey) => expandable.has(groupKey)));
}
