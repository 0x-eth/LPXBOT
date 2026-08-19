import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import { P05_HELPER_DEPLOYMENT_REGISTRY } from "../packages/chain-registry/src/index.js";
import {
  buildApiApp,
  HelperDeploymentService,
  MemoryHelperDeploymentOperationStore,
  MemoryHelperDeploymentPreviewStore,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type HelperDeploymentChainReader,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-19T17:00:00.000Z");
const tenantId = "tenant-helper-http";
const userA = "9e000000-0000-4000-8000-000000000001";
const userB = "9e000000-0000-4000-8000-000000000002";
const walletId = "9e000000-0000-4000-8000-000000000011";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Helper HTTP fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};

class ChainPolicies implements ChainAccessPolicyStore {
  async list(): Promise<ChainAccessPolicyView[]> {
    return [
      {
        access: "all",
        chainId: 31_337,
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

class ChainFixture implements HelperDeploymentChainReader {
  async nonceSnapshot() {
    return {
      blockHash: `0x${"81".repeat(32)}` as const,
      blockNumber: "6",
      blockTimestamp: now.toISOString(),
      chainId: 31_337,
      views: [
        { latest: "6", pending: "6", providerId: "anvil-a" },
        { latest: "6", pending: "6", providerId: "anvil-b" },
      ],
    };
  }

  async inspectDeployment() {
    return {
      componentCode: P05_HELPER_DEPLOYMENT_REGISTRY.components.map((component) => ({
        ...component,
        runtimeCodeHash: component.runtimeCodeHash,
      })),
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: `0x${"91".repeat(32)}` as const,
      feeLimit: {
        feeCapBaseUnit: "2400000",
        gasLimit: "1200000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      tokenCode: P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessionStore = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessionStore, userA, now),
    issueFixtureSession(sessionStore, userB, now),
  ]);
  let previewByte = 10;
  const helperDeployments = new HelperDeploymentService({
    chain: new ChainFixture(),
    now: () => now,
    operations: new MemoryHelperDeploymentOperationStore({ now: () => now }),
    previews: new MemoryHelperDeploymentPreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(previewByte++),
  });
  const app = buildApiApp({
    chainPolicyStore: new ChainPolicies(),
    helperDeploymentLocalChainIds: [31_337],
    helperDeployments,
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore,
    tenantId,
    walletDirectory: new WalletDirectoryFixture(),
  });
  apps.push(app);
  return { app, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

const previewPayload = {
  chainId: 31_337,
  helperVersion: "WalletHelperV1",
  walletId,
};

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("P05-05 Helper deployment HTTP API", () => {
  it("previews, submits idempotently, and exposes only the owner's chain operation", async () => {
    const { app, tokenA, tokenB } = await fixture();
    expect(
      (
        await app.inject({
          method: "POST",
          payload: previewPayload,
          url: "/api/wallets/helper/deploy/preview",
        })
      ).statusCode,
    ).toBe(401);

    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: previewPayload,
      url: "/api/wallets/helper/deploy/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.json().data).toMatchObject({
      chainId: 31_337,
      helperVersion: "WalletHelperV1",
      nonce: "6",
      walletId,
    });
    expect(preview.json().data).not.toHaveProperty("bytecode");
    expect(preview.json().data).not.toHaveProperty("calldata");

    const submitPayload = {
      ...previewPayload,
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
    };
    const submitted = await app.inject({
      headers: { ...auth(tokenA), "idempotency-key": "helper-http-key-0001" },
      method: "POST",
      payload: submitPayload,
      url: "/api/wallets/helper/deploy",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.headers["cache-control"]).toBe("no-store");
    expect(submitted.json().data).toMatchObject({ nonce: "6", state: "queued", walletId });

    const duplicate = await app.inject({
      headers: { ...auth(tokenA), "idempotency-key": "helper-http-key-0001" },
      method: "POST",
      payload: submitPayload,
      url: "/api/wallets/helper/deploy",
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data.operationId).toBe(submitted.json().data.operationId);

    const operationUrl = `/api/chain-operations/${submitted.json().data.operationId}`;
    const own = await app.inject({ headers: auth(tokenA), method: "GET", url: operationUrl });
    expect(own.statusCode).toBe(200);
    expect(own.headers["cache-control"]).toBe("no-store");
    expect(own.json().data.operationId).toBe(submitted.json().data.operationId);
    expect(
      (await app.inject({ headers: auth(tokenB), method: "GET", url: operationUrl })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          headers: auth(tokenA),
          method: "GET",
          url: `${operationUrl}?tenantId=${tenantId}`,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects wrong chains and every client-controlled transaction field", async () => {
    const { app, tokenA } = await fixture();
    const wrongChain = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { ...previewPayload, chainId: 56 },
      url: "/api/wallets/helper/deploy/preview",
    });
    expect(wrongChain.statusCode).toBe(403);
    expect(wrongChain.json().error.code).toBe("CHAIN_NOT_ALLOWED");

    for (const injected of [
      { target: `0x${"11".repeat(20)}` },
      { selector: "0x12345678" },
      { calldata: "0x1234" },
      { bytecode: "0x6000" },
    ]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload: { ...previewPayload, ...injected },
        url: "/api/wallets/helper/deploy/preview",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("PREVIEW_INVALID");
    }
  });
});
