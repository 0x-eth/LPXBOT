import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import { WalletClient, WalletRequestError } from "../apps/web/src/wallet-client.js";
import { describe, expect, it, vi } from "vitest";

const wallet: CustodyWallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  createdAt: "2026-08-18T05:00:00.000Z",
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Fixture",
  revision: 1,
  updatedAt: "2026-08-18T05:00:00.000Z",
  walletId: "44000000-0000-4000-8000-000000000011",
};

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "wallet-client", success: true }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P04-02 wallet browser client", () => {
  it("strictly parses the wallet DTO allowlist", async () => {
    const valid = new WalletClient(vi.fn<typeof fetch>().mockResolvedValue(success({ items: [wallet] })));
    await expect(valid.list()).resolves.toEqual({ items: [wallet] });

    for (const malformed of [
      { ...wallet, ciphertext: "forbidden" },
      { ...wallet, mode: "user-password" },
      { ...wallet, lockStatus: "open" },
      { ...wallet, address: "0x01" },
    ]) {
      const client = new WalletClient(
        vi.fn<typeof fetch>().mockResolvedValue(success({ items: [malformed] })),
      );
      await expect(client.list()).rejects.toMatchObject({
        code: "WALLET_RESPONSE_INVALID",
        retryable: true,
      });
    }
  });

  it("uses dedicated no-cache secret ingress once and zeroizes request bytes", async () => {
    const bodies: Array<{ after: Uint8Array; during: string }> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const body = init?.body as unknown as Uint8Array;
      bodies.push({ after: body, during: new TextDecoder().decode(body) });
      return success(wallet, 201);
    });
    const client = new WalletClient(fetcher, () => "fresh-proof");
    await expect(
      client.importWallet({
        mode: "server-kek",
        name: "Fixture",
        privateKey: "0x0000000000000000000000000000000000000000000000000000000000000001",
      }),
    ).resolves.toEqual(wallet);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/wallets/import",
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/vnd.lpbot.wallet-secret+json",
          "X-LPBOT-Reauthentication": "fresh-proof",
        }),
        method: "POST",
      }),
    );
    expect(bodies[0]!.during).toContain("privateKey");
    expect(bodies[0]!.after.every((byte) => byte === 0)).toBe(true);
  });

  it("never retries a secret mutation and preserves public error codes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "WALLET_ADDRESS_EXISTS",
            message: "provider detail must be ignored",
            requestId: "duplicate",
            retryable: false,
          },
          success: false,
        }),
        { headers: { "Content-Type": "application/json" }, status: 409 },
      ),
    );
    const client = new WalletClient(fetcher);
    await expect(
      client.importWallet({ mode: "server-kek", name: "Duplicate", privateKey: "0".repeat(64) }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WalletRequestError>>({
        code: "WALLET_ADDRESS_EXISTS",
        retryable: false,
        status: 409,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends generation without secret fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success(wallet, 201));
    const client = new WalletClient(fetcher, () => "fresh-proof");
    await client.generateWallet({ mode: "server-kek", name: "Generated" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/wallets/generate",
      expect.objectContaining({
        body: JSON.stringify({ mode: "server-kek", name: "Generated" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        method: "POST",
      }),
    );
  });
});
