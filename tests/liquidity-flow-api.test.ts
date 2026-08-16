import type {
  LiquidityFlowBackfill,
  LiquidityFlowCanonicalEnvelope,
  LiquidityFlowEvent,
  LiquidityFlowTombstone,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import type {
  LiquidityFlowProvider,
  LiquidityFlowStreamContext,
} from "../apps/api/src/liquidity-flow.js";
import { afterEach, describe, expect, it } from "vitest";

import { SessionFixtureStore } from "./helpers/session-fixture.js";

const flowEvent: LiquidityFlowEvent = {
  amount0: "100",
  amount1: "200",
  block_hash: `0x${"11".repeat(32)}`,
  block_number: "100",
  chain_id: 56,
  cursor: "flow:v1:56:1:event",
  dex: "pcsv3",
  event_type: "add",
  finality: "observed",
  hooks: null,
  id: "event-1",
  in_range: null,
  liquidity_delta: "300",
  log_index: 2,
  nft_id: null,
  pool_address: "0x1111111111111111111111111111111111111111",
  pool_id: null,
  record_type: "event",
  schema_version: "1.0.0",
  tick_lower: "-10",
  tick_upper: "10",
  token0_address: "0x2222222222222222222222222222222222222222",
  token0_symbol: null,
  token1_address: "0x3333333333333333333333333333333333333333",
  token1_symbol: null,
  ts: 1_765_843_200_000,
  tx_hash: `0x${"22".repeat(32)}`,
  tx_index: 1,
  usd_value: null,
  user: "0x4444444444444444444444444444444444444444",
  version: "v3",
};

const tombstone: LiquidityFlowTombstone = {
  cursor: "flow:v1:56:2:tombstone",
  dex: "pcsv3",
  finality: "reverted",
  id: "tombstone-1",
  nft_id: null,
  pool_address: flowEvent.pool_address,
  pool_id: null,
  reason: "reorg",
  record_type: "tombstone",
  reverted_id: flowEvent.id,
  schema_version: "1.0.0",
  token0_address: flowEvent.token0_address,
  token1_address: flowEvent.token1_address,
  ts: flowEvent.ts,
  user: flowEvent.user,
  version: "v3",
};

function canonical(
  eventType: LiquidityFlowCanonicalEnvelope["eventType"],
  data: LiquidityFlowCanonicalEnvelope["data"],
  cursor: string,
): LiquidityFlowCanonicalEnvelope {
  return {
    cursor,
    data,
    emittedAt: "2026-08-16T01:00:00.000Z",
    epoch: "1",
    eventType,
    mode: eventType === "liquidity.backfill" ? "snapshot" : "diff",
    schemaVersion: "1.0.0",
    sequence: cursor.split(":").at(-2) ?? "0",
    streamKey: "liquidity-flow:56:pool=0x1111111111111111111111111111111111111111",
  };
}

class FiniteLiquidityFlowProvider implements LiquidityFlowProvider {
  contexts: LiquidityFlowStreamContext[] = [];

  async *subscribe(context: LiquidityFlowStreamContext) {
    this.contexts.push(context);
    const backfill: LiquidityFlowBackfill = {
      cursor: flowEvent.cursor,
      event_type: "liquidity.backfill",
      events: [flowEvent],
      has_more: false,
      schema_version: "1.0.0",
      stream_key: canonical("heartbeat", null, flowEvent.cursor).streamKey,
    };
    yield canonical("liquidity.backfill", backfill, flowEvent.cursor);
    yield canonical("liquidity.event", tombstone, tombstone.cursor);
    yield canonical("heartbeat", null, tombstone.cursor);
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(options: { max?: number } = {}) {
  const provider = new FiniteLiquidityFlowProvider();
  const app = buildApiApp({
    liquidityFlowProvider: provider,
    liquidityFlowRateLimit: { max: options.max ?? 30, timeWindowMs: 60_000 },
    maintenance: { enabled: false, message: null, until: null },
    now: () => new Date("2026-08-16T02:00:00.000Z"),
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: new SessionFixtureStore(),
  });
  apps.push(app);
  return { app, provider };
}

function parseWireEvents(body: string) {
  return body
    .split("\n\n")
    .filter((block) => block.includes("event:"))
    .map((block) => {
      const lines = Object.fromEntries(
        block.split("\n").map((line) => {
          const separator = line.indexOf(":");
          return [line.slice(0, separator), line.slice(separator + 1).trim()];
        }),
      );
      return { event: lines.event, id: lines.id, payload: JSON.parse(lines.data!) };
    });
}

describe("P02-04 public liquidity flow SSE", () => {
  it("maps canonical backfill/event/heartbeat to the frozen wire protocol", async () => {
    const { app, provider } = fixture();
    const response = await app.inject({
      headers: { accept: "text/event-stream" },
      method: "GET",
      url:
        "/api/liquidity-adds/stream?since=1765843200000" +
        "&pool=0x1111111111111111111111111111111111111111" +
        "&token=0x2222222222222222222222222222222222222222" +
        "&user=0x4444444444444444444444444444444444444444&nft_id=42",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers["x-accel-buffering"]).toBe("no");
    expect(parseWireEvents(response.body)).toEqual([
      { event: "backfill", id: flowEvent.cursor, payload: expect.objectContaining({ events: [flowEvent] }) },
      { event: "liquidity-add", id: tombstone.cursor, payload: tombstone },
    ]);
    expect(response.body).toContain(": heartbeat");
    expect(provider.contexts[0]).toMatchObject({
      nftId: "42",
      pool: flowEvent.pool_address,
      since: 1_765_843_200_000,
      token: flowEvent.token0_address,
      user: flowEvent.user,
    });
    expect(provider.contexts[0]?.signal.aborted).toBe(true);
  });

  it.each([
    "/api/liquidity-adds/stream",
    "/api/liquidity-adds/stream?since=-1",
    "/api/liquidity-adds/stream?since=1.5",
    "/api/liquidity-adds/stream?since=1&pool=bad",
    "/api/liquidity-adds/stream?since=1&token=0x11",
    "/api/liquidity-adds/stream?since=1&user=0x11",
    "/api/liquidity-adds/stream?since=1&nft_id=-2",
    "/api/liquidity-adds/stream?since=1&unexpected=true",
  ])("rejects malformed public filters before subscribing: %s", async (url) => {
    const { app, provider } = fixture();
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("LIQUIDITY_FLOW_QUERY_INVALID");
    expect(provider.contexts).toEqual([]);
  });

  it("rate limits the public stream", async () => {
    const { app } = fixture({ max: 1 });
    const first = await app.inject({
      method: "GET",
      url: "/api/liquidity-adds/stream?since=1",
    });
    const limited = await app.inject({
      method: "GET",
      url: "/api/liquidity-adds/stream?since=1",
    });

    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
  });
});
