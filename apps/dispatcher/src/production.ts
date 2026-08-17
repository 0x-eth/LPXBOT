import { PostgresMonitorCandidateOutboxRepository } from "@lpbot/worker";
import type { Pool } from "pg";

import {
  FixedWindowDeliveryRateGate,
  NotificationDispatcher,
  type DispatchAdapter,
  type DispatchAdapterInput,
  type DispatchOutboxDelivery,
  type DispatchSecretStore,
  type FixedWindowDeliveryRateGateOptions,
  type NotificationDispatchOutbox,
} from "./dispatcher.js";
import { PostgresDispatchDestinationStore } from "./postgres-dispatch-destination-store.js";
import {
  NodeTelegramTransport,
  TelegramDeliveryAdapter,
  type TelegramTransport,
} from "./telegram-adapter.js";
import {
  NodeHttpsWebhookTransport,
  NodeWebhookResolver,
  WebhookDeliveryAdapter,
  WebhookEgressPolicy,
  type WebhookResolver,
  type WebhookTransport,
} from "./webhook-adapter.js";

type DispatcherPool = Pick<Pool, "connect" | "query">;

function dispatchDelivery(delivery: {
  attemptCount: number;
  channel: "telegram" | "webhook" | "local-sink";
  deliveryId: string;
  destinationId: string;
  destinationRevision: number;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  payload: Record<string, unknown>;
  userId: string;
}): DispatchOutboxDelivery | null {
  return delivery.channel === "local-sink"
    ? null
    : {
        attemptCount: delivery.attemptCount,
        channel: delivery.channel,
        deliveryId: delivery.deliveryId,
        destinationId: delivery.destinationId,
        destinationRevision: delivery.destinationRevision,
        leaseExpiresAt: delivery.leaseExpiresAt,
        leaseToken: delivery.leaseToken,
        payload: delivery.payload,
        userId: delivery.userId,
      };
}

class PostgresDispatchOutbox implements NotificationDispatchOutbox {
  readonly #repository: PostgresMonitorCandidateOutboxRepository;

  constructor(pool: Pool) {
    this.#repository = new PostgresMonitorCandidateOutboxRepository(pool);
  }

  async peekDue(input: { limit: number }) {
    return (await this.#repository.peekDue(input)).flatMap((delivery) => {
      const mapped = dispatchDelivery(delivery);
      return mapped ? [mapped] : [];
    });
  }

  async claimDue(input: { deliveryIds: string[]; leaseOwner: string; limit: number }) {
    return (await this.#repository.claimDue(input)).flatMap((delivery) => {
      const mapped = dispatchDelivery(delivery);
      return mapped ? [mapped] : [];
    });
  }

  async markDead(input: { deliveryId: string; errorCode: string; leaseToken: string }) {
    return await this.#repository.markDead(input);
  }

  async markDelivered(input: {
    acknowledgement?: string;
    deliveryId: string;
    leaseToken: string;
  }) {
    return await this.#repository.markDelivered(input);
  }

  async markRetry(input: {
    deliveryId: string;
    errorCode: string;
    leaseToken: string;
    retryAfterSeconds?: number;
  }) {
    return await this.#repository.markRetry(input);
  }
}

function webhookAdapter(adapter: WebhookDeliveryAdapter): DispatchAdapter {
  return {
    async deliver(input: DispatchAdapterInput) {
      if (!("method" in input.config)) {
        return { errorCode: "DESTINATION_CHANNEL_MISMATCH", status: "dead" };
      }
      return await adapter.deliver({
        config: input.config,
        deliveryId: input.deliveryId,
        secret: input.secret,
        signal: input.signal,
        values: input.values,
      });
    },
  };
}

function telegramAdapter(adapter: TelegramDeliveryAdapter): DispatchAdapter {
  return {
    async deliver(input: DispatchAdapterInput) {
      if (!("telegramIdentityId" in input.config)) {
        return { errorCode: "DESTINATION_CHANNEL_MISMATCH", status: "dead" };
      }
      return await adapter.deliver({
        config: input.config,
        deliveryId: input.deliveryId,
        secret: input.secret,
        signal: input.signal,
        userId: input.userId,
        values: input.values,
      });
    },
  };
}

export interface ProductionNotificationDispatcherOptions {
  batchLimit?: number;
  leaseOwner: string;
  pool?: DispatcherPool;
  rateLimits?: FixedWindowDeliveryRateGateOptions;
  secrets?: DispatchSecretStore;
  telegramTransport?: TelegramTransport;
  webhookResolver?: WebhookResolver;
  webhookTransport?: WebhookTransport;
}

export function createProductionNotificationDispatcher(
  options: ProductionNotificationDispatcherOptions,
): NotificationDispatcher {
  if (
    !options.pool ||
    !options.secrets ||
    !options.webhookTransport ||
    !options.telegramTransport
  ) {
    throw new Error("DISPATCHER_PRODUCTION_CONFIG_INCOMPLETE");
  }
  const pool = options.pool as Pool;
  const destinations = new PostgresDispatchDestinationStore(pool);
  const resolver = options.webhookResolver ?? new NodeWebhookResolver();
  return new NotificationDispatcher({
    adapters: {
      telegram: telegramAdapter(
        new TelegramDeliveryAdapter({
          identities: destinations,
          transport: options.telegramTransport,
        }),
      ),
      webhook: webhookAdapter(
        new WebhookDeliveryAdapter({
          policy: new WebhookEgressPolicy({ resolver }),
          transport: options.webhookTransport,
        }),
      ),
    },
    ...(options.batchLimit === undefined ? {} : { batchLimit: options.batchLimit }),
    destinations,
    leaseOwner: options.leaseOwner,
    outbox: new PostgresDispatchOutbox(pool),
    ...(options.rateLimits
      ? { rateGate: new FixedWindowDeliveryRateGate(options.rateLimits) }
      : {}),
    secrets: options.secrets,
  });
}

export async function runProductionNotificationDispatcher(input: {
  dispatcher: NotificationDispatcher;
  pollMilliseconds?: number;
  signal: AbortSignal;
}): Promise<void> {
  await input.dispatcher.run({
    ...(input.pollMilliseconds === undefined ? {} : { pollMilliseconds: input.pollMilliseconds }),
    signal: input.signal,
  });
}

export { NodeHttpsWebhookTransport, NodeTelegramTransport, NodeWebhookResolver };
