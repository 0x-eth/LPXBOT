import { describe, expect, it, vi } from "vitest";

import { HttpKmsClient } from "../apps/signer/src/http-kms-client.js";

const identityToken = "kms-identity-token-fixture-at-least-32-bytes";

function client(fetcher: typeof fetch) {
  return new HttpKmsClient({
    fetcher,
    identity: "signer-fixture-01",
    identityToken,
    keyId: "custody-fixture",
    keyVersion: "v1",
    url: "https://kms.fixture.invalid",
  });
}

describe("P04-02 signer KMS boundary", () => {
  it("authenticates the signer identity and verifies the configured KEK version", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        available: true,
        keyId: "custody-fixture",
        keyVersion: "v1",
        operations: ["wrap", "unwrap"],
      }),
    );

    await expect(client(fetcher as typeof fetch).activeKey()).resolves.toEqual({
      kekId: "custody-fixture",
      kekVersion: "v1",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: `Bearer ${identityToken}`,
        "Cache-Control": "no-store",
        "X-LPBOT-Signer-Identity": "signer-fixture-01",
      },
      method: "GET",
    });
  });

  it("rejects empty or malformed wrapped DEKs before persistence", async () => {
    for (const ciphertext of ["", "not-base64", "AQ"] as const) {
      const fetcher = vi.fn(async () =>
        Response.json({ ciphertext, keyId: "custody-fixture", keyVersion: "v1" }),
      );
      await expect(
        client(fetcher as typeof fetch).wrapDek({
          dek: Buffer.alloc(32, 0x42),
          key: { kekId: "custody-fixture", kekVersion: "v1" },
        }),
      ).rejects.toMatchObject({ code: "SIGNER_UNAVAILABLE" });
    }
  });

  it("maps transport failures to a retryable secret-free signer error without retrying", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("synthetic-dek-must-not-escape");
    });

    await expect(client(fetcher as typeof fetch).activeKey()).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
      message: "SIGNER_UNAVAILABLE",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
