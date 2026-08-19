import type {
  ImportPricingPositionRequest,
  PricingPosition,
  PricingPositionPage,
} from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  PricingPositionError,
  type PricingPositionApplication,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T07:00:00.000Z");
const userA = "70000000-0000-4000-8000-000000000001";
const userB = "70000000-0000-4000-8000-000000000002";
const pricingId = "70000000-0000-4000-8000-000000000021";
const walletId = "70000000-0000-4000-8000-000000000011";
const snapshotDigest = `0x${"cd".repeat(32)}` as const;

const position: PricingPosition = {
  chainId: 56,
  costBasis: {
    amount0BaseUnit: "100",
    amount1BaseUnit: "200",
    priceObservedAt: null,
    priceSource: null,
    priceStatus: "missing",
    usdValueDecimal: null,
  },
  importedAt: now.toISOString(),
  observations: [],
  platformId: 1,
  pool: {
    poolAddress: "0x2222222222222222222222222222222222222222",
    poolId: null,
    token0: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    token1: "0x55d398326f99059ff775485246999027b3197955",
  },
  positionManager: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
  pricingId,
  revision: 1,
  status: "active",
  tokenId: "42",
  updatedAt: now.toISOString(),
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletId,
};

function importBody(): ImportPricingPositionRequest {
  return {
    chainId: 56,
    costBasis: {
      amount0BaseUnit: "100",
      amount1BaseUnit: "200",
      priceObservedAt: null,
      priceSource: null,
      usdValueDecimal: null,
    },
    platformId: 1,
    snapshotDigest,
    tokenId: "42",
    walletId,
  };
}

class Positions implements PricingPositionApplication {
  readonly importCalls: Array<{ request: ImportPricingPositionRequest; userId: string }> = [];
  readonly listCalls: string[] = [];
  readonly withdrawnCalls: Array<{
    expectedRevision: number;
    pricingId: string;
    userId: string;
  }> = [];
  failure: Error | null = null;

  async importPosition(input: { request: ImportPricingPositionRequest; userId: string }) {
    this.importCalls.push(input);
    if (this.failure) throw this.failure;
    return structuredClone(position);
  }

  async list(input: { userId: string }): Promise<Readonly<PricingPositionPage>> {
    this.listCalls.push(input.userId);
    if (this.failure) throw this.failure;
    return { items: input.userId === userA ? [structuredClone(position)] : [] };
  }

  async markWithdrawn(input: {
    expectedRevision: number;
    pricingId: string;
    userId: string;
  }) {
    this.withdrawnCalls.push(input);
    if (this.failure) throw this.failure;
    if (input.userId !== userA || input.pricingId !== pricingId) {
      throw new PricingPositionError("PRICING_POSITION_NOT_FOUND");
    }
    return { ...structuredClone(position), revision: 2, status: "hidden" as const };
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessions = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessions, userA, now),
    issueFixtureSession(sessions, userB, now),
  ]);
  const positions = new Positions();
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    pricingPositions: positions,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: sessions,
    tenantId: "tenant-p05-03",
  });
  apps.push(app);
  return { app, positions, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P05-03 pricing position API", () => {
  it("requires a session and lists only the current user's ledger", async () => {
    const { app, positions, tokenA, tokenB } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/pricing-positions" })).statusCode).toBe(401);
    const first = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/pricing-positions",
    });
    const second = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: "/api/pricing-positions",
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.json().data.items).toEqual([position]);
    expect(second.json().data.items).toEqual([]);
    expect(positions.listCalls).toEqual([userA, userB]);
  });

  it("imports only the frozen public DTO and injects the session user", async () => {
    const { app, positions, tokenA } = await fixture();
    const response = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: importBody(),
      url: "/api/pricing-positions/import",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(positions.importCalls).toEqual([{ request: importBody(), userId: userA }]);

    for (const payload of [
      { ...importBody(), position: { arbitrary: true } },
      { ...importBody(), userId: userB },
      { ...importBody(), costBasis: { ...importBody().costBasis, inferredUsd: "999" } },
      { ...importBody(), snapshotDigest: "0x1234" },
      { ...importBody(), tokenId: "01" },
    ]) {
      const invalid = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload,
        url: "/api/pricing-positions/import",
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe("PRICING_POSITION_INVALID");
    }
    expect(positions.importCalls).toHaveLength(1);
  });

  it("marks hidden or withdrawn with optimistic revision and user-scoped ids", async () => {
    const { app, positions, tokenA, tokenB } = await fixture();
    const response = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { expectedRevision: 1 },
      url: `/api/pricing-positions/${pricingId}/withdrawn`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ revision: 2, status: "hidden" });
    expect(positions.withdrawnCalls[0]).toEqual({
      expectedRevision: 1,
      pricingId,
      userId: userA,
    });

    const crossUser = await app.inject({
      headers: auth(tokenB),
      method: "POST",
      payload: { expectedRevision: 1 },
      url: `/api/pricing-positions/${pricingId}/withdrawn`,
    });
    expect(crossUser.statusCode).toBe(404);
    expect(crossUser.json().error.code).toBe("PRICING_POSITION_NOT_FOUND");
  });

  it("maps snapshot and revision states without leaking store details", async () => {
    const { app, positions, tokenA } = await fixture();
    const cases = [
      ["PRICING_SNAPSHOT_NOT_FOUND", 404],
      ["PRICING_SNAPSHOT_QUARANTINED", 409],
      ["PRICING_SNAPSHOT_STALE", 409],
      ["PRICING_POSITION_REVISION_CONFLICT", 409],
    ] as const;
    for (const [code, status] of cases) {
      positions.failure = new PricingPositionError(code);
      const response = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload: importBody(),
        url: "/api/pricing-positions/import",
      });
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(code);
    }

    positions.failure = new Error("postgres://secret:password@host/database");
    const unavailable = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/pricing-positions",
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("PRICING_POSITIONS_UNAVAILABLE");
    expect(unavailable.body).not.toContain("password");
  });
});
