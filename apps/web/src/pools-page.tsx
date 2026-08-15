import type { MarketPoolRow, MarketWindowMinutes } from "@lpbot/api-contract";
import { Decimal } from "decimal.js";
import { AlertTriangle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useLocation } from "react-router-dom";

import { PoolsClient } from "./pools-client";
import {
  initialPoolStreamState,
  reducePoolStream,
  type PoolConnectionState,
} from "./pools-stream-state";

const windows = [1, 5, 15, 30, 60] as const;

const fixtureRow: MarketPoolRow = {
  activeTvlUsd: null,
  chainId: 56,
  fdvUsd: "184250000.25",
  feeActiveTvl: null,
  feesUsd: "428.125000000000000001",
  feeTvl: "0.00428125000000000001",
  poolAddress: "0x1111111111111111111111111111111111111111",
  poolId: null,
  protocol: "pcsv3",
  token0Symbol: "WBNB",
  token1Symbol: "USDT",
  transactionCount: "37",
  tvlUsd: "100000.000000000000000001",
  volumeUsd: "248921.75",
};

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

function protocolName(protocol: MarketPoolRow["protocol"]): string {
  const names: Record<MarketPoolRow["protocol"], string> = {
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

function poolIdentity(row: MarketPoolRow): string {
  const value = row.poolAddress ?? row.poolId ?? "unknown";
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function fixtureRows(state: PoolsFixtureState | null): MarketPoolRow[] {
  return state === "ready" || state === "stale" || state === "reconnecting" ? [fixtureRow] : [];
}

function connectionLabel(connection: PoolConnectionState): string {
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
      <span>{connectionLabel(connection)}</span>
    </div>
  );
}

function PoolTable({ rows }: { rows: readonly MarketPoolRow[] }) {
  return (
    <div className="pools-table-shell">
      <table aria-label="BSC 热门池" className="pools-table">
        <thead>
          <tr>
            {["池", "协议", "Fees", "Volume", "TVL", "Txs", "FDV"].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const identity = row.poolAddress ?? row.poolId!;
            return (
              <tr key={`${row.chainId}:${identity}`}>
                <td data-label="池">
                  <strong>
                    {row.token0Symbol ?? "?"} / {row.token1Symbol ?? "?"}
                  </strong>
                  <span className="pool-address">{poolIdentity(row)}</span>
                </td>
                <td data-label="协议">{protocolName(row.protocol)}</td>
                <NumericValue label="Fees" prefix="$ " value={row.feesUsd} />
                <NumericValue label="Volume" prefix="$ " value={row.volumeUsd} />
                <NumericValue label="TVL" prefix="$ " value={row.tvlUsd} />
                <NumericValue fractionDigits={0} label="Txs" value={row.transactionCount} />
                <NumericValue label="FDV" prefix="$ " value={row.fdvUsd} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PoolsPage() {
  const location = useLocation();
  const fixture = fixtureState(location.search);
  const client = useMemo(() => new PoolsClient(), []);
  const [minutes, setMinutes] = useState<MarketWindowMinutes>(5);
  const [retry, setRetry] = useState(0);
  const [state, dispatch] = useReducer(reducePoolStream, undefined, initialPoolStreamState);
  const latestEventAt = useRef(Date.now());

  useEffect(() => {
    if (fixture) return;
    const controller = new AbortController();
    dispatch({ type: "loading" });
    let subscription: ReturnType<PoolsClient["subscribe"]> | null = null;
    void client
      .getSnapshot(minutes, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        dispatch({ snapshot, type: "http-snapshot" });
        subscription = client.subscribe(minutes, {
          onError: () => dispatch({ type: "reconnecting" }),
          onEvent: (event) => {
            latestEventAt.current = Date.now();
            dispatch({ event, type: "event" });
          },
          onOpen: () => {
            latestEventAt.current = Date.now();
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          code: error instanceof Error ? error.message : "MARKET_REQUEST_FAILED",
          type: "error",
        });
      });
    const staleTimer = window.setInterval(() => {
      if (Date.now() - latestEventAt.current > 25_000) dispatch({ type: "stale" });
    }, 1_000);
    return () => {
      controller.abort();
      subscription?.close();
      window.clearInterval(staleTimer);
    };
  }, [client, fixture, minutes, retry]);

  const connection = fixture ?? state.connection;
  const rows = fixture ? fixtureRows(fixture) : state.rows;

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

  return (
    <main
      aria-busy={connection === "loading" ? "true" : undefined}
      className="workspace pools-workspace"
      data-pools-state={connection}
    >
      <div className="pools-heading">
        <div>
          <p className="eyebrow">BSC · 单池 tracer</p>
          <h1>
            <span>热门池</span>
            <span className="sr-only">池子发现 Pools</span>
          </h1>
        </div>
        <ConnectionStatus connection={connection} />
      </div>

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

      {connection === "loading" ? (
        <div className="pools-loading" role="status">
          <span className="spinner spinner-small" aria-hidden="true" />
          <span>正在加载市场数据</span>
        </div>
      ) : null}
      {connection === "error" ? (
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
      {connection === "empty" ? (
        <div className="pools-empty" role="status">
          <p>当前窗口暂无池数据</p>
        </div>
      ) : null}
      {rows.length > 0 ? <PoolTable rows={rows} /> : null}
    </main>
  );
}
