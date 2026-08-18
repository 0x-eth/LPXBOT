import type { SecurityPasswordStatus } from "../packages/api-contract/src/index.js";
import {
  parseSecurityPasswordStatus,
  SecurityPasswordClient,
  SecurityPasswordRequestError,
} from "../apps/web/src/security-password-client.js";
import { describe, expect, it, vi } from "vitest";

const status: SecurityPasswordStatus = { configured: true, status: "ready", version: 2 };

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data, requestId: "security-password-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("P04-04 security password browser client", () => {
  it("strictly parses only configured, version, and status", () => {
    expect(parseSecurityPasswordStatus(status)).toEqual(status);
    for (const malformed of [
      { ...status, salt: "forbidden" },
      { ...status, status: "unlocked" },
      { configured: false, status: "unconfigured", version: 1 },
    ]) {
      expect(() => parseSecurityPasswordStatus(malformed)).toThrowError(SecurityPasswordRequestError);
    }
  });

  it("uses no-store status reads and dedicated zeroized secret mutation ingress", async () => {
    const bodies: Array<{ after: Uint8Array; during: string }> = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success({ configured: false, status: "unconfigured", version: 0 }))
      .mockImplementationOnce(async (_input, init) => {
        const body = init?.body as unknown as Uint8Array;
        bodies.push({ after: body, during: new TextDecoder().decode(body) });
        return success(status);
      });
    const client = new SecurityPasswordClient(fetcher, () => "fresh-proof");

    await expect(client.status()).resolves.toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });
    await expect(
      client.update({
        expectedVersion: 1,
        newPassword: "synthetic-security-password-two",
        oldPassword: "synthetic-security-password-one",
      }),
    ).resolves.toEqual(status);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/security-password/status",
      expect.objectContaining({ cache: "no-store", credentials: "include", method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/security-password",
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/vnd.lpbot.security-password-secret+json",
          "X-LPBOT-Reauthentication": "fresh-proof",
        }),
        method: "PUT",
      }),
    );
    expect(bodies[0]!.during).toContain("synthetic-security-password-one");
    expect(bodies[0]!.after.every((byte) => byte === 0)).toBe(true);
  });

  it("does not retry and exposes only stable error fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "secret detail must be ignored",
            retryable: false,
          },
          success: false,
        }),
        { headers: { "Content-Type": "application/json" }, status: 401 },
      ),
    );
    const client = new SecurityPasswordClient(fetcher);
    await expect(
      client.update({
        expectedVersion: 1,
        newPassword: "synthetic-security-password-two",
        oldPassword: "synthetic-security-password-wrong",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "INVALID_CREDENTIALS",
      retryable: false,
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
