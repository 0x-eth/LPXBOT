import type { ShellStatsEvent } from "../packages/api-contract/src/index.js";
import {
  ApiShellStatsProvider,
  createShellStatsState,
  reduceShellStatsEvent,
  shellStatsDisplay,
} from "../apps/web/src/shell-stats.js";
import { describe, expect, it, vi } from "vitest";

const observedAt = "2026-08-14T09:15:00.000Z";

describe("P01-06 shell stats reducer", () => {
  it("merges snapshot, updates and recommendation snapshots while ignoring duplicate sequence", () => {
    const snapshot: ShellStatsEvent = {
      observedAt,
      sequence: 10,
      stats: {
        fps: 60,
        gas: { baseGwei: null, ethereumGwei: 0.232 },
        online: true,
        pingMs: 84,
        recommendedPools: ["USDT / utility"],
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
    const recommendations = reduceShellStatsEvent(duplicate, {
      observedAt,
      recommendedPools: ["USDT / WBNB"],
      sequence: 12,
      type: "rec_pools_snapshot",
    });

    expect(duplicate).toBe(updated);
    expect(recommendations.stats).toEqual({
      fps: 60,
      gas: { baseGwei: 0.006, ethereumGwei: 0.232 },
      online: true,
      pingMs: 85,
      recommendedPools: ["USDT / WBNB"],
      taskCounts: { paused: 1, running: 1, stopped: null },
    });
    expect(recommendations.sequence).toBe(12);
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
        recommendedPools: null,
        taskCounts: { paused: null, running: null, stopped: null },
      },
      type: "snapshot",
    });
    expect(shellStatsDisplay({ ...connected, connected: false })).toEqual(empty);
  });
});

describe("P01-06 API shell stats provider", () => {
  it("parses split SSE frames, reconnects with bounded exponential backoff and aborts on cleanup", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'id: 10\nevent: snapshot\ndata: {"type":"snapshot","sequence":10,"observedAt":"2026-08-14T09:15:00.000Z","stats":{"online":true,"taskCounts":{"running":1,"paused":1,"stopped":1},"recommendedPools":null,',
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
      sleep: async (delay) => {
        delays.push(delay);
      },
    });
    const states: ReturnType<typeof createShellStatsState>[] = [];
    const stop = provider.subscribe((state) => states.push(state));

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(delays).toEqual([250, 500]);
    expect(states.some((state) => state.connected && state.sequence === 10)).toBe(true);
    expect(states.at(-1)?.connected).toBe(false);
    stop();
    expect(getThirdSignal()?.aborted).toBe(true);
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]).toEqual([
      "/api/stats/stream",
      expect.objectContaining({
        credentials: "include",
        headers: { Accept: "text/event-stream" },
        signal: expect.any(AbortSignal),
      }),
    ]);
  });
});
