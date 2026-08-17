import {
  buildApiApp,
  type PoolCreationAdminAuditInput,
  type PoolCreationAttribution,
  type PoolCreationHistoryPage,
  type PoolCreationProvenanceReadStore,
} from "../apps/api/src/index.js";
import {
  SessionIssuer,
  type AccessAuditEvent,
  type NewStoredSession,
  type SessionStore,
  type StoredAccount,
  type StoredSession,
} from "../packages/security/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

const userId = "12000000-0000-4000-8000-000000000101";
const adminId = "12000000-0000-4000-8000-000000000102";
const poolAddress = `0x${"a".repeat(40)}`;
const poolKey = `56:${poolAddress}`;
const txHash = `0x${"b".repeat(64)}`;
const now = new Date("2026-08-17T10:30:00.000Z");

class MemorySessions implements SessionStore {
  readonly audits: AccessAuditEvent[] = [];
  readonly sessions = new Map<string, StoredSession>();

  constructor(readonly account: StoredAccount) {}

  async createSession(session: NewStoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, {
      ...session,
      account: { ...this.account, id: session.userId },
      lastSeenAt: null,
      revokedAt: null,
    });
  }
  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }
  async recordAccessAudit(event: AccessAuditEvent): Promise<void> {
    this.audits.push(event);
  }
  async revokeSession(): Promise<boolean> {
    return false;
  }
  async touchSession(): Promise<void> {}
}

const attribution: PoolCreationAttribution = {
  creatorProfile: {
    avatarUrl: "https://fixture.invalid/avatar.png",
    displayName: "Fixture Creator",
    telegramId: "99887766",
  },
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
    txHash,
    userId,
  },
  warning: null,
};

class MemoryProvenanceStore implements PoolCreationProvenanceReadStore {
  readonly adminAudits: PoolCreationAdminAuditInput[] = [];
  readonly attributionQueries: string[][] = [];
  readonly historyQueries: Array<{ cursor: string | null; limit: number; userId: string }> = [];
  history: PoolCreationHistoryPage = { items: [attribution], nextCursor: "next-cursor" };

  async findAttribution(poolKeyValue: string): Promise<PoolCreationAttribution | null> {
    this.attributionQueries.push([poolKeyValue]);
    return poolKeyValue === poolKey ? attribution : null;
  }
  async findAttributions(
    poolKeys: readonly string[],
  ): Promise<ReadonlyMap<string, PoolCreationAttribution | null>> {
    this.attributionQueries.push([...poolKeys]);
    return new Map(poolKeys.map((key) => [key, key === poolKey ? attribution : null]));
  }
  async listByUser(input: {
    cursor: string | null;
    limit: number;
    userId: string;
  }): Promise<PoolCreationHistoryPage> {
    this.historyQueries.push(input);
    return this.history;
  }
  async recordAdminQueryAudit(input: PoolCreationAdminAuditInput): Promise<void> {
    this.adminAudits.push(input);
  }
}

const apps: Array<{ close(): Promise<void> }> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function fixture(role: "admin" | "user", options: { rateMax?: number } = {}) {
  const id = role === "admin" ? adminId : userId;
  const sessions = new MemorySessions({
    avatarUrl: null,
    displayName: role === "admin" ? "Fixture Admin" : "Fixture User",
    id,
    role,
    status: "active",
    tier: "normal",
  });
  const token = await new SessionIssuer(sessions, { now: () => now }).issue({
    expiresAt: new Date(now.getTime() + 60_000),
    userId: id,
  });
  const provenance = new MemoryProvenanceStore();
  const app = buildApiApp({
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    poolCreationProvenanceRateLimit: {
      max: options.rateMax ?? 30,
      timeWindowMs: 60_000,
    },
    poolCreationProvenanceStore: provenance,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: sessions,
  });
  apps.push(app);
  return { app, provenance, token: token.token };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("P02-12 pool creation provenance read APIs", () => {
  it("authenticates history and binds the stable page only to the current user", async () => {
    const { app, provenance, token } = await fixture("user");
    const response = await app.inject({
      headers: auth(token),
      method: "GET",
      url: "/api/pools/create-history?limit=7&cursor=opaque-cursor",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(provenance.historyQueries).toEqual([{ cursor: "opaque-cursor", limit: 7, userId }]);
    expect(response.json().data).toEqual({
      items: [attribution],
      nextCursor: "next-cursor",
    });

    const anonymous = await app.inject({ method: "GET", url: "/api/pools/create-history" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["cache-control"]).toBe("no-store");
    expect(provenance.historyQueries).toHaveLength(1);
  });

  it("returns null for an unrecorded V3 pool and never invents a creator", async () => {
    const { app, token } = await fixture("admin");
    const missing = `0x${"d".repeat(40)}`;
    const response = await app.inject({
      headers: auth(token),
      method: "GET",
      url: `/api/admin/pool-creators?address=${missing.toUpperCase().replace("0X", "0x")}&chainId=56`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toEqual({ creator: null, identity: missing });
  });

  it("denies ordinary users before lookup while retaining a safe audit summary", async () => {
    const { app, provenance, token } = await fixture("user");
    const response = await app.inject({
      headers: auth(token),
      method: "GET",
      url: `/api/admin/pool-creators?address=${poolAddress}&chainId=56`,
    });
    expect(response.statusCode).toBe(403);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().error.code).toBe("ADMIN_REQUIRED");
    expect(provenance.attributionQueries).toEqual([]);
    expect(provenance.adminAudits).toEqual([
      expect.objectContaining({
        action: "pool-creator.single",
        actorUserId: userId,
        identityCount: 1,
        outcome: "denied",
        resultCode: "ADMIN_REQUIRED",
      }),
    ]);
    expect(provenance.adminAudits[0]?.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(provenance.adminAudits)).not.toContain(poolAddress);
  });

  it("queries address and poolKey batches once, preserving every null or record result", async () => {
    const { app, provenance, token } = await fixture("admin");
    const v4Key = `56:0x${"e".repeat(64)}`;
    const response = await app.inject({
      headers: auth(token),
      method: "POST",
      payload: { poolKeys: [poolKey.toUpperCase().replace("0X", "0x"), v4Key] },
      url: "/api/admin/pool-creators",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(provenance.attributionQueries).toEqual([[poolKey, v4Key]]);
    expect(response.json().data.results).toEqual([
      { creator: attribution, identity: poolKey },
      { creator: null, identity: v4Key },
    ]);
    expect(provenance.adminAudits.at(-1)).toMatchObject({
      action: "pool-creator.batch",
      actorUserId: adminId,
      identityCount: 2,
      outcome: "allowed",
      resultCode: "OK",
    });

    const legacy = await app.inject({
      headers: auth(token),
      method: "POST",
      payload: { addresses: [poolAddress, `0x${"f".repeat(40)}`] },
      url: "/api/admin/pool-creators",
    });
    expect(legacy.statusCode).toBe(200);
    expect(
      legacy.json().data.results.map(({ identity }: { identity: string }) => identity),
    ).toEqual([poolAddress, `0x${"f".repeat(40)}`]);
  });

  it("rejects invalid history, mixed identities, and batches above 100 before lookup", async () => {
    const { app, provenance, token } = await fixture("admin");
    for (const request of [
      { method: "GET" as const, url: "/api/pools/create-history?limit=0" },
      { method: "GET" as const, url: "/api/pools/create-history?limit=10&other=x" },
      {
        method: "POST" as const,
        payload: { addresses: [poolAddress], poolKeys: [poolKey] },
        url: "/api/admin/pool-creators",
      },
      {
        method: "POST" as const,
        payload: {
          poolKeys: Array.from(
            { length: 101 },
            (_, index) => `56:0x${index.toString(16).padStart(64, "0")}`,
          ),
        },
        url: "/api/admin/pool-creators",
      },
    ]) {
      const response = await app.inject({ headers: auth(token), ...request });
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().error.code).toBe("POOL_PROVENANCE_INVALID");
    }
    expect(provenance.attributionQueries).toEqual([]);
    expect(provenance.historyQueries).toEqual([]);
  });

  it("returns a no-store 413 and safe audit summary for an oversized admin batch", async () => {
    const { app, provenance, token } = await fixture("admin");
    const response = await app.inject({
      headers: { ...auth(token), "content-type": "application/json" },
      method: "POST",
      payload: JSON.stringify({ poolKeys: [`56:0x${"a".repeat(33_000)}`] }),
      url: "/api/admin/pool-creators",
    });
    expect(response.statusCode).toBe(413);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().error).toMatchObject({
      code: "REQUEST_TOO_LARGE",
      retryable: false,
    });
    expect(provenance.attributionQueries).toEqual([]);
    expect(provenance.adminAudits).toEqual([
      expect.objectContaining({
        action: "pool-creator.batch",
        actorUserId: adminId,
        identityCount: 0,
        outcome: "denied",
        resultCode: "REQUEST_TOO_LARGE",
      }),
    ]);
    expect(JSON.stringify(provenance.adminAudits)).not.toContain("a".repeat(100));
  });

  it("rate limits every provenance read without leaking or performing a second lookup", async () => {
    const { app, provenance, token } = await fixture("admin", { rateMax: 1 });
    const first = await app.inject({
      headers: auth(token),
      method: "GET",
      url: `/api/admin/pool-creators?address=${poolAddress}&chainId=56`,
    });
    const limited = await app.inject({
      headers: auth(token),
      method: "GET",
      url: `/api/admin/pool-creators?address=${poolAddress}&chainId=56`,
    });
    expect(first.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(provenance.attributionQueries).toHaveLength(1);
  });

  it("serializes only frozen provenance and permitted creator profile fields", async () => {
    const { app, provenance, token } = await fixture("admin");
    provenance.history = {
      items: [
        {
          ...attribution,
          creatorProfile: {
            ...attribution.creatorProfile!,
            role: "admin",
            sessionToken: "secret-session",
            telegramInitData: "secret-init-data",
            tier: "pro",
          } as never,
          internalId: "secret-row" as never,
        },
      ],
      nextCursor: null,
    };
    const response = await app.inject({
      headers: auth(token),
      method: "GET",
      url: "/api/pools/create-history",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("secret-");
    expect(response.body).not.toContain('"role"');
    expect(response.body).not.toContain('"tier"');
    expect(response.json().data.items[0]).toEqual(attribution);
  });
});
