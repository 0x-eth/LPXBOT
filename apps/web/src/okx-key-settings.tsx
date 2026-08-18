import type { OkxKeyStatus } from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Cable,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react";

import { ConfirmDialog } from "./feedback";
import { OkxKeyClient, OkxKeyRequestError, type OkxCredentialDraft } from "./okx-key-client";

type CredentialAction = "replace" | "save";
type ViewState =
  OkxKeyStatus["status"] | "conflict" | "connector-unavailable" | "error" | "loading";

const statusLabels: Record<OkxKeyStatus["status"], string> = {
  deleting: "正在删除",
  invalid: "凭证无效",
  "insufficient-permission": "权限不符合要求",
  revoked: "已撤销",
  staged: "等待验证",
  testing: "正在测试",
  unconfigured: "未配置",
  unknown: "状态未知",
  usable: "可用",
};

function requestLabel(error: unknown): string {
  if (!(error instanceof OkxKeyRequestError)) return "OKX Connector 暂不可用";
  switch (error.code) {
    case "CAPABILITY_EXPIRED":
    case "VERSION_CONFLICT":
      return "配置版本已变化，请刷新后重试";
    case "CREDENTIAL_ALREADY_CONFIGURED":
      return "已存在配置，请使用替换操作";
    case "CREDENTIAL_INVALID":
      return "OKX 拒绝了该凭证";
    case "CREDENTIAL_REVOKED":
      return "凭证已撤销，请替换";
    case "INSUFFICIENT_PERMISSION":
      return "仅接受启用读取、关闭交易和提现的凭证";
    case "INVALID_CREDENTIAL_INGRESS":
      return "请完整填写三个凭证字段";
    case "PROVIDER_UNKNOWN":
      return "暂时无法确认凭证状态";
    case "REAUTH_REQUIRED":
      return "需要重新验证身份";
    default:
      return "OKX Connector 暂不可用";
  }
}

function stateForError(error: unknown): ViewState {
  if (
    error instanceof OkxKeyRequestError &&
    (error.code === "VERSION_CONFLICT" || error.code === "CAPABILITY_EXPIRED")
  ) {
    return "conflict";
  }
  if (
    error instanceof OkxKeyRequestError &&
    (error.code === "NETWORK_ERROR" ||
      error.code === "CONNECTOR_UNAVAILABLE" ||
      error.code === "KMS_UNAVAILABLE")
  ) {
    return "connector-unavailable";
  }
  return "error";
}

function blockClipboard(event: ClipboardEvent<HTMLInputElement>): void {
  event.preventDefault();
}

function SecretInput({
  autoFocus,
  inputRef,
  label,
  onChange,
  value,
}: {
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  const id = `okx-${label.toLowerCase().replace(/\s+/gu, "-")}`;
  return (
    <label htmlFor={id}>
      <span>{label}</span>
      <input
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        autoFocus={autoFocus}
        data-1p-ignore="true"
        data-bwignore="true"
        id={id}
        maxLength={512}
        onChange={(event) => onChange(event.target.value)}
        onContextMenu={(event) => event.preventDefault()}
        onCopy={blockClipboard}
        onCut={blockClipboard}
        ref={inputRef}
        spellCheck={false}
        type="password"
        value={value}
      />
    </label>
  );
}

function CredentialDialog({
  action,
  client,
  onFailure,
  onOpenChange,
  onSuccess,
  returnFocus,
  version,
}: {
  action: CredentialAction | null;
  client: OkxKeyClient;
  onFailure(error: unknown): void;
  onOpenChange(open: boolean): void;
  onSuccess(status: OkxKeyStatus): void;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
  version: number;
}) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const apiKeyInput = useRef<HTMLInputElement | null>(null);
  const passphraseInput = useRef<HTMLInputElement | null>(null);
  const secretKeyInput = useRef<HTMLInputElement | null>(null);

  const clearDomInputs = useCallback(() => {
    if (apiKeyInput.current) apiKeyInput.current.value = "";
    if (secretKeyInput.current) secretKeyInput.current.value = "";
    if (passphraseInput.current) passphraseInput.current.value = "";
  }, []);

  const clear = useCallback(() => {
    setApiKey("");
    setSecretKey("");
    setPassphrase("");
    setError(null);
    setSubmitting(false);
    clearDomInputs();
  }, [clearDomInputs]);

  useEffect(() => () => clearDomInputs(), [clearDomInputs]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!action) return;
    const credentials: OkxCredentialDraft = { apiKey, passphrase, secretKey };
    clear();
    if (Object.values(credentials).some((value) => value.length < 1)) {
      setError("请完整填写三个凭证字段");
      return;
    }
    setSubmitting(true);
    try {
      const status =
        action === "save"
          ? await client.save(credentials)
          : await client.replace(credentials, version);
      clear();
      onOpenChange(false);
      onSuccess(status);
    } catch (requestError) {
      clear();
      setError(requestLabel(requestError));
      onFailure(requestError);
    } finally {
      credentials.apiKey = "";
      credentials.secretKey = "";
      credentials.passphrase = "";
    }
  };

  const title = action === "replace" ? "替换 OKX Key" : "保存 OKX Key";
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) clear();
        onOpenChange(open);
      }}
      open={action !== null}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="wallet-dialog okx-key-dialog"
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
            <SecretInput
              autoFocus
              inputRef={apiKeyInput}
              label="API Key"
              onChange={setApiKey}
              value={apiKey}
            />
            <SecretInput
              inputRef={secretKeyInput}
              label="Secret Key"
              onChange={setSecretKey}
              value={secretKey}
            />
            <SecretInput
              inputRef={passphraseInput}
              label="Passphrase"
              onChange={setPassphrase}
              value={passphrase}
            />
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
                ) : action === "replace" ? (
                  <Pencil aria-hidden="true" size={16} />
                ) : (
                  <KeyRound aria-hidden="true" size={16} />
                )}
                {title}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function OkxKeySettings() {
  const client = useMemo(() => new OkxKeyClient(), []);
  const [action, setAction] = useState<CredentialAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OkxKeyStatus>({
    configured: false,
    status: "unconfigured",
    version: 0,
  });
  const [viewState, setViewState] = useState<ViewState>("loading");
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);

  const applyStatus = useCallback((next: OkxKeyStatus) => {
    setStatus(next);
    setViewState(next.status);
    setError(null);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (signal?.aborted) return;
      setError(null);
      setViewState("loading");
      try {
        applyStatus(await client.status(signal));
      } catch (requestError) {
        if (signal?.aborted) return;
        setError(requestLabel(requestError));
        setViewState(stateForError(requestError));
      }
    },
    [applyStatus, client],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const run = async (operation: "delete" | "test") => {
    setBusy(true);
    setError(null);
    if (operation === "test") setViewState("testing");
    else setViewState("deleting");
    try {
      applyStatus(
        operation === "test"
          ? await client.test(status.version)
          : await client.delete(status.version),
      );
      setConfirmDelete(false);
    } catch (requestError) {
      setError(requestLabel(requestError));
      setViewState(stateForError(requestError));
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (next: CredentialAction, trigger: HTMLButtonElement) => {
    actionTrigger.current = trigger;
    setError(null);
    setAction(next);
  };

  return (
    <section
      aria-labelledby="okx-key-settings-title"
      className="okx-key-settings"
      data-state={viewState}
    >
      <div className="interface-section-heading">
        <div>
          <Cable aria-hidden="true" size={18} />
          <h2 id="okx-key-settings-title">OKX Key</h2>
        </div>
        <button
          aria-label="刷新 OKX Key 状态"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          disabled={busy}
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
      <div className="okx-key-panel" aria-busy={busy || viewState === "loading"}>
        <div className="okx-key-status-row">
          <div className="okx-key-status-copy">
            <span>连接状态</span>
            <strong
              aria-label="OKX Key 状态"
              className="okx-key-status-badge"
              data-status={viewState === "testing" ? "testing" : status.status}
              role="status"
            >
              {viewState === "loading"
                ? "正在加载"
                : viewState === "connector-unavailable"
                  ? "Connector 暂不可用"
                  : viewState === "conflict"
                    ? "版本冲突"
                    : viewState === "testing"
                      ? statusLabels.testing
                      : viewState === "deleting"
                        ? statusLabels.deleting
                        : statusLabels[status.status]}
            </strong>
            {status.configured ? <small>版本 {status.version}</small> : null}
          </div>
          <div className="okx-key-actions">
            {!status.configured ? (
              <button
                className="primary-button"
                disabled={busy}
                onClick={(event) => openEditor("save", event.currentTarget)}
                ref={actionTrigger}
                type="button"
              >
                <KeyRound aria-hidden="true" size={16} />
                保存
              </button>
            ) : (
              <>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={(event) => openEditor("replace", event.currentTarget)}
                  ref={actionTrigger}
                  type="button"
                >
                  <Pencil aria-hidden="true" size={15} />
                  替换
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || status.status === "revoked" || status.status === "deleting"}
                  onClick={() => void run("test")}
                  type="button"
                >
                  <FlaskConical aria-hidden="true" size={15} />
                  测试
                </button>
                <button
                  aria-label="删除 OKX Key"
                  className="danger-command"
                  disabled={busy}
                  onClick={(event) => {
                    deleteTrigger.current = event.currentTarget;
                    setConfirmDelete(true);
                  }}
                  ref={deleteTrigger}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  删除
                </button>
              </>
            )}
          </div>
        </div>
        {error ? (
          <div className="okx-key-inline-error" role="alert">
            <ShieldAlert aria-hidden="true" size={16} />
            {error}
          </div>
        ) : null}
      </div>

      <CredentialDialog
        action={action}
        client={client}
        onFailure={(requestError) => {
          setError(requestLabel(requestError));
          setViewState(stateForError(requestError));
        }}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        onSuccess={applyStatus}
        returnFocus={actionTrigger}
        version={status.version}
      />
      <ConfirmDialog
        cancelLabel="取消"
        confirmIcon={<Trash2 aria-hidden="true" size={16} />}
        confirmLabel="确认删除"
        description="当前连接将立即停止。"
        disabled={busy}
        onConfirm={() => void run("delete")}
        onOpenChange={setConfirmDelete}
        onReturnFocus={() => deleteTrigger.current?.focus()}
        open={confirmDelete}
        title="删除 OKX Key"
      />
    </section>
  );
}
