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
    coordinator?: "fail" | "missing" | "ok";
    failLifecycle?: boolean;
    snapshot?: WalletDependencySnapshot;
  } = {},
) {
  const sessionStore = new SessionFixtureStore();
  const [token, otherToken] = await Promise.all([
    issueFixtureSession(sessionStore, userId, now),
    issueFixtureSession(sessionStore, otherUserId, now),
  ]);
  const store = new InMemoryCustodyWalletStore({
    ...(options.failLifecycle ? { failLifecycleAt: "before-commit" as const } : {}),
  });
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
    deactivated: false,
    restoreCount: 0,
    async deactivate() {
      if (options.coordinator === "fail") throw new Error("TASK_DEACTIVATION_FAILED");
      this.deactivated = true;
      return {
        restore: async () => {
          this.deactivated = false;
          this.restoreCount += 1;
        },
      };
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
    walletDependencyInventory: inventory,
    ...(options.coordinator === "missing" ? {} : { taskCoordinator }),
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
    otherToken,
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

  it("rejects token tampering, expiry, ownership changes, and post-preview state changes", async () => {
    const { advance, app, inventory, otherToken, proof, token, wallet } =
      await lifecycleFixture({
        snapshot: {
          assetIds: [],
          assetRiskDigest: "sha256:empty-wallet-risk",
          complete: true,
          policyIds: [],
          positionIds: [],
          taskIds: [],
        },
      });
    const deleteRequest = async (previewToken: string, expectedRevision = wallet.revision) =>
      app.inject({
        headers: { ...auth(token), "x-lpbot-reauthentication": proof },
        method: "DELETE",
        payload: { expectedRevision, force: false, previewToken },
        url: `/api/wallets/${wallet.walletId}`,
      });
    const preview = async () =>
      (
        await app.inject({
          headers: auth(token),
          method: "POST",
          payload: {},
          url: `/api/wallets/${wallet.walletId}/delete-preview`,
        })
      ).json().data;

    let frozen = await preview();
    const tampered = await deleteRequest("A".repeat(43));
    expect(tampered.statusCode).toBe(409);
    expect(tampered.json().error.code).toBe("PREVIEW_EXPIRED");

    const crossUser = await app.inject({
      headers: { ...auth(otherToken), "x-lpbot-reauthentication": proof },
      method: "DELETE",
      payload: {
        expectedRevision: wallet.revision,
        force: false,
        previewToken: frozen.previewToken,
      },
      url: `/api/wallets/${wallet.walletId}`,
    });
    expect(crossUser.statusCode).toBe(403);

    inventory.snapshot = {
      ...inventory.snapshot,
      assetIds: ["asset:changed"],
      assetRiskDigest: "sha256:changed-wallet-risk",
    };
    const changed = await deleteRequest(frozen.previewToken);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("PREVIEW_CHANGED");

    inventory.snapshot = {
      assetIds: [],
      assetRiskDigest: "sha256:empty-wallet-risk",
      complete: true,
      policyIds: [],
      positionIds: [],
      taskIds: [],
    };
    frozen = await preview();
    await app.inject({
      headers: auth(token),
      method: "PATCH",
      payload: { expectedRevision: wallet.revision, name: "Changed after preview" },
      url: `/api/wallets/${wallet.walletId}`,
    });
    const revisionChanged = await deleteRequest(frozen.previewToken);
    expect(revisionChanged.statusCode).toBe(409);
    expect(revisionChanged.json().error.code).toBe("PREVIEW_CHANGED");

    frozen = await preview();
    advance(300_001);
    const expired = await deleteRequest(frozen.previewToken, wallet.revision + 1);
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.code).toBe("PREVIEW_EXPIRED");
  });

  it("forces only the exact frozen dependency list after task deactivation", async () => {
    const { app, custody, proof, taskCoordinator, token, wallet } = await lifecycleFixture();
    const preview = (
      await app.inject({
        headers: auth(token),
        method: "POST",
        payload: {},
        url: `/api/wallets/${wallet.walletId}/delete-preview`,
      })
    ).json().data;
    const request = (payload: Record<string, unknown>) =>
      app.inject({
        headers: { ...auth(token), "x-lpbot-reauthentication": proof },
        method: "DELETE",
        payload,
        url: `/api/wallets/${wallet.walletId}`,
      });

    const blocked = await request({
      expectedRevision: wallet.revision,
      force: false,
      previewToken: preview.previewToken,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("DELETE_BLOCKED");

    const wrongPhrase = await request({
      confirmationPhrase: "DELETE WALLET DEADBEEF",
      dependencies: preview.dependencies,
      expectedRevision: wallet.revision,
      force: true,
      previewToken: preview.previewToken,
    });
    expect(wrongPhrase.statusCode).toBe(400);
    expect(wrongPhrase.json().error.code).toBe("CONFIRMATION_MISMATCH");

    const incomplete = await request({
      confirmationPhrase: preview.confirmationPhrase,
      dependencies: { ...preview.dependencies, taskIds: [] },
      expectedRevision: wallet.revision,
      force: true,
      previewToken: preview.previewToken,
    });
    expect(incomplete.statusCode).toBe(409);
    expect(incomplete.json().error.code).toBe("PREVIEW_CHANGED");

    const deleted = await request({
      confirmationPhrase: preview.confirmationPhrase,
      dependencies: preview.dependencies,
      expectedRevision: wallet.revision,
      force: true,
      previewToken: preview.previewToken,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.deletionType).toBe("force");
    expect(taskCoordinator.deactivated).toBe(true);
    expect(await custody.getWallet(userId, wallet.walletId)).toBeNull();
  });

  it("fails closed without a coordinator and restores tasks on deletion failure", async () => {
    const missing = await lifecycleFixture({ coordinator: "missing" });
    const missingPreview = (
      await missing.app.inject({
        headers: auth(missing.token),
        method: "POST",
        payload: {},
        url: `/api/wallets/${missing.wallet.walletId}/delete-preview`,
      })
    ).json().data;
    expect(missingPreview.forceEligible).toBe(false);
    const denied = await missing.app.inject({
      headers: { ...auth(missing.token), "x-lpbot-reauthentication": missing.proof },
      method: "DELETE",
      payload: {
        confirmationPhrase: missingPreview.confirmationPhrase,
        dependencies: missingPreview.dependencies,
        expectedRevision: missing.wallet.revision,
        force: true,
        previewToken: missingPreview.previewToken,
      },
      url: `/api/wallets/${missing.wallet.walletId}`,
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe("DELETE_BLOCKED");

    const fault = await lifecycleFixture({ failLifecycle: true });
    const faultPreview = (
      await fault.app.inject({
        headers: auth(fault.token),
        method: "POST",
        payload: {},
        url: `/api/wallets/${fault.wallet.walletId}/delete-preview`,
      })
    ).json().data;
    const failed = await fault.app.inject({
      headers: { ...auth(fault.token), "x-lpbot-reauthentication": fault.proof },
      method: "DELETE",
      payload: {
        confirmationPhrase: faultPreview.confirmationPhrase,
        dependencies: faultPreview.dependencies,
        expectedRevision: fault.wallet.revision,
        force: true,
        previewToken: faultPreview.previewToken,
      },
      url: `/api/wallets/${fault.wallet.walletId}`,
    });
    expect(failed.statusCode).toBe(503);
    expect(fault.taskCoordinator.deactivated).toBe(false);
    expect(fault.taskCoordinator.restoreCount).toBe(1);
    expect(await fault.custody.getWallet(userId, fault.wallet.walletId)).not.toBeNull();
    expect(fault.store.envelopeCount).toBe(1);
    expect(fault.store.auditCount).toBe(1);
  });
});
