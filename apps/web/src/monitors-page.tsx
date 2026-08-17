import {
  monitorConditionLimit,
  monitorSupportedMetrics,
  monitorWindowMinutes,
  type Condition,
  type CreateMonitorRequest,
  type Monitor,
  type MonitorPage,
  type MonitorSupportedMetric,
} from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import {
  BellPlus,
  CircleAlert,
  Inbox,
  Pencil,
  Plus,
  Power,
  RefreshCw,
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
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ConfirmDialog, useFeedback } from "./feedback.js";
import { MonitorClient, MonitorRequestError } from "./monitor-client.js";
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

const metricLabels: Readonly<Record<MonitorSupportedMetric, string>> = {
  feeTvlRatio: "Fee/TVL",
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
    excludeHanToken: true,
    excludeHook: true,
    name: "",
    poolKey,
    windowMinutes: 5,
  };
}

function draftFromMonitor(monitor: Monitor): MonitorDraft {
  return {
    conditions: monitor.conditions.map((condition) => ({
      ...condition,
      key: conditionKey(),
    })),
    excludeHanToken: monitor.excludeHanToken,
    excludeHook: monitor.excludeHook,
    name: monitor.name,
    poolKey: monitor.poolKey,
    windowMinutes: monitor.windowMinutes,
  };
}

function draftConditionValid(condition: ConditionDraft): boolean {
  if (condition.id === "metricVersion") {
    return condition.operator === "eq" && condition.value.length > 0 && condition.value.length <= 80;
  }
  if (
    (condition.operator !== "gte" && condition.operator !== "lte") ||
    !decimalPattern.test(condition.value) ||
    condition.value.length > 128
  ) {
    return false;
  }
  return condition.id !== "transactionCount" || /^\d+$/u.test(condition.value);
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
    excludeHanToken: draft.excludeHanToken,
    excludeHook: draft.excludeHook,
    name: draft.name.trim(),
    poolKey: draft.poolKey as CreateMonitorRequest["poolKey"],
    windowMinutes: draft.windowMinutes,
  };
}

function replaceMonitor(page: MonitorPage, monitor: Monitor): MonitorPage {
  const items = page.items.map((item) => (item.monitorId === monitor.monitorId ? monitor : item));
  return { ...page, enabledCount: items.filter(({ enabled }) => enabled).length, items };
}

function MonitorEditor({
  busy,
  close,
  editor,
  onChange,
  onSubmit,
  returnFocus,
}: {
  busy: boolean;
  close(): void;
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
    if (!busy && draftValid(editor.draft)) onSubmit();
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
                其他会话已更新，已加载最新版本
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
              <label className="monitor-field monitor-window-field">
                <span>评估窗口</span>
                <select
                  disabled={busy || (editor.mode === "edit" && editor.original.enabled)}
                  onChange={(event) =>
                    updateDraft((draft) => ({
                      ...draft,
                      windowMinutes: Number(event.target.value) as MonitorDraft["windowMinutes"],
                    }))
                  }
                  value={editor.draft.windowMinutes}
                >
                  {monitorWindowMinutes.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} 分钟
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="monitor-condition-editor">
              <div className="monitor-condition-heading">
                <legend>条件（AND）</legend>
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
                disabled={busy || !draftValid(editor.draft)}
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

export function MonitorsPage() {
  const client = useMemo(() => new MonitorClient(), []);
  const feedback = useFeedback();
  const location = useLocation();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [loadState, setLoadState] = useState<MonitorLoadState>("loading");
  const [page, setPage] = useState<MonitorPage | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Monitor | null>(null);
  const createAttempt = useRef<{ key: string; payload: string } | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const intentConsumed = useRef(false);
  const newTrigger = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!page) setLoadState("loading");
      try {
        const next = await client.list({}, signal);
        setPage(next);
        setLoadState("ready");
      } catch (error) {
        if (signal?.aborted) return;
        setLoadState(page ? "stale" : "error");
      }
    },
    [client, page],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
    if (!editor || !draftValid(editor.draft)) return;
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
      if (error instanceof MonitorRequestError && error.code === "REVISION_CONFLICT" && error.current) {
        setPage((current) => (current ? replaceMonitor(current, error.current!) : current));
        setEditor({
          conflict: true,
          draft: draftFromMonitor(error.current),
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
          enabledCount: items.filter(({ enabled }) => enabled).length,
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
        <div className="monitor-heading-actions">
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
        </div>
      </div>

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
                      {[monitor.excludeHanToken ? "中文 Token" : null, monitor.excludeHook ? "Hook" : null]
                        .filter(Boolean)
                        .join("、") || "无"}
                    </dd>
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
    </main>
  );
}
