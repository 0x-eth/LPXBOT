import type {
  PricingPositionCostBasis,
  PricingPositionObservation,
  WalletPosition,
} from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  MemoryPricingPositionStore,
  PricingPositionCursorError,
  PricingPositionStreamService,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T08:00:00.000Z");
const tenantId = "tenant-p05-03";
const userA = "71000000-0000-4000-8000-000000000001";
const userB = "71000000-0000-4000-8000-000000000002";
const walletId = "71000000-0000-4000-8000-000000000011";
const walletAddress = "0x1111111111111111111111111111111111111111" as const;
const epoch = "71000000-0000-4000-8000-000000000090";
const cursorSecret = "pricing-position-cursor-secret-32-bytes-minimum";

function chainPosition(liquidity = "300"): WalletPosition {
  return {
    approval: {
      approvedAddress: null,
      approvedForAll: false,
      helperAuthorized: false,
      nftOwner: walletAddress,
      observedAtBlock: "116718500",
    },
    chainId: 56,
    fees: {
      estimated0BaseUnit: "7",
      estimated1BaseUnit: "9",
      owed0BaseUnit: "7",
      owed1BaseUnit: "9",
    },
    liquidity: { amount0BaseUnit: "100", amount1BaseUnit: "200", raw: liquidity },
    owner: walletAddress,
    platformId: 1,
    pool: {
      feePips: "500",
      hooks: null,
      poolAddress: "0x2222222222222222222222222222222222222222",
      poolId: null,
      tickSpacing: "10",
      token0: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
      token1: "0x55d398326f99059ff775485246999027b3197955",
    },
    snapshot: {
      blockHash: `0x${"ab".repeat(32)}`,
      blockNumber: "116718500",
      blockTimestamp: now.toISOString(),
      digest: `0x${liquidity.padStart(64, "0")}`,
      positionManager: "0x7b8a01b39d58278b5de7e48c8449c9f4f5170613",
      positionManagerCodeHash:
        "0xbc0177f23ffd65c41e41fb201e170cb253489d7d637f8f6a15743a1f861160f5",
      registryVersion: "p05-bsc-execution-v1",
    },
    ticks: { current: "0", inRange: true, lower: "-10", upper: "10" },
    tokenId: "42",
  };
}

const costBasis: PricingPositionCostBasis = {
  amount0BaseUnit: "100",
  amount1BaseUnit: "200",
  priceObservedAt: null,
  priceSource: null,
  priceStatus: "missing",
  usdValueDecimal: null,
};

function observation(suffix: string, liquidity = "300"): PricingPositionObservation {
  return {
    blockHash: `0x${"ab".repeat(32)}`,
    blockNumber: "116718500",
    liquidityAmount0BaseUnit: "100",
    liquidityAmount1BaseUnit: "200",
    liquidityRaw: liquidity,
    observationId: `71000000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    observedAt: now.toISOString(),
    observedFee0BaseUnit: "7",
    observedFee1BaseUnit: "9",
    pageSnapshotDigest: `0x${"cd".repeat(32)}`,
    recordedAt: now.toISOString(),
    snapshotDigest: `0x${suffix.padStart(64, "0")}`,
  };
}

function streamFixture(options: { backfillLimit?: number; epoch?: string } = {}) {
  let id = 100;
  const store = new MemoryPricingPositionStore({
    epoch: options.epoch ?? epoch,
    id: () => `71000000-0000-4000-8000-${(++id).toString().padStart(12, "0")}`,
  });
  const stream = new PricingPositionStreamService({
    backfillLimit: options.backfillLimit ?? 10,
    cursorSecret,
    finite: true,
    now: () => now,
    store,
  });
  return { store, stream };
}

async function seed(store: MemoryPricingPositionStore) {
  return store.importPosition({
    costBasis,
    now,
    observation: observation("1"),
    position: chainPosition(),
    tenantId,
    userId: userA,
    walletAddress,
    walletId,
  });
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

function parseSse(body: string) {
  return body
    .trim()
    .split("\n\n")
    .filter((block) => block.includes("event:"))
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines.find((line) => line.startsWith("event:"))!.slice(6).trim(),
        id: lines.find((line) => line.startsWith("id:"))?.slice(3).trim() ?? null,
        payload: JSON.parse(lines.find((line) => line.startsWith("data:"))!.slice(5).trim()),
      };
    });
}

describe("P05-03 durable pricing position SSE", () => {
  it("sends a first snapshot, then exact diff/tombstone backfill and heartbeat", async () => {
    const { store, stream } = streamFixture();
    const imported = await seed(store);
    const initial = await stream.open({ lastEventId: null, tenantId, userId: userA });
    expect(initial.initialEvent).toMatchObject({
      epoch,
      sequence: "1",
      type: "snapshot",
    });
    expect(initial.initialEvent?.type === "snapshot" && initial.initialEvent.items).toEqual([
      imported,
    ]);

    const hidden = await store.transition({
      expectedRevision: 1,
      now,
      observation: observation("1"),
      pricingId: imported.pricingId,
      status: "hidden",
      tenantId,
      userId: userA,
    });
    await store.transition({
      expectedRevision: hidden.revision,
      now,
      observation: observation("2", "0"),
      pricingId: imported.pricingId,
      status: "withdrawn",
      tenantId,
      userId: userA,
    });

    const resumed = await stream.open({
      lastEventId: initial.initialEvent!.cursor,
      tenantId,
      userId: userA,
    });
    expect(resumed.initialEvent).toBeNull();
    const events = await collect(
      stream.subscribe({ ...resumed, signal: new AbortController().signal, tenantId, userId: userA }),
    );
    expect(events.map(({ sequence, type }) => [type, sequence])).toEqual([
      ["diff", "2"],
      ["tombstone", "3"],
      ["heartbeat", "3"],
    ]);
    expect(events[1]).toMatchObject({
      pricingId: imported.pricingId,
      revision: 3,
      status: "withdrawn",
    });

    const acknowledged = await stream.open({
      lastEventId: events[1]!.cursor,
      tenantId,
      userId: userA,
    });
    expect(
      (await collect(
        stream.subscribe({
          ...acknowledged,
          signal: new AbortController().signal,
          tenantId,
          userId: userA,
        }),
      )).map(({ type }) => type),
    ).toEqual(["heartbeat"]);
  });

  it("binds cursor integrity to epoch, tenant, user, and retained sequence", async () => {
    const { store, stream } = streamFixture();
    const imported = await seed(store);
    const opened = await stream.open({ lastEventId: null, tenantId, userId: userA });
    const cursor = opened.initialEvent!.cursor;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
    await expect(
      stream.open({ lastEventId: tampered, tenantId, userId: userA }),
    ).rejects.toMatchObject({ code: "PRICING_CURSOR_INVALID" });
    await expect(
      stream.open({ lastEventId: cursor, tenantId, userId: userB }),
    ).rejects.toMatchObject({ code: "PRICING_CURSOR_INVALID" });

    const restarted = streamFixture({ epoch: "71000000-0000-4000-8000-000000000091" });
    await expect(
      restarted.stream.open({ lastEventId: cursor, tenantId, userId: userA }),
    ).rejects.toMatchObject({ code: "PRICING_CURSOR_EXPIRED" });

    const hidden = await store.transition({
      expectedRevision: 1,
      now,
      observation: observation("1"),
      pricingId: imported.pricingId,
      status: "hidden",
      tenantId,
      userId: userA,
    });
    await store.transition({
      expectedRevision: hidden.revision,
      now,
      observation: observation("2", "0"),
      pricingId: imported.pricingId,
      status: "withdrawn",
      tenantId,
      userId: userA,
    });
    store.pruneOutboxBefore({ sequence: "3", tenantId, userId: userA });
    await expect(
      stream.open({ lastEventId: cursor, tenantId, userId: userA }),
    ).rejects.toBeInstanceOf(PricingPositionCursorError);
    await expect(
      stream.open({ lastEventId: cursor, tenantId, userId: userA }),
    ).rejects.toMatchObject({ code: "PRICING_CURSOR_EXPIRED" });
  });

  it("caps each backfill without skipping the next reconnect", async () => {
    const { store, stream } = streamFixture({ backfillLimit: 1 });
    const imported = await seed(store);
    const first = await stream.open({ lastEventId: null, tenantId, userId: userA });
    const hidden = await store.transition({
      expectedRevision: 1,
      now,
      observation: observation("1"),
      pricingId: imported.pricingId,
      status: "hidden",
      tenantId,
      userId: userA,
    });
    await store.transition({
      expectedRevision: hidden.revision,
      now,
      observation: observation("2", "0"),
      pricingId: imported.pricingId,
      status: "withdrawn",
      tenantId,
      userId: userA,
    });
    const resume = await stream.open({
      lastEventId: first.initialEvent!.cursor,
      tenantId,
      userId: userA,
    });
    const firstBackfill = await collect(
      stream.subscribe({ ...resume, signal: new AbortController().signal, tenantId, userId: userA }),
    );
    expect(firstBackfill.map(({ type }) => type)).toEqual(["diff"]);
    const next = await stream.open({
      lastEventId: firstBackfill[0]!.cursor,
      tenantId,
      userId: userA,
    });
    expect(
      (await collect(
        stream.subscribe({ ...next, signal: new AbortController().signal, tenantId, userId: userA }),
      )).map(({ type }) => type),
    ).toEqual(["tombstone"]);
  });
});

const apps: Array<ReturnType<typeof buildApiApp>> = [];

describe("P05-03 pricing position SSE API", () => {
  it("formats recoverable user-scoped SSE and validates Last-Event-ID before hijacking", async () => {
    const { store, stream } = streamFixture();
    const imported = await seed(store);
    const sessions = new SessionFixtureStore();
    const [tokenA, tokenB] = await Promise.all([
      issueFixtureSession(sessions, userA, now),
      issueFixtureSession(sessions, userB, now),
    ]);
    const app = buildApiApp({
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      pricingPositionStream: stream,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: sessions,
      tenantId,
    });
    apps.push(app);

    const anonymous = await app.inject({ method: "GET", url: "/api/pricing-positions/stream" });
    expect(anonymous.statusCode).toBe(401);

    const first = await app.inject({
      headers: { accept: "text/event-stream", cookie: `lpbot_session=${tokenA}` },
      method: "GET",
      url: "/api/pricing-positions/stream",
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("text/event-stream");
    expect(first.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    expect(first.headers["x-accel-buffering"]).toBe("no");
    const firstEvents = parseSse(first.body);
    expect(firstEvents.map(({ event }) => event)).toEqual(["snapshot", "heartbeat"]);
    expect(firstEvents[0]!.payload.items).toEqual([imported]);

    await store.transition({
      expectedRevision: 1,
      now,
      observation: observation("1"),
      pricingId: imported.pricingId,
      status: "hidden",
      tenantId,
      userId: userA,
    });
    const resumed = await app.inject({
      headers: {
        accept: "text/event-stream",
        cookie: `lpbot_session=${tokenA}`,
        "last-event-id": firstEvents[0]!.id!,
      },
      method: "GET",
      url: "/api/pricing-positions/stream",
    });
    expect(parseSse(resumed.body).map(({ event }) => event)).toEqual(["diff", "heartbeat"]);

    const crossUser = await app.inject({
      headers: {
        cookie: `lpbot_session=${tokenB}`,
        "last-event-id": firstEvents[0]!.id!,
      },
      method: "GET",
      url: "/api/pricing-positions/stream",
    });
    expect(crossUser.statusCode).toBe(400);
    expect(crossUser.headers["content-type"]).not.toContain("text/event-stream");
    expect(crossUser.json().error.code).toBe("PRICING_CURSOR_INVALID");
  });
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});
