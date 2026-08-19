import { createHash } from "node:crypto";

export const P05_OPERATION_PLAN_VERSION = "p05-operation-plan-v1" as const;

export type ExecutionPlanType = "helper-deployment" | "position" | "swap" | "sweep";

export interface ExecutionAssetBinding {
  address: `0x${string}`;
  implementationAddress: `0x${string}` | null;
  implementationRuntimeCodeHash: `0x${string}` | null;
  runtimeCodeHash: `0x${string}`;
}

export interface ExecutionFeeTerms {
  dexProtocolFee: {
    basis: "amount-in" | "amount-out" | "liquidity" | "unknown";
    maxAmountBaseUnit: string;
  };
  gas: {
    gasLimit: string;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
  };
  lpFee: {
    basis: "amount-in" | "amount-out" | "liquidity" | "unknown";
    maxAmountBaseUnit: string;
  };
  policyDigest: `sha256:${string}`;
  policyVersion: string;
  serviceFee: {
    authorizationPlanDigest: `sha256:${string}` | null;
    basis: "amount-in" | "amount-out" | "liquidity" | "none";
    bps: number;
    maxBps: number;
    recipient: `0x${string}` | null;
    recipientAllowlist: readonly `0x${string}`[];
  };
}

export interface ExecutionPlanBase {
  call: {
    selector: `0x${string}`;
    target: `0x${string}`;
    targetRuntimeCodeHash: `0x${string}`;
    valueBaseUnit: string;
  };
  chainId: number;
  deadline: string;
  feeTerms: ExecutionFeeTerms;
  nonce: string;
  operationId: string;
  planDigest: `sha256:${string}`;
  planType: ExecutionPlanType;
  planVersion: typeof P05_OPERATION_PLAN_VERSION;
  quoteDigest: `sha256:${string}` | null;
  registry: {
    digest: `sha256:${string}`;
    rollbackVersion: string;
    validAtBlock: string;
    version: string;
  };
  schemaVersion: 1;
  snapshotDigest: `sha256:${string}`;
  tokenPolicy: {
    digest: `sha256:${string}`;
    version: string;
  };
  wallet: {
    address: `0x${string}`;
    walletId: string;
  };
}

export interface HelperDeploymentPlan extends ExecutionPlanBase {
  deployment: {
    adapter: `0x${string}`;
    constructorArgumentsHash: `sha256:${string}`;
    creationCodeHash: `0x${string}`;
    expectedHelper: `0x${string}`;
    expectedRuntimeCodeHash: `0x${string}`;
    owner: `0x${string}`;
    permit2: `0x${string}`;
  };
  planType: "helper-deployment";
  quoteDigest: null;
}

export interface SwapPlan extends ExecutionPlanBase {
  planType: "swap";
  quoteDigest: `sha256:${string}`;
  swap: {
    amountInBaseUnit: string;
    minOutBaseUnit: string;
    permit2Expiration: string | null;
    recipient: `0x${string}`;
    refundRecipient: `0x${string}`;
    tokenIn: ExecutionAssetBinding;
    tokenOut: ExecutionAssetBinding;
  };
}

export interface PositionPlan extends ExecutionPlanBase {
  planType: "position";
  position: {
    action: "collect" | "decrease" | "increase" | "mint";
    amount0BaseUnit: string;
    amount1BaseUnit: string;
    minAmount0BaseUnit: string;
    minAmount1BaseUnit: string;
    nftRecipient: `0x${string}`;
    outputRecipient: `0x${string}`;
    refundRecipient: `0x${string}`;
    token0: ExecutionAssetBinding;
    token1: ExecutionAssetBinding;
    tokenId: string;
  };
}

export interface SweepPlan extends ExecutionPlanBase {
  planType: "sweep";
  quoteDigest: null;
  sweep: {
    amountBaseUnit: string;
    asset: ExecutionAssetBinding | null;
    dustLimitBaseUnit: string;
    recipient: `0x${string}`;
  };
}

export type ExecutionPlan = HelperDeploymentPlan | PositionPlan | SwapPlan | SweepPlan;

export interface ExecutionPlanValidationContext {
  chainId: number;
  creationCodeHash: `0x${string}`;
  feePolicyDigest: `sha256:${string}`;
  feePolicyVersion: string;
  helperAddress: `0x${string}`;
  helperRuntimeCodeHash: `0x${string}`;
  helperSelectors: Readonly<
    Record<"position" | "swap" | "sweep-native" | "sweep-token", `0x${string}`>
  >;
  maxAmountBaseUnit: string;
  maxPermit2ExpirationSeconds: number;
  registryDigest: `sha256:${string}`;
  registryValidFromBlock: string;
  registryValidToBlock: string;
  registryVersion: string;
  serviceFeeMaxBps: number;
  serviceFeeRecipientAllowlist: readonly `0x${string}`[];
  tokenPolicyDigest: `sha256:${string}`;
  tokenPolicyVersion: string;
  tokens: readonly ExecutionAssetBinding[];
}

const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const selectorPattern = /^0x[0-9a-f]{8}$/u;
const codeHashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const identifierPattern = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;

function canonicalValue(value: unknown, key?: string): unknown {
  if (key === "planDigest" || key === "authorizationPlanDigest") return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entryValue]) => {
          const canonical = canonicalValue(entryValue, entryKey);
          return canonical === undefined ? [] : [[entryKey, canonical]];
        }),
    );
  }
  return value;
}

export function executionPlanDigest(plan: ExecutionPlan): `sha256:${string}` {
  const payload = JSON.stringify(canonicalValue(plan));
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

function decimal(value: string, code: string, positive = false): bigint {
  if (!decimalPattern.test(value) || value.length > 160 || (positive && value === "0")) {
    throw new RangeError(code);
  }
  return BigInt(value);
}

function address(value: string, code: string): void {
  if (!addressPattern.test(value)) throw new RangeError(code);
}

function hash(value: string, code: string): void {
  if (!codeHashPattern.test(value)) throw new RangeError(code);
}

function digest(value: string, code: string): void {
  if (!digestPattern.test(value)) throw new RangeError(code);
}

function validateAsset(
  asset: ExecutionAssetBinding,
  context: ExecutionPlanValidationContext,
): void {
  address(asset.address, "EXECUTION_TOKEN_IDENTITY_INVALID");
  hash(asset.runtimeCodeHash, "EXECUTION_TOKEN_IDENTITY_INVALID");
  if (asset.implementationAddress !== null)
    address(asset.implementationAddress, "EXECUTION_TOKEN_IDENTITY_INVALID");
  if (asset.implementationRuntimeCodeHash !== null) {
    hash(asset.implementationRuntimeCodeHash, "EXECUTION_TOKEN_IDENTITY_INVALID");
  }
  const expected = context.tokens.find(({ address: candidate }) => candidate === asset.address);
  if (
    !expected ||
    expected.runtimeCodeHash !== asset.runtimeCodeHash ||
    expected.implementationAddress !== asset.implementationAddress ||
    expected.implementationRuntimeCodeHash !== asset.implementationRuntimeCodeHash
  ) {
    throw new RangeError("EXECUTION_TOKEN_NOT_ALLOWED");
  }
}

function validateFees(plan: ExecutionPlan, context: ExecutionPlanValidationContext): void {
  const fees = plan.feeTerms;
  if (
    fees.policyVersion !== context.feePolicyVersion ||
    fees.policyDigest !== context.feePolicyDigest
  ) {
    throw new RangeError("EXECUTION_FEE_POLICY_MISMATCH");
  }
  digest(fees.policyDigest, "EXECUTION_FEE_POLICY_MISMATCH");
  decimal(fees.dexProtocolFee.maxAmountBaseUnit, "EXECUTION_FEE_INVALID");
  decimal(fees.lpFee.maxAmountBaseUnit, "EXECUTION_FEE_INVALID");
  const gasLimit = decimal(fees.gas.gasLimit, "EXECUTION_GAS_INVALID", true);
  const maxFee = decimal(fees.gas.maxFeePerGasBaseUnit, "EXECUTION_GAS_INVALID", true);
  const priority = decimal(fees.gas.maxPriorityFeePerGasBaseUnit, "EXECUTION_GAS_INVALID");
  if (gasLimit === 0n || priority > maxFee) throw new RangeError("EXECUTION_GAS_INVALID");
  const service = fees.serviceFee;
  if (!Number.isInteger(service.bps) || !Number.isInteger(service.maxBps)) {
    throw new RangeError("EXECUTION_FEE_INVALID");
  }
  if (
    service.bps < 0 ||
    service.maxBps < 0 ||
    service.bps > service.maxBps ||
    service.maxBps > 10_000
  ) {
    throw new RangeError("EXECUTION_FEE_INVALID");
  }
  if (
    service.maxBps > context.serviceFeeMaxBps ||
    service.recipientAllowlist.length !== context.serviceFeeRecipientAllowlist.length ||
    service.recipientAllowlist.some(
      (recipient, index) => recipient !== context.serviceFeeRecipientAllowlist[index],
    )
  ) {
    throw new RangeError("EXECUTION_FEE_POLICY_MISMATCH");
  }
  if (service.bps === 0) {
    if (
      service.basis !== "none" ||
      service.recipient !== null ||
      service.recipientAllowlist.length !== 0 ||
      service.authorizationPlanDigest !== null
    ) {
      throw new RangeError("EXECUTION_FEE_INVALID");
    }
    return;
  }
  if (
    service.basis === "none" ||
    service.recipient === null ||
    !service.recipientAllowlist.includes(service.recipient) ||
    service.authorizationPlanDigest !== plan.planDigest
  ) {
    throw new RangeError("EXECUTION_FEE_AUTHORIZATION_INVALID");
  }
}

export function validateExecutionPlan(
  plan: ExecutionPlan,
  context: ExecutionPlanValidationContext,
  atEpochSeconds: bigint,
): void {
  if (
    plan.schemaVersion !== 1 ||
    plan.planVersion !== P05_OPERATION_PLAN_VERSION ||
    plan.chainId !== context.chainId ||
    !identifierPattern.test(plan.operationId) ||
    !identifierPattern.test(plan.wallet.walletId)
  ) {
    throw new RangeError("EXECUTION_PLAN_IDENTITY_INVALID");
  }
  address(plan.wallet.address, "EXECUTION_PLAN_IDENTITY_INVALID");
  address(plan.call.target, "EXECUTION_TARGET_INVALID");
  hash(plan.call.targetRuntimeCodeHash, "EXECUTION_TARGET_INVALID");
  if (!selectorPattern.test(plan.call.selector)) throw new RangeError("EXECUTION_SELECTOR_INVALID");
  decimal(plan.nonce, "EXECUTION_NONCE_INVALID");
  decimal(plan.call.valueBaseUnit, "EXECUTION_VALUE_INVALID");
  const deadline = decimal(plan.deadline, "EXECUTION_DEADLINE_INVALID", true);
  if (deadline <= atEpochSeconds) throw new RangeError("EXECUTION_PLAN_EXPIRED");
  digest(plan.snapshotDigest, "EXECUTION_SNAPSHOT_INVALID");
  if (plan.quoteDigest !== null) digest(plan.quoteDigest, "EXECUTION_QUOTE_INVALID");
  if (
    plan.registry.version !== context.registryVersion ||
    plan.registry.digest !== context.registryDigest ||
    plan.tokenPolicy.version !== context.tokenPolicyVersion ||
    plan.tokenPolicy.digest !== context.tokenPolicyDigest
  ) {
    throw new RangeError("EXECUTION_POLICY_BINDING_MISMATCH");
  }
  digest(plan.registry.digest, "EXECUTION_POLICY_BINDING_MISMATCH");
  digest(plan.tokenPolicy.digest, "EXECUTION_POLICY_BINDING_MISMATCH");
  const validBlock = decimal(plan.registry.validAtBlock, "EXECUTION_REGISTRY_RANGE_INVALID");
  if (
    validBlock < BigInt(context.registryValidFromBlock) ||
    validBlock > BigInt(context.registryValidToBlock)
  ) {
    throw new RangeError("EXECUTION_REGISTRY_RANGE_INVALID");
  }
  validateFees(plan, context);

  if (plan.planType === "helper-deployment") {
    if (
      plan.call.target !== plan.deployment.expectedHelper ||
      plan.call.selector !== "0x00000000" ||
      plan.call.targetRuntimeCodeHash !== plan.deployment.expectedRuntimeCodeHash ||
      plan.deployment.expectedRuntimeCodeHash !== context.helperRuntimeCodeHash ||
      plan.deployment.creationCodeHash !== context.creationCodeHash ||
      plan.deployment.expectedHelper !== context.helperAddress ||
      plan.deployment.owner !== plan.wallet.address ||
      plan.call.valueBaseUnit !== "0" ||
      plan.quoteDigest !== null
    ) {
      throw new RangeError("HELPER_DEPLOYMENT_PLAN_INVALID");
    }
    address(plan.deployment.adapter, "HELPER_DEPLOYMENT_PLAN_INVALID");
    address(plan.deployment.permit2, "HELPER_DEPLOYMENT_PLAN_INVALID");
    digest(plan.deployment.constructorArgumentsHash, "HELPER_DEPLOYMENT_PLAN_INVALID");
    hash(plan.deployment.creationCodeHash, "HELPER_DEPLOYMENT_PLAN_INVALID");
  } else {
    if (
      plan.call.target !== context.helperAddress ||
      plan.call.targetRuntimeCodeHash !== context.helperRuntimeCodeHash ||
      plan.call.valueBaseUnit !== "0"
    ) {
      throw new RangeError("EXECUTION_TARGET_INVALID");
    }
    if (plan.planType === "swap") {
      if (plan.call.selector !== context.helperSelectors.swap || plan.quoteDigest === null) {
        throw new RangeError("SWAP_PLAN_INVALID");
      }
      validateAsset(plan.swap.tokenIn, context);
      validateAsset(plan.swap.tokenOut, context);
      const amount = decimal(plan.swap.amountInBaseUnit, "SWAP_AMOUNT_INVALID", true);
      decimal(plan.swap.minOutBaseUnit, "SWAP_MIN_OUT_INVALID", true);
      if (amount > BigInt(context.maxAmountBaseUnit)) throw new RangeError("SWAP_AMOUNT_INVALID");
      if (
        plan.swap.recipient !== plan.wallet.address ||
        plan.swap.refundRecipient !== plan.wallet.address
      ) {
        throw new RangeError("SWAP_RECIPIENT_INVALID");
      }
      if (plan.swap.permit2Expiration !== null) {
        const expiration = decimal(plan.swap.permit2Expiration, "PERMIT2_EXPIRATION_INVALID", true);
        if (
          expiration < atEpochSeconds ||
          expiration > atEpochSeconds + BigInt(context.maxPermit2ExpirationSeconds)
        ) {
          throw new RangeError("PERMIT2_EXPIRATION_INVALID");
        }
      }
    } else if (plan.planType === "position") {
      if (plan.call.selector !== context.helperSelectors.position) {
        throw new RangeError("POSITION_PLAN_INVALID");
      }
      validateAsset(plan.position.token0, context);
      validateAsset(plan.position.token1, context);
      const amounts = [
        plan.position.amount0BaseUnit,
        plan.position.amount1BaseUnit,
        plan.position.minAmount0BaseUnit,
        plan.position.minAmount1BaseUnit,
      ].map((value) => decimal(value, "POSITION_AMOUNT_INVALID"));
      decimal(plan.position.tokenId, "POSITION_TOKEN_ID_INVALID");
      if (amounts.some((amount) => amount > BigInt(context.maxAmountBaseUnit))) {
        throw new RangeError("POSITION_AMOUNT_INVALID");
      }
      if (
        plan.position.nftRecipient !== plan.wallet.address ||
        plan.position.outputRecipient !== plan.wallet.address ||
        plan.position.refundRecipient !== plan.wallet.address
      ) {
        throw new RangeError("POSITION_RECIPIENT_INVALID");
      }
    } else {
      const expectedSelector =
        plan.sweep.asset === null
          ? context.helperSelectors["sweep-native"]
          : context.helperSelectors["sweep-token"];
      if (
        plan.call.selector !== expectedSelector ||
        plan.quoteDigest !== null ||
        plan.sweep.recipient !== plan.wallet.address
      ) {
        throw new RangeError("SWEEP_PLAN_INVALID");
      }
      if (plan.sweep.asset !== null) validateAsset(plan.sweep.asset, context);
      const amount = decimal(plan.sweep.amountBaseUnit, "SWEEP_AMOUNT_INVALID", true);
      const dust = decimal(plan.sweep.dustLimitBaseUnit, "SWEEP_DUST_INVALID");
      if (amount > BigInt(context.maxAmountBaseUnit) || dust > amount) {
        throw new RangeError("SWEEP_AMOUNT_INVALID");
      }
    }
  }

  const calculated = executionPlanDigest(plan);
  if (plan.planDigest !== calculated) throw new RangeError("EXECUTION_PLAN_DIGEST_MISMATCH");
}
