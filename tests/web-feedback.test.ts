import { FeedbackController } from "../apps/web/src/feedback-controller.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

describe("global feedback controller", () => {
  it("deduplicates equivalent toast events and keeps the queue bounded", () => {
    const feedback = new FeedbackController({ limit: 3 });

    const firstId = feedback.show({
      dedupeKey: "wallet-saved",
      kind: "success",
      title: "钱包已保存",
    });
    const duplicateId = feedback.show({
      dedupeKey: "wallet-saved",
      kind: "success",
      title: "钱包已更新",
    });
    feedback.show({ kind: "info", title: "同步一" });
    feedback.show({ kind: "info", title: "同步二" });
    feedback.show({ kind: "error", title: "同步失败" });

    expect(duplicateId).toBe(firstId);
    expect(feedback.snapshot()).toHaveLength(3);
    expect(feedback.snapshot().map(({ title }) => title)).toEqual([
      "同步一",
      "同步二",
      "同步失败",
    ]);
    expect(feedback.snapshot()).not.toContain(expect.objectContaining({ error: expect.anything() }));
  });

  it("auto-closes transient feedback while long tasks remain persistent", () => {
    vi.useFakeTimers();
    const feedback = new FeedbackController({ limit: 4 });

    feedback.show({ durationMs: 1_000, kind: "success", title: "已保存" });
    const task = feedback.startTask({ id: "local-export", title: "正在导出" });

    vi.advanceTimersByTime(1_000);
    expect(feedback.snapshot()).toEqual([
      expect.objectContaining({ id: "task-local-export", kind: "progress", persistent: true }),
    ]);

    task.succeed({ title: "导出完成" });
    expect(feedback.snapshot()).toEqual([
      expect.objectContaining({ id: "task-local-export", kind: "success", persistent: false }),
    ]);

    vi.advanceTimersByTime(4_000);
    expect(feedback.snapshot()).toEqual([]);
  });
});
