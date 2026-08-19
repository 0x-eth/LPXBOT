import {
  buildWalletHelperV1DeploymentMaterial,
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
} from "../packages/chain-registry/src/index.js";
import {
  HELPER_DEPLOYMENT_PLAN_VERSION,
  helperDeploymentPlanDigest,
  type HelperDeploymentPlan,
} from "../packages/domain/src/helper-deployment.js";
import {
  decideHelperDeploymentObservation,
  replacementHelperDeploymentPlan,
  type HelperDeploymentObservation,
  type HelperDeploymentReceiptObservation,
  type HelperDeploymentWorkOperation,
} from "../apps/worker/src/index.js";
import { getContractAddress } from "viem";
import { describe, expect, it } from "vitest";

const now = new Date("2026-08-20T01:00:00.000Z");
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;
const walletId = "a0000000-0000-4000-8000-000000000011";
const operationId = "a0000000-0000-4000-8000-000000000021";
const transactionHash = `0x${"11".repeat(32)}` as const;

function plan(): HelperDeploymentPlan {
  const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
  const material = buildWalletHelperV1DeploymentMaterial(owner);
  const value: HelperDeploymentPlan = {
    chainId: 31_337,
    deadline: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
    deployment: {
      adapter: helperDeploymentComponent("adapter").address,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.helperTemplate.creationCodeHash,
      expectedAddress: getContractAddress({
        from: owner,
        nonce: 6n,
      }).toLowerCase() as `0x${string}`,
      expectedRuntimeCodeHash: `0x${"91".repeat(32)}`,
      helperVersion: "WalletHelperV1",
      owner,
      permit2: helperDeploymentComponent("permit2").address,
      tokenA: {
        address: registry.tokens[0].address,
        runtimeCodeHash: registry.tokens[0].runtimeCodeHash,
      },
      tokenB: {
        address: registry.tokens[1].address,
        runtimeCodeHash: registry.tokens[1].runtimeCodeHash,
      },
    },
    feeLimit: {
      feeCapBaseUnit: "2400000",
      gasLimit: "1200000",
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
    },
    fencingToken: "1",
    nonce: "6",
    operationId,
    planDigest: `sha256:${"0".repeat(64)}`,
    planVersion: HELPER_DEPLOYMENT_PLAN_VERSION,
    registry: {
      blockNumber: "6",
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      version: registry.registryVersion,
    },
    schemaVersion: 2,
    snapshotDigest: `sha256:${"a".repeat(64)}`,
    transaction: {
      data: material.initCode,
      dataHash: material.initCodeHash,
      to: null,
      valueBaseUnit: "0",
    },
    wallet: { address: owner, walletId },
  };
  value.planDigest = helperDeploymentPlanDigest(value);
  return value;
}

function operation(state: HelperDeploymentWorkOperation["state"] = "pending") {
  const deploymentPlan = plan();
  return {
    activeTransaction: {
      generation: 0,
      maxFeePerGasBaseUnit: "2",
      maxPriorityFeePerGasBaseUnit: "1",
      state: "pending" as const,
      transactionHash,
      transactionId: "a0000000-0000-4000-8000-000000000031",
      updatedAt: new Date(now.getTime() - 20 * 60 * 1_000).toISOString(),
    },
    operationId,
    plan: deploymentPlan,
    planDigest: deploymentPlan.planDigest,
    state,
    tenantId: "tenant-fixture-01",
    transactionLineage: [
      {
        generation: 0,
        transactionHash,
        transactionId: "a0000000-0000-4000-8000-000000000031",
        updatedAt: new Date(now.getTime() - 20 * 60 * 1_000).toISOString(),
      },
    ],
    userId: "a0000000-0000-4000-8000-000000000001",
  } satisfies HelperDeploymentWorkOperation;
}

function receipt(
  overrides: Partial<HelperDeploymentReceiptObservation> = {},
): HelperDeploymentReceiptObservation {
  const deploymentPlan = plan();
  return {
    blockCanonical: true,
    blockHash: `0x${"22".repeat(32)}`,
    blockNumber: "10",
    confirmations: "2",
    constructorReconciled: true,
    contractAddress: deploymentPlan.deployment.expectedAddress,
    contractAddressReconciled: true,
    observedAdapter: deploymentPlan.deployment.adapter,
    observedOwner: owner,
    observedPermit2: deploymentPlan.deployment.permit2,
    ownerReconciled: true,
    receiptStatus: "success",
    runtimeCodeHash: deploymentPlan.deployment.expectedRuntimeCodeHash,
    runtimeCodeReconciled: true,
    transactionHash,
    ...overrides,
  };
}

function observation(input: {
  latest?: string;
  pending?: string;
  receipt?: HelperDeploymentReceiptObservation | null;
  transactionFound?: boolean;
}): HelperDeploymentObservation {
  return {
    providers: [
      {
        latestNonce: input.latest ?? "6",
        pendingNonce: input.pending ?? "6",
        providerId: "anvil-a",
        receipt: input.receipt ?? null,
        transactionFound: input.transactionFound ?? false,
      },
    ],
  };
}

describe("P05-05 Helper deployment recovery decisions", () => {
  it("distinguishes pending, dropped, and nonce-consumed reconciliation", () => {
    const pending = decideHelperDeploymentObservation({
      dropAfterMilliseconds: 15 * 60 * 1_000,
      now: new Date(now.getTime() - 10 * 60 * 1_000),
      observation: observation({ transactionFound: true }),
      operation: operation(),
      requiredConfirmations: 2,
    });
    expect(pending).toMatchObject({ kind: "transition", state: "pending" });

    const dropped = decideHelperDeploymentObservation({
      dropAfterMilliseconds: 15 * 60 * 1_000,
      now,
      observation: observation({}),
      operation: operation(),
      requiredConfirmations: 2,
    });
    expect(dropped).toEqual({ kind: "transition", reason: null, state: "dropped" });

    const consumed = decideHelperDeploymentObservation({
      dropAfterMilliseconds: 15 * 60 * 1_000,
      now,
      observation: observation({ latest: "7", pending: "7" }),
      operation: operation(),
      requiredConfirmations: 2,
    });
    expect(consumed).toMatchObject({
      kind: "transition",
      reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
      state: "reconciling",
    });
  });

  it("waits for confirmations and fails closed on runtime, owner, or constructor mismatch", () => {
    const confirming = decideHelperDeploymentObservation({
      dropAfterMilliseconds: 1_000,
      now,
      observation: observation({ receipt: receipt({ confirmations: "1" }) }),
      operation: operation(),
      requiredConfirmations: 2,
    });
    expect(confirming).toMatchObject({ kind: "receipt", state: "confirmed" });

    const succeeded = decideHelperDeploymentObservation({
      dropAfterMilliseconds: 1_000,
      now,
      observation: observation({ receipt: receipt() }),
      operation: operation("confirmed"),
      requiredConfirmations: 2,
    });
    expect(succeeded).toMatchObject({ kind: "receipt", reason: null, state: "succeeded" });

    for (const mismatch of [
      { runtimeCodeReconciled: false },
      { ownerReconciled: false },
      { constructorReconciled: false },
      { contractAddressReconciled: false },
    ]) {
      const failed = decideHelperDeploymentObservation({
        dropAfterMilliseconds: 1_000,
        now,
        observation: observation({ receipt: receipt(mismatch) }),
        operation: operation(),
        requiredConfirmations: 1,
      });
      expect(failed).toMatchObject({
        kind: "receipt",
        reason: "HELPER_RECEIPT_IDENTITY_MISMATCH",
        state: "failed",
      });
    }
  });

  it("replaces only fee fields and keeps CREATE identity immutable", () => {
    const original = plan();
    const replacement = replacementHelperDeploymentPlan({
      feeLimit: {
        feeCapBaseUnit: "3600000",
        gasLimit: "1200000",
        maxFeePerGasBaseUnit: "3",
        maxPriorityFeePerGasBaseUnit: "2",
      },
      now,
      plan: original,
    });
    expect(replacement.planDigest).not.toBe(original.planDigest);
    expect(replacement.transaction).toEqual(original.transaction);
    expect(replacement.deployment).toEqual(original.deployment);
    expect(replacement.nonce).toBe(original.nonce);
    expect(() =>
      replacementHelperDeploymentPlan({ feeLimit: original.feeLimit, now, plan: original }),
    ).toThrow("HELPER_REPLACEMENT_FEE_INVALID");
  });
});
