import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import {
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import type { LocalHelperResidualSnapshot } from "../packages/domain/src/local-helper-sweep.js";
import {
  buildApiApp,
  LocalHelperUpgradeService,
  MemoryLocalHelperUpgradeBindingStore,
  MemoryLocalHelperUpgradeOperationStore,
  MemoryLocalHelperUpgradePreviewStore,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type LocalHelperUpgradeChainReader,
  type LocalHelperUpgradeResidualReader,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-21T04:00:00.000Z");
const tenantId = "tenant-helper-upgrade-http";
const userA = "9f090000-0000-4000-8000-000000000001";
const userB = "9f090000-0000-4000-8000-000000000002";
const walletId = "9f090000-0000-4000-8000-000000000003";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Helper upgrade HTTP",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};
const adapter = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "adapter")!;
const permit2 = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "permit2")!;
const binding = {
  adapterAddress: adapter.address,
  bindingId: "9f090000-0000-4000-8000-000000000004",
  deploymentRegistryVersion: "p05-local-helper-deployment-v2" as const,
  helperAddress: `0x${"12".repeat(20)}` as const,
  helperVersion: "WalletHelperV1" as const,
  ownerAddress: wallet.address,
  permit2Address: permit2.address,
  runtimeCodeHash: `0x${"13".repeat(32)}` as const,
  state: "active" as const,
  verifiedBlockNumber: "8",
  walletId,
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
        reason: "synthetic upgrade fixture",
        revision: 1,
        updatedAt: now.toISOString(),
        updatedBy: userA,
      },
    ];
  }

  async recordManagementAudit(): Promise<void> {}

  async update(): Promise<ChainAccessPolicyUpdateResult> {
    throw new Error("not used");
  }
}

class Directory implements WalletDirectory {
  async getWallet(userId: string, requestedWalletId: string) {
    return userId === userA && requestedWalletId === walletId ? wallet : null;
  }

  async listWallets(userId: string) {
    return { items: userId === userA ? [wallet] : [] };
  }
}

class Chain implements LocalHelperUpgradeChainReader {
  async nonceSnapshot() {
    return [
      {
        blockHash: `0x${"14".repeat(32)}` as const,
        blockNumber: "10",
        latestNonce: "7",
        pendingNonce: "7",
        providerId: "anvil-a",
      },
      {
        blockHash: `0x${"14".repeat(32)}` as const,
        blockNumber: "10",
        latestNonce: "7",
        pendingNonce: "7",
        providerId: "anvil-b",
      },
    ];
  }

  async inspect() {
    return {
      expectedAddressCode: "0x" as const,
      expectedRuntimeCodeHash: `0x${"15".repeat(32)}` as const,
      feeLimit: {
        feeCapBaseUnit: "4000000",
        gasLimit: "1000000",
        maxFeePerGasBaseUnit: "4",
        maxPriorityFeePerGasBaseUnit: "2",
      },
      sourceIdentity: {
        bindingMatches: true,
        observedOwner: wallet.address,
        observedRuntimeCodeHash: binding.runtimeCodeHash,
        ownerMatches: true,
        registryMatches: true,
        runtimeMatches: true,
      },
    };
  }
}

function residual(): LocalHelperResidualSnapshot {
  return {
    allowances: P05_HELPER_DEPLOYMENT_REGISTRY.tokens.map((token) => ({
      amountBaseUnit: "0",
      assetId: `allowance:${token.address}:${adapter.address}`,
      spenderAddress: adapter.address,
      spenderRole: "adapter",
      tokenAddress: token.address,
    })),
    balances: [
      {
        amountBaseUnit: "1000",
        assetId: "native:31337",
        dustBaseUnit: "1000",
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
    ],
    binding,
    block: {
      hash: `0x${"16".repeat(32)}`,
      number: "9",
      timestamp: new Date(now.getTime() - 1_000).toISOString(),
    },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons: [],
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    identity: {
      bindingMatches: true,
      componentsMatch: true,
      observedOwner: wallet.address,
      observedRuntimeCodeHash: binding.runtimeCodeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: false,
    nftCustody: [],
    observedAt: now.toISOString(),
    registry: {
      digest: P05_LOCAL_HELPER_UPGRADE_REGISTRY.sweep.registryDigest,
      version: "p05-local-helper-sweep-v2",
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"17".repeat(32)}`,
    snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    unknownTokens: [],
    wallet: { address: wallet.address, walletId },
  };
}

class Residuals implements LocalHelperUpgradeResidualReader {
  async scan() {
    return residual();
  }
}

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture(executionEnabled = true) {
  const sessions = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessions, userA, now),
    issueFixtureSession(sessions, userB, now),
  ]);
  const bindings = new MemoryLocalHelperUpgradeBindingStore();
  bindings.seed({ binding, tenantId, userId: userA });
  let sequence = 20;
  const localHelperUpgrades = new LocalHelperUpgradeService({
    bindings,
    chain: new Chain(),
    now: () => now,
    operations: new MemoryLocalHelperUpgradeOperationStore({
      now: () => now,
      uuid: () => `9f090000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
    }),
    previews: new MemoryLocalHelperUpgradePreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(sequence++),
    residuals: new Residuals(),
  });
  const app = buildApiApp({
    chainPolicyStore: new Policies(),
    freshReauthentication: {
      async verify({ proof }) {
        return proof === "fresh-proof";
      },
    },
    localHelperUpgradeChainIds: executionEnabled ? [31_337] : [],
    localHelperUpgrades,
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

describe("P05-09 local Helper upgrade HTTP API", () => {
  it("enforces strict preview fields, authentication, fresh reauth, and Idempotency-Key", async () => {
    const { app, tokenA } = await fixture();
    const request = { chainId: 31_337, walletId };
    expect(
      (
        await app.inject({
          method: "POST",
          payload: request,
          url: "/api/wallets/helper/upgrade/preview",
        })
      ).statusCode,
    ).toBe(401);

    for (const key of [
      "bytecode",
      "helper",
      "target",
      "selector",
      "calldata",
      "recipient",
      "registryOverride",
      "feeOverride",
    ]) {
      const rejected = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload: { ...request, [key]: "injected" },
        url: "/api/wallets/helper/upgrade/preview",
      });
      expect(rejected.statusCode, key).toBe(400);
      expect(rejected.json().error.code, key).toBe("PREVIEW_INVALID");
    }

    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: request,
      url: "/api/wallets/helper/upgrade/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.json().data).toMatchObject({
      chainId: 31_337,
      upgradeable: true,
      versions: { source: "WalletHelperV1", target: "WalletHelperV2" },
      walletId,
    });
    for (const forbidden of ["bytecode", "helper", "selector", "calldata", "recipient"]) {
      expect(preview.json().data).not.toHaveProperty(forbidden);
    }
    const submit = {
      ...request,
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
    };
    const idempotency = "helper-upgrade-http-0001";
    expect(
      (
        await app.inject({
          headers: { ...auth(tokenA), "idempotency-key": idempotency },
          method: "POST",
          payload: submit,
          url: "/api/wallets/helper/upgrade",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: { ...auth(tokenA), "x-lpbot-reauthentication": "fresh-proof" },
          method: "POST",
          payload: submit,
          url: "/api/wallets/helper/upgrade",
        })
      ).statusCode,
    ).toBe(400);

    const headers = {
      ...auth(tokenA),
      "idempotency-key": idempotency,
      "x-lpbot-reauthentication": "fresh-proof",
    };
    const submitted = await app.inject({
      headers,
      method: "POST",
      payload: submit,
      url: "/api/wallets/helper/upgrade",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().data).toMatchObject({ cursor: "preflight", state: "queued" });
    const duplicate = await app.inject({
      headers,
      method: "POST",
      payload: submit,
      url: "/api/wallets/helper/upgrade",
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().data.operationId).toBe(submitted.json().data.operationId);

    const secondPreview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: request,
      url: "/api/wallets/helper/upgrade/preview",
    });
    const conflict = await app.inject({
      headers,
      method: "POST",
      payload: {
        ...request,
        previewDigest: secondPreview.json().data.previewDigest,
        previewToken: secondPreview.json().data.previewToken,
      },
      url: "/api/wallets/helper/upgrade",
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("isolates operation and latest queries by authenticated user", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const request = { chainId: 31_337, walletId };
    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: request,
      url: "/api/wallets/helper/upgrade/preview",
    });
    const submitted = await app.inject({
      headers: {
        ...auth(tokenA),
        "idempotency-key": "helper-upgrade-http-0002",
        "x-lpbot-reauthentication": "fresh-proof",
      },
      method: "POST",
      payload: {
        ...request,
        previewDigest: preview.json().data.previewDigest,
        previewToken: preview.json().data.previewToken,
      },
      url: "/api/wallets/helper/upgrade",
    });
    const operationId = submitted.json().data.operationId as string;
    const operationUrl = `/api/helper-upgrades/${operationId}`;
    expect(
      (await app.inject({ headers: auth(tokenA), method: "GET", url: operationUrl })).statusCode,
    ).toBe(200);
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

    const latestUrl = `/api/wallets/${walletId}/helper-upgrade`;
    expect(
      (await app.inject({ headers: auth(tokenA), method: "GET", url: latestUrl })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ headers: auth(tokenB), method: "GET", url: latestUrl })).statusCode,
    ).toBe(404);
  });

  it("keeps chainId 56 unsupported and closes the local execution gate", async () => {
    const { app, tokenA } = await fixture(false);
    expect(
      (
        await app.inject({
          headers: auth(tokenA),
          method: "POST",
          payload: { chainId: 31_337, walletId },
          url: "/api/wallets/helper/upgrade/preview",
        })
      ).statusCode,
    ).toBe(403);
    const wrongChain = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: { chainId: 56, walletId },
      url: "/api/wallets/helper/upgrade/preview",
    });
    expect(wrongChain.statusCode).toBe(400);
    expect(wrongChain.json().error.code).toBe("PREVIEW_INVALID");
  });
});
