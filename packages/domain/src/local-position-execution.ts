import { createHash } from "node:crypto";

export const LOCAL_POSITION_SNAPSHOT_VERSION = "p05-local-position-snapshot-v2" as const;
export const LOCAL_POSITION_EXECUTION_PLAN_VERSION = "p05-local-position-plan-v2" as const;

export type LocalPositionPlatformId = 1 | 2 | 4 | 5;
export type LocalPositionOperationKind = "collect-fees" | "remove-liquidity";
export type LocalPositionStepKind = "burn" | "collect" | "decrease";

export interface LocalPositionFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface LocalPositionSnapshot {
  block: {
    hash: `0x${string}`;
    number: string;
    timestamp: string;
  };
  chainId: 31_337;
  expiresAt: string;
  manager: {
    abiHash: `sha256:${string}`;
    address: `0x${string}`;
    runtimeCodeHash: `0x${string}`;
  };
  observedAt: string;
  position: {
    approval: {
      approvedAddress: `0x${string}` | null;
      approvedForAll: boolean;
      operator: `0x${string}` | null;
    };
    liquidity: string;
    owner: `0x${string}`;
    platformId: LocalPositionPlatformId;
    pool: {
      feePips: string;
      poolAddress: `0x${string}` | null;
      poolId: `0x${string}` | null;
      tickSpacing: string;
      token0: `0x${string}`;
      token1: `0x${string}`;
    };
    reserve0BaseUnit: string;
    reserve1BaseUnit: string;
    ticks: { lower: string; upper: string };
    tokenId: string;
    tokensOwed0BaseUnit: string;
    tokensOwed1BaseUnit: string;
  };
  registry: {
    digest: `sha256:${string}`;
    version: "p05-local-position-execution-v2";
  };
  schemaVersion: 2;
  snapshotDigest: `sha256:${string}`;
  snapshotVersion: typeof LOCAL_POSITION_SNAPSHOT_VERSION;
  tokens: readonly [
    { address: `0x${string}`; runtimeCodeHash: `0x${string}` },
    { address: `0x${string}`; runtimeCodeHash: `0x${string}` },
  ];
  wallet: { address: `0x${string}`; walletId: string };
}

export interface LocalPositionPlanStep {
  feeLimit: LocalPositionFeeLimit;
  fencingToken: string;
  kind: LocalPositionStepKind;
  nonce: string;
  ordinal: number;
  runCondition: "always";
  semanticDigest: `sha256:${string}`;
  stepId: string;
  transaction: {
    data: `0x${string}`;
    dataDigest: `sha256:${string}`;
    to: `0x${string}`;
    valueBaseUnit: "0";
  };
}

export interface LocalPositionAccounting {
  collectTotal0BaseUnit: string;
  collectTotal1BaseUnit: string;
  feeProceeds0BaseUnit: string;
  feeProceeds1BaseUnit: string;
  liquidityBefore: string;
  liquidityDelta: string;
  minPrincipal0BaseUnit: string;
  minPrincipal1BaseUnit: string;
  principal0BaseUnit: string;
  principal1BaseUnit: string;
  remainingLiquidity: string;
}

export interface LocalPositionExecutionPlan {
  accounting: LocalPositionAccounting;
  action:
    | {
        burnIfEmpty: false;
        kind: "collect-fees";
        percent: null;
        slippageBps: null;
      }
    | {
        burnIfEmpty: boolean;
        kind: "remove-liquidity";
        percent: number;
        slippageBps: number;
      };
  chainId: 31_337;
  deadline: string;
  manager: LocalPositionSnapshot["manager"] & {
    selectors: {
      burn: "0x42966c68";
      collect: "0xfc6f7865";
      decreaseLiquidity: "0x0c49ccbe";
    };
  };
  operationId: string;
  planDigest: `sha256:${string}`;
  planVersion: typeof LOCAL_POSITION_EXECUTION_PLAN_VERSION;
  registry: LocalPositionSnapshot["registry"] & {
    rollbackVersion: "p05-local-position-execution-disabled-v1";
  };
  schemaVersion: 2;
  serviceFeeBps: 0;
  snapshot: LocalPositionSnapshot;
  steps: readonly LocalPositionPlanStep[];
  wallet: LocalPositionSnapshot["wallet"];
}

export interface LocalPositionPlanValidationContext {
  currentBlockHash: `0x${string}`;
  currentBlockNumber: string;
  expectedAccounting: LocalPositionAccounting;
  expectedAction: LocalPositionExecutionPlan["action"];
  expectedManager: LocalPositionExecutionPlan["manager"];
  expectedSnapshot: LocalPositionSnapshot;
  expectedSteps: readonly LocalPositionPlanStep[];
  expectedWallet: LocalPositionExecutionPlan["wallet"];
  registryDigest: `sha256:${string}`;
}

export interface LocalPositionReplacementCandidate {
  dataDigest: `sha256:${string}`;
  fee: Pick<LocalPositionFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
  nonce: string;
  planDigest: `sha256:${string}`;
  semanticDigest: `sha256:${string}`;
  target: `0x${string}`;
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const bytesPattern = /^0x(?:[0-9a-f]{2})+$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const signedDecimalPattern = /^-?(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uint128Max = (1n << 128n) - 1n;

function canonical(value: unknown, omittedKey?: string, key?: string): unknown {
  if (key === omittedKey) return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, omittedKey));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entry]) => {
          const next = canonical(entry, omittedKey, entryKey);
          return next === undefined ? [] : [[entryKey, next]];
        }),
    );
  }
  return value;
}

function stable(value: unknown, omittedKey?: string): string {
  return JSON.stringify(canonical(value, omittedKey));
}

function sha256(domain: string, value: unknown, omittedKey?: string): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(stable(value, omittedKey), "utf8")
    .digest("hex")}`;
}

function decimal(value: string, code: string, maximum?: bigint): bigint {
  if (!decimalPattern.test(value) || value.length > 78) throw new RangeError(code);
  const parsed = BigInt(value);
  if (maximum !== undefined && parsed > maximum) throw new RangeError(code);
  return parsed;
}

function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

export function localPositionLiquidityDelta(liquidity: string, percent: number): string {
  const value = decimal(liquidity, "LOCAL_POSITION_LIQUIDITY_INVALID", uint128Max);
  if (!Number.isSafeInteger(percent) || percent < 1 || percent > 100) {
    throw new RangeError("LOCAL_POSITION_PERCENT_INVALID");
  }
  const delta = percent === 100 ? value : (value * BigInt(percent)) / 100n;
  if (delta === 0n) throw new RangeError("LOCAL_POSITION_ZERO_LIQUIDITY_DELTA");
  return delta.toString();
}

export function localPositionMinimumAmount(amount: string, slippageBps: number): string {
  const value = decimal(amount, "LOCAL_POSITION_AMOUNT_INVALID", uint128Max);
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) {
    throw new RangeError("LOCAL_POSITION_SLIPPAGE_INVALID");
  }
  return ((value * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}

export function localPositionAccounting(
  snapshot: LocalPositionSnapshot,
  action: LocalPositionExecutionPlan["action"],
): LocalPositionAccounting {
  const liquidity = decimal(snapshot.position.liquidity, "LOCAL_POSITION_LIQUIDITY_INVALID", uint128Max);
  const owed0 = decimal(snapshot.position.tokensOwed0BaseUnit, "LOCAL_POSITION_AMOUNT_INVALID", uint128Max);
  const owed1 = decimal(snapshot.position.tokensOwed1BaseUnit, "LOCAL_POSITION_AMOUNT_INVALID", uint128Max);
  if (action.kind === "collect-fees") {
    return {
      collectTotal0BaseUnit: owed0.toString(),
      collectTotal1BaseUnit: owed1.toString(),
      feeProceeds0BaseUnit: owed0.toString(),
      feeProceeds1BaseUnit: owed1.toString(),
      liquidityBefore: liquidity.toString(),
      liquidityDelta: "0",
      minPrincipal0BaseUnit: "0",
      minPrincipal1BaseUnit: "0",
      principal0BaseUnit: "0",
      principal1BaseUnit: "0",
      remainingLiquidity: liquidity.toString(),
    };
  }
  const delta = BigInt(localPositionLiquidityDelta(liquidity.toString(), action.percent));
  const reserve0 = decimal(snapshot.position.reserve0BaseUnit, "LOCAL_POSITION_AMOUNT_INVALID", uint128Max);
  const reserve1 = decimal(snapshot.position.reserve1BaseUnit, "LOCAL_POSITION_AMOUNT_INVALID", uint128Max);
  const principal0 = delta === liquidity ? reserve0 : (reserve0 * delta) / liquidity;
  const principal1 = delta === liquidity ? reserve1 : (reserve1 * delta) / liquidity;
  return {
    collectTotal0BaseUnit: (owed0 + principal0).toString(),
    collectTotal1BaseUnit: (owed1 + principal1).toString(),
    feeProceeds0BaseUnit: owed0.toString(),
    feeProceeds1BaseUnit: owed1.toString(),
    liquidityBefore: liquidity.toString(),
    liquidityDelta: delta.toString(),
    minPrincipal0BaseUnit: localPositionMinimumAmount(principal0.toString(), action.slippageBps),
    minPrincipal1BaseUnit: localPositionMinimumAmount(principal1.toString(), action.slippageBps),
    principal0BaseUnit: principal0.toString(),
    principal1BaseUnit: principal1.toString(),
    remainingLiquidity: (liquidity - delta).toString(),
  };
}

export function localPositionSnapshotDigest(snapshot: LocalPositionSnapshot): `sha256:${string}` {
  return sha256("LPXBOT_LOCAL_POSITION_SNAPSHOT\0v2\0", snapshot, "snapshotDigest");
}

export function localPositionExecutionPlanDigest(
  plan: LocalPositionExecutionPlan,
): `sha256:${string}` {
  return sha256("LPXBOT_LOCAL_POSITION_PLAN\0v2\0", plan, "planDigest");
}

export function localPositionStepSemanticDigest(
  step: Omit<LocalPositionPlanStep, "semanticDigest"> | LocalPositionPlanStep,
): `sha256:${string}` {
  return sha256("LPXBOT_LOCAL_POSITION_STEP\0v2\0", step, "semanticDigest");
}

export function validateLocalPositionSnapshot(snapshot: LocalPositionSnapshot, now = new Date()): void {
  const observedAt = Date.parse(snapshot.observedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  const position = snapshot.position;
  const platformGeneration = position.platformId === 1 || position.platformId === 2 ? "v3" : "v4";
  const poolIdentityValid =
    platformGeneration === "v3"
      ? position.pool.poolAddress !== null && position.pool.poolId === null
      : position.pool.poolAddress === null && position.pool.poolId !== null;
  const tickSpacing = signedDecimalPattern.test(position.pool.tickSpacing)
    ? BigInt(position.pool.tickSpacing)
    : 0n;
  const lower = signedDecimalPattern.test(position.ticks.lower) ? BigInt(position.ticks.lower) : 0n;
  const upper = signedDecimalPattern.test(position.ticks.upper) ? BigInt(position.ticks.upper) : 0n;
  if (
    snapshot.schemaVersion !== 2 ||
    snapshot.snapshotVersion !== LOCAL_POSITION_SNAPSHOT_VERSION ||
    snapshot.chainId !== 31_337 ||
    snapshot.registry.version !== "p05-local-position-execution-v2" ||
    !digestPattern.test(snapshot.registry.digest) ||
    !uuidPattern.test(snapshot.wallet.walletId) ||
    !addressPattern.test(snapshot.wallet.address) ||
    position.owner !== snapshot.wallet.address ||
    ![1, 2, 4, 5].includes(position.platformId) ||
    !decimalPattern.test(position.tokenId) ||
    decimal(position.tokenId, "LOCAL_POSITION_SNAPSHOT_INVALID") === 0n ||
    !poolIdentityValid ||
    !addressPattern.test(position.pool.token0) ||
    !addressPattern.test(position.pool.token1) ||
    position.pool.token0 === position.pool.token1 ||
    tickSpacing === 0n ||
    lower >= upper ||
    lower % tickSpacing !== 0n ||
    upper % tickSpacing !== 0n ||
    !addressPattern.test(snapshot.manager.address) ||
    !hashPattern.test(snapshot.manager.runtimeCodeHash) ||
    !digestPattern.test(snapshot.manager.abiHash) ||
    !hashPattern.test(snapshot.block.hash) ||
    !decimalPattern.test(snapshot.block.number) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(expiresAt) ||
    new Date(observedAt).toISOString() !== snapshot.observedAt ||
    new Date(expiresAt).toISOString() !== snapshot.expiresAt ||
    observedAt > now.getTime() ||
    expiresAt <= now.getTime() ||
    expiresAt > observedAt + 60_000 ||
    snapshot.tokens[0].address !== position.pool.token0 ||
    snapshot.tokens[1].address !== position.pool.token1 ||
    snapshot.tokens.some(
      (token) => !addressPattern.test(token.address) || !hashPattern.test(token.runtimeCodeHash),
    ) ||
    localPositionSnapshotDigest(snapshot) !== snapshot.snapshotDigest
  ) {
    throw new RangeError("LOCAL_POSITION_SNAPSHOT_INVALID");
  }
  decimal(position.liquidity, "LOCAL_POSITION_SNAPSHOT_INVALID", uint128Max);
  decimal(position.reserve0BaseUnit, "LOCAL_POSITION_SNAPSHOT_INVALID", uint128Max);
  decimal(position.reserve1BaseUnit, "LOCAL_POSITION_SNAPSHOT_INVALID", uint128Max);
  decimal(position.tokensOwed0BaseUnit, "LOCAL_POSITION_SNAPSHOT_INVALID", uint128Max);
  decimal(position.tokensOwed1BaseUnit, "LOCAL_POSITION_SNAPSHOT_INVALID", uint128Max);
}

function validateFee(fee: LocalPositionFeeLimit): void {
  const gas = decimal(fee.gasLimit, "LOCAL_POSITION_STEP_FEE_INVALID");
  const maxFee = decimal(fee.maxFeePerGasBaseUnit, "LOCAL_POSITION_STEP_FEE_INVALID");
  const priority = decimal(fee.maxPriorityFeePerGasBaseUnit, "LOCAL_POSITION_STEP_FEE_INVALID");
  if (
    gas === 0n ||
    maxFee === 0n ||
    priority > maxFee ||
    fee.feeCapBaseUnit !== (gas * maxFee).toString()
  ) {
    throw new RangeError("LOCAL_POSITION_STEP_FEE_INVALID");
  }
}

export function validateLocalPositionExecutionPlan(
  plan: LocalPositionExecutionPlan,
  context: LocalPositionPlanValidationContext,
  now = new Date(),
): void {
  validateLocalPositionSnapshot(plan.snapshot, now);
  const deadline = Date.parse(plan.deadline);
  if (
    plan.schemaVersion !== 2 ||
    plan.planVersion !== LOCAL_POSITION_EXECUTION_PLAN_VERSION ||
    plan.chainId !== 31_337 ||
    !uuidPattern.test(plan.operationId) ||
    !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== plan.deadline ||
    deadline <= now.getTime() ||
    deadline > now.getTime() + 15 * 60_000 ||
    plan.serviceFeeBps !== 0 ||
    !same(plan.wallet, context.expectedWallet) ||
    !same(plan.manager, context.expectedManager) ||
    !same(plan.snapshot, context.expectedSnapshot) ||
    !same(plan.action, context.expectedAction) ||
    !same(plan.accounting, context.expectedAccounting) ||
    !same(plan.accounting, localPositionAccounting(plan.snapshot, plan.action)) ||
    plan.registry.version !== "p05-local-position-execution-v2" ||
    plan.registry.digest !== context.registryDigest ||
    plan.registry.rollbackVersion !== "p05-local-position-execution-disabled-v1" ||
    plan.snapshot.registry.digest !== plan.registry.digest ||
    plan.snapshot.wallet.address !== plan.wallet.address ||
    plan.snapshot.wallet.walletId !== plan.wallet.walletId ||
    plan.snapshot.manager.address !== plan.manager.address ||
    plan.snapshot.manager.runtimeCodeHash !== plan.manager.runtimeCodeHash ||
    plan.snapshot.manager.abiHash !== plan.manager.abiHash ||
    context.currentBlockHash !== plan.snapshot.block.hash ||
    context.currentBlockNumber !== plan.snapshot.block.number
  ) {
    throw new RangeError("LOCAL_POSITION_PLAN_IDENTITY_INVALID");
  }
  const expectedKinds: LocalPositionStepKind[] =
    plan.action.kind === "collect-fees"
      ? ["collect"]
      : plan.action.burnIfEmpty
        ? ["decrease", "collect", "burn"]
        : ["decrease", "collect"];
  if (
    !same(plan.steps, context.expectedSteps) ||
    !same(
      plan.steps.map(({ kind }) => kind),
      expectedKinds,
    ) ||
    (plan.action.kind === "remove-liquidity" &&
      plan.action.burnIfEmpty &&
      (plan.action.percent !== 100 || plan.accounting.remainingLiquidity !== "0"))
  ) {
    throw new RangeError("LOCAL_POSITION_STEP_SET_INVALID");
  }
  const nonces = new Set<string>();
  const fencingTokens = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    validateFee(step.feeLimit);
    const selector =
      step.kind === "decrease"
        ? plan.manager.selectors.decreaseLiquidity
        : plan.manager.selectors[step.kind];
    if (
      step.ordinal !== index ||
      !uuidPattern.test(step.stepId) ||
      decimal(step.nonce, "LOCAL_POSITION_STEP_INVALID") < 0n ||
      decimal(step.fencingToken, "LOCAL_POSITION_STEP_INVALID") === 0n ||
      nonces.has(step.nonce) ||
      fencingTokens.has(step.fencingToken) ||
      step.runCondition !== "always" ||
      step.transaction.to !== plan.manager.address ||
      step.transaction.valueBaseUnit !== "0" ||
      !bytesPattern.test(step.transaction.data) ||
      !step.transaction.data.startsWith(selector) ||
      !digestPattern.test(step.transaction.dataDigest) ||
      !digestPattern.test(step.semanticDigest) ||
      localPositionStepSemanticDigest(step) !== step.semanticDigest
    ) {
      throw new RangeError("LOCAL_POSITION_STEP_INVALID");
    }
    nonces.add(step.nonce);
    fencingTokens.add(step.fencingToken);
  }
  if (
    !digestPattern.test(plan.planDigest) ||
    localPositionExecutionPlanDigest(plan) !== plan.planDigest
  ) {
    throw new RangeError("LOCAL_POSITION_PLAN_DIGEST_MISMATCH");
  }
}

export function validateLocalPositionReplacement(
  step: LocalPositionPlanStep,
  previous: LocalPositionReplacementCandidate,
  next: LocalPositionReplacementCandidate,
  planDigest: `sha256:${string}`,
): void {
  const previousMax = decimal(previous.fee.maxFeePerGasBaseUnit, "LOCAL_POSITION_REPLACEMENT_INVALID");
  const previousPriority = decimal(
    previous.fee.maxPriorityFeePerGasBaseUnit,
    "LOCAL_POSITION_REPLACEMENT_INVALID",
  );
  const nextMax = decimal(next.fee.maxFeePerGasBaseUnit, "LOCAL_POSITION_REPLACEMENT_INVALID");
  const nextPriority = decimal(
    next.fee.maxPriorityFeePerGasBaseUnit,
    "LOCAL_POSITION_REPLACEMENT_INVALID",
  );
  if (
    previous.planDigest !== planDigest ||
    next.planDigest !== planDigest ||
    previous.semanticDigest !== step.semanticDigest ||
    next.semanticDigest !== step.semanticDigest ||
    previous.dataDigest !== step.transaction.dataDigest ||
    next.dataDigest !== step.transaction.dataDigest ||
    previous.target !== step.transaction.to ||
    next.target !== step.transaction.to ||
    previous.nonce !== step.nonce ||
    next.nonce !== step.nonce ||
    nextMax < previousMax ||
    nextPriority < previousPriority ||
    (nextMax === previousMax && nextPriority === previousPriority) ||
    nextMax > BigInt(step.feeLimit.maxFeePerGasBaseUnit) ||
    nextPriority > BigInt(step.feeLimit.maxPriorityFeePerGasBaseUnit)
  ) {
    throw new RangeError("LOCAL_POSITION_REPLACEMENT_INVALID");
  }
}
