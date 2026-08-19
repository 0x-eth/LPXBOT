import type {
  CustodyWallet,
  LocalPositionCurrentPage,
  LocalPositionCurrentSnapshot,
  LocalPositionExecutionOperation,
  LocalPositionExecutionPreview,
  LocalPositionExecutionState,
  LocalPositionStepKind,
  LocalPositionStepState,
  PositionPlatformId,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Coins,
  FileCheck2,
  Flame,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LocalPositionExecutionClient,
  LocalPositionExecutionRequestError,
} from "./local-position-execution-client";

type Availability = "loading" | "ready" | "empty" | "closed" | "error";
type ActionKind = "collect" | "remove";
type PanelState =
  "ready" | "expired" | "previewing" | "preview-ready" | "submitting" | LocalPositionExecutionState;

const platformLabels: Record<PositionPlatformId, string> = {
  1: "Uniswap V3",
  2: "PancakeSwap V3",
  4: "Uniswap V4",
  5: "PancakeSwap V4",
};
const stateLabels: Record<PanelState, string> = {
  broadcast: "已广播",
  expired: "快照过期",
  failed: "失败",
  pending: "确认中",
  "preview-ready": "待确认",
  previewing: "预览中",
  queued: "等待签名",
  ready: "可执行",
  reconciling: "对账中",
  signing: "签名中",
  submitting: "提交中",
  succeeded: "已完成",
};
const stepKindLabels: Record<LocalPositionStepKind, string> = {
  burn: "Burn NFT",
  collect: "Collect proceeds",
  decrease: "Decrease liquidity",
};
const stepStateLabels: Record<LocalPositionStepState, string> = {
  blocked: "等待前序",
  broadcast: "已广播",
  confirmed: "已确认",
  dropped: "已丢弃",
  failed: "失败",
  pending: "确认中",
  queued: "等待签名",
  reconciling: "对账中",
  replaced: "已替换",
  signed: "已签名",
  skipped: "已跳过",
  succeeded: "成功",
};
const terminalStates = new Set<LocalPositionExecutionState>(["succeeded", "failed"]);
const percentPresets = [1, 25, 50, 99, 100] as const;

function short(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function secondsUntil(value: string): number {
  return Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1_000));
}

function snapshotKey(snapshot: LocalPositionCurrentSnapshot): string {
  return `${snapshot.position.platformId}:${snapshot.position.tokenId}:${snapshot.snapshotDigest}`;
}

function errorLabel(error: unknown): string {
  if (!(error instanceof LocalPositionExecutionRequestError)) return "本地仓位请求失败";
  const labels: Record<string, string> = {
    BURN_NOT_ALLOWED: "Burn 仅适用于精确 100% 撤出",
    CHAIN_NOT_ALLOWED: "本地仓位执行门禁已关闭",
    IDEMPOTENCY_CONFLICT: "重复提交内容冲突，已停止再次提交",
    LOCAL_POSITION_NOT_FOUND: "仓位操作不存在或不属于当前账户",
    LOCAL_POSITION_REQUEST_FAILED: "本地仓位请求失败",
    LOCAL_POSITION_RESPONSE_INVALID: "仓位响应不可信，已停止操作",
    LOCAL_POSITION_UNAVAILABLE: "本地仓位执行服务暂时不可用",
    MANAGER_IDENTITY_MISMATCH: "Position Manager 身份或 code hash 已变化",
    NETWORK_ERROR: "提交结果未知，正在保留现有状态",
    NONCE_DRIFT: "钱包 nonce 已变化，请刷新 snapshot",
    NONCE_RECONCILIATION_REQUIRED: "钱包 nonce 正在对账",
    OWNER_APPROVAL_MISMATCH: "NFT owner 或 approval 已变化",
    PREVIEW_CHANGED: "snapshot、Registry、费用或 nonce 已变化",
    PREVIEW_EXPIRED: "执行预览已过期，请重新预览",
    PREVIEW_INVALID: "执行预览参数不正确",
    REAUTH_REQUIRED: "需要重新验证身份后执行",
    REGISTRY_MISMATCH: "本地仓位 Registry 不匹配",
    SNAPSHOT_CHANGED: "仓位链上状态已变化",
    SNAPSHOT_EXPIRED: "仓位 snapshot 已过期",
    SNAPSHOT_NOT_FOUND: "未找到本地仓位 snapshot",
    SNAPSHOT_REORGED: "仓位 snapshot 所在区块已重组",
    SNAPSHOT_STALE: "仓位 snapshot 已超出区块窗口",
    TOKEN_IDENTITY_MISMATCH: "仓位 Token 身份或 code hash 已变化",
    WALLET_LOCKED: "钱包尚未解锁",
    WALLET_NOT_FOUND: "钱包不存在或不属于当前账户",
    ZERO_LIQUIDITY_DELTA: "当前 liquidity 下该比例会舍入为零",
  };
  return labels[error.code] ?? "本地仓位请求失败";
}

function PreviewDialog({
  blocked,
  busy,
  error,
  onConfirm,
  onOpenChange,
  open,
  preview,
  restoreFocus,
  secondsLeft,
}: {
  blocked: boolean;
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  preview: LocalPositionExecutionPreview | null;
  restoreFocus(): void;
  secondsLeft: number;
}) {
  const title =
    preview?.operationKind === "position-collect-fees" ? "确认收取手续费" : "确认撤出流动性";
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog local-swap-preview-dialog local-position-preview-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭本地仓位预览"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                disabled={busy}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          {preview ? (
            <div className="local-swap-preview" data-testid="local-position-preview">
              <div className="local-swap-preview-network">
                <FileCheck2 aria-hidden="true" size={17} />
                <strong>Local Anvil</strong>
                <code>31337</code>
                <span>{platformLabels[preview.platformId]}</span>
              </div>
              <dl className="local-swap-preview-facts local-position-preview-facts">
                <div>
                  <dt>Token0 预期增量</dt>
                  <dd>
                    <code>{preview.expectedToken0DeltaBaseUnit}</code>
                  </dd>
                </div>
                <div>
                  <dt>Token1 预期增量</dt>
                  <dd>
                    <code>{preview.expectedToken1DeltaBaseUnit}</code>
                  </dd>
                </div>
                <div>
                  <dt>剩余 liquidity</dt>
                  <dd>
                    <code>{preview.remainingLiquidity}</code>
                  </dd>
                </div>
                <div>
                  <dt>Fee proceeds 0 / 1</dt>
                  <dd>
                    <code>{preview.feeProceeds0BaseUnit}</code>
                    <code>{preview.feeProceeds1BaseUnit}</code>
                  </dd>
                </div>
                <div>
                  <dt>Principal 0 / 1</dt>
                  <dd>
                    <code>{preview.principal0BaseUnit}</code>
                    <code>{preview.principal1BaseUnit}</code>
                  </dd>
                </div>
                <div>
                  <dt>Min principal 0 / 1</dt>
                  <dd>
                    <code>{preview.minPrincipal0BaseUnit}</code>
                    <code>{preview.minPrincipal1BaseUnit}</code>
                  </dd>
                </div>
                <div>
                  <dt>总费用上限</dt>
                  <dd>
                    <code>{preview.feeLimitTotalBaseUnit} wei</code>
                  </dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{new Date(preview.deadline).toLocaleTimeString()}</dd>
                </div>
                <div>
                  <dt>Service fee</dt>
                  <dd>0 bps</dd>
                </div>
                <div className="local-swap-helper-fact">
                  <dt>Position Manager</dt>
                  <dd>
                    <code>{preview.managerAddress}</code>
                  </dd>
                </div>
              </dl>
              <ol aria-label="仓位执行预览步骤" className="local-swap-preview-steps">
                {preview.steps.map((step) => (
                  <li key={step.ordinal}>
                    <span>{step.ordinal + 1}</span>
                    <strong>{stepKindLabels[step.kind]}</strong>
                    <code>{step.feeLimit.gasLimit} gas</code>
                    <small>{step.feeLimit.feeCapBaseUnit} wei</small>
                  </li>
                ))}
              </ol>
              <p className="local-swap-preview-expiry" role="status">
                <Clock3 aria-hidden="true" size={15} />
                {secondsLeft > 0 ? `${secondsLeft} 秒后过期` : "预览已过期"}
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="wallet-read-error local-swap-dialog-error" role="alert">
              <CircleAlert aria-hidden="true" size={16} />
              {error}
            </p>
          ) : null}
          <div className="wallet-dialog-actions">
            <Dialog.Close asChild>
              <button className="secondary-button" disabled={busy} type="button">
                取消
              </button>
            </Dialog.Close>
            <button
              className="primary-button"
              disabled={blocked || busy || !preview || secondsLeft <= 0}
              onClick={onConfirm}
              type="button"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
              ) : (
                <Play aria-hidden="true" size={16} />
              )}
              {busy ? "正在提交" : "确认执行"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OperationView({
  operation,
  pollingError,
}: {
  operation: LocalPositionExecutionOperation;
  pollingError: string | null;
}) {
  return (
    <div className="local-swap-operation" data-testid="local-position-operation">
      <dl className="local-swap-operation-facts">
        <div>
          <dt>Operation</dt>
          <dd title={operation.operationId}>
            <code>{short(operation.operationId)}</code>
          </dd>
        </div>
        <div>
          <dt>动作</dt>
          <dd>
            {operation.operationKind === "position-collect-fees"
              ? "收取手续费"
              : `${operation.percent}% 撤出${operation.burnIfEmpty ? " + Burn" : ""}`}
          </dd>
        </div>
        <div>
          <dt>Token ID</dt>
          <dd>
            <code>{operation.tokenId}</code>
          </dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{new Date(operation.updatedAt).toLocaleTimeString()}</dd>
        </div>
      </dl>
      {operation.state === "succeeded" ? (
        <p className="local-swap-operation-success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          {operation.operationKind === "position-collect-fees"
            ? "canonical receipt、owed 数量与钱包 token 增量已核对"
            : "decrease principal、collect fee proceeds 与 burn 条件已核对"}
        </p>
      ) : null}
      {operation.reconciliationReason ? (
        <p className="local-swap-operation-reconciliation" role="alert">
          <ShieldAlert aria-hidden="true" size={17} />
          {operation.reconciliationReason}
        </p>
      ) : null}
      {operation.failureCode ? (
        <p className="local-swap-operation-error" role="alert">
          <CircleAlert aria-hidden="true" size={17} />
          {operation.failureCode}
        </p>
      ) : null}
      {pollingError ? (
        <p className="local-swap-operation-reconciliation" role="alert">
          <CircleAlert aria-hidden="true" size={17} />
          {pollingError}
        </p>
      ) : null}
      <ol aria-label="本地仓位 operation steps" className="local-swap-operation-steps">
        {operation.steps.map((step) => (
          <li data-state={step.state} key={step.stepId}>
            <div className="local-swap-step-heading">
              <span>{step.ordinal + 1}</span>
              <strong>{stepKindLabels[step.kind]}</strong>
              <span className="read-state-badge" data-state={step.state}>
                {stepStateLabels[step.state]}
              </span>
            </div>
            <dl className="local-swap-step-facts">
              <div>
                <dt>Nonce</dt>
                <dd>
                  <code>{step.nonce}</code>
                </dd>
              </div>
              <div>
                <dt>Gas / fee cap</dt>
                <dd>
                  <code>
                    {step.feeLimit.gasLimit} / {step.feeLimit.feeCapBaseUnit}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Step</dt>
                <dd title={step.stepId}>
                  <code>{short(step.stepId)}</code>
                </dd>
              </div>
            </dl>
            {step.transactions.length > 0 ? (
              <ol
                aria-label={`${stepKindLabels[step.kind]} replacement lineage`}
                className="local-swap-lineage"
              >
                {step.transactions.map((transaction) => (
                  <li data-active={transaction.active} key={transaction.generation}>
                    <div>
                      <strong>第 {transaction.generation + 1} 代</strong>
                      {transaction.active ? <span>Active</span> : null}
                      <span>{stepStateLabels[transaction.state]}</span>
                    </div>
                    <code title={transaction.transactionHash ?? undefined}>
                      {transaction.transactionHash ? short(transaction.transactionHash) : "待广播"}
                    </code>
                    <small>
                      {transaction.maxFeePerGasBaseUnit} /{" "}
                      {transaction.maxPriorityFeePerGasBaseUnit}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="local-swap-step-waiting">等待前序 step</p>
            )}
            {step.failureCode ? (
              <p className="local-swap-step-failure">{step.failureCode}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LocalPositionExecutionPanel({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new LocalPositionExecutionClient(), []);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<ActionKind>("collect");
  const [availability, setAvailability] = useState<Availability>("loading");
  const [blocked, setBlocked] = useState(false);
  const [burnIfEmpty, setBurnIfEmpty] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<LocalPositionExecutionOperation | null>(null);
  const [page, setPage] = useState<LocalPositionCurrentPage | null>(null);
  const [percent, setPercent] = useState(25);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocalPositionExecutionPreview | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [state, setState] = useState<PanelState>("ready");

  const selected =
    page?.items.find((candidate) => snapshotKey(candidate) === selectedKey) ??
    page?.items[0] ??
    null;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setAvailability("loading");
      setError(null);
      try {
        const next = await client.current(wallet.walletId, signal);
        if (!next.executionEnabled) {
          setPage(next);
          setAvailability("closed");
          return;
        }
        setPage(next);
        setSelectedKey((current) =>
          next.items.some((candidate) => snapshotKey(candidate) === current)
            ? current
            : next.items[0]
              ? snapshotKey(next.items[0])
              : "",
        );
        setAvailability(next.items.length > 0 ? "ready" : "empty");
        setState(
          next.items.some(({ expiresAt }) => Date.parse(expiresAt) > Date.now())
            ? "ready"
            : "expired",
        );
      } catch (failure) {
        if (signal?.aborted) return;
        if (
          failure instanceof LocalPositionExecutionRequestError &&
          (failure.code === "CHAIN_NOT_ALLOWED" || failure.code === "LOCAL_POSITION_UNAVAILABLE")
        ) {
          setAvailability("closed");
          return;
        }
        setError(errorLabel(failure));
        setAvailability("error");
      }
    },
    [client, wallet.walletId],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void load(controller.signal));
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!selected || operation || state !== "ready") return;
    const update = () => {
      if (Date.parse(selected.expiresAt) <= Date.now()) setState("expired");
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [operation, selected, state]);

  useEffect(() => {
    if (!preview || !dialogOpen) return;
    const update = () => setSecondsLeft(secondsUntil(preview.expiresAt));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [dialogOpen, preview]);

  useEffect(() => {
    if (!operation || terminalStates.has(operation.state)) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const next = await client.operation(operation.operationId, controller.signal);
        if (controller.signal.aborted) return;
        setOperation(next);
        setState(next.state);
        setPollingError(null);
        if (!terminalStates.has(next.state)) timer = window.setTimeout(poll, 1_000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setPollingError(errorLabel(failure));
        timer = window.setTimeout(poll, 2_000);
      }
    };
    timer = window.setTimeout(poll, 1_000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [client, operation]);

  if (availability === "closed") return null;

  const busy = state === "previewing" || state === "submitting";
  const executable =
    availability === "ready" &&
    selected !== null &&
    state === "ready" &&
    wallet.lockStatus === "ready" &&
    !operation;

  const requestPreview = async () => {
    if (!selected || !executable) return;
    if (
      action === "remove" &&
      (!Number.isSafeInteger(percent) ||
        percent < 1 ||
        percent > 100 ||
        !Number.isSafeInteger(slippageBps) ||
        slippageBps < 1 ||
        slippageBps > 500)
    ) {
      setError("撤出比例须为 1%-100%，滑点须为 1-500 bps");
      return;
    }
    setError(null);
    setBlocked(false);
    setState("previewing");
    try {
      const base = {
        platformId: selected.position.platformId,
        snapshotDigest: selected.snapshotDigest,
        tokenId: selected.position.tokenId,
        walletId: wallet.walletId,
      } as const;
      const next =
        action === "collect"
          ? await client.previewCollect(base)
          : await client.previewRemove({
              ...base,
              burnIfEmpty,
              percent,
              slippageBps,
            });
      setPreview(next);
      setSecondsLeft(secondsUntil(next.expiresAt));
      setIdempotencyKey(`local-position-${action}-${crypto.randomUUID()}`);
      setState("preview-ready");
      setDialogOpen(true);
    } catch (failure) {
      setError(errorLabel(failure));
      setState(Date.parse(selected.expiresAt) > Date.now() ? "ready" : "expired");
    }
  };

  const submit = async () => {
    if (!preview || !idempotencyKey || secondsLeft <= 0 || blocked) return;
    setError(null);
    setState("submitting");
    try {
      const next =
        preview.operationKind === "position-collect-fees"
          ? await client.collect(
              {
                platformId: preview.platformId,
                previewDigest: preview.previewDigest,
                previewToken: preview.previewToken,
                snapshotDigest: preview.snapshotDigest,
                tokenId: preview.tokenId,
                walletId: preview.walletId,
              },
              idempotencyKey,
            )
          : await client.remove(
              {
                burnIfEmpty: preview.burnIfEmpty,
                percent: preview.percent,
                platformId: preview.platformId,
                previewDigest: preview.previewDigest,
                previewToken: preview.previewToken,
                slippageBps: preview.slippageBps,
                snapshotDigest: preview.snapshotDigest,
                tokenId: preview.tokenId,
                walletId: preview.walletId,
              },
              idempotencyKey,
            );
      setOperation(next);
      setPollingError(null);
      setState(next.state);
      setDialogOpen(false);
      setPreview(null);
      setIdempotencyKey(null);
    } catch (failure) {
      const code =
        failure instanceof LocalPositionExecutionRequestError
          ? failure.code
          : "LOCAL_POSITION_REQUEST_FAILED";
      setError(errorLabel(failure));
      setState("preview-ready");
      if (
        code === "IDEMPOTENCY_CONFLICT" ||
        code === "LOCAL_POSITION_RESPONSE_INVALID" ||
        code === "NETWORK_ERROR"
      ) {
        setBlocked(true);
      }
    }
  };

  const reset = () => {
    setBlocked(false);
    setDialogOpen(false);
    setError(null);
    setIdempotencyKey(null);
    setOperation(null);
    setPollingError(null);
    setPreview(null);
    setSecondsLeft(0);
    setState("ready");
    void load();
  };

  return (
    <>
      <section
        aria-busy={availability === "loading" || busy}
        aria-labelledby={`local-position-title-${wallet.walletId}`}
        className="wallet-read-section local-position-execution-section"
        data-state={state}
        data-testid="local-position-execution-panel"
      >
        <div className="wallet-read-heading">
          <div>
            <Layers3 aria-hidden="true" size={18} />
            <h2 id={`local-position-title-${wallet.walletId}`}>本地仓位执行</h2>
            <span className="read-state-badge" data-state={state}>
              {availability === "loading"
                ? "读取中"
                : availability === "empty"
                  ? "无 snapshot"
                  : availability === "error"
                    ? "读取失败"
                    : stateLabels[state]}
            </span>
          </div>
          {operation && terminalStates.has(operation.state) ? (
            <button className="secondary-button local-swap-reset" onClick={reset} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              刷新 snapshot
            </button>
          ) : availability !== "loading" && !operation ? (
            <button
              aria-label="刷新本地仓位 snapshot"
              className="icon-button tooltip-control"
              data-tooltip="刷新"
              onClick={() => void load()}
              title="刷新本地仓位 snapshot"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="wallet-read-error local-swap-panel-error" role="alert">
            <CircleAlert aria-hidden="true" size={16} />
            {error}
          </p>
        ) : null}
        {availability === "loading" ? (
          <div className="position-helper-state" role="status">
            <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
            <p>读取 Local Anvil current snapshot</p>
          </div>
        ) : availability === "empty" ? (
          <div className="position-helper-state" role="status">
            <Coins aria-hidden="true" size={17} />
            <p>暂无 current local position snapshot</p>
          </div>
        ) : operation ? (
          <OperationView operation={operation} pollingError={pollingError} />
        ) : selected ? (
          <div className="local-position-workspace">
            <div className="local-position-selector-row">
              <label>
                <span>Current snapshot</span>
                <select
                  aria-label="本地仓位 current snapshot"
                  disabled={busy}
                  onChange={(event) => {
                    setSelectedKey(event.target.value);
                    setError(null);
                    setState("ready");
                  }}
                  value={snapshotKey(selected)}
                >
                  {page?.items.map((candidate) => (
                    <option key={snapshotKey(candidate)} value={snapshotKey(candidate)}>
                      {platformLabels[candidate.position.platformId]} · #
                      {candidate.position.tokenId}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                区块 <code>{selected.block.number}</code>
              </span>
            </div>
            <dl className="local-position-snapshot-facts">
              <div>
                <dt>Liquidity</dt>
                <dd>
                  <code>{selected.position.liquidity}</code>
                </dd>
              </div>
              <div>
                <dt>Tokens owed 0 / 1</dt>
                <dd>
                  <code>{selected.position.tokensOwed0BaseUnit}</code>
                  <code>{selected.position.tokensOwed1BaseUnit}</code>
                </dd>
              </div>
              <div>
                <dt>Ticks</dt>
                <dd>
                  {selected.position.ticks.lower} / {selected.position.ticks.upper}
                </dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd
                  title={selected.position.pool.poolAddress ?? selected.position.pool.poolId ?? ""}
                >
                  <code>
                    {short(
                      selected.position.pool.poolAddress ?? selected.position.pool.poolId ?? "0x",
                    )}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd title={selected.snapshotDigest}>
                  <code>{short(selected.snapshotDigest)}</code>
                </dd>
              </div>
              <div>
                <dt>有效期</dt>
                <dd>{new Date(selected.expiresAt).toLocaleTimeString()}</dd>
              </div>
            </dl>
            <div className="local-position-action-tabs" role="tablist" aria-label="仓位操作">
              <button
                aria-selected={action === "collect"}
                disabled={busy}
                onClick={() => {
                  setAction("collect");
                  setError(null);
                }}
                role="tab"
                type="button"
              >
                <Coins aria-hidden="true" size={15} />
                收取手续费
              </button>
              <button
                aria-selected={action === "remove"}
                disabled={busy}
                onClick={() => {
                  setAction("remove");
                  setError(null);
                }}
                role="tab"
                type="button"
              >
                <Layers3 aria-hidden="true" size={15} />
                撤出流动性
              </button>
            </div>
            {action === "collect" ? (
              <div className="local-position-collect-controls" role="tabpanel">
                <dl>
                  <div>
                    <dt>预期 token0 fee</dt>
                    <dd>
                      <code>{selected.position.tokensOwed0BaseUnit}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>预期 token1 fee</dt>
                    <dd>
                      <code>{selected.position.tokensOwed1BaseUnit}</code>
                    </dd>
                  </div>
                </dl>
                <button
                  className="primary-button local-position-preview-command"
                  disabled={!executable || busy}
                  onClick={() => void requestPreview()}
                  ref={previewTrigger}
                  type="button"
                >
                  {state === "previewing" ? (
                    <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                  ) : (
                    <FileCheck2 aria-hidden="true" size={16} />
                  )}
                  预览收取
                </button>
              </div>
            ) : (
              <div className="local-position-remove-controls" role="tabpanel">
                <div className="local-position-percent-control">
                  <span id={`local-position-percent-${wallet.walletId}`}>撤出比例</span>
                  <div
                    aria-labelledby={`local-position-percent-${wallet.walletId}`}
                    className="segmented-control local-position-percent-presets"
                    role="radiogroup"
                  >
                    {percentPresets.map((preset) => (
                      <button
                        aria-checked={percent === preset}
                        className="segmented-option"
                        disabled={busy}
                        key={preset}
                        onClick={() => {
                          setPercent(preset);
                          if (preset !== 100) setBurnIfEmpty(false);
                          setError(null);
                        }}
                        role="radio"
                        type="button"
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span>比例 (%)</span>
                  <input
                    aria-label="撤出流动性比例"
                    disabled={busy}
                    inputMode="numeric"
                    max={100}
                    min={1}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setPercent(next);
                      if (next !== 100) setBurnIfEmpty(false);
                      setError(null);
                    }}
                    step={1}
                    type="number"
                    value={percent}
                  />
                </label>
                <label>
                  <span>滑点 (bps)</span>
                  <input
                    aria-label="撤出流动性滑点 bps"
                    disabled={busy}
                    inputMode="numeric"
                    max={500}
                    min={1}
                    onChange={(event) => {
                      setSlippageBps(Number(event.target.value));
                      setError(null);
                    }}
                    step={1}
                    type="number"
                    value={slippageBps}
                  />
                </label>
                <label className="local-position-burn-toggle">
                  <input
                    checked={burnIfEmpty}
                    disabled={busy || percent !== 100}
                    onChange={(event) => setBurnIfEmpty(event.target.checked)}
                    type="checkbox"
                  />
                  <Flame aria-hidden="true" size={15} />
                  空仓后 Burn NFT
                </label>
                <button
                  className="primary-button local-position-preview-command"
                  disabled={!executable || busy}
                  onClick={() => void requestPreview()}
                  ref={previewTrigger}
                  type="button"
                >
                  {state === "previewing" ? (
                    <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                  ) : (
                    <FileCheck2 aria-hidden="true" size={16} />
                  )}
                  预览撤出
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>
      <PreviewDialog
        blocked={blocked}
        busy={state === "submitting"}
        error={dialogOpen ? error : null}
        onConfirm={() => void submit()}
        onOpenChange={(open) => {
          if (!open && state !== "submitting") {
            setDialogOpen(false);
            setPreview(null);
            setIdempotencyKey(null);
            setBlocked(false);
            setError(null);
            setState(selected && Date.parse(selected.expiresAt) > Date.now() ? "ready" : "expired");
          } else if (open) {
            setDialogOpen(true);
          }
        }}
        open={dialogOpen}
        preview={preview}
        restoreFocus={() => previewTrigger.current?.focus()}
        secondsLeft={secondsLeft}
      />
    </>
  );
}
