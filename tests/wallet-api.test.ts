import { buildApiApp } from "../apps/api/src/app.js";
import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
} from "../apps/signer/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T04:00:00.000Z");
const tenantId = "tenant-fixture-01";
const userA = "42000000-0000-4000-8000-000000000001";
const userB = "42000000-0000-4000-8000-000000000002";
const syntheticPrivateKey = "0000000000000000000000000000000000000000000000000000000000000001";
const secretMediaType = "application/vnd.lpbot.wallet-secret+json";
const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture(options: { available?: boolean } = {}) {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const kms = new LocalKmsFixture({
    activeVersion: "kek-fixture-v1",
    keys: { "kek-fixture-v1": Buffer.alloc(32, 0x77) },
  });
  kms.setAvailable(options.available ?? true);
  const store = new InMemoryCustodyWalletStore();
  const custody = new CustodySignerService({
    signer: new IsolatedWalletSigner({ kms }),
    store,
  });
  const logs: string[] = [];
  const app = buildApiApp({
    freshReauthentication: {
      verify: async ({ proof, session }) => proof === `fresh:${session.id}`,
    },
    logger: { write: (line) => logs.push(line) },
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    tenantId,
    walletDirectory: custody,
    walletSigner: custody,
  });
  apps.push(app);
  const proofFor = (token: string) => {
    const session = [...sessionStore.sessions.values()].find(
      ({ tokenHash }) => tokenHash.length > 0 && sessionStore.sessions.get(tokenHash),
    );
    if (!session) throw new Error("missing fixture session");
    const own = [...sessionStore.sessions.values()].find(({ userId }) =>
      token === tokenA ? userId === userA : userId === userB,
    );
    return `fresh:${own!.id}`;
  };
  return { app, custody, logs, proofFor, store, tokenA, tokenB };
}

function auth(token: string, proof?: string) {
  return {
    cookie: `lpbot_session=${token}`,
    ...(proof ? { "x-lpbot-reauthentication": proof } : {}),
  };
}

function importBody(name = "Primary") {
  return JSON.stringify({ mode: "server-kek", name, privateKey: syntheticPrivateKey });
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-02 custody wallet API", () => {
  it("requires authentication and fresh reauthentication for imports and generation", async () => {
    const { app, proofFor, tokenA } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/wallets" })).statusCode).toBe(401);

    const staleImport = await app.inject({
      headers: { ...auth(tokenA), "content-type": secretMediaType },
      method: "POST",
      payload: importBody(),
      url: "/api/wallets/import",
    });
    expect(staleImport.statusCode).toBe(403);
    expect(staleImport.json().error.code).toBe("REAUTH_REQUIRED");

    const staleGenerate = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { mode: "server-kek", name: "Generated" },
      url: "/api/wallets/generate",
    });
    expect(staleGenerate.statusCode).toBe(403);
    expect(staleGenerate.json().error.code).toBe("REAUTH_REQUIRED");

    const created = await app.inject({
      headers: { ...auth(tokenA, proofFor(tokenA)), "content-type": secretMediaType },
      method: "POST",
      payload: importBody(),
      url: "/api/wallets/import",
    });
    expect(created.statusCode).toBe(201);
  });

  it("returns only the Wallet DTO and applies no-store to every wallet response", async () => {
    const { app, logs, proofFor, tokenA } = await fixture();
    const created = await app.inject({
      headers: { ...auth(tokenA, proofFor(tokenA)), "content-type": secretMediaType },
      method: "POST",
      payload: importBody(),
      url: "/api/wallets/import",
    });
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(created.json().data).sort()).toEqual(
      [
        "address",
        "createdAt",
        "envelopeVersion",
        "lockStatus",
        "mode",
        "name",
        "revision",
        "updatedAt",
        "walletId",
      ].sort(),
    );

    const serialized = `${created.body}\n${logs.join("\n")}`;
    for (const forbidden of [
      syntheticPrivateKey,
      "ciphertext",
      "wrappedDek",
      "wrapped_dek",
      "secretRef",
      "fingerprint",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const list = await app.inject({ headers: auth(tokenA), method: "GET", url: "/api/wallets" });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json().data.items).toEqual([created.json().data]);
    const detail = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/${created.json().data.walletId}`,
    });
    expect(detail.json().data).toEqual(created.json().data);
  });

  it("returns WALLET_NOT_FOUND for cross-user reads and does not disclose ownership", async () => {
    const { app, proofFor, tokenA, tokenB } = await fixture();
    const created = await app.inject({
      headers: { ...auth(tokenA, proofFor(tokenA)), "content-type": secretMediaType },
      method: "POST",
      payload: importBody(),
      url: "/api/wallets/import",
    });
    const walletId = created.json().data.walletId;
    const response = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: `/api/wallets/${walletId}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("WALLET_NOT_FOUND");
    expect(response.body).not.toContain(userA);
  });

  it("rejects user-password and malformed secret ingress without replay", async () => {
    const { app, proofFor, tokenA } = await fixture();
    for (const body of [
      { mode: "user-password", name: "Unsupported", privateKey: syntheticPrivateKey },
      { mode: "server-kek", name: "Invalid", privateKey: "01" },
      { mode: "server-kek", name: "Unknown", privateKey: syntheticPrivateKey, extra: true },
    ]) {
      const response = await app.inject({
        headers: { ...auth(tokenA, proofFor(tokenA)), "content-type": secretMediaType },
        method: "POST",
        payload: JSON.stringify(body),
        url: "/api/wallets/import",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe(
        body.mode === "user-password" ? "INVALID_MODE" : "INVALID_PRIVATE_KEY",
      );
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    const wrongContentType = await app.inject({
      headers: auth(tokenA, proofFor(tokenA)),
      method: "POST",
      payload: { mode: "server-kek", name: "Captured", privateKey: syntheticPrivateKey },
      url: "/api/wallets/import",
    });
    expect(wrongContentType.statusCode).toBe(415);
  });

  it("maps unavailable signer/KMS to a secret-free retryable response", async () => {
    const { app, logs, proofFor, tokenA } = await fixture({ available: false });
    const response = await app.inject({
      headers: { ...auth(tokenA, proofFor(tokenA)), "content-type": secretMediaType },
      method: "POST",
      payload: importBody("Unavailable"),
      url: "/api/wallets/import",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({ code: "SIGNER_UNAVAILABLE", retryable: true });
    expect(`${response.body}\n${logs.join("\n")}`).not.toContain(syntheticPrivateKey);
  });

  it("keeps login wallets authentication-only", async () => {
    const { app, store, tokenA } = await fixture();
    expect(
      (await app.inject({ headers: auth(tokenA), method: "GET", url: "/api/wallets" })).json().data
        .items,
    ).toEqual([]);
    expect(store.envelopeCount).toBe(0);
  });
});
