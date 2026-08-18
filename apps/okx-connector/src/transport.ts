import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

import { OkxConnectorError } from "./errors.js";
import type { OkxCredentialBytes, OkxProviderValidation, OkxReadOnlyTransport } from "./types.js";
import ipaddr from "ipaddr.js";

export const okxProductionEgress = {
  host: "www.okx.com",
  maxResponseBytes: 256 * 1024,
  method: "GET",
  path: "/api/v5/account/config",
  port: 443,
  protocol: "https:",
  timeoutMilliseconds: 8_000,
} as const;

export interface OkxPinnedResponse {
  body: Buffer;
  statusCode: number;
}

export interface OkxPinnedRequest {
  address: string;
  headers: Readonly<Record<string, string>>;
  host: typeof okxProductionEgress.host;
  method: typeof okxProductionEgress.method;
  path: typeof okxProductionEgress.path;
  port: typeof okxProductionEgress.port;
  servername: typeof okxProductionEgress.host;
}

export type OkxDnsResolver = (host: typeof okxProductionEgress.host) => Promise<string[]>;
export type OkxPinnedRequester = (request: OkxPinnedRequest) => Promise<OkxPinnedResponse>;

function ipv4Public(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function ipv6Public(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  const parsed = ipaddr.IPv6.parse(normalized);
  if (parsed.isIPv4MappedAddress()) return ipv4Public(parsed.toIPv4Address().toString());
  return parsed.range() === "unicast";
}

export function isPublicOkxEgressAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? ipv4Public(address) : family === 6 ? ipv6Public(address) : false;
}

const defaultResolver: OkxDnsResolver = async (host) => {
  const records = await dnsLookup(host, { all: true, verbatim: true });
  return records.map(({ address }) => address);
};

const defaultRequester: OkxPinnedRequester = (input) =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const clearChunks = () => {
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearChunks();
      reject(error);
    };
    const request = httpsRequest(
      {
        headers: input.headers,
        host: input.host,
        lookup: (_hostname, _options, callback) => {
          callback(null, input.address, isIP(input.address) as 4 | 6);
        },
        method: input.method,
        path: input.path,
        port: input.port,
        protocol: "https:",
        servername: input.servername,
      },
      (response) => {
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
          size += bytes.length;
          if (size > okxProductionEgress.maxResponseBytes) {
            bytes.fill(0);
            fail(new OkxConnectorError("EGRESS_DENIED"));
            response.destroy();
            request.destroy();
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks);
          clearChunks();
          resolve({ body, statusCode: response.statusCode ?? 0 });
        });
        response.once("aborted", () => fail(new OkxConnectorError("CONNECTOR_UNAVAILABLE", true)));
        response.once("error", () => fail(new OkxConnectorError("CONNECTOR_UNAVAILABLE", true)));
      },
    );
    request.setTimeout(okxProductionEgress.timeoutMilliseconds, () => {
      request.destroy(new OkxConnectorError("CONNECTOR_UNAVAILABLE", true));
    });
    request.once("error", (error) => fail(error));
    request.end();
  });

async function withEgressTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new OkxConnectorError("CONNECTOR_UNAVAILABLE", true)),
          okxProductionEgress.timeoutMilliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unknownValidation(): OkxProviderValidation {
  return {
    authentication: "unknown",
    ipAllowlisted: null,
    permissions: { read: null, trade: null, withdraw: null },
  };
}

export function parseOkxAccountConfiguration(body: Buffer): OkxProviderValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return unknownValidation();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return unknownValidation();
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.code !== "0" || !Array.isArray(envelope.data) || envelope.data.length !== 1) {
    return envelope.code === "50111" || envelope.code === "50113"
      ? { ...unknownValidation(), authentication: "invalid" }
      : unknownValidation();
  }
  const first = envelope.data[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) {
    return unknownValidation();
  }
  const config = first as Record<string, unknown>;
  if (typeof config.perm !== "string" || typeof config.ip !== "string") {
    return unknownValidation();
  }
  const permissions = new Set(
    config.perm
      .split(",")
      .map((permission) => permission.trim().toLowerCase())
      .filter(Boolean),
  );
  const known = new Set(["read_only", "read", "trade", "withdraw"]);
  if ([...permissions].some((permission) => !known.has(permission))) return unknownValidation();
  return {
    authentication: "valid",
    ipAllowlisted: config.ip.trim().length > 0,
    permissions: {
      read: permissions.has("read_only") || permissions.has("read"),
      trade: permissions.has("trade"),
      withdraw: permissions.has("withdraw"),
    },
  };
}

export class OkxHttpsReadOnlyTransport implements OkxReadOnlyTransport {
  readonly #now: () => Date;
  readonly #request: OkxPinnedRequester;
  readonly #resolve: OkxDnsResolver;

  constructor(input?: {
    now?: () => Date;
    request?: OkxPinnedRequester;
    resolve?: OkxDnsResolver;
  }) {
    this.#now = input?.now ?? (() => new Date());
    this.#request = input?.request ?? defaultRequester;
    this.#resolve = input?.resolve ?? defaultResolver;
  }

  async validate(credentials: OkxCredentialBytes): Promise<OkxProviderValidation> {
    let addresses: string[];
    try {
      addresses = await withEgressTimeout(this.#resolve(okxProductionEgress.host));
    } catch {
      throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicOkxEgressAddress(address))) {
      throw new OkxConnectorError("EGRESS_DENIED");
    }
    const timestamp = this.#now().toISOString();
    const prehash = Buffer.from(
      `${timestamp}${okxProductionEgress.method}${okxProductionEgress.path}`,
      "utf8",
    );
    let response: OkxPinnedResponse | null = null;
    try {
      const signature = createHmac("sha256", credentials.secretKey)
        .update(prehash)
        .digest("base64");
      try {
        response = await withEgressTimeout(this.#request({
          address: addresses[0]!,
          headers: {
            Accept: "application/json",
            "OK-ACCESS-KEY": credentials.apiKey.toString("utf8"),
            "OK-ACCESS-PASSPHRASE": credentials.passphrase.toString("utf8"),
            "OK-ACCESS-SIGN": signature,
            "OK-ACCESS-TIMESTAMP": timestamp,
            "User-Agent": "LPBot-OKX-Connector/1",
          },
          host: okxProductionEgress.host,
          method: okxProductionEgress.method,
          path: okxProductionEgress.path,
          port: okxProductionEgress.port,
          servername: okxProductionEgress.host,
        }));
      } catch (error) {
        if (error instanceof OkxConnectorError) throw error;
        throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
      }
      if (response.body.length > okxProductionEgress.maxResponseBytes) {
        throw new OkxConnectorError("EGRESS_DENIED");
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        throw new OkxConnectorError("EGRESS_DENIED");
      }
      if (response.statusCode === 401 || response.statusCode === 403) {
        return { ...unknownValidation(), authentication: "invalid" };
      }
      if (response.statusCode < 200 || response.statusCode >= 300) return unknownValidation();
      return parseOkxAccountConfiguration(response.body);
    } finally {
      prehash.fill(0);
      response?.body.fill(0);
    }
  }
}

export class OkxTransportFixture implements OkxReadOnlyTransport {
  readonly #results: Array<OkxProviderValidation | Error>;
  calls = 0;

  constructor(...results: Array<OkxProviderValidation | Error>) {
    this.#results = [...results];
  }

  async validate(): Promise<OkxProviderValidation> {
    this.calls += 1;
    const result = this.#results.shift();
    if (!result) throw new Error("No OKX fixture response configured");
    if (result instanceof Error) throw result;
    return structuredClone(result);
  }
}

export const usableOkxFixtureValidation: OkxProviderValidation = {
  authentication: "valid",
  ipAllowlisted: true,
  permissions: { read: true, trade: false, withdraw: false },
};
