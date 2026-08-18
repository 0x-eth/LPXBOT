import type { Server } from "node:http";

import type { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
import { createSignerHttpServer } from "../apps/signer/src/http-server.js";
import { afterEach, describe, expect, it } from "vitest";

const apiToken = "signer-api-token-fixture-at-least-32-bytes";
const tenantId = "tenant-fixture-01";
const userId = "49000000-0000-4000-8000-000000000001";
const sessionId = "49000000-0000-4000-8000-000000000010";
const mediaType = "application/vnd.lpbot.keystore-secret+json";
const servers: Server[] = [];

async function start(service: Partial<CustodySignerService>): Promise<string> {
  const server = createSignerHttpServer({ apiToken, service: service as CustodySignerService });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("signer fixture did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function headers(contentType?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
    "X-LPBOT-Reauthenticated-Session-Id": sessionId,
    "X-LPBOT-Tenant-Id": tenantId,
    "X-LPBOT-User-Id": userId,
  };
}

afterEach(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("P04-03 signer Keystore HTTP boundary", () => {
  it("binds status/unlock to the reauthenticated session and clears ingress", async () => {
    let calls = 0;
    let seen: Uint8Array | null = null;
    const url = await start({
      keystoreStatus: async (receivedUser, receivedSession) => {
        expect(receivedUser).toBe(userId);
        expect(receivedSession).toBe(sessionId);
        return { configured: true, status: "locked", version: 1 };
      },
      unlockKeystore: async (input) => {
        calls += 1;
        seen = input.ingress;
        expect(input.userId).toBe(userId);
        expect(input.reauthenticatedSessionId).toBe(sessionId);
        return { configured: true, status: "unlocked", version: 1 };
      },
    });
    const status = await fetch(`${url}/v1/keystore/status`, { headers: headers() });
    expect(status.status).toBe(200);
    expect(status.headers.get("cache-control")).toBe("no-store");
    await expect(status.json()).resolves.toMatchObject({
      data: { configured: true, status: "locked", version: 1 },
    });

    const unlocked = await fetch(`${url}/v1/keystore/unlock`, {
      body: JSON.stringify({ password: "synthetic-password-one" }),
      headers: headers(mediaType),
      method: "POST",
    });
    expect(unlocked.status).toBe(200);
    expect(calls).toBe(1);
    expect(seen && [...seen].every((byte) => byte === 0)).toBe(true);
  });

  it("enforces media type, session identity and 16 KiB without invoking the service", async () => {
    let calls = 0;
    const url = await start({
      unlockKeystore: async () => {
        calls += 1;
        return { configured: true, status: "unlocked", version: 1 };
      },
    });
    const wrongMedia = await fetch(`${url}/v1/keystore/unlock`, {
      body: "{}",
      headers: headers("application/json"),
      method: "POST",
    });
    expect(wrongMedia.status).toBe(415);

    const missingSessionHeaders = headers(mediaType);
    delete missingSessionHeaders["X-LPBOT-Reauthenticated-Session-Id"];
    const missingSession = await fetch(`${url}/v1/keystore/unlock`, {
      body: "{}",
      headers: missingSessionHeaders,
      method: "POST",
    });
    expect(missingSession.status).toBe(400);

    const tooLarge = await fetch(`${url}/v1/keystore/unlock`, {
      body: "x".repeat(16_385),
      headers: headers(mediaType),
      method: "POST",
    });
    expect(tooLarge.status).toBe(413);
    expect(calls).toBe(0);
  });
});
