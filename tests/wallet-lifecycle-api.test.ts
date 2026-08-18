import { buildApiApp } from "../apps/api/src/app.js";
import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
  type WalletDependencySnapshot,
} from "../apps/signer/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T08:00:00.000Z");
const tenantId = "tenant-fixture-01";
const userId = "52000000-0000-4000-8000-000000000001";
const otherUserId = "52000000-0000-4000-8000-000000000002";
const privateKey = "0000000000000000000000000000000000000000000000000000000000000001";
const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [token, otherToken] = await Promise.all([
    issueFixtureSession(sessionStore, userId, now),
    issueFixtureSession(sessionStore, otherUserId, now),
  ]);
  const store = new InMemoryCustodyWalletStore();
  const custody = new CustodySignerService({
    now: () => now,
    signer: new IsolatedWalletSigner({
      kms: new LocalKmsFixture({
        activeVersion: "kek-fixture-v1",
        keys: { "kek-fixture-v1": Buffer.alloc(32, 0x52) },
      }),
    }),
    store,
  });
  const app = buildApiApp({
    freshReauthentication: { verify: async () => true },
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    tenantId,
    walletDirectory: custody,
    walletSigner: custody,
  });
  apps.push(app);
  const wallet = await custody.importWallet({
    ingress: Buffer.from(
      JSON.stringify({ mode: "server-kek", name: "Before", privateKey }),
      "utf8",
    ),
    tenantId,
    userId,
  });
  store.openAttempts.length = 0;
  return { app, otherToken, store, token, wallet };
}

async function lifecycleFixture(
  options: {
    snapshot?: WalletDependencySnapshot;
  } = {},
) {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(sessionStore, userId, now);
  const store = new InMemoryCustodyWalletStore();
  let clock = now;
  const inventory = {
    snapshot: options.snapshot ?? {
      assetIds: ["asset:8453:USDC"],
      assetRiskDigest: "sha256:wallet-risk-fixture-v1",
      complete: true,
      policyIds: ["policy:rebalance"],
      positionIds: ["position:8453:7"],
      taskIds: ["task:rebalance:7"],
    },
    async inspect() {
      return this.snapshot;
    },
  };
  const taskCoordinator = {
    async deactivate() {
      return { async restore() {} };
    },
  };
  const serviceOptions = {
    now: () => clock,
    signer: new IsolatedWalletSigner({
      kms: new LocalKmsFixture({
        activeVersion: "kek-fixture-v1",
        keys: { "kek-fixture-v1": Buffer.alloc(32, 0x53) },
      }),
    }),
    store,
    taskCoordinator,
    walletDependencyInventory: inventory,
  };
  const custody = new CustodySignerService(serviceOptions);
  const app = buildApiApp({
    freshReauthentication: {
      verify: async ({ proof, session }) => proof === `fresh:${session.id}`,
    },
    maintenance: { enabled: false, message: null, until: null },
    now: () => clock,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    tenantId,
    walletDirectory: custody,
    walletSigner: custody,
  });
  apps.push(app);
  const wallet = await custody.importWallet({
    ingress: Buffer.from(
      JSON.stringify({ mode: "server-kek", name: "Risk wallet", privateKey }),
      "utf8",
    ),
    tenantId,
    userId,
  });
  const session = [...sessionStore.sessions.values()].find((value) => value.userId === userId)!;
  return {
    advance(milliseconds: number) {
      clock = new Date(clock.getTime() + milliseconds);
    },
    app,
    custody,
    inventory,
    proof: `fresh:${session.id}`,
    store,
    taskCoordinator,
    token,
    wallet,
  };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-04 wallet metadata API", () => {
  it("renames with revision CAS without opening or replacing the Envelope", async () => {
    const { app, store, token, wallet } = await fixture();
    const response = await app.inject({
      headers: auth(token),
      method: "PATCH",
      payload: { expectedRevision: wallet.revision, name: "After" },
      url: `/api/wallets/${wallet.walletId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      envelopeVersion: wallet.envelopeVersion,
      name: "After",
      revision: wallet.revision + 1,
    });
    expect(store.openAttempts).toEqual([]);
  });

  it("enforces name boundaries, preserves no-op revisions, and isolates ownership", async () => {
    const { app, otherToken, token, wallet } = await fixture();
    const unicodeBoundary = "\u{1f512}".repeat(80);
    const boundary = await app.inject({
      headers: auth(token),
      method: "PATCH",
      payload: { expectedRevision: wallet.revision, name: unicodeBoundary },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(boundary.statusCode).toBe(200);
    expect(boundary.json().data).toMatchObject({ name: unicodeBoundary, revision: 2 });

    const noOp = await app.inject({
      headers: auth(token),
      method: "PATCH",
      payload: { expectedRevision: 2, name: unicodeBoundary },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(noOp.statusCode).toBe(200);
    expect(noOp.json().data.revision).toBe(2);

    const conflict = await app.inject({
      headers: auth(token),
      method: "PATCH",
      payload: { expectedRevision: 1, name: "Stale" },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("REVISION_CONFLICT");

    for (const name of ["", " padded", "padded ", "control\nname", "a".repeat(81)]) {
      const invalid = await app.inject({
        headers: auth(token),
        method: "PATCH",
        payload: { expectedRevision: 2, name },
        url: `/api/wallets/${wallet.walletId}`,
      });
      expect(invalid.statusCode, JSON.stringify(name)).toBe(400);
      expect(invalid.json().error.code).toBe("INVALID_WALLET");
    }

    const crossUser = await app.inject({
      headers: auth(otherToken),
      method: "PATCH",
      payload: { expectedRevision: 2, name: "Disclosed" },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(crossUser.statusCode).toBe(404);
    expect(crossUser.json().error.code).toBe("WALLET_NOT_FOUND");
    expect(crossUser.body).not.toContain(userId);
  });
});

describe("P04-04 wallet delete preview API", () => {
  it("freezes a complete dependency and asset-risk snapshot for exactly 300 seconds", async () => {
    const { app, token, wallet } = await lifecycleFixture();
    const response = await app.inject({
      headers: auth(token),
      method: "POST",
      payload: {},
      url: `/api/wallets/${wallet.walletId}/delete-preview`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({
      assetCount: 1,
      assetRiskDigest: "sha256:wallet-risk-fixture-v1",
      dependencies: {
        assetIds: ["asset:8453:USDC"],
        policyIds: ["policy:rebalance"],
        positionIds: ["position:8453:7"],
        taskIds: ["task:rebalance:7"],
      },
      expiresAt: "2026-08-18T08:05:00.000Z",
      forceEligible: true,
      policyCount: 1,
      positionCount: 1,
      revision: wallet.revision,
      taskCount: 1,
      walletId: wallet.walletId,
    });
    expect(response.json().data.previewToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(response.json().data.confirmationPhrase).toMatch(/^DELETE WALLET [A-F0-9]{8}$/u);
  });

  it("permanently deletes a zero-risk wallet and consumes the preview once", async () => {
    const { app, custody, proof, store, token, wallet } = await lifecycleFixture({
      snapshot: {
        assetIds: [],
        assetRiskDigest: "sha256:empty-wallet-risk",
        complete: true,
        policyIds: [],
        positionIds: [],
        taskIds: [],
      },
    });
    const previewResponse = await app.inject({
      headers: auth(token),
      method: "POST",
      payload: {},
      url: `/api/wallets/${wallet.walletId}/delete-preview`,
    });
    const preview = previewResponse.json().data;

    const staleAuthentication = await app.inject({
      headers: auth(token),
      method: "DELETE",
      payload: {
        expectedRevision: wallet.revision,
        force: false,
        previewToken: preview.previewToken,
      },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(staleAuthentication.statusCode).toBe(403);
    expect(staleAuthentication.json().error.code).toBe("REAUTH_REQUIRED");

    const deleted = await app.inject({
      headers: { ...auth(token), "x-lpbot-reauthentication": proof },
      method: "DELETE",
      payload: {
        expectedRevision: wallet.revision,
        force: false,
        previewToken: preview.previewToken,
      },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data).toMatchObject({
      address: wallet.address,
      deletedAt: now.toISOString(),
      deletionType: "normal",
      finalRevision: wallet.revision + 1,
      walletId: wallet.walletId,
    });
    expect(await custody.getWallet(userId, wallet.walletId)).toBeNull();
    expect(store.envelopeCount).toBe(0);
    expect(store.auditCount).toBe(2);

    await expect(
      custody.recoverWallet({ tenantId, userId, walletId: wallet.walletId }),
    ).rejects.toMatchObject({ code: "WALLET_NOT_FOUND" });
    await expect(
      custody.importWallet({
        ingress: Buffer.from(
          JSON.stringify({ mode: "server-kek", name: "Reimported", privateKey }),
          "utf8",
        ),
        tenantId,
        userId,
      }),
    ).resolves.toMatchObject({ address: wallet.address });

    const repeated = await app.inject({
      headers: { ...auth(token), "x-lpbot-reauthentication": proof },
      method: "DELETE",
      payload: {
        expectedRevision: wallet.revision,
        force: false,
        previewToken: preview.previewToken,
      },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(repeated.statusCode).toBe(404);
    expect(repeated.json().error.code).toBe("WALLET_NOT_FOUND");
  });
});
