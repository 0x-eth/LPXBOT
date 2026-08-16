import type {
  MarketPoolSnapshot,
  MarketStreamEnvelope,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  MarketPoolsProvider,
  MarketPoolsContext,
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
  snapshotContexts: MarketPoolsContext[] = [];
  streamContexts: MarketPoolsStreamContext[] = [];

  async getTopFees(context: MarketPoolsContext): Promise<MarketPoolSnapshot> {
    this.snapshotContexts.push(context);
    return {
      ...structuredClone(snapshot),
      rows: snapshot.rows.filter(({ protocol }) => context.protocols.includes(protocol)),
    };
  }

  async *subscribe(context: MarketPoolsStreamContext): AsyncIterable<MarketStreamEnvelope> {
    this.streamContexts.push(context);
    const key =
      context.protocols.length === 4
        ? "top-fees:56:5"
        : `top-fees:56:5:dex=${context.protocols.join(",")}`;
    const filteredSnapshot = await this.getTopFees(context);
    if (!context.lastEventId)
      yield { ...envelope("7", "pools.snapshot", filteredSnapshot), streamKey: key };
    yield {
      ...envelope("8", "pools.diff", {
        tombstones: [],
        upserts: context.protocols.includes("pcsv3")
          ? [{ ...snapshot.rows[0]!, feesUsd: "43" }]
          : [],
        version: "8",
      }),
      streamKey: key,
    };
    yield { ...envelope("9", "heartbeat", null), streamKey: key };
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(sessionStore, "29000000-0000-4000-8000-000000000001");
  const provider = new FiniteMarketProvider();
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    marketPoolsProvider: provider,
    now: () => new Date("2026-08-14T02:00:00.000Z"),
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
      protocols: ["pcsv3", "univ3", "pcsv4", "univ4"],
    });
  });

  it("normalizes DEX sets identically for snapshot and stream, including empty results", async () => {
    const { app, provider, token } = await fixture();
    const headers = { cookie: `lpbot_session=${token}` };
    const combined = await app.inject({
      headers,
      method: "GET",
      url: "/api/pools/top-fees/5?chainId=56&dex=univ4,pcsv3,univ4",
    });
    const empty = await app.inject({
      headers,
      method: "GET",
      url: "/api/pools/top-fees/5?chainId=56&dex=univ4",
    });
    const stream = await app.inject({
      headers: { ...headers, accept: "text/event-stream" },
      method: "GET",
      url: "/api/pools/top-fees/5/stream?chainId=56&dex=univ4,pcsv3,univ4",
    });

    expect(combined.statusCode).toBe(200);
    expect(combined.json().data.rows.map(({ protocol }: { protocol: string }) => protocol)).toEqual(
      ["pcsv3"],
    );
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data.rows).toEqual([]);
    expect(provider.snapshotContexts.map(({ protocols }) => protocols)).toContainEqual([
      "pcsv3",
      "univ4",
    ]);
    expect(provider.streamContexts[0]?.protocols).toEqual(["pcsv3", "univ4"]);
    expect(
      parseSse(stream.body).every(
        ({ payload }) => payload.streamKey === "top-fees:56:5:dex=pcsv3,univ4",
      ),
    ).toBe(true);
  });

  it.each(["", "pcsv2", "pcsv3,", "pcsv3,ethereum"])(
    "rejects an invalid DEX collection: %s",
    async (dex) => {
      const { app, token } = await fixture();
      const response = await app.inject({
        headers: { cookie: `lpbot_session=${token}` },
        method: "GET",
        url: `/api/pools/top-fees/5?chainId=56&dex=${encodeURIComponent(dex)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("MARKET_QUERY_INVALID");
    },
  );

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
