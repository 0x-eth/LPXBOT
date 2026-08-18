import type { KeystoreResetPreview, KeystoreStatus } from "../packages/api-contract/src/index.js";
import {
  KeystoreClient,
  KeystoreRequestError,
  parseKeystoreResetPreview,
  parseKeystoreStatus,
} from "../apps/web/src/keystore-client.js";
import { describe, expect, it, vi } from "vitest";

const status: KeystoreStatus = { configured: true, status: "locked", version: 2 };
const preview: KeystoreResetPreview = {
  confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
  expiresAt: "2026-08-18T11:05:00.000Z",
  policyCount: 2,
  previewToken: "preview-token-fixture-at-least-32-bytes",
  secretVersion: 2,
  strategyCount: 1,
  taskCount: 3,
  walletCount: 4,
  walletsWithNonzeroAssets: 1,
  walletsWithPositions: 1,
};

function success(data: unknown, responseStatus = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "keystore-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status: responseStatus,
  });
}

describe("P04-03 Keystore browser client", () => {
  it("strictly parses status and reset preview allowlists", () => {
    expect(parseKeystoreStatus(status)).toEqual(status);
    expect(parseKeystoreResetPreview(preview)).toEqual(preview);
    for (const malformed of [
      { ...status, verifier: "forbidden" },
      { ...status, status: "open" },
      { ...preview, salt: "forbidden" },
      { ...preview, confirmationPhrase: "wrong" },
    ]) {
      expect(() =>
        "walletCount" in malformed
          ? parseKeystoreResetPreview(malformed)
          : parseKeystoreStatus(malformed),
      ).toThrowError(KeystoreRequestError);
    }
  });

  it("uses no-store for status and reset preview reads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(success(status))
      .mockResolvedValueOnce(success(preview));
    const client = new KeystoreClient(fetcher);

    await expect(client.status()).resolves.toEqual(status);
    await expect(client.resetPreview()).resolves.toEqual(preview);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/keystore/status",
      expect.objectContaining({ cache: "no-store", credentials: "include", method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/keystore/reset-preview",
      expect.objectContaining({ cache: "no-store", credentials: "include", method: "GET" }),
    );
  });

  it("sends every password mutation once through dedicated ingress and clears transport bytes", async () => {
    const bodies: Array<{ after: Uint8Array; during: string }> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = init?.body as unknown as Uint8Array;
      bodies.push({ after: body, during: new TextDecoder().decode(body) });
      return success(status);
    });
    const client = new KeystoreClient(fetcher);

    await client.createPassword({ newPassword: "synthetic-password-one" });
    await client.unlock({ password: "synthetic-password-one" });
    await client.changePassword({
      expectedVersion: 2,
      newPassword: "synthetic-password-two",
      oldPassword: "synthetic-password-one",
    });
    await client.reset({
      confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
      expectedVersion: 2,
      previewToken: preview.previewToken,
    });

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/keystore/password",
      "/api/keystore/unlock",
      "/api/keystore/password",
      "/api/keystore/reset",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "POST",
      "PUT",
      "POST",
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/vnd.lpbot.keystore-secret+json",
        }),
      );
    }
    expect(bodies.map(({ during }) => during).join("\n")).toContain("synthetic-password-one");
    expect(bodies.every(({ after }) => after.every((byte) => byte === 0))).toBe(true);
  });

  it("does not retry failed secret requests and exposes only stable error codes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "synthetic-password-must-not-render",
            requestId: "fixture",
            retryable: false,
          },
          success: false,
        }),
        { headers: { "Content-Type": "application/json" }, status: 401 },
      ),
    );
    const client = new KeystoreClient(fetcher);

    await expect(client.unlock({ password: "synthetic-password-one" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "INVALID_CREDENTIALS",
      retryable: false,
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
