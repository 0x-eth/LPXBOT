import { createHash } from "node:crypto";

export const HELPER_DEPLOYMENT_PLAN_VERSION = "p05-helper-deployment-plan-v2" as const;

export interface HelperDeploymentFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface HelperDeploymentPlan {
  chainId: 31_337;
  deadline: string;
  deployment: {
    adapter: `0x${string}`;
    constructorArgumentsHash: `sha256:${string}`;
    creationCodeHash: `0x${string}`;
    expectedAddress: `0x${string}`;
    expectedRuntimeCodeHash: `0x${string}`;
    helperVersion: "WalletHelperV1";
    owner: `0x${string}`;
    permit2: `0x${string}`;
    tokenA: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
    tokenB: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
  };
  feeLimit: HelperDeploymentFeeLimit;
  fencingToken: string;
  nonce: string;
  operationId: string;
  planDigest: `sha256:${string}`;
  planVersion: typeof HELPER_DEPLOYMENT_PLAN_VERSION;
  registry: {
    blockNumber: string;
    digest: `sha256:${string}`;
    rollbackVersion: string;
    version: string;
  };
  schemaVersion: 2;
  snapshotDigest: `sha256:${string}`;
  transaction: {
    data: `0x${string}`;
    dataHash: `0x${string}`;
    to: null;
    valueBaseUnit: "0";
  };
  wallet: {
    address: `0x${string}`;
    walletId: string;
  };
}

export interface HelperDeploymentPlanValidationContext {
  adapter: `0x${string}`;
  chainId: 31_337;
  constructorArgumentsHash: `sha256:${string}`;
  creationCodeHash: `0x${string}`;
  expectedAddress: `0x${string}`;
  expectedRuntimeCodeHash: `0x${string}`;
  helperVersion: "WalletHelperV1";
  initCode: `0x${string}`;
  initCodeHash: `0x${string}`;
  owner: `0x${string}`;
  permit2: `0x${string}`;
  registryDigest: `sha256:${string}`;
  registryRollbackVersion: string;
  registryValidFromBlock: string;
  registryValidToBlock: string;
  registryVersion: string;
  tokenA: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
  tokenB: { address: `0x${string}`; runtimeCodeHash: `0x${string}` };
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function canonical(value: unknown, key?: string): unknown {
  if (key === "planDigest") return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entryValue]) => {
          const next = canonical(entryValue, entryKey);
          return next === undefined ? [] : [[entryKey, next]];
        }),
    );
  }
  return value;
}

export function helperDeploymentPlanDigest(plan: HelperDeploymentPlan): `sha256:${string}` {
  const value = JSON.stringify(canonical(plan));
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function decimal(value: string, code: string, positive = false): bigint {
  if (!decimalPattern.test(value) || value.length > 78) throw new RangeError(code);
  const parsed = BigInt(value);
  if (positive && parsed === 0n) throw new RangeError(code);
  return parsed;
}

function sameToken(
  actual: HelperDeploymentPlan["deployment"]["tokenA"],
  expected: HelperDeploymentPlanValidationContext["tokenA"],
): boolean {
  return actual.address === expected.address && actual.runtimeCodeHash === expected.runtimeCodeHash;
}

export function validateHelperDeploymentPlan(
  plan: HelperDeploymentPlan,
  context: HelperDeploymentPlanValidationContext,
  now: Date = new Date(),
): void {
  const deadline = new Date(plan.deadline);
  if (
    plan.schemaVersion !== 2 ||
    plan.planVersion !== HELPER_DEPLOYMENT_PLAN_VERSION ||
    plan.chainId !== 31_337 ||
    plan.chainId !== context.chainId ||
    !uuidPattern.test(plan.operationId) ||
    !uuidPattern.test(plan.wallet.walletId) ||
    !addressPattern.test(plan.wallet.address) ||
    !Number.isFinite(deadline.getTime()) ||
    deadline.toISOString() !== plan.deadline ||
    deadline <= now ||
    deadline.getTime() > now.getTime() + 15 * 60 * 1_000
  ) {
    throw new RangeError("HELPER_DEPLOYMENT_PLAN_IDENTITY_INVALID");
  }
  decimal(plan.nonce, "HELPER_DEPLOYMENT_NONCE_INVALID");
  decimal(plan.fencingToken, "HELPER_DEPLOYMENT_FENCING_INVALID", true);
  const gas = decimal(plan.feeLimit.gasLimit, "HELPER_DEPLOYMENT_GAS_INVALID", true);
  const maxFee = decimal(plan.feeLimit.maxFeePerGasBaseUnit, "HELPER_DEPLOYMENT_GAS_INVALID", true);
  const priority = decimal(
    plan.feeLimit.maxPriorityFeePerGasBaseUnit,
    "HELPER_DEPLOYMENT_GAS_INVALID",
  );
  if (
    priority > maxFee ||
    plan.feeLimit.feeCapBaseUnit !== (gas * maxFee).toString() ||
    plan.transaction.to !== null ||
    plan.transaction.valueBaseUnit !== "0" ||
    plan.transaction.data !== context.initCode ||
    plan.transaction.dataHash !== context.initCodeHash
  ) {
    throw new RangeError("HELPER_DEPLOYMENT_TRANSACTION_INVALID");
  }
  if (
    plan.registry.version !== context.registryVersion ||
    plan.registry.digest !== context.registryDigest ||
    plan.registry.rollbackVersion !== context.registryRollbackVersion ||
    !digestPattern.test(plan.registry.digest) ||
    !decimalPattern.test(plan.registry.blockNumber) ||
    BigInt(plan.registry.blockNumber) < BigInt(context.registryValidFromBlock) ||
    BigInt(plan.registry.blockNumber) > BigInt(context.registryValidToBlock)
  ) {
    throw new RangeError("HELPER_DEPLOYMENT_REGISTRY_MISMATCH");
  }
  const deployment = plan.deployment;
  if (
    deployment.helperVersion !== context.helperVersion ||
    deployment.owner !== context.owner ||
    deployment.owner !== plan.wallet.address ||
    deployment.adapter !== context.adapter ||
    deployment.permit2 !== context.permit2 ||
    deployment.creationCodeHash !== context.creationCodeHash ||
    deployment.constructorArgumentsHash !== context.constructorArgumentsHash ||
    deployment.expectedAddress !== context.expectedAddress ||
    deployment.expectedRuntimeCodeHash !== context.expectedRuntimeCodeHash ||
    !sameToken(deployment.tokenA, context.tokenA) ||
    !sameToken(deployment.tokenB, context.tokenB) ||
    !addressPattern.test(deployment.expectedAddress) ||
    !hashPattern.test(deployment.expectedRuntimeCodeHash) ||
    !hashPattern.test(deployment.creationCodeHash) ||
    !digestPattern.test(deployment.constructorArgumentsHash)
  ) {
    throw new RangeError("HELPER_DEPLOYMENT_CONSTRUCTOR_MISMATCH");
  }
  if (!digestPattern.test(plan.snapshotDigest)) {
    throw new RangeError("HELPER_DEPLOYMENT_SNAPSHOT_INVALID");
  }
  if (helperDeploymentPlanDigest(plan) !== plan.planDigest) {
    throw new RangeError("HELPER_DEPLOYMENT_PLAN_DIGEST_MISMATCH");
  }
}
