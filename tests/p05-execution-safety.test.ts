import {
  LocalExecutionRegistryError,
  P05_BSC_LOCAL_EXECUTION_REGISTRY,
  validateLocalExecutionRegistryContext,
  type LocalExecutionVerification,
} from "../packages/chain-registry/src/index.js";
import { BSC_SWAP_QUOTE_REGISTRY } from "../packages/chain-registry/src/index.js";
import {
  executionPlanDigest,
  validateExecutionPlan,
  type ExecutionAssetBinding,
  type ExecutionFeeTerms,
  type ExecutionPlan,
  type ExecutionPlanBase,
  type ExecutionPlanValidationContext,
  type HelperDeploymentPlan,
  type PositionPlan,
  type SwapPlan,
  type SweepPlan,
} from "../packages/domain/src/execution-plans.js";
import { describe, expect, it } from "vitest";

const registry = P05_BSC_LOCAL_EXECUTION_REGISTRY;
const helper = registry.components.find(({ role }) => role === "helper")!;
const adapter = registry.components.find(({ role }) => role === "adapter")!;
const permit2 = registry.components.find(({ role }) => role === "permit2")!;
const tokenIn = registry.tokenPolicy.tokens[0]!;
const tokenOut = registry.tokenPolicy.tokens[1]!;
const digestA = `sha256:${"a".repeat(64)}` as const;
const creationCodeHash =
  "0x03d49afeaae7c230fe898e1843a3d292b3d422cf22d7ec00f3bac3ca8377e5e7" as const;
const constructorArgumentsHash =
  "sha256:145c51662ed6d3e586b35654542edf7379c2475a1c3865a9a24c46056a40c604" as const;
const walletAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as const;

function asset(token: typeof tokenIn | typeof tokenOut): ExecutionAssetBinding {
  return {
    address: token.address,
    implementationAddress: token.implementationAddress,
    implementationRuntimeCodeHash: token.implementationRuntimeCodeHash,
    runtimeCodeHash: token.runtimeCodeHash,
  };
}

function verification(): LocalExecutionVerification {
  return {
    blockNumber: "1",
    chainId: registry.chainId,
    components: registry.components.map((entry) => ({ ...entry })),
    registryVersion: registry.registryVersion,
    selector: registry.helperSelectorAllowlist[0]!,
    selectorScope: "helper",
    tokens: registry.tokenPolicy.tokens.map((token) => ({
      address: token.address,
      implementationAddress: token.implementationAddress,
      implementationRuntimeCodeHash: token.implementationRuntimeCodeHash,
      runtimeCodeHash: token.runtimeCodeHash,
    })),
  };
}

const fees: ExecutionFeeTerms = {
  dexProtocolFee: { basis: "amount-in", maxAmountBaseUnit: "10" },
  gas: {
    gasLimit: "500000",
    maxFeePerGasBaseUnit: "2000000000",
    maxPriorityFeePerGasBaseUnit: "100000000",
  },
  lpFee: { basis: "liquidity", maxAmountBaseUnit: "10" },
  policyDigest: registry.feePolicy.policyDigest,
  policyVersion: registry.feePolicy.policyVersion,
  serviceFee: {
    authorizationPlanDigest: null,
    basis: "none",
    bps: 0,
    maxBps: 0,
    recipient: null,
    recipientAllowlist: [],
  },
};

function base(
  planType: ExecutionPlan["planType"],
  selector = registry.helperSelectorAllowlist[0]!,
): ExecutionPlanBase {
  return {
    call: {
      selector,
      target: helper.address,
      targetRuntimeCodeHash: helper.runtimeCodeHash,
      valueBaseUnit: "0",
    },
    chainId: registry.chainId,
    deadline: "1060000",
    feeTerms: structuredClone(fees),
    nonce: "7",
    operationId: `p05-04-${planType}`,
    planDigest: digestA,
    planType,
    planVersion: "p05-operation-plan-v1",
    quoteDigest: digestA,
    registry: {
      digest: registry.registryDigest,
      rollbackVersion: registry.rollbackVersion,
      validAtBlock: "1",
      version: registry.registryVersion,
    },
    schemaVersion: 1,
    snapshotDigest: digestA,
    tokenPolicy: {
      digest: registry.tokenPolicy.policyDigest,
      version: registry.tokenPolicy.policyVersion,
    },
    wallet: { address: walletAddress, walletId: "wallet-p05-04" },
  };
}

function seal<T extends ExecutionPlan>(plan: T): T {
  plan.planDigest = executionPlanDigest(plan);
  return plan;
}

function swapPlan(): SwapPlan {
  return seal({
    ...base("swap", registry.helperSelectorAllowlist[0]),
    planType: "swap",
    quoteDigest: digestA,
    swap: {
      amountInBaseUnit: "1000",
      minOutBaseUnit: "900",
      permit2Expiration: "1000600",
      recipient: walletAddress,
      refundRecipient: walletAddress,
      tokenIn: asset(tokenIn),
      tokenOut: asset(tokenOut),
    },
  });
}

function positionPlan(): PositionPlan {
  return seal({
    ...base("position", registry.helperSelectorAllowlist[1]),
    planType: "position",
    position: {
      action: "mint",
      amount0BaseUnit: "1000",
      amount1BaseUnit: "2000",
      minAmount0BaseUnit: "800",
      minAmount1BaseUnit: "1700",
      nftRecipient: walletAddress,
      outputRecipient: walletAddress,
      refundRecipient: walletAddress,
      token0: asset(tokenIn),
      token1: asset(tokenOut),
      tokenId: "0",
    },
  });
}

function sweepPlan(): SweepPlan {
  return seal({
    ...base("sweep", registry.helperSelectorAllowlist[2]),
    planType: "sweep",
    quoteDigest: null,
    sweep: {
      amountBaseUnit: "100",
      asset: asset(tokenIn),
      dustLimitBaseUnit: "1",
      recipient: walletAddress,
    },
  });
}

function deploymentPlan(): HelperDeploymentPlan {
  return seal({
    ...base("helper-deployment", "0x00000000"),
    deployment: {
      adapter: adapter.address,
      constructorArgumentsHash,
      creationCodeHash,
      expectedHelper: helper.address,
      expectedRuntimeCodeHash: helper.runtimeCodeHash,
      owner: walletAddress,
      permit2: permit2.address,
    },
    planType: "helper-deployment",
    quoteDigest: null,
  });
}

function context(): ExecutionPlanValidationContext {
  return {
    adapterAddress: adapter.address,
    chainId: registry.chainId,
    constructorArgumentsHash,
    creationCodeHash,
    dustLimitBaseUnit: registry.tokenPolicy.dustLimitBaseUnit,
    feePolicyDigest: registry.feePolicy.policyDigest,
    feePolicyVersion: registry.feePolicy.policyVersion,
    helperAddress: helper.address,
    helperRuntimeCodeHash: helper.runtimeCodeHash,
    helperSelectors: {
      position: registry.helperSelectorAllowlist[1]!,
      swap: registry.helperSelectorAllowlist[0]!,
      "sweep-native": registry.helperSelectorAllowlist[3]!,
      "sweep-token": registry.helperSelectorAllowlist[2]!,
    },
    maxAmountBaseUnit: registry.tokenPolicy.maxAmountBaseUnit,
    maxDeadlineWindowSeconds: 86_400,
    maxPermit2ExpirationSeconds: registry.tokenPolicy.permit2MaxExpirationSeconds,
    permit2Address: permit2.address,
    registryDigest: registry.registryDigest,
    registryRollbackVersion: registry.rollbackVersion,
    registryValidFromBlock: registry.validFromBlock,
    registryValidToBlock: registry.validToBlock,
    registryVersion: registry.registryVersion,
    serviceFeeMaxBps: registry.feePolicy.serviceFeeMaxBps,
    serviceFeeRecipientAllowlist: registry.feePolicy.serviceFeeRecipientAllowlist,
    tokenPolicyDigest: registry.tokenPolicy.policyDigest,
    tokenPolicyVersion: registry.tokenPolicy.policyVersion,
    tokens: registry.tokenPolicy.tokens.map(asset),
  };
}

function expectRegistryFailure(
  mutate: (value: LocalExecutionVerification) => void,
  reason: LocalExecutionRegistryError["reason"],
): void {
  const value = verification();
  mutate(value);
  try {
    validateLocalExecutionRegistryContext(value);
    throw new Error("registry unexpectedly accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(LocalExecutionRegistryError);
    expect((error as LocalExecutionRegistryError).reason).toBe(reason);
  }
}

describe("P05-04 isolated local execution safety baseline", () => {
  it("keeps production execution disabled and never inherits local selectors", () => {
    expect(BSC_SWAP_QUOTE_REGISTRY.executionEnabled).toBe(false);
    expect(BSC_SWAP_QUOTE_REGISTRY.executionRouterSelectorAllowlist).toEqual([]);
    expect(registry.environment).toBe("foundry-anvil-only");
    expect(registry.productionInheritance).toBe(false);
    expect(registry.routerSelectorAllowlist).toHaveLength(1);
    expect(registry.helperSelectorAllowlist).toHaveLength(4);
    expect(registry.helperSelectorAllowlist).not.toContain("0xadc3f25c");
    expect(registry.helperSelectorAllowlist).not.toContain("0xfb691fd9");
    expect(registry.helperSelectorAllowlist).not.toContain("0x71fa74ed");
    expect(registry.helperSelectorAllowlist).not.toContain("0x5dfd8e50");
  });

  it("accepts only an exact chain, range, selector, component, implementation, and token snapshot", () => {
    expect(validateLocalExecutionRegistryContext(verification())).toBe(registry);
    expectRegistryFailure((value) => (value.chainId = 56), "CHAIN_ID_MISMATCH");
    expectRegistryFailure(
      (value) => (value.registryVersion = "p05-bsc-execution-v1"),
      "REGISTRY_VERSION_MISMATCH",
    );
    expectRegistryFailure((value) => (value.blockNumber = "1000001"), "BLOCK_OUTSIDE_VALIDITY");
    expectRegistryFailure((value) => (value.selector = "0xdeadbeef"), "SELECTOR_NOT_ALLOWLISTED");
    expectRegistryFailure(
      (value) => (value.components[0]!.address = "0x0000000000000000000000000000000000000001"),
      "ADDRESS_MISMATCH",
    );
    expectRegistryFailure((value) => (value.components[0]!.abiHash = digestA), "ABI_HASH_MISMATCH");
    expectRegistryFailure(
      (value) => (value.components[0]!.runtimeCodeHash = `0x${"1".repeat(64)}`),
      "RUNTIME_CODE_HASH_MISMATCH",
    );
    expectRegistryFailure(
      (value) =>
        (value.components[0]!.proxyImplementation =
          "0x0000000000000000000000000000000000000001" as never),
      "IMPLEMENTATION_MISMATCH",
    );
    expectRegistryFailure(
      (value) => (value.tokens[0]!.address = "0x0000000000000000000000000000000000000001"),
      "TOKEN_NOT_ALLOWLISTED",
    );
    expectRegistryFailure(
      (value) => (value.tokens[0]!.runtimeCodeHash = `0x${"1".repeat(64)}`),
      "TOKEN_RUNTIME_CODE_HASH_MISMATCH",
    );
  });

  it("validates deployment, swap, position, and sweep plans with stable digests", () => {
    const validation = context();
    for (const plan of [deploymentPlan(), swapPlan(), positionPlan(), sweepPlan()]) {
      expect(() => validateExecutionPlan(plan, validation, 1_000_000n)).not.toThrow();
      expect(plan.planDigest).toBe(executionPlanDigest(plan));
    }
  });

  it("rejects digest drift, foreign recipients, unknown code, expired permits, and local fees", () => {
    const validation = context();
    const changed = swapPlan();
    changed.swap.amountInBaseUnit = "1001";
    expect(() => validateExecutionPlan(changed, validation, 1_000_000n)).toThrow(
      "EXECUTION_PLAN_DIGEST_MISMATCH",
    );

    const foreignRecipient = swapPlan();
    foreignRecipient.swap.recipient = "0x0000000000000000000000000000000000000001";
    foreignRecipient.planDigest = executionPlanDigest(foreignRecipient);
    expect(() => validateExecutionPlan(foreignRecipient, validation, 1_000_000n)).toThrow(
      "SWAP_RECIPIENT_INVALID",
    );

    const unknownCode = swapPlan();
    unknownCode.swap.tokenIn.runtimeCodeHash = `0x${"1".repeat(64)}`;
    unknownCode.planDigest = executionPlanDigest(unknownCode);
    expect(() => validateExecutionPlan(unknownCode, validation, 1_000_000n)).toThrow(
      "EXECUTION_TOKEN_NOT_ALLOWED",
    );

    const expiredPermit = swapPlan();
    expiredPermit.swap.permit2Expiration = "999999";
    expiredPermit.planDigest = executionPlanDigest(expiredPermit);
    expect(() => validateExecutionPlan(expiredPermit, validation, 1_000_000n)).toThrow(
      "PERMIT2_EXPIRATION_INVALID",
    );

    const nonZeroFee = swapPlan();
    nonZeroFee.feeTerms.serviceFee = {
      authorizationPlanDigest: null,
      basis: "amount-in",
      bps: 1,
      maxBps: 1,
      recipient: walletAddress,
      recipientAllowlist: [walletAddress],
    };
    nonZeroFee.planDigest = executionPlanDigest(nonZeroFee);
    nonZeroFee.feeTerms.serviceFee.authorizationPlanDigest = nonZeroFee.planDigest;
    expect(() => validateExecutionPlan(nonZeroFee, validation, 1_000_000n)).toThrow(
      "EXECUTION_FEE_POLICY_MISMATCH",
    );
  });

  it("rejects deployment dependency, rollback, deadline, amount, and dust policy drift", () => {
    const validation = context();

    const foreignAdapter = deploymentPlan();
    foreignAdapter.deployment.adapter = "0x0000000000000000000000000000000000000001";
    foreignAdapter.planDigest = executionPlanDigest(foreignAdapter);
    expect(() => validateExecutionPlan(foreignAdapter, validation, 1_000_000n)).toThrow(
      "HELPER_DEPLOYMENT_PLAN_INVALID",
    );

    const rollbackDrift = swapPlan();
    rollbackDrift.registry.rollbackVersion = "foreign-rollback";
    rollbackDrift.planDigest = executionPlanDigest(rollbackDrift);
    expect(() => validateExecutionPlan(rollbackDrift, validation, 1_000_000n)).toThrow(
      "EXECUTION_POLICY_BINDING_MISMATCH",
    );

    const distantDeadline = swapPlan();
    distantDeadline.deadline = "1086401";
    distantDeadline.planDigest = executionPlanDigest(distantDeadline);
    expect(() => validateExecutionPlan(distantDeadline, validation, 1_000_000n)).toThrow(
      "EXECUTION_PLAN_EXPIRED",
    );

    const excessiveMinOut = swapPlan();
    excessiveMinOut.swap.minOutBaseUnit = (BigInt(validation.maxAmountBaseUnit) + 1n).toString();
    excessiveMinOut.planDigest = executionPlanDigest(excessiveMinOut);
    expect(() => validateExecutionPlan(excessiveMinOut, validation, 1_000_000n)).toThrow(
      "SWAP_MIN_OUT_INVALID",
    );

    const dustDrift = sweepPlan();
    dustDrift.sweep.dustLimitBaseUnit = "0";
    dustDrift.planDigest = executionPlanDigest(dustDrift);
    expect(() => validateExecutionPlan(dustDrift, validation, 1_000_000n)).toThrow(
      "SWEEP_AMOUNT_INVALID",
    );
  });
});
