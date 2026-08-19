import type {
  CustodyWallet,
  EvmAddress,
  PositionPlatformId,
  PricingPosition,
  SwapQuoteState,
  SwapQuoteView,
  WalletPosition,
  WalletPositionPage,
} from "@lpbot/api-contract";
import {
  ArrowRight,
  CircleAlert,
  Clock3,
  Eye,
  Gauge,
  Import as ImportIcon,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import { PositionHelperClient, PositionHelperRequestError } from "./position-helper-client";
import { LocalPositionExecutionPanel } from "./local-position-execution-panel";
import { LocalSwapExecutionPanel } from "./local-swap-execution-panel";
import {
  initialPricingPositionStreamState,
  parsePricingPositionStreamEvent,
  quoteTimeState,
  reducePricingPositionStream,
  SwapPricingClient,
  SwapPricingRequestError,
} from "./swap-pricing-client";

const chainId = 56 as const;
const platforms = [
  { id: 1, label: "Uniswap V3" },
  { id: 2, label: "PancakeSwap V3" },
  { id: 4, label: "Uniswap V4" },
  { id: 5, label: "PancakeSwap V4" },
] as const;
const tokens = [
  {
    address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    symbol: "WBNB",
  },
  {
    address: "0x55d398326f99059ff775485246999027b3197955",
    symbol: "USDT",
  },
  {
    address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
    symbol: "USDC",
  },
] as const satisfies readonly { address: EvmAddress; symbol: string }[];

const quoteStateLabels: Record<SwapQuoteState, string> = {
  error: "报价失败",
  expired: "已过期",
  idle: "待报价",
  quoted: "有效",
  quoting: "报价中",
  stale: "已失效",
};
const platformLabels = Object.fromEntries(platforms.map(({ id, label }) => [id, label])) as Record<
  PositionPlatformId,
  string
>;

function quoteError(error: unknown): { message: string; state: "error" | "stale" } {
  if (!(error instanceof SwapPricingRequestError)) {
    return { message: "报价源暂时不可用", state: "error" };
  }
  if (error.code === "SWAP_QUOTE_STALE") {
    return { message: "报价源快照已过期", state: "stale" };
  }
  if (error.code === "SWAP_QUOTE_RATE_LIMITED") {
    return { message: "报价刷新过于频繁", state: "error" };
  }
  if (error.code === "SWAP_QUOTE_INVALID") {
    return { message: "报价参数不正确", state: "error" };
  }
  return { message: "报价源暂时不可用", state: "error" };
}

function pricingError(error: unknown): string {
  if (error instanceof PositionHelperRequestError) {
    if (error.code === "POSITION_CURSOR_INVALID") return "仓位快照已变化";
    return "已验证仓位读取失败";
  }
  if (!(error instanceof SwapPricingRequestError)) return "观察仓位服务暂时不可用";
  const labels: Record<string, string> = {
    PRICING_POSITION_REVISION_CONFLICT: "仓位状态已变化，请刷新后重试",
    PRICING_SNAPSHOT_NOT_FOUND: "未找到已验证仓位快照",
    PRICING_SNAPSHOT_QUARANTINED: "仓位快照已隔离",
    PRICING_SNAPSHOT_STALE: "仓位快照已过期",
  };
  return labels[error.code] ?? "观察仓位服务暂时不可用";
}

function SwapQuotePanel({ client, wallet }: { client: SwapPricingClient; wallet: CustodyWallet }) {
  const [amountInBaseUnit, setAmountInBaseUnit] = useState("1000000000000000000");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [platformId, setPlatformId] = useState<PositionPlatformId>(1);
  const [quote, setQuote] = useState<SwapQuoteView | null>(null);
  const [slippageBps, setSlippageBps] = useState(50);
  const [state, setState] = useState<SwapQuoteState>("idle");
  const [tokenIn, setTokenIn] = useState<EvmAddress>(tokens[0].address);
  const [tokenOut, setTokenOut] = useState<EvmAddress>(tokens[1].address);

  const expireAt = quote ? Math.min(Date.parse(quote.expiresAt), Date.parse(quote.deadline)) : null;
  const remainingSeconds = expireAt === null ? 0 : Math.max(0, Math.ceil((expireAt - now) / 1_000));

  useEffect(() => {
    if (!quote || state !== "quoted") return;
    const update = () => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (quoteTimeState(quote, new Date(nextNow)) === "expired") setState("expired");
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [quote, state]);

  const markInputsChanged = () => {
    setError(null);
    if (quote) setState("stale");
  };

  const refresh = useCallback(async () => {
    if (!/^[1-9][0-9]*$/u.test(amountInBaseUnit)) {
      setError("请输入正整数 base-unit 金额");
      setState("error");
      return;
    }
    if (tokenIn === tokenOut) {
      setError("输入与输出 Token 必须不同");
      setState("error");
      return;
    }
    if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) {
      setError("滑点必须在 0 至 500 bps 之间");
      setState("error");
      return;
    }
    setError(null);
    setState("quoting");
    try {
      const next = await client.quote({
        amountInBaseUnit,
        chainId,
        platformId,
        slippageBps,
        tokenIn,
        tokenOut,
        walletId: wallet.walletId,
      });
      setQuote(next);
      setNow(Date.now());
      setState(quoteTimeState(next));
    } catch (failure) {
      const next = quoteError(failure);
      setError(next.message);
      setState(next.state);
    }
  }, [amountInBaseUnit, client, platformId, slippageBps, tokenIn, tokenOut, wallet.walletId]);

  return (
    <section
      aria-busy={state === "quoting"}
      aria-labelledby="swap-quote-title"
      className="wallet-read-section swap-quote-section"
      data-state={state}
      data-testid="swap-quote-panel"
    >
      <div className="wallet-read-heading">
        <div>
          <Gauge aria-hidden="true" size={18} />
          <h2 id="swap-quote-title">Swap 报价</h2>
          <span className="read-state-badge" data-state={state}>
            {quoteStateLabels[state]}
          </span>
        </div>
      </div>
      <form
        className="wallet-read-form swap-quote-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (state !== "quoting") void refresh();
        }}
      >
        <label>
          <span>输入 Token</span>
          <select
            onChange={(event) => {
              markInputsChanged();
              setTokenIn(event.target.value as EvmAddress);
            }}
            value={tokenIn}
          >
            {tokens.map((token) => (
              <option key={token.address} value={token.address}>
                {token.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>输出 Token</span>
          <select
            onChange={(event) => {
              markInputsChanged();
              setTokenOut(event.target.value as EvmAddress);
            }}
            value={tokenOut}
          >
            {tokens.map((token) => (
              <option key={token.address} value={token.address}>
                {token.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>输入金额 (base units)</span>
          <input
            aria-label="Swap 输入金额 base units"
            inputMode="numeric"
            onChange={(event) => {
              markInputsChanged();
              setAmountInBaseUnit(event.target.value);
            }}
            value={amountInBaseUnit}
          />
        </label>
        <label>
          <span>平台</span>
          <select
            aria-label="Swap 平台"
            onChange={(event) => {
              markInputsChanged();
              setPlatformId(Number(event.target.value) as PositionPlatformId);
            }}
            value={platformId}
          >
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.id} · {platform.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>滑点 (bps)</span>
          <input
            aria-label="Swap 滑点 bps"
            inputMode="numeric"
            max={500}
            min={0}
            onChange={(event) => {
              markInputsChanged();
              setSlippageBps(Number(event.target.value));
            }}
            step={1}
            type="number"
            value={slippageBps}
          />
        </label>
        <button
          aria-disabled={state === "quoting"}
          aria-label="刷新 Swap 报价"
          className="icon-button tooltip-control swap-quote-refresh"
          data-tooltip="刷新报价"
          title="刷新 Swap 报价"
          type="submit"
        >
          {state === "quoting" ? (
            <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
          ) : (
            <RefreshCw aria-hidden="true" size={16} />
          )}
        </button>
      </form>
      {error ? (
        <p className="wallet-read-error" role="alert">
          {error}
        </p>
      ) : null}
      {quote ? (
        <div className="swap-quote-result">
          <dl className="swap-quote-facts">
            <div>
              <dt>预计输出</dt>
              <dd>{quote.amountOutBaseUnit}</dd>
            </div>
            <div>
              <dt>最小输出</dt>
              <dd>{quote.minOutBaseUnit}</dd>
            </div>
            <div>
              <dt>价格影响</dt>
              <dd>{(quote.priceImpactBps / 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt>Gas 费用 (wei)</dt>
              <dd>{quote.gas.estimatedFeeWei}</dd>
            </div>
            <div>
              <dt>Gas 上限</dt>
              <dd>{quote.gas.gasLimit}</dd>
            </div>
            <div>
              <dt>有效区块</dt>
              <dd>
                {quote.blockNumber} - {quote.maxBlockNumber}
              </dd>
            </div>
          </dl>
          <div className="swap-quote-route" aria-label="Swap 路由">
            <div>
              {quote.route.tokens.map((token, index) => (
                <span key={`${token}:${index}`}>
                  {index > 0 ? <ArrowRight aria-hidden="true" size={14} /> : null}
                  <code>{token}</code>
                </span>
              ))}
            </div>
            <p>
              <Clock3 aria-hidden="true" size={14} />
              {state === "expired" ? "0 秒" : `${remainingSeconds} 秒`}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function sourceKey(position: WalletPosition): string {
  return `${position.platformId}:${position.tokenId}`;
}

function replacePosition(items: PricingPosition[], position: PricingPosition): PricingPosition[] {
  const exists = items.some(({ pricingId }) => pricingId === position.pricingId);
  return exists
    ? items.map((item) => (item.pricingId === position.pricingId ? position : item))
    : [...items, position];
}

function PositionLedgerRecord({
  busy,
  onWithdrawn,
  position,
}: {
  busy: boolean;
  onWithdrawn(position: PricingPosition): void;
  position: PricingPosition;
}) {
  const latest = position.observations.at(-1);
  const statusLabel =
    position.status === "active" ? "观察中" : position.status === "hidden" ? "已隐藏" : "已撤出";
  return (
    <li className="pricing-position-row">
      <div className="pricing-position-identity">
        <div>
          <strong>{platformLabels[position.platformId]}</strong>
          <span>Token #{position.tokenId}</span>
        </div>
        <span className="read-state-badge" data-state={position.status}>
          {statusLabel}
        </span>
      </div>
      <dl className="pricing-position-facts">
        <div>
          <dt>成本基准</dt>
          <dd>
            <code>{position.costBasis.amount0BaseUnit}</code>
            <code>{position.costBasis.amount1BaseUnit}</code>
          </dd>
        </div>
        <div>
          <dt>USD 成本</dt>
          <dd>
            {position.costBasis.usdValueDecimal ?? "--"}
            <small>{position.costBasis.priceStatus}</small>
          </dd>
        </div>
        <div>
          <dt>链上观察费用</dt>
          <dd>
            <code>{latest?.observedFee0BaseUnit ?? "--"}</code>
            <code>{latest?.observedFee1BaseUnit ?? "--"}</code>
          </dd>
        </div>
        <div>
          <dt>流动性观察值</dt>
          <dd>
            <code>{latest?.liquidityRaw ?? "--"}</code>
            <small>#{latest?.blockNumber ?? "--"}</small>
          </dd>
        </div>
        <div>
          <dt>观察次数</dt>
          <dd>{position.observations.length}</dd>
        </div>
        <div className="pricing-position-action">
          <dt>状态更新</dt>
          <dd>
            <button
              aria-disabled={busy}
              aria-label={`标记 Token #${position.tokenId} 已撤出`}
              className="secondary-button"
              onClick={() => {
                if (!busy) onWithdrawn(position);
              }}
              type="button"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="spin-icon" size={15} />
              ) : (
                <Eye aria-hidden="true" size={15} />
              )}
              标记
            </button>
          </dd>
        </div>
      </dl>
    </li>
  );
}

function PricingPositionPanel({
  client,
  sourceClient,
  wallet,
}: {
  client: SwapPricingClient;
  sourceClient: PositionHelperClient;
  wallet: CustodyWallet;
}) {
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priceObservedAt, setPriceObservedAt] = useState("");
  const [priceSource, setPriceSource] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [sourcePage, setSourcePage] = useState<WalletPositionPage | null>(null);
  const [stream, setStream] = useState(initialPricingPositionStreamState);
  const [usdValue, setUsdValue] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [ledger, positions] = await Promise.all([
          client.pricingPositions(signal),
          sourceClient.positions(wallet.address, signal),
        ]);
        if (signal?.aborted) return;
        setStream((current) => ({ ...current, items: ledger.items }));
        setSourcePage(positions);
        const first = positions.items[0];
        if (first) {
          setSelectedSource(sourceKey(first));
          setAmount0(first.liquidity.amount0BaseUnit);
          setAmount1(first.liquidity.amount1BaseUnit);
        }
      } catch (failure) {
        if (!signal?.aborted) setError(pricingError(failure));
      }
    },
    [client, sourceClient, wallet.address],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal));
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const source = new EventSource("/api/pricing-positions/stream", { withCredentials: true });
    const receive = (message: MessageEvent<string>) => {
      try {
        const event = parsePricingPositionStreamEvent(JSON.parse(message.data));
        setStream((current) => reducePricingPositionStream(current, event));
      } catch {
        setStream((current) => ({ ...current, connection: "stale" }));
      }
    };
    for (const eventName of ["snapshot", "diff", "heartbeat", "tombstone"] as const) {
      source.addEventListener(eventName, receive as EventListener);
    }
    source.onopen = () => setStream((current) => ({ ...current, connection: "live" }));
    source.onerror = () => setStream((current) => ({ ...current, connection: "stale" }));
    return () => source.close();
  }, []);

  const candidates = sourcePage?.items ?? [];
  const chosen = candidates.find((position) => sourceKey(position) === selectedSource) ?? null;
  const importPosition = async () => {
    if (
      !chosen ||
      !sourcePage ||
      !/^(?:0|[1-9][0-9]*)$/u.test(amount0) ||
      !/^(?:0|[1-9][0-9]*)$/u.test(amount1)
    ) {
      setError("请选择有效仓位并填写 base-unit 成本");
      return;
    }
    const hasPrice = usdValue !== "" || priceObservedAt !== "" || priceSource !== "";
    if (hasPrice && (usdValue === "" || priceObservedAt === "" || priceSource === "")) {
      setError("USD 价格、时间和来源必须同时填写");
      return;
    }
    setBusyId("import");
    setError(null);
    try {
      const position = await client.importPricingPosition({
        chainId,
        costBasis: {
          amount0BaseUnit: amount0,
          amount1BaseUnit: amount1,
          priceObservedAt: hasPrice ? new Date(priceObservedAt).toISOString() : null,
          priceSource: hasPrice ? priceSource : null,
          usdValueDecimal: hasPrice ? usdValue : null,
        },
        platformId: chosen.platformId,
        snapshotDigest: sourcePage.snapshot.digest,
        tokenId: chosen.tokenId,
        walletId: wallet.walletId,
      });
      setStream((current) => ({
        ...current,
        items: replacePosition(current.items, position),
      }));
    } catch (failure) {
      setError(pricingError(failure));
    } finally {
      setBusyId(null);
    }
  };

  const markWithdrawn = async (position: PricingPosition) => {
    setBusyId(position.pricingId);
    setError(null);
    try {
      const next = await client.markWithdrawn(position.pricingId, position.revision);
      setStream((current) => ({
        ...current,
        items: replacePosition(current.items, next),
      }));
    } catch (failure) {
      setError(pricingError(failure));
    } finally {
      setBusyId(null);
    }
  };

  const selectSource = (event: ChangeEvent<HTMLSelectElement>) => {
    const key = event.target.value;
    setSelectedSource(key);
    const position = candidates.find((candidate) => sourceKey(candidate) === key);
    if (position) {
      setAmount0(position.liquidity.amount0BaseUnit);
      setAmount1(position.liquidity.amount1BaseUnit);
    }
  };

  return (
    <section
      aria-labelledby="pricing-position-title"
      className="wallet-read-section pricing-position-section"
      data-testid="pricing-position-panel"
    >
      <div className="wallet-read-heading">
        <div>
          <Eye aria-hidden="true" size={18} />
          <h2 id="pricing-position-title">观察台账</h2>
          <span className="read-state-badge" data-state={stream.connection}>
            {stream.connection === "live"
              ? "实时"
              : stream.connection === "stale"
                ? "连接中断"
                : "连接中"}
          </span>
        </div>
        <div className="wallet-read-controls">
          <button
            aria-label="刷新观察仓位"
            className="icon-button tooltip-control"
            data-tooltip="刷新"
            onClick={() => void load()}
            title="刷新观察仓位"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
          </button>
          <button
            aria-disabled={!chosen || busyId === "import"}
            aria-label="导入观察仓位"
            className="secondary-button pricing-import-command"
            onClick={() => {
              if (chosen && busyId !== "import") void importPosition();
            }}
            type="button"
          >
            {busyId === "import" ? (
              <LoaderCircle aria-hidden="true" className="spin-icon" size={15} />
            ) : (
              <ImportIcon aria-hidden="true" size={15} />
            )}
            导入
          </button>
        </div>
      </div>
      <div className="wallet-read-form pricing-import-form">
        <label>
          <span>已验证仓位</span>
          <select aria-label="可导入仓位" onChange={selectSource} value={selectedSource}>
            {candidates.length === 0 ? <option value="">暂无仓位</option> : null}
            {candidates.map((position) => (
              <option key={sourceKey(position)} value={sourceKey(position)}>
                {platformLabels[position.platformId]} · Token #{position.tokenId}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Token 0 成本 (base units)</span>
          <input
            inputMode="numeric"
            onChange={(event) => setAmount0(event.target.value)}
            value={amount0}
          />
        </label>
        <label>
          <span>Token 1 成本 (base units)</span>
          <input
            inputMode="numeric"
            onChange={(event) => setAmount1(event.target.value)}
            value={amount1}
          />
        </label>
        <label>
          <span>USD 成本</span>
          <input
            inputMode="decimal"
            onChange={(event) => setUsdValue(event.target.value)}
            placeholder="可选"
            value={usdValue}
          />
        </label>
        <label>
          <span>价格时间</span>
          <input
            onChange={(event) => setPriceObservedAt(event.target.value)}
            type="datetime-local"
            value={priceObservedAt}
          />
        </label>
        <label>
          <span>价格来源</span>
          <input
            onChange={(event) => setPriceSource(event.target.value)}
            placeholder="可选"
            value={priceSource}
          />
        </label>
      </div>
      {error ? (
        <p className="wallet-read-error" role="alert">
          <CircleAlert aria-hidden="true" size={15} />
          {error}
        </p>
      ) : null}
      {stream.items.length === 0 ? (
        <div className="position-helper-state" role="status">
          <Eye aria-hidden="true" size={17} />
          <p>暂无观察仓位</p>
        </div>
      ) : (
        <ul aria-label="观察仓位台账" className="pricing-position-list">
          {stream.items.map((position) => (
            <PositionLedgerRecord
              busy={busyId === position.pricingId}
              key={position.pricingId}
              onWithdrawn={(item) => void markWithdrawn(item)}
              position={position}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function SwapPricingPanels({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new SwapPricingClient(), []);
  const sourceClient = useMemo(() => new PositionHelperClient(), []);
  return (
    <div className="swap-pricing-read-model">
      <SwapQuotePanel client={client} wallet={wallet} />
      <LocalSwapExecutionPanel wallet={wallet} />
      <LocalPositionExecutionPanel wallet={wallet} />
      <PricingPositionPanel client={client} sourceClient={sourceClient} wallet={wallet} />
    </div>
  );
}
