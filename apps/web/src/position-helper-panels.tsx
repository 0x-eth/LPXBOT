import type {
  CustodyWallet,
  HelperReadState,
  HelperResidualAsset,
  HelperResidualPage,
  HelperResidualUiState,
  PositionReadUiState,
  WalletHelperStatus,
  WalletPosition,
  WalletPositionPage,
} from "@lpbot/api-contract";
import {
  Boxes,
  CircleAlert,
  CircleOff,
  Layers3,
  LoaderCircle,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PositionHelperClient, PositionHelperRequestError } from "./position-helper-client";
import { HelperDeploymentPanel } from "./helper-deployment-panel";
import { LocalHelperUpgradePanel } from "./local-helper-upgrade-panel";
import { LocalHelperSweepPanel } from "./local-helper-sweep-panel";

type HelperUiState = "error" | "loading" | HelperReadState;

const positionStateLabels: Record<PositionReadUiState, string> = {
  empty: "空仓",
  error: "读取失败",
  loading: "读取中",
  partial: "部分结果",
  quarantined: "已隔离",
  ready: "已就绪",
  stale: "快照过期",
};
const helperStateLabels: Record<HelperUiState, string> = {
  active: "活跃",
  degraded: "异常",
  error: "读取失败",
  loading: "验证中",
  residual: "存在残留",
  superseded: "旧版本",
  undeployed: "未部署",
};
const residualStateLabels: Record<HelperResidualUiState, string> = {
  empty: "无快照",
  error: "读取失败",
  loading: "读取中",
  partial: "覆盖不完整",
  ready: "存在残留",
  scanning: "扫描中",
};
const platformLabels = {
  1: "Uniswap V3",
  2: "PancakeSwap V3",
  4: "Uniswap V4",
  5: "PancakeSwap V4",
} as const;

function readError(error: unknown): string {
  if (!(error instanceof PositionHelperRequestError)) return "读取服务暂时不可用";
  if (error.code === "CHAIN_NOT_ALLOWED") return "当前账户不可读取 BSC";
  if (error.code === "HELPER_UNDEPLOYED") return "当前钱包没有 Helper 绑定";
  if (error.code === "HELPER_RESIDUAL_CURSOR_INVALID") return "残留快照已变化";
  if (error.code === "POSITION_CURSOR_INVALID") return "仓位快照已变化";
  return "读取服务暂时不可用";
}

function StateLine({ icon = false, text }: { icon?: boolean; text: string }) {
  return (
    <div className="position-helper-state" role="status">
      {icon ? (
        <CircleAlert aria-hidden="true" size={17} />
      ) : (
        <CircleOff aria-hidden="true" size={17} />
      )}
      <p>{text}</p>
    </div>
  );
}

function LoadingLine({ text }: { text: string }) {
  return (
    <div className="position-helper-state" role="status">
      <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
      <p>{text}</p>
    </div>
  );
}

function PositionRecord({ position }: { position: WalletPosition }) {
  const poolIdentity = position.pool.poolAddress ?? position.pool.poolId ?? "--";
  return (
    <li className="position-read-row">
      <div className="position-read-identity">
        <div>
          <strong>{platformLabels[position.platformId]}</strong>
          <span>Token #{position.tokenId}</span>
        </div>
        <span className="position-range-state" data-in-range={position.ticks.inRange}>
          {position.ticks.inRange ? "价格区间内" : "价格区间外"}
        </span>
      </div>
      <dl className="position-read-facts">
        <div>
          <dt>Pool</dt>
          <dd>
            <code>{poolIdentity}</code>
          </dd>
        </div>
        <div>
          <dt>Ticks</dt>
          <dd>
            <code>
              {position.ticks.lower} / {position.ticks.current} / {position.ticks.upper}
            </code>
          </dd>
        </div>
        <div>
          <dt>流动性</dt>
          <dd>
            <code>{position.liquidity.raw} base units</code>
            <small>{position.liquidity.amount0BaseUnit} base units</small>
            <small>{position.liquidity.amount1BaseUnit} base units</small>
          </dd>
        </div>
        <div>
          <dt>费用</dt>
          <dd>
            <code>
              {position.fees.owed0BaseUnit} / {position.fees.owed1BaseUnit} base units
            </code>
            <small>
              {position.fees.estimated0BaseUnit ?? "--"} /{" "}
              {position.fees.estimated1BaseUnit ?? "--"}
              {" base units"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Helper 授权</dt>
          <dd>{position.approval.helperAuthorized ? "已验证" : "未授权"}</dd>
        </div>
        <div>
          <dt>快照</dt>
          <dd>
            <code>#{position.snapshot.blockNumber}</code>
          </dd>
        </div>
      </dl>
    </li>
  );
}

function PositionPanel({
  client,
  wallet,
}: {
  client: PositionHelperClient;
  wallet: CustodyWallet;
}) {
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<WalletPositionPage | null>(null);
  const [state, setState] = useState<PositionReadUiState>("loading");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState("loading");
      setError(null);
      try {
        const next = await client.positions(wallet.address, signal);
        if (signal?.aborted) return;
        setPage(next);
        setState(next.status);
      } catch (failure) {
        if (signal?.aborted) return;
        setError(readError(failure));
        setState("error");
      }
    },
    [client, wallet.address],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const items = page?.items ?? [];
  const quarantined = page?.quarantined ?? [];
  return (
    <section
      aria-busy={state === "loading"}
      aria-labelledby="position-read-title"
      className="wallet-read-section position-read-section"
      data-state={state}
      data-testid="position-read-panel"
    >
      <div className="wallet-read-heading">
        <div>
          <Layers3 aria-hidden="true" size={18} />
          <h2 id="position-read-title">仓位</h2>
          <span className="read-state-badge" data-state={state}>
            {positionStateLabels[state]}
          </span>
        </div>
        <button
          aria-disabled={state === "loading"}
          aria-label="刷新仓位"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          onClick={() => {
            if (state !== "loading") void load();
          }}
          title="刷新仓位"
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={state === "loading" ? "spin-icon" : undefined}
            size={16}
          />
        </button>
      </div>
      {state === "loading" ? <LoadingLine text="正在读取仓位" /> : null}
      {state === "empty" ? <StateLine text="未发现已验证仓位" /> : null}
      {state === "stale" ? <StateLine icon text="仓位快照已过期" /> : null}
      {state === "error" ? <StateLine icon text={error ?? "仓位读取失败"} /> : null}
      {state === "partial" ? <StateLine icon text="部分平台读取不完整" /> : null}
      {state === "quarantined" ? <StateLine icon text="仓位读取结果已隔离" /> : null}
      {items.length > 0 ? (
        <ul aria-label="已验证仓位" className="position-read-list">
          {items.map((item) => (
            <PositionRecord key={`${item.platformId}:${item.tokenId}`} position={item} />
          ))}
        </ul>
      ) : null}
      {quarantined.length > 0 ? (
        <ul aria-label="隔离仓位" className="position-quarantine-list">
          {quarantined.map((item, index) => (
            <li key={`${item.platformId ?? "unknown"}:${item.tokenId ?? "unknown"}:${index}`}>
              <code>{item.managerAddress}</code>
              <span>{item.reason}</span>
              <span>{item.tokenId === null ? "未知 NFT" : `Token #${item.tokenId}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {page ? (
        <p className="read-snapshot-line">
          BSC #{page.snapshot.blockNumber} · {page.registryVersion}
        </p>
      ) : null}
    </section>
  );
}

function HelperPanel({ client, wallet }: { client: PositionHelperClient; wallet: CustodyWallet }) {
  const [error, setError] = useState<string | null>(null);
  const [helper, setHelper] = useState<WalletHelperStatus | null>(null);
  const [state, setState] = useState<HelperUiState>("loading");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState("loading");
      setError(null);
      try {
        const next = await client.helper(wallet.address, signal);
        if (signal?.aborted) return;
        setHelper(next);
        setState(next.state);
      } catch (failure) {
        if (signal?.aborted) return;
        setError(readError(failure));
        setState("error");
      }
    },
    [client, wallet.address],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  return (
    <section
      aria-busy={state === "loading"}
      aria-labelledby="helper-read-title"
      className="wallet-read-section helper-read-section"
      data-state={state}
      data-testid="helper-read-panel"
    >
      <div className="wallet-read-heading">
        <div>
          <ShieldCheck aria-hidden="true" size={18} />
          <h2 id="helper-read-title">Helper 状态</h2>
          <span className="read-state-badge" data-state={state}>
            {helperStateLabels[state]}
          </span>
        </div>
        <button
          aria-disabled={state === "loading"}
          aria-label="刷新 Helper 状态"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          onClick={() => {
            if (state !== "loading") void load();
          }}
          title="刷新 Helper 状态"
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={state === "loading" ? "spin-icon" : undefined}
            size={16}
          />
        </button>
      </div>
      {state === "loading" ? <LoadingLine text="正在验证 Helper" /> : null}
      {state === "error" ? <StateLine icon text={error ?? "Helper 读取失败"} /> : null}
      {state === "undeployed" ? <StateLine text="当前钱包没有 Helper 绑定" /> : null}
      {helper && state !== "loading" && state !== "error" && state !== "undeployed" ? (
        <dl className="helper-read-facts">
          <div>
            <dt>地址</dt>
            <dd>
              <code>{helper.address}</code>
            </dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{helper.helperVersion}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              <code>{helper.owner}</code>
            </dd>
          </div>
          <div>
            <dt>验证区块</dt>
            <dd>
              <code>#{helper.verification?.blockNumber ?? "--"}</code>
            </dd>
          </div>
          <div>
            <dt>Runtime hash</dt>
            <dd>
              <code>{helper.verification?.observedRuntimeCodeHash ?? "--"}</code>
            </dd>
          </div>
          <div>
            <dt>校验</dt>
            <dd>{helper.failures.length === 0 ? "全部通过" : helper.failures.join(", ")}</dd>
          </div>
        </dl>
      ) : null}
      {helper ? <p className="read-snapshot-line">{helper.registryVersion} · BSC</p> : null}
    </section>
  );
}

function residualLabel(item: HelperResidualAsset): string {
  if (item.kind === "native") return "BNB";
  if (item.kind === "token") return "Token";
  if (item.kind === "allowance") return "Allowance";
  return `NFT #${item.tokenId}`;
}

function residualIdentity(item: HelperResidualAsset): string {
  if (item.kind === "native") return "BNB native";
  if (item.kind === "token") return item.tokenAddress;
  if (item.kind === "allowance") return `${item.tokenAddress} → ${item.spenderAddress}`;
  return item.managerAddress;
}

function ResidualPanel({
  client,
  wallet,
}: {
  client: PositionHelperClient;
  wallet: CustodyWallet;
}) {
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<HelperResidualPage | null>(null);
  const [state, setState] = useState<HelperResidualUiState>("loading");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState("loading");
      setError(null);
      try {
        const next = await client.residuals(wallet.walletId, signal);
        if (signal?.aborted) return;
        setPage(next);
        setState(next?.state ?? "empty");
      } catch (failure) {
        if (signal?.aborted) return;
        setError(readError(failure));
        setState("error");
      }
    },
    [client, wallet.walletId],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const scan = async () => {
    if (state === "scanning" || state === "loading") return;
    setState("scanning");
    setError(null);
    try {
      const next = await client.scanResiduals(wallet.walletId, `scan-${crypto.randomUUID()}`);
      setPage(next);
      setState(next.state);
    } catch (failure) {
      setError(readError(failure));
      setState("error");
    }
  };

  const items = page?.items ?? [];
  return (
    <section
      aria-busy={state === "loading" || state === "scanning"}
      aria-labelledby="helper-residual-title"
      className="wallet-read-section helper-residual-section"
      data-state={state}
      data-testid="helper-residual-panel"
    >
      <div className="wallet-read-heading">
        <div>
          <ScanSearch aria-hidden="true" size={18} />
          <h2 id="helper-residual-title">残留资产</h2>
          <span className="read-state-badge" data-state={state}>
            {residualStateLabels[state]}
          </span>
        </div>
        <button
          aria-disabled={state === "loading" || state === "scanning"}
          aria-label="重新扫描残留资产"
          className="icon-button tooltip-control"
          data-tooltip="重新扫描"
          onClick={() => void scan()}
          title="重新扫描残留资产"
          type="button"
        >
          {state === "scanning" ? (
            <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
          ) : (
            <RefreshCw aria-hidden="true" size={16} />
          )}
        </button>
      </div>
      {state === "loading" ? <LoadingLine text="正在读取残留快照" /> : null}
      {state === "scanning" ? <LoadingLine text="正在扫描残留资产" /> : null}
      {state === "empty" ? <StateLine text="还没有残留扫描快照" /> : null}
      {state === "error" ? <StateLine icon text={error ?? "残留扫描失败"} /> : null}
      {state === "partial" ? <StateLine icon text="扫描覆盖不完整" /> : null}
      {items.length > 0 ? (
        <ul aria-label="Helper 残留资产" className="helper-residual-list">
          {items.map((item) => (
            <li key={item.assetId}>
              <div>
                <Boxes aria-hidden="true" size={16} />
                <strong>{residualLabel(item)}</strong>
              </div>
              <code>{residualIdentity(item)}</code>
              <code>{item.amountBaseUnit} base units</code>
            </li>
          ))}
        </ul>
      ) : null}
      {page?.coverage.complete === false ? (
        <p className="residual-coverage-line">{page.coverage.missingSources.join(", ")}</p>
      ) : null}
      {page ? (
        <p className="read-snapshot-line">
          BSC #{page.snapshot.blockNumber} · {page.allowlistVersion}
        </p>
      ) : null}
    </section>
  );
}

export function PositionHelperPanels({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new PositionHelperClient(), []);
  return (
    <div className="position-helper-read-model">
      <HelperDeploymentPanel wallet={wallet} />
      <PositionPanel client={client} wallet={wallet} />
      <HelperPanel client={client} wallet={wallet} />
      <LocalHelperUpgradePanel wallet={wallet} />
      <ResidualPanel client={client} wallet={wallet} />
      <LocalHelperSweepPanel wallet={wallet} />
    </div>
  );
}
