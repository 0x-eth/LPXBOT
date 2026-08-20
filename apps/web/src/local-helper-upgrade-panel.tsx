import type {
  CustodyWallet,
  LocalHelperUpgradeCursor,
  LocalHelperUpgradeOperation,
  LocalHelperUpgradePreview,
  LocalHelperUpgradeState,
  LocalHelperUpgradeStepState,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  History,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  LocalHelperUpgradeClient,
  LocalHelperUpgradeRequestError,
} from "./local-helper-upgrade-client";

type PanelState =
  "loading" | "idle" | "previewing" | "preview-ready" | "submitting" | LocalHelperUpgradeState;

const stateLabels: Record<PanelState, string> = {
  completed: "已升级",
  failed: "失败",
  idle: "可检查",
  loading: "读取中",
  "manual-recovery-required": "需人工恢复",
  "preview-ready": "待确认",
  previewing: "预览中",
  queued: "已排队",
  running: "升级中",
  submitting: "提交中",
};
const cursorLabels: Record<LocalHelperUpgradeCursor, string> = {
  "atomic-binding-switch": "原子切换 binding",
  completed: "完成",
  "deploy-v2": "部署 WalletHelperV2",
  "final-rescan-v1": "最终复扫 WalletHelperV1",
  preflight: "Preflight",
  "sweep-v1": "清场 WalletHelperV1",
  "verify-v2": "验证 WalletHelperV2",
};
const stepStateLabels: Record<LocalHelperUpgradeStepState, string> = {
  failed: "失败",
  "manual-recovery-required": "需人工恢复",
  pending: "等待",
  running: "执行中",
  succeeded: "通过",
};
const transactionStateLabels: Record<
  LocalHelperUpgradeOperation["transactions"][number]["state"],
  string
> = {
  broadcast: "已广播",
  confirmed: "已确认",
  dropped: "已丢弃",
  failed: "失败",
  pending: "确认中",
  replaced: "已替换",
  signed: "已签名",
};
const blockerLabels: Record<string, string> = {
  BALANCE_ABOVE_DUST: "WalletHelperV1 残留余额仍高于 dust",
  BINDING_DEGRADED: "WalletHelperV1 binding 已降级",
  BINDING_IDENTITY_MISMATCH: "WalletHelperV1 binding identity 不匹配",
  LIVE_OPERATION: "钱包仍有链上操作进行中",
  NFT_CUSTODY: "WalletHelperV1 仍持有 NFT",
  NON_ZERO_ALLOWANCE: "WalletHelperV1 仍有非零 allowance",
  NONCE_CONFLICT: "钱包 nonce 已被占用",
  PROVIDER_DIVERGENCE: "本地 provider 观测不一致",
  REGISTRY_MISMATCH: "Helper Registry identity 不匹配",
  RESIDUAL_COVERAGE_INCOMPLETE: "WalletHelperV1 残留扫描覆盖不完整",
  RESIDUAL_MANUAL_RECOVERY_REQUIRED: "WalletHelperV1 残留需要人工恢复",
  SOURCE_OWNER_MISMATCH: "WalletHelperV1 owner 不匹配",
  SOURCE_RUNTIME_MISMATCH: "WalletHelperV1 runtime hash 不匹配",
  UNKNOWN_TOKEN: "WalletHelperV1 存在未知 Token",
  V1_IDENTITY_MISMATCH: "WalletHelperV1 identity 不匹配",
  WALLET_MISMATCH: "钱包与 Helper binding 不匹配",
};
const pollableStates = new Set<LocalHelperUpgradeState>([
  "queued",
  "running",
  "manual-recovery-required",
]);

function errorLabel(error: unknown): string {
  if (!(error instanceof LocalHelperUpgradeRequestError)) return "Helper 升级请求失败";
  const labels: Record<string, string> = {
    BINDING_NOT_FOUND: "当前钱包没有 active WalletHelperV1",
    CHAIN_NOT_ALLOWED: "升级仅开放于 Local Anvil 31337",
    HELPER_UPGRADE_IN_PROGRESS: "当前钱包已有 Helper 升级进行中",
    HELPER_UPGRADE_NOT_FOUND: "升级 operation 不存在",
    HELPER_UPGRADE_REQUEST_FAILED: "Helper 升级请求失败",
    HELPER_UPGRADE_RESPONSE_INVALID: "升级状态响应不可信",
    HELPER_UPGRADE_UNAVAILABLE: "Helper 升级服务暂时不可用",
    IDEMPOTENCY_CONFLICT: "重复提交内容冲突",
    IDEMPOTENCY_KEY_REQUIRED: "提交幂等键无效",
    MANUAL_RECOVERY_REQUIRED: "WalletHelperV1 需要人工恢复",
    NETWORK_ERROR: "提交结果未知，正在保留 operation 查询入口",
    NONCE_CONFLICT: "钱包 nonce 已被占用",
    PREFLIGHT_FAILED: "升级 preflight 未通过",
    PREVIEW_CHANGED: "升级快照、Registry 或费用已变化",
    PREVIEW_EXPIRED: "升级预览已过期",
    PREVIEW_INVALID: "升级预览无效",
    PROVIDER_DIVERGENCE: "本地 provider 观测不一致",
    REAUTH_REQUIRED: "需要重新验证身份后提交升级",
    TARGET_ADDRESS_OCCUPIED: "预计 WalletHelperV2 地址已被占用",
    WALLET_LOCKED: "钱包尚未解锁",
    WALLET_NOT_FOUND: "钱包不存在或不属于当前账户",
  };
  return labels[error.code] ?? "Helper 升级请求失败";
}

function blockerLabel(value: string): string {
  return blockerLabels[value] ?? value;
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function VersionComparison() {
  return (
    <div aria-label="Helper 版本比较" className="local-helper-upgrade-versions">
      <span>
        <small>当前</small>
        WalletHelperV1
      </span>
      <ArrowRight aria-hidden="true" size={17} />
      <span data-target="true">
        <small>目标</small>
        WalletHelperV2
      </span>
    </div>
  );
}

function StepTimeline({ operation }: { operation: LocalHelperUpgradeOperation }) {
  return (
    <ol aria-label="Helper 升级步骤" className="local-helper-upgrade-steps">
      {operation.steps.map((step, ordinal) => (
        <li data-state={step.state} key={step.cursor}>
          <span aria-hidden="true" className="local-helper-upgrade-step-index">
            {step.state === "succeeded" ? <CheckCircle2 size={15} /> : ordinal + 1}
          </span>
          <div>
            <strong>{cursorLabels[step.cursor]}</strong>
            <small>{step.failureCode ?? stepStateLabels[step.state]}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TransactionLineage({ operation }: { operation: LocalHelperUpgradeOperation }) {
  return (
    <div className="local-helper-upgrade-lineage">
      <div>
        <History aria-hidden="true" size={16} />
        <strong>交易 lineage</strong>
      </div>
      {operation.transactions.length === 0 ? (
        <p>等待部署交易</p>
      ) : (
        <ol aria-label="部署交易 lineage">
          {operation.transactions.map((transaction) => (
            <li data-active={transaction.active} key={transaction.transactionId}>
              <span>G{transaction.generation}</span>
              <strong>{transactionStateLabels[transaction.state]}</strong>
              <code>
                {transaction.transactionHash ? shortHash(transaction.transactionHash) : "--"}
              </code>
              <small>{transaction.maxFeePerGasBaseUnit} wei/gas</small>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function OperationView({ operation }: { operation: LocalHelperUpgradeOperation }) {
  return (
    <div className="local-helper-upgrade-operation" data-testid="local-helper-upgrade-operation">
      <dl className="local-helper-upgrade-facts">
        <div>
          <dt>Operation</dt>
          <dd>
            <code>{operation.operationId}</code>
          </dd>
        </div>
        <div>
          <dt>V1 Helper</dt>
          <dd>
            <code>{operation.sourceHelperAddress}</code>
          </dd>
        </div>
        <div>
          <dt>V2 Helper</dt>
          <dd>
            <code>{operation.expectedTargetAddress}</code>
          </dd>
        </div>
        <div>
          <dt>Nonce</dt>
          <dd>
            <code>{operation.nonce}</code>
          </dd>
        </div>
        <div>
          <dt>Registry</dt>
          <dd>{operation.registryVersion}</dd>
        </div>
        <div>
          <dt>当前游标</dt>
          <dd>{cursorLabels[operation.cursor]}</dd>
        </div>
      </dl>
      {operation.manualRecovery.required ? (
        <div className="local-helper-upgrade-manual" role="alert">
          <div>
            <Wrench aria-hidden="true" size={17} />
            <strong>需人工恢复</strong>
          </div>
          <ul>
            {operation.manualRecovery.blockers.map((blocker) => (
              <li key={blocker}>{blockerLabel(blocker)}</li>
            ))}
          </ul>
          <code>V1: {operation.sourceHelperAddress}</code>
        </div>
      ) : null}
      {operation.failureCode ? (
        <p className="local-helper-upgrade-error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          {operation.failureCode}
        </p>
      ) : null}
      <StepTimeline operation={operation} />
      <TransactionLineage operation={operation} />
    </div>
  );
}

function PreviewDialog({
  busy,
  error,
  onConfirm,
  onOpenChange,
  open,
  preview,
  restoreFocus,
  secondsLeft,
}: {
  busy: boolean;
  error: string | null;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  preview: LocalHelperUpgradePreview | null;
  restoreFocus(): void;
  secondsLeft: number;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog local-helper-upgrade-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>确认 Helper 升级</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭 Helper 升级预览"
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
            <div
              className="local-helper-upgrade-preview"
              data-testid="local-helper-upgrade-preview"
            >
              <VersionComparison />
              <dl className="local-helper-upgrade-facts">
                <div>
                  <dt>V1 Helper</dt>
                  <dd>
                    <code>{preview.sourceHelperAddress}</code>
                  </dd>
                </div>
                <div>
                  <dt>预计 V2</dt>
                  <dd>
                    <code>{preview.expectedTargetAddress}</code>
                  </dd>
                </div>
                <div>
                  <dt>Nonce</dt>
                  <dd>
                    <code>{preview.nonce}</code>
                  </dd>
                </div>
                <div>
                  <dt>最大费用</dt>
                  <dd>
                    <code>{preview.feeLimit.feeCapBaseUnit} wei</code>
                  </dd>
                </div>
                <div>
                  <dt>需 sweep 余额</dt>
                  <dd>{preview.residual.balancesAboveDust}</dd>
                </div>
                <div>
                  <dt>人工恢复项</dt>
                  <dd>
                    {preview.residual.allowanceCount +
                      preview.residual.nftCustodyCount +
                      preview.residual.unknownTokenCount}
                  </dd>
                </div>
              </dl>
              {preview.blockers.length > 0 ? (
                <div className="local-helper-upgrade-manual" role="alert">
                  <div>
                    <Wrench aria-hidden="true" size={17} />
                    <strong>需人工恢复</strong>
                  </div>
                  <ul>
                    {preview.blockers.map((blocker) => (
                      <li key={blocker}>{blockerLabel(blocker)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <ol aria-label="升级预览步骤" className="local-helper-upgrade-preview-steps">
                {preview.steps.map((cursor, ordinal) => (
                  <li key={cursor}>
                    <span>{ordinal + 1}</span>
                    {cursorLabels[cursor]}
                  </li>
                ))}
              </ol>
              <p className="local-helper-upgrade-expiry" role="status">
                <Clock3 aria-hidden="true" size={15} />
                {secondsLeft > 0 ? `${secondsLeft} 秒后过期` : "预览已过期"}
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="local-helper-upgrade-error" role="alert">
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
              disabled={busy || !preview?.upgradeable || secondsLeft <= 0}
              onClick={onConfirm}
              type="button"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
              ) : (
                <ShieldCheck aria-hidden="true" size={16} />
              )}
              {busy ? "正在提交" : "确认升级"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function LocalHelperUpgradePanel({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new LocalHelperUpgradeClient(), []);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const idempotencyKey = useRef<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<LocalHelperUpgradeOperation | null>(null);
  const [preview, setPreview] = useState<LocalHelperUpgradePreview | null>(null);
  const [queryId, setQueryId] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [state, setState] = useState<PanelState>("loading");

  const adoptOperation = useCallback((next: LocalHelperUpgradeOperation) => {
    setOperation(next);
    setQueryId(next.operationId);
    setState(next.state);
    setError(null);
  }, []);

  const loadLatest = useCallback(
    async (signal?: AbortSignal) => {
      setState("loading");
      try {
        const next = await client.latest(wallet.walletId, signal);
        if (!signal?.aborted) adoptOperation(next);
      } catch (failure) {
        if (signal?.aborted) return;
        if (
          failure instanceof LocalHelperUpgradeRequestError &&
          failure.code === "HELPER_UPGRADE_NOT_FOUND"
        ) {
          setOperation(null);
          setState("idle");
          setError(null);
          return;
        }
        setState("idle");
        setError(errorLabel(failure));
      }
    },
    [adoptOperation, client, wallet.walletId],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadLatest(controller.signal);
    });
    return () => controller.abort();
  }, [loadLatest]);

  useEffect(() => {
    if (!operation || !pollableStates.has(operation.state)) return;
    const controller = new AbortController();
    let timer = 0;
    const poll = async () => {
      try {
        const next = await client.operation(operation.operationId, controller.signal);
        if (controller.signal.aborted) return;
        adoptOperation(next);
        if (pollableStates.has(next.state)) timer = window.setTimeout(poll, 1_500);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(errorLabel(failure));
          timer = window.setTimeout(poll, 3_000);
        }
      }
    };
    timer = window.setTimeout(poll, 1_500);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [adoptOperation, client, operation]);

  useEffect(() => {
    if (!preview || !dialogOpen) return;
    const update = () =>
      setSecondsLeft(Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [dialogOpen, preview]);

  const openPreview = async () => {
    if (state === "previewing" || state === "submitting") return;
    setState("previewing");
    setError(null);
    setPreview(null);
    setDialogOpen(true);
    try {
      const next = await client.preview({ chainId: 31_337, walletId: wallet.walletId });
      idempotencyKey.current = `local-helper-upgrade-${crypto.randomUUID()}`;
      setPreview(next);
      setState("preview-ready");
    } catch (failure) {
      setState(operation?.state ?? "idle");
      setError(errorLabel(failure));
    }
  };

  const submit = async () => {
    if (!preview?.upgradeable || secondsLeft <= 0 || !idempotencyKey.current) return;
    setState("submitting");
    setError(null);
    try {
      const next = await client.submit(
        {
          chainId: 31_337,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId: wallet.walletId,
        },
        idempotencyKey.current,
      );
      adoptOperation(next);
      setDialogOpen(false);
    } catch (failure) {
      setState("preview-ready");
      setError(errorLabel(failure));
    }
  };

  const queryOperation = async (event: FormEvent) => {
    event.preventDefault();
    setState("loading");
    setError(null);
    try {
      adoptOperation(await client.operation(queryId.trim()));
    } catch (failure) {
      setState(operation?.state ?? "idle");
      setError(errorLabel(failure));
    }
  };

  const busy = state === "previewing" || state === "submitting";
  return (
    <section
      aria-busy={state === "loading" || busy}
      aria-labelledby="local-helper-upgrade-title"
      className="wallet-read-section local-helper-upgrade-section"
      data-state={state}
      data-testid="local-helper-upgrade-panel"
    >
      <div className="wallet-read-heading">
        <div>
          <RefreshCw aria-hidden="true" size={18} />
          <h2 id="local-helper-upgrade-title">Helper 升级</h2>
          <span className="read-state-badge" data-state={state}>
            {stateLabels[state]}
          </span>
        </div>
        <button
          aria-label="刷新 Helper 升级状态"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          disabled={state === "loading"}
          onClick={() => void loadLatest()}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={state === "loading" ? "spin-icon" : undefined}
            size={16}
          />
        </button>
      </div>
      <VersionComparison />
      <div className="local-helper-upgrade-controls">
        <button
          className="primary-button"
          disabled={busy || state === "loading" || operation?.state === "completed"}
          onClick={() => void openPreview()}
          ref={previewTrigger}
          type="button"
        >
          {state === "previewing" ? (
            <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
          ) : (
            <ShieldCheck aria-hidden="true" size={16} />
          )}
          升级到 V2
        </button>
        <form
          className="local-helper-upgrade-query"
          onSubmit={(event) => void queryOperation(event)}
        >
          <label htmlFor="local-helper-upgrade-operation-id">Operation</label>
          <input
            autoComplete="off"
            id="local-helper-upgrade-operation-id"
            onChange={(event) => setQueryId(event.target.value)}
            placeholder="Operation UUID"
            spellCheck={false}
            value={queryId}
          />
          <button
            aria-label="查询 Helper 升级 operation"
            className="icon-button tooltip-control"
            data-tooltip="查询"
            disabled={state === "loading" || queryId.trim().length === 0}
            type="submit"
          >
            <Search aria-hidden="true" size={16} />
          </button>
        </form>
      </div>
      {state === "loading" && !operation ? (
        <div className="position-helper-state" role="status">
          <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
          <p>正在读取升级状态</p>
        </div>
      ) : null}
      {state === "idle" && !operation && !error ? (
        <p className="local-helper-upgrade-empty">尚无 WalletHelper 升级 operation</p>
      ) : null}
      {error ? (
        <p className="local-helper-upgrade-error" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {operation ? <OperationView operation={operation} /> : null}
      <PreviewDialog
        busy={state === "submitting"}
        error={dialogOpen ? error : null}
        onConfirm={() => void submit()}
        onOpenChange={(open) => {
          if (!busy) setDialogOpen(open);
        }}
        open={dialogOpen}
        preview={preview}
        restoreFocus={() => previewTrigger.current?.focus()}
        secondsLeft={secondsLeft}
      />
    </section>
  );
}
