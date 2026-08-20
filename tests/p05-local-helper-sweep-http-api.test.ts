import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import { P05_LOCAL_HELPER_SWEEP_REGISTRY } from "../packages/chain-registry/src/index.js";
import type { LocalHelperSweepBinding } from "../packages/domain/src/local-helper-sweep.js";
import {
  buildApiApp,
  LocalHelperSweepService,
  MemoryLocalHelperResidualSnapshotStore,
  MemoryLocalHelperSweepBindingStore,
  MemoryLocalHelperSweepOperationStore,
  MemoryLocalHelperSweepPreviewStore,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type LocalHelperResidualChainInspection,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-20T09:00:00.000Z");
const registry = P05_LOCAL_HELPER_SWEEP_REGISTRY;
const tenantId = "tenant-local-helper-sweep";
const userA = "a8200000-0000-4000-8000-000000000001";
const userB = "a8200000-0000-4000-8000-000000000002";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Local Helper Sweep HTTP",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "a8200000-0000-4000-8000-000000000003",
};
const binding: LocalHelperSweepBinding = {
  adapterAddress: registry.components.find(({ role }) => role === "adapter")!.address,
  bindingId: "a8200000-0000-4000-8000-000000000004",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2",
  helperAddress: "0x1234567890123456789012345678901234567890",
  helperVersion: "WalletHelperV1",
  ownerAddress: wallet.address,
  permit2Address: registry.components.find(({ role }) => role === "permit2")!.address,
  runtimeCodeHash: `0x${"aa".repeat(32)}`,
  state: "active",
  verifiedBlockNumber: "7",
  walletId: wallet.walletId,
};

class Policies implements ChainAccessPolicyStore {
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
        reason: "synthetic only",
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: userA,
      },
    ];
  }
  async recordManagementAudit(): Promise<void> {}
  async update(): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("unused");
  }
}

class Directory implements WalletDirectory {
  async getWallet(userId: string, walletId: string) {
    return userId === userA && walletId === wallet.walletId ? wallet : null;
  }
  async listWallets(userId: string) {
    return { items: userId === userA ? [wallet] : [] };
  }
}

function inspection(): LocalHelperResidualChainInspection {
  return {
    allowances: registry.tokens.flatMap((token) =>
      registry.components.map((component) => ({
        amountBaseUnit: "0",
        spenderAddress: component.address,
        spenderRole: component.role,
        tokenAddress: token.address,
      })),
    ),
    block: {
      hash: `0x${"12".repeat(32)}`,
      number: "8",
      timestamp: new Date(now.getTime() - 1_000).toISOString(),
    },
    componentCode: registry.components.map(({ address, role, runtimeCodeHash }) => ({
      address,
      role,
      runtimeCodeHash,
    })),
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    feeLimits: ["native:31337", ...registry.tokens.map(({ address }) => `token:${address}`)].map(
      (assetId) => ({
        assetId,
        feeLimit: {
          feeCapBaseUnit: "400000",
          gasLimit: "100000",
          maxFeePerGasBaseUnit: "4",
          maxPriorityFeePerGasBaseUnit: "2",
        },
      }),
    ),
    headBlockNumber: "8",
    helper: { owner: wallet.address, runtimeCodeHash: binding.runtimeCodeHash },
    nativeBalanceBaseUnit: "2000",
    nftCustody: [],
    nonceViews: [{ latest: "8", pending: "8", providerId: "anvil-primary" }],
    referencedBlockHash: `0x${"12".repeat(32)}`,
    tokenBalances: registry.tokens.map((token, index) => ({
      address: token.address,
      amountBaseUnit: index === 0 ? "20" : "30",
      runtimeCodeHash: token.runtimeCodeHash,
    })),
    unknownTokens: [],
  };
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture(executionEnabled = true) {
  const sessions = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessions, userA, now),
    issueFixtureSession(sessions, userB, now),
  ]);
  let uuidSequence = 20;
  let previewSequence = 5;
  const localHelperSweeps = new LocalHelperSweepService({
    bindings: new MemoryLocalHelperSweepBindingStore([{ ...binding, tenantId, userId: userA }]),
    chain: {
      async inspect() {
        return inspection();
      },
    },
    now: () => now,
    operations: new MemoryLocalHelperSweepOperationStore({
      now: () => now,
      uuid: () => `a8200000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`,
    }),
    previews: new MemoryLocalHelperSweepPreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(previewSequence++),
    snapshots: new MemoryLocalHelperResidualSnapshotStore(),
  });
  const app = buildApiApp({
    chainPolicyStore: new Policies(),
    freshReauthentication: {
      async verify({ proof }) {
        return proof === "fresh-proof";
      },
    },
    localHelperSweepChainIds: executionEnabled ? [31_337] : [],
    localHelperSweeps,
    maintenance: { enabled: false, message: null, until: null },
    now: () => now,
    regionPolicy: () => ({ blocked: false, code: null, message: null }),
    sessionStore: sessions,
    tenantId,
    walletDirectory: new Directory(),
  });
  apps.push(app);
  return { app, tokenA, tokenB };
}

function auth(token: string) {
  return { cookie: `lpbot_session=${token}` };
}

afterAll(async () => Promise.all(apps.map((app) => app.close())));

describe("P05-08 local Helper sweep HTTP API", () => {
  it("scans, previews, reauthenticates, submits and queries batch plus single assets", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const scanRequest = {
      chainId: 31_337,
      idempotencyKey: "local-http-scan-0001",
      walletId: wallet.walletId,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          payload: scanRequest,
          url: "/api/wallets/helper-residuals/scan",
        })
      ).statusCode,
    ).toBe(401);
    const scan = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: scanRequest,
      url: "/api/wallets/helper-residuals/scan",
    });
    expect(scan.statusCode).toBe(200);
    expect(scan.headers["cache-control"]).toBe("no-store");
    expect(scan.json().data).toMatchObject({
      binding: { state: "degraded" },
      chainId: 31_337,
      snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    });
    expect(
      (
        await app.inject({
          headers: auth(tokenB),
          method: "POST",
          payload: scanRequest,
          url: "/api/wallets/helper-residuals/scan",
        })
      ).statusCode,
    ).toBe(404);
    const previewRequest = {
      assetIds: ["native:31337", `token:${registry.tokens[0].address}`],
      chainId: 31_337,
      snapshotDigest: scan.json().data.snapshotDigest,
      walletId: wallet.walletId,
    };
    expect(
      (
        await app.inject({
          headers: auth(tokenA),
          method: "POST",
          payload: { ...previewRequest, recipient: wallet.address },
          url: "/api/wallets/helper-residuals/sweep/preview",
        })
      ).statusCode,
    ).toBe(400);
    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: previewRequest,
      url: "/api/wallets/helper-residuals/sweep/preview",
    });
    expect(preview.statusCode).toBe(200);
    const sweepRequest = {
      ...previewRequest,
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
    };
    const headers = { ...auth(tokenA), "idempotency-key": "local-http-sweep-0001" };
    expect(
      (
        await app.inject({
          headers,
          method: "POST",
          payload: sweepRequest,
          url: "/api/wallets/helper-residuals/sweep",
        })
      ).statusCode,
    ).toBe(403);
    const submitted = await app.inject({
      headers: { ...headers, "x-lpbot-reauthentication": "fresh-proof" },
      method: "POST",
      payload: sweepRequest,
      url: "/api/wallets/helper-residuals/sweep",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().data.operations).toHaveLength(2);
    expect(
      (
        await app.inject({
          headers: { ...headers, "x-lpbot-reauthentication": "fresh-proof" },
          method: "POST",
          payload: sweepRequest,
          url: "/api/wallets/helper-residuals/sweep",
        })
      ).statusCode,
    ).toBe(200);
    const batchUrl = `/api/chain-operation-batches/${submitted.json().data.batchId}`;
    expect(
      (await app.inject({ headers: auth(tokenA), method: "GET", url: batchUrl })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ headers: auth(tokenB), method: "GET", url: batchUrl })).statusCode,
    ).toBe(404);
    const operationUrl = `/api/chain-operations/${submitted.json().data.operations[0].operationId}`;
    expect(
      (await app.inject({ headers: auth(tokenA), method: "GET", url: operationUrl })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ headers: auth(tokenB), method: "GET", url: operationUrl })).statusCode,
    ).toBe(404);
  });

  it("keeps chainId 56 without a sweep execution entry and closes disabled local gate", async () => {
    const { app, tokenA } = await fixture(false);
    const payload = {
      assetIds: ["native:31337"],
      chainId: 31_337,
      snapshotDigest: `sha256:${"11".repeat(32)}`,
      walletId: wallet.walletId,
    };
    expect(
      (
        await app.inject({
          headers: auth(tokenA),
          method: "POST",
          payload,
          url: "/api/wallets/helper-residuals/sweep/preview",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: auth(tokenA),
          method: "POST",
          payload: { ...payload, chainId: 56 },
          url: "/api/wallets/helper-residuals/sweep/preview",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects invalid local Helper sweep configuration", async () => {
    const sessions = new SessionFixtureStore();
    expect(() =>
      buildApiApp({
        localHelperSweepChainIds: [56],
        maintenance: { enabled: false, message: null, until: null },
        regionPolicy: () => ({ blocked: false, code: null, message: null }),
        sessionStore: sessions,
      }),
    ).toThrow("Local Helper sweep chain IDs must contain only 31337");
  });
});
