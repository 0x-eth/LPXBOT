import {
  notificationCategories,
  type DestinationDraft,
  type LocalSinkTestResult,
  type NotificationCategory,
  type NotificationDestination,
  type NotificationDestinationOptions,
  type NotificationPreferences,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Bell,
  Bot,
  CircleAlert,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
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

import { ConfirmDialog, useFeedback } from "./feedback.js";
import { NotificationClient, NotificationRequestError } from "./notification-client.js";

type LoadState = "error" | "loading" | "ready";

interface DestinationEditorDraft {
  categories: NotificationCategory[];
  enabled: boolean;
  method: "GET" | "POST";
  name: string;
  secret: string;
  telegramIdentityId: string;
  template: string;
  token: string;
  type: "telegram" | "webhook";
  url: string;
}

type DestinationEditorState =
  | {
      conflict: boolean;
      draft: DestinationEditorDraft;
      errorCode: string | null;
      mode: "create";
      result: LocalSinkTestResult | null;
    }
  | {
      conflict: boolean;
      draft: DestinationEditorDraft;
      errorCode: string | null;
      mode: "edit";
      original: NotificationDestination;
      result: LocalSinkTestResult | null;
    };

const categoryLabels: Readonly<Record<NotificationCategory, { description: string; label: string }>> = {
  "feedback-replied": { description: "反馈收到回复时通知", label: "反馈回复" },
  "monitor-match": { description: "监控条件全部匹配时通知", label: "监控匹配" },
  "operation-failed": { description: "任务操作失败时通知", label: "操作失败" },
  "position-closed": { description: "仓位关闭完成时通知", label: "仓位关闭" },
  "position-moved": { description: "仓位移动完成时通知", label: "仓位移动" },
  "task-created": { description: "任务创建完成时通知", label: "任务创建" },
};

const allowedVariables = new Set([
  "delivery.id",
  "delivery.timestamp",
  "monitor.id",
  "monitor.name",
  "monitor.revision",
  "pool.key",
  "pool.token0",
  "pool.token1",
  "window.end",
  "metric.version",
  "condition.summary",
  "metrics.volumeUsd",
  "metrics.feesUsd",
  "metrics.feeTvlRatio",
  "metrics.tvlUsd",
  "metrics.transactionCount",
]);

const placeholderPattern = /\{\{([^{}]+)\}\}/gu;

function templateVariablesValid(source: string): boolean {
  const variables = [...source.matchAll(placeholderPattern)].map((match) => match[1]!);
  const remainder = source.replace(placeholderPattern, "");
  return (
    !remainder.includes("{{") &&
    !remainder.includes("}}") &&
    variables.every((variable) => allowedVariables.has(variable))
  );
}

function jsonTemplateValid(value: unknown): boolean {
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return templateVariablesValid(value);
  if (Array.isArray(value)) return value.every(jsonTemplateValid);
  if (typeof value !== "object") return false;
  return Object.entries(value).every(
    ([key, child]) =>
      !key.includes("{{") && !key.includes("}}") && jsonTemplateValid(child),
  );
}

function templateIssue(draft: DestinationEditorDraft): string | null {
  if (new TextEncoder().encode(draft.template).length > 16_384) return "模板超过 16 KiB";
  if (draft.type === "telegram") {
    if (/\p{Cc}/u.test(draft.template) || !templateVariablesValid(draft.template)) {
      return "模板变量无效";
    }
    if ([...draft.template].length > 4_096) return "Telegram 模板超过 4096 字符";
    return null;
  }
  if (draft.method === "GET") {
    if (draft.template === "" || /\p{Cc}/u.test(draft.template)) return "GET 查询模板无效";
    const parts = draft.template.split("&");
    const valid = parts.every((part) => {
      const separator = part.indexOf("=");
      return (
        separator > 0 &&
        !part.slice(0, separator).includes("{{") &&
        templateVariablesValid(part.slice(separator + 1))
      );
    });
    return valid ? null : "GET 查询模板无效";
  }
  try {
    const value = JSON.parse(draft.template) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) && jsonTemplateValid(value)
      ? null
      : "POST JSON 模板无效";
  } catch {
    return "POST JSON 模板无效";
  }
}

function webhookUrlValid(value: string): boolean {
  if (new TextEncoder().encode(value).length > 4_096) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      url.hostname !== "localhost" &&
      !url.hostname.endsWith(".local") &&
      !url.hostname.endsWith(".internal") &&
      !/^\[?[0-9a-f:.]+\]?$/iu.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function blankDraft(options: NotificationDestinationOptions): DestinationEditorDraft {
  return {
    categories: ["monitor-match"],
    enabled: true,
    method: "POST",
    name: "",
    secret: "",
    telegramIdentityId: options.telegramIdentityId ?? "",
    template: '{"message":"{{monitor.name}}: {{condition.summary}}"}',
    token: "",
    type: "webhook",
    url: "",
  };
}

function draftFromDestination(destination: NotificationDestination): DestinationEditorDraft {
  if (destination.type === "telegram") {
    return {
      categories: [...destination.categories],
      enabled: destination.enabled,
      method: "POST",
      name: destination.name,
      secret: "",
      telegramIdentityId: destination.config.telegramIdentityId,
      template: destination.config.template,
      token: "",
      type: "telegram",
      url: "",
    };
  }
  return {
    categories: [...destination.categories],
    enabled: destination.enabled,
    method: destination.config.method,
    name: destination.name,
    secret: "",
    telegramIdentityId: "",
    template:
      destination.config.method === "GET"
        ? String(destination.config.template)
        : JSON.stringify(destination.config.template, null, 2),
    token: "",
    type: "webhook",
    url: destination.config.url,
  };
}

function draftValid(
  editor: DestinationEditorState,
  options: NotificationDestinationOptions,
  purpose: "save" | "test",
): boolean {
  const { draft } = editor;
  if (
    draft.name.trim().length < 1 ||
    [...draft.name.trim()].length > 120 ||
    draft.categories.length < 1 ||
    templateIssue(draft) !== null
  ) {
    return false;
  }
  if (draft.type === "telegram") {
    const secretRequired = editor.mode === "create" || purpose === "test";
    return (
      options.telegramIdentityId !== null &&
      draft.telegramIdentityId === options.telegramIdentityId &&
      (!secretRequired || new TextEncoder().encode(draft.token).length >= 20)
    );
  }
  return (
    webhookUrlValid(draft.url) &&
    (draft.secret === "" || new TextEncoder().encode(draft.secret).length >= 32)
  );
}

function createRequest(draft: DestinationEditorDraft): DestinationDraft {
  if (draft.type === "telegram") {
    return {
      categories: draft.categories,
      config: {
        botToken: draft.token,
        telegramIdentityId: draft.telegramIdentityId,
        template: draft.template,
      },
      enabled: draft.enabled,
      name: draft.name.trim(),
      type: "telegram",
    };
  }
  return {
    categories: draft.categories,
    config: {
      method: draft.method,
      ...(draft.secret === "" ? {} : { signingSecret: draft.secret }),
      template: draft.method === "POST" ? (JSON.parse(draft.template) as unknown) : draft.template,
      url: draft.url,
    },
    enabled: draft.enabled,
    name: draft.name.trim(),
    type: "webhook",
  };
}

function destinationPatch(editor: Extract<DestinationEditorState, { mode: "edit" }>) {
  const draft = editor.draft;
  return {
    changes: {
      categories: draft.categories,
      config:
        draft.type === "telegram"
          ? {
              ...(draft.token === "" ? {} : { botToken: draft.token }),
              telegramIdentityId: draft.telegramIdentityId,
              template: draft.template,
            }
          : {
              method: draft.method,
              ...(draft.secret === "" ? {} : { signingSecret: draft.secret }),
              template:
                draft.method === "POST" ? (JSON.parse(draft.template) as unknown) : draft.template,
              url: draft.url,
            },
      enabled: draft.enabled,
      name: draft.name.trim(),
    },
    expectedRevision: editor.original.revision,
  };
}

function NotificationSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="preference-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="preference-switch-thumb" />
    </button>
  );
}

function DestinationEditor({
  busy,
  editor,
  onChange,
  onClose,
  onSave,
  onTest,
  options,
  returnFocus,
}: {
  busy: boolean;
  editor: DestinationEditorState;
  onChange(editor: DestinationEditorState): void;
  onClose(): void;
  onSave(): void;
  onTest(): void;
  options: NotificationDestinationOptions;
  returnFocus(): void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const updateDraft = (changes: Partial<DestinationEditorDraft>) =>
    onChange({ ...editor, conflict: false, draft: { ...editor.draft, ...changes }, errorCode: null, result: null });
  const issue = templateIssue(editor.draft);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && draftValid(editor, options, "save")) onSave();
  };
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="destination-editor"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nameRef.current?.focus();
          }}
        >
          <form onSubmit={submit}>
            <div className="destination-editor-heading">
              <div>
                <p>local-sink://p03-01</p>
                <Dialog.Title>
                  {editor.mode === "create" ? "添加通知目的地" : "编辑通知目的地"}
                </Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭目的地编辑器"
                  className="icon-button"
                  disabled={busy}
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              配置 Telegram 或 Webhook 通知目的地。密钥仅写入且不会回显。
            </Dialog.Description>

            {editor.conflict ? (
              <div className="destination-editor-alert" role="alert">
                <CircleAlert aria-hidden="true" size={17} />
                其他会话已更新，当前草稿已保留
              </div>
            ) : null}
            {editor.errorCode ? (
              <div className="destination-editor-alert" role="alert">
                <CircleAlert aria-hidden="true" size={17} />
                {editor.errorCode === "UNSAFE_WEBHOOK_TARGET"
                  ? "Webhook 地址不可用"
                  : editor.errorCode.includes("TEMPLATE")
                    ? "模板校验失败"
                    : "目的地操作失败，请重试"}
              </div>
            ) : null}

            <div className="destination-editor-body">
              <label className="destination-field">
                <span>目的地名称</span>
                <input
                  disabled={busy}
                  maxLength={120}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  ref={nameRef}
                  type="text"
                  value={editor.draft.name}
                />
              </label>

              <div className="destination-field">
                <span>类型</span>
                <div aria-label="目的地类型" className="destination-segmented" role="radiogroup">
                  <button
                    aria-checked={editor.draft.type === "telegram"}
                    aria-label="Telegram"
                    disabled={busy || editor.mode === "edit" || options.telegramIdentityId === null}
                    onClick={() =>
                      updateDraft({
                        telegramIdentityId: options.telegramIdentityId ?? "",
                        template: "<b>{{monitor.name}}</b> {{condition.summary}}",
                        type: "telegram",
                      })
                    }
                    role="radio"
                    type="button"
                  >
                    <Bot aria-hidden="true" size={16} />
                    Telegram
                  </button>
                  <button
                    aria-checked={editor.draft.type === "webhook"}
                    aria-label="Webhook"
                    disabled={busy || editor.mode === "edit"}
                    onClick={() =>
                      updateDraft({
                        method: "POST",
                        template: '{"message":"{{monitor.name}}: {{condition.summary}}"}',
                        type: "webhook",
                      })
                    }
                    role="radio"
                    type="button"
                  >
                    <Webhook aria-hidden="true" size={16} />
                    Webhook
                  </button>
                </div>
              </div>

              <fieldset className="destination-category-field">
                <legend>通知分类</legend>
                <div className="destination-category-grid">
                  {notificationCategories.map((category) => (
                    <label key={category}>
                      <input
                        checked={editor.draft.categories.includes(category)}
                        disabled={busy}
                        onChange={(event) =>
                          updateDraft({
                            categories: event.target.checked
                              ? [...editor.draft.categories, category]
                              : editor.draft.categories.filter((current) => current !== category),
                          })
                        }
                        type="checkbox"
                      />
                      {categoryLabels[category].label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {editor.draft.type === "telegram" ? (
                <>
                  <label className="destination-field">
                    <span>Telegram identity</span>
                    <select
                      disabled
                      onChange={(event) => updateDraft({ telegramIdentityId: event.target.value })}
                      value={editor.draft.telegramIdentityId}
                    >
                      {options.telegramIdentityId ? (
                        <option value={options.telegramIdentityId}>{options.telegramIdentityId}</option>
                      ) : (
                        <option value="">未绑定</option>
                      )}
                    </select>
                  </label>
                  <label className="destination-field">
                    <span>Bot token（仅写入）</span>
                    <input
                      autoComplete="new-password"
                      disabled={busy}
                      onChange={(event) => updateDraft({ token: event.target.value })}
                      placeholder={editor.mode === "edit" ? "留空以保留现有 token" : "输入 Bot token"}
                      type="password"
                      value={editor.draft.token}
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="destination-field">
                    <span>请求方法</span>
                    <div aria-label="Webhook 方法" className="destination-segmented" role="radiogroup">
                      {(["GET", "POST"] as const).map((method) => (
                        <button
                          aria-checked={editor.draft.method === method}
                          aria-label={method}
                          disabled={busy}
                          key={method}
                          onClick={() =>
                            updateDraft({
                              method,
                              template:
                                method === "GET"
                                  ? "monitor={{monitor.name}}&pool={{pool.key}}"
                                  : '{"message":"{{monitor.name}}: {{condition.summary}}"}',
                            })
                          }
                          role="radio"
                          type="button"
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="destination-field destination-wide-field">
                    <span>Webhook URL</span>
                    <input
                      aria-invalid={editor.draft.url !== "" && !webhookUrlValid(editor.draft.url)}
                      disabled={busy}
                      onChange={(event) => updateDraft({ url: event.target.value })}
                      spellCheck={false}
                      type="url"
                      value={editor.draft.url}
                    />
                  </label>
                  <label className="destination-field destination-wide-field">
                    <span>签名密钥（仅写入）</span>
                    <input
                      autoComplete="new-password"
                      disabled={busy}
                      onChange={(event) => updateDraft({ secret: event.target.value })}
                      placeholder={editor.mode === "edit" ? "留空以保留现有密钥" : "可选，至少 32 字节"}
                      type="password"
                      value={editor.draft.secret}
                    />
                  </label>
                </>
              )}

              <label className="destination-field destination-template-field">
                <span>{editor.draft.method === "GET" && editor.draft.type === "webhook" ? "查询模板" : "请求模板"}</span>
                <textarea
                  aria-describedby={issue ? "destination-template-error" : undefined}
                  aria-invalid={issue ? "true" : undefined}
                  disabled={busy}
                  onChange={(event) => updateDraft({ template: event.target.value })}
                  spellCheck={false}
                  value={editor.draft.template}
                />
                {issue ? (
                  <small id="destination-template-error" role="alert">
                    {issue}
                  </small>
                ) : null}
              </label>

              <label className="destination-enabled-field">
                <input
                  checked={editor.draft.enabled}
                  disabled={busy}
                  onChange={(event) => updateDraft({ enabled: event.target.checked })}
                  type="checkbox"
                />
                保存后启用
              </label>

              {editor.result ? (
                <div aria-label="本地测试结果" className="local-sink-result" role="status">
                  <strong>{editor.result.sink}</strong>
                  <span>网络调用 {editor.result.networkCalls}</span>
                  <span>{editor.result.signed ? "已构造签名" : "无需签名"}</span>
                </div>
              ) : null}
            </div>

            <div className="destination-editor-actions">
              <button
                className="secondary-button"
                disabled={busy || !draftValid(editor, options, "test")}
                onClick={onTest}
                type="button"
              >
                <FlaskConical aria-hidden="true" size={16} />
                本地测试
              </button>
              <span className="destination-action-spacer" />
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={busy} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button
                className="command-button"
                disabled={busy || !draftValid(editor, options, "save")}
                type="submit"
              >
                {busy ? <RefreshCw aria-hidden="true" className="spin-icon" size={16} /> : null}
                保存目的地
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function destinationSummary(destination: NotificationDestination): string {
  if (destination.type === "telegram") return `Identity ${destination.config.telegramIdentityId}`;
  return `${destination.config.method} ${destination.config.url}`;
}

export function NotificationSettings() {
  const client = useMemo(() => new NotificationClient(), []);
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const [destinations, setDestinations] = useState<NotificationDestination[]>([]);
  const [editor, setEditor] = useState<DestinationEditorState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [options, setOptions] = useState<NotificationDestinationOptions>({
    telegramIdentityId: null,
  });
  const [pendingDelete, setPendingDelete] = useState<NotificationDestination | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [statusMessage, setStatusMessage] = useState("正在加载通知设置");
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setStatusMessage("正在加载通知设置");
    try {
      const [nextPreferences, nextOptions, nextDestinations] = await Promise.all([
        client.getPreferences(),
        client.getDestinationOptions(),
        client.listDestinations(),
      ]);
      setPreferences(nextPreferences);
      setOptions(nextOptions);
      setDestinations(nextDestinations);
      setLoadState("ready");
      setStatusMessage("通知设置已同步");
    } catch {
      setLoadState("error");
      setStatusMessage("通知设置加载失败");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePreference = async (category: NotificationCategory, enabled: boolean) => {
    if (!preferences || busy) return;
    const previous = preferences;
    setBusy(true);
    setPreferences({ ...preferences, categories: { ...preferences.categories, [category]: enabled } });
    setStatusMessage("正在保存通知设置");
    try {
      const next = await client.patchPreferences({
        categories: { [category]: enabled },
        expectedRevision: previous.revision,
      });
      setPreferences(next);
      setStatusMessage("通知偏好已保存");
    } catch (error) {
      setPreferences(previous);
      if (error instanceof NotificationRequestError && error.code === "REVISION_CONFLICT") {
        setStatusMessage("通知偏好存在版本冲突");
        await load();
      } else {
        setStatusMessage("通知偏好保存失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEditor = async () => {
    if (!editor || !draftValid(editor, options, "save")) return;
    setBusy(true);
    try {
      if (editor.mode === "create") {
        const created = await client.createDestination(
          createRequest(editor.draft),
          globalThis.crypto.randomUUID(),
        );
        setDestinations((current) => [created, ...current]);
        setEditor(null);
        feedback.show({
          dedupeKey: "notification-destination-created",
          kind: "success",
          title: "通知目的地已添加",
        });
      } else {
        const updated = await client.patchDestination(
          editor.original.destinationId,
          destinationPatch(editor),
        );
        setDestinations((current) =>
          current.map((destination) =>
            destination.destinationId === updated.destinationId ? updated : destination,
          ),
        );
        setEditor(null);
        feedback.show({
          dedupeKey: `notification-destination-saved:${updated.destinationId}`,
          kind: "success",
          title: "通知目的地已保存",
        });
      }
    } catch (error) {
      if (error instanceof NotificationRequestError) {
        setEditor((current) =>
          current
            ? {
                ...current,
                conflict: error.code === "REVISION_CONFLICT",
                errorCode: error.code === "REVISION_CONFLICT" ? null : error.code,
              }
            : current,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const testEditor = async () => {
    if (!editor || !draftValid(editor, options, "test")) return;
    setBusy(true);
    try {
      const result = await client.testDestination(createRequest(editor.draft));
      setEditor((current) => (current ? { ...current, errorCode: null, result } : current));
    } catch (error) {
      setEditor((current) =>
        current
          ? {
              ...current,
              errorCode:
                error instanceof NotificationRequestError
                  ? error.code
                  : "NOTIFICATION_REQUEST_FAILED",
              result: null,
            }
          : current,
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleDestination = async (destination: NotificationDestination, enabled: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await client.patchDestination(destination.destinationId, {
        changes: { enabled },
        expectedRevision: destination.revision,
      });
      setDestinations((current) =>
        current.map((item) => (item.destinationId === updated.destinationId ? updated : item)),
      );
    } catch (error) {
      feedback.show({
        dedupeKey: `notification-toggle-failed:${destination.destinationId}`,
        kind: "error",
        title:
          error instanceof NotificationRequestError && error.code === "REVISION_CONFLICT"
            ? "目的地已被其他会话更新"
            : "目的地状态更新失败",
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteDestination = async () => {
    if (!pendingDelete || busy) return;
    const destination = pendingDelete;
    setBusy(true);
    try {
      await client.deleteDestination(destination.destinationId, destination.revision);
      setDestinations((current) =>
        current.filter((item) => item.destinationId !== destination.destinationId),
      );
      setPendingDelete(null);
      feedback.show({
        dedupeKey: `notification-destination-deleted:${destination.destinationId}`,
        kind: "success",
        title: "通知目的地已删除",
      });
    } catch {
      setPendingDelete(null);
      feedback.show({
        dedupeKey: `notification-delete-failed:${destination.destinationId}`,
        kind: "error",
        title: "通知目的地删除失败",
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const loading = loadState === "loading";
  return (
    <section className="notification-settings" aria-labelledby="notification-settings-title">
      <div className="notification-section-heading">
        <div>
          <Bell aria-hidden="true" size={18} />
          <h2 id="notification-settings-title">通知</h2>
        </div>
        <div className="notification-heading-actions">
          <span aria-label="通知设置状态" role="status">
            {statusMessage}
          </span>
          {loadState === "error" ? (
            <button className="compact-command" onClick={() => void load()} type="button">
              <RefreshCw aria-hidden="true" size={14} />
              重试
            </button>
          ) : null}
        </div>
      </div>

      <div aria-busy={loading} className="notification-preference-panel">
        {notificationCategories.map((category) => (
          <div className="notification-preference-row" key={category}>
            <div>
              <h3>{categoryLabels[category].label}</h3>
              <p>{categoryLabels[category].description}</p>
            </div>
            <NotificationSwitch
              checked={preferences?.categories[category] ?? false}
              disabled={loading || loadState === "error" || busy}
              label={`${categoryLabels[category].label}通知`}
              onChange={(enabled) => void updatePreference(category, enabled)}
            />
          </div>
        ))}
      </div>

      <div className="destination-section-heading">
        <div>
          <Send aria-hidden="true" size={18} />
          <h3>通知目的地</h3>
          <span aria-label={`${destinations.length} 个通知目的地`}>{destinations.length}</span>
        </div>
        <button
          className="command-button"
          disabled={loadState !== "ready" || busy}
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            setEditor({
              conflict: false,
              draft: blankDraft(options),
              errorCode: null,
              mode: "create",
              result: null,
            });
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={16} />
          添加目的地
        </button>
      </div>

      {loadState === "error" ? (
        <div className="destination-state" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          通知配置暂时不可用
        </div>
      ) : !loading && destinations.length === 0 ? (
        <div className="destination-state" role="status">
          <Send aria-hidden="true" size={18} />
          还没有通知目的地
        </div>
      ) : (
        <div className="destination-list">
          {destinations.map((destination) => (
            <article
              aria-label={`目的地 ${destination.name}`}
              className="destination-row"
              key={destination.destinationId}
            >
              <div className="destination-row-icon" aria-hidden="true">
                {destination.type === "telegram" ? <Bot size={18} /> : <Webhook size={18} />}
              </div>
              <div className="destination-row-copy">
                <div>
                  <h4>{destination.name}</h4>
                  <span>{destination.type === "telegram" ? "Telegram" : "Webhook"}</span>
                </div>
                <p title={destinationSummary(destination)}>{destinationSummary(destination)}</p>
                <small>
                  {destination.categories.map((category) => categoryLabels[category].label).join(" · ")}
                  {destination.config.secretConfigured
                    ? destination.type === "webhook"
                      ? " · 已配置签名"
                      : " · 已配置 token"
                    : ""}
                </small>
              </div>
              <div className="destination-row-actions">
                <NotificationSwitch
                  checked={destination.enabled}
                  disabled={busy}
                  label={`${destination.enabled ? "停用" : "启用"}目的地 ${destination.name}`}
                  onChange={(enabled) => void toggleDestination(destination, enabled)}
                />
                <button
                  aria-label={`编辑目的地 ${destination.name}`}
                  className="icon-button"
                  disabled={busy}
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget;
                    setEditor({
                      conflict: false,
                      draft: draftFromDestination(destination),
                      errorCode: null,
                      mode: "edit",
                      original: destination,
                      result: null,
                    });
                  }}
                  title="编辑"
                  type="button"
                >
                  <Pencil aria-hidden="true" size={16} />
                </button>
                <button
                  aria-label={`删除目的地 ${destination.name}`}
                  className="icon-button destination-delete"
                  disabled={busy}
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget;
                    setPendingDelete(destination);
                  }}
                  title="删除"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editor ? (
        <DestinationEditor
          busy={busy}
          editor={editor}
          onChange={setEditor}
          onClose={() => setEditor(null)}
          onSave={() => void saveEditor()}
          onTest={() => void testEditor()}
          options={options}
          returnFocus={() => triggerRef.current?.focus()}
        />
      ) : null}

      <ConfirmDialog
        confirmIcon={<Trash2 aria-hidden="true" size={17} />}
        confirmLabel="确认删除"
        description={pendingDelete?.name ?? ""}
        disabled={busy}
        onConfirm={() => void deleteDestination()}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onReturnFocus={() => triggerRef.current?.focus()}
        open={pendingDelete !== null}
        title="删除通知目的地"
      />
    </section>
  );
}
