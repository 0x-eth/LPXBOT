import type {
  LocalSwapExecutePreview,
  LocalSwapExecutionOperation,
  LocalSwapQuoteView,
} from "../packages/api-contract/src/index.js";
import {
  LocalSwapExecutionClient,
  LocalSwapExecutionRequestError,
  parseLocalSwapExecutePreview,
  parseLocalSwapExecutionOperation,
  parseLocalSwapQuoteView,
} from "../apps/web/src/local-swap-execution-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "76000000-0000-4000-8000-000000000011";
const operationId = "76000000-0000-4000-8000-000000000021";
const walletAddress = `0x${"1".repeat(40)}` as const;
const helperAddress = `0x${"2".repeat(40)}` as const;
const tokenIn = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const tokenOut = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const quoteDigest = `sha256:${"3".repeat(64)}` as const;
const previewDigest = `sha256:${"4".repeat(64)}` as const;
const planDigest = `sha256:${"5".repeat(64)}` as const;
const previewToken = "A".repeat(43);
const transactionHash = `0x${"6".repeat(64)}` as const;
const replacementHash = `0x${"7".repeat(64)}` as const;

const feeLimit = {
  feeCapBaseUnit: "100000000000000",
  gasLimit: "50000",
  maxFeePerGasBaseUnit: "2000000000",
  maxPriorityFeePerGasBaseUnit: "1000000000",
};

function quote(): LocalSwapQuoteView {
  return {
    amountInBaseUnit: "1000",
    amountOutBaseUnit: "2000",
    blockNumber: "100",
    chainId: 31_337,
    deadline: "2026-08-20T08:01:30.000Z",
    executionEnabled: true,
    expiresAt: "2026-08-20T08:00:30.000Z",
    gas: {
      estimatedFeeBaseUnit: "400000000000000",
      gasLimit: "200000",
      maxFeePerGasBaseUnit: "2000000000",
      maxPriorityFeePerGasBaseUnit: "1000000000",
    },
    helperAddress,
    maxBlockNumber: "105",
    minOutBaseUnit: "1990",
    quoteDigest,
    quoteVersion: "p05-local-swap-quote-v2",
    quotedAt: "2026-08-20T08:00:00.000Z",
    registryVersion: "p05-local-swap-execution-v2",
    serviceFeeBps: 0,
    slippageBps: 50,
    tokenIn,
    tokenOut,
    walletAddress,
    walletId,
  };
}

function preview(): LocalSwapExecutePreview {
  return {
    authorizationMode: "direct",
    chainId: 31_337,
    deadline: "2026-08-20T08:01:30.000Z",
    expiresAt: "2026-08-20T08:00:20.000Z",
    feeLimitTotalBaseUnit: "300000000000000",
    helperAddress,
    minOutBaseUnit: "1990",
    previewDigest,
    previewToken,
    quoteDigest,
    serviceFeeBps: 0,
    steps: [
      { amountBaseUnit: "1000", feeLimit, kind: "approve", ordinal: 0 },
      { amountBaseUnit: "1000", feeLimit, kind: "swap", ordinal: 1 },
      { amountBaseUnit: "0", feeLimit, kind: "cleanup", ordinal: 2 },
    ],
    walletId,
  };
}

function operation(): LocalSwapExecutionOperation {
  return {
    authorizationMode: "direct",
    chainId: 31_337,
    createdAt: "2026-08-20T08:00:01.000Z",
    failureCode: null,
    helperAddress,
    operationId,
    operationKind: "local-swap",
    planDigest,
    quoteDigest,
    reconciliationReason: null,
    registryVersion: "p05-local-swap-execution-v2",
    state: "pending",
    steps: [
      {
        failureCode: null,
        feeLimit,
        kind: "approve",
        nonce: "7",
        ordinal: 0,
        state: "succeeded",
        stepId: "76000000-0000-4000-8000-000000000031",
        transactions: [
          {
            active: true,
            generation: 0,
            maxFeePerGasBaseUnit: "2000000000",
            maxPriorityFeePerGasBaseUnit: "1000000000",
            state: "succeeded",
            transactionHash,
          },
        ],
      },
      {
        failureCode: null,
        feeLimit,
        kind: "swap",
        nonce: "8",
        ordinal: 1,
        state: "pending",
        stepId: "76000000-0000-4000-8000-000000000032",
        transactions: [
          {
            active: false,
            generation: 0,
            maxFeePerGasBaseUnit: "2000000000",
            maxPriorityFeePerGasBaseUnit: "1000000000",
            state: "replaced",
            transactionHash,
          },
          {
            active: true,
            generation: 1,
            maxFeePerGasBaseUnit: "2500000000",
            maxPriorityFeePerGasBaseUnit: "1250000000",
            state: "pending",
            transactionHash: replacementHash,
          },
        ],
      },
      {
        failureCode: null,
        feeLimit,
        kind: "cleanup",
        nonce: "9",
        ordinal: 2,
        state: "blocked",
        stepId: "76000000-0000-4000-8000-000000000033",
        transactions: [],
      },
    ],
    updatedAt: "2026-08-20T08:00:03.000Z",
    walletId,
  };
}

function envelope(data: unknown, status = 200) {
  return Response.json({ data, requestId: "p05-06-client", success: true }, { status });
}

describe("P05-06 local Swap execution browser client", () => {
  it("strictly parses quote, preview, ordered steps, and replacement lineage", () => {
    expect(parseLocalSwapQuoteView(quote())).toEqual(quote());
    expect(parseLocalSwapExecutePreview(preview())).toEqual(preview());
    expect(parseLocalSwapExecutionOperation(operation())).toEqual(operation());

    for (const malformed of [
      { ...quote(), router: helperAddress },
      { ...quote(), executionEnabled: false },
      { ...quote(), registryVersion: "p05-bsc-execution-v1" },
      {
        ...quote(),
        gas: { ...quote().gas, estimatedFeeBaseUnit: "1" },
      },
    ]) {
      expect(() => parseLocalSwapQuoteView(malformed)).toThrowError("LOCAL_SWAP_RESPONSE_INVALID");
    }

    expect(() =>
      parseLocalSwapExecutePreview({
        ...preview(),
        steps: [preview().steps[1], preview().steps[0], preview().steps[2]],
      }),
    ).toThrowError("LOCAL_SWAP_RESPONSE_INVALID");
    expect(() =>
      parseLocalSwapExecutePreview({ ...preview(), feeLimitTotalBaseUnit: "1" }),
    ).toThrowError("LOCAL_SWAP_RESPONSE_INVALID");
    expect(() =>
      parseLocalSwapExecutionOperation({
        ...operation(),
        steps: operation().steps.map((step, index) =>
          index === 2 ? { ...step, nonce: "10" } : step,
        ),
      }),
    ).toThrowError("LOCAL_SWAP_RESPONSE_INVALID");
    expect(() =>
      parseLocalSwapExecutionOperation({
        ...operation(),
        steps: operation().steps.map((step, index) =>
          index === 1
            ? {
                ...step,
                transactions: step.transactions.map((transaction) => ({
                  ...transaction,
                  active: transaction.generation === 0,
                })),
              }
            : step,
        ),
      }),
    ).toThrowError("LOCAL_SWAP_RESPONSE_INVALID");
  });

  it("sends only the fixed request allowlists with stable idempotency and reauthentication", async () => {
    const calls: Array<{ body: unknown; headers: Headers; path: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      calls.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: new Headers(init?.headers),
        path,
      });
      if (path === "/api/swap/quote") return envelope(quote());
      if (path.endsWith("/preview")) return envelope(preview());
      return envelope(operation(), path.startsWith("/api/chain-operations/") ? 200 : 202);
    });
    const client = new LocalSwapExecutionClient(fetcher, () => "fresh-proof");
    const injected = {
      amountInBaseUnit: "1000",
      calldata: "0x1234",
      chainId: 31_337,
      router: helperAddress,
      selector: "0x12345678",
      slippageBps: 50,
      spender: helperAddress,
      target: helperAddress,
      tokenIn,
      tokenOut,
      walletId,
    } as const;

    await expect(client.quote(injected)).resolves.toEqual(quote());
    await expect(
      client.preview({
        authorizationMode: "direct",
        quoteDigest,
        target: helperAddress,
        walletId,
      } as never),
    ).resolves.toEqual(preview());
    const executeRequest = {
      authorizationMode: "direct",
      calldata: "0x1234",
      previewDigest,
      previewToken,
      quoteDigest,
      target: helperAddress,
      walletId,
    } as const;
    await expect(client.execute(executeRequest, "local-swap-idempotency-0001")).resolves.toEqual(
      operation(),
    );
    await expect(client.execute(executeRequest, "local-swap-idempotency-0001")).resolves.toEqual(
      operation(),
    );
    await expect(client.operation(operationId)).resolves.toEqual(operation());

    expect(calls.map(({ body }) => body)).toEqual([
      {
        amountInBaseUnit: "1000",
        chainId: 31_337,
        slippageBps: 50,
        tokenIn,
        tokenOut,
        walletId,
      },
      { authorizationMode: "direct", quoteDigest, walletId },
      { authorizationMode: "direct", previewDigest, previewToken, quoteDigest, walletId },
      { authorizationMode: "direct", previewDigest, previewToken, quoteDigest, walletId },
      null,
    ]);
    expect(calls[2]!.headers.get("Idempotency-Key")).toBe("local-swap-idempotency-0001");
    expect(calls[3]!.headers.get("Idempotency-Key")).toBe("local-swap-idempotency-0001");
    expect(calls[2]!.headers.get("X-LPBOT-Reauthentication")).toBe("fresh-proof");
    expect(JSON.stringify(calls.map(({ body }) => body))).not.toMatch(
      /target|router|spender|selector|calldata/iu,
    );
  });

  it("fails closed on invalid responses, request errors, ids, keys, and network ambiguity", async () => {
    const malformed = new LocalSwapExecutionClient(async () =>
      envelope({ ...operation(), chainId: 56 }),
    );
    await expect(malformed.operation(operationId)).rejects.toMatchObject({
      code: "LOCAL_SWAP_RESPONSE_INVALID",
    });
    await expect(malformed.operation("not-an-operation-id")).rejects.toMatchObject({
      code: "LOCAL_SWAP_NOT_FOUND",
    });
    await expect(
      malformed.execute(
        { authorizationMode: "direct", previewDigest, previewToken, quoteDigest, walletId },
        "short",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });

    const rejected = new LocalSwapExecutionClient(async () =>
      Response.json(
        { error: { code: "QUOTE_EXPIRED", retryable: false }, success: false },
        { status: 409 },
      ),
    );
    await expect(
      rejected.preview({ authorizationMode: "direct", quoteDigest, walletId }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LocalSwapExecutionRequestError>>({
        code: "QUOTE_EXPIRED",
        retryable: false,
        status: 409,
      }),
    );

    const network = new LocalSwapExecutionClient(async () => {
      throw new Error("offline");
    });
    await expect(network.quote(quote())).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
      status: 0,
    });
  });
});
