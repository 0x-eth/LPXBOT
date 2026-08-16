import {
  canonicalizeLiquidityProtocols,
  liquidityFlowProtocols,
  type EvmAddress,
  type LiquidityFlowEvent,
  type LiquidityFlowProtocol,
  type MarketPoolRow,
  type MarketPoolSnapshot,
  type MarketWindowMinutes,
  type PoolColumnKey,
  type PoolColumnPreference,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import { Decimal } from "decimal.js";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Filter,
  GitCompareArrows,
  GripVertical,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AddressRemarksClient, AddressRemarksRequestError } from "./address-remarks-client.js";
import {
  addressRemarkLabel,
  initialAddressRemarksState,
  reduceAddressRemarks,
  watchedAddressSet,
  type AddressRemarksState,
} from "./address-remarks-state.js";
import { LiquidityFlowClient, type LiquidityFlowServerFilters } from "./liquidity-flow-client";
import {
  buildLiquidityFlowProjection,
  defaultLiquidityFlowUiFilters,
  initialLiquidityFlowState,
  parseLiquidityFlowUiFilters,
  reduceLiquidityFlow,
  serializeLiquidityFlowUiFilters,
  type LiquidityFlowAddressAggregate,
  type LiquidityFlowAddressSort,
  type LiquidityFlowConnection as FlowConnection,
  type LiquidityFlowSummary,
  type LiquidityFlowUiFilters,
} from "./liquidity-flow-state";
import { PoolsClient } from "./pools-client";
import {
  buildPoolComparison,
  initialPoolComparisonState,
  reconcilePoolComparison,
  togglePoolComparison,
  type PoolComparisonState,
  type PoolComparisonView,
} from "./pool-comparison-state";
import {
  defaultPoolAdvancedFilters,
  filterAndSortPoolRows,
  parsePoolAdvancedFilters,
  poolAdvancedFiltersAreDefault,
  poolNumericFilterKeys,
  validatePoolAdvancedFilters,
  writePoolAdvancedFilters,
  type PoolAdvancedFilters,
  type PoolNumericFilterKey,
} from "./pool-filter-state";
import {
  PoolSearchRequestManager,
  filterPoolsByIdentity,
  initialPoolSearchState,
  parsePoolSearchParameters,
  reducePoolSearch,
  validTokenSearchAddress,
  writePoolSearchParameters,
  type PoolSearchMode,
  type PoolSearchState,
} from "./pool-search-state";
import {
  initialPoolStreamState,
  reducePoolStream,
  type PoolConnectionState,
} from "./pools-stream-state";
import {
  DEFAULT_POOL_COLUMNS,
  flattenPoolGroups,
  formatPoolRatioPercent,
  groupPoolRows,
  movePoolColumn,
  normalizePoolColumns,
  reconcileExpandedPoolGroups,
  reorderPoolColumn,
  setPoolColumnVisibility,
  type VisiblePoolRow,
} from "./pool-table-state";
import { useUserPreferences } from "./preferences";

const windows = [1, 5, 15, 30, 60] as const;

const basePoolRow: MarketPoolRow = {
  activeTvlUsd: null,
  chainId: 56,
  fdvUsd: "184250000.25",
  feePips: "2500",
  feeActiveTvl: null,
  feesUsd: "428.125000000000000001",
  feeTvl: "0.00428125000000000001",
  hooks: null,
  poolAddress: "0x1111111111111111111111111111111111111111",
  poolId: null,
  poolKey: "56:0x1111111111111111111111111111111111111111",
  protocol: "pcsv3",
  tickSpacing: "50",
  token0Address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  token0Symbol: "WBNB",
  token1Address: "0x55d398326f99059ff775485246999027b3197955",
  token1Symbol: "USDT",
  transactionCount: "37",
  tvlUsd: "100000.000000000000000001",
  volumeUsd: "248921.75",
};

const fixturePoolRows: MarketPoolRow[] = liquidityFlowProtocols.map((protocol, index) => {
  const v4 = protocol.endsWith("v4");
  const poolAddress = v4
    ? null
    : (`0x${String(index + 1).repeat(40)}` as MarketPoolRow["poolAddress"]);
  const poolId = v4 ? (`0x${String(index + 1).repeat(64)}` as MarketPoolRow["poolId"]) : null;
  const identity = poolAddress ?? poolId!;
  const feesUsd = new Decimal(basePoolRow.feesUsd!).minus(index * 36).toString();
  return {
    ...basePoolRow,
    fdvUsd: new Decimal(basePoolRow.fdvUsd!).plus(index * 1_000_000).toString(),
    feesUsd,
    feeTvl: new Decimal(feesUsd).dividedBy(basePoolRow.tvlUsd!).toString(),
    hooks:
      v4 && index === 3 ? "0x4444444444444444444444444444444444444444" : null,
    poolAddress,
    poolId,
    poolKey: `56:${identity}`,
    protocol,
    token0Address: (index < 2
      ? basePoolRow.token0Address
      : `0x${String.fromCharCode(97 + index).repeat(40)}`) as MarketPoolRow["token0Address"],
    token0Symbol: index === 0 ? "WBNB" : ["WBNB", "USDC", "币安币"][index - 1]!,
    transactionCount: String(37 - index * 7),
    volumeUsd: new Decimal(basePoolRow.volumeUsd!).minus(index * 40_000).toString(),
  };
});

function fixturePoolSnapshot(
  minutes: MarketWindowMinutes,
  rows: MarketPoolRow[],
): MarketPoolSnapshot {
  return {
    chainId: 56,
    generatedAt: "2026-08-16T01:00:01.000Z",
    minutes,
    rows,
    version: "fixture-1",
    windowEnd: "2026-08-16T01:00:00.000Z",
    windowStart: new Date(Date.parse("2026-08-16T01:00:00.000Z") - minutes * 60_000).toISOString(),
  };
}

function fixtureFlowEvent(
  id: string,
  ts: number,
  overrides: Partial<LiquidityFlowEvent>,
): LiquidityFlowEvent {
  return {
    amount0: null,
    amount1: null,
    block_hash: `0x${"11".repeat(32)}`,
    block_number: String(116_184_000 + ts),
    chain_id: 56,
    cursor: `flow:fixture:${id}`,
    dex: "pcsv3",
    event_type: "add",
    finality: "observed",
    hooks: null,
    id,
    in_range: null,
    liquidity_delta: "1000",
    log_index: 1,
    nft_id: null,
    pool_address: "0x1111111111111111111111111111111111111111",
    pool_id: null,
    record_type: "event",
    schema_version: "1.0.0",
    tick_lower: null,
    tick_upper: null,
    token0_address: "0x2222222222222222222222222222222222222222",
    token0_symbol: null,
    token1_address: "0x3333333333333333333333333333333333333333",
    token1_symbol: null,
    ts,
    tx_hash: `0x${"22".repeat(32)}`,
    tx_index: 1,
    usd_value: null,
    user: "0x4444444444444444444444444444444444444444",
    version: "v3",
    ...overrides,
  };
}

const fixtureFlowEvents: LiquidityFlowEvent[] = [
  fixtureFlowEvent("flow-univ4-remove", 1_765_843_203_000, {
    dex: "univ4",
    event_type: "remove",
    nft_id: "42",
    usd_value: "125.5",
    user: "0x5555555555555555555555555555555555555555",
    version: "v4",
  }),
  fixtureFlowEvent("flow-pcsv4-remove", 1_765_843_202_000, {
    dex: "pcsv4",
    event_type: "remove",
    user: "0x6666666666666666666666666666666666666666",
    version: "v4",
  }),
  fixtureFlowEvent("flow-univ3-create", 1_765_843_201_000, {
    dex: "univ3",
    event_type: "create",
  }),
  fixtureFlowEvent("flow-pcsv3-add", 1_765_843_200_000, {
    usd_value: "250.125000000000000001",
  }),
];

type PoolsFixtureState = PoolConnectionState;

function fixtureState(search: string): PoolsFixtureState | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(search).get("fixture");
  if (!value?.startsWith("pools-")) return null;
  const state = value.slice("pools-".length);
  return ["loading", "empty", "ready", "error", "stale", "reconnecting"].includes(state)
    ? (state as PoolsFixtureState)
    : null;
}

function fixtureFlowState(
  search: string,
  fixture: PoolsFixtureState | null,
): FlowConnection | null {
  if (!fixture) return null;
  const explicit = new URLSearchParams(search).get("flow_state");
  const states: FlowConnection[] = [
    "loading-backfill",
    "live",
    "paused-hidden",
    "empty",
    "error",
    "stale",
    "reconnecting",
  ];
  if (explicit && states.includes(explicit as FlowConnection)) return explicit as FlowConnection;
  const byPoolState: Record<PoolsFixtureState, FlowConnection> = {
    empty: "empty",
    error: "error",
    loading: "loading-backfill",
    ready: "live",
    reconnecting: "reconnecting",
    stale: "stale",
  };
  return byPoolState[fixture];
}

function protocolsFromSearch(search: string): LiquidityFlowProtocol[] {
  try {
    return canonicalizeLiquidityProtocols(
      new URLSearchParams(search).get("dex")?.split(",") ?? liquidityFlowProtocols,
    );
  } catch {
    return [...liquidityFlowProtocols];
  }
}

function protocolName(protocol: LiquidityFlowProtocol): string {
  const names: Record<LiquidityFlowProtocol, string> = {
    pcsv3: "PancakeSwap V3",
    pcsv4: "PancakeSwap V4",
    univ3: "Uniswap V3",
    univ4: "Uniswap V4",
  };
  return names[protocol];
}

function decimalDisplay(value: string | null, prefix = "", fractionDigits = 6): string {
  if (value === null) return "--";
  const display = new Decimal(value)
    .toDecimalPlaces(fractionDigits, Decimal.ROUND_HALF_EVEN)
    .toFixed();
  const [integer, fraction] = display.split(".");
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${prefix}${grouped}${fraction ? `.${fraction}` : ""}`;
}

function compactDecimalDisplay(value: string | null, prefix = ""): string {
  if (value === null) return "--";
  const decimal = new Decimal(value);
  for (const { divisor, suffix } of [
    { divisor: new Decimal("1000000000"), suffix: "B" },
    { divisor: new Decimal("1000000"), suffix: "M" },
    { divisor: new Decimal("1000"), suffix: "K" },
  ]) {
    if (decimal.abs().greaterThanOrEqualTo(divisor)) {
      return `${prefix}${decimal
        .dividedBy(divisor)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)
        .toFixed()}${suffix}`;
    }
  }
  return decimalDisplay(value, prefix);
}

function NumericValue({
  fractionDigits,
  label,
  prefix = "",
  value,
}: {
  fractionDigits?: number;
  label: string;
  prefix?: string;
  value: string | null;
}) {
  return (
    <td className="numeric-value" data-label={label} title={value ?? undefined}>
      <span className="numeric-full">{decimalDisplay(value, prefix, fractionDigits)}</span>
      <span className="numeric-compact">{compactDecimalDisplay(value, prefix)}</span>
    </td>
  );
}

function RatioValue({ label, value }: { label: string; value: string | null }) {
  const display = formatPoolRatioPercent(value);
  return (
    <td className="numeric-value" data-label={label} title={value ?? undefined}>
      <span className="numeric-full">{display}</span>
      <span className="numeric-compact">{display}</span>
    </td>
  );
}

function shortIdentity(value: string | null): string {
  if (!value) return "--";
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function poolConnectionLabel(connection: PoolConnectionState): string {
  const labels: Record<PoolConnectionState, string> = {
    empty: "实时 · 暂无池数据",
    error: "连接失败",
    loading: "正在连接",
    ready: "实时",
    reconnecting: "重连中",
    stale: "数据陈旧",
  };
  return labels[connection];
}

function ConnectionStatus({ connection }: { connection: PoolConnectionState }) {
  const Icon = connection === "error" ? WifiOff : connection === "ready" ? Wifi : RefreshCw;
  return (
    <div
      aria-label="市场数据连接状态"
      className="pools-connection"
      data-connection={connection}
      role="status"
    >
      <Icon aria-hidden="true" size={15} />
      <span>{poolConnectionLabel(connection)}</span>
    </div>
  );
}

const poolColumnLabels: Record<PoolColumnKey, string> = {
  actions: "操作",
  fdv: "FDV",
  feeActiveTvl: "Fee/aTVL",
  fees: "Fees",
  feeTvl: "Fee/TVL",
  pool: "池",
  protocol: "协议",
  tvl: "TVL",
  txs: "Txs",
  volume: "Volume",
};

function PoolTableCell({
  column,
  comparisonEnabled,
  comparisonSelected,
  toggleComparison,
  toggleGroup,
  visibleRow,
}: {
  column: PoolColumnKey;
  comparisonEnabled: boolean;
  comparisonSelected: boolean;
  toggleComparison(poolKey: string): void;
  toggleGroup(groupKey: string): void;
  visibleRow: VisiblePoolRow;
}) {
  const { row } = visibleRow;
  const identity = row.poolAddress ?? row.poolId!;
  if (column === "pool") {
    return (
      <td className="pool-identity-cell" data-label="池">
        <div className="pool-name-line">
          {visibleRow.isHeader && visibleRow.additionalCount > 0 ? (
            <button
              aria-expanded={visibleRow.expanded}
              aria-label={`${visibleRow.expanded ? "折叠" : "展开"}池分组 ${visibleRow.groupKey}`}
              className="pool-group-toggle"
              onClick={() => toggleGroup(visibleRow.groupKey)}
              type="button"
            >
              {visibleRow.expanded ? (
                <ChevronDown aria-hidden="true" size={14} />
              ) : (
                <ChevronRight aria-hidden="true" size={14} />
              )}
              <span>+{visibleRow.additionalCount}</span>
            </button>
          ) : (
            <span aria-hidden="true" className="pool-group-spacer" />
          )}
          <strong>
            {row.token0Symbol ?? "--"} / {row.token1Symbol ?? "--"}
          </strong>
        </div>
        <code className="pool-address" title={identity}>
          {identity}
        </code>
      </td>
    );
  }
  if (column === "protocol") {
    return <td data-label="协议">{protocolName(row.protocol)}</td>;
  }
  if (column === "fees") return <NumericValue label="Fees" prefix="$ " value={row.feesUsd} />;
  if (column === "volume") {
    return <NumericValue label="Volume" prefix="$ " value={row.volumeUsd} />;
  }
  if (column === "feeTvl") return <RatioValue label="Fee/TVL" value={row.feeTvl} />;
  if (column === "feeActiveTvl") {
    return <RatioValue label="Fee/aTVL" value={row.feeActiveTvl} />;
  }
  if (column === "tvl") return <NumericValue label="TVL" prefix="$ " value={row.tvlUsd} />;
  if (column === "txs") {
    return <NumericValue fractionDigits={0} label="Txs" value={row.transactionCount} />;
  }
  if (column === "fdv") return <NumericValue label="FDV" prefix="$ " value={row.fdvUsd} />;
  return (
    <td className="pool-row-actions" data-label="操作">
      <button
        aria-label={`${comparisonSelected ? "移出" : "选择"}对比 ${identity}`}
        aria-pressed={comparisonSelected}
        disabled={!comparisonEnabled}
        onClick={() => toggleComparison(row.poolKey)}
        title={comparisonEnabled ? "池对比" : "当前快照不可用"}
        type="button"
      >
        <GitCompareArrows aria-hidden="true" size={15} />
      </button>
      <button
        aria-label={`复制池身份 ${identity}`}
        onClick={() => void navigator.clipboard.writeText(identity)}
        title="复制池身份"
        type="button"
      >
        <Copy aria-hidden="true" size={15} />
      </button>
    </td>
  );
}

function PoolTable({
  columns,
  comparisonCandidateKeys,
  comparisonSelectedKeys,
  rows,
  toggleComparison,
  toggleGroup,
}: {
  columns: readonly PoolColumnPreference[];
  comparisonCandidateKeys: ReadonlySet<string>;
  comparisonSelectedKeys: ReadonlySet<string>;
  rows: readonly VisiblePoolRow[];
  toggleComparison(poolKey: string): void;
  toggleGroup(groupKey: string): void;
}) {
  const visibleColumns = columns.filter(({ visible }) => visible);
  return (
    <div className="pools-table-shell">
      <table aria-label="BSC 热门池" className="pools-table">
        <thead>
          <tr>
            {visibleColumns.map(({ key }) => (
              <th className={`pool-column-${key}`} key={key} scope="col">
                {poolColumnLabels[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((visibleRow) => (
            <tr
              data-group-member={!visibleRow.isHeader ? "true" : undefined}
              key={visibleRow.row.poolKey}
            >
              {visibleColumns.map(({ key }) => (
                <PoolTableCell
                  column={key}
                  comparisonEnabled={comparisonCandidateKeys.has(visibleRow.row.poolKey)}
                  comparisonSelected={comparisonSelectedKeys.has(visibleRow.row.poolKey)}
                  key={key}
                  toggleComparison={toggleComparison}
                  toggleGroup={toggleGroup}
                  visibleRow={visibleRow}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoolSearchControls({
  clear,
  mode,
  query,
  refresh,
  setMode,
  setQuery,
  state,
  submit,
}: {
  clear(): void;
  mode: PoolSearchMode;
  query: string;
  refresh(): void;
  setMode(mode: PoolSearchMode): void;
  setQuery(query: string): void;
  state: PoolSearchState;
  submit(): void;
}) {
  const active = state.status !== "pristine";
  const statusText: Partial<Record<PoolSearchState["status"], string>> = {
    error: "搜索暂不可用",
    invalid: mode === "token" ? "请输入合法 Token 地址" : "请输入合法池地址或 Pool ID",
    loading: "正在搜索",
    "no-results": "没有匹配的池",
    ready: `${state.rows.length} 个结果`,
    reconnecting: "搜索结果重连中",
  };
  return (
    <section aria-label="池搜索" className="pool-search-area" data-search-state={state.status}>
      <form
        className="pool-search-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submit();
        }}
      >
        <FlowSegment<PoolSearchMode>
          label="搜索模式"
          onChange={setMode}
          options={
            [
              { label: "Token", value: "token" },
              { label: "池", value: "pool" },
            ] as const
          }
          value={mode}
        />
        <label className="pool-search-input">
          <span className="sr-only">{mode === "token" ? "Token 地址" : "池地址或 Pool ID"}</span>
          <Search aria-hidden="true" size={16} />
          <input
            aria-label={mode === "token" ? "Token 地址" : "池地址或 Pool ID"}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === "token" ? "0x Token address" : "0x pool address / pool ID"}
            spellCheck={false}
            value={query}
          />
        </label>
        <button className="pool-search-submit" type="submit">
          <Search aria-hidden="true" size={15} />
          搜索
        </button>
        {active ? (
          <>
            <button aria-label="刷新池搜索" onClick={refresh} title="刷新" type="button">
              <RefreshCw aria-hidden="true" size={15} />
            </button>
            <button aria-label="清除池搜索" onClick={clear} title="清除" type="button">
              <X aria-hidden="true" size={15} />
            </button>
          </>
        ) : null}
      </form>
      {active ? (
        <div
          className="pool-search-status"
          data-state={state.status}
          role={state.status === "error" || state.status === "invalid" ? "alert" : "status"}
        >
          {state.status === "loading" || state.status === "reconnecting" ? (
            <span aria-hidden="true" className="spinner spinner-small" />
          ) : null}
          <span>{statusText[state.status]}</span>
        </div>
      ) : null}
    </section>
  );
}

type PoolFilterUiState = "pristine" | "dirty" | "applied" | "no-results" | "invalid";

const poolNumericFilterLabels: Record<PoolNumericFilterKey, string> = {
  activeTvl: "aTVL",
  feeActiveTvl: "Fee/aTVL",
  fees: "Fees",
  feeTvl: "Fee/TVL",
  tvl: "TVL",
  txs: "Txs",
  volume: "Volume",
};

function PoolAdvancedFilterControls({
  apply,
  draft,
  filterState,
  open,
  reset,
  setOpen,
  update,
}: {
  apply(): void;
  draft: PoolAdvancedFilters;
  filterState: PoolFilterUiState;
  open: boolean;
  reset(): void;
  setOpen(open: boolean): void;
  update(filters: PoolAdvancedFilters): void;
}) {
  const updateRange = (key: PoolNumericFilterKey, value: Partial<PoolAdvancedFilters["ranges"][PoolNumericFilterKey]>) => {
    update({
      ...draft,
      ranges: {
        ...draft.ranges,
        [key]: { ...draft.ranges[key], ...value },
      },
    });
  };
  return (
    <section
      aria-label="高级筛选"
      className="pool-advanced-filter"
      data-filter-state={filterState}
    >
      <div className="pool-advanced-filter-heading">
        <button
          aria-expanded={open}
          aria-label={`${open ? "收起" : "展开"}高级筛选`}
          onClick={() => setOpen(!open)}
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" size={16} />
          <span>高级筛选</span>
        </button>
        <span className="pool-filter-state" data-state={filterState} role="status">
          {{
            applied: "已应用",
            dirty: "待应用",
            invalid: "条件无效",
            "no-results": "无结果",
            pristine: "未筛选",
          }[filterState]}
        </span>
      </div>
      {open ? (
        <div className="pool-advanced-filter-body">
          <fieldset className="pool-filter-generations">
            <legend>版本</legend>
            {(["v3", "v4"] as const).map((generation) => (
              <label key={generation}>
                <input
                  checked={draft.generations.includes(generation)}
                  onChange={(event) => {
                    const selected = new Set(draft.generations);
                    if (event.target.checked) selected.add(generation);
                    else selected.delete(generation);
                    update({
                      ...draft,
                      generations: (["v3", "v4"] as const).filter((value) => selected.has(value)),
                    });
                  }}
                  type="checkbox"
                />
                <span>{generation.toUpperCase()}</span>
              </label>
            ))}
          </fieldset>
          <div className="pool-numeric-filters">
            {poolNumericFilterKeys.map((key) => {
              const range = draft.ranges[key];
              const label = poolNumericFilterLabels[key];
              return (
                <div className="pool-numeric-filter" data-filter-key={key} key={key}>
                  <label className="pool-numeric-filter-toggle">
                    <input
                      aria-label={`启用 ${label} 筛选`}
                      checked={range.enabled}
                      onChange={(event) => updateRange(key, { enabled: event.target.checked })}
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                  <label>
                    <span>最小</span>
                    <input
                      aria-label={`${label} 最小值`}
                      disabled={!range.enabled}
                      inputMode="decimal"
                      onChange={(event) => updateRange(key, { min: event.target.value })}
                      type="text"
                      value={range.min}
                    />
                  </label>
                  <label>
                    <span>最大</span>
                    <input
                      aria-label={`${label} 最大值`}
                      disabled={!range.enabled}
                      inputMode="decimal"
                      onChange={(event) => updateRange(key, { max: event.target.value })}
                      type="text"
                      value={range.max}
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="pool-filter-options">
            <label>
              <span>Hook</span>
              <select
                aria-label="Hook 筛选"
                onChange={(event) =>
                  update({ ...draft, hook: event.target.value as PoolAdvancedFilters["hook"] })
                }
                value={draft.hook}
              >
                <option value="any">全部</option>
                <option value="present">有 Hook</option>
                <option value="absent">无 Hook</option>
              </select>
            </label>
            <label>
              <span>排序指标</span>
              <select
                aria-label="排序指标"
                onChange={(event) =>
                  update({ ...draft, sortBy: event.target.value as PoolNumericFilterKey })
                }
                value={draft.sortBy}
              >
                {poolNumericFilterKeys.map((key) => (
                  <option key={key} value={key}>
                    {poolNumericFilterLabels[key]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>排序方向</span>
              <select
                aria-label="排序方向"
                onChange={(event) =>
                  update({
                    ...draft,
                    sortDirection: event.target.value as PoolAdvancedFilters["sortDirection"],
                  })
                }
                value={draft.sortDirection}
              >
                <option value="desc">降序</option>
                <option value="asc">升序</option>
              </select>
            </label>
            <label className="pool-filter-han">
              <input
                checked={draft.excludeHanTokens}
                onChange={(event) =>
                  update({ ...draft, excludeHanTokens: event.target.checked })
                }
                type="checkbox"
              />
              <span>排除中文 Token</span>
            </label>
          </div>
          {filterState === "invalid" ? (
            <p className="pool-filter-error" role="alert">
              请检查高级筛选条件
            </p>
          ) : null}
          <div className="pool-filter-actions">
            <button onClick={reset} type="button">
              <RotateCcw aria-hidden="true" size={15} />
              重置筛选
            </button>
            <button onClick={apply} type="button">
              应用筛选
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function snapshotAsOfDisplay(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "不可用";
  return `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function PoolComparisonPanel({
  clear,
  state,
  view,
}: {
  clear(): void;
  state: PoolComparisonState;
  view: PoolComparisonView | null;
}) {
  const status = view?.status ?? state.status;
  const pools = view?.pools ?? [];
  return (
    <section
      aria-label="池对比"
      className="pool-comparison"
      data-comparison-state={status}
    >
      <div className="pool-comparison-heading">
        <div>
          <h2>池对比</h2>
          <p role="status">
            {status === "none-selected"
              ? "选择 2 至 3 个池"
              : status === "one-selected"
                ? "再选择 1 个池"
                : `${pools.length} 个池`}
          </p>
        </div>
        {state.selectedPoolKeys.length > 0 ? (
          <button aria-label="清空池对比" onClick={clear} title="清空" type="button">
            <X aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
      {status === "limit-reached" ? <p role="alert">最多对比 3 个池</p> : null}
      {view ? (
        <div className="pool-comparison-binding">
          <span>{view.binding.windowMinutes}m</span>
          <span>快照 {view.binding.snapshotVersion}</span>
          <time dateTime={view.binding.asOf}>{snapshotAsOfDisplay(view.binding.asOf)}</time>
        </div>
      ) : null}
      {view && pools.length >= 2 ? (
        <div className="pool-comparison-table-shell">
          <table aria-label="池对比指标" className="pool-comparison-table">
            <thead>
              <tr>
                <th scope="col">指标</th>
                {pools.map((pool) => (
                  <th key={pool.poolKey} scope="col" title={pool.poolAddress ?? pool.poolId ?? ""}>
                    {pool.token0Symbol ?? "--"} / {pool.token1Symbol ?? "--"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.metrics.map((metric) => (
                <tr key={metric.key}>
                  <th scope="row">{metric.label}</th>
                  {metric.values.map((value) => (
                    <td
                      className={value.isBest ? "pool-comparison-best" : undefined}
                      data-best={value.isBest ? "true" : undefined}
                      key={value.poolKey}
                      title={value.rawValue ?? undefined}
                    >
                      {value.display}
                      {value.isBest ? <span className="sr-only"> 最佳</span> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function PoolColumnDialog({
  columns,
  save,
}: {
  columns: readonly PoolColumnPreference[];
  save(columns: PoolColumnPreference[]): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => normalizePoolColumns(columns));
  const [dragged, setDragged] = useState<PoolColumnKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const locked = (key: PoolColumnKey) => key === "pool" || key === "actions";
  const openChanged = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(normalizePoolColumns(columns));
      setDragged(null);
      setError(false);
    }
  };
  const drop = (event: DragEvent<HTMLLIElement>, target: PoolColumnKey) => {
    event.preventDefault();
    if (dragged) setDraft((current) => reorderPoolColumn(current, dragged, target));
    setDragged(null);
  };
  const submit = async () => {
    setSaving(true);
    setError(false);
    const saved = await save(normalizePoolColumns(draft));
    setSaving(false);
    if (saved) setOpen(false);
    else setError(true);
  };
  return (
    <Dialog.Root onOpenChange={openChanged} open={open}>
      <Dialog.Trigger asChild>
        <button
          aria-label="设置池表列"
          className="pool-column-trigger"
          title="设置列"
          type="button"
        >
          <Settings2 aria-hidden="true" size={16} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="remark-dialog-backdrop" />
        <Dialog.Content aria-describedby="pool-column-description" className="pool-column-dialog">
          <div className="pool-column-dialog-heading">
            <Dialog.Title>表格列</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="关闭列设置" type="button">
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only" id="pool-column-description">
            调整热门池表格列的显示和顺序
          </Dialog.Description>
          <ul className="pool-column-list">
            {draft.map((column, index) => {
              const isLocked = locked(column.key);
              return (
                <li
                  data-column-key={column.key}
                  draggable={!isLocked}
                  key={column.key}
                  onDragEnd={() => setDragged(null)}
                  onDragOver={(event) => !isLocked && event.preventDefault()}
                  onDragStart={(event) => {
                    setDragged(column.key);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", column.key);
                  }}
                  onDrop={(event) => drop(event, column.key)}
                >
                  <GripVertical aria-hidden="true" className="pool-column-grip" size={16} />
                  <label>
                    <input
                      checked={column.visible}
                      disabled={isLocked}
                      onChange={(event) =>
                        setDraft((current) =>
                          setPoolColumnVisibility(current, column.key, event.target.checked),
                        )
                      }
                      type="checkbox"
                    />
                    <span>{poolColumnLabels[column.key]}</span>
                  </label>
                  {isLocked ? <span className="pool-column-lock">锁定</span> : null}
                  <div className="pool-column-move">
                    <button
                      aria-label={`上移 ${poolColumnLabels[column.key]}`}
                      disabled={isLocked || index <= 1}
                      onClick={() => setDraft((current) => movePoolColumn(current, column.key, -1))}
                      title="上移"
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`下移 ${poolColumnLabels[column.key]}`}
                      disabled={isLocked || index >= draft.length - 2}
                      onClick={() => setDraft((current) => movePoolColumn(current, column.key, 1))}
                      title="下移"
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {error ? (
            <p className="pool-column-error" role="alert">
              列设置保存失败
            </p>
          ) : null}
          <div className="pool-column-dialog-actions">
            <button
              onClick={() => setDraft(DEFAULT_POOL_COLUMNS.map((column) => ({ ...column })))}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={15} />
              重置
            </button>
            <Dialog.Close asChild>
              <button disabled={saving} type="button">
                取消
              </button>
            </Dialog.Close>
            <button disabled={saving} onClick={() => void submit()} type="button">
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DexFilter({
  protocols,
  update,
}: {
  protocols: readonly LiquidityFlowProtocol[];
  update(protocols: LiquidityFlowProtocol[]): void;
}) {
  const selected = new Set(protocols);
  return (
    <fieldset className="pool-dex-filter">
      <legend>DEX 过滤</legend>
      <div className="pool-dex-options">
        {liquidityFlowProtocols.map((protocol) => (
          <label key={protocol}>
            <input
              checked={selected.has(protocol)}
              disabled={selected.has(protocol) && selected.size === 1}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(protocol);
                else next.delete(protocol);
                update(canonicalizeLiquidityProtocols([...next]));
              }}
              type="checkbox"
            />
            <span>{protocolName(protocol)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function flowConnectionLabel(connection: FlowConnection): string {
  const labels: Record<FlowConnection, string> = {
    empty: "暂无事件",
    error: "连接失败",
    "loading-backfill": "回填中",
    live: "实时",
    "paused-hidden": "已暂停",
    reconnecting: "重连中",
    stale: "数据陈旧",
  };
  return labels[connection];
}

function FlowSegment<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange(value: T): void;
  options: readonly { label: string; value: T }[];
  value: T;
}) {
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const nextIndex = (index + direction + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll("button");
    (buttons?.item(nextIndex) as HTMLButtonElement | undefined)?.focus();
  };
  return (
    <div aria-label={label} className="flow-segment" role="radiogroup">
      {options.map((option, index) => (
        <button
          aria-checked={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => selectFromKeyboard(event, index)}
          role="radio"
          tabIndex={value === option.value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FlowFilters({
  filters,
  update,
}: {
  filters: LiquidityFlowUiFilters;
  update(filters: LiquidityFlowUiFilters): void;
}) {
  const set = <K extends keyof LiquidityFlowUiFilters>(key: K, value: LiquidityFlowUiFilters[K]) =>
    update({ ...filters, [key]: value });
  return (
    <div className="flow-filter-area">
      <div className="flow-primary-filters">
        <FlowSegment
          label="事件类型"
          onChange={(value) => set("eventType", value)}
          options={
            [
              { label: "全部事件", value: "all" },
              { label: "加池", value: "add" },
              { label: "撤池", value: "remove" },
              { label: "新池", value: "create" },
            ] as const
          }
          value={filters.eventType}
        />
        <FlowSegment
          label="协议版本"
          onChange={(value) => set("generation", value)}
          options={
            [
              { label: "全部版本", value: "all" },
              { label: "V3", value: "v3" },
              { label: "V4", value: "v4" },
            ] as const
          }
          value={filters.generation}
        />
        <label className="flow-minimum-filter">
          <span>最低 USD</span>
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => set("minUsd", event.target.value)}
            type="number"
            value={filters.minUsd}
          />
        </label>
      </div>
      <div className="flow-address-filters">
        {(
          [
            ["token", "Token"],
            ["pool", "Pool"],
            ["user", "User"],
            ["nftId", "NFT"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              inputMode={key === "nftId" ? "numeric" : "text"}
              onChange={(event) => set(key, event.target.value)}
              spellCheck={false}
              type={key === "nftId" ? "number" : "search"}
              value={filters[key]}
            />
          </label>
        ))}
        <button
          aria-label="清除流动性筛选"
          className="flow-clear-button"
          onClick={() => update({ ...defaultLiquidityFlowUiFilters })}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} />
          清除
        </button>
      </div>
    </div>
  );
}

function flowTypeLabel(type: LiquidityFlowEvent["event_type"]): string {
  return { add: "加池", create: "新池", remove: "撤池" }[type];
}

function FlowStats({ summary }: { summary: LiquidityFlowSummary }) {
  const partial = summary.completeness === "partial";
  const valuationCount = summary.valuedEventCount + summary.unvaluedEventCount;
  const money = (value: string) => `${partial ? "已估值 " : ""}${decimalDisplay(value, "$ ")}`;
  return (
    <div
      aria-label="流动性统计"
      className="flow-stat-strip"
      data-completeness={summary.completeness}
      role="group"
    >
      <dl data-metric="inflow">
        <dt>流入</dt>
        <dd title={summary.inflowUsd}>{money(summary.inflowUsd)}</dd>
      </dl>
      <dl data-metric="outflow">
        <dt>流出</dt>
        <dd title={summary.outflowUsd}>{money(summary.outflowUsd)}</dd>
      </dl>
      <dl data-metric="net">
        <dt>净额</dt>
        <dd title={summary.netUsd}>{money(summary.netUsd)}</dd>
      </dl>
      <dl data-metric="events">
        <dt>笔数</dt>
        <dd>{summary.eventCount}</dd>
      </dl>
      <dl data-metric="addresses">
        <dt>地址数</dt>
        <dd>{summary.uniqueAddressCount}</dd>
      </dl>
      <dl data-metric="completeness">
        <dt>估值完整性</dt>
        <dd>
          {partial
            ? `${summary.valuedEventCount} / ${valuationCount} 已估值 · ${summary.unvaluedEventCount} 未估值`
            : `完整 · ${summary.valuedEventCount} / ${valuationCount}`}
        </dd>
      </dl>
    </div>
  );
}

function FlowTable({
  events,
  remarkState,
  watched,
}: {
  events: readonly LiquidityFlowEvent[];
  remarkState: AddressRemarksState;
  watched: ReadonlySet<string>;
}) {
  return (
    <div aria-label="可横向滚动的流动性事件列表" className="flow-table-shell" tabIndex={0}>
      <table aria-label="流动性事件列表" className="flow-table">
        <thead>
          <tr>
            {["时间", "协议", "事件", "Pool", "User", "NFT", "USD", "Transaction"].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td data-label="时间">
                <time dateTime={new Date(event.ts).toISOString()}>
                  {new Date(event.ts).toISOString().slice(11, 19)}
                </time>
              </td>
              <td data-label="协议">{protocolName(event.dex)}</td>
              <td data-label="事件">
                <span className={`flow-type flow-type-${event.event_type}`}>
                  {flowTypeLabel(event.event_type)}
                </span>
              </td>
              <td data-label="Pool" title={event.pool_address ?? event.pool_id ?? undefined}>
                {shortIdentity(event.pool_address ?? event.pool_id)}
              </td>
              <td data-label="User" title={event.user ?? undefined}>
                {event.user
                  ? addressRemarkLabel(remarkState, event.user) || shortIdentity(event.user)
                  : "--"}
                {event.user && watched.has(event.user.toLowerCase()) ? (
                  <Star
                    aria-label="已关注"
                    className="flow-user-watch"
                    fill="currentColor"
                    size={11}
                  />
                ) : null}
              </td>
              <td data-label="NFT">{event.nft_id ? `#${event.nft_id}` : "--"}</td>
              <td data-label="USD" title={event.usd_value ?? undefined}>
                {decimalDisplay(event.usd_value, "$ ")}
              </td>
              <td data-label="Transaction" title={event.tx_hash}>
                {shortIdentity(event.tx_hash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function addressNetDisplay(row: LiquidityFlowAddressAggregate): string {
  if (row.idle) return "--";
  const value = new Decimal(row.netUsd);
  const sign = value.isNegative() ? "-" : "+";
  const amount = decimalDisplay(value.abs().toFixed(), "$ ");
  return `${row.completeness === "partial" ? "已估值 " : ""}${sign}${amount}`;
}

function AddressTable({
  editing,
  filter,
  remarks,
  rows,
  toggleWatch,
  watched,
}: {
  editing(address: EvmAddress): void;
  filter(address: EvmAddress): void;
  remarks: AddressRemarksState;
  rows: readonly LiquidityFlowAddressAggregate[];
  toggleWatch(address: EvmAddress): void;
  watched: ReadonlySet<string>;
}) {
  return (
    <div aria-label="可横向滚动的地址聚合表" className="flow-address-table-shell" tabIndex={0}>
      <table aria-label="地址聚合" className="flow-address-table">
        <thead>
          <tr>
            {["地址", "备注", "净额", "笔数", "池数", "最近", "状态", "操作"].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const personal = remarks.remarks.get(row.address);
            const shared = remarks.shared.get(row.address);
            const label = personal?.label || shared?.label || "--";
            const isWatched = watched.has(row.address);
            const pending = remarks.pending.has(row.address);
            return (
              <tr key={row.address}>
                <td data-label="地址" title={row.address}>
                  <span className="flow-address-identity">{shortIdentity(row.address)}</span>
                  {isWatched ? <Star aria-label="已关注" fill="currentColor" size={12} /> : null}
                </td>
                <td data-label="备注" title={label === "--" ? undefined : label}>
                  <span>{label}</span>
                  {!personal?.label && shared ? (
                    <small aria-label={`${shared.votes} 票`}>{shared.votes} 票</small>
                  ) : null}
                </td>
                <td data-label="净额" title={row.idle ? undefined : row.netUsd}>
                  {addressNetDisplay(row)}
                </td>
                <td data-label="笔数">{row.eventCount}</td>
                <td data-label="池数">{row.poolCount}</td>
                <td data-label="最近">
                  {row.recentTs === null ? (
                    "--"
                  ) : (
                    <time dateTime={new Date(row.recentTs).toISOString()}>
                      {new Date(row.recentTs).toISOString().slice(11, 19)}
                    </time>
                  )}
                </td>
                <td data-label="状态">
                  {row.idle ? (
                    <span className="flow-valuation-state" data-state="idle">
                      idle
                    </span>
                  ) : row.completeness === "partial" ? (
                    <span className="flow-valuation-state" data-state="partial">
                      partial
                    </span>
                  ) : (
                    <span className="flow-valuation-state" data-state="complete">
                      完整
                    </span>
                  )}
                </td>
                <td data-label="操作">
                  <div className="flow-address-actions">
                    <button
                      aria-label={`筛选 ${row.address}`}
                      onClick={() => filter(row.address)}
                      title="筛选地址"
                      type="button"
                    >
                      <Filter aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`复制 ${row.address}`}
                      onClick={() => void navigator.clipboard.writeText(row.address)}
                      title="复制地址"
                      type="button"
                    >
                      <Copy aria-hidden="true" size={14} />
                    </button>
                    <a
                      aria-label={`在 BscScan 查看 ${row.address}`}
                      href={`https://bscscan.com/address/${row.address}`}
                      rel="noopener noreferrer"
                      target="_blank"
                      title="在 BscScan 查看"
                    >
                      <ExternalLink aria-hidden="true" size={14} />
                    </a>
                    <button
                      aria-label={`编辑备注 ${row.address}`}
                      onClick={() => editing(row.address)}
                      title="编辑备注"
                      type="button"
                    >
                      <Tag aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`${isWatched ? "取消关注" : "关注"} ${row.address}`}
                      disabled={pending}
                      onClick={() => toggleWatch(row.address)}
                      title={isWatched ? "取消关注" : "关注"}
                      type="button"
                    >
                      <Star
                        aria-hidden="true"
                        fill={isWatched ? "currentColor" : "none"}
                        size={14}
                      />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface AddressRemarkDialogProps {
  address: EvmAddress | null;
  close(): void;
  remove(address: EvmAddress): Promise<boolean>;
  remarks: AddressRemarksState;
  save(request: { address: EvmAddress; label: string; watched: boolean }): Promise<boolean>;
}

function AddressRemarkDialog(props: AddressRemarkDialogProps) {
  if (!props.address) return null;
  return <AddressRemarkDialogContent {...props} address={props.address} key={props.address} />;
}

function AddressRemarkDialogContent({
  address,
  close,
  remove,
  remarks,
  save,
}: Omit<AddressRemarkDialogProps, "address"> & { address: EvmAddress }) {
  const personal = remarks.remarks.get(address);
  const shared = remarks.shared.get(address);
  const [label, setLabel] = useState(() => remarks.drafts.get(address) ?? personal?.label ?? "");
  const [watched, setWatched] = useState(personal?.watched ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const saved = await save({ address, label: label.trim(), watched });
    setSaving(false);
    if (saved) close();
    else setError("备注保存失败，请重试");
  };

  const deleteRemark = async () => {
    setSaving(true);
    setError(null);
    const deleted = await remove(address);
    setSaving(false);
    if (deleted) close();
    else setError("备注删除失败，请重试");
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && close()} open>
      <Dialog.Portal>
        <Dialog.Overlay className="remark-dialog-backdrop" />
        <Dialog.Content aria-describedby="address-remark-description" className="remark-dialog">
          <div className="remark-dialog-heading">
            <Dialog.Title>地址备注</Dialog.Title>
            <Dialog.Close asChild>
              <button aria-label="关闭地址备注" type="button">
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description id="address-remark-description">
            个人备注优先显示；未设置个人备注时使用共享票数最高的标签。
          </Dialog.Description>
          <code>{address}</code>
          <label>
            <span>备注标签</span>
            <input
              autoFocus
              onChange={(event) => setLabel([...event.target.value].slice(0, 32).join(""))}
              spellCheck={false}
              value={label}
            />
          </label>
          {shared ? (
            <p className="remark-shared-label">
              共享默认：<span>{shared.label}</span> · {shared.votes} 票
            </p>
          ) : null}
          <label className="remark-watch-toggle">
            <input
              checked={watched}
              onChange={(event) => setWatched(event.target.checked)}
              type="checkbox"
            />
            <Star aria-hidden="true" fill={watched ? "currentColor" : "none"} size={15} />
            <span>加入关注</span>
          </label>
          {error ? (
            <p className="remark-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="remark-dialog-actions">
            {personal ? (
              <button disabled={saving} onClick={() => void deleteRemark()} type="button">
                <Trash2 aria-hidden="true" size={15} />
                删除
              </button>
            ) : null}
            <Dialog.Close asChild>
              <button className="remark-dialog-cancel" disabled={saving} type="button">
                取消
              </button>
            </Dialog.Close>
            <button
              className="remark-dialog-save"
              disabled={saving}
              onClick={() => void submit()}
              type="button"
            >
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function serverFilters(filters: LiquidityFlowUiFilters): LiquidityFlowServerFilters {
  const address = (value: string) => (/^0x[0-9a-fA-F]{40}$/u.test(value) ? value : "");
  const pool = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/u.test(filters.pool) ? filters.pool : "";
  return {
    nftId: /^(?:0|[1-9][0-9]*)$/u.test(filters.nftId) ? filters.nftId : "",
    pool,
    token: address(filters.token),
    user: address(filters.user),
  };
}

export function PoolsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const parsedAdvancedFilters = useMemo(
    () => parsePoolAdvancedFilters(location.search),
    [location.search],
  );
  const { preferences, update: updatePreferences } = useUserPreferences();
  const fixture = fixtureState(location.search);
  const poolClient = useMemo(() => new PoolsClient(), []);
  const flowClient = useMemo(() => new LiquidityFlowClient(), []);
  const remarkClient = useMemo(() => new AddressRemarksClient(), []);
  const [minutes, setMinutes] = useState<MarketWindowMinutes>(5);
  const [protocols, setProtocols] = useState<LiquidityFlowProtocol[]>(() =>
    protocolsFromSearch(location.search),
  );
  const [retry, setRetry] = useState(0);
  const [state, dispatch] = useReducer(reducePoolStream, undefined, initialPoolStreamState);
  const [poolSearchState, poolSearchDispatch] = useReducer(
    reducePoolSearch,
    undefined,
    initialPoolSearchState,
  );
  const initialSearch = parsePoolSearchParameters(location.search);
  const [poolSearchMode, setPoolSearchMode] = useState<PoolSearchMode>(
    initialSearch?.mode ?? "token",
  );
  const [poolSearchQuery, setPoolSearchQuery] = useState(initialSearch?.query ?? "");
  const [poolSearchLocation, setPoolSearchLocation] = useState(location.search);
  const [poolSearchRefresh, setPoolSearchRefresh] = useState(0);
  const poolSearchManager = useRef(new PoolSearchRequestManager());
  const [expandedPoolGroups, setExpandedPoolGroups] = useState<Set<string>>(() => new Set());
  const [advancedFilterDraft, setAdvancedFilterDraft] = useState<PoolAdvancedFilters>(() =>
    structuredClone(parsedAdvancedFilters.filters),
  );
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(
    !parsedAdvancedFilters.valid || !poolAdvancedFiltersAreDefault(parsedAdvancedFilters.filters),
  );
  const [advancedFilterValidationFailed, setAdvancedFilterValidationFailed] = useState(
    !parsedAdvancedFilters.valid,
  );
  const [comparisonState, setComparisonState] = useState<PoolComparisonState>(
    initialPoolComparisonState,
  );
  const latestEventAt = useRef<number | null>(null);
  const [flowState, flowDispatch] = useReducer(reduceLiquidityFlow, 0, initialLiquidityFlowState);
  const flowStateRef = useRef(flowState);
  const latestFlowAt = useRef<number | null>(null);
  const [flowRetry, setFlowRetry] = useState(0);
  const [fixturePaused, setFixturePaused] = useState(false);
  const [flowFilters, setFlowFilters] = useState<LiquidityFlowUiFilters>(() =>
    parseLiquidityFlowUiFilters(location.search),
  );
  const [flowView, setFlowView] = useState<"address" | "stream">("stream");
  const [addressSort, setAddressSort] = useState<LiquidityFlowAddressSort>("net");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [remarkState, remarkDispatch] = useReducer(
    reduceAddressRemarks,
    undefined,
    initialAddressRemarksState,
  );
  const [editingAddress, setEditingAddress] = useState<EvmAddress | null>(null);
  const remarkOperation = useRef(0);

  useEffect(() => {
    setAdvancedFilterDraft(structuredClone(parsedAdvancedFilters.filters));
    setAdvancedFilterValidationFailed(!parsedAdvancedFilters.valid);
    if (
      !parsedAdvancedFilters.valid ||
      !poolAdvancedFiltersAreDefault(parsedAdvancedFilters.filters)
    ) {
      setAdvancedFilterOpen(true);
    }
  }, [parsedAdvancedFilters]);

  if (poolSearchLocation !== location.search) {
    const next = parsePoolSearchParameters(location.search);
    setPoolSearchLocation(location.search);
    setPoolSearchMode(next?.mode ?? poolSearchMode);
    setPoolSearchQuery(next?.query ?? "");
  }

  const loadRemarks = useCallback(async () => {
    remarkDispatch({ type: "loading" });
    try {
      const response = await remarkClient.get();
      remarkDispatch({ response, type: "loaded" });
    } catch (error) {
      remarkDispatch({
        code: error instanceof AddressRemarksRequestError ? error.code : "ADDRESS_REMARKS_FAILED",
        type: "load-failed",
      });
    }
  }, [remarkClient]);

  useEffect(() => {
    const controller = new AbortController();
    remarkDispatch({ type: "loading" });
    void remarkClient.get(controller.signal).then(
      (response) => remarkDispatch({ response, type: "loaded" }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        remarkDispatch({
          code: error instanceof AddressRemarksRequestError ? error.code : "ADDRESS_REMARKS_FAILED",
          type: "load-failed",
        });
      },
    );
    return () => controller.abort();
  }, [remarkClient]);

  useEffect(() => {
    flowStateRef.current = flowState;
  }, [flowState]);

  const updateSearch = (
    nextProtocols: readonly LiquidityFlowProtocol[],
    next: LiquidityFlowUiFilters,
  ) => {
    const parameters = new URLSearchParams(location.search);
    for (const key of [
      "dex",
      "flow_event",
      "flow_version",
      "min_usd",
      "pool",
      "token",
      "user",
      "nft_id",
    ]) {
      parameters.delete(key);
    }
    if (nextProtocols.length !== liquidityFlowProtocols.length) {
      parameters.set("dex", nextProtocols.join(","));
    }
    for (const [key, value] of serializeLiquidityFlowUiFilters(next)) parameters.set(key, value);
    void navigate(
      { pathname: location.pathname, search: `?${parameters.toString()}` },
      { replace: true },
    );
  };

  const updateProtocols = (next: LiquidityFlowProtocol[]) => {
    setProtocols(next);
    updateSearch(next, flowFilters);
  };

  const updateFlowFilters = (next: LiquidityFlowUiFilters) => {
    setFlowFilters(next);
    updateSearch(protocols, next);
  };

  useEffect(() => {
    if (fixture) return;
    const controller = new AbortController();
    latestEventAt.current = Date.now();
    dispatch({ type: "loading" });
    let subscription: ReturnType<PoolsClient["subscribe"]> | null = null;
    void poolClient
      .getSnapshot(minutes, controller.signal, protocols)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        dispatch({ snapshot, type: "http-snapshot" });
        subscription = poolClient.subscribe(
          minutes,
          {
            onError: () => dispatch({ type: "reconnecting" }),
            onEvent: (event) => {
              latestEventAt.current = Date.now();
              dispatch({ event, type: "event" });
            },
            onOpen: () => {
              latestEventAt.current = Date.now();
            },
          },
          protocols,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          code: error instanceof Error ? error.message : "MARKET_REQUEST_FAILED",
          type: "error",
        });
      });
    const staleTimer = window.setInterval(() => {
      if (latestEventAt.current !== null && Date.now() - latestEventAt.current > 25_000) {
        dispatch({ type: "stale" });
      }
    }, 1_000);
    return () => {
      controller.abort();
      subscription?.close();
      window.clearInterval(staleTimer);
    };
  }, [fixture, minutes, poolClient, protocols, retry]);

  const remoteFilters = useMemo(() => serverFilters(flowFilters), [flowFilters]);
  useEffect(() => {
    if (fixture) return;
    const initialSince = Date.now() - 30 * 60_000;
    flowStateRef.current = initialLiquidityFlowState(initialSince);
    latestFlowAt.current = Date.now();
    flowDispatch({ since: initialSince, type: "loading" });
    const subscription = flowClient.subscribe(remoteFilters, {
      getSince: () => flowStateRef.current.since,
      onBackfill: (backfill) => {
        latestFlowAt.current = Date.now();
        flowDispatch({ records: backfill.events, type: "backfill" });
      },
      onError: (code) => flowDispatch({ code, type: "error" }),
      onEvent: (record) => {
        latestFlowAt.current = Date.now();
        flowDispatch({ record, type: "event" });
      },
      onHeartbeat: () => {
        latestFlowAt.current = Date.now();
        flowDispatch({ type: "heartbeat" });
      },
      onOpen: () => {
        latestFlowAt.current = Date.now();
      },
      onReconnecting: () => flowDispatch({ type: "reconnecting" }),
    });
    const staleTimer = window.setInterval(() => {
      if (latestFlowAt.current !== null && Date.now() - latestFlowAt.current > 25_000) {
        flowDispatch({ type: "stale" });
      }
    }, 1_000);
    return () => {
      subscription.close();
      window.clearInterval(staleTimer);
    };
  }, [fixture, flowClient, flowRetry, remoteFilters]);

  useEffect(() => {
    if (fixture) return;
    const onVisibility = () => flowDispatch({ type: document.hidden ? "pause" : "resume" });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fixture]);

  const connection = fixture ?? state.connection;
  const selectedProtocols = useMemo(() => new Set(protocols), [protocols]);
  const poolRows = useMemo(
    () =>
      (fixture
        ? fixture === "ready" || fixture === "stale" || fixture === "reconnecting"
          ? fixturePoolRows
          : []
        : state.rows
      ).filter(({ protocol }) => selectedProtocols.has(protocol)),
    [fixture, selectedProtocols, state.rows],
  );
  const poolSearchParameters = useMemo(
    () => parsePoolSearchParameters(location.search),
    [location.search],
  );
  const poolModeRows = poolSearchParameters?.mode === "pool" ? poolRows : null;
  const poolModeConnection = poolSearchParameters?.mode === "pool" ? connection : null;

  useEffect(() => {
    const parameters = poolSearchParameters;
    const manager = poolSearchManager.current;
    if (!parameters) {
      manager.clear();
      poolSearchDispatch({ type: "clear" });
      return;
    }
    const request = manager.start();
    poolSearchDispatch({
      mode: parameters.mode,
      query: parameters.query,
      requestId: request.requestId,
      type: "start",
    });
    if (!parameters.valid) {
      poolSearchDispatch({ requestId: request.requestId, type: "invalid" });
      return () => manager.clear();
    }
    if (parameters.mode === "pool") {
      if (poolModeConnection === "reconnecting" || poolModeConnection === "stale") {
        poolSearchDispatch({ type: "reconnecting" });
      } else if (poolModeConnection === "error") {
        poolSearchDispatch({
          code: "MARKET_SEARCH_UNAVAILABLE",
          requestId: request.requestId,
          type: "error",
        });
      } else if (poolModeConnection !== "loading") {
        poolSearchDispatch({
          requestId: request.requestId,
          rows: filterPoolsByIdentity(poolModeRows ?? [], parameters.query),
          type: "success",
        });
      }
      return () => manager.clear();
    }
    const address = validTokenSearchAddress(parameters.query)!;
    void poolClient.getByToken(address, request.signal, protocols).then(
      (rows) => {
        if (!manager.isCurrent(request.requestId)) return;
        poolSearchDispatch({ requestId: request.requestId, rows, type: "success" });
      },
      (error: unknown) => {
        if (request.signal.aborted || !manager.isCurrent(request.requestId)) return;
        poolSearchDispatch({
          code: error instanceof Error ? error.message : "MARKET_TOKEN_REQUEST_FAILED",
          requestId: request.requestId,
          type: "error",
        });
      },
    );
    return () => manager.clear();
  }, [
    poolClient,
    poolModeConnection,
    poolModeRows,
    poolSearchParameters,
    poolSearchRefresh,
    protocols,
  ]);

  const activePoolRows = poolSearchParameters ? poolSearchState.rows : poolRows;
  const appliedAdvancedFilters = parsedAdvancedFilters.valid
    ? parsedAdvancedFilters.filters
    : defaultPoolAdvancedFilters();
  const filteredPoolRows = useMemo(
    () => filterAndSortPoolRows(activePoolRows, appliedAdvancedFilters),
    [activePoolRows, appliedAdvancedFilters],
  );
  const advancedFilterDirty =
    JSON.stringify(advancedFilterDraft) !== JSON.stringify(appliedAdvancedFilters);
  const advancedFilterActive = !poolAdvancedFiltersAreDefault(appliedAdvancedFilters);
  const advancedFilterState: PoolFilterUiState =
    advancedFilterValidationFailed || !parsedAdvancedFilters.valid
      ? "invalid"
      : advancedFilterDirty
        ? "dirty"
        : advancedFilterActive && filteredPoolRows.length === 0 && activePoolRows.length > 0
          ? "no-results"
          : advancedFilterActive
            ? "applied"
            : "pristine";
  const searchedToken =
    poolSearchParameters?.mode === "token" && poolSearchParameters.valid
      ? validTokenSearchAddress(poolSearchParameters.query)
      : null;
  const poolGroups = useMemo(
    () =>
      groupPoolRows(
        filteredPoolRows,
        searchedToken ? { tokenAddress: searchedToken, type: "token-search" } : { type: "default" },
      ),
    [filteredPoolRows, searchedToken],
  );
  const expandablePoolGroupSignature = poolGroups
    .filter(({ members }) => members.length > 1)
    .map(({ groupKey }) => groupKey)
    .join("\u0000");
  const [poolGroupSignature, setPoolGroupSignature] = useState(expandablePoolGroupSignature);
  if (poolGroupSignature !== expandablePoolGroupSignature) {
    setPoolGroupSignature(expandablePoolGroupSignature);
    setExpandedPoolGroups((current) => {
      const next = reconcileExpandedPoolGroups(current, poolGroups);
      if (next.size === current.size && [...next].every((key) => current.has(key))) return current;
      return next;
    });
  }
  const visiblePoolRows = useMemo(
    () => flattenPoolGroups(poolGroups, expandedPoolGroups),
    [expandedPoolGroups, poolGroups],
  );
  const poolColumns = useMemo(
    () => normalizePoolColumns(preferences.poolColumns),
    [preferences.poolColumns],
  );
  const savePoolColumns = useCallback(
    (columns: PoolColumnPreference[]) => updatePreferences({ poolColumns: columns }),
    [updatePreferences],
  );
  const comparisonSnapshot = useMemo<MarketPoolSnapshot | null>(() => {
    if (fixture) return fixturePoolSnapshot(minutes, poolRows);
    return state.snapshot ? { ...state.snapshot, rows: poolRows } : null;
  }, [fixture, minutes, poolRows, state.snapshot]);
  useEffect(() => {
    if (!comparisonSnapshot) return;
    setComparisonState((current) => reconcilePoolComparison(current, comparisonSnapshot));
  }, [comparisonSnapshot]);
  const comparisonView = useMemo(
    () =>
      comparisonSnapshot ? buildPoolComparison(comparisonState, comparisonSnapshot) : null,
    [comparisonSnapshot, comparisonState],
  );
  const comparisonSelectedKeys = useMemo(
    () => new Set(comparisonState.selectedPoolKeys),
    [comparisonState.selectedPoolKeys],
  );
  const snapshotPoolKeys = useMemo(
    () => new Set(comparisonSnapshot?.rows.map(({ poolKey }) => poolKey) ?? []),
    [comparisonSnapshot],
  );
  const comparisonCandidateKeys = useMemo(
    () =>
      new Set(
        filteredPoolRows
          .filter(({ poolKey }) => snapshotPoolKeys.has(poolKey))
          .map(({ poolKey }) => poolKey),
      ),
    [filteredPoolRows, snapshotPoolKeys],
  );
  const explicitFlowConnection = fixtureFlowState(location.search, fixture);
  const flowConnection = fixturePaused
    ? "paused-hidden"
    : (explicitFlowConnection ?? flowState.connection);
  const baseFlowEvents = useMemo(
    () =>
      fixture
        ? flowConnection === "loading-backfill" ||
          flowConnection === "empty" ||
          flowConnection === "error"
          ? []
          : fixtureFlowEvents
        : flowState.events,
    [fixture, flowConnection, flowState.events],
  );
  const watched = useMemo(() => watchedAddressSet(remarkState), [remarkState]);
  const flowProjection = useMemo(
    () =>
      buildLiquidityFlowProjection(baseFlowEvents, flowFilters, {
        protocols,
        sort: addressSort,
        watchedAddresses: [...watched],
        watchedOnly,
      }),
    [addressSort, baseFlowEvents, flowFilters, protocols, watched, watchedOnly],
  );

  const saveRemark = useCallback(
    async (request: { address: EvmAddress; label: string; watched: boolean }) => {
      const operationId = ++remarkOperation.current;
      remarkDispatch({ operationId, request, type: "put-optimistic" });
      try {
        const remark = await remarkClient.put(request);
        remarkDispatch({
          address: request.address,
          operationId,
          remark,
          type: "mutation-succeeded",
        });
        void loadRemarks();
        return true;
      } catch (error) {
        remarkDispatch({
          address: request.address,
          code:
            error instanceof AddressRemarksRequestError ? error.code : "ADDRESS_REMARK_SAVE_FAILED",
          operationId,
          type: "mutation-failed",
        });
        return false;
      }
    },
    [loadRemarks, remarkClient],
  );

  const removeRemark = useCallback(
    async (address: EvmAddress) => {
      const operationId = ++remarkOperation.current;
      remarkDispatch({ address, operationId, type: "delete-optimistic" });
      try {
        await remarkClient.delete(address);
        remarkDispatch({ address, operationId, remark: null, type: "mutation-succeeded" });
        void loadRemarks();
        return true;
      } catch (error) {
        remarkDispatch({
          address,
          code:
            error instanceof AddressRemarksRequestError
              ? error.code
              : "ADDRESS_REMARK_DELETE_FAILED",
          operationId,
          type: "mutation-failed",
        });
        return false;
      }
    },
    [loadRemarks, remarkClient],
  );

  const toggleWatched = useCallback(
    (address: EvmAddress) => {
      const personal = remarkState.remarks.get(address);
      void saveRemark({
        address,
        label: personal?.label ?? "",
        watched: !personal?.watched,
      });
    },
    [remarkState.remarks, saveRemark],
  );

  const selectWindow = (next: MarketWindowMinutes) => {
    setMinutes(next);
    document.getElementById(`pool-window-${next}`)?.focus();
  };
  const onWindowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = windows[(index + offset + windows.length) % windows.length]!;
    selectWindow(next);
  };

  const toggleFlowPause = () => {
    const paused = flowConnection === "paused-hidden";
    if (fixture) setFixturePaused(!paused);
    else flowDispatch({ type: paused ? "resume" : "pause" });
    window.requestAnimationFrame(() => {
      document.getElementById(paused ? "flow-pause" : "flow-resume")?.focus();
    });
  };

  const filterAddress = (address: EvmAddress) => {
    updateFlowFilters({ ...flowFilters, user: address });
    setFlowView("stream");
  };

  const submitPoolSearch = () => {
    const query = poolSearchQuery.trim();
    const search = writePoolSearchParameters(location.search, { mode: poolSearchMode, query });
    if (search === location.search) setPoolSearchRefresh((value) => value + 1);
    else void navigate({ pathname: location.pathname, search }, { replace: true });
  };

  const clearPoolSearch = () => {
    poolSearchManager.current.clear();
    poolSearchDispatch({ type: "clear" });
    setPoolSearchQuery("");
    const search = writePoolSearchParameters(location.search, null);
    void navigate({ pathname: location.pathname, search }, { replace: true });
  };

  const applyAdvancedFilters = () => {
    if (!validatePoolAdvancedFilters(advancedFilterDraft)) {
      setAdvancedFilterValidationFailed(true);
      return;
    }
    setAdvancedFilterValidationFailed(false);
    const search = writePoolAdvancedFilters(location.search, advancedFilterDraft);
    void navigate({ pathname: location.pathname, search }, { replace: true });
  };

  const resetAdvancedFilters = () => {
    setAdvancedFilterDraft(defaultPoolAdvancedFilters());
    setAdvancedFilterValidationFailed(false);
    const search = writePoolAdvancedFilters(location.search, null);
    void navigate({ pathname: location.pathname, search }, { replace: true });
  };

  const toggleComparison = useCallback(
    (poolKey: string) => {
      if (!comparisonSnapshot) return;
      setComparisonState((current) =>
        togglePoolComparison(current, poolKey, comparisonSnapshot),
      );
    },
    [comparisonSnapshot],
  );

  const togglePoolGroup = useCallback((groupKey: string) => {
    setExpandedPoolGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  return (
    <main
      aria-busy={connection === "loading" ? "true" : undefined}
      className="workspace pools-workspace"
      data-pools-state={connection}
    >
      <div className="pools-heading">
        <div>
          <p className="eyebrow">BSC · 四协议实时读模型</p>
          <h1>
            <span>热门池</span>
            <span className="sr-only">池子发现 Pools</span>
          </h1>
        </div>
        <ConnectionStatus connection={connection} />
      </div>

      <div className="pool-controls">
        <div aria-label="时间窗" className="pool-window-control" role="radiogroup">
          {windows.map((value, index) => (
            <button
              aria-checked={minutes === value}
              aria-label={`${value} 分钟`}
              className="pool-window-option"
              id={`pool-window-${value}`}
              key={value}
              onClick={() => selectWindow(value)}
              onKeyDown={(event) => onWindowKeyDown(event, index)}
              role="radio"
              tabIndex={minutes === value ? 0 : -1}
              type="button"
            >
              {value}m
            </button>
          ))}
        </div>
        <DexFilter protocols={protocols} update={updateProtocols} />
      </div>

      <PoolSearchControls
        clear={clearPoolSearch}
        mode={poolSearchMode}
        query={poolSearchQuery}
        refresh={() => setPoolSearchRefresh((value) => value + 1)}
        setMode={setPoolSearchMode}
        setQuery={setPoolSearchQuery}
        state={poolSearchState}
        submit={submitPoolSearch}
      />

      {!poolSearchParameters && connection === "loading" ? (
        <div className="pools-loading" role="status">
          <span className="spinner spinner-small" aria-hidden="true" />
          <span>正在加载市场数据</span>
        </div>
      ) : null}
      {!poolSearchParameters && connection === "error" ? (
        <div className="pools-error">
          <AlertTriangle aria-hidden="true" size={20} />
          <p role="alert">市场数据暂不可用</p>
          <button
            className="retry-button"
            onClick={() => setRetry((value) => value + 1)}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            重试
          </button>
        </div>
      ) : null}
      {!poolSearchParameters &&
      (connection === "empty" || (connection !== "loading" && poolRows.length === 0)) ? (
        <div className="pools-empty" role="status">
          <p>当前过滤条件暂无池数据</p>
        </div>
      ) : null}
      <div className="pool-table-toolbar">
        <span>{poolGroups.length} 组</span>
        <PoolColumnDialog columns={poolColumns} save={savePoolColumns} />
      </div>
      {visiblePoolRows.length > 0 ? (
        <PoolTable columns={poolColumns} rows={visiblePoolRows} toggleGroup={togglePoolGroup} />
      ) : null}

      <section
        aria-busy={flowConnection === "loading-backfill" ? "true" : undefined}
        aria-label="流动性事件"
        className="liquidity-flow-panel"
        data-flow-state={flowConnection}
      >
        <div className="flow-heading">
          <div>
            <h2>流动性事件</h2>
            <p>BSC · create / add / remove</p>
          </div>
          <div className="flow-heading-actions">
            <span className="flow-status" data-state={flowConnection} role="status">
              {flowConnectionLabel(flowConnection)}
            </span>
            <button
              aria-label={flowConnection === "paused-hidden" ? "恢复流动性事件" : "暂停流动性事件"}
              className="flow-pause-button"
              id={flowConnection === "paused-hidden" ? "flow-resume" : "flow-pause"}
              onClick={toggleFlowPause}
              title={flowConnection === "paused-hidden" ? "恢复" : "暂停"}
              type="button"
            >
              {flowConnection === "paused-hidden" ? (
                <Play aria-hidden="true" size={16} />
              ) : (
                <Pause aria-hidden="true" size={16} />
              )}
            </button>
          </div>
        </div>

        <FlowFilters filters={flowFilters} update={updateFlowFilters} />

        {baseFlowEvents.length > 0 ? <FlowStats summary={flowProjection.summary} /> : null}

        <div className="flow-view-toolbar">
          <FlowSegment<"address" | "stream">
            label="流动性视图"
            onChange={setFlowView}
            options={
              [
                { label: "实时", value: "stream" },
                { label: "地址", value: "address" },
              ] as const
            }
            value={flowView}
          />
          <button
            aria-pressed={watchedOnly}
            className="flow-watched-filter"
            onClick={() => setWatchedOnly((value) => !value)}
            type="button"
          >
            <Star aria-hidden="true" fill={watchedOnly ? "currentColor" : "none"} size={14} />
            只看关注地址
          </button>
        </div>

        {flowConnection === "loading-backfill" ? (
          <div className="flow-operational-state" role="status">
            <span className="spinner spinner-small" aria-hidden="true" />
            正在回填历史事件
          </div>
        ) : null}
        {flowConnection === "error" ? (
          <div className="flow-operational-state flow-operational-error">
            <AlertTriangle aria-hidden="true" size={18} />
            <p role="alert">流动性事件暂不可用</p>
            {!fixture ? (
              <button onClick={() => setFlowRetry((value) => value + 1)} type="button">
                <RefreshCw aria-hidden="true" size={15} />
                重试
              </button>
            ) : null}
          </div>
        ) : null}
        {flowConnection !== "loading-backfill" && flowConnection !== "error" ? (
          <div className="flow-views" data-view={flowView}>
            <div className="flow-view-pane flow-stream-view" data-active={flowView === "stream"}>
              <div className="flow-view-heading">
                <strong>实时事件</strong>
                <span>{flowProjection.events.length} 笔</span>
              </div>
              {flowProjection.events.length === 0 ? (
                <div className="flow-operational-state" role="status">
                  当前过滤条件暂无流动性事件
                </div>
              ) : (
                <FlowTable
                  events={flowProjection.events}
                  remarkState={remarkState}
                  watched={watched}
                />
              )}
            </div>
            <div className="flow-view-pane flow-address-view" data-active={flowView === "address"}>
              <div className="flow-view-heading">
                <strong>地址聚合</strong>
                <FlowSegment<LiquidityFlowAddressSort>
                  label="地址排序"
                  onChange={setAddressSort}
                  options={
                    [
                      { label: "净额", value: "net" },
                      { label: "笔数", value: "count" },
                      { label: "最近", value: "recent" },
                    ] as const
                  }
                  value={addressSort}
                />
              </div>
              {remarkState.status === "loading" ? (
                <div className="remark-load-state" role="status">
                  <span className="spinner spinner-small" aria-hidden="true" />
                  正在加载备注
                </div>
              ) : null}
              {remarkState.status === "error" ? (
                <div className="remark-load-state remark-load-error">
                  <AlertTriangle aria-hidden="true" size={16} />
                  <span role="alert">备注加载失败</span>
                  <button onClick={() => void loadRemarks()} type="button">
                    <RefreshCw aria-hidden="true" size={14} />
                    重试加载备注
                  </button>
                </div>
              ) : null}
              {flowProjection.addresses.length === 0 ? (
                <div className="flow-operational-state" role="status">
                  {watchedOnly && watched.size === 0 ? "还没有关注地址" : "当前过滤条件暂无地址"}
                </div>
              ) : (
                <AddressTable
                  editing={setEditingAddress}
                  filter={filterAddress}
                  remarks={remarkState}
                  rows={flowProjection.addresses}
                  toggleWatch={toggleWatched}
                  watched={watched}
                />
              )}
            </div>
          </div>
        ) : null}
      </section>
      <AddressRemarkDialog
        address={editingAddress}
        close={() => setEditingAddress(null)}
        remarks={remarkState}
        remove={removeRemark}
        save={saveRemark}
      />
    </main>
  );
}
