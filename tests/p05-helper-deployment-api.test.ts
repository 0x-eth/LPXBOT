import type { CustodyWallet } from "../packages/api-contract/src/index.js";
import {
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  HelperDeploymentError,
  HelperDeploymentService,
  MemoryHelperDeploymentOperationStore,
  MemoryHelperDeploymentPreviewStore,
  parseHelperDeploymentPreviewRequest,
  parseHelperDeploymentSubmit,
  type HelperDeploymentChainReader,
} from "../apps/api/src/index.js";
import { getContractAddress } from "viem";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-19T16:00:00.000Z");
const tenantId = "local-fixture";
const userId = "9c000000-0000-4000-8000-000000000001";
const walletId = "9c000000-0000-4000-8000-000000000011";
const walletAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const wallet: CustodyWallet = {
  address: walletAddress,
  createdAt: now.toISOString(),
  envelopeVersion: 1,
  lockStatus: "ready",
  mode: "server-kek",
  name: "Helper deployment fixture",
  revision: 1,
  updatedAt: now.toISOString(),
  walletId,
};

class ChainFixture implements HelperDeploymentChainReader {
  nonce = "6";
  expectedAddressCode: `0x${string}` = "0x";
  runtimeHash = `0x${"91".repeat(32)}` as const;
  adapterHash = helperDeploymentComponent("adapter").runtimeCodeHash;

  async nonceSnapshot() {
    return {
      blockHash: `0x${"81".repeat(32)}` as const,
      blockNumber: "6",
      blockTimestamp: now.toISOString(),
      chainId: 31_337,
      views: [
        { latest: this.nonce, pending: this.nonce, providerId: "anvil-a" },
        { latest: this.nonce, pending: this.nonce, providerId: "anvil-b" },
      ],
    };
  }

  async inspectDeployment() {
    const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
    return {
      componentCode: registry.components.map((component) => ({
        ...component,
        runtimeCodeHash:
          component.role === "adapter" ? this.adapterHash : component.runtimeCodeHash,
      })),
      expectedAddressCode: this.expectedAddressCode,
      expectedRuntimeCodeHash: this.runtimeHash,
      feeLimit: {
        feeCapBaseUnit: "2400000",
        gasLimit: "1200000",
        maxFeePerGasBaseUnit: "2",
        maxPriorityFeePerGasBaseUnit: "1",
      },
      tokenCode: registry.tokens.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
    };
  }
}

function fixture(chain = new ChainFixture()) {
  const operations = new MemoryHelperDeploymentOperationStore({
    now: () => now,
    uuid: () => "9c000000-0000-4000-8000-000000000021",
  });
  const service = new HelperDeploymentService({
    chain,
    now: () => now,
    operations,
    previews: new MemoryHelperDeploymentPreviewStore(),
    randomBytes: () => new Uint8Array(32).fill(7),
  });
  return { chain, operations, service };
}

const request = { chainId: 31_337 as const, helperVersion: "WalletHelperV1" as const, walletId };

async function preview(service: HelperDeploymentService, requestedUserId = userId) {
  return service.preview({ request, tenantId, userId: requestedUserId, wallet });
}

describe("P05-05 Helper deployment API domain", () => {
  it("accepts only the server-owned deployment request surface", () => {
    expect(parseHelperDeploymentPreviewRequest(request)).toEqual(request);
    for (const injected of [
      { target: `0x${"11".repeat(20)}` },
      { selector: "0x12345678" },
      { calldata: "0x1234" },
      { bytecode: "0x6000" },
    ]) {
      expect(() => parseHelperDeploymentPreviewRequest({ ...request, ...injected })).toThrowError(
        HelperDeploymentError,
      );
    }
    expect(() => parseHelperDeploymentPreviewRequest({ ...request, chainId: 56 })).toThrowError(
      "CHAIN_NOT_ALLOWED",
    );
    expect(() =>
      parseHelperDeploymentSubmit({
        ...request,
        previewDigest: `sha256:${"0".repeat(64)}`,
        previewToken: "A".repeat(43),
        target: `0x${"11".repeat(20)}`,
      }),
    ).toThrowError("PREVIEW_INVALID");
  });

  it("previews CREATE, submits once, and returns the same operation for a duplicate", async () => {
    const { operations, service } = fixture();
    const value = await preview(service);
    expect(value.expectedAddress).toBe(
      getContractAddress({ from: walletAddress, nonce: 6n }).toLowerCase(),
    );
    expect(value.constructor.owner).toBe(walletAddress);
    expect(value).not.toHaveProperty("bytecode");
    expect(value).not.toHaveProperty("calldata");

    const submitted = await service.submit({
      idempotencyKey: "helper-deploy-key-0001",
      request: { ...request, previewDigest: value.previewDigest, previewToken: value.previewToken },
      requestId: "request-1",
      sessionId: "9c000000-0000-4000-8000-000000000031",
      tenantId,
      userId,
      wallet,
    });
    expect(submitted.created).toBe(true);
    expect(submitted.operation).toMatchObject({ nonce: "6", state: "queued", walletId });
    const stored = await operations.get({
      operationId: submitted.operation.operationId,
      tenantId,
      userId,
    });
    expect(stored?.plan.transaction).toMatchObject({ to: null, valueBaseUnit: "0" });

    const duplicate = await service.submit({
      idempotencyKey: "helper-deploy-key-0001",
      request: { ...request, previewDigest: value.previewDigest, previewToken: value.previewToken },
      requestId: "request-2",
      sessionId: "9c000000-0000-4000-8000-000000000031",
      tenantId,
      userId,
      wallet,
    });
    expect(duplicate).toEqual({ created: false, operation: submitted.operation });
    await expect(
      service.get({ operationId: submitted.operation.operationId, tenantId, userId: "other-user" }),
    ).rejects.toThrow("HELPER_DEPLOYMENT_NOT_FOUND");
  });

  it("rejects payload digest conflicts, tenant token reuse, nonce drift, and occupied addresses", async () => {
    const { chain, service } = fixture();
    const first = await preview(service);
    await service.submit({
      idempotencyKey: "helper-deploy-key-0002",
      request: { ...request, previewDigest: first.previewDigest, previewToken: first.previewToken },
      requestId: "request-1",
      sessionId: "9c000000-0000-4000-8000-000000000031",
      tenantId,
      userId,
      wallet,
    });
    chain.runtimeHash = `0x${"92".repeat(32)}`;
    const changed = await preview(service);
    await expect(
      service.submit({
        idempotencyKey: "helper-deploy-key-0002",
        request: {
          ...request,
          previewDigest: changed.previewDigest,
          previewToken: changed.previewToken,
        },
        requestId: "request-2",
        sessionId: "9c000000-0000-4000-8000-000000000031",
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(
      service.submit({
        idempotencyKey: "helper-deploy-key-0003",
        request: {
          ...request,
          previewDigest: changed.previewDigest,
          previewToken: changed.previewToken,
        },
        requestId: "request-3",
        sessionId: "9c000000-0000-4000-8000-000000000031",
        tenantId: "other-tenant",
        userId,
        wallet,
      }),
    ).rejects.toThrow("PREVIEW_INVALID");

    const driftFixture = fixture();
    const drift = await preview(driftFixture.service);
    driftFixture.chain.nonce = "7";
    await expect(
      driftFixture.service.submit({
        idempotencyKey: "helper-deploy-key-0004",
        request: {
          ...request,
          previewDigest: drift.previewDigest,
          previewToken: drift.previewToken,
        },
        requestId: "request-4",
        sessionId: "9c000000-0000-4000-8000-000000000031",
        tenantId,
        userId,
        wallet,
      }),
    ).rejects.toThrow("NONCE_DRIFT");

    const occupiedFixture = fixture();
    occupiedFixture.chain.expectedAddressCode = "0x6000";
    await expect(preview(occupiedFixture.service)).rejects.toThrow("HELPER_ADDRESS_OCCUPIED");
  });

  it("fails closed on component code hash and locked or cross-wallet access", async () => {
    const mismatch = fixture();
    mismatch.chain.adapterHash = `0x${"ff".repeat(32)}`;
    await expect(preview(mismatch.service)).rejects.toThrow("HELPER_CODE_IDENTITY_MISMATCH");

    const { service } = fixture();
    await expect(
      service.preview({ request, tenantId, userId, wallet: { ...wallet, lockStatus: "locked" } }),
    ).rejects.toThrow("WALLET_LOCKED");
    await expect(
      service.preview({
        request,
        tenantId,
        userId,
        wallet: { ...wallet, walletId: crypto.randomUUID() },
      }),
    ).rejects.toThrow("WALLET_NOT_FOUND");
  });
});
