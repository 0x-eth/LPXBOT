import { buildApiApp } from "../apps/api/src/app.js";
import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
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
