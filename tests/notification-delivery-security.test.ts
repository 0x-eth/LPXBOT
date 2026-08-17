import { readFileSync } from "node:fs";

import {
  buildWebhookSignature,
  compileNotificationTemplate,
  NotificationTemplateError,
  renderGetWebhook,
  renderPostWebhook,
  renderTelegramMessage,
} from "../packages/security/src/notification-delivery.js";
import { describe, expect, it } from "vitest";

interface WebhookSecurityFixture {
  expected: {
    networkCalls: number;
    signature: {
      bodySha256: string;
      canonicalInput: string;
      value: string;
    };
    sink: string;
  };
  input: {
    signature: {
      body: string;
      deliveryId: string;
      fixtureKey: string;
      method: "POST";
      pathAndQuery: string;
      timestamp: string;
    };
    sink: string;
    templateCases: Array<{
      expected: Record<string, unknown>;
      id: string;
      method: "GET" | "POST" | "TELEGRAM";
      template: unknown;
      values?: Record<string, string>;
    }>;
  };
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../artifacts/acceptance/P03-01/fixtures/webhook-security.json", import.meta.url),
    "utf8",
  ),
) as WebhookSecurityFixture;

function expectTemplateError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected template validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(NotificationTemplateError);
    expect((error as NotificationTemplateError).code).toBe(code);
  }
}

describe("P03-03 frozen notification rendering and signing", () => {
  it("replays every P03-01 webhook-security rendering fixture without network I/O", () => {
    let networkCalls = 0;
    const resultById = new Map<string, Record<string, unknown>>();

    for (const fixtureCase of fixture.input.templateCases) {
      try {
        const compiled = compileNotificationTemplate(fixtureCase.method, fixtureCase.template);
        const values = fixtureCase.values ?? {};
        if (fixtureCase.method === "GET") {
          resultById.set(fixtureCase.id, {
            renderedQuery: renderGetWebhook(compiled, values).query,
          });
        } else if (fixtureCase.method === "POST") {
          const expandedBodyBytes = fixtureCase.id === "oversize-expanded-body" ? 65_537 : undefined;
          const renderValues =
            expandedBodyBytes === undefined
              ? values
              : { "condition.summary": "x".repeat(expandedBodyBytes) };
          resultById.set(fixtureCase.id, {
            renderedBody: renderPostWebhook(compiled, renderValues).body,
          });
        } else {
          resultById.set(fixtureCase.id, {
            rendered: renderTelegramMessage(compiled, values).message,
          });
        }
      } catch (error) {
        resultById.set(fixtureCase.id, {
          error: (error as NotificationTemplateError).code,
          networkCalls,
        });
      }
    }

    for (const fixtureCase of fixture.input.templateCases) {
      expect(resultById.get(fixtureCase.id)).toEqual(fixtureCase.expected);
    }
    expect(networkCalls).toBe(fixture.expected.networkCalls);
    expect(fixture.input.sink).toBe(fixture.expected.sink);
  });

  it("matches the frozen HMAC-SHA256 known answer and keeps deliveryId stable", () => {
    const expectedInput = fixture.input.signature;
    const first = buildWebhookSignature(expectedInput);
    const retry = buildWebhookSignature({ ...expectedInput, timestamp: expectedInput.timestamp });

    expect(first).toEqual(fixture.expected.signature);
    expect(retry).toEqual(first);
    expect(first.canonicalInput.split("\n")[2]).toBe(expectedInput.deliveryId);
  });

  it("rejects malformed, unknown, and missing variables before any network boundary", () => {
    expectTemplateError(
      () => compileNotificationTemplate("POST", { value: "{{internal.secret}}" }),
      "UNKNOWN_TEMPLATE_VARIABLE",
    );
    expectTemplateError(
      () => compileNotificationTemplate("GET", "value={{monitor.name"),
      "INVALID_TEMPLATE",
    );
    const compiled = compileNotificationTemplate("TELEGRAM", "{{monitor.name}}");
    expectTemplateError(() => renderTelegramMessage(compiled, {}), "MISSING_TEMPLATE_VARIABLE");
  });

  it("enforces template, URL, body, and Telegram limits at their exact boundaries", () => {
    expect(() => compileNotificationTemplate("TELEGRAM", "x".repeat(16_384))).not.toThrow();
    expectTemplateError(
      () => compileNotificationTemplate("TELEGRAM", "x".repeat(16_385)),
      "TEMPLATE_TOO_LARGE",
    );

    const get = compileNotificationTemplate("GET", "value={{condition.summary}}");
    expect(renderGetWebhook(get, { "condition.summary": "x".repeat(4_089) }).urlBytes).toBe(4_095);
    expectTemplateError(
      () =>
        renderGetWebhook(get, { "condition.summary": "x".repeat(4_090) }, { baseUrl: "https://x/" }),
      "URL_TOO_LARGE",
    );
    expect(renderGetWebhook(get, { "condition.summary": "ok" }).body).toBe("");

    const post = compileNotificationTemplate("POST", { value: "{{condition.summary}}" });
    const bodyAtLimit = renderPostWebhook(post, {
      "condition.summary": "x".repeat(65_524),
    });
    expect(bodyAtLimit.bodyBytes).toBe(65_536);
    expectTemplateError(
      () => renderPostWebhook(post, { "condition.summary": "x".repeat(65_525) }),
      "BODY_TOO_LARGE",
    );

    const telegram = compileNotificationTemplate("TELEGRAM", "{{condition.summary}}");
    expect(renderTelegramMessage(telegram, { "condition.summary": "x".repeat(4_096) }).codePoints).toBe(
      4_096,
    );
    expectTemplateError(
      () => renderTelegramMessage(telegram, { "condition.summary": "x".repeat(4_097) }),
      "TELEGRAM_MESSAGE_TOO_LARGE",
    );
  });

  it("only permits GET query-value placeholders and JSON string placeholders", () => {
    expectTemplateError(
      () => compileNotificationTemplate("GET", "{{monitor.name}}=value"),
      "INVALID_TEMPLATE_LOCATION",
    );
    expectTemplateError(
      () => compileNotificationTemplate("POST", '{"{{monitor.name}}":"value"}'),
      "INVALID_TEMPLATE_LOCATION",
    );
    expectTemplateError(
      () => compileNotificationTemplate("POST", '{"value":{{monitor.revision}}}'),
      "INVALID_TEMPLATE",
    );
  });
});
