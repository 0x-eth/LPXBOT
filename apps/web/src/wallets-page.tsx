import type {
  CustodyWallet,
  KeystoreStatus,
  WalletDeletePreview,
  WalletDeletionReceipt,
  WalletEncryptionMode,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRightLeft,
  CircleAlert,
  Download,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { KeystoreClient } from "./keystore-client";
import { WalletClient, WalletRequestError } from "./wallet-client";

type WalletPageStatus =
  | "duplicate"
  | "conflict"
  | "delete-blocked"
  | "deleted"
  | "deleting"
  | "empty"
  | "error"
  | "generate-pending"
  | "import-validating"
  | "loading"
  | "preview-expired"
  | "reauth-required"
  | "ready"
  | "signer-unavailable";

const scalarOrder = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

function validPrivateKey(value: string): boolean {
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/u.test(value)) return false;
  const scalar = BigInt(`0x${value.startsWith("0x") ? value.slice(2) : value}`);
  return scalar > 0n && scalar < scalarOrder;
}

function validWalletName(value: string): boolean {
  return (
    [...value].length >= 1 &&
    [...value].length <= 80 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

function stateForError(error: unknown): WalletPageStatus {
  if (!(error instanceof WalletRequestError)) return "error";
  if (error.code === "WALLET_ADDRESS_EXISTS") return "duplicate";
  if (error.code === "REAUTH_REQUIRED") return "reauth-required";
  if (error.code === "SIGNER_UNAVAILABLE") return "signer-unavailable";
  return "error";
}

const errorLabels: Partial<Record<WalletPageStatus, string>> = {
  conflict: "钱包版本已变化，请刷新后重试",
  "delete-blocked": "当前依赖阻止普通删除",
  duplicate: "该地址已由当前账户托管",
  error: "钱包请求失败",
  "reauth-required": "需要重新验证身份",
  "preview-expired": "删除预览已过期，请重新预览",
  "signer-unavailable": "签名服务暂时不可用",
};

function WalletState({ status }: { status: WalletPageStatus }) {
  if (status === "deleted") {
    return (
      <div className="wallet-page-state wallet-page-success" data-state={status} role="status">
        <ShieldCheck aria-hidden="true" size={19} />
        <p>钱包已彻底删除</p>
      </div>
    );
  }
  const label = errorLabels[status];
  if (!label) return null;
  return (
    <div className="wallet-page-state wallet-page-error" data-state={status} role="alert">
      <CircleAlert aria-hidden="true" size={19} />
      <p>{label}</p>
    </div>
  );
}

function walletRequestLabel(error: unknown, action: "generate" | "import" | "switch"): string {
  if (!(error instanceof WalletRequestError))
    return `${action === "generate" ? "生成" : action === "import" ? "导入" : "切换"}失败`;
  switch (error.code) {
    case "WALLET_ADDRESS_EXISTS":
      return "该地址已由当前账户托管";
    case "REAUTH_REQUIRED":
      return "需要重新验证身份";
    case "SIGNER_UNAVAILABLE":
      return "签名服务暂时不可用";
    case "INVALID_CREDENTIALS":
      return "Keystore 密码不正确";
    case "LOCKED_OUT":
      return "尝试次数过多，请稍后重试";
    case "REVISION_CONFLICT":
    case "SECRET_VERSION_CONFLICT":
      return "钱包或密码版本已变化，请刷新后重试";
    default:
      return `${action === "generate" ? "生成" : action === "import" ? "导入" : "切换"}失败`;
  }
}

function walletLifecycleLabel(error: unknown): string {
  if (!(error instanceof WalletRequestError)) return "钱包请求失败";
  switch (error.code) {
    case "CONFIRMATION_MISMATCH":
      return "确认短语不一致";
    case "DELETE_BLOCKED":
      return "当前依赖阻止删除";
    case "PREVIEW_CHANGED":
      return "钱包依赖已变化，请重新预览";
    case "PREVIEW_EXPIRED":
      return "删除预览已过期，请重新预览";
    case "REAUTH_REQUIRED":
      return "需要重新验证身份";
    case "REVISION_CONFLICT":
      return "钱包版本已变化，请刷新后重试";
    case "SIGNER_UNAVAILABLE":
      return "签名服务暂时不可用";
    default:
      return "钱包请求失败";
  }
}

function lifecycleStateForError(error: unknown): WalletPageStatus {
  if (!(error instanceof WalletRequestError)) return "error";
  if (error.code === "REVISION_CONFLICT") return "conflict";
  if (error.code === "DELETE_BLOCKED") return "delete-blocked";
  if (error.code === "PREVIEW_EXPIRED" || error.code === "PREVIEW_CHANGED") {
    return "preview-expired";
  }
  if (error.code === "REAUTH_REQUIRED") return "reauth-required";
  if (error.code === "SIGNER_UNAVAILABLE") return "signer-unavailable";
  return "error";
}

function WalletModeControl({
  configured,
  mode,
  onChange,
}: {
  configured: boolean;
  mode: WalletEncryptionMode;
  onChange(mode: WalletEncryptionMode): void;
}) {
  return (
    <div className="wallet-mode-field">
      <span id="wallet-mode-label">加密模式</span>
      <div
        aria-labelledby="wallet-mode-label"
        className="segmented-control wallet-mode-options"
        role="radiogroup"
      >
        <button
          aria-checked={mode === "server-kek"}
          className="segmented-option"
          onClick={() => onChange("server-kek")}
          role="radio"
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={14} />
          服务器密钥
        </button>
        <button
          aria-checked={mode === "user-password"}
          className="segmented-option"
          disabled={!configured}
          onClick={() => onChange("user-password")}
          role="radio"
          type="button"
        >
          <KeyRound aria-hidden="true" size={14} />
          用户密码
        </button>
      </div>
    </div>
  );
}

function WalletRecord({
  actionsDisabled,
  onDelete,
  onRename,
  onSwitch,
  switchDisabled,
  wallet,
}: {
  actionsDisabled: boolean;
  onDelete(wallet: CustodyWallet, trigger: HTMLButtonElement): void;
  onRename(wallet: CustodyWallet, trigger: HTMLButtonElement): void;
  onSwitch(wallet: CustodyWallet, trigger: HTMLButtonElement): void;
  switchDisabled: boolean;
  wallet: CustodyWallet;
}) {
  const custodyLabel =
    wallet.lockStatus === "ready" ? "已托管" : wallet.lockStatus === "locked" ? "已锁定" : "已隔离";
  const modeLabel = wallet.mode === "server-kek" ? "服务器密钥" : "用户密码";
  return (
    <li className="wallet-record">
      <div className="wallet-record-icon" aria-hidden="true">
        <WalletCards size={20} />
      </div>
      <div className="wallet-record-identity">
        <strong>{wallet.name}</strong>
        <code>{wallet.address}</code>
      </div>
      <div className="wallet-record-facts">
        <span className="wallet-mode-badge">
          <KeyRound aria-hidden="true" size={13} />
          {modeLabel}
        </span>
        <span className="wallet-custody-badge" data-status={wallet.lockStatus}>
          {wallet.lockStatus === "locked" ? (
            <LockKeyhole aria-hidden="true" size={13} />
          ) : (
            <ShieldCheck aria-hidden="true" size={13} />
          )}
          {custodyLabel}
        </span>
        <button
          aria-label={`切换 ${wallet.name} 加密模式`}
          className="icon-button tooltip-control wallet-mode-switch"
          data-tooltip="切换加密模式"
          disabled={switchDisabled}
          onClick={(event) => onSwitch(wallet, event.currentTarget)}
          type="button"
        >
          <ArrowRightLeft aria-hidden="true" size={15} />
        </button>
        <button
          aria-label={`重命名 ${wallet.name}`}
          className="icon-button tooltip-control wallet-rename"
          data-tooltip="重命名"
          disabled={actionsDisabled}
          onClick={(event) => onRename(wallet, event.currentTarget)}
          type="button"
        >
          <Pencil aria-hidden="true" size={15} />
        </button>
        <button
          aria-label={`删除 ${wallet.name}`}
          className="icon-button tooltip-control wallet-delete"
          data-tooltip="删除"
          disabled={actionsDisabled}
          onClick={(event) => onDelete(wallet, event.currentTarget)}
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      </div>
    </li>
  );
}

function ImportWalletDialog({
  client,
  keystoreConfigured,
  onCreated,
  onFailure,
  onPending,
  open,
  setOpen,
  trigger,
}: {
  client: WalletClient;
  keystoreConfigured: boolean;
  onCreated(wallet: CustodyWallet): void;
  onFailure(error: unknown): void;
  onPending(): void;
  open: boolean;
  setOpen(open: boolean): void;
  trigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WalletEncryptionMode>("server-kek");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setPrivateKey("");
    setPassword("");
    setMode("server-kek");
    setName("");
    setError(null);
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const secret = privateKey;
    const keystorePassword = password;
    setPrivateKey("");
    setPassword("");
    setError(null);
    onPending();
    if (!validPrivateKey(secret)) {
      setError("私钥格式无效");
      setSubmitting(false);
      onFailure(new WalletRequestError("INVALID_PRIVATE_KEY", false, 400));
      return;
    }
    if (mode === "user-password" && keystorePassword.length < 12) {
      setError("Keystore 密码至少需要 12 个字符");
      setSubmitting(false);
      onFailure(new WalletRequestError("INVALID_CREDENTIALS", false, 400));
      return;
    }
    setSubmitting(true);
    try {
      const wallet = await client.importWallet(
        mode === "user-password"
          ? {
              mode,
              name: name.trim() || "Imported wallet",
              password: keystorePassword,
              privateKey: secret,
            }
          : { mode, name: name.trim() || "Imported wallet", privateKey: secret },
      );
      reset();
      setOpen(false);
      onCreated(wallet);
    } catch (requestError) {
      setError(walletRequestLabel(requestError, "import"));
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>导入钱包</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭导入钱包"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="wallet-import-name">
              <span>钱包名称</span>
              <input
                autoComplete="off"
                id="wallet-import-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <label htmlFor="wallet-import-secret">
              <span>私钥</span>
              <input
                autoCapitalize="none"
                autoComplete="new-password"
                id="wallet-import-secret"
                onChange={(event) => setPrivateKey(event.target.value)}
                spellCheck={false}
                type="password"
                value={privateKey}
              />
            </label>
            <WalletModeControl configured={keystoreConfigured} mode={mode} onChange={setMode} />
            {mode === "user-password" ? (
              <label htmlFor="wallet-import-password">
                <span>Keystore 密码</span>
                <input
                  autoComplete="current-password"
                  id="wallet-import-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <div className="wallet-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={submitting} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <Download aria-hidden="true" size={16} />
                )}
                确认导入
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GenerateWalletDialog({
  client,
  keystoreConfigured,
  onCreated,
  onFailure,
  onPending,
  open,
  setOpen,
  trigger,
}: {
  client: WalletClient;
  keystoreConfigured: boolean;
  onCreated(wallet: CustodyWallet): void;
  onFailure(error: unknown): void;
  onPending(): void;
  open: boolean;
  setOpen(open: boolean): void;
  trigger: React.RefObject<HTMLButtonElement | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WalletEncryptionMode>("server-kek");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const keystorePassword = password;
    setPassword("");
    setError(null);
    if (mode === "user-password" && keystorePassword.length < 12) {
      setError("Keystore 密码至少需要 12 个字符");
      onFailure(new WalletRequestError("INVALID_CREDENTIALS", false, 400));
      return;
    }
    setSubmitting(true);
    onPending();
    try {
      const wallet = await client.generateWallet(
        mode === "user-password"
          ? {
              mode,
              name: name.trim() || "Generated wallet",
              password: keystorePassword,
            }
          : { mode, name: name.trim() || "Generated wallet" },
      );
      setName("");
      setMode("server-kek");
      setSubmitting(false);
      setOpen(false);
      onCreated(wallet);
    } catch (requestError) {
      setError(walletRequestLabel(requestError, "generate"));
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setPassword("");
          setMode("server-kek");
          setError(null);
          setSubmitting(false);
        }
        setOpen(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>生成钱包</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭生成钱包"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="wallet-generate-name">
              <span>钱包名称</span>
              <input
                autoComplete="off"
                id="wallet-generate-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            <WalletModeControl configured={keystoreConfigured} mode={mode} onChange={setMode} />
            {mode === "user-password" ? (
              <label htmlFor="wallet-generate-password">
                <span>Keystore 密码</span>
                <input
                  autoComplete="current-password"
                  id="wallet-generate-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <div className="wallet-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={submitting} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <Plus aria-hidden="true" size={16} />
                )}
                确认生成
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModeSwitchDialog({
  client,
  keystoreVersion,
  onChanged,
  onFailure,
  onOpenChange,
  open,
  trigger,
  wallet,
}: {
  client: WalletClient;
  keystoreVersion: number;
  onChanged(wallet: CustodyWallet): void;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  wallet: CustodyWallet | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setError(null);
    setPassword("");
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!wallet) return;
    const secret = password;
    setPassword("");
    setError(null);
    if (secret.length < 12) {
      setError("Keystore 密码至少需要 12 个字符");
      return;
    }
    setSubmitting(true);
    try {
      const changed = await client.changeEncryptionMode(wallet.walletId, {
        expectedRevision: wallet.revision,
        expectedSecretVersion: keystoreVersion,
        mode: wallet.mode === "server-kek" ? "user-password" : "server-kek",
        password: secret,
      });
      reset();
      onOpenChange(false);
      onChanged(changed);
    } catch (requestError) {
      setError(walletRequestLabel(requestError, "switch"));
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  const targetLabel = wallet?.mode === "server-kek" ? "用户密码" : "服务器密钥";

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>切换加密模式</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭切换加密模式"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            <div className="wallet-mode-field">
              <span>目标模式</span>
              <strong>
                <ArrowRightLeft aria-hidden="true" size={15} />
                {targetLabel}
              </strong>
            </div>
            <label htmlFor="wallet-mode-password">
              <span>Keystore 密码</span>
              <input
                autoComplete="current-password"
                autoFocus
                id="wallet-mode-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <div className="wallet-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={submitting} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <ArrowRightLeft aria-hidden="true" size={16} />
                )}
                确认切换
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenameWalletDialog({
  client,
  onChanged,
  onFailure,
  onOpenChange,
  open,
  trigger,
  wallet,
}: {
  client: WalletClient;
  onChanged(wallet: CustodyWallet): void;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  open: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  wallet: CustodyWallet | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setName(wallet?.name ?? "");
  }, [open, wallet]);

  const reset = () => {
    setError(null);
    setName("");
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!wallet) return;
    setError(null);
    if (!validWalletName(name)) {
      setError("钱包名称需为 1 至 80 个字符，且首尾不能有空白");
      return;
    }
    setSubmitting(true);
    try {
      const renamed = await client.rename(wallet.walletId, {
        expectedRevision: wallet.revision,
        name,
      });
      reset();
      onOpenChange(false);
      onChanged(renamed);
    } catch (requestError) {
      setError(walletLifecycleLabel(requestError));
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>重命名钱包</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭重命名钱包"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="wallet-rename-name">
              <span>钱包名称</span>
              <input
                autoComplete="off"
                autoFocus
                id="wallet-rename-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <div className="wallet-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={submitting} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <Pencil aria-hidden="true" size={15} />
                )}
                保存名称
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteRiskSummary({ preview }: { preview: WalletDeletePreview }) {
  return (
    <div aria-label="删除风险计数" className="wallet-delete-risk-summary">
      <strong>任务 {preview.taskCount}</strong>
      <strong>策略 {preview.policyCount}</strong>
      <strong>非零资产 {preview.assetCount}</strong>
      <strong>仓位 {preview.positionCount}</strong>
    </div>
  );
}

function DeletePreviewDialog({
  client,
  error,
  onDeleted,
  onFailure,
  onForce,
  onOpenChange,
  onState,
  open,
  preview,
  trigger,
  wallet,
}: {
  client: WalletClient;
  error: string | null;
  onDeleted(receipt: WalletDeletionReceipt): void;
  onFailure(error: unknown): void;
  onForce(): void;
  onOpenChange(open: boolean): void;
  onState(status: WalletPageStatus): void;
  open: boolean;
  preview: WalletDeletePreview | null;
  trigger: React.RefObject<HTMLButtonElement | null>;
  wallet: CustodyWallet | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const dependencyCount = preview
    ? preview.assetCount + preview.policyCount + preview.positionCount + preview.taskCount
    : 0;

  const submit = async () => {
    if (!wallet || !preview) return;
    setSubmitting(true);
    onState("deleting");
    try {
      const receipt = await client.deleteWallet(wallet.walletId, {
        expectedRevision: preview.revision,
        force: false,
        previewToken: preview.previewToken,
      });
      setSubmitting(false);
      onOpenChange(false);
      onDeleted(receipt);
    } catch (requestError) {
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) setSubmitting(false);
        onOpenChange(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog wallet-delete-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>删除钱包预览</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭删除钱包预览"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                disabled={submitting}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          {!preview && !error ? (
            <div aria-label="正在生成删除预览" className="wallet-preview-loading" role="status">
              <LoaderCircle aria-hidden="true" className="spin-icon" size={18} />
              正在生成删除预览
            </div>
          ) : null}
          {preview ? (
            <div className="wallet-delete-preview-body">
              <div className="wallet-delete-target">
                <strong>{wallet?.name}</strong>
                <code>{wallet?.address}</code>
              </div>
              <DeleteRiskSummary preview={preview} />
              {dependencyCount > 0 ? (
                <p className="wallet-delete-warning">
                  <ShieldAlert aria-hidden="true" size={16} />
                  普通删除已被当前依赖阻止
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="wallet-delete-error" role="alert">{error}</p> : null}
          <div className="wallet-dialog-actions">
            <Dialog.Close asChild>
              <button className="secondary-button" disabled={submitting} type="button">
                取消
              </button>
            </Dialog.Close>
            {preview && dependencyCount === 0 ? (
              <button
                aria-label={submitting ? "正在删除" : "确认删除"}
                className="danger-command"
                disabled={submitting}
                onClick={() => void submit()}
                type="button"
              >
                {submitting ? (
                  <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                ) : (
                  <Trash2 aria-hidden="true" size={15} />
                )}
                {submitting ? "正在删除" : "确认删除"}
              </button>
            ) : null}
            {preview && dependencyCount > 0 && preview.forceEligible ? (
              <button className="danger-command" onClick={onForce} type="button">
                <ShieldAlert aria-hidden="true" size={15} />
                继续强制删除
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DependencyInventory({ preview }: { preview: WalletDeletePreview }) {
  const groups = [
    ["任务", preview.dependencies.taskIds],
    ["策略", preview.dependencies.policyIds],
    ["非零资产", preview.dependencies.assetIds],
    ["仓位", preview.dependencies.positionIds],
  ] as const;
  return (
    <div aria-label="完整依赖清单" className="wallet-dependency-inventory">
      {groups.map(([label, values]) => (
        <div key={label}>
          <strong>{label}</strong>
          {values.length === 0 ? <span>无</span> : values.map((value) => <code key={value}>{value}</code>)}
        </div>
      ))}
    </div>
  );
}

function ForceDeleteDialog({
  client,
  error,
  onDeleted,
  onFailure,
  onOpenChange,
  onState,
  open,
  preview,
  trigger,
  wallet,
}: {
  client: WalletClient;
  error: string | null;
  onDeleted(receipt: WalletDeletionReceipt): void;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  onState(status: WalletPageStatus): void;
  open: boolean;
  preview: WalletDeletePreview | null;
  trigger: React.RefObject<HTMLButtonElement | null>;
  wallet: CustodyWallet | null;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setConfirmation("");
    setLocalError(null);
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!wallet || !preview) return;
    const phrase = confirmation;
    setConfirmation("");
    setLocalError(null);
    if (phrase !== preview.confirmationPhrase) {
      setLocalError("确认短语不一致");
      return;
    }
    setSubmitting(true);
    onState("deleting");
    try {
      const receipt = await client.deleteWallet(wallet.walletId, {
        confirmationPhrase: phrase,
        dependencies: preview.dependencies,
        expectedRevision: preview.revision,
        force: true,
        previewToken: preview.previewToken,
      });
      reset();
      onOpenChange(false);
      onDeleted(receipt);
    } catch (requestError) {
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog wallet-delete-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>强制删除钱包</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭强制删除钱包"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                disabled={submitting}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          {preview ? (
            <form className="wallet-form" onSubmit={(event) => void submit(event)}>
              <DeleteRiskSummary preview={preview} />
              <DependencyInventory preview={preview} />
              <label htmlFor="wallet-force-confirmation">
                <span>输入确认短语</span>
                <code>{preview.confirmationPhrase}</code>
                <input
                  autoCapitalize="characters"
                  autoComplete="off"
                  autoFocus
                  id="wallet-force-confirmation"
                  onChange={(event) => setConfirmation(event.target.value)}
                  spellCheck={false}
                  value={confirmation}
                />
              </label>
              {localError || error ? (
                <p className="wallet-delete-error" role="alert">
                  {localError ?? error}
                </p>
              ) : null}
              <div className="wallet-dialog-actions">
                <Dialog.Close asChild>
                  <button className="secondary-button" disabled={submitting} type="button">
                    取消
                  </button>
                </Dialog.Close>
                <button className="danger-command" disabled={submitting} type="submit">
                  {submitting ? (
                    <LoaderCircle aria-hidden="true" className="spin-icon" size={16} />
                  ) : (
                    <Trash2 aria-hidden="true" size={15} />
                  )}
                  强制删除
                </button>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WalletsPage() {
  const client = useMemo(() => new WalletClient(), []);
  const keystoreClient = useMemo(() => new KeystoreClient(), []);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [keystoreStatus, setKeystoreStatus] = useState<KeystoreStatus>({
    configured: false,
    status: "unconfigured",
    version: 0,
  });
  const [modeSwitchOpen, setModeSwitchOpen] = useState(false);
  const [status, setStatus] = useState<WalletPageStatus>("loading");
  const [switchingWallet, setSwitchingWallet] = useState<CustodyWallet | null>(null);
  const [wallets, setWallets] = useState<CustodyWallet[]>([]);
  const generateTrigger = useRef<HTMLButtonElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const modeSwitchTrigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const page = await client.list(signal);
        setWallets(page.items);
        setStatus(page.items.length === 0 ? "empty" : "ready");
      } catch (error) {
        if (signal?.aborted) return;
        setStatus(stateForError(error));
      }
    },
    [client],
  );

  const loadKeystore = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setKeystoreStatus(await keystoreClient.status(signal));
      } catch {
        // Wallet metadata remains usable when Keystore status is temporarily unavailable.
      }
    },
    [keystoreClient],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadKeystore(controller.signal);
    });
    void client.list(controller.signal).then(
      (page) => {
        setWallets(page.items);
        setStatus(page.items.length === 0 ? "empty" : "ready");
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus(stateForError(error));
      },
    );
    return () => controller.abort();
  }, [client, loadKeystore]);

  const created = (wallet: CustodyWallet) => {
    setWallets((current) => [
      wallet,
      ...current.filter(({ walletId }) => walletId !== wallet.walletId),
    ]);
    setStatus("ready");
  };

  const changed = (wallet: CustodyWallet) => {
    setWallets((current) =>
      current.map((candidate) => (candidate.walletId === wallet.walletId ? wallet : candidate)),
    );
    setSwitchingWallet(null);
    setStatus("ready");
  };

  return (
    <main className="workspace wallets-workspace" data-state={status}>
      <div className="wallets-heading">
        <div>
          <p className="eyebrow">Custody</p>
          <h1>钱包</h1>
        </div>
        <div className="wallets-actions">
          <button
            aria-label="刷新钱包"
            className="icon-button tooltip-control"
            data-tooltip="刷新"
            disabled={status === "loading"}
            onClick={() => {
              setStatus("loading");
              void load();
              void loadKeystore();
            }}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={status === "loading" ? "spin-icon" : undefined}
              size={18}
            />
          </button>
          <button
            className="secondary-button"
            onClick={() => setImportOpen(true)}
            ref={importTrigger}
            type="button"
          >
            <Download aria-hidden="true" size={16} />
            导入钱包
          </button>
          <button
            className="primary-button"
            onClick={() => setGenerateOpen(true)}
            ref={generateTrigger}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            生成钱包
          </button>
        </div>
      </div>

      {status === "loading" ? (
        <div aria-label="正在加载钱包" className="wallet-page-state" role="status">
          <span aria-hidden="true" className="spinner spinner-small" />
          <p>正在加载钱包</p>
        </div>
      ) : null}
      {status === "empty" ? (
        <div className="wallet-page-state" role="status">
          <WalletCards aria-hidden="true" size={22} />
          <p>还没有托管钱包</p>
        </div>
      ) : null}
      {!importOpen && !generateOpen && !modeSwitchOpen ? <WalletState status={status} /> : null}
      {wallets.length > 0 ? (
        <ul aria-label="托管钱包" className="wallet-list">
          {wallets.map((wallet) => (
            <WalletRecord
              key={wallet.walletId}
              onSwitch={(selected, trigger) => {
                modeSwitchTrigger.current = trigger;
                setSwitchingWallet(selected);
                setModeSwitchOpen(true);
              }}
              switchDisabled={!keystoreStatus.configured}
              wallet={wallet}
            />
          ))}
        </ul>
      ) : null}

      <ImportWalletDialog
        client={client}
        keystoreConfigured={keystoreStatus.configured}
        onCreated={created}
        onFailure={(error) => setStatus(stateForError(error))}
        onPending={() => setStatus("import-validating")}
        open={importOpen}
        setOpen={setImportOpen}
        trigger={importTrigger}
      />
      <GenerateWalletDialog
        client={client}
        keystoreConfigured={keystoreStatus.configured}
        onCreated={created}
        onFailure={(error) => setStatus(stateForError(error))}
        onPending={() => setStatus("generate-pending")}
        open={generateOpen}
        setOpen={setGenerateOpen}
        trigger={generateTrigger}
      />
      <ModeSwitchDialog
        client={client}
        keystoreVersion={keystoreStatus.version}
        onChanged={changed}
        onFailure={(error) => setStatus(stateForError(error))}
        onOpenChange={(open) => {
          setModeSwitchOpen(open);
          if (!open) setSwitchingWallet(null);
        }}
        open={modeSwitchOpen}
        trigger={modeSwitchTrigger}
        wallet={switchingWallet}
      />
    </main>
  );
}
