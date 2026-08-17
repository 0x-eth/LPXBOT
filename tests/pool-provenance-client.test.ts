import {
  PoolProvenanceClient,
  PoolProvenanceRequestManager,
} from "../apps/web/src/pool-provenance-client.js";
import { describe, expect, it, vi } from "vitest";

const poolKey = `56:0x${"a".repeat(40)}`;
const v4PoolKey = `56:0x${"b".repeat(64)}`;
const attribution = {
  creatorProfile: { avatarUrl: null, displayName: "Creator", telegramId: "12345" },
  record: {
    chainId: 56,
    completedAt: "2026-08-17T10:00:00.000Z",
    creatorAddress: `0x${"c".repeat(40)}`,
    feePips: "2500",
    operationId: "12000000-0000-4000-8000-000000000001",
    outcome: "created",
    poolKey,
    protocol: "pcsv3",
    schemaVersion: 1,
    txHash: `0x${"d".repeat(64)}`,
    userId: "12000000-0000-4000-8000-000000000101",
  },
  warning: null,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P02-12 strict pool provenance client", () => {
  it("loads a stable personal history page and rejects sensitive or malformed records", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        data: { items: [attribution], nextCursor: "cursor-2" },
        requestId: "history",
        success: true,
      }),
    );
    const client = new PoolProvenanceClient(fetcher);
    await expect(client.history({ cursor: null, limit: 3 })).resolves.toEqual({
      items: [attribution],
      nextCursor: "cursor-2",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/pools/create-history?limit=3",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("reports partial batches for missing or malformed results instead of inventing users", async () => {
    const client = new PoolProvenanceClient(async () =>
      jsonResponse({
        data: {
          results: [
            { creator: attribution, identity: poolKey },
            { creator: { record: { outcome: "invented" } }, identity: v4PoolKey },
          ],
        },
        requestId: "batch",
        success: true,
      }),
    );
    const result = await client.poolCreators([poolKey, v4PoolKey, `56:0x${"e".repeat(64)}`]);
    expect(result.status).toBe("partial");
    expect(result.records.get(poolKey)).toEqual(attribution);
    expect(result.records.has(v4PoolKey)).toBe(false);
    expect(result.malformed).toEqual(
      new Set([v4PoolKey, `56:0x${"e".repeat(64)}`]),
    );
  });

  it("aborts superseded work and ignores late responses from an old user/filter session", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const signals: AbortSignal[] = [];
    const client = new PoolProvenanceClient((_input, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>((resolve) => resolvers.push(resolve));
    });
    const manager = new PoolProvenanceRequestManager(client);
    const applied: string[] = [];
    const first = manager.loadPoolCreators([poolKey], "user-a", () => applied.push("first"));
    const second = manager.loadPoolCreators([v4PoolKey], "user-b", () => applied.push("second"));
    expect(signals[0]?.aborted).toBe(true);
    resolvers[1]!(
      jsonResponse({
        data: { results: [{ creator: null, identity: v4PoolKey }] },
        requestId: "new",
        success: true,
      }),
    );
    await second;
    resolvers[0]!(
      jsonResponse({
        data: { results: [{ creator: attribution, identity: poolKey }] },
        requestId: "old",
        success: true,
      }),
    );
    await first;
    expect(applied).toEqual(["second"]);
    manager.clear();
    expect(signals[1]?.aborted).toBe(true);
  });
});
