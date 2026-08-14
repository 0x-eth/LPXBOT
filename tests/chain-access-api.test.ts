import {
  buildApiApp,
  ChainPolicyStoreError,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateInput,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type ChainManagementAuditInput,
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

const now = new Date("2026-08-15T02:00:00.000Z");
const origin = "https://local.fixture";

const accounts = {
  admin: {
    allowedChainIds: [999_999],
    avatarUrl: null,
    displayName: "Fixture Admin",
    id: "29000000-0000-4000-8000-000000000003",
    role: "admin",
    status: "active",
    tier: "normal",
  },
  pro: {
    allowedChainIds: [999_999],
    avatarUrl: null,
    displayName: "Fixture Pro",
    id: "29000000-0000-4000-8000-000000000002",
    role: "pro",
    status: "active",
    tier: "pro",
  },
  user: {
    allowedChainIds: [999_999],
    avatarUrl: null,
    displayName: "Fixture User",
    id: "29000000-0000-4000-8000-000000000001",
    role: "user",
    status: "active",
    tier: "normal",
  },
} as const satisfies Record<string, StoredAccount>;

class RoleSessionStore implements SessionStore {
  readonly accessAudits: AccessAuditEvent[] = [];
  readonly accounts = new Map<string, StoredAccount>();
  readonly sessions = new Map<string, StoredSession>();

  async createSession(session: NewStoredSession): Promise<void> {
    const account = this.accounts.get(session.userId);
    if (!account) throw new Error("Missing fixture account");
    this.sessions.set(session.tokenHash, {
      ...session,
      account,
      lastSeenAt: null,
      revokedAt: null,
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async recordAccessAudit(event: AccessAuditEvent): Promise<void> {
    this.accessAudits.push(event);
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<boolean> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt) return false;
    session.revokedAt = revokedAt;
    return true;
  }

  async touchSession(tokenHash: string, lastSeenAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) session.lastSeenAt = lastSeenAt;
  }
}

function policy(
  chainId: number,
  displayName: string,
  access: "off" | "pro" | "all",
  options: Partial<
    Pick<ChainAccessPolicyView, "configurationComplete" | "isDefault" | "missingConfiguration">
  > = {},
): ChainAccessPolicyView {
  return {
    access,
    chainId,
    configurationComplete: options.configurationComplete ?? true,
    displayName,
    isDefault: options.isDefault ?? false,
    missingConfiguration: options.missingConfiguration ?? [],
    previousAccess: null,
    reason: "Deterministic local fixture seed; not a live-observed value",
    revision: 1,
    updatedAt: "2026-08-15T00:00:00.000Z",
    updatedBy: "local-fixture-seed",
  };
}

class MemoryChainPolicyStore implements ChainAccessPolicyStore {
  readonly audits: ChainManagementAuditInput[] = [];
  readonly policies: ChainAccessPolicyView[] = [
    policy(56, "BNB Smart Chain", "all", { isDefault: true }),
    policy(8453, "Base", "pro"),
    policy(1, "Ethereum", "off"),
    policy(4663, "Robinhood Chain", "off", {
      configurationComplete: false,
      missingConfiguration: ["execution-adapter"],
    }),
    policy(196, "X Layer", "off", {
      configurationComplete: false,
      missingConfiguration: ["execution-adapter"],
    }),
  ];
  updateCalls = 0;

  async list(): Promise<ChainAccessPolicyView[]> {
    return structuredClone(this.policies);
  }

  async recordManagementAudit(input: ChainManagementAuditInput): Promise<void> {
    this.audits.push(structuredClone(input));
  }

  async update(input: ChainAccessPolicyUpdateInput): Promise<ChainAccessPolicyUpdateResult> {
    this.updateCalls += 1;
    const changed: Array<{ current: ChainAccessPolicyView; next: ChainAccessPolicyView }> = [];
    for (const change of input.changes) {
      const current = this.policies.find(({ chainId }) => chainId === change.chainId);
      if (!current) throw new ChainPolicyStoreError("CHAIN_UNKNOWN");
      if (current.access === change.access) continue;
      if (current.revision !== change.expectedRevision) {
        throw new ChainPolicyStoreError("CONFIG_CONFLICT");
      }
      changed.push({
        current: structuredClone(current),
        next: {
          ...current,
          access: change.access,
          previousAccess: current.access,
          reason: input.reason,
          revision: current.revision + 1,
          updatedAt: input.updatedAt.toISOString(),
          updatedBy: input.actorUserId,
        },
      });
    }
    for (const { next } of changed) {
      this.policies.splice(
        this.policies.findIndex(({ chainId }) => chainId === next.chainId),
        1,
        next,
      );
    }
    this.audits.push({
      actorUserId: input.actorUserId,
      createdAt: input.updatedAt,
      outcome: "allowed",
      reason: input.reason,
      requestId: input.requestId,
      resultCode: changed.length === 0 ? "UNCHANGED" : "UPDATED",
      sessionId: input.sessionId,
    });
    return {
      policies: await this.list(),
      status: changed.length === 0 ? "unchanged" : "updated",
    };
  }
}

const apps: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(options: { managementRateLimit?: number } = {}) {
  const sessionStore = new RoleSessionStore();
  const chainPolicyStore = new MemoryChainPolicyStore();
  for (const account of Object.values(accounts)) sessionStore.accounts.set(account.id, account);
  const issuer = new SessionIssuer(sessionStore, { now: () => now });
  const tokens = Object.fromEntries(
    await Promise.all(
      Object.entries(accounts).map(async ([key, account]) => [
        key,
        (
          await issuer.issue({
            expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
            userId: account.id,
          })
        ).token,
      ]),
    ),
  ) as Record<keyof typeof accounts, string>;
  const logLines: string[] = [];
  const app = buildApiApp({
    chainActivityProvider: {
      async getActivePositionCounts() {
        return new Map([[56, 3]]);
      },
    },
    chainManagementRateLimit: {
      max: options.managementRateLimit ?? 10,
      timeWindowMs: 60_000,
    },
    chainPolicyStore,
    logger: { write: (line) => logLines.push(line) },
    maintenance: { enabled: false, message: null, until: null },
    managementOrigin: origin,
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    testRoutes: true,
  });
  apps.push(app);
  return { app, chainPolicyStore, logLines, sessionStore, tokens };
}

function headers(token: string, requestOrigin = origin) {
  return { cookie: `lpbot_session=${token}`, origin: requestOrigin };
}

describe("AUTH-10 chain configuration API and server guard", () => {
  it("returns no-store role-effective views and full management fields only to admin", async () => {
    const { app, tokens } = await fixture();
    const anonymous = await app.inject({ method: "GET", url: "/api/system-config/chains" });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["cache-control"]).toBe("no-store");

    for (const [role, expectedIds] of [
      ["user", [56]],
      ["pro", [56, 8453]],
    ] as const) {
      const response = await app.inject({
        headers: headers(tokens[role]),
        method: "GET",
        url: "/api/system-config/chains",
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().data).toEqual({
        chains: expectedIds.map((chainId) => ({
          chainId,
          displayName: chainId === 56 ? "BNB Smart Chain" : "Base",
        })),
      });
      expect(response.body).not.toMatch(/revision|updatedBy|reason|missingConfiguration/u);
    }

    const admin = await app.inject({
      headers: headers(tokens.admin),
      method: "GET",
      url: "/api/system-config/chains",
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().data.chains).toHaveLength(5);
    expect(admin.json().data.chains[0]).toMatchObject({
      access: "all",
      activePositionCount: 3,
      chainId: 56,
      configurationComplete: true,
      displayName: "BNB Smart Chain",
      isDefault: true,
      previousAccess: null,
      reason: expect.any(String),
      revision: 1,
      updatedAt: "2026-08-15T00:00:00.000Z",
      updatedBy: "local-fixture-seed",
    });
    expect(admin.json().data.chains[1].activePositionCount).toBeNull();
  });

  it("derives every SessionView from the latest policy and fails closed on role/tier mismatch", async () => {
    const { app, chainPolicyStore, sessionStore, tokens } = await fixture();
    const first = await app.inject({
      headers: headers(tokens.user),
      method: "POST",
      url: "/api/auth/me",
    });
    expect(first.json().data.user.allowedChainIds).toEqual([56]);
    expect(first.body).not.toContain("999999");

    chainPolicyStore.policies[0]!.access = "off";
    chainPolicyStore.policies[1]!.access = "all";
    const restored = await app.inject({
      headers: headers(tokens.user),
      method: "POST",
      url: "/api/auth/me",
    });
    expect(restored.json().data.user.allowedChainIds).toEqual([8453]);

    const mismatched = {
      ...accounts.user,
      id: "29000000-0000-4000-8000-000000000004",
      tier: "pro" as const,
    };
    sessionStore.accounts.set(mismatched.id, mismatched);
    const token = (
      await new SessionIssuer(sessionStore, { now: () => now }).issue({
        expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
        userId: mismatched.id,
      })
    ).token;
    const deniedElevation = await app.inject({
      headers: headers(token),
      method: "POST",
      url: "/api/auth/me",
    });
    expect(deniedElevation.json().data.user.allowedChainIds).toEqual([]);
  });

  it("enforces admin, same-origin, whitelist, body limit and rate limit before writes", async () => {
    const { app, chainPolicyStore, tokens } = await fixture({ managementRateLimit: 1 });
    const request = {
      access: { "56": "pro" },
      expectedRevision: { "56": 1 },
      reason: "Restrict local fixture to Pro",
    };

    const anonymous = await app.inject({
      method: "POST",
      payload: request,
      url: "/api/system-config/chains",
    });
    expect(anonymous.statusCode).toBe(401);
    for (const role of ["user", "pro"] as const) {
      const denied = await app.inject({
        headers: headers(tokens[role]),
        method: "POST",
        payload: request,
        url: "/api/system-config/chains",
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("FORBIDDEN");
    }
    const csrf = await app.inject({
      headers: headers(tokens.admin, "https://cross-origin.fixture"),
      method: "POST",
      payload: request,
      url: "/api/system-config/chains",
    });
    expect(csrf.statusCode).toBe(403);
    expect(csrf.json().error.code).toBe("CSRF_INVALID");

    const injectedActor = await app.inject({
      headers: headers(tokens.admin),
      method: "POST",
      payload: { ...request, actor: accounts.admin.id, userId: accounts.user.id },
      url: "/api/system-config/chains",
    });
    expect(injectedActor.statusCode).toBe(400);
    expect(injectedActor.json().error.code).toBe("CONFIG_INVALID");
    expect(injectedActor.body).not.toContain(accounts.user.id);
    expect(chainPolicyStore.updateCalls).toBe(0);

    const saved = await app.inject({
      headers: headers(tokens.admin),
      method: "POST",
      payload: request,
      url: "/api/system-config/chains",
    });
    expect(saved.statusCode).toBe(200);
    const limited = await app.inject({
      headers: headers(tokens.admin),
      method: "POST",
      payload: {
        access: { "56": "all" },
        expectedRevision: { "56": 2 },
        reason: "Second local write",
      },
      url: "/api/system-config/chains",
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");

    const { app: bodyApp, tokens: bodyTokens } = await fixture();
    const oversized = await bodyApp.inject({
      headers: headers(bodyTokens.admin),
      method: "POST",
      payload: {
        access: { "56": "pro" },
        expectedRevision: { "56": 1 },
        reason: "x".repeat(5_000),
      },
      url: "/api/system-config/chains",
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("REQUEST_TOO_LARGE");
  });

  it("updates, idempotently retries, conflicts and rolls back through the same POST path", async () => {
    const { app, chainPolicyStore, tokens } = await fixture();
    const submit = (access: "all" | "pro", expectedRevision: number, reason: string) =>
      app.inject({
        headers: headers(tokens.admin),
        method: "POST",
        payload: { access: { "56": access }, expectedRevision: { "56": expectedRevision }, reason },
        url: "/api/system-config/chains",
      });

    const updated = await submit("pro", 1, "all to pro local drill");
    expect(updated.statusCode).toBe(200);
    expect(updated.headers["cache-control"]).toBe("no-store");
    expect(updated.json().data).toMatchObject({ status: "updated" });
    expect(updated.json().data.chains[0]).toMatchObject({
      access: "pro",
      previousAccess: "all",
      revision: 2,
    });

    const retry = await submit("pro", 1, "all to pro local drill");
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toMatchObject({ status: "unchanged" });
    expect(retry.json().data.chains[0].revision).toBe(2);

    const conflict = await submit("all", 1, "stale local writer");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({ code: "CONFIG_CONFLICT", retryable: true });

    const rollback = await submit("all", 2, "restore previous local revision");
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data.chains[0]).toMatchObject({
      access: "all",
      previousAccess: "pro",
      revision: 3,
    });
    expect(chainPolicyStore.audits.map(({ outcome, resultCode }) => ({ outcome, resultCode }))).toEqual([
      { outcome: "allowed", resultCode: "UPDATED" },
      { outcome: "allowed", resultCode: "UNCHANGED" },
      { outcome: "denied", resultCode: "CONFIG_CONFLICT" },
      { outcome: "allowed", resultCode: "UPDATED" },
    ]);
  });

  it("uses the test-only handler to prove chain policy without creating business APIs", async () => {
    const { app, chainPolicyStore, tokens } = await fixture();
    const call = (
      role: keyof typeof tokens,
      action: string,
      chainId = 56,
      ownerUserId = accounts[role].id,
    ) =>
      app.inject({
        headers: headers(tokens[role]),
        method: "POST",
        payload: { action, chainId, ownerUserId },
        url: "/api/test/chain-access",
      });

    for (const action of ["position.read", "position.monitor", "pool.withdraw"]) {
      chainPolicyStore.policies[0]!.access = "off";
      const response = await call("user", action);
      expect(response.statusCode, action).toBe(200);
      expect(response.json().data.authorized).toBe(true);
    }

    const expected = {
      all: { admin: 200, pro: 200, user: 200 },
      off: { admin: 403, pro: 403, user: 403 },
      pro: { admin: 200, pro: 200, user: 403 },
    } as const;
    for (const access of ["off", "pro", "all"] as const) {
      chainPolicyStore.policies[0]!.access = access;
      for (const role of ["user", "pro", "admin"] as const) {
        const response = await call(role, "task.create");
        expect(response.statusCode, `${role}/${access}`).toBe(expected[access][role]);
        if (access === "off") expect(response.json().error.code).toBe("CHAIN_CREATION_DISABLED");
        if (access === "pro" && role === "user") {
          expect(response.json().error.code).toBe("CHAIN_PRO_REQUIRED");
        }
      }
    }

    expect((await call("admin", "position.read", 999_999)).json().error.code).toBe("CHAIN_UNKNOWN");
    expect(
      (await call("user", "position.teleport")).json().error.code,
    ).toBe("FORBIDDEN");
    expect(
      (await call("user", "position.read", 56, accounts.pro.id)).json().error.code,
    ).toBe("FORBIDDEN");

    const productionApp = buildApiApp({
      chainPolicyStore,
      maintenance: { enabled: false, message: null, until: null },
      now: () => now,
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new RoleSessionStore(),
    });
    apps.push(productionApp);
    expect(
      (await productionApp.inject({ method: "POST", url: "/api/test/chain-access" })).json().error.code,
    ).toBe("NOT_FOUND");
  });

  it("records denied management attempts without logging credentials, headers or config values", async () => {
    const { app, chainPolicyStore, logLines, tokens } = await fixture();
    const bearer = `Bearer ${tokens.admin}`;
    const response = await app.inject({
      headers: {
        authorization: bearer,
        cookie: `lpbot_session=${tokens.user}`,
        origin: "https://cross-origin.fixture",
        "x-internal-config": "PRIVATE_CONFIG_VALUE",
      },
      method: "POST",
      payload: {
        access: { "56": "pro" },
        expectedRevision: { "56": 1 },
        reason: "PRIVATE_REASON_VALUE",
      },
      url: "/api/system-config/chains",
    });
    expect(response.statusCode).toBe(403);
    expect(chainPolicyStore.audits.at(-1)).toMatchObject({
      actorUserId: accounts.user.id,
      outcome: "denied",
      resultCode: "FORBIDDEN",
      sessionId: expect.any(String),
    });
    const logs = logLines.join("\n");
    for (const secret of [
      tokens.admin,
      tokens.user,
      bearer,
      "lpbot_session",
      "PRIVATE_CONFIG_VALUE",
      "PRIVATE_REASON_VALUE",
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
