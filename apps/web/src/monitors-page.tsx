import {
  monitorConditionLimit,
  monitorSupportedMetrics,
  monitorWindowMinutes,
  type Condition,
  type CreateMonitorRequest,
  type Monitor,
  type MonitorMetric,
  type MonitorPage,
  type MonitorSupportedMetric,
  type NotificationDestination,
  type NotificationDeliveryStatus,
  type NotificationHistoryItem,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BellPlus,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  History as HistoryIcon,
  Inbox,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ConfirmDialog, useFeedback } from "./feedback.js";
import { MonitorClient, MonitorRequestError } from "./monitor-client.js";
import { NotificationClient } from "./notification-client.js";
import { parsePoolActionIntent } from "./pool-actions.js";

type MonitorLoadState = "error" | "loading" | "ready" | "stale";

interface ConditionDraft {
  enabled: boolean;
  id: MonitorSupportedMetric;
  key: string;
  operator: "eq" | "gte" | "lte";
  value: string;
}

interface MonitorDraft {
  conditions: ConditionDraft[];
  destinationIds: string[];
  excludeHanToken: boolean;
  excludeHook: boolean;
  name: string;
  poolKey: string;
  windowMinutes: (typeof monitorWindowMinutes)[number];
}

type EditorState =
  | { conflict: boolean; draft: MonitorDraft; mode: "create" }
  | { conflict: boolean; draft: MonitorDraft; mode: "edit"; original: Monitor };

const poolKeyPattern = /^56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;

const metricLabels: Readonly<Record<MonitorMetric, string>> = {
  activeTvlUsd: "active TVL",
  feeTvlRatio: "Fee/TVL",
  feeAtvlRatio: "Fee/aTVL",
  feesUsd: "手续费 (USD)",
  metricVersion: "指标版本",
  transactionCount: "交易数",
  tvlUsd: "TVL (USD)",
  volumeUsd: "成交量 (USD)",
};

function conditionKey(): string {
  return globalThis.crypto.randomUUID();
}

function blankCondition(): ConditionDraft {
  return { enabled: true, id: "volumeUsd", key: conditionKey(), operator: "gte", value: "" };
}

function blankDraft(poolKey = ""): MonitorDraft {
  return {
    conditions: [blankCondition()],
    destinationIds: [],
    excludeHanToken: true,
    excludeHook: true,
    name: "",
    poolKey,
    windowMinutes: 5,
  };
}

function draftFromMonitor(monitor: Monitor): MonitorDraft {
  return {
    conditions: monitor.conditions.map((condition) => {
      if (!monitorSupportedMetrics.some((metric) => metric === condition.id)) {
        throw new RangeError("Unsupported monitor metric");
      }
      return {
        ...condition,
        id: condition.id as MonitorSupportedMetric,
        key: conditionKey(),
      };
    }),
    destinationIds: [...monitor.destinationIds],
    excludeHanToken: monitor.excludeHanToken,
    excludeHook: monitor.excludeHook,
    name: monitor.name,
    poolKey: monitor.poolKey,
    windowMinutes: monitor.windowMinutes,
  };
}

function draftConditionValid(condition: ConditionDraft): boolean {
  if (condition.id === "metricVersion") {
    return (
      condition.operator === "eq" && condition.value.length > 0 && condition.value.length <= 80
    );
  }
  if (
    (condition.operator !== "gte" && condition.operator !== "lte") ||
    !decimalPattern.test(condition.value) ||
    condition.value.length > 128
  ) {
    return false;
  }
  return (
    condition.id !== "transactionCount" ||
    (/^\d+$/u.test(condition.value) && BigInt(condition.value) <= BigInt(Number.MAX_SAFE_INTEGER))
  );
}

function draftValid(draft: MonitorDraft): boolean {
  const name = draft.name.trim();
  return (
    name.length > 0 &&
    [...name].length <= 120 &&
    poolKeyPattern.test(draft.poolKey) &&
    draft.conditions.length <= monitorConditionLimit &&
    draft.conditions.every(draftConditionValid)
  );
}

function editorValid(editor: EditorState): boolean {
  return (
    draftValid(editor.draft) &&
    (editor.mode === "create" ||
      !editor.original.enabled ||
      editor.draft.conditions.some(({ enabled }) => enabled))
  );
}

function requestFromDraft(draft: MonitorDraft): CreateMonitorRequest {
  const conditions: Condition[] = draft.conditions.map((condition) =>
    condition.id === "metricVersion"
      ? {
          enabled: condition.enabled,
          id: "metricVersion",
          operator: "eq",
          value: condition.value,
        }
      : {
          enabled: condition.enabled,
          id: condition.id,
          operator: condition.operator as "gte" | "lte",
          value: condition.value,
        },
  );
  return {
    conditions,
    destinationIds: draft.destinationIds,
    excludeHanToken: draft.excludeHanToken,
    excludeHook: draft.excludeHook,
    name: draft.name.trim(),
    poolKey: draft.poolKey as CreateMonitorRequest["poolKey"],
    windowMinutes: draft.windowMinutes,
  };
}

function replaceMonitor(page: MonitorPage, monitor: Monitor): MonitorPage {
  const previous = page.items.find(({ monitorId }) => monitorId === monitor.monitorId);
  if (!previous) return page;
  const items = page.items.map((item) => (item.monitorId === monitor.monitorId ? monitor : item));
  const enabledDelta = Number(monitor.enabled) - Number(previous.enabled);
  return {
    ...page,
    enabledCount: Math.max(0, Math.min(page.totalCount, page.enabledCount + enabledDelta)),
    items,
  };
}

function MonitorEditor({
  busy,
  close,
  destinationLoadState,
  destinations,
  editor,
  onChange,
  onSubmit,
  returnFocus,
}: {
  busy: boolean;
  close(): void;
  destinationLoadState: "error" | "loading" | "ready";
  destinations: readonly NotificationDestination[];
  editor: EditorState;
  onChange(next: EditorState): void;
  onSubmit(): void;
  returnFocus(): void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const updateDraft = (update: (draft: MonitorDraft) => MonitorDraft) =>
    onChange({ ...editor, conflict: false, draft: update(editor.draft) });
  const updateCondition = (key: string, update: Partial<ConditionDraft>) => {
    updateDraft((draft) => ({
      ...draft,
      conditions: draft.conditions.map((condition) =>
        condition.key === key ? { ...condition, ...update } : condition,
      ),
    }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && editorValid(editor)) onSubmit();
  };
  const windowLocked = busy || (editor.mode === "edit" && editor.original.enabled);
  const selectWindow = (minutes: MonitorDraft["windowMinutes"], button?: HTMLButtonElement) => {
    button?.focus();
    updateDraft((draft) => ({ ...draft, windowMinutes: minutes }));
  };
  const onWindowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (windowLocked) return;
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + monitorWindowMinutes.length) % monitorWindowMinutes.length;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % monitorWindowMinutes.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = monitorWindowMinutes.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = monitorWindowMinutes[nextIndex];
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (next !== undefined) selectWindow(next, buttons?.[nextIndex]);
  };

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="monitor-editor"
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
            <div className="monitor-editor-heading">
              <div>
                <p>BSC 监控</p>
                <Dialog.Title>{editor.mode === "create" ? "新建监控" : "编辑监控"}</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭监控编辑器"
                  className="icon-button tooltip-control"
                  data-tooltip="关闭"
                  disabled={busy}
                  title="关闭"
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              创建或编辑 BSC 池监控。所有已启用条件按 AND 组合。
            </Dialog.Description>

            {editor.conflict ? (
              <div className="monitor-editor-conflict" role="alert">
                <CircleAlert aria-hidden="true" size={17} />
                <span>其他会话已更新，当前修改已保留</span>
                {editor.mode === "edit" ? (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      onChange({
                        conflict: false,
                        draft: draftFromMonitor(editor.original),
                        mode: "edit",
                        original: editor.original,
                      })
                    }
                    type="button"
                  >
                    采用最新版本
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="monitor-editor-fields">
              <label className="monitor-field">
                <span>监控名称</span>
                <input
                  disabled={busy}
                  maxLength={120}
                  onChange={(event) =>
                    updateDraft((draft) => ({ ...draft, name: event.target.value }))
                  }
                  ref={nameRef}
                  required
                  type="text"
                  value={editor.draft.name}
                />
              </label>
              <label className="monitor-field monitor-pool-field">
                <span>Pool Key</span>
                <input
                  disabled={busy || editor.mode === "edit"}
                  onChange={(event) =>
                    updateDraft((draft) => ({ ...draft, poolKey: event.target.value }))
                  }
                  pattern="56:0x(?:[0-9a-f]{40}|[0-9a-f]{64})"
                  required
                  spellCheck={false}
                  type="text"
                  value={editor.draft.poolKey}
                />
              </label>
              <div className="monitor-field monitor-window-field">
                <span>评估窗口</span>
                <div aria-label="评估窗口" className="monitor-window-control" role="radiogroup">
                  {monitorWindowMinutes.map((minutes, index) => (
                    <button
                      aria-checked={editor.draft.windowMinutes === minutes}
                      aria-label={`${minutes} 分钟`}
                      className="monitor-window-option"
                      disabled={windowLocked}
                      key={minutes}
                      onClick={(event) => selectWindow(minutes, event.currentTarget)}
                      onKeyDown={(event) => onWindowKeyDown(event, index)}
                      role="radio"
                      tabIndex={editor.draft.windowMinutes === minutes ? 0 : -1}
                      type="button"
                    >
                      {minutes}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <fieldset className="monitor-condition-editor">
              <legend className="sr-only">条件（AND）</legend>
              <div className="monitor-condition-heading">
                <strong aria-hidden="true">条件（AND）</strong>
                <button
                  className="secondary-button"
                  disabled={busy || editor.draft.conditions.length >= monitorConditionLimit}
                  onClick={() =>
                    updateDraft((draft) => ({
                      ...draft,
                      conditions: [...draft.conditions, blankCondition()],
                    }))
                  }
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                  添加条件
                </button>
              </div>
              <div className="monitor-condition-list">
                {editor.draft.conditions.length === 0 ? (
                  <p className="monitor-condition-empty">没有条件，保存后监控将保持未就绪</p>
                ) : null}
                {editor.draft.conditions.map((condition, index) => (
                  <div className="monitor-condition-row" key={condition.key}>
                    <label className="monitor-condition-enabled">
                      <input
                        checked={condition.enabled}
                        disabled={busy}
                        onChange={(event) =>
                          updateCondition(condition.key, { enabled: event.target.checked })
                        }
                        type="checkbox"
                      />
                      <span>启用条件 {index + 1}</span>
                    </label>
                    <label>
                      <span className="sr-only">指标 {index + 1}</span>
                      <select
                        aria-label={`指标 ${index + 1}`}
                        disabled={busy}
                        onChange={(event) => {
                          const id = event.target.value as MonitorSupportedMetric;
                          updateCondition(condition.key, {
                            id,
                            operator: id === "metricVersion" ? "eq" : "gte",
                            value: "",
                          });
                        }}
                        value={condition.id}
                      >
                        {monitorSupportedMetrics.map((metric) => (
                          <option key={metric} value={metric}>
                            {metricLabels[metric]}
                          </option>
                        ))}
                        <option disabled value="activeTvlUsd">
                          active TVL（不可用）
                        </option>
                        <option disabled value="feeAtvlRatio">
                          Fee/aTVL（不可用）
                        </option>
                      </select>
                    </label>
                    <label>
                      <span className="sr-only">运算符 {index + 1}</span>
                      <select
                        aria-label={`运算符 ${index + 1}`}
                        disabled={busy || condition.id === "metricVersion"}
                        onChange={(event) =>
                          updateCondition(condition.key, {
                            operator: event.target.value as "gte" | "lte",
                          })
                        }
                        value={condition.operator}
                      >
                        {condition.id === "metricVersion" ? <option value="eq">等于</option> : null}
                        {condition.id !== "metricVersion" ? (
                          <>
                            <option value="gte">大于等于</option>
                            <option value="lte">小于等于</option>
                          </>
                        ) : null}
                      </select>
                    </label>
                    <label className="monitor-threshold-field">
                      <span className="sr-only">阈值 {index + 1}</span>
                      <input
                        aria-label={`阈值 ${index + 1}`}
                        disabled={busy}
                        inputMode={condition.id === "metricVersion" ? "text" : "decimal"}
                        onChange={(event) =>
                          updateCondition(condition.key, { value: event.target.value })
                        }
                        placeholder={condition.id === "metricVersion" ? "版本" : "阈值"}
                        required
                        type="text"
                        value={condition.value}
                      />
                    </label>
                    <button
                      aria-label={`删除条件 ${index + 1}`}
                      className="icon-button monitor-remove-condition"
                      disabled={busy}
                      onClick={() =>
                        updateDraft((draft) => ({
                          ...draft,
                          conditions: draft.conditions.filter(({ key }) => key !== condition.key),
                        }))
                      }
                      title="删除条件"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </fieldset>

            <fieldset
              aria-busy={destinationLoadState === "loading"}
              className="monitor-destination-editor"
            >
              <legend>通知目的地</legend>
              {destinationLoadState === "loading" ? (
                <p role="status">正在加载通知目的地</p>
              ) : destinationLoadState === "error" ? (
                <p role="alert">通知目的地加载失败，仍可保存监控</p>
              ) : destinations.length === 0 ? (
                <p>还没有可绑定的通知目的地</p>
              ) : (
                <div className="monitor-destination-options">
                  {destinations.map((destination) => {
                    const selected = editor.draft.destinationIds.includes(
                      destination.destinationId,
                    );
                    return (
                      <label key={destination.destinationId}>
                        <input
                          aria-label={destination.name}
                          checked={selected}
                          disabled={busy || (!destination.enabled && !selected)}
                          onChange={(event) =>
                            updateDraft((draft) => ({
                              ...draft,
                              destinationIds: event.target.checked
                                ? [...draft.destinationIds, destination.destinationId]
                                : draft.destinationIds.filter(
                                    (destinationId) => destinationId !== destination.destinationId,
                                  ),
                            }))
                          }
                          type="checkbox"
                        />
                        <span>{destination.name}</span>
                        <small>
                          {destination.type === "telegram" ? "Telegram" : "Webhook"}
                          {destination.enabled ? "" : " · 已停用"}
                        </small>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <div className="monitor-exclusions">
              <label>
                <input
                  checked={editor.draft.excludeHanToken}
                  disabled={busy}
                  onChange={(event) =>
                    updateDraft((draft) => ({ ...draft, excludeHanToken: event.target.checked }))
                  }
                  type="checkbox"
                />
                排除中文 Token
              </label>
              <label>
                <input
                  checked={editor.draft.excludeHook}
                  disabled={busy}
                  onChange={(event) =>
                    updateDraft((draft) => ({ ...draft, excludeHook: event.target.checked }))
                  }
                  type="checkbox"
                />
                排除 Hook 池
              </label>
            </div>

            <div className="monitor-editor-actions">
              <Dialog.Close asChild>
                <button className="secondary-button" disabled={busy} type="button">
                  取消
                </button>
              </Dialog.Close>
              <button
                className="command-button"
                disabled={busy || !editorValid(editor)}
                type="submit"
              >
                {busy ? <RefreshCw aria-hidden="true" className="spin-icon" size={16} /> : null}
                保存监控
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConditionSummary({ conditions }: { conditions: readonly Condition[] }) {
  const enabled = conditions.filter((condition) => condition.enabled);
  if (enabled.length === 0) return <span>无启用条件</span>;
  return (
    <span>
      {enabled
        .map((condition) =>
          condition.id === "metricVersion"
            ? `${metricLabels[condition.id]} = ${condition.value}`
            : `${metricLabels[condition.id]} ${condition.operator === "gte" ? "≥" : "≤"} ${condition.value}`,
        )
        .join(" AND ")}
    </span>
  );
}

const historyStatusLabels: Readonly<Record<NotificationDeliveryStatus, string>> = {
  delivered: "已送达",
  failed: "失败",
  pending: "待发送",
  retrying: "重试中",
  sending: "发送中",
};

function historyTimestamp(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function useMobileHistoryLayout(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function historyQueryTime(value: string): string | undefined {
  if (value === "") return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function HistoryStatus({ status }: { status: NotificationDeliveryStatus }) {
  const Icon =
    status === "delivered"
      ? CheckCircle2
      : status === "sending"
        ? Send
        : status === "failed"
          ? CircleAlert
          : Clock3;
  return (
    <span className="notification-history-status" data-status={status}>
      <Icon aria-hidden="true" size={14} />
      {historyStatusLabels[status]}
    </span>
  );
}

function NotificationHistoryDetails({
  close,
  item,
  returnFocus,
}: {
  close(): void;
  item: NotificationHistoryItem;
  returnFocus(): void;
}) {
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="notification-history-drawer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
        >
          <div className="notification-history-drawer-heading">
            <div>
              <p className="eyebrow">{item.destination.type}</p>
              <Dialog.Title>投递详情</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭投递详情"
                className="icon-button tooltip-control"
                data-tooltip="关闭"
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </Dialog.Close>
          </div>
          <div className="notification-history-drawer-status">
            <HistoryStatus status={item.status} />
            <code>{item.deliveryId}</code>
          </div>
          <dl className="notification-history-details">
            <div>
              <dt>监控</dt>
              <dd>{item.monitorName}</dd>
            </div>
            <div>
              <dt>目的地</dt>
              <dd>{item.destination.name}</dd>
            </div>
            <div>
              <dt>Pool</dt>
              <dd title={item.poolKey}>{item.poolKey}</dd>
            </div>
            <div>
              <dt>窗口</dt>
              <dd>{item.windowMinutes} 分钟</dd>
            </div>
            <div>
              <dt>条件</dt>
              <dd>{item.conditionSummary || "—"}</dd>
            </div>
            <div>
              <dt>尝试次数</dt>
              <dd>{item.attemptCount}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{historyTimestamp(item.createdAt)}</dd>
            </div>
            <div>
              <dt>窗口结束</dt>
              <dd>{historyTimestamp(item.windowEnd)}</dd>
            </div>
            <div>
              <dt>下次重试</dt>
              <dd>{historyTimestamp(item.nextRetryAt)}</dd>
            </div>
            <div>
              <dt>投递时间</dt>
              <dd>{historyTimestamp(item.deliveredAt)}</dd>
            </div>
            <div>
              <dt>错误码</dt>
              <dd>{item.errorCode ?? "—"}</dd>
            </div>
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NotificationHistoryView({
  client,
  monitors,
}: {
  client: NotificationClient;
  monitors: readonly Monitor[];
}) {
  const mobile = useMobileHistoryLayout();
  const [deliveryStatus, setDeliveryStatus] = useState<NotificationDeliveryStatus | "">("");
  const [from, setFrom] = useState("");
  const [items, setItems] = useState<NotificationHistoryItem[]>([]);
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [monitorId, setMonitorId] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<NotificationHistoryItem | null>(null);
  const [to, setTo] = useState("");
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);

  const query = useMemo(() => {
    const fromTimestamp = historyQueryTime(from);
    const toTimestamp = historyQueryTime(to);
    return {
      ...(deliveryStatus === "" ? {} : { deliveryStatus }),
      ...(fromTimestamp === undefined ? {} : { from: fromTimestamp }),
      limit: 25,
      ...(monitorId === "" ? {} : { monitorId }),
      ...(toTimestamp === undefined ? {} : { to: toTimestamp }),
    };
  }, [deliveryStatus, from, monitorId, to]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    setItems([]);
    setNextCursor(null);
    void client
      .listHistory(query, controller.signal)
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setLoadState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState("error");
      });
    return () => controller.abort();
  }, [client, query, reloadKey]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await client.listHistory({ ...query, cursor: nextCursor });
      setItems((current) => {
        const seen = new Set(current.map(({ deliveryId }) => deliveryId));
        return [...current, ...page.items.filter(({ deliveryId }) => !seen.has(deliveryId))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const openDetails = (item: NotificationHistoryItem, trigger: HTMLButtonElement) => {
    detailsTrigger.current = trigger;
    setSelected(item);
  };

  const detailButton = (item: NotificationHistoryItem) => (
    <button
      aria-label={`查看投递 ${item.deliveryId}`}
      className="icon-button tooltip-control"
      data-tooltip="详情"
      onClick={(event) => openDetails(item, event.currentTarget)}
      type="button"
    >
      <ChevronRight aria-hidden="true" size={17} />
    </button>
  );

  return (
    <section aria-label="通知历史" className="notification-history" role="region">
      <div className="notification-history-toolbar">
        <div className="notification-history-filters">
          <label>
            <span>投递状态</span>
            <select
              onChange={(event) =>
                setDeliveryStatus(event.target.value as NotificationDeliveryStatus | "")
              }
              value={deliveryStatus}
            >
              <option value="">全部状态</option>
              {Object.entries(historyStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>监控筛选</span>
            <select onChange={(event) => setMonitorId(event.target.value)} value={monitorId}>
              <option value="">全部监控</option>
              {monitors.map((monitor) => (
                <option key={monitor.monitorId} value={monitor.monitorId}>
                  {monitor.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>开始时间</span>
            <input onChange={(event) => setFrom(event.target.value)} type="datetime-local" value={from} />
          </label>
          <label>
            <span>结束时间</span>
            <input onChange={(event) => setTo(event.target.value)} type="datetime-local" value={to} />
          </label>
        </div>
        <button
          aria-label="刷新通知历史"
          className="icon-button tooltip-control"
          data-tooltip="刷新"
          disabled={loadState === "loading"}
          onClick={() => setReloadKey((value) => value + 1)}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={loadState === "loading" ? "spin-icon" : undefined}
            size={17}
          />
        </button>
      </div>

      {loadState === "loading" ? (
        <div aria-label="正在加载通知历史" className="monitor-page-state" role="status">
          <span aria-hidden="true" className="spinner spinner-small" />
          <p>正在加载通知历史</p>
        </div>
      ) : null}
      {loadState === "error" ? (
        <div className="monitor-page-state monitor-page-error" role="alert">
          <CircleAlert aria-hidden="true" size={20} />
          <p>加载通知历史失败</p>
          <button
            aria-label="重试加载通知历史"
            className="secondary-button"
            onClick={() => setReloadKey((value) => value + 1)}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            重试
          </button>
        </div>
      ) : null}
      {loadState === "ready" && items.length === 0 ? (
        <div aria-label="通知历史为空" className="monitor-page-state" role="status">
          <Inbox aria-hidden="true" size={22} />
          <p>没有符合条件的通知</p>
        </div>
      ) : null}

      {loadState === "ready" && items.length > 0 && !mobile ? (
        <div className="notification-history-table-wrap">
          <table aria-label="通知历史表格" className="notification-history-table">
            <thead>
              <tr>
                <th>状态</th>
                <th>监控</th>
                <th>目的地</th>
                <th>尝试</th>
                <th>下次重试</th>
                <th>错误码</th>
                <th>投递时间</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.deliveryId}>
                  <td><HistoryStatus status={item.status} /></td>
                  <td><strong>{item.monitorName}</strong><small>{item.windowMinutes} 分钟</small></td>
                  <td><span>{item.destination.name}</span><small>{item.destination.type}</small></td>
                  <td>{item.attemptCount}</td>
                  <td>{historyTimestamp(item.nextRetryAt)}</td>
                  <td><code>{item.errorCode ?? "—"}</code></td>
                  <td>{historyTimestamp(item.deliveredAt)}</td>
                  <td>{detailButton(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {loadState === "ready" && items.length > 0 && mobile ? (
        <ul aria-label="通知历史列表" className="notification-history-mobile-list">
          {items.map((item) => (
            <li key={item.deliveryId}>
              <div className="notification-history-mobile-heading">
                <HistoryStatus status={item.status} />
                {detailButton(item)}
              </div>
              <strong>{item.monitorName}</strong>
              <span>{item.destination.name}</span>
              <dl>
                <div><dt>尝试</dt><dd>{item.attemptCount}</dd></div>
                <div><dt>下次重试</dt><dd>{historyTimestamp(item.nextRetryAt)}</dd></div>
                <div><dt>错误码</dt><dd>{item.errorCode ?? "—"}</dd></div>
                <div><dt>投递时间</dt><dd>{historyTimestamp(item.deliveredAt)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      ) : null}

      {loadState === "ready" && nextCursor ? (
        <div className="notification-history-more">
          <button
            aria-label="加载更多通知历史"
            className="secondary-button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? <RefreshCw aria-hidden="true" className="spin-icon" size={16} /> : null}
            加载更多
          </button>
        </div>
      ) : null}

      {selected ? (
        <NotificationHistoryDetails
          close={() => setSelected(null)}
          item={selected}
          returnFocus={() => detailsTrigger.current?.focus()}
        />
      ) : null}
    </section>
  );
}

export function MonitorsPage() {
  const client = useMemo(() => new MonitorClient(), []);
  const notificationClient = useMemo(() => new NotificationClient(), []);
  const feedback = useFeedback();
  const location = useLocation();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [destinationLoadState, setDestinationLoadState] = useState<"error" | "loading" | "ready">(
    "loading",
  );
  const [destinations, setDestinations] = useState<NotificationDestination[]>([]);
  const [loadState, setLoadState] = useState<MonitorLoadState>("loading");
  const [page, setPage] = useState<MonitorPage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Monitor | null>(null);
  const [view, setView] = useState<"history" | "monitors">("monitors");
  const createAttempt = useRef<{ key: string; payload: string } | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const intentConsumed = useRef(false);
  const newTrigger = useRef<HTMLButtonElement | null>(null);
  const pageRef = useRef<MonitorPage | null>(null);
  const historyTab = useRef<HTMLButtonElement | null>(null);
  const monitorTab = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!pageRef.current) setLoadState("loading");
      try {
        const next = await client.list({}, signal);
        pageRef.current = next;
        setPage(next);
        setLoadState("ready");
      } catch {
        if (signal?.aborted) return;
        setLoadState(pageRef.current ? "stale" : "error");
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    void notificationClient
      .listDestinations(controller.signal)
      .then((next) => {
        setDestinations(next);
        setDestinationLoadState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setDestinationLoadState("error");
      });
    return () => controller.abort();
  }, [notificationClient]);

  useEffect(() => {
    if (intentConsumed.current) return;
    const state = location.state as { poolActionIntent?: unknown } | null;
    const intent = parsePoolActionIntent(state?.poolActionIntent);
    if (!intent || intent.action !== "create-monitor") return;
    intentConsumed.current = true;
    editorTrigger.current = newTrigger.current;
    setEditor({ conflict: false, draft: blankDraft(intent.poolKey), mode: "create" });
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const openCreate = (trigger: HTMLButtonElement) => {
    createAttempt.current = null;
    editorTrigger.current = trigger;
    setEditor({ conflict: false, draft: blankDraft(), mode: "create" });
  };

  const closeEditor = () => {
    if (busyId === "editor") return;
    setEditor(null);
    createAttempt.current = null;
  };

  const saveEditor = async () => {
    if (!editor || !editorValid(editor)) return;
    setBusyId("editor");
    const request = requestFromDraft(editor.draft);
    try {
      let saved: Monitor;
      if (editor.mode === "create") {
        const payload = JSON.stringify(request);
        if (createAttempt.current?.payload !== payload) {
          createAttempt.current = { key: crypto.randomUUID(), payload };
        }
        saved = await client.create(request, createAttempt.current.key);
        setPage((current) =>
          current
            ? {
                ...current,
                items: [saved, ...current.items],
                totalCount: current.totalCount + 1,
              }
            : { enabledCount: 0, items: [saved], nextCursor: null, totalCount: 1 },
        );
      } else {
        saved = await client.patch(editor.original.monitorId, {
          changes: {
            conditions: request.conditions,
            destinationIds: editor.draft.destinationIds,
            excludeHanToken: request.excludeHanToken,
            excludeHook: request.excludeHook,
            name: request.name,
            windowMinutes: request.windowMinutes,
          },
          expectedRevision: editor.original.revision,
        });
        setPage((current) => (current ? replaceMonitor(current, saved) : current));
      }
      setLoadState("ready");
      setEditor(null);
      createAttempt.current = null;
      feedback.show({
        dedupeKey: `monitor-saved:${saved.monitorId}:${saved.revision}`,
        kind: "success",
        title: editor.mode === "create" ? "监控已创建" : "监控已更新",
      });
    } catch (error) {
      if (
        error instanceof MonitorRequestError &&
        error.code === "REVISION_CONFLICT" &&
        error.current
      ) {
        setPage((current) => (current ? replaceMonitor(current, error.current!) : current));
        setEditor({
          conflict: true,
          draft: editor.draft,
          mode: "edit",
          original: error.current,
        });
      } else {
        feedback.show({
          dedupeKey: `monitor-save-error:${editor.mode}`,
          kind: "error",
          title: "监控保存失败，请重试",
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  const setLifecycle = async (monitor: Monitor) => {
    setBusyId(monitor.monitorId);
    try {
      const saved = monitor.enabled
        ? await client.disable(monitor.monitorId, monitor.revision)
        : await client.enable(monitor.monitorId, monitor.revision);
      setPage((current) => (current ? replaceMonitor(current, saved) : current));
      setLoadState("ready");
    } catch (error) {
      if (error instanceof MonitorRequestError && error.current) {
        setPage((current) => (current ? replaceMonitor(current, error.current!) : current));
      }
      feedback.show({
        dedupeKey: `monitor-lifecycle-error:${monitor.monitorId}`,
        kind: "error",
        title:
          error instanceof MonitorRequestError && error.code === "REVISION_CONFLICT"
            ? "其他会话已更新，已加载最新版本"
            : "监控状态更新失败，请重试",
      });
    } finally {
      setBusyId(null);
    }
  };

  const deleteMonitor = async () => {
    if (!pendingDelete) return;
    const deleting = pendingDelete;
    setBusyId(deleting.monitorId);
    try {
      await client.delete(deleting.monitorId, deleting.revision);
      setPage((current) => {
        if (!current) return current;
        const items = current.items.filter(({ monitorId }) => monitorId !== deleting.monitorId);
        return {
          ...current,
          enabledCount: Math.max(0, current.enabledCount - Number(deleting.enabled)),
          items,
          totalCount: Math.max(0, current.totalCount - 1),
        };
      });
      setPendingDelete(null);
      feedback.show({
        dedupeKey: `monitor-deleted:${deleting.monitorId}`,
        kind: "success",
        title: "监控已删除",
      });
    } catch (error) {
      if (error instanceof MonitorRequestError && error.current) {
        setPage((current) => (current ? replaceMonitor(current, error.current!) : current));
      }
      setPendingDelete(null);
      feedback.show({
        dedupeKey: `monitor-delete-error:${deleting.monitorId}`,
        kind: "error",
        title:
          error instanceof MonitorRequestError && error.code === "REVISION_CONFLICT"
            ? "其他会话已更新，删除已取消"
            : "监控删除失败，请重试",
      });
    } finally {
      setBusyId(null);
    }
  };

  const state = loadState === "loading" ? "loading" : loadState;
  return (
    <main
      aria-busy={loadState === "loading" ? "true" : undefined}
      className="workspace monitors-workspace"
      data-monitor-state={state}
    >
      <div className="monitors-heading">
        <div>
          <p className="eyebrow">BSC · 条件监控</p>
          <h1>
            <span aria-hidden="true">监控</span>
            <span className="sr-only">Monitors</span>
          </h1>
        </div>
        {view === "monitors" ? <div className="monitor-heading-actions">
          <span
            aria-label={`${page?.enabledCount ?? 0} 个已启用，共 ${page?.totalCount ?? 0} 个监控`}
            className="monitor-count"
          >
            {page?.enabledCount ?? 0}/{page?.totalCount ?? 0}
          </span>
          <button
            aria-label="刷新监控"
            className="icon-button tooltip-control"
            data-tooltip="刷新"
            disabled={loadState === "loading"}
            onClick={() => void load()}
            title="刷新监控"
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={loadState === "loading" ? "spin-icon" : undefined}
              size={18}
            />
          </button>
          <button
            className="command-button monitor-create-button"
            onClick={(event) => openCreate(event.currentTarget)}
            ref={newTrigger}
            type="button"
          >
            <BellPlus aria-hidden="true" size={17} />
            新建监控
          </button>
        </div> : null}
      </div>

      <div aria-label="监控视图" className="monitor-view-tabs" role="tablist">
        <button
          aria-controls="monitor-rules-panel"
          aria-selected={view === "monitors"}
          id="monitor-rules-tab"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            setView("history");
            historyTab.current?.focus();
          }}
          onClick={() => setView("monitors")}
          ref={monitorTab}
          role="tab"
          tabIndex={view === "monitors" ? 0 : -1}
          type="button"
        >
          <BellPlus aria-hidden="true" size={16} />
          监控规则
        </button>
        <button
          aria-controls="notification-history-panel"
          aria-selected={view === "history"}
          id="notification-history-tab"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            setView("monitors");
            monitorTab.current?.focus();
          }}
          onClick={() => setView("history")}
          ref={historyTab}
          role="tab"
          tabIndex={view === "history" ? 0 : -1}
          type="button"
        >
          <HistoryIcon aria-hidden="true" size={16} />
          通知历史
        </button>
      </div>

      {view === "history" ? (
        <div aria-labelledby="notification-history-tab" id="notification-history-panel" role="tabpanel">
          <NotificationHistoryView client={notificationClient} monitors={page?.items ?? []} />
        </div>
      ) : (
        <div aria-labelledby="monitor-rules-tab" id="monitor-rules-panel" role="tabpanel">

      {loadState === "loading" && !page ? (
        <div aria-label="正在加载监控" className="monitor-page-state" role="status">
          <span aria-hidden="true" className="spinner spinner-small" />
          <p>正在加载监控</p>
        </div>
      ) : null}
      {loadState === "error" && !page ? (
        <div className="monitor-page-state monitor-page-error" role="alert">
          <CircleAlert aria-hidden="true" size={20} />
          <p>加载监控失败</p>
          <button className="secondary-button" onClick={() => void load()} type="button">
            <RefreshCw aria-hidden="true" size={16} />
            <span className="sr-only">重试加载监控</span>
            重试
          </button>
        </div>
      ) : null}
      {loadState === "stale" && page ? (
        <div className="monitor-stale" role="alert">
          <CircleAlert aria-hidden="true" size={17} />
          显示的是上次加载的数据
        </div>
      ) : null}
      {page && page.items.length === 0 && loadState !== "loading" ? (
        <div className="monitor-page-state monitor-page-empty" role="status">
          <Inbox aria-hidden="true" size={22} />
          <p>还没有监控</p>
        </div>
      ) : null}

      {page && page.items.length > 0 ? (
        <section aria-label="监控列表" className="monitor-list">
          {page.items.map((monitor) => {
            const ready = monitor.conditions.some(({ enabled }) => enabled);
            const status = monitor.enabled ? "运行中" : ready ? "已停用" : "未就绪";
            return (
              <article
                aria-label={`监控 ${monitor.name}`}
                className="monitor-row"
                data-monitor-ready={ready}
                key={monitor.monitorId}
              >
                <div className="monitor-row-primary">
                  <div className="monitor-name-line">
                    <h2>{monitor.name}</h2>
                    <span data-enabled={monitor.enabled} data-ready={ready}>
                      {status}
                    </span>
                  </div>
                  <code title={monitor.poolKey}>{monitor.poolKey}</code>
                  <p className="monitor-condition-summary">
                    <ConditionSummary conditions={monitor.conditions} />
                  </p>
                </div>
                <dl className="monitor-facts">
                  <div>
                    <dt>窗口</dt>
                    <dd>{monitor.windowMinutes} 分钟</dd>
                  </div>
                  <div>
                    <dt>条件</dt>
                    <dd>{monitor.conditions.filter(({ enabled }) => enabled).length}</dd>
                  </div>
                  <div>
                    <dt>排除</dt>
                    <dd>
                      {[
                        monitor.excludeHanToken ? "中文 Token" : null,
                        monitor.excludeHook ? "Hook" : null,
                      ]
                        .filter(Boolean)
                        .join("、") || "无"}
                    </dd>
                  </div>
                  <div>
                    <dt>通知</dt>
                    <dd>{monitor.destinationIds.length} 个目的地</dd>
                  </div>
                </dl>
                <div className="monitor-row-actions">
                  <button
                    aria-checked={monitor.enabled}
                    aria-label={`${monitor.enabled ? "停用" : "启用"}监控 ${monitor.name}`}
                    className="monitor-lifecycle-switch"
                    disabled={!ready || busyId === monitor.monitorId}
                    onClick={() => void setLifecycle(monitor)}
                    role="switch"
                    title={ready ? (monitor.enabled ? "停用监控" : "启用监控") : "监控未就绪"}
                    type="button"
                  >
                    <Power aria-hidden="true" size={16} />
                    <span aria-hidden="true">{monitor.enabled ? "开" : "关"}</span>
                  </button>
                  <button
                    aria-label={`编辑监控 ${monitor.name}`}
                    className="icon-button tooltip-control"
                    data-tooltip="编辑"
                    disabled={busyId !== null}
                    onClick={(event) => {
                      editorTrigger.current = event.currentTarget;
                      setEditor({
                        conflict: false,
                        draft: draftFromMonitor(monitor),
                        mode: "edit",
                        original: monitor,
                      });
                    }}
                    title="编辑监控"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`删除监控 ${monitor.name}`}
                    className="icon-button danger-button tooltip-control"
                    data-tooltip="删除"
                    disabled={busyId !== null}
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget;
                      setPendingDelete(monitor);
                    }}
                    title="删除监控"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {editor ? (
        <MonitorEditor
          busy={busyId === "editor"}
          close={closeEditor}
          destinationLoadState={destinationLoadState}
          destinations={destinations}
          editor={editor}
          onChange={setEditor}
          onSubmit={() => void saveEditor()}
          returnFocus={() => editorTrigger.current?.focus()}
        />
      ) : null}

      <ConfirmDialog
        confirmIcon={<Trash2 aria-hidden="true" size={17} />}
        confirmLabel="确认删除"
        description={pendingDelete?.name ?? ""}
        disabled={pendingDelete ? busyId === pendingDelete.monitorId : false}
        onConfirm={() => void deleteMonitor()}
        onOpenChange={(open) => {
          if (!open && busyId === null) setPendingDelete(null);
        }}
        onReturnFocus={() => deleteTrigger.current?.focus()}
        open={pendingDelete !== null}
        title="删除监控"
      />
        </div>
      )}
    </main>
  );
}
