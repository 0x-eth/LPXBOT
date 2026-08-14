import type {
  ChainAccessMode,
  ManagedChainView,
  UpdateChainAccessRequest,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  ChainConfigClient,
  ChainConfigRequestError,
} from "./chain-config-client.js";
import { ConfirmDialog } from "./feedback.js";

const accessModes = ["off", "pro", "all"] as const;

const accessLabels: Record<ChainAccessMode, string> = {
  all: "全部",
  off: "关闭",
  pro: "Pro",
};

type LoadState = "error" | "idle" | "loading" | "ready";
type OperationState = "conflict" | "idle" | "saving" | "success";

interface PendingChange {
  after: ChainAccessMode;
  before: ChainAccessMode;
  chain: ManagedChainView;
}

function publicErrorMessage(error: unknown): string {
  const code = error instanceof ChainConfigRequestError ? error.code : "REQUEST_FAILED";
  const messages: Record<string, string> = {
    CHAIN_NOT_READY: "链配置不完整，无法开放新建权限",
    CHAIN_UNKNOWN: "链不存在，请重新加载",
    CONFIG_INVALID: "链配置请求无效",
    DEFAULT_CHAIN_REQUIRED: "主链必须保持开放",
    RATE_LIMITED: "操作过于频繁，请稍后重试",
  };
  return messages[code] ?? "链配置保存失败，请重试";
}

function modeAvailable(chain: ManagedChainView, mode: ChainAccessMode): boolean {
  if (chain.isDefault && mode === "off") return false;
  if (!chain.configurationComplete && mode !== "off") return false;
  return true;
}

function ChainAccessGroup({
  chain,
  disabled,
  onChange,
  onRollback,
  value,
}: {
  chain: ManagedChainView;
  disabled: boolean;
  onChange(value: ChainAccessMode): void;
  onRollback(): void;
  value: ChainAccessMode;
}) {
  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    mode: ChainAccessMode,
  ) => {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const available = accessModes.filter((candidate) => modeAvailable(chain, candidate));
    const currentIndex = available.indexOf(mode);
    const next = available[(currentIndex + direction + available.length) % available.length];
    if (!next) return;
    onChange(next);
    const group = event.currentTarget.closest("[role='radiogroup']");
    (group?.querySelector(`[data-chain-access='${next}']`) as HTMLButtonElement | null)?.focus();
  };

  return (
    <fieldset aria-label={`${chain.displayName} 链访问`} className="chain-access-row">
      <div className="chain-identity">
        <div className="chain-name-line">
          <h3>{chain.displayName}</h3>
          {chain.isDefault ? <span className="chain-badge">主链</span> : null}
          {!chain.configurationComplete ? (
            <span className="chain-badge chain-badge-warning">配置不完整</span>
          ) : null}
        </div>
        <span className="chain-id">Chain ID {chain.chainId}</span>
        <span className="chain-activity">
          {chain.activePositionCount === null
            ? "活动仓位不可用"
            : `${chain.activePositionCount} 个活动仓位`}
        </span>
      </div>
      <div className="chain-access-actions">
        <div
          aria-label={`${chain.displayName} 访问模式`}
          className="segmented-control chain-access-control"
          role="radiogroup"
        >
          {accessModes.map((mode) => (
            <button
              aria-checked={value === mode}
              aria-label={accessLabels[mode]}
              className="segmented-option"
              data-chain-access={mode}
              disabled={disabled || !modeAvailable(chain, mode)}
              key={mode}
              onClick={() => onChange(mode)}
              onKeyDown={(event) => selectFromKeyboard(event, mode)}
              role="radio"
              tabIndex={value === mode ? 0 : -1}
              type="button"
            >
              {accessLabels[mode]}
            </button>
          ))}
        </div>
        {chain.previousAccess !== null ? (
          <button
            aria-label={`恢复 ${chain.displayName} 上一版本`}
            className="chain-rollback-button"
            disabled={disabled}
            onClick={onRollback}
            title="恢复上一版本"
            type="button"
          >
            <RotateCcw aria-hidden="true" size={15} />
            <span>上一版本</span>
          </button>
        ) : (
          <span aria-hidden="true" className="chain-rollback-placeholder" />
        )}
      </div>
    </fieldset>
  );
}

export function AdminChainManagementSection({
  client: suppliedClient,
}: {
  client?: ChainConfigClient;
}) {
  const client = useMemo(() => suppliedClient ?? new ChainConfigClient(), [suppliedClient]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [operationState, setOperationState] = useState<OperationState>("idle");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [chains, setChains] = useState<ManagedChainView[]>([]);
  const [draft, setDraft] = useState<Record<number, ChainAccessMode>>({});
  const [reason, setReason] = useState("");

  const pendingChanges = useMemo<PendingChange[]>(
    () =>
      chains.flatMap((chain) => {
        const after = draft[chain.chainId] ?? chain.access;
        return after === chain.access ? [] : [{ after, before: chain.access, chain }];
      }),
    [chains, draft],
  );

  const load = async () => {
    setLoadState("loading");
    setOperationState("idle");
    setOperationError(null);
    setChains([]);
    setDraft({});
    setReason("");
    try {
      const next = await client.get();
      setChains(next);
      setDraft(Object.fromEntries(next.map((chain) => [chain.chainId, chain.access])));
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };

  const close = () => {
    setOpen(false);
    setConfirmOpen(false);
    setLoadState("idle");
    setOperationState("idle");
    setOperationError(null);
    setChains([]);
    setDraft({});
    setReason("");
  };

  const submit = async () => {
    if (operationState === "saving" || pendingChanges.length === 0 || reason.trim() === "") return;
    setOperationState("saving");
    setOperationError(null);
    const request: UpdateChainAccessRequest = {
      access: Object.fromEntries(
        pendingChanges.map(({ after, chain }) => [String(chain.chainId), after]),
      ),
      expectedRevision: Object.fromEntries(
        pendingChanges.map(({ chain }) => [String(chain.chainId), chain.revision]),
      ),
      reason: reason.trim(),
    };
    try {
      const result = await client.update(request);
      setChains(result.chains);
      setDraft(Object.fromEntries(result.chains.map((chain) => [chain.chainId, chain.access])));
      setReason("");
      setOperationState("success");
    } catch (error) {
      if (error instanceof ChainConfigRequestError && error.code === "CONFIG_CONFLICT") {
        setOperationState("conflict");
        setOperationError("配置已被其他会话更新，请重新加载");
      } else {
        setOperationState("idle");
        setOperationError(publicErrorMessage(error));
      }
    }
  };

  const busy = loadState === "loading" || operationState === "saving";
  const canSave = pendingChanges.length > 0 && reason.trim().length > 0 && !busy;

  return (
    <>
      <Dialog.Root
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setOpen(true);
            void load();
          } else if (!busy) {
            close();
          }
        }}
        open={open}
      >
        <section aria-labelledby="site-operations-title" className="settings-section operations-section">
          <div className="section-heading">
            <div>
              <ShieldCheck aria-hidden="true" size={18} />
              <h2 id="site-operations-title">站点运营</h2>
            </div>
            <Dialog.Trigger asChild>
              <button className="compact-command" ref={triggerRef} type="button">
                <Settings2 aria-hidden="true" size={16} />
                链管理
              </button>
            </Dialog.Trigger>
          </div>
        </section>

        <Dialog.Portal>
          <Dialog.Overlay className="chain-dialog-backdrop" />
          <Dialog.Content
            aria-busy={busy}
            className="chain-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <header className="chain-dialog-heading">
              <div>
                <Dialog.Title>链管理</Dialog.Title>
                <span>站点级新建敞口门禁</span>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭链管理"
                  className="icon-button"
                  disabled={busy}
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </Dialog.Close>
            </header>

            <Dialog.Description asChild>
              <div className="chain-mode-guidance">
                <p>关闭：所有人不能新建，已有仓位仍可监控和撤池</p>
                <p>Pro：仅 Pro 和管理员可新建</p>
                <p>全部：所有已授权用户可新建</p>
              </div>
            </Dialog.Description>

            <div className="chain-dialog-body">
              {loadState === "loading" ? (
                <div className="chain-dialog-state" role="status">
                  <LoaderCircle aria-hidden="true" className="feedback-spinner" size={20} />
                  <span>正在加载链配置</span>
                </div>
              ) : null}
              {loadState === "error" ? (
                <div className="chain-dialog-state">
                  <p role="alert">链配置加载失败</p>
                  <button className="secondary-button" onClick={() => void load()} type="button">
                    <RefreshCw aria-hidden="true" size={16} />
                    重试加载
                  </button>
                </div>
              ) : null}
              {loadState === "ready" && chains.length === 0 ? (
                <div className="chain-dialog-state" role="status">
                  <span>暂无链配置</span>
                </div>
              ) : null}
              {loadState === "ready" && chains.length > 0 ? (
                <>
                  <div className="chain-access-list">
                    {chains.map((chain) => (
                      <ChainAccessGroup
                        chain={chain}
                        disabled={operationState === "saving"}
                        key={chain.chainId}
                        onChange={(access) => {
                          setDraft((current) => ({ ...current, [chain.chainId]: access }));
                          setOperationState("idle");
                          setOperationError(null);
                        }}
                        onRollback={() => {
                          if (chain.previousAccess === null) return;
                          setDraft((current) => ({
                            ...current,
                            [chain.chainId]: chain.previousAccess!,
                          }));
                          setOperationState("idle");
                          setOperationError(null);
                        }}
                        value={draft[chain.chainId] ?? chain.access}
                      />
                    ))}
                  </div>

                  <section aria-labelledby="chain-impact-title" className="chain-impact-preview">
                    <h3 id="chain-impact-title">变更影响</h3>
                    {pendingChanges.length === 0 ? (
                      <p className="chain-no-changes">没有待保存的变更</p>
                    ) : (
                      <ul>
                        {pendingChanges.map(({ after, before, chain }) => (
                          <li key={chain.chainId}>
                            {chain.displayName}：{accessLabels[before]} → {accessLabels[after]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <label className="chain-reason-field">
                    <span>变更原因</span>
                    <textarea
                      disabled={operationState === "saving"}
                      maxLength={500}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      rows={3}
                      value={reason}
                    />
                  </label>

                  {operationState === "saving" ? (
                    <div className="chain-operation-status" role="status">
                      <LoaderCircle aria-hidden="true" className="feedback-spinner" size={18} />
                      <span>正在保存链配置</span>
                    </div>
                  ) : null}
                  {operationState === "success" ? (
                    <div className="chain-operation-status chain-operation-success" role="status">
                      链配置已保存
                    </div>
                  ) : null}
                  {operationError ? (
                    <div className="chain-operation-error" role="alert">
                      <span>{operationError}</span>
                      {operationState === "conflict" ? (
                        <button className="secondary-button" onClick={() => void load()} type="button">
                          <RefreshCw aria-hidden="true" size={16} />
                          重新加载
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <footer className="chain-dialog-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={busy} type="button">
                  取消
                </button>
              </Dialog.Close>
              {loadState === "ready" && chains.length > 0 ? (
                <button
                  className="command-button"
                  disabled={!canSave}
                  onClick={() => setConfirmOpen(true)}
                  ref={saveButtonRef}
                  type="button"
                >
                  <Save aria-hidden="true" size={17} />
                  保存链配置
                </button>
              ) : null}
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        confirmIcon={<Save aria-hidden="true" size={17} />}
        confirmLabel="确认保存"
        description={`将应用 ${pendingChanges.length} 项链访问变更。原因：${reason.trim()}`}
        disabled={operationState === "saving"}
        onConfirm={() => void submit()}
        onOpenChange={setConfirmOpen}
        onReturnFocus={() => saveButtonRef.current?.focus()}
        open={confirmOpen}
        title="确认链配置变更"
      />
    </>
  );
}
