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
export { FixedWindowDeliveryRateGate, NotificationDispatcher } from "./dispatcher.js";
export type {
  DeliveryRateGate,
  DispatchAdapter,
  DispatchAdapterInput,
  DispatchAdapterResult,
  DispatchChannel,
  DispatchDestination,
  DispatchDestinationResult,
  DispatchDestinationStore,
  DispatchOutboxDelivery,
  DispatchSecretStore,
  FixedWindowDeliveryRateGateOptions,
  NotificationDispatchBatchResult,
  NotificationDispatchOutbox,
} from "./dispatcher.js";
export { PostgresDispatchDestinationStore } from "./postgres-dispatch-destination-store.js";
export {
  createProductionNotificationDispatcher,
  NodeHttpsWebhookTransport,
  NodeTelegramTransport,
  NodeWebhookResolver,
  runProductionNotificationDispatcher,
} from "./production.js";
export type { ProductionNotificationDispatcherOptions } from "./production.js";

export const dispatcherApp = { name: "@lpbot/dispatcher" } as const;
