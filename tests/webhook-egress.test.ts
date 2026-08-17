import { readFileSync } from "node:fs";

import {
  WebhookDeliveryAdapter,
  WebhookEgressPolicy,
  WebhookTransportError,
  isPublicUnicastAddress,
  type WebhookHttpRequest,
  type WebhookHttpResponse,
} from "../apps/dispatcher/src/webhook-adapter.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const securityContract = JSON.parse(
  readFileSync(
    new URL("../artifacts/acceptance/P03-01/security-contracts.json", import.meta.url),
    "utf8",
  ),
) as {
  ssrf: { blockedIpv4: string[]; blockedIpv6: string[] };
  webhook: { timeoutsMilliseconds: Record<string, number> };
};

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

function adapterForResponses(
  method: "GET" | "POST",
  responses: WebhookHttpResponse[],
  requests: WebhookHttpRequest[] = [],
  now: () => Date = () => new Date("2026-08-18T00:00:00.000Z"),
) {
  return {
    adapter: new WebhookDeliveryAdapter({
      now,
      policy: new WebhookEgressPolicy({
        resolver: { resolve: async () => ({ addresses: ["93.184.216.34"] }) },
      }),
      transport: {
        async send(request) {
          requests.push(structuredClone(request));
          return responses.shift()!;
        },
      },
    }),
    input: {
      config: {
        method,
        template: method === "GET" ? "name={{monitor.name}}" : { name: "{{monitor.name}}" },
        url: "https://hooks.fixture.example/start",
      },
      deliveryId: "delivery-fixture-stable",
      secret: "fixture-hmac-material-at-least-thirty-two-bytes",
      values: { "monitor.name": "LP signal" },
    },
    requests,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("P03-04 Webhook egress", () => {
  it("blocks every frozen address range, mapped private IPv4, and private CNAME answer", async () => {
    for (const cidr of [
      ...securityContract.ssrf.blockedIpv4,
      ...securityContract.ssrf.blockedIpv6,
    ]) {
      expect(isPublicUnicastAddress(cidr.split("/")[0]!), cidr).toBe(false);
    }
    expect(isPublicUnicastAddress("::ffff:192.168.1.20")).toBe(false);
    expect(isPublicUnicastAddress("8.8.8.8")).toBe(true);
    expect(isPublicUnicastAddress("2606:4700:4700::1111")).toBe(true);

    const policy = new WebhookEgressPolicy({
      resolver: {
        async resolve() {
          return {
            addresses: ["93.184.216.34"],
            cnameChain: [
              { addresses: [], hostname: "hooks.fixture.example" },
              { addresses: ["169.254.169.254"], hostname: "alias.fixture.example" },
            ],
          };
        },
      },
    });
    await expect(policy.resolveTarget(new URL("https://hooks.fixture.example/event"))).rejects.toMatchObject(
      { code: "UNSAFE_WEBHOOK_TARGET" },
    );
  });

  it("canonicalizes literal IPv6 without DNS and rejects unsafe URL components", async () => {
    let resolverCalls = 0;
    const policy = new WebhookEgressPolicy({
      resolver: {
        async resolve() {
          resolverCalls += 1;
          throw new Error("literal addresses must not resolve through DNS");
        },
      },
    });
    await expect(
      policy.resolveTarget(new URL("https://[2606:4700:4700::1111]/event")),
    ).resolves.toMatchObject({
      addresses: ["2606:4700:4700::1111"],
      hostname: "2606:4700:4700::1111",
    });
    expect(resolverCalls).toBe(0);

    for (const url of [
      "http://hooks.fixture.example/event",
      "https://user@hooks.fixture.example/event",
      "https://hooks.fixture.example/event#fragment",
      "https://127.1/event",
      "https://0x7f000001/event",
    ]) {
      await expect(policy.resolveTarget(new URL(url)), url).rejects.toMatchObject({
        code: "UNSAFE_WEBHOOK_TARGET",
      });
    }
  });

  it("enforces the two-second DNS budget even when the resolver only settles after abort", async () => {
    vi.useFakeTimers();
    const policy = new WebhookEgressPolicy({
      resolver: {
        async resolve(_hostname, { signal }) {
          return await new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () => resolve({ addresses: ["93.184.216.34"] }),
              { once: true },
            );
          });
        },
      },
    });
    const result = policy.resolveTarget(new URL("https://hooks.fixture.example/event"));
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(result).rejects.toMatchObject({ code: "DNS_TIMEOUT" });
  });

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

  it.each([301, 302, 303, 307, 308])("follows HTTP %i for GET", async (status) => {
    const fixtureAdapter = adapterForResponses("GET", [
      { bodyBytes: 0, headers: { location: "/next" }, status },
      { bodyBytes: 0, headers: {}, status: 204 },
    ]);
    await expect(fixtureAdapter.adapter.deliver(fixtureAdapter.input)).resolves.toEqual({
      acknowledgement: "HTTP_204",
      status: "delivered",
    });
    expect(fixtureAdapter.requests).toHaveLength(2);
    expect(fixtureAdapter.requests.map(({ method }) => method)).toEqual(["GET", "GET"]);
  });

  it.each([
    [301, false],
    [302, false],
    [303, false],
    [307, true],
    [308, true],
  ] as const)("applies the POST redirect policy for HTTP %i", async (status, follows) => {
    const fixtureAdapter = adapterForResponses("POST", [
      { bodyBytes: 0, headers: { location: "/next" }, status },
      { bodyBytes: 0, headers: {}, status: 204 },
    ]);
    await expect(fixtureAdapter.adapter.deliver(fixtureAdapter.input)).resolves.toEqual(
      follows
        ? { acknowledgement: "HTTP_204", status: "delivered" }
        : { errorCode: `HTTP_${status}`, status: "dead" },
    );
    expect(fixtureAdapter.requests).toHaveLength(follows ? 2 : 1);
  });

  it("permits at most three redirects and re-resolves every connection", async () => {
    for (const redirectCount of [3, 4]) {
      const requests: WebhookHttpRequest[] = [];
      const responses = Array.from({ length: redirectCount }, (_, index) => ({
        bodyBytes: 0,
        headers: { location: `/hop-${index + 1}` },
        status: 307,
      }));
      if (redirectCount === 3) responses.push({ bodyBytes: 0, headers: {}, status: 204 });
      let resolutions = 0;
      const adapter = new WebhookDeliveryAdapter({
        policy: new WebhookEgressPolicy({
          resolver: {
            async resolve() {
              resolutions += 1;
              return { addresses: ["93.184.216.34"] };
            },
          },
        }),
        transport: {
          async send(request) {
            requests.push(structuredClone(request));
            return responses.shift()!;
          },
        },
      });
      const { input } = adapterForResponses("POST", []);
      await expect(adapter.deliver(input)).resolves.toEqual(
        redirectCount === 3
          ? { acknowledgement: "HTTP_204", status: "delivered" }
          : { errorCode: "TOO_MANY_REDIRECTS", status: "dead" },
      );
      expect(requests).toHaveLength(4);
      expect(resolutions).toBe(4);
    }
  });

  it.each([
    [200, "delivered", undefined],
    [408, "retry", undefined],
    [425, "retry", undefined],
    [429, "retry", 90],
    [503, "retry", 90],
    [400, "dead", undefined],
    [409, "dead", undefined],
  ] as const)("classifies HTTP %i and bounded Retry-After", async (status, expected, retryAfter) => {
    const fixtureAdapter = adapterForResponses("POST", [
      {
        bodyBytes: 0,
        headers: retryAfter === undefined ? {} : { "retry-after": String(retryAfter) },
        status,
      },
    ]);
    const result = await fixtureAdapter.adapter.deliver(fixtureAdapter.input);
    expect(result.status).toBe(expected);
    if (expected === "retry") expect(result).toMatchObject({ errorCode: `HTTP_${status}` });
    if (retryAfter !== undefined) expect(result).toMatchObject({ retryAfterSeconds: retryAfter });
  });

  it("parses HTTP-date Retry-After, caps it, and enforces response limits", async () => {
    const now = () => new Date("2026-08-18T00:00:00.000Z");
    const dateRetry = adapterForResponses(
      "POST",
      [
        {
          bodyBytes: 0,
          headers: { "retry-after": "Tue, 18 Aug 2026 00:01:30 GMT" },
          status: 429,
        },
      ],
      [],
      now,
    );
    await expect(dateRetry.adapter.deliver(dateRetry.input)).resolves.toMatchObject({
      retryAfterSeconds: 90,
      status: "retry",
    });

    const capped = adapterForResponses("POST", [
      { bodyBytes: 0, headers: { "retry-after": "999999" }, status: 503 },
    ]);
    await expect(capped.adapter.deliver(capped.input)).resolves.toMatchObject({
      retryAfterSeconds: 3_600,
      status: "retry",
    });

    const oversized = adapterForResponses("POST", [
      { bodyBytes: 65_537, headers: {}, status: 200 },
    ]);
    await expect(oversized.adapter.deliver(oversized.input)).resolves.toEqual({
      errorCode: "RESPONSE_TOO_LARGE",
      status: "dead",
    });
  });

  it.each([
    ["CONNECT_TIMEOUT", "retry"],
    ["TLS_TIMEOUT", "retry"],
    ["FIRST_BYTE_TIMEOUT", "retry"],
    ["TOTAL_TIMEOUT", "retry"],
    ["CONNECTION_RESET", "retry"],
    ["TLS_CERTIFICATE_INVALID", "dead"],
    ["RESPONSE_TOO_LARGE", "dead"],
  ] as const)("classifies %s transport failures", async (code, status) => {
    const adapter = new WebhookDeliveryAdapter({
      policy: new WebhookEgressPolicy({
        resolver: { resolve: async () => ({ addresses: ["93.184.216.34"] }) },
      }),
      transport: { send: async () => Promise.reject(new WebhookTransportError(code)) },
    });
    const { input } = adapterForResponses("POST", []);
    await expect(adapter.deliver(input)).resolves.toEqual({ errorCode: code, status });
  });

  it("passes the frozen timeout/TLS/proxy contract to every injected request", async () => {
    const fixtureAdapter = adapterForResponses("POST", [
      { bodyBytes: 0, headers: {}, status: 204 },
    ]);
    await fixtureAdapter.adapter.deliver(fixtureAdapter.input);
    expect(fixtureAdapter.requests[0]).toMatchObject({
      minimumTlsVersion: "TLSv1.2",
      proxy: false,
      timeouts: {
        connectMilliseconds: securityContract.webhook.timeoutsMilliseconds.connect,
        dnsMilliseconds: securityContract.webhook.timeoutsMilliseconds.dns,
        firstByteMilliseconds: securityContract.webhook.timeoutsMilliseconds.firstByte,
        tlsMilliseconds: securityContract.webhook.timeoutsMilliseconds.tls,
        totalMilliseconds: securityContract.webhook.timeoutsMilliseconds.total,
      },
    });
  });
});
