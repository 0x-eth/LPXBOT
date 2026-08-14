import { FeedbackController } from "../apps/web/src/feedback-controller.js";
import {
  setupPwaUpdateFeedback,
  type PwaRegisterOptions,
} from "../apps/web/src/pwa-update-controller.js";
import { describe, expect, it, vi } from "vitest";

describe("PWA update feedback", () => {
  it("requires an explicit reload and retries a failed update safely", async () => {
    const feedback = new FeedbackController({ limit: 4 });
    let callbacks: PwaRegisterOptions | undefined;
    const updateServiceWorker = vi.fn(async () => undefined);
    const updateRegistration = vi.fn(async () => undefined);
    const register = vi.fn((options: PwaRegisterOptions) => {
      callbacks = options;
      return updateServiceWorker;
    });

    setupPwaUpdateFeedback({ feedback, register });
    callbacks?.onRegisteredSW?.("/sw.js", { update: updateRegistration });
    callbacks?.onNeedRefresh?.();

    const refreshToast = feedback.snapshot().find(({ id }) => id === "pwa-update-ready");
    expect(refreshToast).toMatchObject({ kind: "info", persistent: true, title: "新版本可用" });
    await refreshToast?.action?.run();
    expect(updateServiceWorker).toHaveBeenCalledWith(true);

    callbacks?.onRegisterError?.(new Error("INTERNAL_UPDATE_TOKEN requestBody={fixture}"));
    const errorToast = feedback.snapshot().find(({ id }) => id === "pwa-update-failed");
    expect(errorToast).toMatchObject({ kind: "error", title: "更新检查失败" });
    expect(JSON.stringify(errorToast)).not.toMatch(/INTERNAL_UPDATE_TOKEN|requestBody/u);
    await errorToast?.action?.run();
    expect(updateRegistration).toHaveBeenCalledOnce();
  });
});
