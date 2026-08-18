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
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fd00::1"]) {
      const transport = new OkxHttpsReadOnlyTransport({
        request: async () => {
          throw new Error("request must not run");
        },
        resolve: async () => [address],
      });
      await expect(transport.validate(credentials), address).rejects.toMatchObject({
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
  });

  it("maps only explicit permissions and never returns the provider IP or body", () => {
    expect(isPublicOkxEgressAddress("203.0.113.10")).toBe(true);
    expect(isPublicOkxEgressAddress("192.168.1.2")).toBe(false);
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
          Buffer.from(JSON.stringify({ code: "0", data: [{ ip: "fixture-ip", perm: "read_only" }] })),
        ),
      ),
    ).not.toContain("fixture-ip");
  });
});
