export type FeedbackKind = "error" | "info" | "progress" | "success";

export interface FeedbackAction {
  label: string;
  run(): void | Promise<void>;
}

export interface FeedbackInput {
  action?: FeedbackAction;
  dedupeKey?: string;
  description?: string;
  durationMs?: number;
  id?: string;
  kind: FeedbackKind;
  persistent?: boolean;
  title: string;
}

export interface FeedbackRecord extends FeedbackInput {
  id: string;
}

export interface FeedbackControllerOptions {
  limit?: number;
}

export interface FeedbackTaskInput {
  description?: string;
  id: string;
  title: string;
}

export interface FeedbackTaskResult {
  description?: string;
  title: string;
}

export interface FeedbackTask {
  dismiss(): void;
  fail(result: FeedbackTaskResult): void;
  succeed(result: FeedbackTaskResult): void;
  update(result: FeedbackTaskResult): void;
}

const defaultDurations: Record<Exclude<FeedbackKind, "progress">, number> = {
  error: 7_000,
  info: 5_000,
  success: 4_000,
};

export class FeedbackController {
  readonly #limit: number;
  #nextId = 1;
  #records: FeedbackRecord[] = [];
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: FeedbackControllerOptions = {}) {
    this.#limit = Math.max(1, options.limit ?? 4);
  }

  show(input: FeedbackInput): string {
    const duplicateIndex = input.dedupeKey
      ? this.#records.findIndex(({ dedupeKey }) => dedupeKey === input.dedupeKey)
      : -1;
    if (duplicateIndex >= 0) {
      const current = this.#records[duplicateIndex];
      if (!current) throw new Error("Feedback queue index is invalid");
      this.#records[duplicateIndex] = { ...input, id: current.id };
      this.#scheduleClose(this.#records[duplicateIndex]);
      return current.id;
    }

    const id = input.id ?? `feedback-${this.#nextId++}`;
    const record = { ...input, id };
    this.#records.push(record);
    if (this.#records.length > this.#limit) {
      const removed = this.#records.splice(0, this.#records.length - this.#limit);
      for (const item of removed) this.#cancelClose(item.id);
    }
    this.#scheduleClose(record);
    return id;
  }

  dismiss(id: string): void {
    const index = this.#records.findIndex((record) => record.id === id);
    if (index < 0) return;
    this.#records.splice(index, 1);
    this.#cancelClose(id);
  }

  startTask(input: FeedbackTaskInput): FeedbackTask {
    const id = `task-${input.id}`;
    const dedupeKey = `task:${input.id}`;
    this.show({
      ...input,
      dedupeKey,
      id,
      kind: "progress",
      persistent: true,
    });

    const finish = (kind: "error" | "success", result: FeedbackTaskResult) => {
      this.show({ ...result, dedupeKey, id, kind, persistent: false });
    };
    return {
      dismiss: () => this.dismiss(id),
      fail: (result) => finish("error", result),
      succeed: (result) => finish("success", result),
      update: (result) => {
        this.show({ ...result, dedupeKey, id, kind: "progress", persistent: true });
      },
    };
  }

  snapshot(): readonly FeedbackRecord[] {
    return [...this.#records];
  }

  #cancelClose(id: string): void {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
  }

  #scheduleClose(record: FeedbackRecord): void {
    this.#cancelClose(record.id);
    if (record.persistent || record.kind === "progress") return;
    const duration = record.durationMs ?? defaultDurations[record.kind];
    if (duration <= 0) return;
    this.#timers.set(
      record.id,
      setTimeout(() => this.dismiss(record.id), duration),
    );
  }
}
