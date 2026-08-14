import { CheckCircle2, CircleAlert, Info, LoaderCircle, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  FeedbackController,
  type FeedbackKind,
  type FeedbackRecord,
} from "./feedback-controller.js";

const FeedbackContext = createContext<FeedbackController | null>(null);

function FeedbackIcon({ kind }: { kind: FeedbackKind }) {
  if (kind === "success") return <CheckCircle2 aria-hidden="true" size={19} />;
  if (kind === "error") return <CircleAlert aria-hidden="true" size={19} />;
  if (kind === "progress") {
    return <LoaderCircle aria-hidden="true" className="feedback-spinner" size={19} />;
  }
  return <Info aria-hidden="true" size={19} />;
}

function FeedbackItem({
  controller,
  record,
}: {
  controller: FeedbackController;
  record: FeedbackRecord;
}) {
  const liveProps =
    record.kind === "error"
      ? ({ role: "alert" } as const)
      : ({ "aria-live": "polite", role: "status" } as const);

  return (
    <article className="feedback-toast" data-feedback-kind={record.kind} {...liveProps}>
      <span className="feedback-icon">
        <FeedbackIcon kind={record.kind} />
      </span>
      <div className="feedback-copy">
        <strong>{record.title}</strong>
        {record.description ? <p>{record.description}</p> : null}
        {record.action ? (
          <button
            className="feedback-action"
            onClick={() => {
              void Promise.resolve(record.action?.run()).catch(() => {
                controller.show({
                  dedupeKey: `action:${record.id}`,
                  kind: "error",
                  title: "操作未完成，请重试",
                });
              });
            }}
            type="button"
          >
            {record.action.label}
          </button>
        ) : null}
      </div>
      {!record.persistent ? (
        <button
          aria-label="关闭通知"
          className="feedback-close"
          onClick={() => controller.dismiss(record.id)}
          title="关闭"
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      ) : (
        <span aria-hidden="true" className="feedback-close-placeholder" />
      )}
    </article>
  );
}

export function FeedbackProvider({
  children,
  controller: suppliedController,
}: {
  children: ReactNode;
  controller?: FeedbackController;
}) {
  const controller = useMemo(
    () => suppliedController ?? new FeedbackController({ limit: 4 }),
    [suppliedController],
  );
  const [records, setRecords] = useState<readonly FeedbackRecord[]>(() => controller.snapshot());

  useEffect(() => controller.subscribe(setRecords), [controller]);

  return (
    <FeedbackContext.Provider value={controller}>
      {children}
      <section aria-label="全局反馈" className="feedback-viewport">
        {records.map((record) => (
          <FeedbackItem controller={controller} key={record.id} record={record} />
        ))}
      </section>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackController {
  const controller = useContext(FeedbackContext);
  if (!controller) throw new Error("FeedbackProvider is missing");
  return controller;
}
