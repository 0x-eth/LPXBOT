import type { SecurityPasswordStatus } from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  KeyRound,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { SecurityPasswordClient, SecurityPasswordRequestError } from "./security-password-client";

type PasswordAction = "change" | "create";
type ViewState =
  "conflict" | "error" | "loading" | "locked-out" | "ready" | "security-unconfigured";

const statusLabels: Record<SecurityPasswordStatus["status"], string> = {
  "locked-out": "暂时锁定",
  ready: "已设置",
  unconfigured: "未设置",
};

function requestLabel(error: unknown): string {
  if (!(error instanceof SecurityPasswordRequestError)) return "安全密码请求失败";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "安全密码不正确";
    case "LOCKED_OUT":
      return "尝试次数过多，请稍后重试";
    case "PASSWORD_POLICY_FAILED":
      return "安全密码至少需要 12 个 UTF-8 字节";
    case "REAUTH_REQUIRED":
      return "需要重新验证身份";
    case "SECURITY_PASSWORD_VERSION_CONFLICT":
      return "安全密码版本已变化，请刷新后重试";
    default:
      return "安全密码请求失败";
  }
}

function stateForStatus(status: SecurityPasswordStatus): ViewState {
  return status.status === "unconfigured" ? "security-unconfigured" : status.status;
}

function stateForError(error: unknown): ViewState {
  if (
    error instanceof SecurityPasswordRequestError &&
    error.code === "SECURITY_PASSWORD_VERSION_CONFLICT"
  ) {
    return "conflict";
  }
  return "error";
}

function SecurityPasswordDialog({
  action,
  client,
  onFailure,
  onOpenChange,
  onSuccess,
  returnFocus,
  version,
}: {
  action: PasswordAction | null;
  client: SecurityPasswordClient;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  onSuccess(status: SecurityPasswordStatus): void;
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

    if (nextSecret !== repeatedSecret) {
      setError("两次输入的安全密码不一致");
      return;
    }
    const nextBytes = new TextEncoder().encode(nextSecret).length;
    const currentBytes = new TextEncoder().encode(currentSecret).length;
    if (nextBytes < 12 || (action === "change" && currentBytes < 12)) {
      setError("安全密码至少需要 12 个 UTF-8 字节");
      return;
    }

    setSubmitting(true);
    try {
      const status = await client.update({
        expectedVersion: action === "create" ? 0 : version,
        newPassword: nextSecret,
        oldPassword: action === "create" ? null : currentSecret,
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

  const title = action === "change" ? "修改安全密码" : "创建安全密码";
  const submitLabel = action === "change" ? "确认修改安全密码" : "确认创建安全密码";

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
          className="wallet-dialog security-password-dialog"
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
              <label htmlFor="security-password-current">
                <span>当前安全密码</span>
                <input
                  autoComplete="current-password"
                  autoFocus
                  id="security-password-current"
                  onChange={(event) => setOldPassword(event.target.value)}
                  type="password"
                  value={oldPassword}
                />
              </label>
            ) : null}
            <label htmlFor="security-password-new">
              <span>新安全密码</span>
              <input
                autoComplete="new-password"
                autoFocus={action === "create"}
                id="security-password-new"
                onChange={(event) => setNewPassword(event.target.value)}
                type="password"
                value={newPassword}
              />
            </label>
            <label htmlFor="security-password-confirm">
              <span>确认安全密码</span>
              <input
                autoComplete="new-password"
                id="security-password-confirm"
                onChange={(event) => setConfirmation(event.target.value)}
                type="password"
                value={confirmation}
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
                ) : action === "change" ? (
                  <Pencil aria-hidden="true" size={15} />
                ) : (
                  <KeyRound aria-hidden="true" size={16} />
                )}
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SecurityPasswordSettings() {
  const client = useMemo(() => new SecurityPasswordClient(), []);
  const [action, setAction] = useState<PasswordAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SecurityPasswordStatus>({
    configured: false,
    status: "unconfigured",
    version: 0,
  });
  const [viewState, setViewState] = useState<ViewState>("loading");
  const actionTrigger = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      setViewState("loading");
      try {
        const next = await client.status(signal);
        setStatus(next);
        setViewState(stateForStatus(next));
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
    void client.status(controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setViewState(stateForStatus(next));
      },
      (requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(requestLabel(requestError));
        setViewState("error");
      },
    );
    return () => controller.abort();
  }, [client]);

  const open = (next: PasswordAction, trigger: HTMLButtonElement) => {
    actionTrigger.current = trigger;
    setError(null);
    setAction(next);
  };

  return (
    <section
      aria-labelledby="security-password-settings-title"
      className="security-password-settings"
      data-state={viewState}
    >
      <div className="interface-section-heading">
        <div>
          <ShieldCheck aria-hidden="true" size={18} />
          <h2 id="security-password-settings-title">安全密码</h2>
        </div>
        <button
          aria-label="刷新安全密码状态"
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

      <div className="security-password-panel">
        <div className="security-password-status-row">
          <div className="security-password-status-copy">
            <span>独立凭据</span>
            <strong
              aria-label="安全密码状态"
              className="security-password-status-badge"
              data-status={status.status}
              role="status"
            >
              {viewState === "loading" ? "正在加载" : statusLabels[status.status]}
            </strong>
            {status.configured ? <small>版本 {status.version}</small> : null}
          </div>
          <div className="security-password-actions">
            {status.status === "unconfigured" ? (
              <button
                className="primary-button"
                onClick={(event) => open("create", event.currentTarget)}
                ref={actionTrigger}
                type="button"
              >
                <KeyRound aria-hidden="true" size={16} />
                创建安全密码
              </button>
            ) : null}
            {status.configured && status.status !== "locked-out" ? (
              <button
                className="secondary-button"
                onClick={(event) => open("change", event.currentTarget)}
                ref={actionTrigger}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
                修改安全密码
              </button>
            ) : null}
          </div>
        </div>
        {error ? (
          <div className="security-password-inline-error" role="alert">
            <ShieldAlert aria-hidden="true" size={16} />
            {error}
          </div>
        ) : null}
      </div>

      <SecurityPasswordDialog
        action={action}
        client={client}
        onFailure={(requestError) => {
          setError(requestLabel(requestError));
          setViewState(stateForError(requestError));
        }}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        onSuccess={(next) => {
          setError(null);
          setStatus(next);
          setViewState(stateForStatus(next));
        }}
        returnFocus={actionTrigger}
        version={status.version}
      />
    </section>
  );
}
