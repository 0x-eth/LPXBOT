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
  ControlledLocalSwapQuoteService,
  LocalSwapExecutionError,
  LocalSwapExecutionService,
  MemoryLocalSwapHelperBindingStore,
  MemoryLocalSwapOperationStore,
  MemoryLocalSwapPreviewStore,
  MemoryLocalSwapQuoteStore,
  parseLocalSwapExecute,
  parseLocalSwapExecutePreview,
  type LocalSwapChainInspection,
  type LocalSwapHelperBinding,
} from "../apps/api/src/local-swap-executions.js";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T03:00:00.000Z");
const registry = P05_LOCAL_SWAP_EXECUTION_REGISTRY;
const tenantId = "local-fixture";
const userId = "a6100000-0000-4000-8000-000000000001";
const wallet: CustodyWallet = {
  address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Synthetic Wallet",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId: "a6100000-0000-4000-8000-000000000002",
};
const binding: LocalSwapHelperBinding = {
  adapterAddress: localSwapComponent("adapter").address,
  bindingId: "a6100000-0000-4000-8000-000000000003",
  chainId: 31_337,
  helperAddress: "0x0165878a594ca255338adfa4d48449f69242eb8f",
  helperVersion: "WalletHelperV1",
  ownerAddress: wallet.address,
  permit2Address: localSwapComponent("permit2").address,
  registryVersion: "p05-local-helper-deployment-v2",
  runtimeCodeHash: `0x${"91".repeat(32)}`,
  state: "active",
  verifiedBlockNumber: "7",
  walletId: wallet.walletId,
};

function quoteProvider(): LocalSwapQuoteProvider {
  return {
    async inspect() {
      return {
        amountOutBaseUnit: "2000",
        blockHash: `0x${"12".repeat(32)}` as const,
        blockNumber: "7",
        blockTimestamp: now.toISOString(),
        componentCode: registry.components.map((component) => ({ ...component })),
        gasLimit: "500000",
        helper: {
          adapter: binding.adapterAddress,
          codeHash: binding.runtimeCodeHash,
          owner: binding.ownerAddress,
          permit2: binding.permit2Address,
        },
        maxFeePerGasBaseUnit: "20",
        maxPriorityFeePerGasBaseUnit: "2",
        providerSnapshotId: "a6100000-0000-4000-8000-000000000004",
        tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
          address,
          runtimeCodeHash,
        })),
      };
    },
  };
}

function inspection(overrides: Partial<LocalSwapChainInspection> = {}): LocalSwapChainInspection {
  return {
    allowanceBaseUnit: "50",
    blockHash: `0x${"12".repeat(32)}`,
    blockNumber: "8",
    blockTimestamp: now.toISOString(),
    componentCode: registry.components.map((component) => ({ ...component })),
    helper: {
      adapter: binding.adapterAddress,
      codeHash: binding.runtimeCodeHash,
      owner: binding.ownerAddress,
      permit2: binding.permit2Address,
    },
    nonceViews: [{ latest: "8", pending: "8", providerId: "anvil-primary" }],
    ownerInputBalanceBaseUnit: "1000000",
    ownerOutputBalanceBaseUnit: "0",
    permit2: { domainSeparator: `0x${"33".repeat(32)}`, nonce: "4" },
    tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
      address,
      runtimeCodeHash,
    })),
    ...overrides,
  };
}

function fixture(
  input: { mode?: "direct" | "permit2"; inspection?: LocalSwapChainInspection } = {},
) {
  const quoteStore = new MemoryLocalSwapQuoteStore();
  const bindings = new MemoryLocalSwapHelperBindingStore([{ ...binding, tenantId, userId }]);
  const quoteService = new ControlledLocalSwapQuoteService({
    adapter: new LocalSwapQuoteAdapter({ now: () => now, provider: quoteProvider() }),
    bindings,
    store: quoteStore,
  });
  let uuidSequence = 10;
  const service = new LocalSwapExecutionService({
    bindings,
    chain: {
      async inspect() {
        return structuredClone(input.inspection ?? inspection());
      },
    },
    now: () => now,
    operations: new MemoryLocalSwapOperationStore({
      now: () => now,
      uuid: () => `a6100000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`,
    }),
    permit2Signatures: {
      async sign() {
        return { signature: `0x${"44".repeat(65)}` };
      },
    },
    previews: new MemoryLocalSwapPreviewStore(),
    quotes: quoteStore,
    randomBytes: () => new Uint8Array(32).fill(7),
  });
  return { quoteService, service };
}

async function quoted(api: ReturnType<typeof fixture>["quoteService"]) {
  return api.quote({
    amountInBaseUnit: "1000",
    chainId: 31_337,
    slippageBps: 100,
    tenantId,
    tokenIn: registry.tokens[0].address,
    tokenOut: registry.tokens[1].address,
    userId,
    walletAddress: wallet.address,
    walletId: wallet.walletId,
  });
}

describe("P05-06 local Swap execution API service", () => {
  it("rejects arbitrary execution fields at the ingress boundary", () => {
    const base = {
      authorizationMode: "direct",
      quoteDigest: `sha256:${"11".repeat(32)}`,
      walletId: wallet.walletId,
    };
    expect(parseLocalSwapExecutePreview(base)).toEqual(base);
    for (const field of ["target", "router", "spender", "selector", "calldata"]) {
      expect(() => parseLocalSwapExecutePreview({ ...base, [field]: "0xdeadbeef" })).toThrow(
        "PREVIEW_INVALID",
      );
    }
    expect(() =>
      parseLocalSwapExecute({
        ...base,
        previewDigest: `sha256:${"22".repeat(32)}`,
        previewToken: "A".repeat(43),
        calldata: "0xdeadbeef",
      }),
    ).toThrow("PREVIEW_INVALID");
  });

  it.each(["direct", "permit2"] as const)(
    "builds an ordered %s reset/approve/swap/cleanup operation and deduplicates submit",
    async (authorizationMode) => {
      const api = fixture({ mode: authorizationMode });
      const quote = await quoted(api.quoteService);
      const request = {
        authorizationMode,
        quoteDigest: quote.quoteDigest,
        walletId: wallet.walletId,
      };
      const preview = await api.service.preview({ request, tenantId, userId, wallet });
      expect(preview.steps.map(({ kind }) => kind)).toEqual([
        "allowance-reset",
        "approve",
        "swap",
        "cleanup",
      ]);
      expect(preview.serviceFeeBps).toBe(0);
      const submit = {
        idempotencyKey: "swap-execution-key-0001",
        request: {
          ...request,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
        },
        requestId: "request-1",
        sessionId: "a6100000-0000-4000-8000-000000000090",
        tenantId,
        userId,
        wallet,
      };
      const first = await api.service.submit(submit);
      const duplicate = await api.service.submit(submit);
      expect(first.created).toBe(true);
      expect(duplicate.created).toBe(false);
      expect(duplicate.operation.operationId).toBe(first.operation.operationId);
      expect(first.operation.steps.map(({ kind }) => kind)).toEqual(
        preview.steps.map(({ kind }) => kind),
      );
      expect(first.operation.steps.map(({ nonce }) => nonce)).toEqual(["8", "9", "10", "11"]);
      expect(first.operation.steps[0]?.state).toBe("queued");
      expect(first.operation.steps.slice(1).every(({ state }) => state === "blocked")).toBe(true);
    },
  );

  it("fails closed on inactive/mismatched Helper, stale block, balance and Permit2 signature", async () => {
    const stale = fixture({ inspection: inspection({ blockNumber: "13" }) });
    const quote = await quoted(stale.quoteService);
    await expect(
      stale.service.preview({
        request: {
          authorizationMode: "direct",
          quoteDigest: quote.quoteDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "QUOTE_STALE" });

    const empty = fixture({ inspection: inspection({ ownerInputBalanceBaseUnit: "999" }) });
    const emptyQuote = await quoted(empty.quoteService);
    await expect(
      empty.service.preview({
        request: {
          authorizationMode: "direct",
          quoteDigest: emptyQuote.quoteDigest,
          walletId: wallet.walletId,
        },
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toBeInstanceOf(LocalSwapExecutionError);
  });
});
