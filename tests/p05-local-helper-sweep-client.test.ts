import type {
  LocalHelperResidualSnapshot,
  LocalHelperSweepBatch,
  LocalHelperSweepOperation,
  LocalHelperSweepPreview,
} from "../packages/api-contract/src/index.js";
import {
  LocalHelperSweepClient,
  parseLocalHelperResidualSnapshot,
  parseLocalHelperSweepBatch,
  parseLocalHelperSweepOperation,
  parseLocalHelperSweepPreview,
} from "../apps/web/src/local-helper-sweep-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "a8500000-0000-4000-8000-000000000001";
const bindingId = "a8500000-0000-4000-8000-000000000002";
const batchId = "a8500000-0000-4000-8000-000000000003";
const nativeOperationId = "a8500000-0000-4000-8000-000000000004";
const tokenOperationId = "a8500000-0000-4000-8000-000000000005";
const walletAddress = `0x${"1".repeat(40)}` as const;
const helperAddress = `0x${"2".repeat(40)}` as const;
const adapterAddress = `0x${"3".repeat(40)}` as const;
const permit2Address = `0x${"4".repeat(40)}` as const;
const tokenAddress = "0x5fbdb2315678afecb367f032d93f642f64180aa3" as const;
const wbnbAddress = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512" as const;
const runtimeHash = `0x${"5".repeat(64)}` as const;
const blockHash = `0x${"6".repeat(64)}` as const;
const transactionHash = `0x${"7".repeat(64)}` as const;
const replacementHash = `0x${"8".repeat(64)}` as const;
const snapshotDigest = `sha256:${"9".repeat(64)}` as const;
const previewDigest = `sha256:${"a".repeat(64)}` as const;
const planDigest = `sha256:${"b".repeat(64)}` as const;
const registryDigest = `sha256:${"c".repeat(64)}` as const;
const previewToken = "A".repeat(43);

const feeLimit = {
  feeCapBaseUnit: "400000000000000",
  gasLimit: "100000",
  maxFeePerGasBaseUnit: "4000000000",
  maxPriorityFeePerGasBaseUnit: "2000000000",
};

function snapshot(): LocalHelperResidualSnapshot {
  return {
    allowances: [],
    balances: [
      {
        amountBaseUnit: "2000",
        assetId: "native:31337",
        dustBaseUnit: "1000",
        fixture: null,
        kind: "native",
        runtimeCodeHash: null,
        tokenAddress: null,
      },
      {
        amountBaseUnit: "20",
        assetId: `token:${tokenAddress}`,
        dustBaseUnit: "0",
        fixture: "TestOnlyERC20",
        kind: "token",
        runtimeCodeHash: runtimeHash,
        tokenAddress,
      },
      {
        amountBaseUnit: "30",
        assetId: `token:${wbnbAddress}`,
        dustBaseUnit: "0",
        fixture: "TestOnlyWBNB",
        kind: "token",
        runtimeCodeHash: runtimeHash,
        tokenAddress: wbnbAddress,
      },
    ],
    binding: {
      adapterAddress,
      bindingId,
      deploymentRegistryVersion: "p05-local-helper-deployment-v2",
      helperAddress,
      helperVersion: "WalletHelperV1",
      ownerAddress: walletAddress,
      permit2Address,
      runtimeCodeHash: runtimeHash,
      state: "degraded",
      verifiedBlockNumber: "99",
      walletId,
    },
    block: {
      hash: blockHash,
      number: "100",
      timestamp: "2099-08-20T07:59:59.000Z",
    },
    chainId: 31_337,
    coverage: {
      allowancesComplete: true,
      complete: true,
      helperIdentityComplete: true,
      nftCustodyComplete: true,
      tokenInventoryComplete: true,
    },
    degradationReasons: ["residual-above-dust"],
    expiresAt: "2099-08-20T08:10:00.000Z",
    identity: {
      bindingMatches: true,
      componentsMatch: true,
      observedOwner: walletAddress,
      observedRuntimeCodeHash: runtimeHash,
      ownerMatches: true,
      registryMatches: true,
      runtimeMatches: true,
      tokensMatch: true,
    },
    manualRecoveryRequired: false,
    nftCustody: [],
    observedAt: "2099-08-20T08:00:00.000Z",
    registry: { digest: registryDigest, version: "p05-local-helper-sweep-v2" },
    schemaVersion: 2,
    snapshotDigest,
    snapshotVersion: "p05-local-helper-residual-snapshot-v2",
    unknownTokens: [],
    wallet: { address: walletAddress, walletId },
  };
}

function preview(): LocalHelperSweepPreview {
  return {
    assets: [
      {
        amountBaseUnit: "2000",
        assetId: "native:31337",
        dustBaseUnit: "1000",
        feeLimit,
        kind: "native",
        recipient: walletAddress,
        tokenAddress: null,
      },
      {
        amountBaseUnit: "20",
        assetId: `token:${tokenAddress}`,
        dustBaseUnit: "0",
        feeLimit,
        kind: "token",
        recipient: walletAddress,
        tokenAddress,
      },
    ],
    chainId: 31_337,
    deadline: "2099-08-20T08:05:00.000Z",
    expiresAt: "2099-08-20T08:02:00.000Z",
    feeLimitTotalBaseUnit: "800000000000000",
    helperAddress,
    manualRecoveryRequired: false,
    previewDigest,
    previewToken,
    recipient: walletAddress,
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest,
    walletId,
  };
}

function operation(
  operationId: string,
  assetId: string,
  nonce: string,
  kind: "native" | "token",
): LocalHelperSweepOperation {
  return {
    amountBaseUnit: kind === "native" ? "2000" : "20",
    assetId,
    assetKind: kind,
    batchId,
    chainId: 31_337,
    createdAt: "2099-08-20T08:00:01.000Z",
    failureCode: null,
    feeLimit,
    helperAddress,
    nonce,
    operationId,
    operationKind: "helper-residual-sweep",
    planDigest,
    recipient: walletAddress,
    reconciliationReason: null,
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest,
    state: "pending",
    tokenAddress: kind === "native" ? null : tokenAddress,
    transactions: [
      {
        active: false,
        generation: 0,
        maxFeePerGasBaseUnit: "4000000000",
        maxPriorityFeePerGasBaseUnit: "2000000000",
        state: "replaced",
        transactionHash,
      },
      {
        active: true,
        generation: 1,
        maxFeePerGasBaseUnit: "5000000000",
        maxPriorityFeePerGasBaseUnit: "2500000000",
        state: "pending",
        transactionHash: replacementHash,
      },
    ],
    updatedAt: "2099-08-20T08:00:03.000Z",
    walletId,
  };
}

function batch(): LocalHelperSweepBatch {
  return {
    batchId,
    chainId: 31_337,
    createdAt: "2099-08-20T08:00:01.000Z",
    helperAddress,
    operations: [
      operation(nativeOperationId, "native:31337", "7", "native"),
      operation(tokenOperationId, `token:${tokenAddress}`, "8", "token"),
    ],
    registryVersion: "p05-local-helper-sweep-v2",
    snapshotDigest,
    state: "running",
    updatedAt: "2099-08-20T08:00:03.000Z",
    walletId,
  };
}

function envelope(data: unknown, status = 200) {
  return Response.json({ data, requestId: "p05-08-client", success: true }, { status });
}

describe("P05-08 local Helper sweep browser client", () => {
  it("strictly parses snapshot, preview, per-asset lineage, and single-helper batch", () => {
    expect(parseLocalHelperResidualSnapshot(snapshot())).toEqual(snapshot());
    expect(parseLocalHelperSweepPreview(preview())).toEqual(preview());
    expect(parseLocalHelperSweepOperation(batch().operations[0])).toEqual(batch().operations[0]);
    expect(parseLocalHelperSweepBatch(batch())).toEqual(batch());

    expect(() =>
      parseLocalHelperResidualSnapshot({ ...snapshot(), target: helperAddress }),
    ).toThrow("LOCAL_HELPER_SWEEP_RESPONSE_INVALID");
    expect(() =>
      parseLocalHelperResidualSnapshot({
        ...snapshot(),
        balances: [snapshot().balances[0], snapshot().balances[0], snapshot().balances[2]],
      }),
    ).toThrow("LOCAL_HELPER_SWEEP_RESPONSE_INVALID");
    expect(() =>
      parseLocalHelperResidualSnapshot({ ...snapshot(), manualRecoveryRequired: true }),
    ).toThrow("LOCAL_HELPER_SWEEP_RESPONSE_INVALID");
    expect(() => parseLocalHelperSweepPreview({ ...preview(), calldata: "0x1234" })).toThrow(
      "LOCAL_HELPER_SWEEP_RESPONSE_INVALID",
    );
    expect(() =>
      parseLocalHelperSweepPreview({ ...preview(), feeLimitTotalBaseUnit: "1" }),
    ).toThrow("LOCAL_HELPER_SWEEP_RESPONSE_INVALID");
    expect(() =>
      parseLocalHelperSweepBatch({
        ...batch(),
        operations: batch().operations.map((item, index) =>
          index === 1 ? { ...item, walletId: bindingId } : item,
        ),
      }),
    ).toThrow("LOCAL_HELPER_SWEEP_RESPONSE_INVALID");
  });

  it("sends only fixed request allowlists with stable idempotency and reauthentication", async () => {
    const calls: Array<{ body: unknown; headers: Headers; method: string; path: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      calls.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: new Headers(init?.headers),
        method: init?.method ?? "GET",
        path,
      });
      if (path.includes("helper-residuals?")) return envelope(snapshot());
      if (path.endsWith("/scan")) return envelope(snapshot());
      if (path.endsWith("/preview")) return envelope(preview());
      if (path.startsWith("/api/chain-operation-batches/")) return envelope(batch());
      if (path.startsWith("/api/chain-operations/")) return envelope(batch().operations[0]);
      return envelope(batch(), 202);
    });
    const client = new LocalHelperSweepClient(fetcher, () => "fresh-proof");
    const injected = {
      amount: "999999",
      assetIds: ["native:31337", `token:${tokenAddress}`],
      calldata: "0x1234",
      chainId: 31_337,
      fee: feeLimit,
      helper: helperAddress,
      recipient: helperAddress,
      selector: "0x12345678",
      snapshotDigest,
      target: helperAddress,
      token: wbnbAddress,
      walletId,
    } as const;

    await expect(client.latest(walletId)).resolves.toEqual(snapshot());
    await expect(
      client.scan({
        ...injected,
        idempotencyKey: "local-helper-scan-client-0001",
      } as never),
    ).resolves.toEqual(snapshot());
    await expect(client.preview(injected as never)).resolves.toEqual(preview());
    const sweepRequest = {
      ...injected,
      previewDigest,
      previewToken,
    } as const;
    await expect(
      client.sweep(sweepRequest as never, "local-helper-client-sweep-0001"),
    ).resolves.toEqual(batch());
    await expect(
      client.sweep(sweepRequest as never, "local-helper-client-sweep-0001"),
    ).resolves.toEqual(batch());
    await expect(client.batch(batchId)).resolves.toEqual(batch());
    await expect(client.operation(nativeOperationId)).resolves.toEqual(batch().operations[0]);

    expect(calls.map(({ body }) => body)).toEqual([
      null,
      {
        chainId: 31_337,
        idempotencyKey: "local-helper-scan-client-0001",
        walletId,
      },
      {
        assetIds: ["native:31337", `token:${tokenAddress}`],
        chainId: 31_337,
        snapshotDigest,
        walletId,
      },
      {
        assetIds: ["native:31337", `token:${tokenAddress}`],
        chainId: 31_337,
        previewDigest,
        previewToken,
        snapshotDigest,
        walletId,
      },
      {
        assetIds: ["native:31337", `token:${tokenAddress}`],
        chainId: 31_337,
        previewDigest,
        previewToken,
        snapshotDigest,
        walletId,
      },
      null,
      null,
    ]);
    expect(calls.map(({ method }) => method)).toEqual([
      "GET",
      "POST",
      "POST",
      "POST",
      "POST",
      "GET",
      "GET",
    ]);
    expect(calls[3]?.headers.get("Idempotency-Key")).toBe("local-helper-client-sweep-0001");
    expect(calls[4]?.headers.get("Idempotency-Key")).toBe("local-helper-client-sweep-0001");
    expect(calls[3]?.headers.get("X-LPBOT-Reauthentication")).toBe("fresh-proof");
    expect(JSON.stringify(calls.map(({ body }) => body))).not.toMatch(
      /"(?:helper|token|target|selector|calldata|amount|recipient|fee)"\s*:/u,
    );
  });
});
