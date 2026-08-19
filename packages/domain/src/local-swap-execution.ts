import { createHash } from "node:crypto";

export const LOCAL_SWAP_EXECUTION_PLAN_VERSION = "p05-local-swap-plan-v2" as const;

export type LocalSwapAuthorizationMode = "direct" | "permit2";
export type LocalSwapStepKind = "allowance-reset" | "approve" | "swap" | "cleanup";

export interface LocalSwapFeeLimit {
  feeCapBaseUnit: string;
  gasLimit: string;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
}

export interface LocalSwapPlanStep {
  feeLimit: LocalSwapFeeLimit;
  fencingToken: string;
  kind: LocalSwapStepKind;
  nonce: string;
  ordinal: number;
  runCondition: "always" | "swap-failed-after-approval";
  semanticDigest: `sha256:${string}`;
  stepId: string;
  transaction: {
    data: `0x${string}`;
    dataDigest: `sha256:${string}`;
    to: `0x${string}`;
    valueBaseUnit: "0";
  };
}

export interface LocalSwapPermit2Authorization {
  amountBaseUnit: string;
  domainSeparator: `0x${string}`;
  expiration: string;
  nonce: string;
  permit2: `0x${string}`;
  sigDeadline: string;
  signature: `0x${string}`;
  signatureDigest: `sha256:${string}`;
  spender: `0x${string}`;
  token: `0x${string}`;
}

export interface LocalSwapExecutionPlan {
  authorization:
    | { approvalSpender: `0x${string}`; mode: "direct"; permit2: null }
    | { approvalSpender: `0x${string}`; mode: "permit2"; permit2: LocalSwapPermit2Authorization };
  chainId: 31_337;
  deadline: string;
  helper: {
    adapter: `0x${string}`;
    address: `0x${string}`;
    bindingId: string;
    helperVersion: "WalletHelperV1";
    owner: `0x${string}`;
    permit2: `0x${string}`;
    runtimeCodeHash: `0x${string}`;
    verifiedBlockNumber: string;
  };
  helperPlanDigest: `0x${string}`;
  operationId: string;
  planDigest: `sha256:${string}`;
  planVersion: typeof LOCAL_SWAP_EXECUTION_PLAN_VERSION;
  quote: {
    amountInBaseUnit: string;
    amountOutBaseUnit: string;
    blockHash: `0x${string}`;
    blockNumber: string;
    deadline: string;
    expiresAt: string;
    maxBlockNumber: string;
    minOutBaseUnit: string;
    quoteDigest: `sha256:${string}`;
    quoteVersion: "p05-local-swap-quote-v2";
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
  };
  registry: {
    digest: `sha256:${string}`;
    rollbackVersion: "p05-local-swap-execution-disabled-v1";
    version: "p05-local-swap-execution-v2";
  };
  schemaVersion: 2;
  serviceFeeBps: 0;
  steps: readonly LocalSwapPlanStep[];
  wallet: { address: `0x${string}`; walletId: string };
}

export interface LocalSwapPlanValidationContext {
  authorizationMode: LocalSwapAuthorizationMode;
  currentBlockNumber: string;
  expectedHelper: LocalSwapExecutionPlan["helper"];
  expectedHelperPlanDigest: `0x${string}`;
  expectedQuote: LocalSwapExecutionPlan["quote"];
  expectedSteps: readonly LocalSwapPlanStep[];
  expectedWallet: LocalSwapExecutionPlan["wallet"];
  registryDigest: `sha256:${string}`;
  registryRollbackVersion: "p05-local-swap-execution-disabled-v1";
  registryVersion: "p05-local-swap-execution-v2";
}

const addressPattern = /^0x[0-9a-f]{40}$/u;
const bytesPattern = /^0x(?:[0-9a-f]{2})*$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function canonical(value: unknown, key?: string): unknown {
  if (key === "planDigest") return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entry]) => {
          const next = canonical(entry, entryKey);
          return next === undefined ? [] : [[entryKey, next]];
        }),
    );
  }
  return value;
}

function stable(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function localSwapExecutionPlanDigest(
  plan: LocalSwapExecutionPlan,
): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("LPXBOT_LOCAL_SWAP_PLAN\0v2\0", "utf8")
    .update(stable(plan), "utf8")
    .digest("hex")}`;
}

export function localSwapStepSemanticDigest(
  step: Omit<LocalSwapPlanStep, "semanticDigest"> | LocalSwapPlanStep,
): `sha256:${string}` {
  const payload = { ...step, semanticDigest: undefined };
  return `sha256:${createHash("sha256")
    .update("LPXBOT_LOCAL_SWAP_STEP\0v2\0", "utf8")
    .update(stable(payload), "utf8")
    .digest("hex")}`;
}

function decimal(value: string, code: string, positive = false): bigint {
  if (!decimalPattern.test(value) || value.length > 78) throw new RangeError(code);
  const parsed = BigInt(value);
  if (positive && parsed === 0n) throw new RangeError(code);
  return parsed;
}

function same(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

function validateFee(fee: LocalSwapFeeLimit): void {
  const gas = decimal(fee.gasLimit, "LOCAL_SWAP_STEP_FEE_INVALID", true);
  const maxFee = decimal(fee.maxFeePerGasBaseUnit, "LOCAL_SWAP_STEP_FEE_INVALID", true);
  const priority = decimal(fee.maxPriorityFeePerGasBaseUnit, "LOCAL_SWAP_STEP_FEE_INVALID");
  if (priority > maxFee || fee.feeCapBaseUnit !== (gas * maxFee).toString()) {
    throw new RangeError("LOCAL_SWAP_STEP_FEE_INVALID");
  }
}

export function validateLocalSwapExecutionPlan(
  plan: LocalSwapExecutionPlan,
  context: LocalSwapPlanValidationContext,
  now: Date = new Date(),
): void {
  const deadline = Date.parse(plan.deadline);
  if (
    plan.schemaVersion !== 2 ||
    plan.planVersion !== LOCAL_SWAP_EXECUTION_PLAN_VERSION ||
    plan.chainId !== 31_337 ||
    !uuidPattern.test(plan.operationId) ||
    !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== plan.deadline ||
    deadline <= now.getTime() ||
    deadline > now.getTime() + 15 * 60 * 1_000 ||
    plan.serviceFeeBps !== 0 ||
    plan.authorization.mode !== context.authorizationMode ||
    !same(plan.wallet, context.expectedWallet) ||
    !same(plan.helper, context.expectedHelper) ||
    !same(plan.quote, context.expectedQuote) ||
    plan.helperPlanDigest !== context.expectedHelperPlanDigest ||
    plan.registry.version !== context.registryVersion ||
    plan.registry.digest !== context.registryDigest ||
    plan.registry.rollbackVersion !== context.registryRollbackVersion
  ) {
    throw new RangeError("LOCAL_SWAP_PLAN_IDENTITY_INVALID");
  }
  if (
    !addressPattern.test(plan.wallet.address) ||
    !uuidPattern.test(plan.wallet.walletId) ||
    !addressPattern.test(plan.helper.address) ||
    plan.helper.owner !== plan.wallet.address ||
    !hashPattern.test(plan.helper.runtimeCodeHash) ||
    !hashPattern.test(plan.helperPlanDigest) ||
    !digestPattern.test(plan.quote.quoteDigest) ||
    !hashPattern.test(plan.quote.blockHash) ||
    !decimalPattern.test(context.currentBlockNumber) ||
    BigInt(context.currentBlockNumber) > BigInt(plan.quote.maxBlockNumber) ||
    now.getTime() >= Date.parse(plan.quote.expiresAt) ||
    now.getTime() >= Date.parse(plan.quote.deadline) ||
    BigInt(plan.quote.minOutBaseUnit) > BigInt(plan.quote.amountOutBaseUnit) ||
    BigInt(plan.quote.minOutBaseUnit) === 0n
  ) {
    throw new RangeError("LOCAL_SWAP_QUOTE_STALE_OR_CHANGED");
  }
  if (!same(plan.steps, context.expectedSteps) || plan.steps.length < 3 || plan.steps.length > 4) {
    throw new RangeError("LOCAL_SWAP_STEP_SET_INVALID");
  }
  const kinds = plan.steps.map(({ kind }) => kind);
  const expectedKinds = kinds[0] === "allowance-reset"
    ? ["allowance-reset", "approve", "swap", "cleanup"]
    : ["approve", "swap", "cleanup"];
  if (!same(kinds, expectedKinds)) throw new RangeError("LOCAL_SWAP_STEP_ORDER_INVALID");
  const nonces = new Set<string>();
  const fencingTokens = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    decimal(step.nonce, "LOCAL_SWAP_STEP_NONCE_INVALID");
    decimal(step.fencingToken, "LOCAL_SWAP_STEP_FENCING_INVALID", true);
    validateFee(step.feeLimit);
    if (
      step.ordinal !== index ||
      !uuidPattern.test(step.stepId) ||
      nonces.has(step.nonce) ||
      fencingTokens.has(step.fencingToken) ||
      !addressPattern.test(step.transaction.to) ||
      step.transaction.valueBaseUnit !== "0" ||
      !bytesPattern.test(step.transaction.data) ||
      !digestPattern.test(step.transaction.dataDigest) ||
      step.semanticDigest !== localSwapStepSemanticDigest(step) ||
      (step.kind === "cleanup") !== (step.runCondition === "swap-failed-after-approval")
    ) {
      throw new RangeError("LOCAL_SWAP_STEP_INVALID");
    }
    nonces.add(step.nonce);
    fencingTokens.add(step.fencingToken);
  }
  if (plan.authorization.mode === "direct") {
    if (plan.authorization.permit2 !== null || plan.authorization.approvalSpender !== plan.helper.address) {
      throw new RangeError("LOCAL_SWAP_DIRECT_APPROVAL_INVALID");
    }
  } else {
    const permit = plan.authorization.permit2;
    if (
      plan.authorization.approvalSpender !== plan.helper.permit2 ||
      permit.permit2 !== plan.helper.permit2 ||
      permit.spender !== plan.helper.address ||
      permit.token !== plan.quote.tokenIn ||
      permit.amountBaseUnit !== plan.quote.amountInBaseUnit ||
      !decimalPattern.test(permit.nonce) ||
      !decimalPattern.test(permit.expiration) ||
      !decimalPattern.test(permit.sigDeadline) ||
      BigInt(permit.expiration) * 1_000n <= BigInt(now.getTime()) ||
      BigInt(permit.sigDeadline) > BigInt(Math.floor(Date.parse(plan.quote.deadline) / 1_000)) ||
      !hashPattern.test(permit.domainSeparator) ||
      !bytesPattern.test(permit.signature) ||
      permit.signature === "0x" ||
      !digestPattern.test(permit.signatureDigest)
    ) {
      throw new RangeError("LOCAL_SWAP_PERMIT2_INVALID");
    }
    const signatureDigest = `sha256:${createHash("sha256")
      .update(Buffer.from(permit.signature.slice(2), "hex"))
      .digest("hex")}`;
    if (signatureDigest !== permit.signatureDigest) {
      throw new RangeError("LOCAL_SWAP_PERMIT2_SIGNATURE_INVALID");
    }
  }
  if (!digestPattern.test(plan.planDigest) || localSwapExecutionPlanDigest(plan) !== plan.planDigest) {
    throw new RangeError("LOCAL_SWAP_PLAN_DIGEST_MISMATCH");
  }
}

export interface LocalSwapReplacementCandidate {
  dataDigest: `sha256:${string}`;
  fee: Pick<LocalSwapFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
  nonce: string;
  planDigest: `sha256:${string}`;
  semanticDigest: `sha256:${string}`;
  target: `0x${string}`;
}

export interface LocalSwapPermit2SigningPayload {
  amountBaseUnit: string;
  domainSeparator: `0x${string}`;
  expiration: string;
  nonce: string;
  permit2: `0x${string}`;
  quoteDigest: `sha256:${string}`;
  sigDeadline: string;
  spender: `0x${string}`;
  token: `0x${string}`;
  walletId: string;
}

export function localSwapPermit2AuthorizationDigest(
  payload: LocalSwapPermit2SigningPayload,
): `0x${string}` {
  if (
    !addressPattern.test(payload.permit2) ||
    !addressPattern.test(payload.spender) ||
    !addressPattern.test(payload.token) ||
    !hashPattern.test(payload.domainSeparator) ||
    !digestPattern.test(payload.quoteDigest) ||
    !uuidPattern.test(payload.walletId)
  ) {
    throw new RangeError("LOCAL_SWAP_PERMIT2_PAYLOAD_INVALID");
  }
  decimal(payload.amountBaseUnit, "LOCAL_SWAP_PERMIT2_PAYLOAD_INVALID", true);
  decimal(payload.expiration, "LOCAL_SWAP_PERMIT2_PAYLOAD_INVALID", true);
  decimal(payload.nonce, "LOCAL_SWAP_PERMIT2_PAYLOAD_INVALID");
  decimal(payload.sigDeadline, "LOCAL_SWAP_PERMIT2_PAYLOAD_INVALID", true);
  return `0x${createHash("sha256")
    .update("LPXBOT_LOCAL_PERMIT2_AUTHORIZATION\0v2\0", "utf8")
    .update(stable(payload), "utf8")
    .digest("hex")}`;
}

export function validateLocalSwapReplacement(
  step: LocalSwapPlanStep,
  previous: LocalSwapReplacementCandidate,
  next: LocalSwapReplacementCandidate,
  planDigest: `sha256:${string}`,
): void {
  const previousMax = decimal(previous.fee.maxFeePerGasBaseUnit, "LOCAL_SWAP_REPLACEMENT_INVALID", true);
  const previousPriority = decimal(previous.fee.maxPriorityFeePerGasBaseUnit, "LOCAL_SWAP_REPLACEMENT_INVALID");
  const nextMax = decimal(next.fee.maxFeePerGasBaseUnit, "LOCAL_SWAP_REPLACEMENT_INVALID", true);
  const nextPriority = decimal(next.fee.maxPriorityFeePerGasBaseUnit, "LOCAL_SWAP_REPLACEMENT_INVALID");
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
    throw new RangeError("LOCAL_SWAP_REPLACEMENT_INVALID");
  }
}
