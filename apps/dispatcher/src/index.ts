export {
  WebhookDeliveryAdapter,
  WebhookEgressError,
  WebhookEgressPolicy,
  WebhookTransportError,
} from "./webhook-adapter.js";
export type {
  WebhookDeliveryInput,
  WebhookDeliveryResult,
  WebhookHttpRequest,
  WebhookHttpResponse,
  WebhookResolver,
  WebhookTransport,
  WebhookValidatedTarget,
} from "./webhook-adapter.js";

export const dispatcherApp = { name: "@lpbot/dispatcher" } as const;
