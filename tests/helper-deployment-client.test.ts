import {
  HelperDeploymentClient,
  HelperDeploymentRequestError,
  parseHelperDeploymentOperation,
  parseHelperDeploymentPreview,
} from "../apps/web/src/helper-deployment-client.js";
import { describe, expect, it, vi } from "vitest";

const walletId = "75000000-0000-4000-8000-000000000011";
const operationId = "75000000-0000-4000-8000-000000000021";
const expectedAddress = `0x${"1".repeat(40)}`;
const owner = `0x${"2".repeat(40)}`;
const adapter = `0x${"3".repeat(40)}`;
const permit2 = `0x${"4".repeat(40)}`;
const runtimeHash = `0x${"5".repeat(64)}`;
const previewDigest = `sha256:${"6".repeat(64)}`;
const planDigest = `sha256:${"7".repeat(64)}`;
const transactionHash = `0x${"8".repeat(64)}`;
const previewToken = "A".repeat(43);

const feeLimit = {
  feeCapBaseUnit: "1400000000000000",
  gasLimit: "700000",
  maxFeePerGasBaseUnit: "2000000000",
  maxPriorityFeePerGasBaseUnit: "1000000000",
};

function preview() {
  return {
    chainId: 31_337,
    constructor: { adapter, owner, permit2 },
    expectedAddress,
    expectedRuntimeCodeHash: runtimeHash,
    expiresAt: "2026-08-20T10:01:00.000Z",
    feeLimit,
    helperVersion: "WalletHelperV1",
    nonce: "7",
    previewDigest,
    previewToken,
    registryVersion: "p05-local-helper-v2",
    walletId,
  };
}

function operation() {
  return {
    chainId: 31_337,
    createdAt: "2026-08-20T10:00:00.000Z",
    expectedAddress,
    failureCode: null,
    feeLimit,
    helperVersion: "WalletHelperV1",
    nonce: "7",
    operationId,
    planDigest,
    reconciliationReason: null,
    registryVersion: "p05-local-helper-v2",
    state: "broadcast",
    transactions: [
      { active: true, generation: 0, state: "broadcast", transactionHash },
    ],
    updatedAt: "2026-08-20T10:00:01.000Z",
    walletId,
  };
}

function envelope(data: unknown, status = 200) {
  return Response.json({ data, requestId: "p05-05-client", success: true }, { status });
}

describe("P05-05 helper deployment browser client", () => {
  it("strictly parses preview and operation responses", () => {
    expect(parseHelperDeploymentPreview(preview())).toEqual(preview());
    expect(parseHelperDeploymentOperation(operation())).toEqual(operation());

    expect(() => parseHelperDeploymentPreview({ ...preview(), bytecode: "0x6000" })).toThrowError(
      "HELPER_DEPLOYMENT_RESPONSE_INVALID",
    );
    expect(() =>
      parseHelperDeploymentPreview({
        ...preview(),
        feeLimit: { ...feeLimit, feeCapBaseUnit: "1" },
      }),
    ).toThrowError("HELPER_DEPLOYMENT_RESPONSE_INVALID");
    expect(() =>
      parseHelperDeploymentOperation({
        ...operation(),
        transactions: [
          { active: true, generation: 1, state: "broadcast", transactionHash },
        ],
      }),
    ).toThrowError("HELPER_DEPLOYMENT_RESPONSE_INVALID");
  });

  it("serializes only the fixed request allowlist and keeps duplicate submits identical", async () => {
    const calls: { init?: RequestInit; path: string }[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input);
      calls.push({ init, path });
      return path.endsWith("/preview") ? envelope(preview()) : envelope(operation(), 202);
    });
    const client = new HelperDeploymentClient(fetcher);
    const injectedPreview = {
      bytecode: "0x6000",
      calldata: "0x1234",
      chainId: 31_337,
      helperVersion: "WalletHelperV1",
      selector: "0x12345678",
      target: owner,
      walletId,
    } as const;
    const injectedSubmit = {
      ...injectedPreview,
      previewDigest,
      previewToken,
    } as const;

    await expect(client.preview(injectedPreview)).resolves.toEqual(preview());
    await expect(client.submit(injectedSubmit, "helper-deploy-idempotency-0001")).resolves.toEqual(
      operation(),
    );
    await expect(client.submit(injectedSubmit, "helper-deploy-idempotency-0001")).resolves.toEqual(
      operation(),
    );

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      chainId: 31_337,
      helperVersion: "WalletHelperV1",
      walletId,
    });
    for (const call of calls.slice(1)) {
      expect(JSON.parse(String(call.init?.body))).toEqual({
        chainId: 31_337,
        helperVersion: "WalletHelperV1",
        previewDigest,
        previewToken,
        walletId,
      });
      expect(new Headers(call.init?.headers).get("Idempotency-Key")).toBe(
        "helper-deploy-idempotency-0001",
      );
    }
    expect(JSON.stringify(calls)).not.toMatch(/bytecode|calldata|selector|target/iu);
  });

  it("fails closed on malformed success, server errors, invalid ids, and weak idempotency keys", async () => {
    const malformed = new HelperDeploymentClient(async () =>
      envelope({ ...operation(), chainId: 56 }),
    );
    await expect(malformed.operation(operationId)).rejects.toMatchObject({
      code: "HELPER_DEPLOYMENT_RESPONSE_INVALID",
    });

    const rejected = new HelperDeploymentClient(async () =>
      Response.json(
        { error: { code: "PREVIEW_EXPIRED", retryable: false }, success: false },
        { status: 409 },
      ),
    );
    await expect(
      rejected.preview({ chainId: 31_337, helperVersion: "WalletHelperV1", walletId }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<HelperDeploymentRequestError>>({
        code: "PREVIEW_EXPIRED",
        retryable: false,
        status: 409,
      }),
    );

    await expect(malformed.operation("not-an-operation-id")).rejects.toMatchObject({
      code: "HELPER_DEPLOYMENT_NOT_FOUND",
    });
    await expect(
      malformed.submit(
        { chainId: 31_337, helperVersion: "WalletHelperV1", previewDigest, previewToken, walletId },
        "short",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });

    const network = new HelperDeploymentClient(async () => {
      throw new Error("offline");
    });
    await expect(
      network.preview({ chainId: 31_337, helperVersion: "WalletHelperV1", walletId }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true, status: 0 });
  });
});
