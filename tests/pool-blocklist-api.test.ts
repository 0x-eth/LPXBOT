import type {
  PoolBlocklistEntry,
  PoolBlocklistOperation,
  PoolBlocklistSnapshot,
} from "../packages/api-contract/src/index.js";
import { buildApiApp } from "../apps/api/src/index.js";
import {
  createPoolBlocklistSnapshot,
  defaultPoolBlocklistSnapshot,
  type PoolBlocklistMutationInput,
  type PoolBlocklistMutationResult,
  type PoolBlocklistStore,
} from "../apps/api/src/pool-blocklist.js";
import { afterEach, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const userA = "29000000-0000-4000-8000-000000000001";
const userB = "29000000-0000-4000-8000-000000000002";
const now = new Date("2026-08-17T08:00:00.000Z");
const poolKey = `56:0x${"1".repeat(40)}` as const;
const tokenAddress = `0x${"a".repeat(40)}` as const;

function key(userId: string, entry: Pick<PoolBlocklistEntry, "chainId" | "identity" | "scope">) {
  return `${userId}:${entry.chainId}:${entry.scope}:${entry.identity}`;
}

class MemoryPoolBlocklistStore implements PoolBlocklistStore {
  readonly entries = new Map<string, PoolBlocklistEntry>();
  readonly revisions = new Map<string, { revision: number; updatedAt: Date | null }>();
  mutations = 0;
  reads = 0;

  constructor(readonly capacity = 500) {}

  async get(userId: string): Promise<PoolBlocklistSnapshot> {
    this.reads += 1;
    return this.snapshot(userId);
  }

  async mutate(input: PoolBlocklistMutationInput): Promise<PoolBlocklistMutationResult> {
    this.mutations += 1;
    const current = this.snapshot(input.userId);
    if (current.revision !== input.expectedRevision) return { current, status: "conflict" };
    const entryKey = key(input.userId, input.operation.entry);
    const exists = this.entries.has(entryKey);
    if ((input.operation.type === "block" && exists) || (input.operation.type === "restore" && !exists)) {
      return { status: "unchanged", value: current };
    }
    if (
      input.operation.type === "block" &&
      [...this.entries.keys()].filter((candidate) => candidate.startsWith(`${input.userId}:`)).length >=
        this.capacity
    ) {
      return { current, status: "capacity" };
    }
    if (input.operation.type === "block") this.entries.set(entryKey, structuredClone(input.operation.entry));
    else this.entries.delete(entryKey);
    this.revisions.set(input.userId, {
      revision: current.revision + 1,
      updatedAt: input.updatedAt,
    });
    return { status: "updated", value: this.snapshot(input.userId) };
  }

  private snapshot(userId: string): PoolBlocklistSnapshot {
    const revision = this.revisions.get(userId) ?? { revision: 0, updatedAt: null };
    const entries = [...this.entries]
      .filter(([entryKey]) => entryKey.startsWith(`${userId}:`))
      .map(([, entry]) => entry);
    return entries.length === 0 && revision.revision === 0
      ? defaultPoolBlocklistSnapshot()
      : createPoolBlocklistSnapshot({ entries, ...revision });
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(options: { capacity?: number; max?: number } = {}) {
  const sessionStore = new SessionFixtureStore();
  const blocklistStore = new MemoryPoolBlocklistStore(options.capacity);
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    poolBlocklistRateLimit: { max: options.max ?? 30, timeWindowMs: 60_000 },
    poolBlocklistStore: blocklistStore,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, blocklistStore, tokenA, tokenB };
}

function session(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

function patch(expectedRevision: number, operation: PoolBlocklistOperation) {
  return { expectedRevision, operation };
}

describe("P02-11 pool blocklist API", () => {
  it("requires authentication, uses no-store, and isolates all rows by session user", async () => {
    const { app, blocklistStore, tokenA, tokenB } = await fixture();
    const anonymousGet = await app.inject({ method: "GET", url: "/api/user/pool-blocklist" });
    const anonymousPatch = await app.inject({
      method: "PATCH",
      payload: patch(0, {
        entry: { chainId: 56, identity: tokenAddress, scope: "token" },
        type: "block",
      }),
      url: "/api/user/pool-blocklist",
    });
    expect(anonymousGet.statusCode).toBe(401);
    expect(anonymousPatch.statusCode).toBe(401);
    expect(blocklistStore.reads).toBe(0);
    expect(blocklistStore.mutations).toBe(0);

    const saved = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(0, {
        entry: { chainId: 56, identity: tokenAddress, label: "Token A", scope: "token" },
        type: "block",
      }),
      url: "/api/user/pool-blocklist",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["cache-control"]).toBe("no-store");
    expect(saved.json().data).toMatchObject({
      entries: [{ chainId: 56, identity: tokenAddress, label: "Token A", scope: "token" }],
      revision: 1,
      schemaVersion: 1,
      updatedAt: now.toISOString(),
    });

    const [mine, other] = await Promise.all([
      app.inject({ headers: session(tokenA), method: "GET", url: "/api/user/pool-blocklist" }),
      app.inject({ headers: session(tokenB), method: "GET", url: "/api/user/pool-blocklist" }),
    ]);
    expect(mine.headers["cache-control"]).toBe("no-store");
    expect(mine.json().data.entries).toHaveLength(1);
    expect(other.json().data).toEqual(defaultPoolBlocklistSnapshot());
    expect(other.body).not.toContain(userA);
  });

  it("keeps duplicate block and absent restore idempotent without incrementing revision", async () => {
    const { app, tokenA } = await fixture();
    const operation = {
      entry: { chainId: 56 as const, identity: poolKey, scope: "pool" as const },
      type: "block" as const,
    };
    const first = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(0, operation),
      url: "/api/user/pool-blocklist",
    });
    const duplicate = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(1, operation),
      url: "/api/user/pool-blocklist",
    });
    const restored = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(1, { entry: operation.entry, type: "restore" }),
      url: "/api/user/pool-blocklist",
    });
    const absent = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(2, { entry: operation.entry, type: "restore" }),
      url: "/api/user/pool-blocklist",
    });

    expect(first.json().data.revision).toBe(1);
    expect(duplicate.json().data.revision).toBe(1);
    expect(restored.json().data).toMatchObject({ entries: [], revision: 2 });
    expect(absent.json().data).toMatchObject({ entries: [], revision: 2 });
  });

  it("returns 409 REVISION_CONFLICT with the current authoritative snapshot", async () => {
    const { app, tokenA } = await fixture();
    await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(0, {
        entry: { chainId: 56, identity: tokenAddress, scope: "token" },
        type: "block",
      }),
      url: "/api/user/pool-blocklist",
    });
    const stale = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(0, {
        entry: { chainId: 56, identity: poolKey, scope: "pool" },
        type: "block",
      }),
      url: "/api/user/pool-blocklist",
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.headers["cache-control"]).toBe("no-store");
    expect(stale.json()).toMatchObject({
      current: {
        entries: [{ identity: tokenAddress, scope: "token" }],
        revision: 1,
      },
      error: { code: "REVISION_CONFLICT", retryable: true },
      success: false,
    });
  });

  it("rejects unknown fields, symbols, wrong chains, malformed pool keys, and oversized bodies", async () => {
    const { app, tokenA } = await fixture();
    const invalidEntries = [
      { chainId: 1, identity: tokenAddress, scope: "token" },
      { chainId: 56, identity: "WBNB", scope: "token" },
      { chainId: 56, identity: `0x${"A".repeat(40)}`, scope: "token" },
      { chainId: 56, identity: poolKey.slice(3), scope: "pool" },
      { chainId: 56, identity: `56:0x${"F".repeat(40)}`, scope: "pool" },
      { chainId: 56, identity: tokenAddress, scope: "token", unknown: true },
    ];
    for (const entry of invalidEntries) {
      const response = await app.inject({
        headers: session(tokenA),
        method: "PATCH",
        payload: patch(0, { entry, type: "block" } as unknown as PoolBlocklistOperation),
        url: "/api/user/pool-blocklist",
      });
      expect(response.statusCode, JSON.stringify(entry)).toBe(400);
      expect(response.json().error.code).toBe("POOL_BLOCKLIST_INVALID");
    }

    const oversized = await app.inject({
      headers: { ...session(tokenA), "content-type": "application/json" },
      method: "PATCH",
      payload: JSON.stringify({
        ...patch(0, {
          entry: { chainId: 56, identity: tokenAddress, scope: "token" },
          type: "block",
        }),
        padding: "x".repeat(4_096),
      }),
      url: "/api/user/pool-blocklist",
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("REQUEST_TOO_LARGE");
  });

  it("enforces entry capacity and per-session mutation rate without changing authority", async () => {
    const { app, tokenA } = await fixture({ capacity: 1, max: 2 });
    const first = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(0, {
        entry: { chainId: 56, identity: tokenAddress, scope: "token" },
        type: "block",
      }),
      url: "/api/user/pool-blocklist",
    });
    const capacity = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(1, {
        entry: { chainId: 56, identity: poolKey, scope: "pool" },
        type: "block",
      }),
      url: "/api/user/pool-blocklist",
    });
    const limited = await app.inject({
      headers: session(tokenA),
      method: "PATCH",
      payload: patch(1, {
        entry: { chainId: 56, identity: poolKey, scope: "pool" },
        type: "restore",
      }),
      url: "/api/user/pool-blocklist",
    });

    expect(first.statusCode).toBe(200);
    expect(capacity.statusCode).toBe(422);
    expect(capacity.json()).toMatchObject({
      current: { entries: [{ identity: tokenAddress }], revision: 1 },
      error: { code: "BLOCKLIST_CAPACITY_EXCEEDED", retryable: false },
      success: false,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    const current = await app.inject({
      headers: session(tokenA),
      method: "GET",
      url: "/api/user/pool-blocklist",
    });
    expect(current.json().data).toMatchObject({
      entries: [{ identity: tokenAddress }],
      revision: 1,
    });
  });
});
