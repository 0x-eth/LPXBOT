import {
  marketCandleBars,
  type MarketCandleBar,
  type MarketCandlesResponse,
  type MarketPoolRow,
  type MarketTickLiquidityResponse,
} from "@lpbot/api-contract";
import { Decimal } from "decimal.js";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from "lightweight-charts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  MarketChartClient,
  MarketChartRequestError,
  MarketChartRequestManager,
} from "./market-chart-client";

export type MarketDetailFixtureState =
  | "loading"
  | "empty"
  | "error"
  | "stale"
  | "unsupported"
  | "invalid";

type MarketDetailStatus = MarketDetailFixtureState | "ready";
type MarketDetailTab = "candles" | "ticks";

interface LoadedCandles {
  kind: "candles";
  response: MarketCandlesResponse;
  selectionKey: string;
}

interface LoadedTicks {
  kind: "ticks";
  response: MarketTickLiquidityResponse;
  selectionKey: string;
}

type LoadedMarketData = LoadedCandles | LoadedTicks;

export interface PoolMarketDetailProps {
  fixtureState: MarketDetailFixtureState | null;
  refreshMs: number;
  refreshSignal: number;
  row: MarketPoolRow;
  stale: boolean;
}

function finiteDecimalNumber(value: string): number | null {
  const number = new Decimal(value).toNumber();
  return Number.isFinite(number) ? number : null;
}

function candlesAreRenderable(response: MarketCandlesResponse): boolean {
  return response.candles.every((candle) =>
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(
      (value) => finiteDecimalNumber(value) !== null,
    ),
  );
}

function shortRevision(revision: string): string {
  return revision.length > 28 ? `${revision.slice(0, 20)}...${revision.slice(-6)}` : revision;
}

function CandleChart({ response }: { response: MarketCandlesResponse }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const text = style.getPropertyValue("--text").trim() || "#17191b";
    const border = style.getPropertyValue("--border").trim() || "#e1e5e6";
    const surface = style.getPropertyValue("--surface").trim() || "#ffffff";
    const chart = createChart(element, {
      autoSize: true,
      height: 280,
      grid: {
        horzLines: { color: border },
        vertLines: { color: border },
      },
      layout: {
        attributionLogo: true,
        background: { color: surface, type: ColorType.Solid },
        textColor: text,
      },
      rightPriceScale: {
        borderColor: border,
        scaleMargins: { bottom: 0.24, top: 0.08 },
      },
      timeScale: {
        borderColor: border,
        rightOffset: 2,
        timeVisible: response.bar !== "1D",
      },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      borderDownColor: "#b5413b",
      borderUpColor: "#087f5b",
      downColor: "#b5413b",
      priceFormat: { minMove: 0.00000001, precision: 8, type: "price" },
      upColor: "#087f5b",
      wickDownColor: "#b5413b",
      wickUpColor: "#087f5b",
    });
    const volume = chart.addSeries(HistogramSeries, {
      color: "#8a9499",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { bottom: 0, top: 0.82 },
    });
    candles.setData(
      response.candles.map<CandlestickData>((candle) => ({
        close: finiteDecimalNumber(candle.close)!,
        high: finiteDecimalNumber(candle.high)!,
        low: finiteDecimalNumber(candle.low)!,
        open: finiteDecimalNumber(candle.open)!,
        time: candle.ts as UTCTimestamp,
      })),
    );
    volume.setData(
      response.candles.map<HistogramData>((candle) => ({
        color:
          new Decimal(candle.close).greaterThanOrEqualTo(candle.open)
            ? "rgba(8, 127, 91, 0.38)"
            : "rgba(181, 65, 59, 0.38)",
        time: candle.ts as UTCTimestamp,
        value: finiteDecimalNumber(candle.volume)!,
      })),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [response]);

  return (
    <div
      aria-label="K 线图"
      className="candle-chart-canvas"
      ref={container}
      role="img"
    />
  );
}

function TickHistogram({ response }: { response: MarketTickLiquidityResponse }) {
  const max = useMemo(
    () =>
      response.ticks.reduce(
        (current, tick) => Decimal.max(current, new Decimal(tick.liquidityNet).abs()),
        new Decimal(0),
      ),
    [response.ticks],
  );

  return (
    <>
      <div
        aria-label={`Tick 流动性直方图，当前 Tick ${response.currentTick ?? "未知"}`}
        className="tick-liquidity-histogram"
        role="img"
      >
        <span aria-hidden="true" className="tick-histogram-zero" />
        <div aria-hidden="true" className="tick-histogram-bars">
          {response.ticks.map((tick) => {
            const liquidity = new Decimal(tick.liquidityNet);
            const height = max.isZero()
              ? 0
              : liquidity.abs().dividedBy(max).times(100).toDecimalPlaces(2).toNumber();
            return (
              <span className="tick-histogram-slot" key={tick.tickIdx}>
                <span
                  className="tick-histogram-bar"
                  data-sign={liquidity.isNegative() ? "negative" : "positive"}
                  style={{ height: `${Math.max(2, height)}%` }}
                  title={`${tick.tickIdx}: ${tick.liquidityNet}`}
                />
              </span>
            );
          })}
        </div>
      </div>
      <div className="tick-liquidity-table-shell">
        <table aria-label="Tick 流动性数据" className="tick-liquidity-table">
          <thead>
            <tr>
              <th scope="col">Tick</th>
              <th scope="col">Liquidity Net</th>
              <th scope="col">Price 0</th>
              <th scope="col">Price 1</th>
            </tr>
          </thead>
          <tbody>
            {response.ticks.map((tick) => (
              <tr data-current={tick.tickIdx === response.currentTick ? "true" : undefined} key={tick.tickIdx}>
                <th scope="row">{tick.tickIdx}</th>
                <td>{tick.liquidityNet}</td>
                <td>{tick.price0 ?? "--"}</td>
                <td>{tick.price1 ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function statusText(status: MarketDetailStatus, tab: MarketDetailTab): string {
  if (status === "loading") return tab === "candles" ? "正在加载 K 线" : "正在加载 Tick 流动性";
  if (status === "empty") return tab === "candles" ? "暂无 K 线历史" : "暂无 Tick 流动性";
  if (status === "error") return "图表加载失败";
  if (status === "stale") return "图表数据陈旧";
  if (status === "unsupported") return "当前池暂不支持图表";
  if (status === "invalid") return "图表数据无效";
  return "";
}

export function PoolMarketDetail({
  fixtureState,
  refreshMs,
  refreshSignal,
  row,
  stale,
}: PoolMarketDetailProps) {
  const client = useMemo(() => new MarketChartClient(), []);
  const manager = useRef(new MarketChartRequestManager());
  const [tab, setTab] = useState<MarketDetailTab>("candles");
  const [bar, setBar] = useState<MarketCandleBar>("5m");
  const [token, setToken] = useState(row.token0Address ?? row.token1Address ?? "");
  const [range, setRange] = useState(10);
  const [reload, setReload] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [loaded, setLoaded] = useState<LoadedMarketData | null>(null);
  const [status, setStatus] = useState<MarketDetailStatus>("loading");
  const tabRefs = useRef<Record<MarketDetailTab, HTMLButtonElement | null>>({
    candles: null,
    ticks: null,
  });
  const lastRefreshSignal = useRef(refreshSignal);
  const identity = row.poolAddress ?? row.poolId;
  const parsedTickSpacing =
    row.tickSpacing && /^[1-9][0-9]*$/u.test(row.tickSpacing)
      ? Number(row.tickSpacing)
      : null;
  const tickSpacing =
    parsedTickSpacing !== null && Number.isSafeInteger(parsedTickSpacing)
      ? parsedTickSpacing
      : null;
  const selectionKey =
    tab === "candles"
      ? `${row.poolKey}:candles:${bar}:${token}`
      : `${row.poolKey}:ticks:${range}:${tickSpacing ?? "unknown"}`;
  const current = loaded?.selectionKey === selectionKey ? loaded : null;

  const selectTab = useCallback((next: MarketDetailTab, focus = false) => {
    setTab(next);
    if (focus) requestAnimationFrame(() => tabRefs.current[next]?.focus());
  }, []);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: MarketDetailTab) => {
    let next: MarketDetailTab | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      next = currentTab === "candles" ? "ticks" : "candles";
    } else if (event.key === "Home") {
      next = "candles";
    } else if (event.key === "End") {
      next = "ticks";
    }
    if (!next) return;
    event.preventDefault();
    selectTab(next, true);
  };

  useEffect(() => {
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (!nextVisible) manager.current.clear();
      else setReload((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!visible || (fixtureState !== null && fixtureState !== "stale")) return;
    const timer = window.setInterval(() => setReload((value) => value + 1), refreshMs);
    return () => window.clearInterval(timer);
  }, [fixtureState, refreshMs, visible]);

  useEffect(() => {
    if (lastRefreshSignal.current === refreshSignal) return;
    lastRefreshSignal.current = refreshSignal;
    if (!visible) return;
    const timer = window.setTimeout(() => setReload((value) => value + 1), 150);
    return () => window.clearTimeout(timer);
  }, [refreshSignal, visible]);

  useEffect(() => () => manager.current.clear(), []);

  useEffect(() => {
    if (fixtureState !== null && fixtureState !== "stale") {
      manager.current.clear();
      setLoaded(null);
      setStatus(fixtureState);
      return;
    }
    if (!visible) return;
    if (
      (tab === "candles" && (!token || !/^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(row.poolKey))) ||
      (tab === "ticks" && (!identity || tickSpacing === null))
    ) {
      manager.current.clear();
      setLoaded(null);
      setStatus("unsupported");
      return;
    }
    const request = manager.current.start(selectionKey);
    if (!current) setStatus("loading");
    const result =
      tab === "candles"
        ? client.getCandles(
            { bar, limit: 200, poolKey: row.poolKey, token },
            request.signal,
          )
        : client.getTickLiquidity(
            {
              decimals0: null,
              decimals1: null,
              identity: identity!,
              protocol: row.protocol,
              range,
              tickSpacing: tickSpacing!,
            },
            request.signal,
          );
    void result.then(
      (response) => {
        if (!manager.current.isCurrent(request.requestId, selectionKey)) return;
        if (response.poolKey.toLowerCase() !== row.poolKey.toLowerCase()) {
          setLoaded(null);
          setStatus("invalid");
          return;
        }
        if (tab === "candles") {
          const candles = response as MarketCandlesResponse;
          if (
            candles.bar !== bar ||
            candles.token !== token ||
            !candlesAreRenderable(candles)
          ) {
            setLoaded(null);
            setStatus("invalid");
            return;
          }
          setLoaded({ kind: "candles", response: candles, selectionKey });
          setStatus(candles.candles.length === 0 ? "empty" : fixtureState === "stale" || stale ? "stale" : "ready");
          return;
        }
        const ticks = response as MarketTickLiquidityResponse;
        if (ticks.range !== range || ticks.tickSpacing !== tickSpacing) {
          setLoaded(null);
          setStatus("invalid");
          return;
        }
        setLoaded({ kind: "ticks", response: ticks, selectionKey });
        setStatus(ticks.ticks.length === 0 ? "empty" : fixtureState === "stale" || stale ? "stale" : "ready");
      },
      (error: unknown) => {
        if (request.signal.aborted || !manager.current.isCurrent(request.requestId, selectionKey)) {
          return;
        }
        setLoaded(null);
        const code = error instanceof MarketChartRequestError ? error.code : "";
        setStatus(
          code.includes("RESPONSE_INVALID") ||
            code === "TICK_SPACING_MISMATCH" ||
            code === "TOKEN_NOT_IN_POOL"
            ? "invalid"
            : code === "MARKET_POOL_NOT_FOUND"
              ? "unsupported"
              : "error",
        );
      },
    );
    return () => manager.current.clear();
  }, [
    bar,
    client,
    fixtureState,
    identity,
    range,
    reload,
    row.poolKey,
    row.protocol,
    selectionKey,
    stale,
    tab,
    tickSpacing,
    token,
    visible,
  ]);

  const displayStatus: MarketDetailStatus = current ? status : status === "unsupported" ? status : "loading";
  const message = statusText(displayStatus, tab);
  const response = current?.response;
  const panelId = `pool-market-panel-${row.poolKey.replace(/[^a-zA-Z0-9]/gu, "-")}`;

  return (
    <section
      aria-label={`${row.token0Symbol ?? "Token 0"} / ${row.token1Symbol ?? "Token 1"} 市场图表`}
      className="pool-market-detail"
      data-market-detail-state={displayStatus}
    >
      <div className="pool-market-detail-heading">
        <div aria-label="市场图表视图" className="pool-market-tabs" role="tablist">
          <button
            aria-controls={panelId}
            aria-selected={tab === "candles"}
            onClick={() => selectTab("candles")}
            onKeyDown={(event) => onTabKeyDown(event, "candles")}
            ref={(element) => {
              tabRefs.current.candles = element;
            }}
            role="tab"
            tabIndex={tab === "candles" ? 0 : -1}
            type="button"
          >
            K 线
          </button>
          <button
            aria-controls={panelId}
            aria-selected={tab === "ticks"}
            onClick={() => selectTab("ticks")}
            onKeyDown={(event) => onTabKeyDown(event, "ticks")}
            ref={(element) => {
              tabRefs.current.ticks = element;
            }}
            role="tab"
            tabIndex={tab === "ticks" ? 0 : -1}
            type="button"
          >
            Tick 流动性
          </button>
        </div>
        <div className="pool-market-controls">
          {tab === "candles" ? (
            <>
              <label>
                <span>周期</span>
                <select
                  aria-label="K 线周期"
                  onChange={(event) => setBar(event.target.value as MarketCandleBar)}
                  value={bar}
                >
                  {marketCandleBars.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Base token</span>
                <select
                  aria-label="K 线 base token"
                  onChange={(event) => setToken(event.target.value)}
                  value={token}
                >
                  {row.token0Address ? (
                    <option value={row.token0Address}>{row.token0Symbol ?? "Token 0"}</option>
                  ) : null}
                  {row.token1Address ? (
                    <option value={row.token1Address}>{row.token1Symbol ?? "Token 1"}</option>
                  ) : null}
                </select>
              </label>
            </>
          ) : (
            <label className="pool-market-range">
              <span>Range {range}</span>
              <input
                aria-label="Tick range"
                max="50"
                min="5"
                onChange={(event) => setRange(Number(event.target.value))}
                step="1"
                type="range"
                value={range}
              />
            </label>
          )}
          <button
            aria-label="刷新市场图表"
            className="pool-market-refresh"
            onClick={() => setReload((value) => value + 1)}
            title="刷新"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
          </button>
        </div>
      </div>

      <div
        aria-labelledby={undefined}
        className="pool-market-panel"
        id={panelId}
        role="tabpanel"
      >
        {displayStatus !== "ready" && displayStatus !== "stale" ? (
          <div
            className="pool-market-operational-state"
            role={displayStatus === "error" || displayStatus === "invalid" ? "alert" : "status"}
          >
            {displayStatus === "loading" ? (
              <span aria-hidden="true" className="spinner spinner-small" />
            ) : displayStatus === "error" || displayStatus === "invalid" ? (
              <AlertTriangle aria-hidden="true" size={18} />
            ) : null}
            <p>{message}</p>
          </div>
        ) : null}
        {displayStatus === "stale" ? (
          <div className="pool-market-stale" role="status">
            <AlertTriangle aria-hidden="true" size={15} />
            {message}
          </div>
        ) : null}
        {(displayStatus === "ready" || displayStatus === "stale") &&
        current?.kind === "candles" ? (
          <CandleChart response={current.response} />
        ) : null}
        {(displayStatus === "ready" || displayStatus === "stale") && current?.kind === "ticks" ? (
          <TickHistogram response={current.response} />
        ) : null}
      </div>

      {response && (displayStatus === "ready" || displayStatus === "stale") ? (
        <dl className="pool-market-metadata">
          <div>
            <dt>来源</dt>
            <dd>{response.source}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{response.version}</dd>
          </div>
          <div>
            <dt>Canonical revision</dt>
            <dd title={response.canonicalRevision}>{shortRevision(response.canonicalRevision)}</dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>
              <time dateTime={response.asOf}>{new Date(response.asOf).toLocaleString("zh-CN", { hour12: false })}</time>
            </dd>
          </div>
          {current?.kind === "candles" ? (
            <div>
              <dt>单位</dt>
              <dd>{current.response.priceUnit} · volume raw integer</dd>
            </div>
          ) : (
            <div>
              <dt>Current Tick</dt>
              <dd>{current?.response.currentTick ?? "--"}</dd>
            </div>
          )}
        </dl>
      ) : null}
    </section>
  );
}
