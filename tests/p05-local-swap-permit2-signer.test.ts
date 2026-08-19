import type { Server } from "node:http";

import type { CustodySignerService } from "../apps/signer/src/custody-signer-service.js";
import { createSignerHttpServer } from "../apps/signer/src/http-server.js";
import {
  PostgresLocalSwapPermit2Authorizer,
  type LocalSwapPlanChainVerifier,
} from "../apps/signer/src/postgres-local-swap-plan-authorizer.js";
import { RemoteLocalSwapPermit2Client } from "../apps/api/src/remote-local-swap-permit2-client.js";
import {
  localSwapComponent,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  localSwapPermit2AuthorizationDigest,
  type LocalSwapPermit2SigningPayload,
} from "../packages/domain/src/local-swap-execution.js";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiToken = "local-swap-permit2-token-fixture-at-least-32-bytes";
const tenantId = "tenant-fixture-01";
const userId = "a6400000-0000-4000-8000-000000000001";
const walletId = "a6400000-0000-4000-8000-000000000011";
const sessionId = "a6400000-0000-4000-8000-000000000021";
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const now = new Date("2026-08-20T04:00:00.000Z");
const nowSeconds = BigInt(Math.floor(now.getTime() / 1_000));
const domainSeparator = `0x${"44".repeat(32)}` as const;
const servers: Server[] = [];

function payload(overrides: Partial<LocalSwapPermit2SigningPayload> = {}) {
  return {
    amountBaseUnit: "1000",
    domainSeparator,
    expiration: (nowSeconds + 600n).toString(),
    nonce: "7",
    permit2: localSwapComponent("permit2").address,
    quoteDigest: `sha256:${"55".repeat(32)}` as const,
    sigDeadline: (nowSeconds + 900n).toString(),
    spender: "0x0165878a594ca255338adfa4d48449f69242eb8f" as const,
    token: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens[0].address,
    walletId,
    ...overrides,
  } satisfies LocalSwapPermit2SigningPayload;
}

async function start(service: Partial<CustodySignerService>): Promise<string> {
  const server = createSignerHttpServer({ apiToken, service: service as CustodySignerService });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("signer fixture did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function permitRequest(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/v1/local-swap/permit2/sign`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      "X-LPBOT-Reauthenticated-Session-Id": sessionId,
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

describe("P05-06 Permit2 signer authorization", () => {
  it("binds the exact HTTP payload and rejects field injection", async () => {
    const value = payload();
    const signLocalSwapPermit2 = vi.fn(
      async (input: Parameters<CustodySignerService["signLocalSwapPermit2"]>[0]) => {
        expect(input).toEqual({
          payload: value,
          reauthenticatedSessionId: sessionId,
          tenantId,
          userId,
        });
        return {
          authorizationDigest: localSwapPermit2AuthorizationDigest(value),
          signature: `0x${"66".repeat(65)}` as const,
        };
      },
    );
    const url = await start({ signLocalSwapPermit2 });
    const accepted = await permitRequest(url, { payload: value });
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      data: { authorizationDigest: localSwapPermit2AuthorizationDigest(value) },
      success: true,
    });

    for (const body of [
      { payload: { ...value, target: owner } },
      { payload: value, signature: `0x${"77".repeat(65)}` },
      { payload: { ...value, calldata: "0xdeadbeef" } },
    ]) {
      const rejected = await permitRequest(url, body);
      expect(rejected.status).toBe(409);
      await expect(rejected.json()).resolves.toEqual({
        error: { code: "PERMIT2_AUTHORIZATION_REJECTED", retryable: false },
        success: false,
      });
    }
    expect(signLocalSwapPermit2).toHaveBeenCalledOnce();
  });

  it("fails closed on stale expiration and chain nonce/domain mismatches", async () => {
    const query = vi.fn(async () => ({ rows: [{ owner_address: owner }] }));
    const verification = {
      blockTimestamp: nowSeconds.toString(),
      domainSeparator,
      nonce: "7",
      permit2CodeHash: localSwapComponent("permit2").runtimeCodeHash,
      tokenCodeHash: P05_LOCAL_SWAP_EXECUTION_REGISTRY.tokens[0].runtimeCodeHash,
    };
    const verifyPermit2 = vi.fn(async () => structuredClone(verification));
    const chain = { verifyPermit2 } as unknown as LocalSwapPlanChainVerifier;
    const authorizer = new PostgresLocalSwapPermit2Authorizer({ query } as unknown as Pool, chain, {
      now: () => now,
    });
    await expect(authorizer.authorize({ payload: payload(), tenantId, userId })).resolves.toBe(
      true,
    );

    verifyPermit2.mockResolvedValueOnce({ ...verification, nonce: "8" });
    await expect(authorizer.authorize({ payload: payload(), tenantId, userId })).resolves.toBe(
      false,
    );
    verifyPermit2.mockResolvedValueOnce({
      ...verification,
      domainSeparator: `0x${"88".repeat(32)}`,
    });
    await expect(authorizer.authorize({ payload: payload(), tenantId, userId })).resolves.toBe(
      false,
    );
    await expect(
      authorizer.authorize({
        payload: payload({ expiration: nowSeconds.toString() }),
        tenantId,
        userId,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a wrong digest or malformed signature from the loopback signer", async () => {
    const value = payload();
    const input = {
      ...value,
      reauthenticatedSessionId: sessionId,
      tenantId,
      userId,
    };
    const response = (data: unknown) =>
      new Response(JSON.stringify({ data, success: true }), {
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
        status: 200,
      });
    for (const data of [
      {
        authorizationDigest: `0x${"99".repeat(32)}`,
        signature: `0x${"aa".repeat(65)}`,
      },
      {
        authorizationDigest: localSwapPermit2AuthorizationDigest(value),
        signature: "0x1234",
      },
      {
        authorizationDigest: localSwapPermit2AuthorizationDigest(value),
        signature: `0x${"aa".repeat(65)}`,
        target: owner,
      },
    ]) {
      const client = new RemoteLocalSwapPermit2Client({
        endpoint: "http://127.0.0.1:44000/v1/local-swap/permit2/sign",
        fetch: async () => response(data),
        token: apiToken,
      });
      await expect(client.sign(input)).rejects.toMatchObject({
        code: "PERMIT2_AUTHORIZATION_INVALID",
      });
    }
  });
});
