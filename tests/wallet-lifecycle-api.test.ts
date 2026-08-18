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
const privateKey = "0000000000000000000000000000000000000000000000000000000000000001";
const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(sessionStore, userId, now);
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
  return { app, store, token, wallet };
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
});
