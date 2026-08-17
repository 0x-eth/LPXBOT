import type {
  MarketProtocol,
  PoolCreationAttribution,
  PoolCreationProvenanceRecord,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import { Decimal } from "decimal.js";
import { AlertTriangle, CircleUserRound, ExternalLink, History, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PoolProvenanceClient } from "./pool-provenance-client.js";
import type { PoolCreatorLookupState, PoolCreatorSelection } from "./pool-provenance-state.js";

const historyPageSize = 20;

const protocolLabels: Record<MarketProtocol, string> = {
  pcsv3: "PancakeSwap V3",
  pcsv4: "PancakeSwap V4",
  univ3: "Uniswap V3",
  univ4: "Uniswap V4",
};

interface HistoryState {
  items: PoolCreationAttribution[];
  loadMoreError: boolean;
  nextCursor: string | null;
  status: "empty" | "error" | "loading" | "loading-more" | "ready";
}

function protocolLabel(protocol: MarketProtocol): string {
  return protocolLabels[protocol];
}

function feeDisplay(feePips: string): string {
  return `${new Decimal(feePips)
    .dividedBy(10_000)
    .toDecimalPlaces(6, Decimal.ROUND_HALF_EVEN)
    .toFixed()}%`;
}

function timeDisplay(completedAt: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(completedAt));
}

function identityFromPoolKey(poolKey: string): string {
  return poolKey.slice(poolKey.indexOf(":") + 1);
}

function abbreviated(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function OutcomeWarning({ record }: { record: PoolCreationProvenanceRecord }) {
  if (record.outcome !== "already_exists") return null;
  return (
    <p className="pool-provenance-warning">
      <AlertTriangle aria-hidden="true" size={15} />
      创建时池子已存在，可能非本平台首创
    </p>
  );
}

function ProvenanceRecordDetails({ record }: { record: PoolCreationProvenanceRecord }) {
  const identity = identityFromPoolKey(record.poolKey);
  return (
    <>
      <dl className="pool-provenance-facts">
        <div>
          <dt>平台</dt>
          <dd>{protocolLabel(record.protocol)}</dd>
        </div>
        <div>
          <dt>结果</dt>
          <dd>{record.outcome === "created" ? "创建成功" : "创建时已存在"}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{feeDisplay(record.feePips)}</dd>
        </div>
        <div>
          <dt>完成时间</dt>
          <dd>
            <time dateTime={record.completedAt}>{timeDisplay(record.completedAt)}</time>
          </dd>
        </div>
      </dl>
      <div className="pool-provenance-identity">
        <span>池身份</span>
        <code title={identity}>{abbreviated(identity)}</code>
      </div>
      {record.creatorAddress ? (
        <div className="pool-provenance-identity">
          <span>创建钱包</span>
          <code title={record.creatorAddress}>{record.creatorAddress}</code>
        </div>
      ) : null}
      {record.txHash ? (
        <a
          aria-label={`查看创建交易 ${record.txHash}`}
          className="pool-provenance-transaction"
          href={`https://bscscan.com/tx/${record.txHash}`}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" size={14} />
          查看创建交易
        </a>
      ) : (
        <span className="pool-provenance-no-transaction">未记录创建交易</span>
      )}
      <OutcomeWarning record={record} />
    </>
  );
}

function HistoryRecord({ attribution }: { attribution: PoolCreationAttribution }) {
  const { record } = attribution;
  return (
    <li className="pool-history-record">
      <div className="pool-history-record-heading">
        <strong>{protocolLabel(record.protocol)}</strong>
        <span data-outcome={record.outcome}>
          {record.outcome === "created" ? "已创建" : "已存在"}
        </span>
      </div>
      <ProvenanceRecordDetails record={record} />
    </li>
  );
}

export function PoolCreationHistoryDialog() {
  const client = useMemo(() => new PoolProvenanceClient(), []);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<HistoryState>({
    items: [],
    loadMoreError: false,
    nextCursor: null,
    status: "loading",
  });

  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const load = useCallback(
    async (cursor: string | null, append: boolean) => {
      cancel();
      const requestGeneration = generation.current;
      const requestController = new AbortController();
      controller.current = requestController;
      setState((current) => ({
        items: append ? current.items : [],
        loadMoreError: false,
        nextCursor: append ? current.nextCursor : null,
        status: append ? "loading-more" : "loading",
      }));
      try {
        const page = await client.history({
          cursor,
          limit: historyPageSize,
          signal: requestController.signal,
        });
        if (requestController.signal.aborted || requestGeneration !== generation.current) return;
        setState((current) => {
          const previous = append ? current.items : [];
          const seen = new Set(previous.map(({ record }) => record.operationId));
          const items = [
            ...previous,
            ...page.items.filter(({ record }) => !seen.has(record.operationId)),
          ];
          return {
            items,
            loadMoreError: false,
            nextCursor: page.nextCursor,
            status: items.length === 0 ? "empty" : "ready",
          };
        });
      } catch {
        if (requestController.signal.aborted || requestGeneration !== generation.current) return;
        setState((current) => ({
          ...current,
          loadMoreError: append,
          status: append ? "ready" : "error",
        }));
      }
    },
    [cancel, client],
  );

  useEffect(() => cancel, [cancel]);

  const openChanged = (next: boolean) => {
    setOpen(next);
    if (next) void load(null, false);
    else cancel();
  };

  return (
    <Dialog.Root onOpenChange={openChanged} open={open}>
      <Dialog.Trigger asChild>
        <button className="pool-history-trigger" type="button">
          <History aria-hidden="true" size={15} />
          创建历史
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="remark-dialog-backdrop" />
        <Dialog.Content className="pool-provenance-dialog">
          <div className="pool-provenance-dialog-heading">
            <div>
              <Dialog.Title>创建历史</Dialog.Title>
              <Dialog.Description className="sr-only">
                本人通过 LPXBOT 平台记录的池创建操作
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭创建历史" type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>

          {state.status === "loading" ? (
            <div className="pool-provenance-state" role="status">
              <span className="spinner spinner-small" aria-hidden="true" />
              正在加载创建历史
            </div>
          ) : null}
          {state.status === "empty" ? (
            <div className="pool-provenance-state" role="status">
              <History aria-hidden="true" size={19} />
              还没有平台创建记录
            </div>
          ) : null}
          {state.status === "error" ? (
            <div className="pool-provenance-state pool-provenance-state-error">
              <p role="alert">创建历史加载失败</p>
              <button
                aria-label="重试创建历史"
                onClick={() => void load(null, false)}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} />
                重试
              </button>
            </div>
          ) : null}
          {state.items.length > 0 ? (
            <ul className="pool-history-list">
              {state.items.map((item) => (
                <HistoryRecord attribution={item} key={item.record.operationId} />
              ))}
            </ul>
          ) : null}
          {state.loadMoreError ? <p role="alert">更多创建历史加载失败，请重试</p> : null}
          {state.nextCursor ? (
            <button
              aria-label="加载更多创建历史"
              className="pool-history-more"
              disabled={state.status === "loading-more"}
              onClick={() => void load(state.nextCursor, true)}
              type="button"
            >
              {state.status === "loading-more" ? (
                <span className="spinner spinner-small" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" size={14} />
              )}
              {state.status === "loading-more" ? "正在加载" : "加载更多"}
            </button>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function creatorButtonState(
  lookup: PoolCreatorLookupState,
  poolKey: string,
): "created" | "error" | "legacy" | "loading" | "malformed" | "none" {
  if (lookup.status === "loading") return "loading";
  if (lookup.status === "error") return "error";
  if (lookup.malformed.has(poolKey)) return "malformed";
  const attribution = lookup.records.get(poolKey);
  if (!attribution) return "none";
  return attribution.record.outcome === "created" ? "created" : "legacy";
}

const creatorButtonTitles = {
  created: "平台创建记录",
  error: "创建归属加载失败",
  legacy: "创建时池子已存在",
  loading: "正在加载创建归属",
  malformed: "创建记录格式异常",
  none: "无平台创建记录",
} as const;

export function PoolCreatorButton({
  identity,
  lookup,
  open,
  poolKey,
}: {
  identity: string;
  lookup: PoolCreatorLookupState;
  open(trigger: HTMLButtonElement): void;
  poolKey: string;
}) {
  const state = creatorButtonState(lookup, poolKey);
  return (
    <button
      aria-label={`查看池子创建者 ${identity}`}
      className="pool-creator-row-button"
      data-provenance-state={state}
      disabled={state === "loading"}
      onClick={(event) => open(event.currentTarget)}
      title={creatorButtonTitles[state]}
      type="button"
    >
      {state === "loading" ? (
        <RefreshCw aria-hidden="true" className="pool-creator-loading" size={15} />
      ) : (
        <CircleUserRound aria-hidden="true" size={15} />
      )}
      <span aria-hidden="true" className="pool-creator-indicator" />
    </button>
  );
}

function CreatorAttributionDetails({ attribution }: { attribution: PoolCreationAttribution }) {
  const { creatorProfile, record } = attribution;
  return (
    <div className="pool-creator-details">
      <div
        className="pool-creator-profile"
        data-deleted={creatorProfile === null ? "true" : undefined}
      >
        <CircleUserRound aria-hidden="true" size={21} />
        <div>
          <strong>
            {creatorProfile === null
              ? "用户已删除"
              : (creatorProfile.displayName ?? "未设置显示名称")}
          </strong>
          {creatorProfile?.telegramId ? <span>TG {creatorProfile.telegramId}</span> : null}
        </div>
      </div>
      <div className="pool-provenance-identity">
        <span>平台用户 ID</span>
        <code>{record.userId}</code>
      </div>
      <ProvenanceRecordDetails record={record} />
    </div>
  );
}

export function PoolCreatorDetailsDialog({
  close,
  lookup,
  retry,
  selection,
}: {
  close(): void;
  lookup: PoolCreatorLookupState;
  retry(): void;
  selection: PoolCreatorSelection | null;
}) {
  if (!selection) return null;
  const malformed = lookup.malformed.has(selection.poolKey);
  const attribution = lookup.records.get(selection.poolKey);
  return (
    <Dialog.Root onOpenChange={(next) => (next ? undefined : close())} open>
      <Dialog.Portal>
        <Dialog.Overlay className="remark-dialog-backdrop" />
        <Dialog.Content className="pool-provenance-dialog pool-creator-dialog">
          <div className="pool-provenance-dialog-heading">
            <div>
              <Dialog.Title>池子创建者</Dialog.Title>
              <Dialog.Description className="sr-only">
                LPXBOT 平台记录的池创建操作用户
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭池子创建者" type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <code className="pool-creator-pool-identity" title={selection.identity}>
            {selection.identity}
          </code>

          {lookup.status === "loading" ? (
            <div className="pool-provenance-state" role="status">
              <span className="spinner spinner-small" aria-hidden="true" />
              正在加载创建归属
            </div>
          ) : null}
          {lookup.status === "error" ? (
            <div className="pool-provenance-state pool-provenance-state-error">
              <p role="alert">创建归属加载失败</p>
              <button onClick={retry} type="button">
                <RefreshCw aria-hidden="true" size={14} />
                重试
              </button>
            </div>
          ) : null}
          {lookup.status !== "error" && lookup.status !== "loading" && malformed ? (
            <div className="pool-provenance-state pool-provenance-state-error">
              <p role="alert">创建记录格式异常</p>
            </div>
          ) : null}
          {lookup.status !== "error" && lookup.status !== "loading" && !malformed ? (
            attribution ? (
              <CreatorAttributionDetails attribution={attribution} />
            ) : (
              <div className="pool-provenance-state" role="status">
                非本平台创建，或创建于本功能上线前
              </div>
            )
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
