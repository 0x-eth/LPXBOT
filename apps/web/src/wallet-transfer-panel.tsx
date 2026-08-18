import type {
  AddressBookEntry,
  CustodyWallet,
  EvmAddress,
  WalletAssetBalance,
  WalletTransferAmountPreset,
  WalletTransferOperation,
  WalletTransferPreview,
  WalletTransferState,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { WalletReadClient } from "./wallet-read-client";
import { WalletTransferClient, WalletTransferRequestError } from "./wallet-transfer-client";

const chainId = 56;
const baseUnitPattern = /^(?:0|[1-9][0-9]*)$/u;
const presets: readonly WalletTransferAmountPreset[] = ["25", "50", "75", "MAX"];
const activeStates = new Set<WalletTransferState>([
  "queued",
  "signed",
  "broadcast",
  "pending",
  "reconciling",
]);

const stateLabels: Record<WalletTransferState, string> = {
  broadcast: "已广播",
  confirmed: "已确认",
  dropped: "已丢弃",
  failed: "失败",
  pending: "确认中",
  queued: "等待签名",
  "ready-for-approval": "等待授权",
  reconciling: "对账中",
  replaced: "已替换",
  signed: "已签名",
};

const classificationLabels = {
  "known-external": "已知外部地址",
  "new-external": "新外部地址",
  "own-wallet": "自己的钱包",
} as const;

function normalizeAddress(value: string): EvmAddress | null {
  return /^0x[0-9a-fA-F]{40}$/u.test(value) ? (value.toLowerCase() as EvmAddress) : null;
}

function decimalFromBaseUnit(value: string, decimals: number): string {
  if (decimals === 0) return value;
  const padded = value.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/u, "");
  return fraction === "" ? padded.slice(0, -decimals) : `${padded.slice(0, -decimals)}.${fraction}`;
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function transferError(error: unknown): string {
  if (!(error instanceof WalletTransferRequestError)) return "转账请求失败";
  const labels: Record<string, string> = {
    CHAIN_NOT_ALLOWED: "当前账户不可访问该链",
    IDEMPOTENCY_CONFLICT: "提交键与原请求冲突，已停止再次提交",
    INVALID_CREDENTIALS: "安全密码不正确",
    LOCKED_OUT: "安全密码已暂时锁定",
    NETWORK_ERROR: "提交结果未知，已停止再次提交",
    PREVIEW_CHANGED: "策略、余额或 gas 已变化，请重新预览",
    PREVIEW_EXPIRED: "转账预览已过期，请重新预览",
    PREVIEW_INVALID: "转账预览无效，请重新预览",
    SECURITY_PASSWORD_REQUIRED: "新外部地址需要安全密码",
    TOKEN_FEE_ON_TRANSFER_UNSUPPORTED: "该 Token 不支持标准到账语义",
    TOKEN_NOT_FOUND: "Token registry 中不存在该资产",
    TRANSFER_ADDRESS_INVALID: "收款地址格式不正确",
    TRANSFER_AMOUNT_INVALID: "金额必须是规范的 base-unit 正整数字符串",
    TRANSFER_BALANCE_INSUFFICIENT: "资产余额不足",
    TRANSFER_GAS_INSUFFICIENT: "原生币不足以支付 gas",
    TRANSFER_NOT_FOUND: "转账记录不存在",
    TRANSFER_RESPONSE_INVALID: "转账状态响应不可信，已停止操作",
    TRANSFER_SELF_FORBIDDEN: "不允许向当前钱包自身转账",
    TRANSFER_UNAVAILABLE: "转账服务暂时不可用",
    WALLET_LOCKED: "钱包尚未解锁",
    WALLET_NOT_FOUND: "钱包不存在或不属于当前账户",
  };
  return labels[error.code] ?? "转账请求失败";
}

function PreviewSummary({ preview, secondsLeft }: { preview: WalletTransferPreview; secondsLeft: number }) {
  return (
    <div className="transfer-preview-summary" data-testid="transfer-preview-summary">
      <div className="transfer-expiry" data-expired={secondsLeft <= 0}>
        <Clock3 aria-hidden="true" size={15} />
        <span>{secondsLeft <= 0 ? "预览已过期" : `${secondsLeft} 秒后过期`}</span>
      </div>
      <dl>
        <div>
          <dt>到账金额</dt>
          <dd>
            <strong>{decimalFromBaseUnit(preview.amountBaseUnit, preview.asset.decimals)}</strong>
            <span>{preview.asset.symbol}</span>
            <code>{preview.amountBaseUnit} base units</code>
          </dd>
        </div>
        <div>
          <dt>地址分类</dt>
          <dd>{classificationLabels[preview.addressClassification]}</dd>
        </div>
        <div>
          <dt>Gas 上限</dt>
          <dd>
            <code>{preview.feeLimit.gasLimit}</code>
          </dd>
        </div>
        <div>
          <dt>Fee 上限</dt>
          <dd>
            <code>{preview.feeLimit.feeCapBaseUnit} base units</code>
          </dd>
        </div>
        <div>
          <dt>资产余额</dt>
          <dd>
            <code>
              {preview.balanceChange.assetBeforeBaseUnit} -&gt; {preview.balanceChange.assetAfterBaseUnit}
            </code>
          </dd>
        </div>
        <div>
          <dt>原生币最低余额</dt>
          <dd>
            <code>{preview.balanceChange.nativeAfterMinimumBaseUnit}</code>
          </dd>
        </div>
        <div>
          <dt>Registry / Policy</dt>
          <dd>
            <code>
              {preview.registryVersion} / {preview.policyVersion}
            </code>
          </dd>
        </div>
        <div>
          <dt>收款地址</dt>
          <dd>
            <code>{preview.recipient}</code>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function OperationView({
  operation,
  pollingError,
}: {
  operation: WalletTransferOperation;
  pollingError: string | null;
}) {
  const active = operation.transactions.find(({ active: isActive }) => isActive) ?? null;
  return (
    <div className="transfer-operation" data-operation-state={operation.state}>
      <div className="transfer-operation-state" role="status">
        {operation.state === "confirmed" ? (
          <CheckCircle2 aria-hidden="true" size={20} />
        ) : operation.state === "failed" || operation.state === "dropped" ? (
          <CircleAlert aria-hidden="true" size={20} />
        ) : (
          <LoaderCircle
            aria-hidden="true"
            className={activeStates.has(operation.state) ? "spin-icon" : undefined}
            size={20}
          />
        )}
        <div>
          <strong>{stateLabels[operation.state]}</strong>
          <code>{operation.operationId}</code>
        </div>
      </div>
      <dl className="transfer-operation-facts">
        <div>
          <dt>金额</dt>
          <dd>
            <code>{operation.amountBaseUnit} base units</code>
          </dd>
        </div>
        <div>
          <dt>Nonce</dt>
          <dd>{operation.nonce ?? "分配中"}</dd>
        </div>
        <div>
          <dt>Active head</dt>
          <dd>{active ? `第 ${active.generation + 1} 代` : "无"}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{new Date(operation.updatedAt).toLocaleTimeString()}</dd>
        </div>
      </dl>
      {operation.reconciliationReason ? (
        <p className="transfer-reconciliation" role="alert">
          <ShieldAlert aria-hidden="true" size={16} />
          {operation.reconciliationReason}
        </p>
      ) : null}
      {pollingError ? (
        <p className="transfer-reconciliation" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          {pollingError}
        </p>
      ) : null}
      <div className="transfer-lineage" aria-label="交易替换链">
        <h3>交易 lineage</h3>
        {operation.transactions.length === 0 ? (
          <p>等待签名交易</p>
        ) : (
          <ol>
            {[...operation.transactions]
              .sort((left, right) => left.generation - right.generation)
              .map((transaction) => (
                <li data-active={transaction.active} key={transaction.transactionId}>
                  <div>
                    <strong>第 {transaction.generation + 1} 代</strong>
                    {transaction.active ? <span>Active head</span> : null}
                    <span data-transaction-state={transaction.state}>
                      {stateLabels[transaction.state]}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Nonce</dt>
                      <dd>{transaction.nonce}</dd>
                    </div>
                    <div>
                      <dt>Max fee</dt>
                      <dd>{transaction.maxFeePerGasBaseUnit}</dd>
                    </div>
                    <div>
                      <dt>Priority</dt>
                      <dd>{transaction.maxPriorityFeePerGasBaseUnit}</dd>
                    </div>
                    <div>
                      <dt>Tx hash</dt>
                      <dd title={transaction.transactionHash ?? undefined}>
                        {transaction.transactionHash ? shortHash(transaction.transactionHash) : "待生成"}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function WalletTransferPanel({
  asset,
  readClient,
  transferClient,
  wallet,
}: {
  asset: WalletAssetBalance;
  readClient: WalletReadClient;
  transferClient: WalletTransferClient;
  wallet: CustodyWallet;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const recipientInput = useRef<HTMLInputElement>(null);
  const [amountBaseUnit, setAmountBaseUnit] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [operation, setOperation] = useState<WalletTransferOperation | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [preset, setPreset] = useState<WalletTransferAmountPreset | null>(null);
  const [preview, setPreview] = useState<WalletTransferPreview | null>(null);
  const [recipient, setRecipient] = useState("");
  const [securityPassword, setSecurityPassword] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const requestAsset = useMemo(
    () =>
      asset.assetType === "native"
        ? ({ kind: "native" } as const)
        : ({ kind: "erc20", tokenAddress: asset.tokenAddress! } as const),
    [asset.assetType, asset.tokenAddress],
  );

  const clearPreview = useCallback(() => {
    setPreview(null);
    setIdempotencyKey(null);
    setSecurityPassword("");
    setBlocked(false);
    setError(null);
  }, []);

  const loadAddressBook = useCallback(async () => {
    try {
      const page = await readClient.addressBook(chainId);
      setEntries(page.entries);
    } catch {
      setEntries([]);
    }
  }, [readClient]);

  useEffect(() => {
    if (!open || operation) return;
    queueMicrotask(() => void loadAddressBook());
  }, [loadAddressBook, open, operation]);

  useEffect(() => {
    if (!preview) return;
    const update = () => {
      setSecondsLeft(Math.max(0, Math.ceil((new Date(preview.expiresAt).getTime() - Date.now()) / 1_000)));
    };
    update();
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [preview]);

  useEffect(() => {
    if (!open || !operation || !activeStates.has(operation.state)) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const current = await transferClient.operation(operation.operationId, controller.signal);
        if (!controller.signal.aborted) {
          setOperation(current);
          setPollingError(null);
        }
      } catch (requestFailure) {
        if (!controller.signal.aborted) {
          setPollingError(transferError(requestFailure));
        }
      } finally {
        pending = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), 1_500);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [open, operation, transferClient]);

  const createPreview = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedRecipient = normalizeAddress(recipient);
    if (!normalizedRecipient) {
      setError("收款地址格式不正确");
      return;
    }
    if (preset === null && (!baseUnitPattern.test(amountBaseUnit) || amountBaseUnit === "0")) {
      setError("金额必须是规范的 base-unit 正整数字符串");
      return;
    }
    setPreviewing(true);
    setError(null);
    setBlocked(false);
    try {
      const result = await transferClient.preview({
        amount:
          preset === null
            ? { amountBaseUnit, kind: "exact" }
            : { kind: "preset", preset },
        asset: requestAsset,
        chainId,
        recipient: normalizedRecipient,
        walletId: wallet.walletId,
      });
      setPreview(result);
      setIdempotencyKey(crypto.randomUUID());
    } catch (requestFailure) {
      setError(transferError(requestFailure));
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview || !idempotencyKey || secondsLeft <= 0 || blocked) return;
    if (preview.requiresSecurityPassword && securityPassword === "") {
      setError("新外部地址需要安全密码");
      return;
    }
    setSubmitting(true);
    setError(null);
    const password = preview.requiresSecurityPassword ? securityPassword : undefined;
    setSecurityPassword("");
    try {
      const created = await transferClient.submit(
        {
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId: wallet.walletId,
        },
        idempotencyKey,
        password,
      );
      setOperation(created);
      setPreview(null);
      setIdempotencyKey(null);
      setPollingError(null);
    } catch (requestFailure) {
      const code =
        requestFailure instanceof WalletTransferRequestError ? requestFailure.code : "UNKNOWN";
      setError(transferError(requestFailure));
      if (
        code === "IDEMPOTENCY_CONFLICT" ||
        code === "NETWORK_ERROR" ||
        code === "TRANSFER_RESPONSE_INVALID"
      ) {
        setBlocked(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSecurityPassword("");
      }}
      open={open}
    >
      <Dialog.Trigger asChild>
        <button
          aria-label={`转账 ${asset.symbol}`}
          className="icon-button tooltip-control asset-transfer-button"
          data-tooltip="转账"
          disabled={wallet.lockStatus !== "ready"}
          ref={trigger}
          type="button"
        >
          <Send aria-hidden="true" size={15} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog transfer-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          onOpenAutoFocus={(event) => {
            if (operation) return;
            event.preventDefault();
            requestAnimationFrame(() => recipientInput.current?.focus());
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>转账 {asset.symbol}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭转账"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>

          {operation ? (
            <OperationView operation={operation} pollingError={pollingError} />
          ) : preview ? (
            <form className="transfer-review" onSubmit={(event) => void submit(event)}>
              <PreviewSummary preview={preview} secondsLeft={secondsLeft} />
              {preview.requiresSecurityPassword ? (
                <label>
                  <span>安全密码</span>
                  <input
                    aria-label="转账安全密码"
                    autoComplete="current-password"
                    maxLength={256}
                    onChange={(event) => setSecurityPassword(event.target.value)}
                    type="password"
                    value={securityPassword}
                  />
                </label>
              ) : null}
              {error ? (
                <p className="transfer-error" role="alert">
                  <CircleAlert aria-hidden="true" size={16} />
                  {error}
                </p>
              ) : null}
              <div className="wallet-dialog-actions">
                <button
                  className="secondary-button"
                  disabled={submitting}
                  onClick={clearPreview}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={15} />
                  返回
                </button>
                <button
                  className="primary-button"
                  disabled={
                    blocked ||
                    secondsLeft <= 0 ||
                    submitting ||
                    (preview.requiresSecurityPassword && securityPassword === "")
                  }
                  type="submit"
                >
                  {submitting ? (
                    <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                  ) : (
                    <Send aria-hidden="true" size={15} />
                  )}
                  确认转账
                </button>
              </div>
            </form>
          ) : (
            <form className="wallet-form transfer-form" onSubmit={(event) => void createPreview(event)}>
              <div className="transfer-wallet-summary">
                <span>{wallet.name}</span>
                <code>{wallet.address}</code>
                <strong>{asset.balanceBaseUnit} base units</strong>
              </div>
              <label>
                <span>地址簿</span>
                <select
                  aria-label="转账地址簿"
                  onChange={(event) => {
                    setRecipient(event.target.value);
                    clearPreview();
                  }}
                  value={entries.some(({ address }) => address === recipient) ? recipient : ""}
                >
                  <option value="">选择已知外部地址</option>
                  {entries.map((entry) => (
                    <option key={entry.entryId} value={entry.address}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>收款地址</span>
                <input
                  aria-label="转账收款地址"
                  autoComplete="off"
                  maxLength={42}
                  onChange={(event) => {
                    setRecipient(event.target.value);
                    clearPreview();
                  }}
                  placeholder="0x"
                  ref={recipientInput}
                  spellCheck={false}
                  value={recipient}
                />
              </label>
              <label>
                <span>金额（base unit）</span>
                <input
                  aria-label="转账金额（base unit）"
                  inputMode="numeric"
                  maxLength={160}
                  onChange={(event) => {
                    setAmountBaseUnit(event.target.value);
                    setPreset(null);
                    clearPreview();
                  }}
                  placeholder="0"
                  value={amountBaseUnit}
                />
              </label>
              <div className="transfer-preset-field">
                <span id={`transfer-preset-${asset.tokenAddress ?? "native"}`}>金额比例</span>
                <div
                  aria-labelledby={`transfer-preset-${asset.tokenAddress ?? "native"}`}
                  className="segmented-control transfer-presets"
                  role="group"
                >
                  {presets.map((value) => (
                    <button
                      aria-pressed={preset === value}
                      className="segmented-option"
                      key={value}
                      onClick={() => {
                        setPreset(value);
                        setAmountBaseUnit("");
                        clearPreview();
                      }}
                      type="button"
                    >
                      {value === "MAX" ? value : `${value}%`}
                    </button>
                  ))}
                </div>
              </div>
              {error ? (
                <p className="transfer-error" role="alert">
                  <CircleAlert aria-hidden="true" size={16} />
                  {error}
                </p>
              ) : null}
              <div className="wallet-dialog-actions">
                <Dialog.Close asChild>
                  <button className="secondary-button" disabled={previewing} type="button">
                    取消
                  </button>
                </Dialog.Close>
                <button
                  className="primary-button"
                  disabled={
                    previewing ||
                    normalizeAddress(recipient) === null ||
                    (preset === null &&
                      (!baseUnitPattern.test(amountBaseUnit) || amountBaseUnit === "0"))
                  }
                  type="submit"
                >
                  {previewing ? (
                    <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                  ) : (
                    <ShieldAlert aria-hidden="true" size={15} />
                  )}
                  预览转账
                </button>
              </div>
            </form>
          )}
          <div className="transfer-live-region" aria-live="polite" aria-atomic="true">
            {operation ? `转账状态：${stateLabels[operation.state]}` : error ?? ""}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
