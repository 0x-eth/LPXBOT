import type {
  PoolBlocklistEntry,
  PoolBlocklistSnapshot,
} from "../packages/api-contract/src/index.js";
import {
  initialPoolBlocklistState,
  reducePoolBlocklist,
} from "../apps/web/src/pool-blocklist-state.js";
import {
  PoolBlocklistClient,
  PoolBlocklistRequestError,
} from "../apps/web/src/pool-blocklist-client.js";
import { describe, expect, it, vi } from "vitest";

const pool = {
  chainId: 56,
  identity: `56:0x${"1".repeat(40)}`,
  scope: "pool",
} as const satisfies PoolBlocklistEntry;
const token = {
  chainId: 56,
  identity: `0x${"a".repeat(40)}`,
  scope: "token",
} as const satisfies PoolBlocklistEntry;

function snapshot(
  revision: number,
  entries: PoolBlocklistEntry[],
  hashCharacter = "b",
): PoolBlocklistSnapshot {
  return {
    blocklistHash: `sha256:${hashCharacter.repeat(64)}`,
    entries,
    revision,
    schemaVersion: 1,
    updatedAt: revision === 0 ? null : `2026-08-17T02:00:0${revision}.000Z`,
  };
}

describe("P02-11 pool blocklist client state", () => {
  it("does not expose entries until the matching user load succeeds and clears on user change", () => {
    let state = initialPoolBlocklistState("user-a");
    state = reducePoolBlocklist(state, {
      requestId: "load-a",
      type: "load-start",
      userId: "user-a",
    });
    expect(state).toMatchObject({ entries: [], status: "loading", userId: "user-a" });

    const switched = reducePoolBlocklist(state, {
      requestId: "load-b",
      type: "load-start",
      userId: "user-b",
    });
    const late = reducePoolBlocklist(switched, {
      requestId: "load-a",
      snapshot: snapshot(1, [pool]),
      type: "load-success",
      userId: "user-a",
    });
    expect(late).toMatchObject({ entries: [], status: "loading", userId: "user-b" });
  });

  it("rolls back only the failed mutation when a later optimistic change is still pending", () => {
    let state = initialPoolBlocklistState("user-a");
    state = reducePoolBlocklist(state, {
      requestId: "load",
      type: "load-start",
      userId: "user-a",
    });
    state = reducePoolBlocklist(state, {
      requestId: "load",
      snapshot: snapshot(0, []),
      type: "load-success",
      userId: "user-a",
    });
    state = reducePoolBlocklist(state, {
      mutationId: "m1",
      operation: { entry: pool, type: "block" },
      type: "mutation-optimistic",
    });
    state = reducePoolBlocklist(state, {
      mutationId: "m2",
      operation: { entry: token, type: "block" },
      type: "mutation-optimistic",
    });
    state = reducePoolBlocklist(state, {
      code: "NETWORK_ERROR",
      mutationId: "m1",
      type: "mutation-failure",
    });

    expect(state.entries).toEqual([token]);
    expect(state.pending.map(({ mutationId }) => mutationId)).toEqual(["m2"]);
  });

  it("adopts a revision conflict snapshot, reapplies later pending work, and ignores late responses", () => {
    let state = initialPoolBlocklistState("user-a");
    state = reducePoolBlocklist(state, {
      requestId: "load",
      type: "load-start",
      userId: "user-a",
    });
    state = reducePoolBlocklist(state, {
      requestId: "load",
      snapshot: snapshot(1, [pool]),
      type: "load-success",
      userId: "user-a",
    });
    state = reducePoolBlocklist(state, {
      mutationId: "m1",
      operation: { entry: pool, type: "restore" },
      type: "mutation-optimistic",
    });
    state = reducePoolBlocklist(state, {
      mutationId: "m2",
      operation: { entry: token, type: "block" },
      type: "mutation-optimistic",
    });
    state = reducePoolBlocklist(state, {
      code: "REVISION_CONFLICT",
      current: snapshot(2, [pool], "c"),
      mutationId: "m1",
      type: "mutation-failure",
    });
    expect(state).toMatchObject({ status: "conflict" });
    expect(state.entries).toEqual([pool, token]);

    const success = reducePoolBlocklist(state, {
      mutationId: "m2",
      snapshot: snapshot(3, [pool, token], "d"),
      type: "mutation-success",
    });
    const late = reducePoolBlocklist(success, {
      mutationId: "m1",
      snapshot: snapshot(4, [], "e"),
      type: "mutation-success",
    });
    expect(late).toBe(success);
    expect(late.entries).toEqual([pool, token]);
  });

  it("strictly parses authoritative snapshots and surfaces 409 current state", async () => {
    const current = snapshot(2, [pool]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          current,
          error: {
            code: "REVISION_CONFLICT",
            message: "changed",
            requestId: "request-1",
            retryable: true,
          },
          success: false,
        }),
        { headers: { "Content-Type": "application/json" }, status: 409 },
      ),
    );
    const client = new PoolBlocklistClient(fetcher);

    await expect(
      client.patch({
        expectedRevision: 1,
        operation: { entry: token, type: "block" },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PoolBlocklistRequestError>>({
        code: "REVISION_CONFLICT",
        current,
        status: 409,
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/user/pool-blocklist",
      expect.objectContaining({ credentials: "include", method: "PATCH" }),
    );

    const malformed = new PoolBlocklistClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ success: true, data: { ...current, entries: [pool, pool] } }),
      ),
    );
    await expect(malformed.get()).rejects.toMatchObject({ code: "POOL_BLOCKLIST_RESPONSE_INVALID" });
  });
});
