import { buildApiApp } from "../apps/api/src/app.js";
import {
  CustodySignerService,
  deriveArgon2idKek,
  deriveSecurityPasswordKey,
  InMemoryCustodyWalletStore,
  IsolatedWalletSigner,
  LocalKmsFixture,
} from "../apps/signer/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T09:00:00.000Z");
const tenantId = "tenant-fixture-01";
const userA = "53000000-0000-4000-8000-000000000001";
const userB = "53000000-0000-4000-8000-000000000002";
const passwordOne = "synthetic-security-password-one";
const passwordTwo = "synthetic-security-password-two";
const mediaType = "application/vnd.lpbot.security-password-secret+json";
const apps: Array<ReturnType<typeof buildApiApp>> = [];

function secret(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const sessions = [...sessionStore.sessions.values()];
  const proofA = `fresh:${sessions.find(({ userId }) => userId === userA)!.id}`;
  const proofB = `fresh:${sessions.find(({ userId }) => userId === userB)!.id}`;
  const store = new InMemoryCustodyWalletStore();
  const custody = new CustodySignerService({
    derivePasswordKek: (password, salt) =>
      deriveArgon2idKek(password, salt, {
        argonVersion: 19,
        iterations: 2,
        memoryKiB: 32,
        outputBytes: 32,
        parallelism: 1,
      }),
    deriveSecurityPasswordKey: (password, salt) =>
      deriveSecurityPasswordKey(password, salt, {
        argonVersion: 19,
        iterations: 2,
        memoryKiB: 32,
        outputBytes: 32,
        parallelism: 1,
      }),
    now: () => now,
    signer: new IsolatedWalletSigner({
      kms: new LocalKmsFixture({
        activeVersion: "kek-fixture-v1",
        keys: { "kek-fixture-v1": Buffer.alloc(32, 0x53) },
      }),
    }),
    store,
  });
  const options = {
    freshReauthentication: {
      verify: async ({ proof, session }: { proof: string | null; session: { id: string } }) =>
        proof === `fresh:${session.id}`,
    },
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    securityPassword: custody,
    sessionStore,
    tenantId,
    walletDirectory: custody,
    walletSigner: custody,
  };
  const app = buildApiApp(options);
  apps.push(app);
  return { app, custody, proofA, proofB, store, tokenA, tokenB };
}

function auth(token: string, proof?: string) {
  return {
    cookie: `lpbot_session=${token}`,
    ...(proof ? { "x-lpbot-reauthentication": proof } : {}),
  };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-04 security password API", () => {
  it("creates and changes a tenant-isolated password with optimistic versioning", async () => {
    const { app, proofA, tokenA, tokenB } = await fixture();
    const initial = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/security-password/status",
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().data).toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });

    const stale = await app.inject({
      headers: { ...auth(tokenA), "content-type": mediaType },
      method: "PUT",
      payload: secret({ expectedVersion: 0, newPassword: passwordOne, oldPassword: null }),
      url: "/api/security-password",
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error.code).toBe("REAUTH_REQUIRED");

    const wrongIngress = await app.inject({
      headers: auth(tokenA, proofA),
      method: "PUT",
      payload: { expectedVersion: 0, newPassword: passwordOne, oldPassword: null },
      url: "/api/security-password",
    });
    expect(wrongIngress.statusCode).toBe(415);

    const created = await app.inject({
      headers: { ...auth(tokenA, proofA), "content-type": mediaType },
      method: "PUT",
      payload: secret({ expectedVersion: 0, newPassword: passwordOne, oldPassword: null }),
      url: "/api/security-password",
    });
    expect(created.statusCode).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.json().data).toEqual({ configured: true, status: "ready", version: 1 });
    expect(Object.keys(created.json().data).sort()).toEqual(["configured", "status", "version"]);

    const isolated = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: "/api/security-password/status",
    });
    expect(isolated.json().data).toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });

    const conflict = await app.inject({
      headers: { ...auth(tokenA, proofA), "content-type": mediaType },
      method: "PUT",
      payload: secret({ expectedVersion: 7, newPassword: passwordTwo, oldPassword: passwordOne }),
      url: "/api/security-password",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("SECURITY_PASSWORD_VERSION_CONFLICT");

    const wrongPassword = await app.inject({
      headers: { ...auth(tokenA, proofA), "content-type": mediaType },
      method: "PUT",
      payload: secret({
        expectedVersion: 1,
        newPassword: passwordTwo,
        oldPassword: "synthetic-security-password-wrong",
      }),
      url: "/api/security-password",
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json().error.code).toBe("INVALID_CREDENTIALS");

    const changed = await app.inject({
      headers: { ...auth(tokenA, proofA), "content-type": mediaType },
      method: "PUT",
      payload: secret({
        expectedVersion: 1,
        newPassword: passwordTwo,
        oldPassword: passwordOne,
      }),
      url: "/api/security-password",
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data).toEqual({ configured: true, status: "ready", version: 2 });
    expect(`${changed.body}\n${JSON.stringify(changed.headers)}`).not.toMatch(
      /salt|verifier|fingerprint|digest/iu,
    );
  });

  it("rejects dedicated secret ingress above 16 KiB without creating a password", async () => {
    const { app, proofA, tokenA } = await fixture();
    const tooLarge = await app.inject({
      headers: { ...auth(tokenA, proofA), "content-type": mediaType },
      method: "PUT",
      payload: "x".repeat(16_385),
      url: "/api/security-password",
    });

    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.headers["cache-control"]).toBe("no-store");
    const status = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: "/api/security-password/status",
    });
    expect(status.json().data).toEqual({
      configured: false,
      status: "unconfigured",
      version: 0,
    });
  });
});
