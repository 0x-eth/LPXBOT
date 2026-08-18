import type { Server } from "node:http";

import type { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
import { createSignerHttpServer } from "../apps/signer/src/http-server.js";
import { afterEach, describe, expect, it } from "vitest";

const apiToken = "signer-api-token-fixture-at-least-32-bytes";
const tenantId = "tenant-fixture-01";
const userId = "43000000-0000-4000-8000-000000000001";
const wallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf" as const,
  createdAt: "2026-08-18T05:00:00.000Z",
  envelopeVersion: 1,
  lockStatus: "ready" as const,
  mode: "server-kek" as const,
  name: "Fixture",
  revision: 1,
  updatedAt: "2026-08-18T05:00:00.000Z",
  walletId: "43000000-0000-4000-8000-000000000011",
};

const servers: Server[] = [];

async function start(service: Partial<CustodySignerService>): Promise<string> {
  const server = createSignerHttpServer({
    apiToken,
    service: service as CustodySignerService,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("signer fixture did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function importRequest(url: string): Promise<Response> {
  return fetch(`${url}/v1/wallets/import`, {
    body: JSON.stringify({ mode: "server-kek", name: "Fixture", privateKey: "01" }),
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/vnd.lpbot.wallet-secret+json",
      "X-LPBOT-Tenant-Id": tenantId,
      "X-LPBOT-User-Id": userId,
    },
    method: "POST",
  });
}

afterEach(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("P04-02 isolated signer HTTP boundary", () => {
  it("retains import ownership when another same-user request is rejected", async () => {
    let calls = 0;
    let entered!: () => void;
    let release!: () => void;
    const firstEntered = new Promise<void>((resolve) => (entered = resolve));
    const firstReleased = new Promise<void>((resolve) => (release = resolve));
    const service = {
      async importWallet() {
        calls += 1;
        if (calls === 1) {
          entered();
          await firstReleased;
        }
        return wallet;
      },
    };
    const url = await start(service as Pick<CustodySignerService, "importWallet">);

    const first = importRequest(url);
    await firstEntered;
    const second = await importRequest(url);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: { code: "IMPORT_IN_PROGRESS", retryable: false },
      success: false,
    });

    const third = await importRequest(url);
    expect(third.status).toBe(409);
    expect(calls).toBe(1);

    release();
    expect((await first).status).toBe(201);
  });
});

describe("P04-04 signer security-password HTTP boundary", () => {
  it("verifies through dedicated no-store ingress and clears the received secret", async () => {
    let seen: Uint8Array | null = null;
    const url = await start({
      verifySecurityPassword: async (input) => {
        seen = input.ingress;
        expect(input.userId).toBe(userId);
        return { verified: true, version: 4 };
      },
    });

    const response = await fetch(`${url}/v1/security-password/verify`, {
      body: JSON.stringify({ password: "synthetic-security-password" }),
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/vnd.lpbot.security-password-secret+json",
        "X-LPBOT-Tenant-Id": tenantId,
        "X-LPBOT-User-Id": userId,
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const envelope = await response.json();
    expect(envelope).toEqual({ data: { verified: true, version: 4 }, success: true });
    expect(Object.keys(envelope.data).sort()).toEqual(["verified", "version"]);
    expect(seen && [...seen].every((byte) => byte === 0)).toBe(true);
  });
});
