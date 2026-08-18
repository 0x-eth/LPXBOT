import type {
  CustodyWallet,
  EvmAddress,
  WalletTransferAddressClassification,
  WalletTransferAsset,
} from "../packages/api-contract/src/index.js";
import {
  canTransitionWalletTransfer,
  resolveWalletTransferAmount,
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  walletTransferRequestHash,
} from "../packages/domain/src/wallet-transfer.js";
import {
  MemoryWalletTransferOperationStore,
  MemoryWalletTransferPreviewStore,
  parseWalletTransferPreviewRequest,
  WalletTransferService,
  type WalletTransferAssetDefinition,
  type WalletTransferChainReader,
  type WalletTransferPolicySnapshot,
} from "../apps/api/src/index.js";
import { describe, expect, it, vi } from "vitest";

const now = new Date("2026-08-18T12:00:00.000Z");
const userId = "54000000-0000-4000-8000-000000000001";
const walletId = "54000000-0000-4000-8000-000000000011";
const recipient = "0x1111111111111111111111111111111111111111" as const;
const secondRecipient = "0x2222222222222222222222222222222222222222" as const;
const tokenAddress = "0x3333333333333333333333333333333333333333" as const;
const policyDigest = `sha256:${"a".repeat(64)}` as const;
const wallet: CustodyWallet = {
  address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Transfer fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};

class ChainFixture implements WalletTransferChainReader {
  assetBalance = "1000000";
  blockNumber = "1";
  nativeBalance = "1000000000000000000";
  nonceLatest = "0";
  noncePending = "0";
  providerDivergence = false;

  async estimateFee() {
    return {
      feeCapBaseUnit: "42000000000000",
      gasLimit: "21000",
      maxFeePerGasBaseUnit: "2000000000",
      maxPriorityFeePerGasBaseUnit: "1000000000",
    };
  }

  async nonceViews() {
    return [
      { latest: this.nonceLatest, pending: this.noncePending, providerId: "local-a" },
      {
        latest: this.nonceLatest,
        pending: this.providerDivergence ? "1" : this.noncePending,
        providerId: "local-b",
      },
    ];
  }

  async readAssetState(input: { asset: WalletTransferAsset }) {
    const native = input.asset.kind === "native";
    return {
      assetBalanceBaseUnit: native ? this.nativeBalance : this.assetBalance,
      blockNumber: this.blockNumber,
      nativeBalanceBaseUnit: this.nativeBalance,
      tokenCodePresent: true,
      tokenMetadataMatches: true,
    };
  }
}

function fixture(
  input: {
    classification?: WalletTransferAddressClassification;
    executionMode?: WalletTransferPolicySnapshot["executionMode"];
  } = {},
) {
  const chain = new ChainFixture();
  const operations = new MemoryWalletTransferOperationStore({
    now: () => now,
    uuid: (() => {
      let value = 100;
      return () => `54000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
    })(),
  });
  const policy: WalletTransferPolicySnapshot = {
    executionMode: input.executionMode ?? "local-auto",
    policyDigest,
    policyVersion: "local-policy-v1",
    registryVersion: "local-registry-v1",
  };
  const verifySecurityPassword = vi.fn(async () => ({ verified: true as const, version: 3 }));
  const token: WalletTransferAssetDefinition = {
    chainId: 31_337,
    decimals: 6,
    default: false,
    feeOnTransfer: false,
    name: "Fixture USD",
    symbol: "FIX",
    tokenAddress,
  };
  const service = new WalletTransferService({
    addresses: {
      classify: async () => input.classification ?? "known-external",
    },
    assets: {
      native: async () => ({ decimals: 18, name: "Ether", symbol: "ETH" }),
      token: async ({ tokenAddress: requested }: { tokenAddress: EvmAddress }) =>
        requested === tokenAddress ? token : null,
    },
    chain,
    localChainIds: [31_337],
    now: () => now,
    operations,
    policies: { current: async () => policy },
    previews: new MemoryWalletTransferPreviewStore(),
    randomBytes: () => Buffer.alloc(32, 7),
    securityPassword: {
      putSecurityPassword: vi.fn(),
      securityPasswordStatus: vi.fn(),
      verifySecurityPassword,
    },
  });
  return { chain, operations, policy, service, verifySecurityPassword };
}

describe("P04-06 wallet transfer domain", () => {
  it("uses only canonical base-unit strings and floors presets after reserving native gas", () => {
    expect(
      resolveWalletTransferAmount({
        amount: { kind: "preset", preset: "25" },
        assetBalanceBaseUnit: "1000000000000000000",
        assetKind: "native",
        feeCapBaseUnit: "42000000000000",
        nativeBalanceBaseUnit: "1000000000000000000",
      }),
    ).toBe("249989500000000000");
    expect(() =>
      parseWalletTransferPreviewRequest({
        amount: { amountBaseUnit: "1e6", kind: "exact" },
        asset: { kind: "native" },
        chainId: 31_337,
        recipient,
        walletId,
      }),
    ).toThrowError("TRANSFER_AMOUNT_INVALID");
    expect(() =>
      parseWalletTransferPreviewRequest({
        amount: { amountBaseUnit: "01", kind: "exact" },
        asset: { kind: "native" },
        calldata: "0xdeadbeef",
        chainId: 31_337,
        recipient,
        walletId,
      }),
    ).toThrowError("PREVIEW_INVALID");
  });

  it("previews native MAX and standard ERC-20 without arbitrary calldata", async () => {
    const { service } = fixture();
    const native = await service.preview({
      request: {
        amount: { kind: "preset", preset: "MAX" },
        asset: { kind: "native" },
        chainId: 31_337,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    expect(native).toMatchObject({
      addressClassification: "known-external",
      amountBaseUnit: "999958000000000000",
      balanceChange: {
        nativeAfterMinimumBaseUnit: "0",
      },
      requiresSecurityPassword: false,
    });

    const token = await service.preview({
      request: {
        amount: { kind: "preset", preset: "75" },
        asset: { kind: "erc20", tokenAddress },
        chainId: 31_337,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    expect(token).toMatchObject({ amountBaseUnit: "750000", asset: { symbol: "FIX" } });
  });

  it("classifies another owned wallet without treating it as a self-transfer", async () => {
    const { service } = fixture({ classification: "own-wallet" });
    await expect(
      service.preview({
        request: {
          amount: { amountBaseUnit: "100", kind: "exact" },
          asset: { kind: "native" },
          chainId: 31_337,
          recipient,
          walletId,
        },
        userId,
        wallet,
      }),
    ).resolves.toMatchObject({
      addressClassification: "own-wallet",
      requiresSecurityPassword: false,
    });

    await expect(
      service.preview({
        request: {
          amount: { amountBaseUnit: "100", kind: "exact" },
          asset: { kind: "native" },
          chainId: 31_337,
          recipient: wallet.address.toLowerCase() as EvmAddress,
          walletId,
        },
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_SELF_FORBIDDEN" });
  });

  it("creates one queued operation for same-key retries and detects changed requests", async () => {
    const { operations, service } = fixture();
    const preview = await service.preview({
      request: {
        amount: { amountBaseUnit: "100", kind: "exact" },
        asset: { kind: "erc20", tokenAddress },
        chainId: 31_337,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    const submit = () =>
      service.submit({
        idempotencyKey: "fixture-transfer-key-0001",
        password: null,
        request: {
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId,
        },
        requestId: "request-1",
        secretIngress: false,
        sessionId: userId,
        userId,
        wallet,
      });
    const first = await submit();
    const second = await submit();
    expect(first).toMatchObject({
      created: true,
      operation: { nonce: "0", state: "queued" },
    });
    expect(second).toMatchObject({
      created: false,
      operation: { operationId: first.operation.operationId },
    });
    expect(operations.outbox).toHaveLength(1);

    const changed = await service.preview({
      request: {
        amount: { amountBaseUnit: "101", kind: "exact" },
        asset: { kind: "erc20", tokenAddress },
        chainId: 31_337,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    await expect(
      service.submit({
        idempotencyKey: "fixture-transfer-key-0001",
        password: null,
        request: {
          previewDigest: changed.previewDigest,
          previewToken: changed.previewToken,
          walletId,
        },
        requestId: "request-2",
        secretIngress: false,
        sessionId: userId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("requires the dedicated password ingress only for a new external address", async () => {
    const { service, verifySecurityPassword } = fixture({ classification: "new-external" });
    const preview = await service.preview({
      request: {
        amount: { amountBaseUnit: "10", kind: "exact" },
        asset: { kind: "erc20", tokenAddress },
        chainId: 31_337,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    await expect(
      service.submit({
        idempotencyKey: "fixture-transfer-key-0002",
        password: "fixture-password",
        request: {
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId,
        },
        requestId: "request-3",
        secretIngress: false,
        sessionId: userId,
        userId,
        wallet,
      }),
    ).rejects.toMatchObject({ code: "SECURITY_PASSWORD_REQUIRED" });
    await expect(
      service.submit({
        idempotencyKey: "fixture-transfer-key-0002",
        password: "fixture-password",
        request: {
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId,
        },
        requestId: "request-3",
        secretIngress: true,
        sessionId: userId,
        userId,
        wallet,
      }),
    ).resolves.toMatchObject({ operation: { state: "queued" } });
    expect(verifySecurityPassword).toHaveBeenCalledOnce();
    expect(JSON.stringify((verifySecurityPassword.mock.calls[0] as unknown[])[0])).not.toContain(
      "fixture-password",
    );
  });

  it("stops non-local writes at ready-for-approval and quarantines provider divergence", async () => {
    const approval = fixture({ executionMode: "local-auto" });
    const preview = await approval.service.preview({
      request: {
        amount: { amountBaseUnit: "1", kind: "exact" },
        asset: { kind: "native" },
        chainId: 56,
        recipient,
        walletId,
      },
      userId,
      wallet,
    });
    await expect(
      approval.service.submit({
        idempotencyKey: "fixture-transfer-key-0003",
        password: null,
        request: {
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId,
        },
        requestId: "request-4",
        secretIngress: false,
        sessionId: userId,
        userId,
        wallet,
      }),
    ).resolves.toMatchObject({ operation: { nonce: null, state: "ready-for-approval" } });

    const divergent = fixture();
    divergent.chain.providerDivergence = true;
    const divergentPreview = await divergent.service.preview({
      request: {
        amount: { amountBaseUnit: "1", kind: "exact" },
        asset: { kind: "native" },
        chainId: 31_337,
        recipient: secondRecipient,
        walletId,
      },
      userId,
      wallet,
    });
    await expect(
      divergent.service.submit({
        idempotencyKey: "fixture-transfer-key-0004",
        password: null,
        request: {
          previewDigest: divergentPreview.previewDigest,
          previewToken: divergentPreview.previewToken,
          walletId,
        },
        requestId: "request-5",
        secretIngress: false,
        sessionId: userId,
        userId,
        wallet,
      }),
    ).resolves.toMatchObject({
      operation: { reconciliationReason: "NONCE_PROVIDER_DIVERGENCE", state: "reconciling" },
    });
  });

  it("binds fencing and calldata into signer plans and permits only explicit recovery transitions", () => {
    const plan = {
      amountBaseUnit: "100",
      asset: { kind: "erc20" as const, tokenAddress },
      chainId: 31_337,
      deadline: "2026-08-18T12:01:00.000Z",
      feeLimit: {
        feeCapBaseUnit: "100000",
        gasLimit: "50000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      fencingToken: "7",
      nonce: "3",
      operationId: "54000000-0000-4000-8000-000000000100",
      policyDigest,
      recipient,
      transactionData:
        `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${100n.toString(16).padStart(64, "0")}` as const,
      transactionTarget: tokenAddress,
      transactionValueBaseUnit: "0",
      walletAddress: wallet.address.toLowerCase() as EvmAddress,
      walletId,
    };
    expect(() => validateWalletTransferPlan(plan, now)).not.toThrow();
    expect(walletTransferPlanDigest(plan)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(
      walletTransferRequestHash({
        amountBaseUnit: "100",
        asset: plan.asset,
        chainId: plan.chainId,
        previewDigest: policyDigest,
        recipient,
        userId,
        walletId,
      }),
    ).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(canTransitionWalletTransfer("confirmed", "pending")).toBe(true);
    expect(canTransitionWalletTransfer("confirmed", "signed")).toBe(false);
  });
});
