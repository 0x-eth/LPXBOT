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
export { TelegramDeliveryAdapter, TelegramTransportError } from "./telegram-adapter.js";
export type {
  TelegramDeliveryInput,
  TelegramDeliveryResult,
  TelegramIdentityOwnershipStore,
  TelegramTransport,
  TelegramTransportRequest,
  TelegramTransportResponse,
} from "./telegram-adapter.js";

export const dispatcherApp = { name: "@lpbot/dispatcher" } as const;
