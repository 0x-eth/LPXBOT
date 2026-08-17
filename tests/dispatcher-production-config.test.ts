import {
  createProductionNotificationDispatcher,
  NodeHttpsWebhookTransport,
  NodeTelegramTransport,
  NodeWebhookResolver,
} from "../apps/dispatcher/src/production.js";
import { describe, expect, it, vi } from "vitest";

describe("P03-04 production Dispatcher configuration", () => {
  it.each(["pool", "secrets", "webhookTransport", "telegramTransport"] as const)(
    "refuses startup when %s is missing",
    (missing) => {
      const options = {
        leaseOwner: "dispatcher-production-fixture",
        pool: { query: vi.fn() },
        secrets: { read: vi.fn() },
        telegramTransport: { send: vi.fn() },
        webhookResolver: { resolve: vi.fn() },
        webhookTransport: { send: vi.fn() },
      } as Record<string, unknown>;
      delete options[missing];
      expect(() => createProductionNotificationDispatcher(options)).toThrow(
        "DISPATCHER_PRODUCTION_CONFIG_INCOMPLETE",
      );
    },
  );

  it("constructs without external I/O when every production boundary is injected", () => {
    const query = vi.fn();
    const secretRead = vi.fn();
    const telegramSend = vi.fn();
    const resolve = vi.fn();
    const webhookSend = vi.fn();
    expect(
      createProductionNotificationDispatcher({
        leaseOwner: "dispatcher-production-fixture",
        pool: { connect: vi.fn(), query },
        secrets: { read: secretRead },
        telegramTransport: { send: telegramSend },
        webhookResolver: { resolve },
        webhookTransport: { send: webhookSend },
      }),
    ).toBeDefined();
    expect(query).not.toHaveBeenCalled();
    expect(secretRead).not.toHaveBeenCalled();
    expect(telegramSend).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(webhookSend).not.toHaveBeenCalled();
  });

  it("provides concrete proxy-independent production resolver and transports", () => {
    expect(new NodeWebhookResolver()).toBeInstanceOf(NodeWebhookResolver);
    expect(new NodeHttpsWebhookTransport()).toBeInstanceOf(NodeHttpsWebhookTransport);
    expect(new NodeTelegramTransport()).toBeInstanceOf(NodeTelegramTransport);
  });
});
