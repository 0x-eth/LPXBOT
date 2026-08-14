import type { FeedbackController } from "./feedback-controller.js";

export interface PwaServiceWorkerRegistration {
  update(): Promise<void>;
}

export interface PwaRegisterOptions {
  immediate?: boolean;
  onNeedRefresh?(): void;
  onRegisterError?(error: unknown): void;
  onRegisteredSW?(scriptUrl: string, registration: PwaServiceWorkerRegistration | undefined): void;
}

export type PwaRegister = (
  options: PwaRegisterOptions,
) => (reloadPage?: boolean) => Promise<void>;

export function setupPwaUpdateFeedback({
  feedback,
  register,
  reload = () => window.location.reload(),
}: {
  feedback: FeedbackController;
  register: PwaRegister;
  reload?: () => void;
}): void {
  let registration: PwaServiceWorkerRegistration | undefined;
  let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => undefined;

  updateServiceWorker = register({
    immediate: true,
    onNeedRefresh: () => {
      feedback.show({
        action: {
          label: "重新加载",
          run: async () => {
            feedback.dismiss("pwa-update-ready");
            await updateServiceWorker(true);
          },
        },
        dedupeKey: "pwa-update-ready",
        id: "pwa-update-ready",
        kind: "info",
        persistent: true,
        title: "新版本可用",
      });
    },
    onRegisterError: () => {
      feedback.show({
        action: {
          label: "重试",
          run: async () => {
            if (registration) await registration.update();
            else reload();
          },
        },
        dedupeKey: "pwa-update-failed",
        id: "pwa-update-failed",
        kind: "error",
        persistent: true,
        title: "更新检查失败",
      });
    },
    onRegisteredSW: (_scriptUrl, nextRegistration) => {
      registration = nextRegistration;
    },
  });
}
