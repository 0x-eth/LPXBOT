import { addressBookSecretMediaType, type CustodyWallet } from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  MemoryAddressBookStore,
  WalletApiError,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateInput,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type ChainManagementAuditInput,
  type SecurityPasswordApplication,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T11:00:00.000Z");
const userA = "57000000-0000-4000-8000-000000000001";
const userB = "57000000-0000-4000-8000-000000000002";
const entryId = "57000000-0000-4000-8000-000000000021";
const ownedAddress = "0x1111111111111111111111111111111111111111" as const;
const externalAddress = "0x2222222222222222222222222222222222222222" as const;
const secondExternal = "0x3333333333333333333333333333333333333333" as const;
const password = "synthetic-address-book-password";
const wallet: CustodyWallet = {
  address: ownedAddress,
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Owned fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "57000000-0000-4000-8000-000000000011",
};

class ChainPolicies implements ChainAccessPolicyStore {
  async list(): Promise<ChainAccessPolicyView[]> {
    return [
      {
        access: "all",
        chainId: 56,
        configurationComplete: true,
        displayName: "BNB Smart Chain",
        isDefault: true,
        missingConfiguration: [],
        previousAccess: null,
        reason: "Local fixture",
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: "local-fixture",
      },
      {
        access: "off",
        chainId: 8453,
        configurationComplete: true,
        displayName: "Base",
        isDefault: false,
        missingConfiguration: [],
        previousAccess: null,
        reason: "Local fixture",
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: "local-fixture",
      },
    ];
  }

  async recordManagementAudit(_input: ChainManagementAuditInput): Promise<void> {}

  async update(_input: ChainAccessPolicyUpdateInput): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("not used by local fixture");
  }
}

class WalletDirectoryFixture implements WalletDirectory {
  async getWallet(userId: string, walletId: string): Promise<CustodyWallet | null> {
    return userId === userA && walletId === wallet.walletId ? wallet : null;
  }

  async listWallets(userId: string) {
    return { items: userId === userA ? [wallet] : [] };
  }
}

class PasswordFixture implements SecurityPasswordApplication {
  readonly ingresses: Array<{ bytes: Uint8Array; during: string; userId: string }> = [];
  calls = 0;

  async putSecurityPassword() {
    return { configured: true, status: "ready" as const, version: 1 };
  }

  async securityPasswordStatus() {
    return { configured: true, status: "ready" as const, version: 1 };
  }

  async verifySecurityPassword(input: { ingress: Uint8Array; userId: string }) {
    this.calls += 1;
    const during = Buffer.from(input.ingress).toString("utf8");
    this.ingresses.push({ bytes: input.ingress, during, userId: input.userId });
    if (!during.includes(password)) throw new WalletApiError("INVALID_CREDENTIALS");
    return { verified: true as const, version: 1 };
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const store = new MemoryAddressBookStore(() => entryId);
  const verifier = new PasswordFixture();
  const logs: string[] = [];
  const app = buildApiApp({
    addressBookStore: store,
    chainPolicyStore: new ChainPolicies(),
    logger: { write: (line) => logs.push(line) },
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    securityPassword: verifier,
    sessionStore,
    walletDirectory: new WalletDirectoryFixture(),
  });
  apps.push(app);
  return { app, logs, store, tokenA, tokenB, verifier };
}

function auth(token: string, secret = false) {
  return {
    cookie: `lpbot_session=${token}`,
    ...(secret ? { "content-type": addressBookSecretMediaType } : {}),
  };
}

function createBody(address = externalAddress, secret = password) {
  return JSON.stringify({
    address,
    category: "exchange",
    chainId: 56,
    label: "Fixture exchange",
    note: "Local fixture only",
    password: secret,
  });
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-05 independent address-book API", () => {
  it("classifies owned, known and new addresses without reusing address remarks", async () => {
    const { app, tokenA } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/address-book?chainId=56" })).statusCode).toBe(
      401,
    );

    const owned = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/address-book?chainId=56&address=${ownedAddress}`,
    });
    expect(owned.statusCode).toBe(200);
    expect(owned.headers["cache-control"]).toBe("no-store");
    expect(owned.json().data).toMatchObject({
      classification: {
        address: ownedAddress,
        entryId: null,
        kind: "own-wallet",
        walletId: wallet.walletId,
      },
      entries: [],
      ownWallets: [{ address: ownedAddress, name: wallet.name, walletId: wallet.walletId }],
    });

    const fresh = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/address-book?chainId=56&address=${externalAddress}`,
    });
    expect(fresh.json().data.classification).toEqual({
      address: externalAddress,
      entryId: null,
      kind: "new-external",
      walletId: null,
    });
  });

  it("calls the signer-internal password verifier only for a new external address and zeroizes ingress", async () => {
    const { app, logs, store, tokenA, verifier } = await fixture();
    const wrongMedia = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: JSON.parse(createBody()),
      url: "/api/address-book",
    });
    expect(wrongMedia.statusCode).toBe(415);
    expect(verifier.calls).toBe(0);

    const owned = await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: createBody(ownedAddress),
      url: "/api/address-book",
    });
    expect(owned.statusCode).toBe(409);
    expect(owned.json().error.code).toBe("ADDRESS_IS_OWN_WALLET");
    expect(verifier.calls).toBe(0);

    const created = await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: createBody(),
      url: "/api/address-book",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      address: externalAddress,
      category: "exchange",
      entryId,
      revision: 1,
    });
    expect(verifier.calls).toBe(1);
    expect(verifier.ingresses[0]!.during).toContain(password);
    expect(verifier.ingresses[0]!.bytes.every((byte) => byte === 0)).toBe(true);
    expect(`${created.body}\n${logs.join("\n")}\n${JSON.stringify(store.audits)}`).not.toContain(password);

    const duplicate = await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: createBody(),
      url: "/api/address-book",
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ADDRESS_BOOK_DUPLICATE");
    expect(verifier.calls).toBe(1);
    expect(store.audits.map(({ outcome, resultCode }) => ({ outcome, resultCode }))).toEqual([
      { outcome: "denied", resultCode: "ADDRESS_IS_OWN_WALLET" },
      { outcome: "allowed", resultCode: "CREATED" },
      { outcome: "denied", resultCode: "ADDRESS_BOOK_DUPLICATE" },
    ]);
  });

  it("supports classification, optimistic patch and deletion while isolating users", async () => {
    const { app, tokenA, tokenB } = await fixture();
    await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: createBody(),
      url: "/api/address-book",
    });
    const known = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/address-book?chainId=56&address=${externalAddress}`,
    });
    expect(known.json().data.classification).toMatchObject({ entryId, kind: "known-external" });

    const patched = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: {
        changes: { category: "protocol", label: "Updated fixture", note: "" },
        expectedRevision: 1,
      },
      url: `/api/address-book/${entryId}`,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({
      category: "protocol",
      label: "Updated fixture",
      revision: 2,
    });
    const stale = await app.inject({
      headers: auth(tokenA),
      method: "PATCH",
      payload: { changes: { label: "Stale" }, expectedRevision: 1 },
      url: `/api/address-book/${entryId}`,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("ADDRESS_BOOK_REVISION_CONFLICT");

    const otherUser = await app.inject({
      headers: auth(tokenB),
      method: "GET",
      url: "/api/address-book?chainId=56",
    });
    expect(otherUser.json().data.entries).toEqual([]);
    const hidden = await app.inject({
      headers: auth(tokenB),
      method: "DELETE",
      url: `/api/address-book/${entryId}`,
    });
    expect(hidden.statusCode).toBe(404);

    const deleted = await app.inject({
      headers: auth(tokenA),
      method: "DELETE",
      url: `/api/address-book/${entryId}`,
    });
    expect(deleted.json().data).toEqual({ deleted: true });
  });

  it("fails closed on disallowed chains, malformed secret bodies and bad passwords", async () => {
    const { app, store, tokenA, verifier } = await fixture();
    const disallowed = await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: createBody(secondExternal).replace('"chainId":56', '"chainId":8453'),
      url: "/api/address-book",
    });
    expect(disallowed.statusCode).toBe(403);
    expect(disallowed.json().error.code).toBe("CHAIN_NOT_ALLOWED");
    expect(verifier.calls).toBe(0);
    expect(store.audits.at(-1)).toMatchObject({ outcome: "denied", resultCode: "CHAIN_NOT_ALLOWED" });

    const malformed = await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: JSON.stringify({ address: externalAddress, chainId: 56, password }),
      url: "/api/address-book",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("ADDRESS_BOOK_INVALID");

    const badPassword = await app.inject({
      headers: auth(tokenA, true),
      method: "POST",
      payload: createBody(externalAddress, "wrong-password"),
      url: "/api/address-book",
    });
    expect(badPassword.statusCode).toBe(401);
    expect(badPassword.json().error.code).toBe("INVALID_CREDENTIALS");
  });
});
