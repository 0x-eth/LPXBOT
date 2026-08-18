import type { OkxKeyStatus } from "../packages/api-contract/src/index.js";
import {
  OkxKeyClient,
  OkxKeyRequestError,
  parseOkxKeyStatus,
} from "../apps/web/src/okx-key-client.js";
import { describe, expect, it, vi } from "vitest";

const usable: OkxKeyStatus = { configured: true, status: "usable", version: 2 };

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "okx-client-fixture", success: true }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P04-07 OKX browser client", () => {
  it("accepts only exact non-secret status metadata", () => {
    expect(parseOkxKeyStatus(usable)).toEqual(usable);
    for (const malformed of [
      { ...usable, fingerprint: "forbidden" },
      { ...usable, apiKey: "forbidden" },
      { configured: true, status: "unconfigured", version: 1 },
      { configured: false, status: "usable", version: 0 },
      { configured: true, status: "future", version: 1 },
    ]) {
      expect(() => parseOkxKeyStatus(malformed)).toThrowError(OkxKeyRequestError);
    }
  });

  it("uses dedicated no-store ingress, current versions and zeroes every request body", async () => {
    const bodies: Array<{ after: Uint8Array; during: Record<string, unknown> }> = [];
    const fetcher = vi.fn<typeof fetch>(async (_path, init) => {
      if (init?.body) {
        const body = init.body as unknown as Uint8Array;
        bodies.push({
          after: body,
          during: JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>,
        });
      }
      return success(usable);
    });
    const client = new OkxKeyClient(fetcher, () => "fresh-proof");
    const draft = {
      apiKey: "synthetic-api-key",
      passphrase: "synthetic-passphrase",
      secretKey: "synthetic-secret-key",
    };

    await client.status();
    await client.save(draft);
    await client.replace(draft, 1);
    await client.test(2);
    await client.delete(2);

    expect(fetcher.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([
      ["/api/settings/okx-key", "GET"],
      ["/api/settings/okx-key", "POST"],
      ["/api/settings/okx-key", "PUT"],
      ["/api/settings/okx-key/test", "POST"],
      ["/api/settings/okx-key", "DELETE"],
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        credentials: "include",
        referrerPolicy: "no-referrer",
      });
    }
    for (const [, init] of fetcher.mock.calls.slice(1)) {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/vnd.lpbot.okx-key-secret+json",
          "X-LPBOT-Reauthentication": "fresh-proof",
        }),
      );
    }
    expect(bodies.map(({ during }) => during)).toEqual([
      draft,
      { ...draft, expectedVersion: 1 },
      { expectedVersion: 2 },
      { expectedVersion: 2 },
    ]);
    expect(bodies.every(({ after }) => after.every((byte) => byte === 0))).toBe(true);
  });

  it("does not retry and ignores provider detail in error envelopes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CREDENTIAL_INVALID",
            message: "provider response must be ignored",
            retryable: false,
          },
          success: false,
        }),
        { headers: { "Content-Type": "application/json" }, status: 422 },
      ),
    );
    const client = new OkxKeyClient(fetcher);
    await expect(
      client.save({
        apiKey: "synthetic-api-key",
        passphrase: "synthetic-passphrase",
        secretKey: "synthetic-secret-key",
      }),
    ).rejects.toMatchObject({
      code: "CREDENTIAL_INVALID",
      message: "CREDENTIAL_INVALID",
      retryable: false,
      status: 422,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
