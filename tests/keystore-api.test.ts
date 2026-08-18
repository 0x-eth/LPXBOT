import { buildApiApp } from "../apps/api/src/app.js";
import {
  CustodySignerService,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
} from "../apps/signer/src/index.js";
import { deriveArgon2idKek } from "../apps/signer/src/password-crypto.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T08:00:00.000Z");
const tenantId = "tenant-fixture-01";
const userId = "48000000-0000-4000-8000-000000000001";
const privateKeyOne = "0000000000000000000000000000000000000000000000000000000000000001";
const keystoreMediaType = "application/vnd.lpbot.keystore-secret+json";
const walletMediaType = "application/vnd.lpbot.wallet-secret+json";
const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const token = await issueFixtureSession(sessionStore, userId, now);
  const session = [...sessionStore.sessions.values()].find((candidate) => candidate.userId === userId)!;
  let random = 1;
  const custody = new CustodySignerService({
    backoffJitter: () => 0,
    dependencyInventory: {
      inspect: async () => ({
        assetRiskDigest: "sha256:api-fixture",
        complete: true,
        policyCount: 0,
        strategyCount: 0,
        taskCount: 0,
        walletsWithNonzeroAssets: 0,
        walletsWithPositions: 0,
      }),
    },
    derivePasswordKek: (password, salt) =>
      deriveArgon2idKek(password, salt, {
        argonVersion: 19,
        iterations: 2,
        memoryKiB: 32,
        outputBytes: 32,
        parallelism: 1,
      }),
    randomBytes: (length) => Buffer.alloc(length, random++),
    signer: new IsolatedWalletSigner({
      kms: new LocalKmsFixture({
        activeVersion: "kek-fixture-v1",
        keys: { "kek-fixture-v1": Buffer.alloc(32, 0x48) },
      }),
      secretRandomBytes: (length) => Buffer.alloc(length, random++),
    }),
    store: new InMemoryCustodyWalletStore(),
  });
  const logs: string[] = [];
  const app = buildApiApp({
    freshReauthentication: {
      verify: async ({ proof, session: current }) => proof === `fresh:${current.id}`,
    },
    keystore: custody,
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
  return {
    app,
    auth: {
      cookie: `lpbot_session=${token}`,
      "x-lpbot-reauthentication": `fresh:${session.id}`,
    },
    logs,
  };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-03 Keystore API", () => {
  it("clears password wallet generation ingress on authentication and reauthentication exits", async () => {
    const { app, auth } = await fixture();
    const parsedIngresses: Buffer[] = [];
    app.addHook("preHandler", async (request) => {
      if (request.url === "/api/wallets/generate" && Buffer.isBuffer(request.body)) {
        parsedIngresses.push(request.body);
      }
    });
    const unauthenticatedIngress = Buffer.from(
      JSON.stringify({
        mode: "user-password",
        name: "Unauthenticated fixture",
        password: "synthetic-password-unauthenticated",
      }),
    );
    const unauthenticated = await app.inject({
      headers: { "content-type": walletMediaType },
      method: "POST",
      payload: unauthenticatedIngress,
      url: "/api/wallets/generate",
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(parsedIngresses[0]?.every((byte) => byte === 0)).toBe(true);

    const staleIngress = Buffer.from(
      JSON.stringify({
        mode: "user-password",
        name: "Stale reauth fixture",
        password: "synthetic-password-stale",
      }),
    );
    const stale = await app.inject({
      headers: { cookie: auth.cookie, "content-type": walletMediaType },
      method: "POST",
      payload: staleIngress,
      url: "/api/wallets/generate",
    });
    expect(stale.statusCode).toBe(403);
    expect(parsedIngresses[1]?.every((byte) => byte === 0)).toBe(true);
  });

  it("uses dedicated no-capture ingress, no-store and exact status responses", async () => {
    const { app, auth, logs } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/keystore/status" })).statusCode).toBe(401);
    const wrongMedia = await app.inject({
      headers: auth,
      method: "POST",
      payload: { newPassword: "synthetic-password-one" },
      url: "/api/keystore/password",
    });
    expect(wrongMedia.statusCode).toBe(415);

    const password = "synthetic-password-one";
    const created = await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "POST",
      payload: JSON.stringify({ newPassword: password }),
      url: "/api/keystore/password",
    });
    expect(created.statusCode).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json().data).toEqual({ configured: true, status: "locked", version: 1 });
    expect(Object.keys(created.json().data).sort()).toEqual(["configured", "status", "version"]);
    expect(`${created.body}\n${logs.join("\n")}`).not.toContain(password);

    const status = await app.inject({ headers: auth, method: "GET", url: "/api/keystore/status" });
    expect(status.json().data).toEqual({ configured: true, status: "locked", version: 1 });
  });

  it("creates, unlocks, locks, changes auto-lock and rejects stale secret versions", async () => {
    const { app, auth } = await fixture();
    await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "POST",
      payload: JSON.stringify({ newPassword: "synthetic-password-one" }),
      url: "/api/keystore/password",
    });
    const unlocked = await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "POST",
      payload: JSON.stringify({ password: "synthetic-password-one" }),
      url: "/api/keystore/unlock",
    });
    expect(unlocked.json().data.status).toBe("unlocked");
    const autoLock = await app.inject({
      headers: auth,
      method: "PATCH",
      payload: { expectedVersion: 1, minutes: 5 },
      url: "/api/keystore/auto-lock",
    });
    expect(autoLock.statusCode).toBe(200);
    const stale = await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "PUT",
      payload: JSON.stringify({
        expectedVersion: 2,
        newPassword: "synthetic-password-two",
        oldPassword: "synthetic-password-one",
      }),
      url: "/api/keystore/password",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("SECRET_VERSION_CONFLICT");
    const locked = await app.inject({ headers: auth, method: "POST", url: "/api/keystore/lock" });
    expect(locked.json().data.status).toBe("locked");
  });

  it("supports password wallet import/generate, optimistic mode switching and atomic reset", async () => {
    const { app, auth } = await fixture();
    await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "POST",
      payload: JSON.stringify({ newPassword: "synthetic-password-one" }),
      url: "/api/keystore/password",
    });
    const imported = await app.inject({
      headers: { ...auth, "content-type": walletMediaType },
      method: "POST",
      payload: JSON.stringify({
        mode: "user-password",
        name: "Password import",
        password: "synthetic-password-one",
        privateKey: privateKeyOne,
      }),
      url: "/api/wallets/import",
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data).toMatchObject({ lockStatus: "locked", mode: "user-password" });
    const generated = await app.inject({
      headers: { ...auth, "content-type": walletMediaType },
      method: "POST",
      payload: JSON.stringify({
        mode: "user-password",
        name: "Password generated",
        password: "synthetic-password-one",
      }),
      url: "/api/wallets/generate",
    });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().data.mode).toBe("user-password");

    const switched = await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "POST",
      payload: JSON.stringify({
        expectedRevision: imported.json().data.revision,
        expectedSecretVersion: 1,
        mode: "server-kek",
        password: "synthetic-password-one",
      }),
      url: `/api/wallets/${imported.json().data.walletId}/encryption-mode`,
    });
    expect(switched.statusCode).toBe(202);
    expect(switched.json().data.mode).toBe("server-kek");

    const preview = await app.inject({
      headers: auth,
      method: "GET",
      url: "/api/keystore/reset-preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.walletCount).toBe(1);
    const reset = await app.inject({
      headers: { ...auth, "content-type": keystoreMediaType },
      method: "POST",
      payload: JSON.stringify({
        confirmationPhrase: "I_LOSE_ALL_PASSWORD_WALLETS",
        expectedVersion: 1,
        previewToken: preview.json().data.previewToken,
      }),
      url: "/api/keystore/reset",
    });
    expect(reset.statusCode).toBe(202);
    const wallets = await app.inject({ headers: auth, method: "GET", url: "/api/wallets" });
    expect(wallets.json().data.items).toEqual([switched.json().data]);
  });

  it("enforces 16 KiB and never retries a secret request", async () => {
    let calls = 0;
    const app = buildApiApp({
      freshReauthentication: { verify: async () => true },
      keystore: {
        createKeystorePassword: async () => {
          calls += 1;
          throw Object.assign(new Error("fixture"), { code: "SIGNER_UNAVAILABLE" });
        },
      } as never,
      maintenance: { enabled: false, message: null, until: null },
      regionPolicy: () => ({ blocked: false, code: null, message: null }),
      sessionStore: new SessionFixtureStore(),
    });
    apps.push(app);
    const tooLarge = await app.inject({
      headers: { "content-type": keystoreMediaType },
      method: "POST",
      payload: "x".repeat(16_385),
      url: "/api/keystore/password",
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(calls).toBe(0);
  });
});
