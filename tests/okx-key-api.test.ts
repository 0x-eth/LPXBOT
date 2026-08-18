import { buildApiApp } from "../apps/api/src/app.js";
import {
  OkxKeyError,
  type OkxKeyApplication,
  type OkxKeyConnectorContext,
} from "../apps/api/src/okx-key.js";
import type { OkxKeyStatus } from "../packages/api-contract/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T04:00:00.000Z");
const userA = "72000000-0000-4000-8000-000000000001";
const userB = "72000000-0000-4000-8000-000000000002";
const mediaType = "application/vnd.lpbot.okx-key-secret+json";
const apps: Array<ReturnType<typeof buildApiApp>> = [];

class FixtureOkxConnector implements OkxKeyApplication {
  readonly ingresses: Buffer[] = [];
  readonly users: string[] = [];
  readonly #statuses = new Map<string, OkxKeyStatus>();

  async status(input: OkxKeyConnectorContext): Promise<OkxKeyStatus> {
    this.users.push(input.userId);
    return (
      this.#statuses.get(input.userId) ?? {
        configured: false,
        status: "unconfigured",
        version: 0,
      }
    );
  }

  async save(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    this.#capture(input);
    const current = await this.status(input);
    if (current.configured) throw new OkxKeyError("CREDENTIAL_ALREADY_CONFIGURED");
    const next = { configured: true, status: "usable", version: 1 } as const;
    this.#statuses.set(input.userId, next);
    return next;
  }

  async replace(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    this.#capture(input);
    const record = JSON.parse(input.ingress.toString()) as { expectedVersion: number };
    const current = await this.status(input);
    if (!current.configured || record.expectedVersion !== current.version) {
      throw new OkxKeyError("VERSION_CONFLICT");
    }
    const next = { configured: true, status: "usable", version: current.version + 1 } as const;
    this.#statuses.set(input.userId, next);
    return next;
  }

  async test(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    this.#capture(input);
    const record = JSON.parse(input.ingress.toString()) as { expectedVersion: number };
    const current = await this.status(input);
    if (record.expectedVersion !== current.version) throw new OkxKeyError("VERSION_CONFLICT");
    return current;
  }

  async delete(input: OkxKeyConnectorContext & { ingress: Buffer }): Promise<OkxKeyStatus> {
    this.#capture(input);
    const record = JSON.parse(input.ingress.toString()) as { expectedVersion: number };
    const current = await this.status(input);
    if (current.configured && record.expectedVersion !== current.version) {
      throw new OkxKeyError("VERSION_CONFLICT");
    }
    const next = {
      configured: false,
      status: "unconfigured",
      version: current.version,
    } as const;
    this.#statuses.set(input.userId, next);
    return next;
  }

  #capture(input: OkxKeyConnectorContext & { ingress: Buffer }): void {
    this.ingresses.push(input.ingress);
    this.users.push(input.userId);
  }
}

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const sessions = [...sessionStore.sessions.values()];
  const proof = (userId: string) =>
    `fresh:${sessions.find((session) => session.userId === userId)!.id}`;
  const connector = new FixtureOkxConnector();
  const logs: string[] = [];
  const app = buildApiApp({
    freshReauthentication: {
      verify: async ({ proof: candidate, session }) => candidate === `fresh:${session.id}`,
    },
    logger: { write: (line) => logs.push(line) },
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    okxKey: connector,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
  });
  apps.push(app);
  return { app, connector, logs, proof, tokenA, tokenB };
}

function headers(token: string, proof?: string) {
  return {
    cookie: `lpbot_session=${token}`,
    ...(proof ? { "x-lpbot-reauthentication": proof } : {}),
  };
}

function credential(expectedVersion?: number) {
  return JSON.stringify({
    apiKey: "synthetic-api-key",
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    passphrase: "synthetic-passphrase",
    secretKey: "synthetic-secret-key",
  });
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-07 OKX key API", () => {
  it("requires a current session, dedicated ingress and fresh reauthentication for every mutation", async () => {
    const { app, connector, proof, tokenA } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/settings/okx-key" })).statusCode).toBe(
      401,
    );
    const wrongMedia = await app.inject({
      headers: headers(tokenA, proof(userA)),
      method: "POST",
      payload: JSON.parse(credential()),
      url: "/api/settings/okx-key",
    });
    expect(wrongMedia.statusCode).toBe(415);

    for (const request of [
      { method: "POST", payload: credential(), url: "/api/settings/okx-key" },
      { method: "PUT", payload: credential(1), url: "/api/settings/okx-key" },
      {
        method: "POST",
        payload: JSON.stringify({ expectedVersion: 1 }),
        url: "/api/settings/okx-key/test",
      },
      {
        method: "DELETE",
        payload: JSON.stringify({ expectedVersion: 1 }),
        url: "/api/settings/okx-key",
      },
    ] as const) {
      const response = await app.inject({
        headers: { ...headers(tokenA), "content-type": mediaType },
        ...request,
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
      expect(response.json().error.code).toBe("REAUTH_REQUIRED");
    }
    expect(connector.ingresses).toHaveLength(0);
  });

  it("returns only status metadata, isolates users, forwards opaque bytes and maps CAS to 409", async () => {
    const { app, connector, logs, proof, tokenA, tokenB } = await fixture();
    const authA = { ...headers(tokenA, proof(userA)), "content-type": mediaType };
    const initial = await app.inject({
      headers: headers(tokenA),
      method: "GET",
      url: "/api/settings/okx-key",
    });
    expect(initial.headers["cache-control"]).toBe("no-store");
    expect(initial.json().data).toEqual({ configured: false, status: "unconfigured", version: 0 });

    const created = await app.inject({
      headers: authA,
      method: "POST",
      payload: credential(),
      url: "/api/settings/okx-key",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toEqual({ configured: true, status: "usable", version: 1 });
    expect(Object.keys(created.json().data).sort()).toEqual(["configured", "status", "version"]);
    expect(connector.ingresses[0]?.every((byte) => byte === 0)).toBe(true);

    const isolated = await app.inject({
      headers: headers(tokenB),
      method: "GET",
      url: "/api/settings/okx-key",
    });
    expect(isolated.json().data).toEqual({ configured: false, status: "unconfigured", version: 0 });
    expect(connector.users).toContain(userA);
    expect(connector.users).toContain(userB);

    const conflict = await app.inject({
      headers: authA,
      method: "PUT",
      payload: credential(7),
      url: "/api/settings/okx-key",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({ code: "VERSION_CONFLICT", retryable: false });

    const responseSurface = `${created.body}\n${conflict.body}\n${logs.join("\n")}`;
    expect(responseSurface).not.toMatch(
      /synthetic-api-key|synthetic-secret-key|synthetic-passphrase|fingerprint|hash/iu,
    );
  });

  it("tests, replaces and idempotently deletes with current expectedVersion", async () => {
    const { app, proof, tokenA } = await fixture();
    const auth = { ...headers(tokenA, proof(userA)), "content-type": mediaType };
    await app.inject({
      headers: auth,
      method: "POST",
      payload: credential(),
      url: "/api/settings/okx-key",
    });
    const tested = await app.inject({
      headers: auth,
      method: "POST",
      payload: JSON.stringify({ expectedVersion: 1 }),
      url: "/api/settings/okx-key/test",
    });
    expect(tested.json().data).toMatchObject({ status: "usable", version: 1 });
    const replaced = await app.inject({
      headers: auth,
      method: "PUT",
      payload: credential(1),
      url: "/api/settings/okx-key",
    });
    expect(replaced.json().data).toMatchObject({ status: "usable", version: 2 });
    const deleted = await app.inject({
      headers: auth,
      method: "DELETE",
      payload: JSON.stringify({ expectedVersion: 2 }),
      url: "/api/settings/okx-key",
    });
    expect(deleted.json().data).toEqual({ configured: false, status: "unconfigured", version: 2 });
    const repeated = await app.inject({
      headers: auth,
      method: "DELETE",
      payload: JSON.stringify({ expectedVersion: 2 }),
      url: "/api/settings/okx-key",
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.status).toBe("unconfigured");
  });

  it("rejects bodies above 8 KiB before connector invocation", async () => {
    const { app, connector, proof, tokenA } = await fixture();
    const response = await app.inject({
      headers: {
        ...headers(tokenA, proof(userA)),
        "content-type": mediaType,
      },
      method: "POST",
      payload: "x".repeat(8_193),
      url: "/api/settings/okx-key",
    });
    expect(response.statusCode).toBe(413);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(connector.ingresses).toHaveLength(0);
  });
});
