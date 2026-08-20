import type {
  CustodyWallet,
  LocalHelperResidualBalance,
  LocalHelperResidualSnapshot,
  LocalHelperSweepBatch,
  LocalHelperSweepBatchState,
  LocalHelperSweepOperation,
  LocalHelperSweepOperationState,
  LocalHelperSweepPreview,
  LocalHelperSweepTransactionState,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  Gauge,
  LoaderCircle,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LocalHelperSweepClient, LocalHelperSweepRequestError } from "./local-helper-sweep-client";

type SweepPanelState =
  | "degraded"
  | "empty"
  | "error"
  | "loading"
  | "manual-recovery-required"
  | "preview-ready"
  | "previewing"
  | "ready"
  | "scanning"
  | "submitting"
  | LocalHelperSweepBatchState;

const stateLabels: Record<SweepPanelState, string> = {
  degraded: "存在残留",
  empty: "无快照",
  error: "请求失败",
  failed: "恢复失败",
  loading: "读取中",
  "manual-recovery-required": "需人工恢复",
  partial: "部分完成",
  "preview-ready": "待确认",
  previewing: "预览中",
  queued: "等待签名",
  ready: "已核对",
  reconciling: "完整复扫中",
  running: "执行中",
  scanning: "扫描中",
  submitting: "提交中",
  succeeded: "已恢复",
};

const operationStateLabels: Record<LocalHelperSweepOperationState, string> = {
  broadcast: "已广播",
  confirmed: "已确认",
  dropped: "已丢弃",
  failed: "失败",
  pending: "确认中",
  queued: "等待签名",
  reconciling: "对账中",
  signing: "签名中",
  succeeded: "成功",
};

const transactionStateLabels: Record<LocalHelperSweepTransactionState, string> = {
  broadcast: "已广播",
  confirmed: "已确认",
  dropped: "已丢弃",
  failed: "失败",
  pending: "确认中",
  replaced: "已替换",
  signed: "已签名",
  succeeded: "成功",
};

const terminalBatchStates = new Set<LocalHelperSweepBatchState>([
  "failed",
  "manual-recovery-required",
  "partial",
  "succeeded",
]);

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function secondsUntil(value: string): number {
  return Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1_000));
}

function assetLabel(asset: Pick<LocalHelperResidualBalance, "fixture" | "kind">): string {
  if (asset.kind === "native") return "Native BNB";
  return asset.fixture === "TestOnlyWBNB" ? "WBNB" : "Test ERC-20";
}

function operationLabel(
  operation: LocalHelperSweepOperation,
  snapshot: LocalHelperResidualSnapshot | null,
): string {
  const asset = snapshot?.balances.find(({ assetId }) => assetId === operation.assetId);
  if (asset) return assetLabel(asset);
  return operation.assetKind === "native" ? "Native BNB" : "Test Token";
}

function snapshotState(snapshot: LocalHelperResidualSnapshot | null): SweepPanelState {
  if (!snapshot) return "empty";
  if (snapshot.manualRecoveryRequired) return "manual-recovery-required";
  if (!snapshot.coverage.complete) return "degraded";
  return snapshot.binding.state === "degraded" ? "degraded" : "ready";
}

function sweepErrorLabel(error: unknown): string {
  if (!(error instanceof LocalHelperSweepRequestError)) return "本地 Helper 恢复请求失败";
  const labels: Record<string, string> = {
    ASSET_ALREADY_CONFIRMED: "所选资产已经确认成功，不会再次广播",
    BATCH_IN_PROGRESS: "当前钱包已有一个 Helper 恢复 batch 正在执行",
    CHAIN_NOT_ALLOWED: "本地 Helper 恢复仅在 Anvil 31337 开放",
    DUPLICATE_ASSET_ID: "每个资产只能选择一次",
    HELPER_BINDING_MISMATCH: "Helper binding、owner 或 runtime 已变化",
    HELPER_NOT_FOUND: "当前钱包没有已验证的 WalletHelperV1",
    IDEMPOTENCY_CONFLICT: "重复提交内容冲突，已停止再次提交",
    IDEMPOTENCY_KEY_REQUIRED: "执行请求缺少稳定幂等键",
    LOCAL_HELPER_SWEEP_NOT_FOUND: "恢复 batch 不存在或不属于当前账户",
    LOCAL_HELPER_SWEEP_REQUEST_FAILED: "本地 Helper 恢复请求失败",
    LOCAL_HELPER_SWEEP_RESPONSE_INVALID: "恢复状态响应不可信，已停止操作",
    LOCAL_HELPER_SWEEP_UNAVAILABLE: "本地 Helper 恢复服务暂时不可用",
    MANUAL_RECOVERY_REQUIRED: "存在 allowance、NFT custody 或未知 Token，需人工恢复",
    NETWORK_ERROR: "提交结果未知，已保留当前幂等键",
    NONCE_DRIFT: "钱包 nonce 已变化，请重新扫描",
    NONCE_RECONCILIATION_REQUIRED: "Provider nonce 存在分歧，正在等待对账",
    PREVIEW_CHANGED: "资产、费用、Helper 或 Registry 已变化",
    PREVIEW_EXPIRED: "恢复预览已过期，请重新预览",
    PREVIEW_INVALID: "恢复预览无效",
    REGISTRY_MISMATCH: "本地 Helper sweep Registry 不匹配",
    SNAPSHOT_CHANGED: "Helper 残留余额或 authority 已变化",
    SNAPSHOT_EXPIRED: "Helper 残留快照已过期，请重新扫描",
    SNAPSHOT_NOT_FOUND: "Helper 残留快照不存在",
    SNAPSHOT_REORGED: "快照区块已发生 reorg，请重新扫描",
    SNAPSHOT_STALE: "快照覆盖不完整或链头已变化",
    UNKNOWN_ASSET: "所选资产不在 TestOnly allowlist",
    WALLET_LOCKED: "钱包尚未解锁",
    WALLET_NOT_FOUND: "钱包不存在或不属于当前账户",
    ZERO_BALANCE: "所选资产为零余额或未超过 dust",
  };
  return labels[error.code] ?? "本地 Helper 恢复请求失败";
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
  preview: LocalHelperSweepPreview | null;
  restoreFocus(): void;
  secondsLeft: number;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog local-swap-preview-dialog local-helper-sweep-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>确认 Helper 残留恢复</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭 Helper 残留恢复预览"
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
            <div className="local-swap-preview" data-testid="local-helper-sweep-preview">
              <div className="local-swap-preview-network">
                <FileCheck2 aria-hidden="true" size={17} />
                <strong>Local Anvil</strong>
                <code>31337</code>
                <span>{preview.assets.length} 个独立 operation</span>
              </div>
              <dl className="local-swap-preview-facts">
                <div>
                  <dt>资产数</dt>
                  <dd>{preview.assets.length}</dd>
                </div>
                <div>
                  <dt>总 gas cap</dt>
                  <dd>
                    <code>{preview.feeLimitTotalBaseUnit} wei</code>
                  </dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{new Date(preview.deadline).toLocaleTimeString()}</dd>
                </div>
                <div className="local-swap-helper-fact">
                  <dt>Immutable owner recipient</dt>
                  <dd>
                    <code>{preview.recipient}</code>
                  </dd>
                </div>
              </dl>
              <ol aria-label="Helper sweep 资产预览" className="local-swap-preview-steps">
                {preview.assets.map((asset, index) => (
                  <li key={asset.assetId}>
                    <span>{index + 1}</span>
                    <strong>{asset.kind === "native" ? "Native BNB" : "Test Token"}</strong>
                    <code>{asset.amountBaseUnit} base units</code>
                    <small>
                      gas {asset.feeLimit.gasLimit} / {asset.feeLimit.feeCapBaseUnit} wei
                    </small>
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
              {busy ? "正在提交" : "确认逐资产执行"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ManualRecovery({ snapshot }: { snapshot: LocalHelperResidualSnapshot }) {
  const allowances = snapshot.allowances.filter(
    ({ amountBaseUnit }) => BigInt(amountBaseUnit) > 0n,
  );
  if (!snapshot.manualRecoveryRequired && snapshot.coverage.complete) return null;
  return (
    <div className="local-helper-manual-recovery" role="alert">
      <ShieldAlert aria-hidden="true" size={17} />
      <div>
        <strong>
          {snapshot.manualRecoveryRequired ? "manual-recovery-required" : "扫描覆盖不完整"}
        </strong>
        {allowances.map((allowance) => (
          <span key={allowance.assetId}>
            Allowance {allowance.spenderRole}: {allowance.amountBaseUnit}
          </span>
        ))}
        {snapshot.nftCustody.map((nft) => (
          <span key={nft.assetId}>NFT custody: Token #{nft.tokenId}</span>
        ))}
        {snapshot.unknownTokens.map((token) => (
          <span key={token.assetId}>Unknown Token: {token.amountBaseUnit} base units</span>
        ))}
        {!snapshot.coverage.complete ? <span>完整 coverage 尚未通过</span> : null}
      </div>
    </div>
  );
}

function AssetSelector({
  blocked,
  onToggle,
  selected,
  snapshot,
}: {
  blocked: boolean;
  onToggle(assetId: string): void;
  selected: ReadonlySet<string>;
  snapshot: LocalHelperResidualSnapshot;
}) {
  return (
    <fieldset className="local-helper-assets" disabled={blocked}>
      <legend>选择超过 dust 的资产</legend>
      <div className="local-helper-asset-list">
        {snapshot.balances.map((asset) => {
          const eligible = BigInt(asset.amountBaseUnit) > BigInt(asset.dustBaseUnit);
          return (
            <label data-eligible={eligible} key={asset.assetId}>
              <input
                checked={selected.has(asset.assetId)}
                disabled={blocked || !eligible}
                onChange={() => onToggle(asset.assetId)}
                type="checkbox"
              />
              <span>
                <strong>{assetLabel(asset)}</strong>
                <code>{asset.amountBaseUnit} base units</code>
              </span>
              <small>dust {asset.dustBaseUnit}</small>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TransactionLineage({ operation }: { operation: LocalHelperSweepOperation }) {
  if (operation.transactions.length === 0) {
    return <p className="local-swap-step-waiting">等待签名与广播</p>;
  }
  return (
    <ol
      aria-label={`${operationLabel(operation, null)} replacement lineage`}
      className="local-swap-lineage"
    >
      {operation.transactions.map((transaction) => (
        <li data-active={transaction.active} key={transaction.generation}>
          <div>
            <strong>第 {transaction.generation + 1} 代</strong>
            {transaction.active ? <span>Active</span> : null}
            <span>{transactionStateLabels[transaction.state]}</span>
          </div>
          <code title={transaction.transactionHash ?? undefined}>
            {transaction.transactionHash ? shortHash(transaction.transactionHash) : "待广播"}
          </code>
          <small>
            {transaction.maxFeePerGasBaseUnit} / {transaction.maxPriorityFeePerGasBaseUnit}
          </small>
        </li>
      ))}
    </ol>
  );
}

function BatchView({
  batch,
  pollingError,
  snapshot,
}: {
  batch: LocalHelperSweepBatch;
  pollingError: string | null;
  snapshot: LocalHelperResidualSnapshot | null;
}) {
  const recovered = batch.state === "succeeded" && snapshot?.binding.state === "active";
  return (
    <div className="local-swap-operation local-helper-batch" data-testid="local-helper-sweep-batch">
      <dl className="local-swap-operation-facts">
        <div>
          <dt>Batch</dt>
          <dd title={batch.batchId}>
            <code>{shortHash(batch.batchId)}</code>
          </dd>
        </div>
        <div>
          <dt>资产进度</dt>
          <dd>
            {batch.operations.filter(({ state }) => state === "succeeded").length} /{" "}
            {batch.operations.length}
          </dd>
        </div>
        <div>
          <dt>Helper</dt>
          <dd title={batch.helperAddress}>
            <code>{shortHash(batch.helperAddress)}</code>
          </dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{new Date(batch.updatedAt).toLocaleTimeString()}</dd>
        </div>
      </dl>
      {recovered ? (
        <p className="local-swap-operation-success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          canonical receipt、余额、allowance、NFT custody、code hash 与 owner 已完整复扫
        </p>
      ) : null}
      {batch.state === "succeeded" && snapshot?.binding.state !== "active" ? (
        <p className="local-swap-operation-reconciliation" role="status">
          <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
          正在读取完整 canonical rescan 结果
        </p>
      ) : null}
      {batch.state === "manual-recovery-required" ? (
        <p className="local-swap-operation-error" role="alert">
          <ShieldAlert aria-hidden="true" size={17} />
          复扫发现 WalletHelperV1 无法处理的 authority 或 custody
        </p>
      ) : null}
      {pollingError ? (
        <p className="local-swap-operation-reconciliation" role="alert">
          <CircleAlert aria-hidden="true" size={17} />
          {pollingError}
        </p>
      ) : null}
      <ol aria-label="Helper sweep 逐资产状态" className="local-swap-operation-steps">
        {batch.operations.map((operation, index) => (
          <li data-state={operation.state} key={operation.operationId}>
            <div className="local-swap-step-heading">
              <span>{index + 1}</span>
              <strong>{operationLabel(operation, snapshot)}</strong>
              <span className="read-state-badge" data-state={operation.state}>
                {operationStateLabels[operation.state]}
              </span>
            </div>
            <dl className="local-swap-step-facts">
              <div>
                <dt>Amount / nonce</dt>
                <dd>
                  <code>
                    {operation.amountBaseUnit} / {operation.nonce}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Gas / fee cap</dt>
                <dd>
                  <code>
                    {operation.feeLimit.gasLimit} / {operation.feeLimit.feeCapBaseUnit}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Operation</dt>
                <dd title={operation.operationId}>
                  <code>{shortHash(operation.operationId)}</code>
                </dd>
              </div>
            </dl>
            <TransactionLineage operation={operation} />
            {operation.reconciliationReason ? (
              <p className="local-helper-operation-reason">{operation.reconciliationReason}</p>
            ) : null}
            {operation.failureCode ? (
              <p className="local-swap-step-failure">{operation.failureCode}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LocalHelperSweepPanel({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new LocalHelperSweepClient(), []);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const refreshedBatch = useRef<string | null>(null);
  const [batch, setBatch] = useState<LocalHelperSweepBatch | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocalHelperSweepPreview | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapshot, setSnapshot] = useState<LocalHelperResidualSnapshot | null>(null);
  const [state, setState] = useState<SweepPanelState>("loading");

  const adoptSnapshot = useCallback((next: LocalHelperResidualSnapshot | null) => {
    setSnapshot(next);
    setSelected(
      new Set(
        next?.balances
          .filter(
            ({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) > BigInt(dustBaseUnit),
          )
          .map(({ assetId }) => assetId) ?? [],
      ),
    );
    setState(snapshotState(next));
  }, []);

  const loadLatest = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = await client.latest(wallet.walletId, signal);
        if (!signal?.aborted) adoptSnapshot(next);
      } catch (failure) {
        if (signal?.aborted) return;
        setError(sweepErrorLabel(failure));
        setState("error");
      }
    },
    [adoptSnapshot, client, wallet.walletId],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void loadLatest(controller.signal));
    return () => controller.abort();
  }, [loadLatest]);

  useEffect(() => {
    if (!preview || !dialogOpen) return;
    const update = () => setSecondsLeft(secondsUntil(preview.expiresAt));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [dialogOpen, preview]);

  useEffect(() => {
    if (!batch || terminalBatchStates.has(batch.state)) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const next = await client.batch(batch.batchId, controller.signal);
        if (controller.signal.aborted) return;
        setBatch(next);
        setState(next.state);
        setPollingError(null);
        if (!terminalBatchStates.has(next.state)) timer = window.setTimeout(poll, 1_000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setPollingError(sweepErrorLabel(failure));
        timer = window.setTimeout(poll, 2_000);
      }
    };
    timer = window.setTimeout(poll, 1_000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [batch, client]);

  useEffect(() => {
    if (
      !batch ||
      !terminalBatchStates.has(batch.state) ||
      refreshedBatch.current === batch.batchId
    ) {
      return;
    }
    refreshedBatch.current = batch.batchId;
    const controller = new AbortController();
    void client
      .latest(wallet.walletId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setSnapshot(next);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setPollingError(sweepErrorLabel(failure));
      });
    return () => controller.abort();
  }, [batch, client, wallet.walletId]);

  const scan = useCallback(async () => {
    setError(null);
    setBlocked(false);
    setState("scanning");
    try {
      const next = await client.scan({
        chainId: 31_337,
        idempotencyKey: `local-helper-scan-${crypto.randomUUID()}`,
        walletId: wallet.walletId,
      });
      adoptSnapshot(next);
    } catch (failure) {
      setError(sweepErrorLabel(failure));
      setState("error");
    }
  }, [adoptSnapshot, client, wallet.walletId]);

  const requestPreview = useCallback(async () => {
    if (!snapshot || selected.size === 0) return;
    setError(null);
    setBlocked(false);
    setState("previewing");
    const assetIds = snapshot.balances
      .map(({ assetId }) => assetId)
      .filter((assetId) => selected.has(assetId));
    try {
      const next = await client.preview({
        assetIds,
        chainId: 31_337,
        snapshotDigest: snapshot.snapshotDigest,
        walletId: wallet.walletId,
      });
      setPreview(next);
      setIdempotencyKey(`local-helper-sweep-${crypto.randomUUID()}`);
      setSecondsLeft(secondsUntil(next.expiresAt));
      setState("preview-ready");
      setDialogOpen(true);
    } catch (failure) {
      setError(sweepErrorLabel(failure));
      setState(snapshotState(snapshot));
    }
  }, [client, selected, snapshot, wallet.walletId]);

  const submit = async () => {
    if (!preview || !idempotencyKey || secondsLeft <= 0 || blocked) return;
    setError(null);
    setState("submitting");
    try {
      const next = await client.sweep(
        {
          assetIds: preview.assets.map(({ assetId }) => assetId),
          chainId: 31_337,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          snapshotDigest: preview.snapshotDigest,
          walletId: wallet.walletId,
        },
        idempotencyKey,
      );
      refreshedBatch.current = null;
      setBatch(next);
      setPollingError(null);
      setState(next.state);
      setDialogOpen(false);
      setPreview(null);
      setIdempotencyKey(null);
    } catch (failure) {
      const code =
        failure instanceof LocalHelperSweepRequestError
          ? failure.code
          : "LOCAL_HELPER_SWEEP_REQUEST_FAILED";
      setError(sweepErrorLabel(failure));
      setState("preview-ready");
      if (
        code === "IDEMPOTENCY_CONFLICT" ||
        code === "LOCAL_HELPER_SWEEP_RESPONSE_INVALID" ||
        code === "NETWORK_ERROR"
      ) {
        setBlocked(true);
      }
    }
  };

  const reset = () => {
    refreshedBatch.current = null;
    setBatch(null);
    setBlocked(false);
    setDialogOpen(false);
    setError(null);
    setIdempotencyKey(null);
    setPollingError(null);
    setPreview(null);
    setSecondsLeft(0);
    setState("loading");
    void loadLatest();
  };

  const busy = ["loading", "previewing", "scanning", "submitting"].includes(state);
  const snapshotBlocked =
    busy ||
    snapshot?.manualRecoveryRequired === true ||
    snapshot?.coverage.complete !== true ||
    wallet.lockStatus !== "ready";

  return (
    <>
      <section
        aria-busy={busy}
        aria-labelledby={`local-helper-sweep-title-${wallet.walletId}`}
        className="wallet-read-section local-helper-sweep-section"
        data-state={state}
        data-testid="local-helper-sweep-panel"
      >
        <div className="wallet-read-heading">
          <div>
            <WalletCards aria-hidden="true" size={18} />
            <h2 id={`local-helper-sweep-title-${wallet.walletId}`}>本地 Helper 恢复</h2>
            <span className="read-state-badge" data-state={state}>
              {stateLabels[state]}
            </span>
          </div>
          {batch && terminalBatchStates.has(batch.state) ? (
            <button className="secondary-button local-helper-rescan" onClick={reset} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              查看复扫
            </button>
          ) : (
            <button
              aria-label="扫描本地 Helper 残留"
              className="icon-button tooltip-control"
              data-tooltip="扫描 Anvil 31337"
              disabled={busy || batch !== null}
              onClick={() => void scan()}
              title="扫描本地 Helper 残留"
              type="button"
            >
              {state === "scanning" ? (
                <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
              ) : (
                <ScanSearch aria-hidden="true" size={16} />
              )}
            </button>
          )}
        </div>
        {state === "loading" ? (
          <div className="position-helper-state" role="status">
            <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
            <p>正在读取本地残留快照</p>
          </div>
        ) : null}
        {state === "scanning" ? (
          <div className="position-helper-state" role="status">
            <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
            <p>正在绑定区块并扫描余额、authority 与 custody</p>
          </div>
        ) : null}
        {state === "empty" ? (
          <div className="position-helper-state" role="status">
            <ScanSearch aria-hidden="true" size={17} />
            <p>尚未生成 Anvil 31337 残留快照</p>
          </div>
        ) : null}
        {error && !dialogOpen ? (
          <p className="wallet-read-error local-swap-panel-error" role="alert">
            <CircleAlert aria-hidden="true" size={16} />
            {error}
          </p>
        ) : null}
        {batch ? (
          <BatchView batch={batch} pollingError={pollingError} snapshot={snapshot} />
        ) : snapshot && state !== "loading" && state !== "scanning" ? (
          <div className="local-helper-snapshot">
            <div className="local-helper-network-line">
              <ShieldCheck aria-hidden="true" size={17} />
              <strong>Local Anvil</strong>
              <code>31337</code>
              <span data-state={snapshot.binding.state}>{snapshot.binding.state}</span>
            </div>
            <dl className="local-position-snapshot-facts local-helper-snapshot-facts">
              <div>
                <dt>Helper</dt>
                <dd title={snapshot.binding.helperAddress}>
                  <code>{shortHash(snapshot.binding.helperAddress)}</code>
                </dd>
              </div>
              <div>
                <dt>Immutable owner</dt>
                <dd title={snapshot.binding.ownerAddress}>
                  <code>{shortHash(snapshot.binding.ownerAddress)}</code>
                </dd>
              </div>
              <div>
                <dt>Canonical block</dt>
                <dd>
                  <code>#{snapshot.block.number}</code>
                </dd>
              </div>
              <div>
                <dt>Coverage</dt>
                <dd>{snapshot.coverage.complete ? "5 / 5" : "incomplete"}</dd>
              </div>
              <div>
                <dt>Runtime / owner</dt>
                <dd>
                  {snapshot.identity.runtimeMatches && snapshot.identity.ownerMatches
                    ? "通过"
                    : "异常"}
                </dd>
              </div>
              <div>
                <dt>Registry</dt>
                <dd>
                  <code>p05-local-helper-sweep-v2</code>
                </dd>
              </div>
            </dl>
            <ManualRecovery snapshot={snapshot} />
            <AssetSelector
              blocked={snapshotBlocked}
              onToggle={(assetId) => {
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(assetId)) next.delete(assetId);
                  else next.add(assetId);
                  return next;
                });
                setError(null);
              }}
              selected={selected}
              snapshot={snapshot}
            />
            <div className="local-helper-sweep-controls">
              <span>
                <Gauge aria-hidden="true" size={15} />
                {selected.size} / {snapshot.balances.length} 个资产
              </span>
              <button
                className="primary-button local-helper-preview-command"
                disabled={snapshotBlocked || selected.size === 0}
                onClick={() => void requestPreview()}
                ref={previewTrigger}
                type="button"
              >
                {state === "previewing" ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <FileCheck2 aria-hidden="true" size={16} />
                )}
                预览逐资产恢复
              </button>
            </div>
            <p className="read-snapshot-line">
              #{snapshot.block.number} · {shortHash(snapshot.snapshotDigest)}
            </p>
          </div>
        ) : null}
      </section>
      <PreviewDialog
        blocked={blocked}
        busy={state === "submitting"}
        error={dialogOpen ? error : null}
        onConfirm={() => void submit()}
        onOpenChange={(open) => {
          if (state !== "submitting") {
            setDialogOpen(open);
            if (!open) setState(snapshotState(snapshot));
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
