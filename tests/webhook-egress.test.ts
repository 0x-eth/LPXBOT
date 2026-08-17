import { readFileSync } from "node:fs";

import {
  WebhookDeliveryAdapter,
  WebhookEgressPolicy,
  type WebhookHttpRequest,
  type WebhookHttpResponse,
} from "../apps/dispatcher/src/webhook-adapter.js";
import { describe, expect, it } from "vitest";

interface SsrfCase {
  connectionCount?: number;
  dnsAnswers?: string[][];
  dnsByHost?: Record<string, string[]>;
  expected: {
    allowed: boolean;
    error?: string;
    method?: "POST";
    validatedAddressCount?: number;
    validatedHopCount?: number;
  };
  hops?: Array<{ location: string; status: number }>;
  id: string;
  url: string;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../artifacts/acceptance/P03-01/fixtures/ssrf-policy.json", import.meta.url),
    "utf8",
  ),
) as { input: { cases: SsrfCase[] } };

function resolverFromAnswers(answers: string[][]) {
  let index = 0;
  return {
    calls: 0,
    async resolve() {
      this.calls += 1;
      return { addresses: answers[Math.min(index++, answers.length - 1)] ?? [] };
    },
  };
}

describe("P03-04 Webhook egress", () => {
  it("replays every frozen IPv4, IPv6, mixed-answer, and rebinding decision", async () => {
    for (const scenario of fixture.input.cases.filter(({ dnsAnswers }) => dnsAnswers)) {
      const resolver = resolverFromAnswers(scenario.dnsAnswers!);
      const policy = new WebhookEgressPolicy({ resolver });
      let result: Awaited<ReturnType<WebhookEgressPolicy["resolveTarget"]>> | null = null;
      let error: unknown;
      try {
        for (let attempt = 0; attempt < (scenario.connectionCount ?? 1); attempt += 1) {
          result = await policy.resolveTarget(new URL(scenario.url));
        }
      } catch (caught) {
        error = caught;
      }

      if (scenario.expected.allowed) {
        expect(error, scenario.id).toBeUndefined();
        expect(result?.addresses, scenario.id).toHaveLength(
          scenario.expected.validatedAddressCount ?? scenario.dnsAnswers!.at(-1)!.length,
        );
      } else {
        expect(error, scenario.id).toMatchObject({ code: scenario.expected.error });
      }
      expect(resolver.calls, scenario.id).toBe(scenario.connectionCount ?? 1);
    }
  });

  it("revalidates and re-signs each public redirect while pinning the verified address", async () => {
    const scenario = fixture.input.cases.find(({ id }) => id === "redirect-all-public")!;
    const requests: WebhookHttpRequest[] = [];
    const resolver = {
      async resolve(hostname: string) {
        return { addresses: scenario.dnsByHost![hostname] ?? [] };
      },
    };
    const responses: WebhookHttpResponse[] = [
      ...scenario.hops!.map(({ location, status }) => ({
        bodyBytes: 0,
        headers: { location },
        status,
      })),
      { bodyBytes: 0, headers: {}, status: 204 },
    ];
    const adapter = new WebhookDeliveryAdapter({
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      policy: new WebhookEgressPolicy({ resolver }),
      transport: {
        async send(request) {
          requests.push(structuredClone(request));
          return responses.shift()!;
        },
      },
    });

    await expect(
      adapter.deliver({
        config: {
          method: "POST",
          template: { monitor: "{{monitor.name}}" },
          url: scenario.url,
        },
        deliveryId: "delivery-fixture-stable",
        secret: "fixture-hmac-material-at-least-thirty-two-bytes",
        values: { "monitor.name": "LP <signal>" },
      }),
    ).resolves.toEqual({ acknowledgement: "HTTP_204", status: "delivered" });

    expect(requests).toHaveLength(scenario.expected.validatedHopCount);
    expect(requests.map(({ method }) => method)).toEqual(["POST", "POST", "POST"]);
    expect(requests.map(({ servername }) => servername)).toEqual([
      "hooks.fixture.example",
      "edge.fixture.example",
      "final.fixture.example",
    ]);
    expect(requests.map(({ connectAddress }) => connectAddress)).toEqual([
      "93.184.216.34",
      "8.8.8.8",
      "1.1.1.1",
    ]);
    expect(requests.every(({ headers }) => !Object.hasOwn(headers, "authorization"))).toBe(true);
    expect(requests.every(({ headers }) => !Object.hasOwn(headers, "cookie"))).toBe(true);
    expect(new Set(requests.map(({ headers }) => headers["x-lpx-delivery-id"]))).toEqual(
      new Set(["delivery-fixture-stable"]),
    );
    expect(new Set(requests.map(({ headers }) => headers["x-lpx-signature"])).size).toBe(3);
    expect(requests.every(({ minimumTlsVersion, proxy }) => minimumTlsVersion === "TLSv1.2" && !proxy)).toBe(
      true,
    );
  });

  it("blocks a private redirect before the second HTTP request", async () => {
    const scenario = fixture.input.cases.find(({ id }) => id === "redirect-to-private")!;
    let calls = 0;
    const adapter = new WebhookDeliveryAdapter({
      policy: new WebhookEgressPolicy({
        resolver: {
          async resolve(hostname: string) {
            return { addresses: scenario.dnsByHost![hostname] ?? [] };
          },
        },
      }),
      transport: {
        async send() {
          calls += 1;
          return {
            bodyBytes: 0,
            headers: { location: scenario.hops![0]!.location },
            status: scenario.hops![0]!.status,
          };
        },
      },
    });

    await expect(
      adapter.deliver({
        config: { method: "POST", template: {}, url: scenario.url },
        deliveryId: "delivery-private-redirect",
        secret: "fixture-hmac-material-at-least-thirty-two-bytes",
        values: {},
      }),
    ).resolves.toMatchObject({ errorCode: "UNSAFE_WEBHOOK_TARGET", status: "dead" });
    expect(calls).toBe(1);
  });
});
