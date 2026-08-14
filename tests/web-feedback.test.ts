import { FeedbackController } from "../apps/web/src/feedback-controller.js";
import { describe, expect, it } from "vitest";

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
});
