export type DispatchChannel = "telegram" | "webhook";

export interface DispatchOutboxDelivery {
  attemptCount: number;
  channel: DispatchChannel;
  deliveryId: string;
  destinationId: string;
  destinationRevision: number;
  leaseExpiresAt: string | null;
  leaseToken: string | null;
  payload: Record<string, unknown>;
  userId: string;
}

export interface NotificationDispatchOutbox {
  claimDue(input: {
    deliveryIds: string[];
    leaseOwner: string;
    limit: number;
  }): Promise<DispatchOutboxDelivery[]>;
  markDead(input: {
    deliveryId: string;
    errorCode: string;
    leaseToken: string;
  }): Promise<boolean>;
  markDelivered(input: {
    acknowledgement?: string;
    deliveryId: string;
    leaseToken: string;
  }): Promise<boolean>;
  markRetry(input: {
    deliveryId: string;
    errorCode: string;
    leaseToken: string;
    retryAfterSeconds?: number;
  }): Promise<boolean>;
  peekDue(input: { limit: number }): Promise<DispatchOutboxDelivery[]>;
}

interface DispatchDestinationBase {
  destinationId: string;
  name: string;
  revision: number;
  userId: string;
}

export type DispatchDestination =
  | (DispatchDestinationBase & {
      config: {
        method: "GET" | "POST";
        secretRef: string | null;
        template: unknown;
        url: string;
      };
      type: "webhook";
    })
  | (DispatchDestinationBase & {
      config: { secretRef: string | null; telegramIdentityId: string; template: string };
      type: "telegram";
    });

export type DispatchDestinationResult =
  | { destination: DispatchDestination; status: "ready" }
  | { status: "disabled" | "not-found" | "revision-not-found" };

export interface DispatchDestinationStore {
  resolve(delivery: DispatchOutboxDelivery): Promise<DispatchDestinationResult>;
}

export interface DispatchSecretStore {
  read(input: {
    kind: "telegram-bot-token" | "webhook-hmac";
    secretRef: string;
    userId: string;
  }): Promise<string | null>;
}

export type DispatchAdapterResult =
  | { acknowledgement?: string; status: "delivered" }
  | { errorCode: string; retryAfterSeconds?: number; status: "retry" }
  | { errorCode: string; status: "dead" };

export interface DispatchAdapterInput {
  config: DispatchDestination["config"];
  deliveryId: string;
  secret: string;
  signal: AbortSignal;
  userId: string;
  values: Readonly<Record<string, string>>;
}

export interface DispatchAdapter {
  deliver(input: DispatchAdapterInput): Promise<DispatchAdapterResult>;
}

export interface DeliveryRateGate {
  tryAcquire(delivery: DispatchOutboxDelivery, now: Date): boolean;
}

interface FixedWindowLimit {
  intervalMilliseconds: number;
  limit: number;
}

export interface FixedWindowDeliveryRateGateOptions {
  channels?: Partial<Record<DispatchChannel, FixedWindowLimit>>;
  destinations?: Readonly<Record<string, FixedWindowLimit>>;
  global?: FixedWindowLimit;
}

interface WindowState {
  count: number;
  startedAt: number;
}

function validLimit(limit: FixedWindowLimit): boolean {
  return (
    Number.isSafeInteger(limit.limit) &&
    limit.limit > 0 &&
    Number.isSafeInteger(limit.intervalMilliseconds) &&
    limit.intervalMilliseconds > 0
  );
}

export class FixedWindowDeliveryRateGate implements DeliveryRateGate {
  readonly #options: FixedWindowDeliveryRateGateOptions;
  readonly #windows = new Map<string, WindowState>();

  constructor(options: FixedWindowDeliveryRateGateOptions) {
    const limits = [
      ...(options.global ? [options.global] : []),
      ...Object.values(options.channels ?? {}),
      ...Object.values(options.destinations ?? {}),
    ];
    if (limits.some((limit) => !validLimit(limit))) {
      throw new RangeError("DISPATCH_RATE_LIMIT_INVALID");
    }
    this.#options = options;
  }

  tryAcquire(delivery: DispatchOutboxDelivery, now: Date): boolean {
    const timestamp = now.getTime();
    if (!Number.isFinite(timestamp)) return false;
    const limits: Array<{ key: string; value: FixedWindowLimit }> = [];
    if (this.#options.global) limits.push({ key: "global", value: this.#options.global });
    const channel = this.#options.channels?.[delivery.channel];
    if (channel) limits.push({ key: `channel:${delivery.channel}`, value: channel });
    const destination = this.#options.destinations?.[delivery.destinationId];
    if (destination) {
      limits.push({ key: `destination:${delivery.destinationId}`, value: destination });
    }
    const states = limits.map(({ key, value }) => {
      const current = this.#windows.get(key);
      return {
        key,
        state:
          !current || timestamp - current.startedAt >= value.intervalMilliseconds
            ? { count: 0, startedAt: timestamp }
            : current,
        value,
      };
    });
    if (states.some(({ state, value }) => state.count >= value.limit)) return false;
    for (const { key, state } of states) {
      this.#windows.set(key, { count: state.count + 1, startedAt: state.startedAt });
    }
    return true;
  }
}

class UnlimitedDeliveryRateGate implements DeliveryRateGate {
  tryAcquire(): boolean {
    return true;
  }
}

export interface NotificationDispatchBatchResult {
  claimed: number;
  delivered: number;
  failed: number;
  late: number;
  retrying: number;
}

interface DeliveryOutcome {
  kind: "delivered" | "failed" | "late" | "retrying";
}

const destinationErrorCodes = {
  disabled: "DESTINATION_DISABLED",
  "not-found": "DESTINATION_NOT_FOUND",
  "revision-not-found": "DESTINATION_REVISION_NOT_FOUND",
} as const;

function emptyBatch(): NotificationDispatchBatchResult {
  return { claimed: 0, delivered: 0, failed: 0, late: 0, retrying: 0 };
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function templateValues(delivery: DispatchOutboxDelivery, timestamp: string) {
  const payload = delivery.payload;
  const metrics =
    typeof payload.metrics === "object" && payload.metrics !== null && !Array.isArray(payload.metrics)
      ? (payload.metrics as Record<string, unknown>)
      : {};
  return {
    "condition.summary": payloadString(payload, "conditionSummary"),
    "delivery.id": delivery.deliveryId,
    "delivery.timestamp": timestamp,
    "metric.version": payloadString(payload, "metricVersion"),
    "metrics.feeTvlRatio": payloadString(metrics, "feeTvlRatio"),
    "metrics.feesUsd": payloadString(metrics, "feesUsd"),
    "metrics.transactionCount": payloadString(metrics, "transactionCount"),
    "metrics.tvlUsd": payloadString(metrics, "tvlUsd"),
    "metrics.volumeUsd": payloadString(metrics, "volumeUsd"),
    "monitor.id": payloadString(payload, "monitorId"),
    "monitor.name": payloadString(payload, "monitorName"),
    "monitor.revision": payloadString(payload, "monitorRevision"),
    "pool.key": payloadString(payload, "poolKey"),
    "pool.token0": payloadString(payload, "token0"),
    "pool.token1": payloadString(payload, "token1"),
    "window.end": payloadString(payload, "windowEnd"),
  };
}

export class NotificationDispatcher {
  readonly #adapters: Record<DispatchChannel, DispatchAdapter>;
  readonly #batchLimit: number;
  readonly #destinations: DispatchDestinationStore;
  readonly #inFlight = new Set<Promise<DeliveryOutcome>>();
  readonly #leaseOwner: string;
  readonly #now: () => Date;
  readonly #outbox: NotificationDispatchOutbox;
  readonly #rateGate: DeliveryRateGate;
  readonly #secrets: DispatchSecretStore;
  #accepting = true;

  constructor(options: {
    adapters: Record<DispatchChannel, DispatchAdapter>;
    batchLimit?: number;
    destinations: DispatchDestinationStore;
    leaseOwner: string;
    now?: () => Date;
    outbox: NotificationDispatchOutbox;
    rateGate?: DeliveryRateGate;
    secrets: DispatchSecretStore;
  }) {
    const batchLimit = options.batchLimit ?? 100;
    if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 100) {
      throw new RangeError("DISPATCH_BATCH_LIMIT_INVALID");
    }
    if (options.leaseOwner.length < 1 || options.leaseOwner.length > 120) {
      throw new RangeError("DISPATCH_LEASE_OWNER_INVALID");
    }
    this.#adapters = options.adapters;
    this.#batchLimit = batchLimit;
    this.#destinations = options.destinations;
    this.#leaseOwner = options.leaseOwner;
    this.#now = options.now ?? (() => new Date());
    this.#outbox = options.outbox;
    this.#rateGate = options.rateGate ?? new UnlimitedDeliveryRateGate();
    this.#secrets = options.secrets;
  }

  async dispatchBatch(): Promise<NotificationDispatchBatchResult> {
    if (!this.#accepting) return emptyBatch();
    const due = await this.#outbox.peekDue({ limit: this.#batchLimit });
    if (!this.#accepting) return emptyBatch();
    const permitted = due.filter((item) => this.#rateGate.tryAcquire(item, this.#now()));
    if (permitted.length === 0) return emptyBatch();
    const claimed = await this.#outbox.claimDue({
      deliveryIds: permitted.map(({ deliveryId }) => deliveryId),
      leaseOwner: this.#leaseOwner,
      limit: Math.min(this.#batchLimit, permitted.length),
    });
    const tasks = claimed.map((item) => {
      const task = this.#deliver(item);
      this.#inFlight.add(task);
      void task.finally(() => this.#inFlight.delete(task));
      return task;
    });
    const outcomes = await Promise.all(tasks);
    const result = emptyBatch();
    result.claimed = claimed.length;
    for (const { kind } of outcomes) result[kind] += 1;
    return result;
  }

  async run(input: { pollMilliseconds?: number; signal: AbortSignal }): Promise<void> {
    const pollMilliseconds = input.pollMilliseconds ?? 1_000;
    if (!Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 1) {
      throw new RangeError("DISPATCH_POLL_INTERVAL_INVALID");
    }
    const onAbort = () => {
      this.#accepting = false;
    };
    input.signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (this.#accepting && !input.signal.aborted) {
        const result = await this.dispatchBatch();
        if (result.claimed === 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, pollMilliseconds);
            const abort = () => {
              clearTimeout(timer);
              resolve();
            };
            input.signal.addEventListener("abort", abort, { once: true });
          });
        }
      }
    } finally {
      input.signal.removeEventListener("abort", onAbort);
      await this.stop();
    }
  }

  async stop(): Promise<void> {
    this.#accepting = false;
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight]);
    }
  }

  async #deliver(delivery: DispatchOutboxDelivery): Promise<DeliveryOutcome> {
    const leaseToken = delivery.leaseToken;
    if (!leaseToken) return { kind: "late" };
    let resolved: DispatchDestinationResult;
    try {
      resolved = await this.#destinations.resolve(delivery);
    } catch {
      return await this.#retry(delivery, leaseToken, "DESTINATION_LOOKUP_FAILED");
    }
    if (resolved.status !== "ready") {
      return await this.#dead(delivery, leaseToken, destinationErrorCodes[resolved.status]);
    }
    const destination = resolved.destination;
    if (
      destination.destinationId !== delivery.destinationId ||
      destination.revision !== delivery.destinationRevision ||
      destination.userId !== delivery.userId ||
      destination.type !== delivery.channel
    ) {
      return await this.#dead(delivery, leaseToken, "DESTINATION_IDENTITY_MISMATCH");
    }
    const secretRef = destination.config.secretRef;
    if (!secretRef) return await this.#dead(delivery, leaseToken, "SECRET_REF_MISSING");
    let secret: string | null;
    try {
      secret = await this.#secrets.read({
        kind: destination.type === "webhook" ? "webhook-hmac" : "telegram-bot-token",
        secretRef,
        userId: delivery.userId,
      });
    } catch {
      return await this.#retry(delivery, leaseToken, "SECRET_STORE_UNAVAILABLE");
    }
    if (secret === null) return await this.#dead(delivery, leaseToken, "SECRET_NOT_FOUND");

    const controller = new AbortController();
    const leaseExpiry = delivery.leaseExpiresAt ? Date.parse(delivery.leaseExpiresAt) : Number.NaN;
    const budget = Number.isFinite(leaseExpiry) ? Math.max(0, leaseExpiry - this.#now().getTime()) : 0;
    const timer = setTimeout(() => controller.abort(), budget);
    timer.unref?.();
    const expired = new Promise<DispatchAdapterResult>((resolve) => {
      controller.signal.addEventListener(
        "abort",
        () => resolve({ errorCode: "LEASE_BUDGET_EXPIRED", status: "retry" }),
        { once: true },
      );
    });
    let result: DispatchAdapterResult;
    try {
      result = await Promise.race([
        this.#adapters[destination.type].deliver({
          config: destination.config,
          deliveryId: delivery.deliveryId,
          secret,
          signal: controller.signal,
          userId: delivery.userId,
          values: templateValues(delivery, this.#now().toISOString()),
        }),
        expired,
      ]);
    } catch {
      result = { errorCode: "ADAPTER_FAILURE", status: "retry" };
    } finally {
      clearTimeout(timer);
    }
    if (result.status === "delivered") {
      const updated = await this.#outbox.markDelivered({
        ...(result.acknowledgement === undefined
          ? {}
          : { acknowledgement: [...result.acknowledgement].slice(0, 120).join("") }),
        deliveryId: delivery.deliveryId,
        leaseToken,
      });
      return { kind: updated ? "delivered" : "late" };
    }
    if (result.status === "retry") {
      return await this.#retry(
        delivery,
        leaseToken,
        result.errorCode,
        result.retryAfterSeconds,
      );
    }
    return await this.#dead(delivery, leaseToken, result.errorCode);
  }

  async #dead(
    delivery: DispatchOutboxDelivery,
    leaseToken: string,
    errorCode: string,
  ): Promise<DeliveryOutcome> {
    const updated = await this.#outbox.markDead({
      deliveryId: delivery.deliveryId,
      errorCode,
      leaseToken,
    });
    return { kind: updated ? "failed" : "late" };
  }

  async #retry(
    delivery: DispatchOutboxDelivery,
    leaseToken: string,
    errorCode: string,
    retryAfterSeconds?: number,
  ): Promise<DeliveryOutcome> {
    const updated = await this.#outbox.markRetry({
      deliveryId: delivery.deliveryId,
      errorCode,
      leaseToken,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
    return { kind: updated ? "retrying" : "late" };
  }
}
