import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresWalletDirectory } from "../apps/api/src/postgres-wallet-directory.js";
import { RemoteWalletSignerClient } from "../apps/api/src/remote-wallet-signer-client.js";

const apiToken = "signer-api-token-fixture-at-least-32-bytes";
const tenantId = "tenant-fixture-01";
const userId = "43000000-0000-4000-8000-000000000001";
const reauthenticatedSessionId = "43000000-0000-4000-8000-000000000002";
const wallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  createdAt: "2026-08-18T05:00:00.000Z",
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Fixture",
  revision: 1,
  updatedAt: "2026-08-18T05:00:00.000Z",
  walletId: "43000000-0000-4000-8000-000000000011",
};

describe("P04-02 API wallet adapters", () => {
  it("forwards secret ingress once, clears the transport copy, and allowlists the DTO", async () => {
    const ingress = Buffer.from(
      JSON.stringify({ mode: "server-kek", name: "Fixture", privateKey: "01" }),
    );
    let transmitted: Uint8Array | null = null;
    let captured = Buffer.alloc(0);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      transmitted = init?.body as Uint8Array;
      captured = Buffer.from(transmitted);
      return new Response(
        JSON.stringify({ data: { ...wallet, wrappedDek: "forbidden" }, success: true }),
        { headers: { "Content-Type": "application/json" }, status: 201 },
      );
    });
    const client = new RemoteWalletSignerClient({
      apiToken,
      fetcher: fetcher as typeof fetch,
      url: "http://127.0.0.1:19090",
    });

    const result = await client.importWallet({ ingress, tenantId, userId });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(captured).toEqual(ingress);
    expect([...transmitted!]).toEqual(new Array(transmitted!.length).fill(0));
    expect(result).toEqual(wallet);
    expect(result).not.toHaveProperty("wrappedDek");
    expect(ingress.equals(Buffer.alloc(ingress.length))).toBe(false);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/vnd.lpbot.wallet-secret+json",
        "X-LPBOT-Tenant-Id": tenantId,
        "X-LPBOT-User-Id": userId,
      },
      method: "POST",
    });
  });

  it("does not retry transport failures or expose signer error bodies", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("synthetic-private-key-must-not-escape");
    });
    const client = new RemoteWalletSignerClient({
      apiToken,
      fetcher: fetcher as typeof fetch,
      url: "http://127.0.0.1:19090",
    });

    await expect(
      client.generateWallet({ mode: "server-kek", name: "Fixture", tenantId, userId }),
    ).rejects.toMatchObject({ code: "SIGNER_UNAVAILABLE", message: "SIGNER_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reads public metadata with an owner predicate and never selects envelope material", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            address: wallet.address,
            created_at: new Date(wallet.createdAt),
            current_envelope_version: wallet.envelopeVersion,
            lock_status: wallet.lockStatus,
            mode: wallet.mode,
            name: wallet.name,
            revision: String(wallet.revision),
            updated_at: new Date(wallet.updatedAt),
            wallet_id: wallet.walletId,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const directory = new PostgresWalletDirectory({ query } as unknown as Pool);

    await expect(directory.listWallets(userId)).resolves.toEqual({ items: [wallet] });
    await expect(directory.getWallet(userId, wallet.walletId)).resolves.toBeNull();

    for (const [sql, parameters] of query.mock.calls as Array<[string, unknown[]]>) {
      expect(sql).toContain("FROM custody_wallets");
      expect(sql).toContain("user_id = $1");
      expect(sql).not.toMatch(
        /custody_wallet_envelopes|ciphertext|wrapped_dek|kek_id|kek_version/iu,
      );
      expect(parameters[0]).toBe(userId);
    }
  });
});

describe("P04-03 remote keystore adapter", () => {
  it("sends a secret once with no-store session binding and clears only its transport copy", async () => {
    const ingress = Buffer.from(JSON.stringify({ password: "synthetic-password-fixture" }));
    let transmitted: Uint8Array | null = null;
    let captured = Buffer.alloc(0);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      transmitted = init?.body as Uint8Array;
      captured = Buffer.from(transmitted);
      return new Response(
        JSON.stringify({
          data: { configured: true, status: "unlocked", version: 1 },
          success: true,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new RemoteWalletSignerClient({
      apiToken,
      fetcher: fetcher as typeof fetch,
      tenantId,
      url: "http://127.0.0.1:19090",
    });

    await expect(
      client.unlockKeystore({ ingress, reauthenticatedSessionId, userId }),
    ).resolves.toEqual({ configured: true, status: "unlocked", version: 1 });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(captured).toEqual(ingress);
    expect([...transmitted!]).toEqual(new Array(transmitted!.length).fill(0));
    expect(ingress.equals(Buffer.alloc(ingress.length))).toBe(false);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.lpbot.keystore-secret+json",
        "X-LPBOT-Reauthenticated-Session-Id": reauthenticatedSessionId,
      },
      method: "POST",
    });
  });

  it("does not retry a failed secret request and still clears its transport copy", async () => {
    const ingress = Buffer.from(JSON.stringify({ password: "synthetic-password-fixture" }));
    let transmitted: Uint8Array | null = null;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      transmitted = init?.body as Uint8Array;
      throw new Error("synthetic transport failure");
    });
    const client = new RemoteWalletSignerClient({
      apiToken,
      fetcher: fetcher as typeof fetch,
      tenantId,
      url: "http://127.0.0.1:19090",
    });

    await expect(client.createKeystorePassword({ ingress, userId })).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect([...transmitted!]).toEqual(new Array(transmitted!.length).fill(0));
  });

  it("rejects non-allowlisted status and reset-preview response fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { configured: true, derivedKek: "forbidden", status: "locked", version: 1 },
            success: true,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
              expiresAt: "2026-08-18T05:05:00.000Z",
              policyCount: 0,
              previewToken: "preview-token-fixture-at-least-32-bytes",
              secretVersion: 1,
              strategyCount: 0,
              taskCount: 0,
              verifier: "forbidden",
              walletCount: 1,
              walletsWithNonzeroAssets: 0,
              walletsWithPositions: 0,
            },
            success: true,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    const client = new RemoteWalletSignerClient({
      apiToken,
      fetcher: fetcher as typeof fetch,
      tenantId,
      url: "http://127.0.0.1:19090",
    });

    await expect(client.keystoreStatus(userId, reauthenticatedSessionId)).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
    });
    await expect(client.createKeystoreResetPreview(userId)).rejects.toMatchObject({
      code: "SIGNER_UNAVAILABLE",
    });
  });
});
