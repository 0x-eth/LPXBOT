import {
  walletTransferSecretMediaType,
  type CustodyWallet,
} from "../packages/api-contract/src/index.js";
import {
  buildApiApp,
  MemoryWalletTransferOperationStore,
  MemoryWalletTransferPreviewStore,
  WalletTransferService,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type SecurityPasswordApplication,
  type WalletDirectory,
  type WalletTransferAddressClassification,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-18T12:30:00.000Z");
const chainId = 31_337;
const userA = "59000000-0000-4000-8000-000000000001";
const userB = "59000000-0000-4000-8000-000000000002";
const walletId = "59000000-0000-4000-8000-000000000011";
const recipientA = "0x1111111111111111111111111111111111111111" as const;
const recipientB = "0x2222222222222222222222222222222222222222" as const;
const wallet: CustodyWallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Transfer API fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};

class ChainPolicies implements ChainAccessPolicyStore {
  async list(): Promise<ChainAccessPolicyView[]> {
    return [
      {
        access: "all",
        chainId,
        configurationComplete: true,
        displayName: "Local Anvil",
        isDefault: true,
        missingConfiguration: [],
        previousAccess: null,
        reason: "Synthetic local fixture",
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: "local-fixture",
      },
    ];
  }

  async recordManagementAudit(): Promise<void> {}

  async update(): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("not used by local fixture");
  }
}

class WalletDirectoryFixture implements WalletDirectory {
  async getWallet(userId: string, requestedWalletId: string): Promise<CustodyWallet | null> {
    return userId === userA && requestedWalletId === walletId ? wallet : null;
  }

  async listWallets(userId: string) {
    return { items: userId === userA ? [wallet] : [] };
  }
}

class PasswordFixture implements SecurityPasswordApplication {
  readonly ingresses: Uint8Array[] = [];
  calls = 0;

  async putSecurityPassword() {
    return { configured: true, status: "ready" as const, version: 1 };
  }

  async securityPasswordStatus() {
    return { configured: true, status: "ready" as const, version: 1 };
  }

  async verifySecurityPassword(input: { ingress: Uint8Array }) {
    this.calls += 1;
    this.ingresses.push(input.ingress);
    return { verified: true as const, version: 4 };
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture(classification: WalletTransferAddressClassification = "known-external") {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  const password = new PasswordFixture();
  const logs: string[] = [];
  const transfers = new WalletTransferService({
    addresses: { classify: async () => classification },
    assets: {
      native: async (requestedChainId) =>
        requestedChainId === chainId ? { decimals: 18, name: "Ether", symbol: "ETH" } : null,
      token: async () => null,
    },
    chain: {
      estimateFee: async () => ({
        feeCapBaseUnit: "42000",
        gasLimit: "21000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      }),
      nonceViews: async () => [
        { latest: "0", pending: "0", providerId: "anvil-a" },
        { latest: "0", pending: "0", providerId: "anvil-b" },
      ],
      readAssetState: async () => ({
        assetBalanceBaseUnit: "1000000",
        blockNumber: "1",
        nativeBalanceBaseUnit: "1000000",
        tokenCodePresent: true,
        tokenMetadataMatches: true,
      }),
    },
    localChainIds: [chainId],
    now: () => now,
    operations: new MemoryWalletTransferOperationStore({ now: () => now }),
    policies: {
      current: async () => ({
        executionMode: "local-auto",
        policyDigest: `sha256:${"a".repeat(64)}`,
        policyVersion: "local-policy-v1",
        registryVersion: "local-registry-v1",
      }),
    },
    previews: new MemoryWalletTransferPreviewStore(),
    securityPassword: password,
  });
  const app = buildApiApp({
    chainPolicyStore: new ChainPolicies(),
    logger: { write: (line) => logs.push(line) },
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    walletDirectory: new WalletDirectoryFixture(),
    walletTransfers: transfers,
  });
  apps.push(app);
  return { app, logs, password, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

function previewPayload(recipient = recipientA, amountBaseUnit = "100") {
  return {
    amount: { amountBaseUnit, kind: "exact" },
    asset: { kind: "native" },
    chainId,
    recipient,
    walletId,
  };
}

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P04-06 wallet transfer API", () => {
  it("previews, submits idempotently, polls by owner, and reports conflicts with no-store", async () => {
    const { app, tokenA, tokenB } = await fixture();
    expect(
      (
        await app.inject({
          method: "POST",
          payload: previewPayload(),
          url: "/api/wallets/transfers/preview",
        })
      ).statusCode,
    ).toBe(401);

    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: previewPayload(),
      url: "/api/wallets/transfers/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.json().data).toMatchObject({
      addressClassification: "known-external",
      amountBaseUnit: "100",
      requiresSecurityPassword: false,
      walletId,
    });

    const submitPayload = {
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
      walletId,
    };
    const submitted = await app.inject({
      headers: { ...auth(tokenA), "idempotency-key": "transfer-api-key-0001" },
      method: "POST",
      payload: submitPayload,
      url: "/api/wallets/transfers",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.headers["cache-control"]).toBe("no-store");
    expect(submitted.json().data).toMatchObject({ nonce: "0", state: "queued", walletId });

    const duplicate = await app.inject({
      headers: { ...auth(tokenA), "idempotency-key": "transfer-api-key-0001" },
      method: "POST",
      payload: submitPayload,
      url: "/api/wallets/transfers",
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data.operationId).toBe(submitted.json().data.operationId);

    const polled = await app.inject({
      headers: auth(tokenA),
      method: "GET",
      url: `/api/wallets/transfers/${submitted.json().data.operationId}`,
    });
    expect(polled.statusCode).toBe(200);
    expect(polled.headers["cache-control"]).toBe("no-store");
    expect(polled.json().data.operationId).toBe(submitted.json().data.operationId);
    expect(
      (
        await app.inject({
          headers: auth(tokenB),
          method: "GET",
          url: `/api/wallets/transfers/${submitted.json().data.operationId}`,
        })
      ).statusCode,
    ).toBe(404);

    const changed = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: previewPayload(recipientB, "101"),
      url: "/api/wallets/transfers/preview",
    });
    const conflict = await app.inject({
      headers: { ...auth(tokenA), "idempotency-key": "transfer-api-key-0001" },
      method: "POST",
      payload: {
        previewDigest: changed.json().data.previewDigest,
        previewToken: changed.json().data.previewToken,
        walletId,
      },
      url: "/api/wallets/transfers",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("enforces the bounded secret ingress and zeroizes password bytes without logging them", async () => {
    const { app, logs, password, tokenA } = await fixture("new-external");
    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: previewPayload(),
      url: "/api/wallets/transfers/preview",
    });
    const body = {
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
      securityPassword: "synthetic-transfer-password",
      walletId,
    };
    const wrongMedia = await app.inject({
      headers: {
        ...auth(tokenA),
        "content-type": "text/plain",
        "idempotency-key": "transfer-api-key-0002",
      },
      method: "POST",
      payload: JSON.stringify(body),
      url: "/api/wallets/transfers",
    });
    expect(wrongMedia.statusCode).toBe(415);
    expect(password.calls).toBe(0);

    const ordinaryJson = await app.inject({
      headers: { ...auth(tokenA), "idempotency-key": "transfer-api-key-0002" },
      method: "POST",
      payload: body,
      url: "/api/wallets/transfers",
    });
    expect(ordinaryJson.statusCode).toBe(400);
    expect(ordinaryJson.json().error.code).toBe("SECURITY_PASSWORD_REQUIRED");
    expect(password.calls).toBe(0);

    const submitted = await app.inject({
      headers: {
        ...auth(tokenA),
        "content-type": walletTransferSecretMediaType,
        "idempotency-key": "transfer-api-key-0002",
      },
      method: "POST",
      payload: JSON.stringify(body),
      url: "/api/wallets/transfers",
    });
    expect(submitted.statusCode).toBe(202);
    expect(password.calls).toBe(1);
    expect(password.ingresses[0]?.every((byte) => byte === 0)).toBe(true);
    expect(logs.join("\n")).not.toContain("synthetic-transfer-password");
    expect(logs.join("\n")).not.toContain(preview.json().data.previewToken);
  });
});
