import type {
  LiquidityFlowEvent,
  LiquidityFlowRecord,
  LiquidityFlowTombstone,
} from "../packages/api-contract/src/index.js";
import {
  applyLiquidityFlowFilters,
  buildLiquidityFlowProjection,
  initialLiquidityFlowState,
  parseLiquidityFlowUiFilters,
  reduceLiquidityFlow,
  serializeLiquidityFlowUiFilters,
  type LiquidityFlowUiFilters,
} from "../apps/web/src/liquidity-flow-state.js";
import {
  buildLiquidityFlowStreamUrl,
  LiquidityFlowClient,
} from "../apps/web/src/liquidity-flow-client.js";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function event(
  id: string,
  ts: number,
  overrides: Partial<LiquidityFlowEvent> = {},
): LiquidityFlowEvent {
  return {
    amount0: null,
    amount1: null,
    block_hash: `0x${"11".repeat(32)}`,
    block_number: String(ts),
    chain_id: 56,
    cursor: `flow:v1:${id}`,
    dex: "pcsv3",
    event_type: "add",
    finality: "observed",
    hooks: null,
    id,
    in_range: null,
    liquidity_delta: "1",
    log_index: 1,
    nft_id: null,
    pool_address: "0x1111111111111111111111111111111111111111",
    pool_id: null,
    record_type: "event",
    schema_version: "1.0.0",
    tick_lower: null,
    tick_upper: null,
    token0_address: "0x2222222222222222222222222222222222222222",
    token0_symbol: null,
    token1_address: "0x3333333333333333333333333333333333333333",
    token1_symbol: null,
    ts,
    tx_hash: `0x${"22".repeat(32)}`,
    tx_index: 1,
    usd_value: null,
    user: "0x4444444444444444444444444444444444444444",
    version: "v3",
    ...overrides,
  };
}

function tombstone(reverted: LiquidityFlowEvent): LiquidityFlowTombstone {
  return {
    cursor: `flow:v1:tombstone:${reverted.id}`,
    dex: reverted.dex,
    finality: "reverted",
    id: `tombstone:${reverted.id}`,
    nft_id: reverted.nft_id,
    pool_address: reverted.pool_address,
    pool_id: reverted.pool_id,
    reason: "reorg",
    record_type: "tombstone",
    reverted_id: reverted.id,
    schema_version: "1.0.0",
    token0_address: reverted.token0_address,
    token1_address: reverted.token1_address,
    ts: reverted.ts,
    user: reverted.user,
    version: reverted.version,
  };
}

describe("P02-04 liquidity flow client state", () => {
  it("builds a reconnect URL from the latest since cursor and canonical server filters", () => {
    expect(
      buildLiquidityFlowStreamUrl(300, {
        nftId: "42",
        pool: "0x1111111111111111111111111111111111111111",
        token: "0x2222222222222222222222222222222222222222",
        user: "0x4444444444444444444444444444444444444444",
      }),
    ).toBe(
      "/api/liquidity-adds/stream?since=300" +
        "&pool=0x1111111111111111111111111111111111111111" +
        "&token=0x2222222222222222222222222222222222222222" +
        "&user=0x4444444444444444444444444444444444444444&nft_id=42",
    );
  });

  it("reconnects from the latest SSE id while advancing since by event timestamp", async () => {
    const encoder = new TextEncoder();
    const record = event("retained", 300);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `id: ${record.cursor}\nevent: backfill\ndata: ${JSON.stringify({
              cursor: record.cursor,
              event_type: "liquidity.backfill",
              events: [record],
              has_more: false,
              schema_version: "1.0.0",
              stream_key: "liquidity-flow:56:pool=*:token=*:user=*:nft=*",
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(body, { headers: { "Content-Type": "text/event-stream" }, status: 200 }),
      )
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", globalThis);
    vi.spyOn(Math, "random").mockReturnValue(0);
    let since = 0;
    const subscription = new LiquidityFlowClient().subscribe(
      { nftId: "", pool: "", token: "", user: "" },
      {
        getSince: () => since,
        onBackfill: (backfill) => {
          since = Math.max(since, ...backfill.events.map(({ ts }) => ts));
        },
        onError: vi.fn(),
        onEvent: vi.fn(),
        onHeartbeat: vi.fn(),
        onOpen: vi.fn(),
        onReconnecting: vi.fn(),
      },
    );

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1]).toEqual([
      "/api/liquidity-adds/stream?since=300",
      expect.objectContaining({
        headers: { Accept: "text/event-stream", "Last-Event-ID": record.cursor },
      }),
    ]);
    subscription.close();
  });

  it("deduplicates stable ids, sorts out-of-order backfill, and advances since by ts", () => {
    const older = event("older", 100);
    const newer = event("newer", 300);
    const middle = event("middle", 200);

    const state = reduceLiquidityFlow(initialLiquidityFlowState(50), {
      records: [newer, older, middle, newer],
      type: "backfill",
    });

    expect(state.connection).toBe("live");
    expect(state.events.map(({ id }) => id)).toEqual(["newer", "middle", "older"]);
    expect(state.since).toBe(300);
    expect(state.seenIds.size).toBe(3);
  });

  it("buffers while paused-hidden, then resumes with a stable deduplicated merge", () => {
    const initial = reduceLiquidityFlow(initialLiquidityFlowState(0), {
      records: [event("first", 100)],
      type: "backfill",
    });
    const paused = reduceLiquidityFlow(initial, { type: "pause" });
    const buffered = [event("second", 200), event("first", 100)].reduce(
      (state, record) => reduceLiquidityFlow(state, { record, type: "event" }),
      paused,
    );

    expect(buffered.connection).toBe("paused-hidden");
    expect(buffered.events.map(({ id }) => id)).toEqual(["first"]);
    expect(buffered.buffered).toHaveLength(2);
    expect(buffered.since).toBe(200);

    const resumed = reduceLiquidityFlow(buffered, { type: "resume" });
    expect(resumed.connection).toBe("live");
    expect(resumed.events.map(({ id }) => id)).toEqual(["second", "first"]);
    expect(resumed.buffered).toEqual([]);
  });

  it("removes a reverted row and accepts the replacement branch in replay order", () => {
    const orphan = event("orphan", 100, { block_hash: `0x${"aa".repeat(32)}` });
    const replacement = event("replacement", 100, {
      block_hash: `0x${"bb".repeat(32)}`,
      event_type: "remove",
    });
    const records: LiquidityFlowRecord[] = [orphan, tombstone(orphan), replacement, orphan];

    const state = reduceLiquidityFlow(initialLiquidityFlowState(0), {
      records,
      type: "backfill",
    });

    expect(state.events.map(({ id }) => id)).toEqual(["replacement"]);
    expect(state.revertedIds.has("orphan")).toBe(true);
    expect(state.since).toBe(100);
  });

  it("retains usable rows across stale/reconnecting and exposes empty/error states", () => {
    const empty = reduceLiquidityFlow(initialLiquidityFlowState(0), {
      records: [],
      type: "backfill",
    });
    expect(empty.connection).toBe("empty");
    expect(reduceLiquidityFlow(empty, { code: "FLOW_DOWN", type: "error" }).connection).toBe(
      "error",
    );

    const live = reduceLiquidityFlow(initialLiquidityFlowState(0), {
      records: [event("row", 1)],
      type: "backfill",
    });
    expect(reduceLiquidityFlow(live, { type: "stale" }).connection).toBe("stale");
    expect(reduceLiquidityFlow(live, { type: "reconnecting" }).connection).toBe("reconnecting");
  });

  it("applies event/version/address/NFT filters and excludes null USD above zero", () => {
    const known = event("known", 2, {
      event_type: "remove",
      nft_id: "42",
      usd_value: "100.5",
      version: "v4",
    });
    const unknown = event("unknown", 1, { usd_value: null, version: "v4" });
    const filters: LiquidityFlowUiFilters = {
      eventType: "remove",
      generation: "v4",
      minUsd: "10",
      nftId: "42",
      pool: known.pool_address!,
      token: known.token0_address!,
      user: known.user!,
    };

    expect(applyLiquidityFlowFilters([unknown, known], filters).map(({ id }) => id)).toEqual([
      "known",
    ]);
    expect(
      applyLiquidityFlowFilters([unknown], { ...filters, eventType: "all", nftId: "" }),
    ).toEqual([]);
  });

  it("round-trips clearable flow filters through URL query parameters", () => {
    const filters: LiquidityFlowUiFilters = {
      eventType: "create",
      generation: "v3",
      minUsd: "12.5",
      nftId: "7",
      pool: "0x1111111111111111111111111111111111111111",
      token: "0x2222222222222222222222222222222222222222",
      user: "0x4444444444444444444444444444444444444444",
    };

    const serialized = serializeLiquidityFlowUiFilters(filters);

    expect(parseLiquidityFlowUiFilters(serialized)).toEqual(filters);
    expect(serialized.toString()).toContain("flow_event=create");
  });
});

describe("P02-05 filtered liquidity flow projection", () => {
  it("summarizes the same filtered, deduplicated, replayed event array with Decimal precision", () => {
    const userA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const userB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const duplicate = event("duplicate", 100, {
      event_type: "add",
      usd_value: "9007199254740993.000000000000000001",
      user: userA,
    });
    const removedByReorg = event("orphan", 101, {
      event_type: "remove",
      usd_value: "7",
      user: userB,
    });
    const replacement = event("replacement", 101, {
      event_type: "remove",
      tx_hash: `0x${"33".repeat(32)}`,
      usd_value: "0.000000000000000001",
      user: userA,
    });
    const create = event("create", 102, {
      event_type: "create",
      usd_value: null,
      user: userB,
    });
    const unknownRemove = event("unknown-remove", 103, {
      event_type: "remove",
      usd_value: null,
      user: userB,
      version: "v4",
    });
    const filteredOut = event("filtered-v4-add", 104, {
      usd_value: "1000",
      user: userB,
      version: "v4",
    });

    let state = reduceLiquidityFlow(initialLiquidityFlowState(0), {
      records: [duplicate, duplicate, removedByReorg],
      type: "backfill",
    });
    state = reduceLiquidityFlow(state, { type: "pause" });
    for (const record of [
      tombstone(removedByReorg),
      replacement,
      create,
      unknownRemove,
      filteredOut,
    ]) {
      state = reduceLiquidityFlow(state, { record, type: "event" });
    }
    state = reduceLiquidityFlow(state, { type: "resume" });

    const projection = buildLiquidityFlowProjection(
      state.events,
      { ...defaultFilters(), generation: "v3" },
      { protocols: ["pcsv3"], sort: "net", watchedAddresses: [], watchedOnly: false },
    );

    expect(projection.events.map(({ id }) => id)).toEqual(["create", "replacement", "duplicate"]);
    expect(projection.summary).toEqual({
      completeness: "complete",
      eventCount: 3,
      inflowUsd: "9007199254740993.000000000000000001",
      netUsd: "9007199254740993",
      outflowUsd: "0.000000000000000001",
      uniqueAddressCount: 2,
      unvaluedEventCount: 0,
      valuedEventCount: 2,
      valuedSubtotalUsd: "9007199254740993.000000000000000002",
    });

    const partial = buildLiquidityFlowProjection(
      state.events,
      { ...defaultFilters(), generation: "v4" },
      { protocols: ["pcsv3"], sort: "net", watchedAddresses: [], watchedOnly: false },
    );
    expect(partial.events.map(({ id }) => id)).toEqual(["filtered-v4-add", "unknown-remove"]);
    expect(partial.summary).toEqual({
      completeness: "partial",
      eventCount: 2,
      inflowUsd: "1000",
      netUsd: "1000",
      outflowUsd: "0",
      uniqueAddressCount: 1,
      unvaluedEventCount: 1,
      valuedEventCount: 1,
      valuedSubtotalUsd: "1000",
    });
  });

  it("aggregates canonical users and pools with partial grouping and stable address ties", () => {
    const addressA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const addressB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const addressC = "0xcccccccccccccccccccccccccccccccccccccccc";
    const idleAddress = "0xdddddddddddddddddddddddddddddddddddddddd";
    const poolId = `0x${"44".repeat(32)}` as const;
    const events = [
      event("a-add", 200, { pool_address: null, pool_id: poolId, usd_value: "10", user: addressA }),
      event("a-remove", 200, {
        event_type: "remove",
        pool_address: null,
        pool_id: poolId.toUpperCase() as `0x${string}`,
        usd_value: "2",
        user: addressA.toLowerCase() as `0x${string}`,
      }),
      event("b-create", 200, { event_type: "create", usd_value: null, user: addressB }),
      event("b-add", 199, { usd_value: "8", user: addressB }),
      event("c-add", 200, { usd_value: "8", user: addressC }),
      event("c-remove-unknown", 201, {
        event_type: "remove",
        usd_value: null,
        user: addressC,
      }),
      event("no-user", 202, { usd_value: "50", user: null }),
    ];
    const options = {
      protocols: ["pcsv3"] as const,
      watchedAddresses: [addressA, idleAddress],
      watchedOnly: false,
    };

    const byNet = buildLiquidityFlowProjection(events, defaultFilters(), {
      ...options,
      sort: "net",
    }).addresses;
    expect(byNet.map(({ address }) => address)).toEqual([
      addressA.toLowerCase(),
      addressB,
      addressC,
    ]);
    expect(byNet[0]).toMatchObject({
      completeness: "complete",
      eventCount: 2,
      inflowUsd: "10",
      netUsd: "8",
      outflowUsd: "2",
      poolCount: 1,
      recentTs: 200,
    });
    expect(byNet[2]).toMatchObject({
      completeness: "partial",
      eventCount: 2,
      netUsd: "8",
      unvaluedEventCount: 1,
    });

    expect(
      buildLiquidityFlowProjection(events, defaultFilters(), {
        ...options,
        sort: "count",
      }).addresses.map(({ address }) => address),
    ).toEqual([addressA.toLowerCase(), addressB, addressC]);
    expect(
      buildLiquidityFlowProjection(events, defaultFilters(), {
        ...options,
        sort: "recent",
      }).addresses.map(({ address }) => address),
    ).toEqual([addressC, addressA.toLowerCase(), addressB]);

    const watched = buildLiquidityFlowProjection(events, defaultFilters(), {
      ...options,
      sort: "net",
      watchedOnly: true,
    });
    expect(watched.events.map(({ id }) => id)).toEqual(["a-add", "a-remove"]);
    expect(watched.summary.eventCount).toBe(2);
    expect(watched.addresses).toEqual([
      expect.objectContaining({ address: addressA.toLowerCase(), idle: false }),
      expect.objectContaining({ address: idleAddress, eventCount: 0, idle: true, poolCount: 0 }),
    ]);
  });
});

function defaultFilters(): LiquidityFlowUiFilters {
  return {
    eventType: "all",
    generation: "all",
    minUsd: "",
    nftId: "",
    pool: "",
    token: "",
    user: "",
  };
}
