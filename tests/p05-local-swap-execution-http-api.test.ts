import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import {
  LocalSwapQuoteAdapter,
  type LocalSwapQuoteProvider,
} from "../packages/chain-adapters/src/index.js";
import {
  localSwapComponent,
  P05_LOCAL_SWAP_EXECUTION_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  buildApiApp,
  ControlledLocalSwapQuoteService,
  LocalSwapExecutionService,
  MemoryLocalSwapHelperBindingStore,
  MemoryLocalSwapOperationStore,
  MemoryLocalSwapPreviewStore,
  MemoryLocalSwapQuoteStore,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type LocalSwapExecutionChainReader,
  type WalletDirectory,
} from "../apps/api/src/index.js";
import { afterAll, describe, expect, it } from "vitest";

import { issueFixtureSession, SessionFixtureStore } from "./helpers/session-fixture.js";

const now = new Date("2026-08-20T03:30:00.000Z");
const registry = P05_LOCAL_SWAP_EXECUTION_REGISTRY;
const tenantId = "tenant-local-swap-http";
const userA = "a6200000-0000-4000-8000-000000000001";
const userB = "a6200000-0000-4000-8000-000000000002";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Local Swap HTTP",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "a6200000-0000-4000-8000-000000000003",
};
const helperAddress = "0x0165878a594ca255338adfa4d48449f69242eb8f" as const;
const helperCodeHash = `0x${"91".repeat(32)}` as const;

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

const quoteProvider: LocalSwapQuoteProvider = {
  async inspect() {
    return {
      amountOutBaseUnit: "2000",
      blockHash: `0x${"12".repeat(32)}` as const,
      blockNumber: "7",
      blockTimestamp: now.toISOString(),
      componentCode: registry.components.map((component) => ({ ...component })),
      gasLimit: "500000",
      helper: {
        adapter: localSwapComponent("adapter").address,
        codeHash: helperCodeHash,
        owner: wallet.address,
        permit2: localSwapComponent("permit2").address,
      },
      maxFeePerGasBaseUnit: "20",
      maxPriorityFeePerGasBaseUnit: "2",
      providerSnapshotId: "a6200000-0000-4000-8000-000000000004",
      tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  },
};

const chain: LocalSwapExecutionChainReader = {
  async inspect({ approvalSpender }) {
    return {
      allowanceBaseUnit: approvalSpender === helperAddress ? "0" : "1000",
      blockHash: `0x${"12".repeat(32)}`,
      blockNumber: "8",
      blockTimestamp: now.toISOString(),
      componentCode: registry.components.map((component) => ({ ...component })),
      helper: {
        adapter: localSwapComponent("adapter").address,
        codeHash: helperCodeHash,
        owner: wallet.address,
        permit2: localSwapComponent("permit2").address,
      },
      nonceViews: [{ latest: "8", pending: "8", providerId: "anvil-primary" }],
      ownerInputBalanceBaseUnit: "1000000",
      ownerOutputBalanceBaseUnit: "0",
      permit2: { domainSeparator: `0x${"33".repeat(32)}`, nonce: "4" },
      tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  },
};

const apps: Array<ReturnType<typeof buildApiApp>> = [];

async function fixture() {
  const sessions = new SessionFixtureStore();
  const [tokenA, tokenB] = await Promise.all([
    issueFixtureSession(sessions, userA, now),
    issueFixtureSession(sessions, userB, now),
  ]);
  const quoteStore = new MemoryLocalSwapQuoteStore();
  const bindings = new MemoryLocalSwapHelperBindingStore([
    {
      adapterAddress: localSwapComponent("adapter").address,
      bindingId: "a6200000-0000-4000-8000-000000000005",
      chainId: 31_337,
      helperAddress,
      helperVersion: "WalletHelperV1",
      ownerAddress: wallet.address,
      permit2Address: localSwapComponent("permit2").address,
      registryVersion: "p05-local-helper-deployment-v2",
      runtimeCodeHash: helperCodeHash,
      state: "active",
      tenantId,
      userId: userA,
      verifiedBlockNumber: "7",
      walletId: wallet.walletId,
    },
  ]);
  let uuidSequence = 20;
  const localSwapExecutions = new LocalSwapExecutionService({
    bindings,
    chain,
    now: () => now,
    operations: new MemoryLocalSwapOperationStore({
      now: () => now,
      uuid: () => `a6200000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`,
    }),
    permit2Signatures: {
      async sign() {
        return { signature: `0x${"44".repeat(65)}` };
      },
    },
    previews: new MemoryLocalSwapPreviewStore(),
    quotes: quoteStore,
    randomBytes: () => new Uint8Array(32).fill(9),
  });
  const app = buildApiApp({
    chainPolicyStore: new Policies(),
    freshReauthentication: {
      async verify({ proof }) {
        return proof === "fresh-proof";
      },
    },
    localSwapExecutionChainIds: [31_337],
    localSwapExecutions,
    localSwapQuotes: new ControlledLocalSwapQuoteService({
      adapter: new LocalSwapQuoteAdapter({ now: () => now, provider: quoteProvider }),
      bindings,
      store: quoteStore,
    }),
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

describe("P05-06 local Swap HTTP API", () => {
  it("quotes, previews, requires reauthentication, submits and uses the unified operation GET", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const quoteResponse = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: {
        amountInBaseUnit: "1000",
        chainId: 31_337,
        slippageBps: 100,
        tokenIn: registry.tokens[0].address,
        tokenOut: registry.tokens[1].address,
        walletId: wallet.walletId,
      },
      url: "/api/swap/quote",
    });
    expect(quoteResponse.statusCode).toBe(200);
    expect(quoteResponse.json().data).toMatchObject({
      executionEnabled: true,
      quoteVersion: "p05-local-swap-quote-v2",
      serviceFeeBps: 0,
    });
    const previewPayload = {
      authorizationMode: "direct",
      quoteDigest: quoteResponse.json().data.quoteDigest,
      walletId: wallet.walletId,
    };
    const preview = await app.inject({
      headers: auth(tokenA),
      method: "POST",
      payload: previewPayload,
      url: "/api/swap/execute/preview",
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.steps.map(({ kind }: { kind: string }) => kind)).toEqual([
      "approve",
      "swap",
      "cleanup",
    ]);
    const executePayload = {
      ...previewPayload,
      previewDigest: preview.json().data.previewDigest,
      previewToken: preview.json().data.previewToken,
    };
    expect(
      (
        await app.inject({
          headers: { ...auth(tokenA), "idempotency-key": "local-swap-http-0001" },
          method: "POST",
          payload: executePayload,
          url: "/api/swap/execute",
        })
      ).statusCode,
    ).toBe(403);
    const submitted = await app.inject({
      headers: {
        ...auth(tokenA),
        "idempotency-key": "local-swap-http-0001",
        "x-lpbot-reauthentication": "fresh-proof",
      },
      method: "POST",
      payload: executePayload,
      url: "/api/swap/execute",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json().data.operationKind).toBe("local-swap");
    const url = `/api/chain-operations/${submitted.json().data.operationId}`;
    expect((await app.inject({ headers: auth(tokenA), method: "GET", url })).statusCode).toBe(200);
    expect((await app.inject({ headers: auth(tokenB), method: "GET", url })).statusCode).toBe(404);
  });

  it("rejects target/router/spender/selector/calldata injection and foreign wallets", async () => {
    const { app, tokenA, tokenB } = await fixture();
    const base = {
      authorizationMode: "direct",
      quoteDigest: `sha256:${"11".repeat(32)}`,
      walletId: wallet.walletId,
    };
    for (const key of ["target", "router", "spender", "selector", "calldata"]) {
      const response = await app.inject({
        headers: auth(tokenA),
        method: "POST",
        payload: { ...base, [key]: "0xdeadbeef" },
        url: "/api/swap/execute/preview",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("PREVIEW_INVALID");
    }
    const foreign = await app.inject({
      headers: auth(tokenB),
      method: "POST",
      payload: {
        amountInBaseUnit: "1000",
        chainId: 31_337,
        slippageBps: 100,
        tokenIn: registry.tokens[0].address,
        tokenOut: registry.tokens[1].address,
        walletId: wallet.walletId,
      },
      url: "/api/swap/quote",
    });
    expect(foreign.statusCode).toBe(404);
  });
});
