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

export class FeedbackController {
  readonly #limit: number;
  #nextId = 1;
  #records: FeedbackRecord[] = [];

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
      return current.id;
    }

    const id = input.id ?? `feedback-${this.#nextId++}`;
    this.#records.push({ ...input, id });
    if (this.#records.length > this.#limit) {
      this.#records.splice(0, this.#records.length - this.#limit);
    }
    return id;
  }

  snapshot(): readonly FeedbackRecord[] {
    return [...this.#records];
  }
}
