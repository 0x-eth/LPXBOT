import { Resolver } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";

import {
  buildWebhookSignature,
  compileNotificationTemplate,
  NotificationTemplateError,
  renderGetWebhook,
  renderPostWebhook,
  type NotificationTemplateValues,
} from "@lpbot/security";

const webhookTimeouts = {
  connectMilliseconds: 3_000,
  dnsMilliseconds: 2_000,
  firstByteMilliseconds: 5_000,
  tlsMilliseconds: 3_000,
  totalMilliseconds: 10_000,
} as const;

export type WebhookEgressErrorCode =
  | "DNS_RESOLUTION_FAILED"
  | "DNS_TIMEOUT"
  | "UNSAFE_WEBHOOK_TARGET";

export class WebhookEgressError extends Error {
  readonly code: WebhookEgressErrorCode;

  constructor(code: WebhookEgressErrorCode) {
    super(code);
    this.name = "WebhookEgressError";
    this.code = code;
  }
}

export type WebhookTransportErrorCode =
  | "CONNECT_TIMEOUT"
  | "CONNECTION_RESET"
  | "FIRST_BYTE_TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "TLS_CERTIFICATE_INVALID"
  | "TLS_TIMEOUT"
  | "TOTAL_TIMEOUT";

export class WebhookTransportError extends Error {
  readonly code: WebhookTransportErrorCode;

  constructor(code: WebhookTransportErrorCode) {
    super(code);
    this.name = "WebhookTransportError";
    this.code = code;
  }
}

export interface WebhookResolver {
  resolve(
    hostname: string,
    options: { signal: AbortSignal; timeoutMilliseconds: 2_000 },
  ): Promise<{
    addresses: readonly string[];
    cnameChain?: ReadonlyArray<{ addresses: readonly string[]; hostname: string }>;
  }>;
}

export interface WebhookValidatedTarget {
  addresses: string[];
  hostname: string;
  url: URL;
}

export interface WebhookHttpRequest {
  body: string;
  connectAddress: string;
  headers: Record<string, string>;
  method: "GET" | "POST";
  minimumTlsVersion: "TLSv1.2";
  proxy: false;
  servername: string;
  signal: AbortSignal;
  timeouts: typeof webhookTimeouts;
  url: string;
}

export interface WebhookHttpResponse {
  bodyBytes: number;
  headers: Readonly<Record<string, string | undefined>>;
  status: number;
}

export interface WebhookTransport {
  send(request: WebhookHttpRequest): Promise<WebhookHttpResponse>;
}

export class NodeWebhookResolver implements WebhookResolver {
  readonly #resolver: Resolver;

  constructor(resolver: Resolver = new Resolver()) {
    this.#resolver = resolver;
  }

  async resolve(hostname: string, options: { signal: AbortSignal; timeoutMilliseconds: 2_000 }) {
    void options.timeoutMilliseconds;
    const seen = new Set<string>();
    const chain: Array<{ addresses: string[]; hostname: string }> = [];
    const resolveHost = async (host: string, depth: number): Promise<string[]> => {
      if (depth > 8 || seen.has(host)) throw new WebhookEgressError("DNS_RESOLUTION_FAILED");
      if (options.signal.aborted) throw options.signal.reason;
      seen.add(host);
      const [ipv4, ipv6, cnames] = await Promise.allSettled([
        this.#resolver.resolve4(host),
        this.#resolver.resolve6(host),
        this.#resolver.resolveCname(host),
      ]);
      const addresses = [
        ...(ipv4.status === "fulfilled" ? ipv4.value : []),
        ...(ipv6.status === "fulfilled" ? ipv6.value : []),
      ];
      chain.push({ addresses, hostname: host });
      const aliases = cnames.status === "fulfilled" ? cnames.value : [];
      const aliasAddresses = (
        await Promise.all(aliases.map((alias) => resolveHost(alias.toLowerCase(), depth + 1)))
      ).flat();
      if (options.signal.aborted) throw options.signal.reason;
      return [...addresses, ...aliasAddresses];
    };
    const addresses = [...new Set(await resolveHost(hostname, 0))];
    return { addresses, cnameChain: chain };
  }
}

function webhookNetworkError(error: unknown): WebhookTransportError {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (/^(?:CERT_|ERR_TLS_CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT)/u.test(code)) {
    return new WebhookTransportError("TLS_CERTIFICATE_INVALID");
  }
  return new WebhookTransportError(code === "ECONNRESET" ? "CONNECTION_RESET" : "CONNECTION_RESET");
}

export class NodeHttpsWebhookTransport implements WebhookTransport {
  async send(input: WebhookHttpRequest): Promise<WebhookHttpResponse> {
    const url = new URL(input.url);
    return await new Promise<WebhookHttpResponse>((resolve, reject) => {
      let settled = false;
      let connectTimer: NodeJS.Timeout | undefined;
      let firstByteTimer: NodeJS.Timeout | undefined;
      let tlsTimer: NodeJS.Timeout | undefined;
      let totalTimer: NodeJS.Timeout | undefined;
      const clearTimers = () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (firstByteTimer) clearTimeout(firstByteTimer);
        if (tlsTimer) clearTimeout(tlsTimer);
        if (totalTimer) clearTimeout(totalTimer);
      };
      const finish = (error?: WebhookTransportError, response?: WebhookHttpResponse) => {
        if (settled) return;
        settled = true;
        clearTimers();
        input.signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(response!);
      };
      const request = https.request(
        {
          agent: false,
          headers: input.headers,
          hostname: url.hostname,
          lookup: (_hostname, _options, callback) => {
            callback(null, input.connectAddress, isIP(input.connectAddress));
          },
          method: input.method,
          minVersion: input.minimumTlsVersion,
          path: `${url.pathname}${url.search}`,
          port: url.port === "" ? 443 : Number(url.port),
          rejectUnauthorized: true,
          servername: input.servername,
        },
        (response) => {
          if (firstByteTimer) clearTimeout(firstByteTimer);
          let bodyBytes = 0;
          response.on("data", (chunk: Buffer) => {
            bodyBytes += chunk.byteLength;
            if (bodyBytes > 65_536) {
              request.destroy();
              finish(new WebhookTransportError("RESPONSE_TOO_LARGE"));
            }
          });
          response.once("end", () => {
            const headers = Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [
                key.toLowerCase(),
                Array.isArray(value) ? value[0] : value,
              ]),
            );
            finish(undefined, { bodyBytes, headers, status: response.statusCode ?? 0 });
          });
          response.once("error", (error) => finish(webhookNetworkError(error)));
        },
      );
      const abort = () => {
        request.destroy();
        finish(
          input.signal.reason instanceof WebhookTransportError
            ? input.signal.reason
            : new WebhookTransportError("TOTAL_TIMEOUT"),
        );
      };
      input.signal.addEventListener("abort", abort, { once: true });
      request.once("socket", (socket) => {
        connectTimer = setTimeout(
          () => {
            request.destroy();
            finish(new WebhookTransportError("CONNECT_TIMEOUT"));
          },
          input.timeouts.connectMilliseconds,
        );
        connectTimer.unref?.();
        socket.once("connect", () => {
          if (connectTimer) clearTimeout(connectTimer);
        });
        const tlsSocket = socket as TLSSocket;
        tlsTimer = setTimeout(
          () => {
            request.destroy();
            finish(new WebhookTransportError("TLS_TIMEOUT"));
          },
          input.timeouts.tlsMilliseconds,
        );
        tlsTimer.unref?.();
        tlsSocket.once("secureConnect", () => {
          if (tlsTimer) clearTimeout(tlsTimer);
          if (!tlsSocket.authorized) {
            request.destroy();
            finish(new WebhookTransportError("TLS_CERTIFICATE_INVALID"));
          }
        });
      });
      request.once("error", (error) => finish(webhookNetworkError(error)));
      firstByteTimer = setTimeout(
        () => {
          request.destroy();
          finish(new WebhookTransportError("FIRST_BYTE_TIMEOUT"));
        },
        input.timeouts.firstByteMilliseconds,
      );
      firstByteTimer.unref?.();
      totalTimer = setTimeout(
        () => {
          request.destroy();
          finish(new WebhookTransportError("TOTAL_TIMEOUT"));
        },
        input.timeouts.totalMilliseconds,
      );
      totalTimer.unref?.();
      request.end(input.body);
    });
  }
}

export type WebhookDeliveryResult =
  | { acknowledgement: string; status: "delivered" }
  | { errorCode: string; retryAfterSeconds?: number; status: "retry" }
  | { errorCode: string; status: "dead" };

export interface WebhookDeliveryInput {
  config: { method: "GET" | "POST"; template: unknown; url: string };
  deliveryId: string;
  secret: string;
  signal?: AbortSignal;
  values: NotificationTemplateValues;
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!) >>> 0;
}

function ipv4InCidr(value: number, network: string, prefix: number): boolean {
  const base = ipv4Number(network)!;
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

const blockedIpv4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

function parseIpv6(address: string): bigint | null {
  if (address.includes("%") || isIP(address) !== 6) return null;
  let canonical = address.toLowerCase();
  const dottedIndex = canonical.lastIndexOf(":");
  const dotted = canonical.slice(dottedIndex + 1);
  if (dotted.includes(".")) {
    const value = ipv4Number(dotted);
    if (value === null) return null;
    canonical = `${canonical.slice(0, dottedIndex)}:${(value >>> 16).toString(16)}:${(
      value & 0xffff
    ).toString(16)}`;
  }
  const halves = canonical.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1]!.split(":");
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6InCidr(value: bigint, base: bigint, prefix: number): boolean {
  if (prefix === 0) return true;
  const shift = 128n - BigInt(prefix);
  return value >> shift === base >> shift;
}

const blockedIpv6 = [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const satisfies ReadonlyArray<readonly [string, number]>;

function mappedIpv4(value: bigint): number | null {
  return value >> 32n === 0xffffn ? Number(value & 0xffff_ffffn) : null;
}

export function isPublicUnicastAddress(address: string): boolean {
  const ipv4 = ipv4Number(address);
  if (ipv4 !== null) {
    return !blockedIpv4.some(([network, prefix]) => ipv4InCidr(ipv4, network, prefix));
  }
  const ipv6 = parseIpv6(address);
  if (ipv6 === null) return false;
  const mapped = mappedIpv4(ipv6);
  if (mapped !== null) {
    return !blockedIpv4.some(([network, prefix]) => ipv4InCidr(mapped, network, prefix));
  }
  return !blockedIpv6.some(([network, prefix]) =>
    ipv6InCidr(ipv6, parseIpv6(network)!, prefix),
  );
}

function validateUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.hostname === "" ||
    url.hostname.includes("%")
  ) {
    throw new WebhookEgressError("UNSAFE_WEBHOOK_TARGET");
  }
}

async function timeout<T>(
  milliseconds: number,
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    const reason = signal.reason ?? new WebhookTransportError("TOTAL_TIMEOUT");
    controller.abort(reason);
    rejectAbort(reason);
  };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    const error = new WebhookEgressError("DNS_TIMEOUT");
    controller.abort(error);
    rejectAbort(error);
  }, milliseconds);
  timer.unref?.();
  try {
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export class WebhookEgressPolicy {
  readonly #resolver: WebhookResolver;

  constructor(options: { resolver: WebhookResolver }) {
    this.#resolver = options.resolver;
  }

  async resolveTarget(url: URL, signal: AbortSignal = new AbortController().signal) {
    validateUrl(url);
    const urlHostname = url.hostname.toLowerCase();
    const hostname =
      urlHostname.startsWith("[") && urlHostname.endsWith("]")
        ? urlHostname.slice(1, -1)
        : urlHostname;
    const literal = isIP(hostname) > 0 ? { addresses: [hostname] } : null;
    let resolved: Awaited<ReturnType<WebhookResolver["resolve"]>>;
    try {
      resolved =
        literal ??
        (await timeout(webhookTimeouts.dnsMilliseconds, signal, (dnsSignal) =>
          this.#resolver.resolve(hostname, {
            signal: dnsSignal,
            timeoutMilliseconds: webhookTimeouts.dnsMilliseconds,
          }),
        ));
    } catch (error) {
      if (error instanceof WebhookEgressError) throw error;
      throw new WebhookEgressError("DNS_RESOLUTION_FAILED");
    }
    const chainAddresses = resolved.cnameChain?.flatMap(({ addresses }) => addresses) ?? [];
    const allAddresses = [...chainAddresses, ...resolved.addresses];
    if (resolved.addresses.length === 0) throw new WebhookEgressError("DNS_RESOLUTION_FAILED");
    if (allAddresses.some((address) => !isPublicUnicastAddress(address))) {
      throw new WebhookEgressError("UNSAFE_WEBHOOK_TARGET");
    }
    return {
      addresses: [...new Set(resolved.addresses)],
      hostname,
      url: new URL(url),
    } satisfies WebhookValidatedTarget;
  }
}

function retryAfterSeconds(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  let seconds: number;
  if (/^\d+$/u.test(trimmed)) {
    seconds = Number(trimmed);
  } else {
    seconds = Math.ceil((Date.parse(trimmed) - now.getTime()) / 1_000);
  }
  return Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 3_600) : undefined;
}

function resultForHttp(response: WebhookHttpResponse, now: Date): WebhookDeliveryResult {
  if (response.bodyBytes > 65_536) return { errorCode: "RESPONSE_TOO_LARGE", status: "dead" };
  if (response.status >= 200 && response.status <= 299) {
    return { acknowledgement: `HTTP_${response.status}`, status: "delivered" };
  }
  const errorCode = `HTTP_${response.status}`;
  if (
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    const retryAfter = retryAfterSeconds(response.headers["retry-after"], now);
    return {
      errorCode,
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
      status: "retry",
    };
  }
  return { errorCode, status: "dead" };
}

function transportFailure(error: unknown): WebhookDeliveryResult {
  if (error instanceof WebhookEgressError) {
    return error.code === "UNSAFE_WEBHOOK_TARGET"
      ? { errorCode: error.code, status: "dead" }
      : { errorCode: error.code, status: "retry" };
  }
  if (error instanceof WebhookTransportError) {
    return error.code === "TLS_CERTIFICATE_INVALID" || error.code === "RESPONSE_TOO_LARGE"
      ? { errorCode: error.code, status: "dead" }
      : { errorCode: error.code, status: "retry" };
  }
  return { errorCode: "NETWORK_ERROR", status: "retry" };
}

export class WebhookDeliveryAdapter {
  readonly #now: () => Date;
  readonly #policy: WebhookEgressPolicy;
  readonly #transport: WebhookTransport;

  constructor(options: {
    now?: () => Date;
    policy: WebhookEgressPolicy;
    transport: WebhookTransport;
  }) {
    this.#now = options.now ?? (() => new Date());
    this.#policy = options.policy;
    this.#transport = options.transport;
  }

  async deliver(input: WebhookDeliveryInput): Promise<WebhookDeliveryResult> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", forwardAbort, { once: true });
    const totalTimer = setTimeout(
      () => controller.abort(new WebhookTransportError("TOTAL_TIMEOUT")),
      webhookTimeouts.totalMilliseconds,
    );
    totalTimer.unref?.();
    try {
      const compiled = compileNotificationTemplate(input.config.method, input.config.template);
      let body: string;
      let url: URL;
      if (input.config.method === "GET") {
        const rendered = renderGetWebhook(compiled, input.values, { baseUrl: input.config.url });
        body = rendered.body;
        url = new URL(rendered.url);
      } else {
        body = renderPostWebhook(compiled, input.values).body;
        url = new URL(input.config.url);
      }
      for (let redirects = 0; ; redirects += 1) {
        const target = await this.#policy.resolveTarget(url, controller.signal);
        const timestamp = Math.floor(this.#now().getTime() / 1_000).toString();
        const signature = buildWebhookSignature({
          body,
          deliveryId: input.deliveryId,
          fixtureKey: input.secret,
          method: input.config.method,
          pathAndQuery: `${url.pathname}${url.search}`,
          timestamp,
        });
        const headers: Record<string, string> = {
          "x-lpx-content-sha256": signature.bodySha256,
          "x-lpx-delivery-id": input.deliveryId,
          "x-lpx-signature": signature.value,
          "x-lpx-timestamp": timestamp,
        };
        if (input.config.method === "POST") {
          headers["content-type"] = "application/json; charset=utf-8";
        }
        const response = await this.#transport.send({
          body,
          connectAddress: target.addresses[0]!,
          headers,
          method: input.config.method,
          minimumTlsVersion: "TLSv1.2",
          proxy: false,
          servername: target.hostname,
          signal: controller.signal,
          timeouts: webhookTimeouts,
          url: url.toString(),
        });
        const redirectAllowed =
          input.config.method === "GET"
            ? [301, 302, 303, 307, 308].includes(response.status)
            : response.status === 307 || response.status === 308;
        if (!redirectAllowed) return resultForHttp(response, this.#now());
        if (redirects >= 3) return { errorCode: "TOO_MANY_REDIRECTS", status: "dead" };
        const location = response.headers.location;
        if (!location) return { errorCode: "REDIRECT_LOCATION_INVALID", status: "dead" };
        try {
          url = new URL(location, url);
        } catch {
          return { errorCode: "REDIRECT_LOCATION_INVALID", status: "dead" };
        }
      }
    } catch (error) {
      if (error instanceof NotificationTemplateError) {
        return { errorCode: error.code, status: "dead" };
      }
      return transportFailure(error);
    } finally {
      clearTimeout(totalTimer);
      input.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}
