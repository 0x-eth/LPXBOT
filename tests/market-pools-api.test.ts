import type {
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  MarketPoolsProvider,
  MarketPoolsStreamContext,
} from "../apps/api/src/market-pools.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const snapshot: MarketPoolSnapshot = {
  chainId: 56,
  generatedAt: "2026-08-16T01:00:00.000Z",
  minutes: 5,
  rows: [
    {
      activeTvlUsd: null,
      chainId: 56,
      fdvUsd: "12000000.25",
      feeActiveTvl: null,
      feesUsd: "42.125",
      feeTvl: "0.0042125",
      poolAddress: "0x1111111111111111111111111111111111111111",
      poolId: null,
      protocol: "pcsv3",
      token0Symbol: "WBNB",
      token1Symbol: "USDT",
      transactionCount: "17",
      tvlUsd: "10000",
      volumeUsd: "9000.75",
    },
  ],
  version: "7",
  windowEnd: "2026-08-16T01:00:00.000Z",
  windowStart: "2026-08-16T00:55:00.000Z",
};

function envelope(
  sequence: string,
  eventType: "pools.snapshot" | "pools.diff" | "heartbeat",
  data: MarketStreamEnvelope["data"],
): MarketStreamEnvelope {
  return {
    cursor: `market:v1:56:5:1:${sequence}`,
    data,
    emittedAt: "2026-08-16T01:00:00.000Z",
    epoch: "1",
    eventType,
    mode: eventType === "pools.snapshot" ? "snapshot" : "diff",
    schemaVersion: "1.0.0",
    sequence,
    streamKey: "top-fees:56:5",
  };
}

class FiniteMarketProvider implements MarketPoolsProvider {
  streamContexts: MarketPoolsStreamContext[] = [];

  async getTopFees(): Promise<MarketPoolSnapshot> {
    return structuredClone(snapshot);
  }

  async *subscribe(context: MarketPoolsStreamContext): AsyncIterable<MarketStreamEnvelope> {
    this.streamContexts.push(context);
    if (!context.lastEventId) yield envelope("7", "pools.snapshot", snapshot);
    yield envelope("8", "pools.diff", {
      tombstones: [],
      upserts: [{ ...snapshot.rows[0]!, feesUsd: "43" }],
      version: "8",
    });
    yield envelope("9", "heartbeat", null);
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(
    sessionStore,
    "29000000-0000-4000-8000-000000000001",
  );
  const provider = new FiniteMarketProvider();
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    marketPoolsProvider: provider,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, provider, token };
}

function parseSse(body: string) {
  return body
    .trim()
    .split("\n\n")
    .filter((block) => block.includes("event:"))
    .map((block) => {
      const values = Object.fromEntries(
        block.split("\n").map((line) => {
          const separator = line.indexOf(":");
          return [line.slice(0, separator), line.slice(separator + 1).trim()];
        }),
      );
      return { event: values.event, id: values.id, payload: JSON.parse(values.data!) };
    });
}

describe("P02-02 top-fees API and replayable SSE", () => {
  it("returns only BSC snapshots for contracted windows", async () => {
    const { app, token } = await fixture();
    const response = await app.inject({
      headers: { cookie: `lpbot_session=${token}` },
      method: "GET",
      url: "/api/pools/top-fees/5?chainId=56",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toEqual(snapshot);

    for (const url of [
      "/api/pools/top-fees/2?chainId=56",
      "/api/pools/top-fees/5?chainId=1",
      "/api/pools/top-fees/5?chainId=56.0",
    ]) {
      const invalid = await app.inject({
        headers: { cookie: `lpbot_session=${token}` },
        method: "GET",
        url,
      });
      expect(invalid.statusCode, url).toBe(400);
      expect(invalid.json().error.code, url).toBe("MARKET_QUERY_INVALID");
    }
  });

  it("uses the cursor as SSE id and replays strictly after Last-Event-ID", async () => {
    const { app, provider, token } = await fixture();
    const lastEventId = "market:v1:56:5:1:7";
    const response = await app.inject({
      headers: {
        accept: "text/event-stream",
        cookie: `lpbot_session=${token}`,
        "last-event-id": lastEventId,
      },
      method: "GET",
      url: "/api/pools/top-fees/5/stream?chainId=56",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-accel-buffering"]).toBe("no");
    const events = parseSse(response.body);
    expect(events.map(({ event, id }) => [event, id])).toEqual([
      ["pools.diff", "market:v1:56:5:1:8"],
      ["heartbeat", "market:v1:56:5:1:9"],
    ]);
    expect(provider.streamContexts[0]).toMatchObject({
      chainId: 56,
      lastEventId,
      minutes: 5,
    });
  });

  it("rejects anonymous requests before opening the stream", async () => {
    const { app, provider } = await fixture();
    const response = await app.inject({
      headers: { accept: "text/event-stream" },
      method: "GET",
      url: "/api/pools/top-fees/5/stream?chainId=56",
    });
    expect(response.statusCode).toBe(401);
    expect(provider.streamContexts).toEqual([]);
  });
});

