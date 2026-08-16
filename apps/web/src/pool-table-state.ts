import type {
  EvmAddress,
  MarketPoolRow,
  PoolColumnKey,
  PoolColumnPreference,
} from "@lpbot/api-contract";

export const POOL_COLUMN_KEYS = [
  "pool",
  "protocol",
  "fees",
  "volume",
  "tvl",
  "txs",
  "fdv",
  "actions",
] as const satisfies readonly PoolColumnKey[];

export const DEFAULT_POOL_COLUMNS: readonly PoolColumnPreference[] = Object.freeze(
  POOL_COLUMN_KEYS.map((key) => ({ key, visible: true })),
);

const poolColumnKeySet = new Set<string>(POOL_COLUMN_KEYS);
const lockedPoolColumnKeys = new Set<PoolColumnKey>(["pool", "actions"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoolColumnKey(value: unknown): value is PoolColumnKey {
  return typeof value === "string" && poolColumnKeySet.has(value);
}

export function normalizePoolColumns(value: unknown): PoolColumnPreference[] {
  if (!Array.isArray(value)) return DEFAULT_POOL_COLUMNS.map((column) => ({ ...column }));
  const middle: PoolColumnPreference[] = [];
  const seen = new Set<PoolColumnKey>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isPoolColumnKey(item.key) ||
      typeof item.visible !== "boolean" ||
      seen.has(item.key)
    ) {
      continue;
    }
    seen.add(item.key);
    if (!lockedPoolColumnKeys.has(item.key)) {
      middle.push({ key: item.key, visible: item.visible });
    }
  }
  for (const key of POOL_COLUMN_KEYS.slice(1, -1)) {
    if (!seen.has(key)) middle.push({ key, visible: true });
  }
  return [
    { key: "pool", visible: true },
    ...middle,
    { key: "actions", visible: true },
  ];
}

export function setPoolColumnVisibility(
  value: readonly PoolColumnPreference[],
  key: PoolColumnKey,
  visible: boolean,
): PoolColumnPreference[] {
  const columns = normalizePoolColumns(value);
  if (lockedPoolColumnKeys.has(key)) return columns;
  return columns.map((column) => (column.key === key ? { ...column, visible } : column));
}

export function reorderPoolColumn(
  value: readonly PoolColumnPreference[],
  activeKey: PoolColumnKey,
  targetKey: PoolColumnKey,
): PoolColumnPreference[] {
  const columns = normalizePoolColumns(value);
  if (lockedPoolColumnKeys.has(activeKey) || activeKey === targetKey) return columns;
  const active = columns.find(({ key }) => key === activeKey);
  if (!active) return columns;
  const withoutActive = columns.filter(({ key }) => key !== activeKey);
  const targetIndex = withoutActive.findIndex(({ key }) => key === targetKey);
  if (targetIndex < 0) return columns;
  withoutActive.splice(targetIndex, 0, active);
  return normalizePoolColumns(withoutActive);
}

export function movePoolColumn(
  value: readonly PoolColumnPreference[],
  key: PoolColumnKey,
  direction: -1 | 1,
): PoolColumnPreference[] {
  const columns = normalizePoolColumns(value);
  if (lockedPoolColumnKeys.has(key)) return columns;
  const middle = columns.slice(1, -1);
  const index = middle.findIndex((column) => column.key === key);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= middle.length) return columns;
  [middle[index], middle[target]] = [middle[target]!, middle[index]!];
  return [{ key: "pool", visible: true }, ...middle, { key: "actions", visible: true }];
}

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
