import type {
  CustodyWallet,
  HelperDeploymentOperation,
  HelperDeploymentPreview,
  HelperDeploymentState,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  PackagePlus,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HelperDeploymentClient, HelperDeploymentRequestError } from "./helper-deployment-client";

type PanelState = "idle" | "previewing" | "preview-ready" | "submitting" | HelperDeploymentState;

const stateLabels: Record<PanelState, string> = {
  broadcast: "已广播",
  confirmed: "已确认",
  dropped: "已丢弃",
  failed: "失败",
  idle: "未部署",
  pending: "确认中",
  "preview-ready": "待确认",
  previewing: "预览中",
  queued: "等待签名",
  reconciling: "对账中",
  signed: "已签名",
  submitting: "提交中",
  succeeded: "已部署",
};
const terminalStates = new Set<HelperDeploymentState>(["succeeded", "failed"]);

function errorLabel(error: unknown): string {
  if (!(error instanceof HelperDeploymentRequestError)) return "Helper 部署请求失败";
  const labels: Record<string, string> = {
    CHAIN_NOT_ALLOWED: "本地链当前不可用",
    HELPER_ADDRESS_OCCUPIED: "预计地址已存在不匹配合约",
    HELPER_ALREADY_ACTIVE: "当前钱包已有本地 Helper",
    HELPER_CODE_IDENTITY_MISMATCH: "本地依赖合约校验失败",
    HELPER_DEPLOYMENT_IN_PROGRESS: "当前钱包已有部署操作进行中",
    HELPER_DEPLOYMENT_NOT_FOUND: "部署操作不存在",
    HELPER_DEPLOYMENT_RESPONSE_INVALID: "部署状态响应不可信",
    HELPER_DEPLOYMENT_UNAVAILABLE: "部署服务暂时不可用",
    IDEMPOTENCY_CONFLICT: "重复提交内容冲突",
    NETWORK_ERROR: "提交结果未知，正在保留现有状态",
    NONCE_DRIFT: "钱包 nonce 已变化，请重新预览",
    NONCE_RECONCILIATION_REQUIRED: "钱包 nonce 需要对账",
    PREVIEW_CHANGED: "Registry、code hash 或 gas 已变化",
    PREVIEW_EXPIRED: "部署预览已过期",
    PREVIEW_INVALID: "部署预览无效",
    REGISTRY_MISMATCH: "本地 Registry 校验失败",
    WALLET_LOCKED: "钱包尚未解锁",
    WALLET_NOT_FOUND: "钱包不存在或不属于当前账户",
  };
  return labels[error.code] ?? "Helper 部署请求失败";
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function OperationFacts({ operation }: { operation: HelperDeploymentOperation }) {
  const active = operation.transactions.find(({ active }) => active) ?? null;
  return (
    <dl className="helper-deployment-facts" data-testid="helper-deployment-operation">
      <div>
        <dt>预计地址</dt>
        <dd>
          <code>{operation.expectedAddress}</code>
        </dd>
      </div>
      <div>
        <dt>Nonce</dt>
        <dd>
          <code>{operation.nonce}</code>
        </dd>
      </div>
      <div>
        <dt>Operation</dt>
        <dd>
          <code>{operation.operationId}</code>
        </dd>
      </div>
      <div>
        <dt>交易</dt>
        <dd>
          <code>{active?.transactionHash ? shortHash(active.transactionHash) : "--"}</code>
        </dd>
      </div>
      <div>
        <dt>Registry</dt>
        <dd>{operation.registryVersion}</dd>
      </div>
      <div>
        <dt>状态</dt>
        <dd>{stateLabels[operation.state]}</dd>
      </div>
      {operation.failureCode || operation.reconciliationReason ? (
        <div className="helper-deployment-failure">
          <dt>原因</dt>
          <dd>{operation.failureCode ?? operation.reconciliationReason}</dd>
        </div>
      ) : null}
    </dl>
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
  preview: HelperDeploymentPreview | null;
  restoreFocus(): void;
  secondsLeft: number;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog helper-deploy-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>部署本地 Helper</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭 Helper 部署预览"
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
            <div className="helper-deploy-preview" data-testid="helper-deployment-preview">
              <div className="helper-deploy-network">
                <ServerCog aria-hidden="true" size={17} />
                <strong>Local Anvil</strong>
                <code>31337</code>
                <span>0 value</span>
              </div>
              <dl className="helper-deployment-facts">
                <div>
                  <dt>预计地址</dt>
                  <dd>
                    <code>{preview.expectedAddress}</code>
                  </dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>
                    <code>{preview.constructor.owner}</code>
                  </dd>
                </div>
                <div>
                  <dt>Adapter</dt>
                  <dd>
                    <code>{preview.constructor.adapter}</code>
                  </dd>
                </div>
                <div>
                  <dt>Permit2</dt>
                  <dd>
                    <code>{preview.constructor.permit2}</code>
                  </dd>
                </div>
                <div>
                  <dt>Nonce</dt>
                  <dd>
                    <code>{preview.nonce}</code>
                  </dd>
                </div>
                <div>
                  <dt>Gas 上限</dt>
                  <dd>
                    <code>{preview.feeLimit.gasLimit}</code>
                  </dd>
                </div>
                <div>
                  <dt>最大费用</dt>
                  <dd>
                    <code>{preview.feeLimit.feeCapBaseUnit} wei</code>
                  </dd>
                </div>
                <div>
                  <dt>Runtime hash</dt>
                  <dd>
                    <code>{preview.expectedRuntimeCodeHash}</code>
                  </dd>
                </div>
              </dl>
              <p className="helper-deploy-expiry" role="status">
                <Clock3 aria-hidden="true" size={15} />
                {secondsLeft > 0 ? `${secondsLeft} 秒后过期` : "预览已过期"}
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="wallet-read-error helper-deployment-error" role="alert">
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
              disabled={busy || !preview || secondsLeft <= 0}
              onClick={onConfirm}
              type="button"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
              ) : (
                <ShieldCheck aria-hidden="true" size={16} />
              )}
              {busy ? "正在提交" : "确认部署"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function HelperDeploymentPanel({ wallet }: { wallet: CustodyWallet }) {
  const client = useMemo(() => new HelperDeploymentClient(), []);
  const trigger = useRef<HTMLButtonElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<HelperDeploymentOperation | null>(null);
  const [preview, setPreview] = useState<HelperDeploymentPreview | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [state, setState] = useState<PanelState>("idle");

  useEffect(() => {
    if (!preview || !dialogOpen) return;
    const update = () =>
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(preview.expiresAt).getTime() - Date.now()) / 1_000)),
      );
    update();
    const timer = window.setInterval(update, 1_000);
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
        setError(null);
        if (!terminalStates.has(next.state)) timer = window.setTimeout(poll, 1_000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(errorLabel(failure));
        timer = window.setTimeout(poll, 2_000);
      }
    };
    timer = window.setTimeout(poll, 1_000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [client, operation]);

  const openPreview = useCallback(async () => {
    setError(null);
    setState("previewing");
    try {
      const next = await client.preview({
        chainId: 31_337,
        helperVersion: "WalletHelperV1",
        walletId: wallet.walletId,
      });
      setPreview(next);
      setSecondsLeft(
        Math.max(0, Math.ceil((new Date(next.expiresAt).getTime() - Date.now()) / 1_000)),
      );
      setState("preview-ready");
      setDialogOpen(true);
    } catch (failure) {
      setError(errorLabel(failure));
      setState("idle");
    }
  }, [client, wallet.walletId]);

  const submit = async () => {
    if (!preview || secondsLeft <= 0) return;
    setError(null);
    setState("submitting");
    try {
      const next = await client.submit(
        {
          chainId: 31_337,
          helperVersion: "WalletHelperV1",
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId: wallet.walletId,
        },
        `helper-deploy-${crypto.randomUUID()}`,
      );
      setOperation(next);
      setState(next.state);
      setDialogOpen(false);
      setPreview(null);
    } catch (failure) {
      setError(errorLabel(failure));
      setState("preview-ready");
    }
  };

  const busy = state === "previewing" || state === "submitting";
  return (
    <>
      <section
        aria-busy={busy}
        aria-labelledby={`helper-deployment-title-${wallet.walletId}`}
        className="wallet-read-section helper-deployment-section"
        data-state={state}
        data-testid="helper-deployment-panel"
      >
        <div className="wallet-read-heading">
          <div>
            <ServerCog aria-hidden="true" size={18} />
            <h2 id={`helper-deployment-title-${wallet.walletId}`}>本地 Helper 部署</h2>
            <span className="read-state-badge" data-state={state}>
              {stateLabels[state]}
            </span>
          </div>
          {!operation || operation.state === "failed" ? (
            <button
              className="primary-button helper-deploy-trigger"
              disabled={busy || wallet.lockStatus !== "ready"}
              onClick={() => void openPreview()}
              ref={trigger}
              type="button"
            >
              {state === "previewing" ? (
                <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
              ) : (
                <PackagePlus aria-hidden="true" size={16} />
              )}
              {operation?.state === "failed" ? "重新预览" : "部署 Helper"}
            </button>
          ) : null}
        </div>
        {!operation && !busy ? (
          <div className="helper-deployment-empty" role="status">
            <PackagePlus aria-hidden="true" size={17} />
            <p>当前钱包没有本地 Helper 实例</p>
          </div>
        ) : null}
        {state === "previewing" ? (
          <div className="helper-deployment-empty" role="status">
            <LoaderCircle aria-hidden="true" className="spin-icon" size={17} />
            <p>正在生成部署预览</p>
          </div>
        ) : null}
        {operation ? <OperationFacts operation={operation} /> : null}
        {operation?.state === "succeeded" ? (
          <p className="helper-deployment-success" role="status">
            <CheckCircle2 aria-hidden="true" size={17} />
            Helper runtime 与 constructor 身份已验证
          </p>
        ) : null}
        {error && !dialogOpen ? (
          <p className="wallet-read-error helper-deployment-error" role="alert">
            <CircleAlert aria-hidden="true" size={16} />
            {error}
          </p>
        ) : null}
      </section>
      <PreviewDialog
        busy={state === "submitting"}
        error={error}
        onConfirm={() => void submit()}
        onOpenChange={(open) => {
          if (!open && state !== "submitting") {
            setDialogOpen(false);
            setPreview(null);
            if (!operation) setState("idle");
          } else if (open) {
            setDialogOpen(true);
          }
        }}
        open={dialogOpen}
        preview={preview}
        restoreFocus={() => trigger.current?.focus()}
        secondsLeft={secondsLeft}
      />
    </>
  );
}
