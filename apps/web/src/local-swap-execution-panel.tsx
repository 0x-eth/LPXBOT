import type {
  CustodyWallet,
  EvmAddress,
  LocalSwapAuthorizationMode,
  LocalSwapExecutePreview,
  LocalSwapExecutionOperation,
  LocalSwapExecutionState,
  LocalSwapQuoteView,
  LocalSwapStepKind,
  LocalSwapStepState,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeftRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  LocalSwapExecutionClient,
  LocalSwapExecutionRequestError,
} from "./local-swap-execution-client";

type QuoteState = "idle" | "quoting" | "quoted" | "stale" | "expired" | "error";
type PanelState =
  QuoteState | "previewing" | "preview-ready" | "submitting" | LocalSwapExecutionState;

const chainId = 31_337 as const;
const localTokens = [
  {
    address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    symbol: "Test ERC-20",
  },
  {
    address: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
    symbol: "WBNB",
  },
] as const satisfies readonly { address: EvmAddress; symbol: string }[];

const panelStateLabels: Record<PanelState, string> = {
  broadcast: "已广播",
  error: "请求失败",
  expired: "已过期",
  failed: "失败",
  idle: "待报价",
  pending: "确认中",
  "preview-ready": "待确认",
  previewing: "预览中",
  queued: "等待签名",
  quoted: "可执行",
  quoting: "报价中",
  reconciling: "对账中",
  signing: "签名中",
  stale: "已失效",
  submitting: "提交中",
  succeeded: "已完成",
};
const stepKindLabels: Record<LocalSwapStepKind, string> = {
  "allowance-reset": "Allowance 清零",
  approve: "精确授权",
  cleanup: "失败清理",
  swap: "Helper Swap",
};
const stepStateLabels: Record<LocalSwapStepState, string> = {
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
const terminalStates = new Set<LocalSwapExecutionState>(["succeeded", "failed"]);

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function currentQuote(quote: LocalSwapQuoteView, now = Date.now()): boolean {
  return now < Math.min(Date.parse(quote.expiresAt), Date.parse(quote.deadline));
}

function secondsUntil(value: string): number {
  return Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1_000));
}

function errorLabel(error: unknown): string {
  if (!(error instanceof LocalSwapExecutionRequestError)) return "本地 Swap 请求失败";
  const labels: Record<string, string> = {
    CHAIN_NOT_ALLOWED: "本地执行链当前不可用",
    HELPER_BINDING_MISMATCH: "Helper 身份或链上 code hash 已变化",
    HELPER_NOT_ACTIVE: "当前钱包没有 active 本地 Helper",
    IDEMPOTENCY_CONFLICT: "重复提交内容冲突，已停止再次提交",
    INSUFFICIENT_BALANCE: "Test Token 余额不足",
    LOCAL_SWAP_NOT_FOUND: "执行操作不存在或不属于当前账户",
    LOCAL_SWAP_QUOTE_INVALID: "本地报价参数不正确",
    LOCAL_SWAP_QUOTE_STALE: "本地报价链快照已失效",
    LOCAL_SWAP_QUOTE_UNAVAILABLE: "本地报价服务暂时不可用",
    LOCAL_SWAP_REQUEST_FAILED: "本地 Swap 请求失败",
    LOCAL_SWAP_RESPONSE_INVALID: "执行状态响应不可信，已停止操作",
    LOCAL_SWAP_UNAVAILABLE: "本地执行服务暂时不可用",
    NETWORK_ERROR: "提交结果未知，正在保留现有状态",
    NONCE_DRIFT: "钱包 nonce 已变化，请重新报价",
    NONCE_RECONCILIATION_REQUIRED: "钱包 nonce 正在对账",
    PERMIT2_AUTHORIZATION_INVALID: "Permit2 nonce、期限、域或签名无效",
    PREVIEW_CHANGED: "报价、Helper、Registry 或费用已变化",
    PREVIEW_EXPIRED: "执行预览已过期，请重新预览",
    PREVIEW_INVALID: "执行预览无效",
    QUOTE_CHANGED: "报价摘要与存档不匹配",
    QUOTE_EXPIRED: "本地报价已过期，请重新报价",
    QUOTE_NOT_FOUND: "报价不存在或不属于当前账户",
    QUOTE_STALE: "报价区块窗口已失效，请重新报价",
    REAUTH_REQUIRED: "需要重新验证身份后执行",
    REGISTRY_MISMATCH: "本地执行 Registry 或 code hash 不匹配",
    WALLET_LOCKED: "钱包尚未解锁",
    WALLET_NOT_FOUND: "钱包不存在或不属于当前账户",
  };
  return labels[error.code] ?? "本地 Swap 请求失败";
}

function AuthorizationControl({
  disabled,
  mode,
  onChange,
}: {
  disabled: boolean;
  mode: LocalSwapAuthorizationMode;
  onChange(mode: LocalSwapAuthorizationMode): void;
}) {
  return (
    <div className="local-swap-authorization">
      <span id="local-swap-authorization-label">授权模式</span>
      <div
        aria-labelledby="local-swap-authorization-label"
        className="segmented-control local-swap-authorization-options"
        role="radiogroup"
      >
        <button
          aria-checked={mode === "direct"}
          className="segmented-option"
          disabled={disabled}
          onClick={() => onChange("direct")}
          role="radio"
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={14} />
          精确 Approve
        </button>
        <button
          aria-checked={mode === "permit2"}
          className="segmented-option"
          disabled={disabled}
          onClick={() => onChange("permit2")}
          role="radio"
          type="button"
        >
          <KeyRound aria-hidden="true" size={14} />
          Permit2
        </button>
      </div>
    </div>
  );
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
  preview: LocalSwapExecutePreview | null;
  restoreFocus(): void;
  secondsLeft: number;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog local-swap-preview-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>确认本地 Swap</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭本地 Swap 预览"
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
            <div className="local-swap-preview" data-testid="local-swap-preview">
              <div className="local-swap-preview-network">
                <FileCheck2 aria-hidden="true" size={17} />
                <strong>Local Anvil</strong>
                <code>31337</code>
                <span>{preview.authorizationMode === "direct" ? "Approve" : "Permit2"}</span>
              </div>
              <dl className="local-swap-preview-facts">
                <div>
                  <dt>最小输出</dt>
                  <dd>
                    <code>{preview.minOutBaseUnit}</code>
                  </dd>
                </div>
                <div>
                  <dt>总费用上限</dt>
                  <dd>
                    <code>{preview.feeLimitTotalBaseUnit} wei</code>
                  </dd>
                </div>
                <div>
                  <dt>Service fee</dt>
                  <dd>0 bps</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{new Date(preview.deadline).toLocaleTimeString()}</dd>
                </div>
                <div className="local-swap-helper-fact">
                  <dt>Helper</dt>
                  <dd>
                    <code>{preview.helperAddress}</code>
                  </dd>
                </div>
              </dl>
              <ol aria-label="执行预览步骤" className="local-swap-preview-steps">
                {preview.steps.map((step) => (
                  <li key={step.kind}>
                    <span>{step.ordinal + 1}</span>
                    <strong>{stepKindLabels[step.kind]}</strong>
                    <code>{step.amountBaseUnit}</code>
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

function OperationSteps({ operation }: { operation: LocalSwapExecutionOperation }) {
  return (
    <ol aria-label="本地 Swap operation steps" className="local-swap-operation-steps">
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
                <code>{shortHash(step.stepId)}</code>
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
                    {transaction.transactionHash
                      ? shortHash(transaction.transactionHash)
                      : "待广播"}
                  </code>
                  <small>
                    {transaction.maxFeePerGasBaseUnit} / {transaction.maxPriorityFeePerGasBaseUnit}
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="local-swap-step-waiting">等待前序 step</p>
          )}
          {step.failureCode ? <p className="local-swap-step-failure">{step.failureCode}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function OperationView({
  operation,
  pollingError,
}: {
  operation: LocalSwapExecutionOperation;
  pollingError: string | null;
}) {
  return (
    <div className="local-swap-operation" data-testid="local-swap-operation">
      <dl className="local-swap-operation-facts">
        <div>
          <dt>Operation</dt>
          <dd>
            <code>{operation.operationId}</code>
          </dd>
        </div>
        <div>
          <dt>授权模式</dt>
          <dd>{operation.authorizationMode === "direct" ? "精确 Approve" : "Permit2"}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{new Date(operation.updatedAt).toLocaleTimeString()}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd title={operation.planDigest}>
            <code>{shortHash(operation.planDigest)}</code>
          </dd>
        </div>
      </dl>
      {operation.state === "succeeded" ? (
        <p className="local-swap-operation-success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          余额、minOut、Helper 事件、allowance 与 canonical receipt 已核对
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
      <OperationSteps operation={operation} />
    </div>
  );
}

export function LocalSwapExecutionPanel({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new LocalSwapExecutionClient(), []);
  const executeTrigger = useRef<HTMLButtonElement>(null);
  const [amountInBaseUnit, setAmountInBaseUnit] = useState("1000");
  const [authorizationMode, setAuthorizationMode] = useState<LocalSwapAuthorizationMode>("direct");
  const [blocked, setBlocked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<LocalSwapExecutionOperation | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocalSwapExecutePreview | null>(null);
  const [quote, setQuote] = useState<LocalSwapQuoteView | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [slippageBps, setSlippageBps] = useState(100);
  const [state, setState] = useState<PanelState>("idle");
  const [tokenIn, setTokenIn] = useState<EvmAddress>(localTokens[0].address);
  const [tokenOut, setTokenOut] = useState<EvmAddress>(localTokens[1].address);

  useEffect(() => {
    if (!quote || state !== "quoted") return;
    const update = () => {
      if (!currentQuote(quote)) setState("expired");
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [quote, state]);

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

  const markInputsChanged = () => {
    setError(null);
    setBlocked(false);
    if (quote) setState("stale");
  };

  const requestQuote = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!/^[1-9][0-9]{0,77}$/u.test(amountInBaseUnit)) {
        setError("请输入正整数 base-unit 金额");
        setState("error");
        return;
      }
      if (tokenIn === tokenOut) {
        setError("输入与输出 Token 必须不同");
        setState("error");
        return;
      }
      if (!Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) {
        setError("滑点必须在 1 至 500 bps 之间");
        setState("error");
        return;
      }
      setError(null);
      setBlocked(false);
      setState("quoting");
      try {
        const next = await client.quote({
          amountInBaseUnit,
          chainId,
          slippageBps,
          tokenIn,
          tokenOut,
          walletId: wallet.walletId,
        });
        setQuote(next);
        setState(currentQuote(next) ? "quoted" : "expired");
      } catch (failure) {
        setQuote(null);
        setError(errorLabel(failure));
        setState("error");
      }
    },
    [amountInBaseUnit, client, slippageBps, tokenIn, tokenOut, wallet.walletId],
  );

  const requestPreview = useCallback(async () => {
    if (!quote || !currentQuote(quote)) {
      setState("expired");
      return;
    }
    setError(null);
    setBlocked(false);
    setState("previewing");
    try {
      const next = await client.preview({
        authorizationMode,
        quoteDigest: quote.quoteDigest,
        walletId: wallet.walletId,
      });
      setPreview(next);
      setSecondsLeft(secondsUntil(next.expiresAt));
      setIdempotencyKey(`local-swap-${crypto.randomUUID()}`);
      setState("preview-ready");
      setDialogOpen(true);
    } catch (failure) {
      setError(errorLabel(failure));
      setState(currentQuote(quote) ? "quoted" : "expired");
    }
  }, [authorizationMode, client, quote, wallet.walletId]);

  const submit = async () => {
    if (!preview || !idempotencyKey || secondsLeft <= 0 || blocked) return;
    setError(null);
    setState("submitting");
    try {
      const next = await client.execute(
        {
          authorizationMode: preview.authorizationMode,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          quoteDigest: preview.quoteDigest,
          walletId: wallet.walletId,
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
        failure instanceof LocalSwapExecutionRequestError
          ? failure.code
          : "LOCAL_SWAP_REQUEST_FAILED";
      setError(errorLabel(failure));
      setState("preview-ready");
      if (
        code === "IDEMPOTENCY_CONFLICT" ||
        code === "LOCAL_SWAP_RESPONSE_INVALID" ||
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
    setQuote(null);
    setSecondsLeft(0);
    setState("idle");
  };

  const busy = state === "quoting" || state === "previewing" || state === "submitting";
  return (
    <>
      <section
        aria-busy={busy}
        aria-labelledby={`local-swap-title-${wallet.walletId}`}
        className="wallet-read-section local-swap-execution-section"
        data-state={state}
        data-testid="local-swap-execution-panel"
      >
        <div className="wallet-read-heading">
          <div>
            <ArrowLeftRight aria-hidden="true" size={18} />
            <h2 id={`local-swap-title-${wallet.walletId}`}>本地 Swap 执行</h2>
            <span className="read-state-badge" data-state={state}>
              {panelStateLabels[state]}
            </span>
          </div>
          {operation && terminalStates.has(operation.state) ? (
            <button className="secondary-button local-swap-reset" onClick={reset} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              新报价
            </button>
          ) : null}
        </div>
        {operation ? (
          <OperationView operation={operation} pollingError={pollingError} />
        ) : (
          <>
            <form className="wallet-read-form local-swap-quote-form" onSubmit={requestQuote}>
              <label>
                <span>输入 Token</span>
                <select
                  aria-label="本地 Swap 输入 Token"
                  disabled={busy}
                  onChange={(event) => {
                    markInputsChanged();
                    setTokenIn(event.target.value as EvmAddress);
                  }}
                  value={tokenIn}
                >
                  {localTokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>输出 Token</span>
                <select
                  aria-label="本地 Swap 输出 Token"
                  disabled={busy}
                  onChange={(event) => {
                    markInputsChanged();
                    setTokenOut(event.target.value as EvmAddress);
                  }}
                  value={tokenOut}
                >
                  {localTokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.symbol}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>输入金额 (base units)</span>
                <input
                  aria-label="本地 Swap 输入金额 base units"
                  disabled={busy}
                  inputMode="numeric"
                  maxLength={78}
                  onChange={(event) => {
                    markInputsChanged();
                    setAmountInBaseUnit(event.target.value);
                  }}
                  value={amountInBaseUnit}
                />
              </label>
              <label>
                <span>滑点 (bps)</span>
                <input
                  aria-label="本地 Swap 滑点 bps"
                  disabled={busy}
                  inputMode="numeric"
                  max={500}
                  min={1}
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
                className="secondary-button local-swap-quote-command"
                disabled={busy || wallet.lockStatus !== "ready"}
                type="submit"
              >
                {state === "quoting" ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <RefreshCw aria-hidden="true" size={16} />
                )}
                获取报价
              </button>
            </form>
            {error ? (
              <p className="wallet-read-error local-swap-panel-error" role="alert">
                <CircleAlert aria-hidden="true" size={16} />
                {error}
              </p>
            ) : null}
            {quote ? (
              <div
                className="local-swap-quote"
                data-current={state === "quoted" || state === "previewing"}
              >
                <dl className="local-swap-quote-facts">
                  <div>
                    <dt>预计输出</dt>
                    <dd>
                      <code>{quote.amountOutBaseUnit}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>最小输出</dt>
                    <dd>
                      <code>{quote.minOutBaseUnit}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>报价费用</dt>
                    <dd>
                      <code>{quote.gas.estimatedFeeBaseUnit} wei</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Deadline</dt>
                    <dd>{new Date(quote.deadline).toLocaleTimeString()}</dd>
                  </div>
                  <div>
                    <dt>有效区块</dt>
                    <dd>
                      {quote.blockNumber} - {quote.maxBlockNumber}
                    </dd>
                  </div>
                  <div>
                    <dt>Service fee</dt>
                    <dd>0 bps</dd>
                  </div>
                  <div className="local-swap-helper-fact">
                    <dt>Active Helper</dt>
                    <dd>
                      <code>{quote.helperAddress}</code>
                    </dd>
                  </div>
                </dl>
                {state === "quoted" || state === "previewing" ? (
                  <div className="local-swap-execution-controls">
                    <AuthorizationControl
                      disabled={busy}
                      mode={authorizationMode}
                      onChange={(next) => {
                        setAuthorizationMode(next);
                        setError(null);
                      }}
                    />
                    <button
                      className="primary-button local-swap-preview-command"
                      disabled={busy || wallet.lockStatus !== "ready"}
                      onClick={() => void requestPreview()}
                      ref={executeTrigger}
                      type="button"
                    >
                      {state === "previewing" ? (
                        <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                      ) : (
                        <FileCheck2 aria-hidden="true" size={16} />
                      )}
                      预览执行
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
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
            if (quote) setState(currentQuote(quote) ? "quoted" : "expired");
          } else if (open) {
            setDialogOpen(true);
          }
        }}
        open={dialogOpen}
        preview={preview}
        restoreFocus={() => executeTrigger.current?.focus()}
        secondsLeft={secondsLeft}
      />
    </>
  );
}
