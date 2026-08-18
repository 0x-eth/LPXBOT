import type { AddressInfo } from "node:net";

import {
  createOkxConnectorHttpServer,
  LocalOkxKmsFixture,
  MemoryOkxCredentialRepository,
  OkxCredentialService,
  OkxTransportFixture,
  usableOkxFixtureValidation,
} from "../apps/okx-connector/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

const apiToken = "synthetic-connector-token-at-least-32-bytes";
const userId = "75000000-0000-4000-8000-000000000001";
const servers: Array<ReturnType<typeof createOkxConnectorHttpServer>> = [];

async function fixture(responses = 4) {
  const service = new OkxCredentialService({
    kms: new LocalOkxKmsFixture({ key: Buffer.alloc(32, 0x71) }),
    repository: new MemoryOkxCredentialRepository(),
    transport: new OkxTransportFixture(
      ...Array.from({ length: responses }, () => structuredClone(usableOkxFixtureValidation)),
    ),
  });
  const server = createOkxConnectorHttpServer({ apiToken, service });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { service, url: `http://127.0.0.1:${port}` };
}

function headers(secret = true, token = apiToken) {
  return {
    Authorization: `Bearer ${token}`,
    ...(secret ? { "Content-Type": "application/vnd.lpbot.okx-key-secret+json" } : {}),
    "X-LPBOT-Actor": "api-fixture",
    "X-LPBOT-Request-Id": "connector-http-fixture",
    "X-LPBOT-User-Id": userId,
  };
}

function credentials(expectedVersion?: number) {
  return JSON.stringify({
    apiKey: "synthetic-http-api-key",
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    passphrase: "synthetic-http-passphrase",
    secretKey: "synthetic-http-secret-key",
  });
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("P04-07 isolated connector HTTP boundary", () => {
  it("supports only fixed lifecycle commands and returns exact secret-free status", async () => {
    const { url } = await fixture();
    const saved = await fetch(`${url}/v1/okx-key`, {
      body: credentials(),
      headers: headers(),
      method: "POST",
    });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    expect(await saved.json()).toEqual({
      data: { configured: true, status: "usable", version: 1 },
      success: true,
    });

    const replaced = await fetch(`${url}/v1/okx-key`, {
      body: credentials(1),
      headers: headers(),
      method: "PUT",
    });
    expect(await replaced.json()).toEqual({
      data: { configured: true, status: "usable", version: 2 },
      success: true,
    });
    const tested = await fetch(`${url}/v1/okx-key/test`, {
      body: JSON.stringify({ expectedVersion: 2 }),
      headers: headers(),
      method: "POST",
    });
    expect((await tested.json()).data).toEqual({ configured: true, status: "usable", version: 2 });
    const deleted = await fetch(`${url}/v1/okx-key`, {
      body: JSON.stringify({ expectedVersion: 2 }),
      headers: headers(),
      method: "DELETE",
    });
    const deletedBody = await deleted.text();
    expect(JSON.parse(deletedBody).data).toEqual({
      configured: false,
      status: "unconfigured",
      version: 2,
    });
    expect(`${deletedBody}\n${JSON.stringify([...deleted.headers])}`).not.toMatch(
      /synthetic-http|fingerprint|digest|provider/iu,
    );
  });

  it("rejects wrong identity, media type, arbitrary routes and oversized ingress", async () => {
    const { url } = await fixture(1);
    const unauthorized = await fetch(`${url}/v1/okx-key`, {
      headers: headers(false, "wrong-synthetic-token"),
    });
    expect(unauthorized.status).toBe(401);
    const wrongMedia = await fetch(`${url}/v1/okx-key`, {
      body: credentials(),
      headers: headers(false),
      method: "POST",
    });
    expect(wrongMedia.status).toBe(415);
    const arbitrary = await fetch(`${url}/v1/proxy`, {
      body: JSON.stringify({ host: "TARGET", method: "POST", path: "/arbitrary" }),
      headers: headers(),
      method: "POST",
    });
    expect(arbitrary.status).toBe(404);
    const oversized = await fetch(`${url}/v1/okx-key`, {
      body: "x".repeat(8_193),
      headers: headers(),
      method: "POST",
    });
    expect(oversized.status).toBe(400);
    expect(await (await fetch(`${url}/v1/okx-key`, { headers: headers(false) })).json()).toEqual({
      data: { configured: false, status: "unconfigured", version: 0 },
      success: true,
    });
  });
});
