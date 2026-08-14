import { useEffect } from "react";
import { registerSW } from "virtual:pwa-register";

import type { FeedbackController } from "./feedback-controller.js";
import { useFeedback } from "./feedback.js";
import { setupPwaUpdateFeedback, type PwaRegister } from "./pwa-update-controller.js";

let installedController: FeedbackController | null = null;

export function PwaUpdateBridge() {
  const feedback = useFeedback();

  useEffect(() => {
    if (installedController === feedback) return;
    installedController = feedback;
    setupPwaUpdateFeedback({ feedback, register: registerSW as PwaRegister });
  }, [feedback]);

  return null;
}
