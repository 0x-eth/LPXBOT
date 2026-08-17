import {
  TelegramDeliveryAdapter,
  TelegramTransportError,
  type TelegramTransportRequest,
} from "../apps/dispatcher/src/telegram-adapter.js";
import { describe, expect, it } from "vitest";

const baseInput = {
  config: {
    telegramIdentityId: "900000001",
    template: "<b>{{monitor.name}}</b> {{condition.summary}}",
  },
  deliveryId: "delivery-telegram-stable",
  secret: "fixture-telegram-token-material",
  userId: "user-a",
  values: {
    "condition.summary": "TVL > 10 & fee < 2",
    "monitor.name": "LP <signal>",
  },
};

describe("P03-04 Telegram delivery adapter", () => {
  it("sends escaped HTML only to a currently owned identity and bounds the acknowledgement", async () => {
    const requests: TelegramTransportRequest[] = [];
    const adapter = new TelegramDeliveryAdapter({
      identities: {
        async owns(userId, telegramIdentityId) {
          return userId === "user-a" && telegramIdentityId === "900000001";
        },
      },
      transport: {
        async send(request) {
          requests.push(structuredClone(request));
          return {
            body: { ok: true, result: { message_id: "m".repeat(300) } },
            status: 200,
          };
        },
      },
    });

    await expect(adapter.deliver(baseInput)).resolves.toEqual({
      acknowledgement: `telegram:${"m".repeat(110)}`,
      status: "delivered",
    });
    expect(requests).toEqual([
      expect.objectContaining({
        botToken: "fixture-telegram-token-material",
        chatId: "900000001",
        deliveryId: "delivery-telegram-stable",
        parseMode: "HTML",
        text: "<b>LP &lt;signal&gt;</b> TVL &gt; 10 &amp; fee &lt; 2",
      }),
    ]);
  });

  it("fails closed before transport for a stale owner or oversized message", async () => {
    let calls = 0;
    const adapter = new TelegramDeliveryAdapter({
      identities: { owns: async () => false },
      transport: {
        async send() {
          calls += 1;
          return { body: { ok: true }, status: 200 };
        },
      },
    });
    await expect(adapter.deliver(baseInput)).resolves.toEqual({
      errorCode: "TELEGRAM_IDENTITY_NOT_OWNED",
      status: "dead",
    });
    expect(calls).toBe(0);

    const owned = new TelegramDeliveryAdapter({
      identities: { owns: async () => true },
      transport: {
        async send() {
          calls += 1;
          return { body: { ok: true }, status: 200 };
        },
      },
    });
    await expect(
      owned.deliver({
        ...baseInput,
        config: { ...baseInput.config, template: "{{condition.summary}}" },
        values: { ...baseInput.values, "condition.summary": "x".repeat(4_097) },
      }),
    ).resolves.toEqual({ errorCode: "TELEGRAM_MESSAGE_TOO_LARGE", status: "dead" });
    expect(calls).toBe(0);
  });

  it.each([
    [
      429,
      { error_code: 429, ok: false, parameters: { retry_after: 90 } },
      "retry",
      "TELEGRAM_RATE_LIMITED",
      90,
    ],
    [503, { error_code: 503, ok: false }, "retry", "TELEGRAM_PROVIDER_UNAVAILABLE", undefined],
    [401, { error_code: 401, ok: false }, "dead", "TELEGRAM_AUTHENTICATION_FAILED", undefined],
    [403, { error_code: 403, ok: false }, "dead", "TELEGRAM_PERMISSION_DENIED", undefined],
    [400, { error_code: 400, ok: false }, "dead", "TELEGRAM_FORMAT_INVALID", undefined],
  ] as const)(
    "classifies Telegram HTTP %i without persisting provider text",
    async (status, body, expectedStatus, errorCode, retryAfterSeconds) => {
      const adapter = new TelegramDeliveryAdapter({
        identities: { owns: async () => true },
        transport: { send: async () => ({ body, status }) },
      });
      await expect(adapter.deliver(baseInput)).resolves.toEqual({
        errorCode,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        status: expectedStatus,
      });
    },
  );

  it("classifies network failures as retryable and retains the delivery ID across attempts", async () => {
    const deliveryIds: string[] = [];
    let attempt = 0;
    const adapter = new TelegramDeliveryAdapter({
      identities: { owns: async () => true },
      transport: {
        async send(request) {
          deliveryIds.push(request.deliveryId);
          attempt += 1;
          if (attempt === 1) throw new TelegramTransportError("TELEGRAM_CONNECT_TIMEOUT");
          return { body: { ok: true, result: { message_id: 42 } }, status: 200 };
        },
      },
    });

    await expect(adapter.deliver(baseInput)).resolves.toEqual({
      errorCode: "TELEGRAM_CONNECT_TIMEOUT",
      status: "retry",
    });
    await expect(adapter.deliver(baseInput)).resolves.toEqual({
      acknowledgement: "telegram:42",
      status: "delivered",
    });
    expect(deliveryIds).toEqual(["delivery-telegram-stable", "delivery-telegram-stable"]);
  });

  it.each([
    ["provider\nresponse-must-not-persist", "telegram:accepted"],
    ["9".repeat(111), `telegram:${"9".repeat(110)}`],
  ])("bounds and sanitizes provider acknowledgements", async (messageId, acknowledgement) => {
    const adapter = new TelegramDeliveryAdapter({
      identities: { owns: async () => true },
      transport: {
        send: async () => ({ body: { ok: true, result: { message_id: messageId } }, status: 200 }),
      },
    });
    await expect(adapter.deliver(baseInput)).resolves.toEqual({
      acknowledgement,
      status: "delivered",
    });
  });
});
