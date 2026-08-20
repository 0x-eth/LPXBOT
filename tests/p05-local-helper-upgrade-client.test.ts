import { describe, expect, it, vi } from "vitest";

import type {
  LocalHelperUpgradeOperation,
  LocalHelperUpgradePreview,
} from "../packages/api-contract/src/index.js";
import {
  LocalHelperUpgradeClient,
  LocalHelperUpgradeRequestError,
  parseLocalHelperUpgradeOperation,
  parseLocalHelperUpgradePreview,
} from "../apps/web/src/local-helper-upgrade-client.js";

const walletId = "9c000000-0000-4000-8000-000000000001";
const operationId = "9c000000-0000-4000-8000-000000000002";
const sourceBindingId = "9c000000-0000-4000-8000-000000000003";
const transaction0 = "9c000000-0000-4000-8000-000000000004";
const transaction1 = "9c000000-0000-4000-8000-000000000005";
const sourceAddress = `0x${"11".repeat(20)}` as const;
const targetAddress = `0x${"22".repeat(20)}` as const;
const digest = `sha256:${"33".repeat(32)}` as const;
const transactionHash0 = `0x${"44".repeat(32)}` as const;
const transactionHash1 = `0x${"55".repeat(32)}` as const;
const cursors = [
  "preflight",
  "deploy-v2",
  "verify-v2",
  "sweep-v1",
  "final-rescan-v1",
  "atomic-binding-switch",
  "completed",
] as const;

const preview: LocalHelperUpgradePreview = {
  blockers: [],
  chainId: 31_337,
  expectedTargetAddress: targetAddress,
  expectedTargetRuntimeCodeHash: `0x${"66".repeat(32)}`,
  expiresAt: "2026-08-21T00:05:00.000Z",
  feeLimit: {
    feeCapBaseUnit: "4000000",
    gasLimit: "1000000",
    maxFeePerGasBaseUnit: "4",
    maxPriorityFeePerGasBaseUnit: "1",
  },
  nonce: "7",
  previewDigest: digest,
  previewToken: "A".repeat(43),
  registryVersion: "p05-local-helper-upgrade-v3",
  residual: {
    allowanceCount: 0,
    balancesAboveDust: 1,
    nftCustodyCount: 0,
    unknownTokenCount: 0,
  },
  sourceHelperAddress: sourceAddress,
  steps: [...cursors],
  upgradeable: true,
  versions: {
    comparison: "upgrade-available",
    source: "WalletHelperV1",
    target: "WalletHelperV2",
  },
  walletId,
};

const operation: LocalHelperUpgradeOperation = {
  chainId: 31_337,
  createdAt: "2026-08-21T00:00:00.000Z",
  cursor: "completed",
  expectedTargetAddress: targetAddress,
  failureCode: null,
  manualRecovery: { blockers: [], required: false },
  nonce: "7",
  operationId,
  planDigest: digest,
  registryVersion: "p05-local-helper-upgrade-v3",
  sourceBindingId,
  sourceHelperAddress: sourceAddress,
  state: "completed",
  steps: cursors.map((cursor) => ({
    cursor,
    failureCode: null,
    state: "succeeded",
    updatedAt: "2026-08-21T00:01:00.000Z",
  })),
  sweepBatchId: "9c000000-0000-4000-8000-000000000006",
  transactions: [
    {
      active: false,
      generation: 0,
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
      state: "replaced",
      transactionHash: transactionHash0,
      transactionId: transaction0,
    },
    {
      active: true,
      generation: 1,
      maxFeePerGasBaseUnit: "3",
      maxPriorityFeePerGasBaseUnit: "1",
      state: "confirmed",
      transactionHash: transactionHash1,
      transactionId: transaction1,
    },
  ],
  updatedAt: "2026-08-21T00:02:00.000Z",
  versions: {
    comparison: "upgrade-available",
    source: "WalletHelperV1",
    target: "WalletHelperV2",
  },
  walletId,
};

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: "request-p05-09", success: true }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("P05-09 local Helper upgrade web client", () => {
  it("strictly validates version, cursor, residual, and lineage responses", () => {
    expect(parseLocalHelperUpgradePreview(preview)).toEqual(preview);
    expect(parseLocalHelperUpgradeOperation(operation)).toEqual(operation);
    expect(() => parseLocalHelperUpgradePreview({ ...preview, calldata: "0x1234" })).toThrow(
      "HELPER_UPGRADE_RESPONSE_INVALID",
    );
    expect(() =>
      parseLocalHelperUpgradeOperation({
        ...operation,
        transactions: [operation.transactions[0], { ...operation.transactions[1], generation: 2 }],
      }),
    ).toThrow("HELPER_UPGRADE_RESPONSE_INVALID");
  });

  it("accepts manual recovery only with blockers and no completed cursor", () => {
    const manual = {
      ...operation,
      cursor: "final-rescan-v1",
      manualRecovery: { blockers: ["NON_ZERO_ALLOWANCE"], required: true },
      state: "manual-recovery-required",
    } as const;
    expect(parseLocalHelperUpgradeOperation(manual).manualRecovery.required).toBe(true);
    expect(() =>
      parseLocalHelperUpgradeOperation({
        ...manual,
        manualRecovery: { blockers: [], required: true },
      }),
    ).toThrow("HELPER_UPGRADE_RESPONSE_INVALID");
  });

  it("submits only the preview capability fields with reauthentication and idempotency", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        "chainId",
        "previewDigest",
        "previewToken",
        "walletId",
      ]);
      expect(body).not.toHaveProperty("bytecode");
      expect(body).not.toHaveProperty("calldata");
      expect(body).not.toHaveProperty("helperAddress");
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
        "local-helper-upgrade-idempotency-0001",
      );
      expect(new Headers(init?.headers).get("X-LPBOT-Reauthentication")).toBe("fresh-proof");
      return success(operation, 202);
    });
    const client = new LocalHelperUpgradeClient(fetcher, () => "fresh-proof");
    await expect(
      client.submit(
        {
          chainId: 31_337,
          previewDigest: preview.previewDigest,
          previewToken: preview.previewToken,
          walletId,
        },
        "local-helper-upgrade-idempotency-0001",
      ),
    ).resolves.toEqual(operation);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/wallets/helper/upgrade",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps latest and explicit operation queries same-origin and fail-closed", async () => {
    const paths: string[] = [];
    const client = new LocalHelperUpgradeClient(async (input) => {
      paths.push(String(input));
      return success(operation);
    });
    await client.latest(walletId);
    await client.operation(operationId);
    expect(paths).toEqual([
      `/api/wallets/${walletId}/helper-upgrade`,
      `/api/helper-upgrades/${operationId}`,
    ]);
    await expect(client.operation("not-an-operation")).rejects.toMatchObject({
      code: "HELPER_UPGRADE_NOT_FOUND",
    } satisfies Partial<LocalHelperUpgradeRequestError>);
  });
});
