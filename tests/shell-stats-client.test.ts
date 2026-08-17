import type { ShellStatsEvent } from "../packages/api-contract/src/index.js";
import {
  ApiShellStatsProvider,
  createShellStatsState,
  parseShellStatsEvent,
  reduceShellStatsEvent,
  shellStatsDisplay,
} from "../apps/web/src/shell-stats.js";
import { describe, expect, it, vi } from "vitest";

const observedAt = "2026-08-14T09:15:00.000Z";

describe("P01-06 shell stats reducer", () => {
  it("merges snapshot and updates while ignoring duplicate sequence", () => {
    const snapshot: ShellStatsEvent = {
      observedAt,
      sequence: 10,
      stats: {
        fps: 60,
        gas: { baseGwei: null, ethereumGwei: 0.232 },
        online: true,
        pingMs: 84,
        taskCounts: { paused: 1, running: 1, stopped: null },
      },
      type: "snapshot",
    };
    const first = reduceShellStatsEvent(createShellStatsState(), snapshot);
    const updated = reduceShellStatsEvent(first, {
      observedAt,
      sequence: 11,
      stats: { gas: { baseGwei: 0.006 }, pingMs: 85 },
      type: "update",
    });
    const duplicate = reduceShellStatsEvent(updated, {
      observedAt,
      sequence: 11,
      stats: { pingMs: 999 },
      type: "update",
    });
    expect(duplicate).toBe(updated);
    expect(updated.stats).toEqual({
      fps: 60,
      gas: { baseGwei: 0.006, ethereumGwei: 0.232 },
      online: true,
      pingMs: 85,
      taskCounts: { paused: 1, running: 1, stopped: null },
    });
    expect(updated.sequence).toBe(11);
  });

  it("renders null, missing and disconnected stats as unavailable instead of zero or online", () => {
    const empty = shellStatsDisplay(createShellStatsState());
    expect(empty).toMatchObject({
      baseGas: "--",
      fps: "--",
      online: "不可用",
      paused: "--",
      ping: "--",
      running: "--",
      stopped: "--",
    });

    const connected = reduceShellStatsEvent(createShellStatsState(), {
      observedAt,
      sequence: 1,
      stats: {
        fps: null,
        gas: { baseGwei: null, ethereumGwei: null },
        online: null,
        pingMs: null,
        taskCounts: { paused: null, running: null, stopped: null },
      },
      type: "snapshot",
    });
    expect(shellStatsDisplay({ ...connected, connected: false })).toEqual(empty);
  });

  it("renders authoritative zeros explicitly and rejects late snapshots and updates", () => {
    const zero = reduceShellStatsEvent(createShellStatsState(), {
      observedAt,
      sequence: 10,
      stats: {
        fps: null,
        gas: { baseGwei: null, ethereumGwei: null },
        online: null,
        pingMs: null,
        taskCounts: { paused: 0, running: 0, stopped: 0 },
      },
      type: "snapshot",
    });
    expect(shellStatsDisplay(zero)).toMatchObject({ paused: "0", running: "0", stopped: "0" });
    expect(
      reduceShellStatsEvent(zero, {
        observedAt: "2026-08-14T09:16:00.000Z",
        sequence: 9,
        stats: { taskCounts: { running: 999 } },
        type: "update",
      }),
    ).toBe(zero);
    expect(
      reduceShellStatsEvent(zero, {
        observedAt: "2026-08-14T09:16:00.000Z",
        sequence: 8,
        stats: {
          fps: null,
          gas: { baseGwei: null, ethereumGwei: null },
          online: true,
          pingMs: null,
          taskCounts: { paused: 9, running: 9, stopped: 9 },
        },
        type: "snapshot",
      }),
    ).toBe(zero);
  });

  it("rejects unsafe task counts and sequence values at the wire boundary", () => {
    const event = {
      observedAt,
      sequence: 1,
      stats: {
        fps: null,
        gas: { baseGwei: null, ethereumGwei: null },
        online: null,
        pingMs: null,
        taskCounts: { paused: 0, running: Number.MAX_SAFE_INTEGER + 1, stopped: 0 },
      },
      type: "snapshot",
    };
    expect(parseShellStatsEvent(event)).toBeNull();
    expect(parseShellStatsEvent({ ...event, sequence: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
  });
});

describe("P01-06 API shell stats provider", () => {
  it("parses split lanes, resumes from the recommendation cursor, backs off and aborts cleanup", async () => {
    const encoder = new TextEncoder();
    const selectionHash = `sha256:${"a".repeat(64)}`;
    const cursor = `rec-pools:v1:bsc:3:Nw:MjAyNi0wOC0xN1QwMTo1NTowMC4wMDBa:${"a".repeat(64)}`;
    const recommendation = JSON.stringify({
      cursor,
      observedAt,
      pools: [
        {
          chainId: 56,
          feePips: "500",
          feesUsd: "12.5",
          poolAddress: `0x${"1".repeat(40)}`,
          poolId: null,
          poolKey: `56:0x${"1".repeat(40)}`,
          protocol: "pcsv3",
          token0Address: `0x${"a".repeat(40)}`,
          token0Symbol: "WBNB",
          token1Address: `0x${"b".repeat(40)}`,
          token1Symbol: "USDT",
        },
      ],
      selectionHash,
      sourceVersion: "7",
      sourceWindow: 5,
      sourceWindowEnd: "2026-08-17T01:55:00.000Z",
      type: "rec_pools_snapshot",
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `id: ${cursor}\nevent: rec_pools_snapshot\ndata: ${recommendation}\n\n` +
              'event: snapshot\ndata: {"type":"snapshot","sequence":10,"observedAt":"2026-08-14T09:15:00.000Z","stats":{"online":true,"taskCounts":{"running":1,"paused":1,"stopped":1},',
          ),
        );
        controller.enqueue(
          encoder.encode('"gas":{"baseGwei":null,"ethereumGwei":null},"fps":60,"pingMs":84}}\n\n'),
        );
        controller.close();
      },
    });
    let thirdSignal: AbortSignal | null = null;
    const getThirdSignal = (): AbortSignal | null => thirdSignal;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(stream, { headers: { "Content-Type": "text/event-stream" }, status: 200 }),
      )
      .mockRejectedValueOnce(new TypeError("fixture disconnect"))
      .mockImplementationOnce((_input, init) => {
        thirdSignal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          thirdSignal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      });
    const delays: number[] = [];
    const provider = new ApiShellStatsProvider({
      fetcher,
      initialRetryMs: 250,
      maxRetryMs: 1_000,
      now: () => new Date("2026-08-17T02:00:20.000Z"),
      sleep: async (delay) => {
        delays.push(delay);
      },
    });
    const states: ReturnType<typeof createShellStatsState>[] = [];
    const stop = provider.subscribe((state) => states.push(state));

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(delays).toEqual([250, 500]);
    expect(states.some((state) => state.connected && state.sequence === 10)).toBe(true);
    expect(states.some((state) => state.recommendations.status === "ready")).toBe(true);
    expect(states.at(-1)?.connected).toBe(false);
    stop();
    expect(getThirdSignal()?.aborted).toBe(true);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]).toEqual([
      "/api/stats/stream?chain=bsc&limit=3",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "text/event-stream" },
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: { Accept: "text/event-stream", "Last-Event-ID": cursor },
    });
  });

  it("marks requested recommendations unavailable on a safe 503 response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("{}", { headers: { "Content-Type": "application/json" }, status: 503 }),
      );
    const provider = new ApiShellStatsProvider({
      fetcher,
      sleep: async (_delay, signal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
    });
    const states: ReturnType<typeof createShellStatsState>[] = [];
    const stop = provider.subscribe((state) => states.push(state));

    await vi.waitFor(() => expect(states.at(-1)?.recommendations.status).toBe("unavailable"));
    stop();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses local receipt time for the heartbeat watchdog and reconnects with unknown stats", async () => {
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: snapshot\ndata: {"type":"snapshot","sequence":10,"observedAt":"2099-01-01T00:00:00.000Z","stats":{"online":null,"taskCounts":{"running":0,"paused":0,"stopped":0},"gas":{"baseGwei":null,"ethereumGwei":null},"fps":null,"pingMs":null}}\n\n',
            ),
          );
          setTimeout(() => {
            controller.enqueue(
              encoder.encode(
                'event: heartbeat\ndata: {"type":"heartbeat","sequence":null,"observedAt":"1999-01-01T00:00:00.000Z"}\n\n',
              ),
            );
          }, 80);
        },
      });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(stream, { headers: { "Content-Type": "text/event-stream" }, status: 200 }),
      );
      const provider = new ApiShellStatsProvider({
        fetcher,
        heartbeatTimeoutMs: 100,
        initialRetryMs: 1_000,
        maxRetryMs: 1_000,
      });
      const states: ReturnType<typeof createShellStatsState>[] = [];
      const stop = provider.subscribe((state) => states.push(state));
      await vi.advanceTimersByTimeAsync(0);
      expect(states.at(-1)).toMatchObject({ connected: true, sequence: 10 });

      await vi.advanceTimersByTimeAsync(150);
      expect(states.at(-1)?.connected).toBe(true);
      await vi.advanceTimersByTimeAsync(31);
      expect(states.at(-1)?.connected).toBe(false);
      expect(shellStatsDisplay(states.at(-1)!)).toMatchObject({
        paused: "--",
        running: "--",
        stopped: "--",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
