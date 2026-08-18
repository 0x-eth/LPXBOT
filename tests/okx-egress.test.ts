import {
  isPublicOkxEgressAddress,
  OkxHttpsReadOnlyTransport,
  okxProductionEgress,
  parseOkxAccountConfiguration,
  type OkxPinnedRequest,
} from "../apps/okx-connector/src/index.js";
import { describe, expect, it } from "vitest";

const credentials = {
  apiKey: Buffer.from("synthetic-api-key"),
  passphrase: Buffer.from("synthetic-passphrase"),
  secretKey: Buffer.from("synthetic-secret-key"),
};

describe("P04-07 fixed OKX egress", () => {
  it("pins a public DNS answer and emits only the fixed read-only validation request", async () => {
    let observed: OkxPinnedRequest | null = null;
    const responseBody = Buffer.from(
      JSON.stringify({ code: "0", data: [{ ip: "fixture-allowlisted", perm: "read_only" }] }),
    );
    const transport = new OkxHttpsReadOnlyTransport({
      now: () => new Date("2026-08-19T03:00:00.000Z"),
      request: async (request) => {
        observed = request;
        return { body: responseBody, statusCode: 200 };
      },
      resolve: async () => ["203.0.113.10"],
    });
    await expect(transport.validate(credentials)).resolves.toEqual({
      authentication: "valid",
      ipAllowlisted: true,
      permissions: { read: true, trade: false, withdraw: false },
    });
    expect(observed).toMatchObject({
      address: "203.0.113.10",
      host: "www.okx.com",
      method: "GET",
      path: "/api/v5/account/config",
      port: 443,
      servername: "www.okx.com",
    });
    expect(okxProductionEgress).toMatchObject({
      maxResponseBytes: 262_144,
      timeoutMilliseconds: 8_000,
    });
    expect(responseBody.every((byte) => byte === 0)).toBe(true);
  });

  it("denies private/rebound DNS, redirects and oversized bodies without following", async () => {
    for (const addresses of [
      ["127.0.0.1"],
      ["10.0.0.1"],
      ["169.254.169.254"],
      ["::1"],
      ["fd00::1"],
      ["::ffff:127.0.0.1"],
      ["::ffff:169.254.169.254"],
      ["::ffff:172.20.1.1"],
      ["::ffff:ac14:101"],
      ["64:ff9b::7f00:1"],
      ["203.0.113.10", "127.0.0.1"],
    ]) {
      const transport = new OkxHttpsReadOnlyTransport({
        request: async () => {
          throw new Error("request must not run");
        },
        resolve: async () => addresses,
      });
      await expect(transport.validate(credentials), addresses.join(",")).rejects.toMatchObject({
        code: "EGRESS_DENIED",
      });
    }
    const redirected = new OkxHttpsReadOnlyTransport({
      request: async () => ({ body: Buffer.from("redirect"), statusCode: 302 }),
      resolve: async () => ["203.0.113.10"],
    });
    await expect(redirected.validate(credentials)).rejects.toMatchObject({ code: "EGRESS_DENIED" });
    const oversized = new OkxHttpsReadOnlyTransport({
      request: async () => ({ body: Buffer.alloc(262_145), statusCode: 200 }),
      resolve: async () => ["203.0.113.10"],
    });
    await expect(oversized.validate(credentials)).rejects.toMatchObject({ code: "EGRESS_DENIED" });

    const timedOut = new OkxHttpsReadOnlyTransport({
      request: async () => {
        throw new Error("synthetic timeout detail");
      },
      resolve: async () => ["203.0.113.10"],
    });
    await expect(timedOut.validate(credentials)).rejects.toMatchObject({
      code: "CONNECTOR_UNAVAILABLE",
      message: "CONNECTOR_UNAVAILABLE",
      retryable: true,
    });
  });

  it("maps only explicit permissions and never returns the provider IP or body", () => {
    expect(isPublicOkxEgressAddress("203.0.113.10")).toBe(true);
    expect(isPublicOkxEgressAddress("192.168.1.2")).toBe(false);
    expect(isPublicOkxEgressAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicOkxEgressAddress("::ffff:172.31.255.254")).toBe(false);
    expect(
      parseOkxAccountConfiguration(
        Buffer.from(JSON.stringify({ code: "0", data: [{ ip: "fixture-ip", perm: "trade" }] })),
      ),
    ).toEqual({
      authentication: "valid",
      ipAllowlisted: true,
      permissions: { read: false, trade: true, withdraw: false },
    });
    expect(
      JSON.stringify(
        parseOkxAccountConfiguration(
          Buffer.from(
            JSON.stringify({ code: "0", data: [{ ip: "fixture-ip", perm: "read_only" }] }),
          ),
        ),
      ),
    ).not.toContain("fixture-ip");
  });

  it("maps authentication status codes without exposing upstream bodies", async () => {
    for (const [statusCode, authentication] of [
      [401, "invalid"],
      [403, "invalid"],
      [429, "unknown"],
      [500, "unknown"],
    ] as const) {
      const body = Buffer.from(`synthetic upstream ${statusCode}`);
      const transport = new OkxHttpsReadOnlyTransport({
        request: async () => ({ body, statusCode }),
        resolve: async () => ["203.0.113.10"],
      });
      const result = await transport.validate(credentials);
      expect(result.authentication).toBe(authentication);
      expect(JSON.stringify(result)).not.toContain("synthetic upstream");
      expect(body.every((byte) => byte === 0)).toBe(true);
    }
  });
});
