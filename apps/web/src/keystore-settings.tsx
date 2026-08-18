import type { KeystoreResetPreview, KeystoreState, KeystoreStatus } from "@lpbot/api-contract";
import { keystoreAutoLockMinutes, keystoreResetConfirmationPhrase } from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TimerReset,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { KeystoreClient, KeystoreRequestError } from "./keystore-client";

type PasswordAction = "change" | "create" | "unlock";
type ViewState = KeystoreState | "conflict" | "error" | "loading" | "reset-preview";

const stateLabels: Record<KeystoreState, string> = {
  locked: "已锁定",
  "locked-out": "暂时锁定",
  unconfigured: "未设置",
  unlocked: "已解锁",
};

function requestLabel(error: unknown): string {
  if (!(error instanceof KeystoreRequestError)) return "Keystore 请求失败";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "密码不正确";
    case "LOCKED_OUT":
      return "尝试次数过多，请稍后重试";
    case "PASSWORD_POLICY_FAILED":
      return "密码至少需要 12 个 UTF-8 字节";
    case "SECRET_VERSION_CONFLICT":
      return "密码版本已变化，请刷新后重试";
    case "PREVIEW_CHANGED":
      return "重置内容已变化，请重新预览";
    case "PREVIEW_EXPIRED":
      return "重置预览已过期，请重新预览";
    default:
      return "Keystore 请求失败";
  }
}

function stateForError(error: unknown): ViewState {
  return error instanceof KeystoreRequestError && error.code === "SECRET_VERSION_CONFLICT"
    ? "conflict"
    : "error";
}

function PasswordDialog({
  action,
  client,
  onFailure,
  onOpenChange,
  onSuccess,
  returnFocus,
  version,
}: {
  action: PasswordAction | null;
  client: KeystoreClient;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  onSuccess(status: KeystoreStatus): void;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
  version: number;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setConfirmation("");
    setError(null);
    setNewPassword("");
    setOldPassword("");
    setSubmitting(false);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!action) return;
    const currentSecret = oldPassword;
    const nextSecret = newPassword;
    const repeatedSecret = confirmation;
    setOldPassword("");
    setNewPassword("");
    setConfirmation("");
    setError(null);

    if (action !== "unlock" && nextSecret !== repeatedSecret) {
      setError("两次输入的密码不一致");
      return;
    }
    if (
      (action === "unlock" ? currentSecret : nextSecret).length < 12 ||
      (action === "change" && currentSecret.length < 12)
    ) {
      setError("密码至少需要 12 个字符");
      return;
    }

    setSubmitting(true);
    try {
      const status =
        action === "create"
          ? await client.createPassword({ newPassword: nextSecret })
          : action === "unlock"
            ? await client.unlock({ password: currentSecret })
            : await client.changePassword({
                expectedVersion: version,
                newPassword: nextSecret,
                oldPassword: currentSecret,
              });
      reset();
      onOpenChange(false);
      onSuccess(status);
    } catch (requestError) {
      setError(requestLabel(requestError));
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  const title =
    action === "create"
      ? "创建 Keystore 密码"
      : action === "change"
        ? "修改 Keystore 密码"
        : "解锁 Keystore";
  const confirmLabel =
    action === "create" ? "确认创建" : action === "change" ? "确认修改" : "确认解锁";

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) reset();
        onOpenChange(open);
      }}
      open={action !== null}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog keystore-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label={`关闭${title}`}
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <form className="wallet-form" onSubmit={(event) => void submit(event)}>
            {action === "change" ? (
              <label htmlFor="keystore-current-password">
                <span>当前密码</span>
                <input
                  autoComplete="current-password"
                  autoFocus
                  id="keystore-current-password"
                  onChange={(event) => setOldPassword(event.target.value)}
                  type="password"
                  value={oldPassword}
                />
              </label>
            ) : null}
            {action === "unlock" ? (
              <label htmlFor="keystore-unlock-password">
                <span>密码</span>
                <input
                  autoComplete="current-password"
                  autoFocus
                  id="keystore-unlock-password"
                  onChange={(event) => setOldPassword(event.target.value)}
                  type="password"
                  value={oldPassword}
                />
              </label>
            ) : null}
            {action === "create" || action === "change" ? (
              <>
                <label htmlFor="keystore-new-password">
                  <span>新密码</span>
                  <input
                    autoComplete="new-password"
                    autoFocus={action === "create"}
                    id="keystore-new-password"
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    value={newPassword}
                  />
                </label>
                <label htmlFor="keystore-confirm-password">
                  <span>确认新密码</span>
                  <input
                    autoComplete="new-password"
                    id="keystore-confirm-password"
                    onChange={(event) => setConfirmation(event.target.value)}
                    type="password"
                    value={confirmation}
                  />
                </label>
              </>
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
                ) : action === "unlock" ? (
                  <UnlockKeyhole aria-hidden="true" size={16} />
                ) : (
                  <KeyRound aria-hidden="true" size={16} />
                )}
                {confirmLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ResetDialog({
  client,
  onFailure,
  onOpenChange,
  onSuccess,
  open,
  preview,
  returnFocus,
}: {
  client: KeystoreClient;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  onSuccess(status: KeystoreStatus): void;
  open: boolean;
  preview: KeystoreResetPreview | null;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetFields = () => {
    setError(null);
    setPhrase("");
    setSubmitting(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!preview) return;
    const confirmationPhrase = phrase;
    setPhrase("");
    setError(null);
    if (confirmationPhrase !== keystoreResetConfirmationPhrase) {
      setError("确认短语不正确");
      return;
    }
    setSubmitting(true);
    try {
      const status = await client.reset({
        confirmationPhrase,
        expectedVersion: preview.secretVersion,
        previewToken: preview.previewToken,
      });
      resetFields();
      onOpenChange(false);
      onSuccess(status);
    } catch (requestError) {
      setError(requestLabel(requestError));
      setSubmitting(false);
      onFailure(requestError);
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(next) => {
        if (!next) resetFields();
        onOpenChange(next);
      }}
      open={open}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog keystore-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <div className="wallet-dialog-heading">
            <Dialog.Title>重置 Keystore</Dialog.Title>
            <Dialog.Close asChild>
              <button
                aria-label="关闭重置 Keystore"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          {preview ? (
            <form
              className="wallet-form keystore-reset-form"
              onSubmit={(event) => void submit(event)}
            >
              <div className="reset-risk-summary" role="status">
                <strong>{preview.walletCount} 个密码钱包</strong>
                <span>{preview.taskCount} 个任务</span>
                <span>{preview.strategyCount} 个策略</span>
                <span>{preview.policyCount} 个策略规则</span>
                <span>{preview.walletsWithNonzeroAssets} 个钱包存在资产风险</span>
                <span>{preview.walletsWithPositions} 个钱包存在仓位</span>
              </div>
              <label htmlFor="keystore-reset-phrase">
                <span>确认短语</span>
                <code>{keystoreResetConfirmationPhrase}</code>
                <input
                  autoComplete="off"
                  autoFocus
                  id="keystore-reset-phrase"
                  onChange={(event) => setPhrase(event.target.value)}
                  spellCheck={false}
                  type="text"
                  value={phrase}
                />
              </label>
              {error ? <p role="alert">{error}</p> : null}
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
                    <RotateCcw aria-hidden="true" size={16} />
                  )}
                  确认重置
                </button>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function KeystoreSettings() {
  const client = useMemo(() => new KeystoreClient(), []);
  const [autoLockMinutes, setAutoLockMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);
  const [preview, setPreview] = useState<KeystoreResetPreview | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [status, setStatus] = useState<KeystoreStatus>({
    configured: false,
    status: "unconfigured",
    version: 0,
  });
  const [viewState, setViewState] = useState<ViewState>("loading");
  const lastPasswordTrigger = useRef<HTMLButtonElement>(null);
  const primaryAction = useRef<HTMLButtonElement>(null);
  const resetTrigger = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      setViewState("loading");
      try {
        const next = await client.status(signal);
        setStatus(next);
        setViewState(next.status);
      } catch (requestError) {
        if (signal?.aborted) return;
        setError(requestLabel(requestError));
        setViewState("error");
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const applyStatus = (next: KeystoreStatus) => {
    setError(null);
    setStatus(next);
    setViewState(next.status);
  };

  const applyStatusAndFocus = (next: KeystoreStatus) => {
    applyStatus(next);
    requestAnimationFrame(() => primaryAction.current?.focus());
  };

  const failure = (requestError: unknown) => {
    setViewState(stateForError(requestError));
  };

  const openPassword = (action: PasswordAction, trigger: HTMLButtonElement) => {
    lastPasswordTrigger.current = trigger;
    setError(null);
    setPasswordAction(action);
  };

  const lock = async () => {
    setError(null);
    try {
      applyStatus(await client.lock());
    } catch (requestError) {
      setError(requestLabel(requestError));
      failure(requestError);
    }
  };

  const updateAutoLock = async (minutes: number) => {
    setAutoLockMinutes(minutes);
    setError(null);
    try {
      applyStatus(
        await client.updateAutoLock({
          expectedVersion: status.version,
          minutes: minutes as (typeof keystoreAutoLockMinutes)[number],
        }),
      );
    } catch (requestError) {
      setError(requestLabel(requestError));
      failure(requestError);
    }
  };

  const openReset = async () => {
    setError(null);
    setPreview(null);
    setViewState("reset-preview");
    try {
      const next = await client.resetPreview();
      setPreview(next);
      setResetOpen(true);
    } catch (requestError) {
      setError(requestLabel(requestError));
      setViewState("error");
    }
  };

  return (
    <section
      aria-labelledby="keystore-settings-title"
      className="keystore-settings"
      data-state={viewState}
    >
      <div className="interface-section-heading">
        <div>
          <ShieldCheck aria-hidden="true" size={18} />
          <h2 id="keystore-settings-title">Keystore 安全</h2>
        </div>
        <button
          aria-label="刷新 Keystore 状态"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={viewState === "loading" ? "spin-icon" : undefined}
            size={16}
          />
        </button>
      </div>

      <div className="keystore-settings-panel">
        <div className="keystore-status-row">
          <div className="keystore-status-copy">
            <span>密码托管</span>
            <strong
              aria-label="Keystore 状态"
              className="keystore-status-badge"
              data-status={status.status}
              role="status"
            >
              {viewState === "loading" ? "正在加载" : stateLabels[status.status]}
            </strong>
          </div>
          <div className="keystore-actions">
            {status.status === "unconfigured" ? (
              <button
                className="primary-button"
                onClick={(event) => openPassword("create", event.currentTarget)}
                ref={primaryAction}
                type="button"
              >
                <KeyRound aria-hidden="true" size={16} />
                创建密码
              </button>
            ) : null}
            {status.status === "locked" ? (
              <button
                className="primary-button"
                onClick={(event) => openPassword("unlock", event.currentTarget)}
                ref={primaryAction}
                type="button"
              >
                <UnlockKeyhole aria-hidden="true" size={16} />
                解锁
              </button>
            ) : null}
            {status.status === "unlocked" ? (
              <button
                className="secondary-button"
                onClick={() => void lock()}
                ref={primaryAction}
                type="button"
              >
                <LockKeyhole aria-hidden="true" size={16} />
                锁定
              </button>
            ) : null}
            {status.configured ? (
              <button
                className="secondary-button"
                onClick={(event) => openPassword("change", event.currentTarget)}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
                修改密码
              </button>
            ) : null}
            {status.configured ? (
              <button
                className="danger-command"
                onClick={() => void openReset()}
                ref={resetTrigger}
                type="button"
              >
                <ShieldAlert aria-hidden="true" size={15} />
                忘记密码
              </button>
            ) : null}
          </div>
        </div>

        <div className="keystore-auto-lock-row">
          <label htmlFor="keystore-auto-lock">
            <TimerReset aria-hidden="true" size={16} />
            自动锁定时间
          </label>
          <select
            disabled={!status.configured || viewState === "loading"}
            id="keystore-auto-lock"
            onChange={(event) => void updateAutoLock(Number(event.target.value))}
            value={autoLockMinutes}
          >
            {keystoreAutoLockMinutes.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} 分钟
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <div className="keystore-inline-error" role="alert">
            <ShieldAlert aria-hidden="true" size={16} />
            {error}
          </div>
        ) : null}
      </div>

      <PasswordDialog
        action={passwordAction}
        client={client}
        onFailure={failure}
        onOpenChange={(open) => {
          if (!open) setPasswordAction(null);
        }}
        onSuccess={applyStatusAndFocus}
        returnFocus={lastPasswordTrigger}
        version={status.version}
      />
      <ResetDialog
        client={client}
        onFailure={(requestError) => setViewState(stateForError(requestError))}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open && status.configured) setViewState(status.status);
        }}
        onSuccess={applyStatusAndFocus}
        open={resetOpen}
        preview={preview}
        returnFocus={resetTrigger}
      />
    </section>
  );
}
