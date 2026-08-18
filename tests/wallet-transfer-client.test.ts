import { walletTransferSecretMediaType } from "../packages/api-contract/src/index.js";
import {
  parseWalletTransferOperation,
  parseWalletTransferPreview,
  WalletTransferClient,
  WalletTransferRequestError,
} from "../apps/web/src/wallet-transfer-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "5a000000-0000-4000-8000-000000000011";
const operationId = "5a000000-0000-4000-8000-000000000021";
const transactionId = "5a000000-0000-4000-8000-000000000031";
const recipient = "0x2222222222222222222222222222222222222222";
const tokenAddress = "0x3333333333333333333333333333333333333333";
const digest = `sha256:${"ab".repeat(32)}`;
const policyDigest = `sha256:${"cd".repeat(32)}`;

const feeLimit = {
  feeCapBaseUnit: "2100000",
  gasLimit: "21000",
  maxFeePerGasBaseUnit: "100",
  maxPriorityFeePerGasBaseUnit: "2",
};

const preview = {
  addressClassification: "new-external",
  amountBaseUnit: "250000",
  asset: {
    decimals: 6,
    kind: "erc20",
    name: "Fixture Dollar",
    symbol: "FIX",
    tokenAddress,
  },
  balanceChange: {
    assetAfterBaseUnit: "750000",
    assetBeforeBaseUnit: "1000000",
    assetDeltaBaseUnit: "-250000",
    nativeAfterMinimumBaseUnit: "999997900000",
    nativeBeforeBaseUnit: "1000000000000",
    nativeDeltaMaximumBaseUnit: "-2100000",
    recipientAssetDeltaBaseUnit: "250000",
  },
  chainId: 31337,
  expiresAt: "2026-08-18T14:05:00.000Z",
  feeLimit,
  policyDigest,
  policyVersion: "policy-v7",
  previewDigest: digest,
  previewToken: "A".repeat(43),
  recipient,
  registryVersion: "registry-v4",
  requiresSecurityPassword: true,
  walletId,
};

const transaction = {
  active: true,
  createdAt: "2026-08-18T14:00:01.000Z",
  generation: 0,
  maxFeePerGasBaseUnit: "100",
  maxPriorityFeePerGasBaseUnit: "2",
  nonce: "7",
  replacedByTransactionId: null,
  replacesTransactionId: null,
  state: "pending",
  transactionHash: `0x${"12".repeat(32)}`,
  transactionId,
};

const operation = {
  activeTransactionId: transactionId,
  addressClassification: "new-external",
  amountBaseUnit: "250000",
  asset: { kind: "erc20", tokenAddress },
  chainId: 31337,
  createdAt: "2026-08-18T14:00:00.000Z",
  failureCode: null,
  feeLimit,
  nonce: "7",
  operationId,
  planDigest: digest,
  policyDigest,
  recipient,
  reconciliationReason: null,
  state: "pending",
  transactions: [transaction],
  updatedAt: "2026-08-18T14:00:02.000Z",
  walletId,
};

function success(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ data, requestId: "wallet-transfer-fixture", success: true }),
    {
      headers: { "Content-Type": "application/json" },
      status,
    },
  );
}

describe("P04-06 strict wallet transfer browser client", () => {
  it("accepts canonical base-unit responses and rejects ambiguous or injected fields", () => {
    expect(parseWalletTransferPreview(preview)).toEqual(preview);
    expect(parseWalletTransferOperation(operation)).toEqual(operation);

    for (const malformed of [
      { ...preview, amountBaseUnit: 250_000 },
      { ...preview, amountBaseUnit: "2.5e5" },
      { ...preview, calldata: "0xdeadbeef" },
      { ...preview, requiresSecurityPassword: false },
      { ...preview, feeLimit: { ...feeLimit, feeCapBaseUnit: "2099999" } },
    ]) {
      expect(() => parseWalletTransferPreview(malformed)).toThrowError(WalletTransferRequestError);
    }

    for (const malformed of [
      { ...operation, amountBaseUnit: "0250000" },
      { ...operation, rawTransaction: "0x01" },
      { ...operation, activeTransactionId: null },
      {
        ...operation,
        transactions: [transaction, { ...transaction, transactionId: operationId }],
      },
    ]) {
      expect(() => parseWalletTransferOperation(malformed)).toThrowError(
        WalletTransferRequestError,
      );
    }
  });

  it("uses authenticated no-store preview and operation reads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).endsWith("/preview") ? success(preview) : success(operation),
      );
    const client = new WalletTransferClient(fetcher);

    await expect(
      client.preview({
        amount: { kind: "preset", preset: "25" },
        asset: { kind: "erc20", tokenAddress },
        chainId: 31337,
        recipient,
        walletId,
      }),
    ).resolves.toEqual(preview);
    await expect(client.operation(operationId)).resolves.toEqual(operation);

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store", credentials: "include" });
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        "Cache-Control": "no-store",
      });
    }
  });

  it("sends the idempotency key through dedicated secret ingress and clears its body", async () => {
    const captured: Array<{ bytes: Uint8Array; during: string }> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const bytes = init?.body as unknown as Uint8Array;
      captured.push({ bytes, during: new TextDecoder().decode(bytes) });
      return success(operation, 202);
    });
    const client = new WalletTransferClient(fetcher);

    await expect(
      client.submit(
        { previewDigest: digest, previewToken: preview.previewToken, walletId },
        "synthetic-transfer-key-001",
        "synthetic-security-password",
      ),
    ).resolves.toEqual(operation);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/wallets/transfers",
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": walletTransferSecretMediaType,
          "Idempotency-Key": "synthetic-transfer-key-001",
        }),
        method: "POST",
      }),
    );
    expect(captured[0]!.during).toContain("synthetic-security-password");
    expect(captured[0]!.bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("preserves stable API errors and never retries a submission", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "internal request and provider details",
            retryable: false,
          },
          success: false,
        }),
        { status: 409 },
      ),
    );
    const client = new WalletTransferClient(fetcher);

    await expect(
      client.submit(
        { previewDigest: digest, previewToken: preview.previewToken, walletId },
        "synthetic-transfer-key-002",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WalletTransferRequestError>>({
        code: "IDEMPOTENCY_CONFLICT",
        retryable: false,
        status: 409,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
