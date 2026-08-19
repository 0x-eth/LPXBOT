import {
  localPositionExecutionPlanDigest,
  validateLocalPositionReplacement,
  type LocalPositionExecutionPlan,
  type LocalPositionFeeLimit,
  type LocalPositionPlanStep,
  type LocalPositionReplacementCandidate,
} from "@lpbot/domain/local-position-execution";

export interface LocalPositionTransactionReference extends LocalPositionReplacementCandidate {
  active: boolean;
  generation: number;
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface LocalPositionStepWorkOperation {
  activeTransaction: LocalPositionTransactionReference | null;
  operationId: string;
  operationState: "queued" | "signing" | "broadcast" | "pending" | "reconciling";
  plan: LocalPositionExecutionPlan;
  planDigest: `sha256:${string}`;
  priorSucceededStepIds: readonly string[];
  reauthenticatedSessionId: string | null;
  step: LocalPositionPlanStep;
  stepState:
    "queued" | "signed" | "broadcast" | "pending" | "confirmed" | "dropped" | "reconciling";
  tenantId: string;
  transactionLineage: readonly LocalPositionTransactionReference[];
  userId: string;
}

export interface LocalPositionWorkClaim {
  leaseToken: string;
  operation: LocalPositionStepWorkOperation;
  outboxEventId: string;
}

export interface LocalPositionReceiptObservation {
  blockCanonical: boolean;
  blockHash: `0x${string}`;
  blockNumber: string;
  burnEvent: boolean | null;
  collectAmount0: string | null;
  collectAmount1: string | null;
  collectRecipient: `0x${string}` | null;
  confirmations: string;
  decreaseAmount0: string | null;
  decreaseAmount1: string | null;
  decreaseLiquidityDelta: string | null;
  liquidityAfter: string | null;
  liquidityBefore: string | null;
  managerRuntimeCodeHash: `0x${string}` | null;
  ownerAfter: `0x${string}` | null;
  ownerBefore: `0x${string}` | null;
  receiptStatus: "reverted" | "success";
  reserve0After: string | null;
  reserve0Before: string | null;
  reserve1After: string | null;
  reserve1Before: string | null;
  tokensOwed0After: string | null;
  tokensOwed0Before: string | null;
  tokensOwed1After: string | null;
  tokensOwed1Before: string | null;
  transactionHash: `0x${string}`;
  walletToken0After: string | null;
  walletToken0Before: string | null;
  walletToken0Delta: string | null;
  walletToken1After: string | null;
  walletToken1Before: string | null;
  walletToken1Delta: string | null;
}

export interface LocalPositionProviderObservation {
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
  receipt: LocalPositionReceiptObservation | null;
  transactionFound: boolean;
}

export interface LocalPositionObservation {
  providers: readonly LocalPositionProviderObservation[];
}

export type LocalPositionObservationDecision =
  | {
      kind: "defer";
      operationState: "broadcast" | "pending" | "reconciling";
      reason: string;
      stepState: "broadcast" | "pending";
    }
  | {
      kind: "transition";
      operationState: "pending" | "reconciling";
      reason: string | null;
      stepState: "pending" | "dropped" | "reconciling";
    }
  | {
      failureCode: string | null;
      kind: "receipt";
      next: "advance" | "complete-failed" | "complete-success" | "reconciling";
      operationState: "pending" | "reconciling" | "failed" | "succeeded";
      reason: string | null;
      receipt: LocalPositionReceiptObservation;
      stepState: "confirmed" | "failed" | "reconciling" | "succeeded";
      transactionId: string;
    };

export interface LocalPositionStepSignerResult {
  deliveryId: string;
  generation: number;
  planDigest: `sha256:${string}`;
  status: "accepted" | "already-known";
  stepId: string;
  transactionHash: `0x${string}`;
}

export interface LocalPositionStepSignerGateway {
  signAndDeliver(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    plan: LocalPositionExecutionPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    stepId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalPositionStepSignerResult>;
}

export interface LocalPositionObserver {
  observe(input: {
    plan: LocalPositionExecutionPlan;
    step: LocalPositionPlanStep;
    transactionHash: `0x${string}`;
  }): Promise<LocalPositionObservation>;
}

export interface LocalPositionReplacementAuthorization {
  expiresAt: string;
  generation: number;
  next: LocalPositionReplacementCandidate;
  operationId: string;
  plan: LocalPositionExecutionPlan;
  previous: LocalPositionReplacementCandidate;
  reauthenticatedSessionId: string | null;
  stepId: string;
  tenantId: string;
  userId: string;
}

export interface LocalPositionWorkRepository {
  applyObservation(input: {
    claim: LocalPositionWorkClaim;
    decision: LocalPositionObservationDecision;
    observedAt: Date;
  }): Promise<void>;
  claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalPositionWorkClaim[]>;
  completeBroadcast(input: {
    claim: LocalPositionWorkClaim;
    deliveredAt: Date;
    result: LocalPositionStepSignerResult;
  }): Promise<void>;
  completeReplacement(input: {
    authorization: LocalPositionReplacementAuthorization;
    deliveredAt: Date;
    result: LocalPositionStepSignerResult;
  }): Promise<void>;
  failClaim(input: {
    claim: LocalPositionWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
  prepareReplacement(input: {
    fee: Pick<LocalPositionFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
    now: Date;
    operationId: string;
    reason: string;
    stepId: string;
  }): Promise<LocalPositionReplacementAuthorization>;
  rejectReplacement(input: {
    authorization: LocalPositionReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
}

export class LocalPositionWorkerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalPositionWorkerError";
  }
}

const hashPattern = /^0x[0-9a-f]{64}$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function decimal(value: string, positive = false): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 78) {
    throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_EVIDENCE_INVALID");
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) {
    throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_EVIDENCE_INVALID");
  }
  return parsed;
}

function instant(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_EVIDENCE_INVALID");
  }
  return parsed.getTime();
}

export function validateLocalPositionWorkPlan(operation: LocalPositionStepWorkOperation): void {
  const { plan } = operation;
  const step = plan.steps.find(({ stepId }) => stepId === operation.step.stepId);
  const selector =
    step?.kind === "decrease"
      ? plan.manager.selectors.decreaseLiquidity
      : step
        ? plan.manager.selectors[step.kind]
        : null;
  const expectedPrior = plan.steps.slice(0, step?.ordinal ?? 0).map(({ stepId }) => stepId);
  if (
    !step ||
    step.semanticDigest !== operation.step.semanticDigest ||
    !digestPattern.test(operation.planDigest) ||
    plan.planDigest !== operation.planDigest ||
    localPositionExecutionPlanDigest(plan) !== operation.planDigest ||
    plan.operationId !== operation.operationId ||
    plan.chainId !== 31_337 ||
    plan.planVersion !== "p05-local-position-plan-v2" ||
    plan.registry.version !== "p05-local-position-execution-v2" ||
    plan.serviceFeeBps !== 0 ||
    plan.manager.address !== plan.snapshot.manager.address ||
    plan.wallet.address !== plan.snapshot.position.owner ||
    step.transaction.to !== plan.manager.address ||
    selector === null ||
    !step.transaction.data.startsWith(selector) ||
    new Set(operation.priorSucceededStepIds).size !== operation.priorSucceededStepIds.length ||
    expectedPrior.length !== operation.priorSucceededStepIds.length ||
    expectedPrior.some((stepId, index) => stepId !== operation.priorSucceededStepIds[index])
  ) {
    throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_PLAN_INVALID");
  }
}

function optionalDecimal(value: string | null): string | null {
  if (value === null) return null;
  return decimal(value).toString();
}

function receiptIdentity(receipt: LocalPositionReceiptObservation | null): string {
  if (!receipt) return "none";
  decimal(receipt.blockNumber);
  decimal(receipt.confirmations, true);
  if (
    !hashPattern.test(receipt.blockHash) ||
    !hashPattern.test(receipt.transactionHash) ||
    (receipt.managerRuntimeCodeHash !== null &&
      !hashPattern.test(receipt.managerRuntimeCodeHash)) ||
    (receipt.ownerBefore !== null && !addressPattern.test(receipt.ownerBefore)) ||
    (receipt.ownerAfter !== null && !addressPattern.test(receipt.ownerAfter)) ||
    (receipt.collectRecipient !== null && !addressPattern.test(receipt.collectRecipient))
  ) {
    throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_EVIDENCE_INVALID");
  }
  for (const value of [
    receipt.collectAmount0,
    receipt.collectAmount1,
    receipt.decreaseAmount0,
    receipt.decreaseAmount1,
    receipt.decreaseLiquidityDelta,
    receipt.liquidityAfter,
    receipt.liquidityBefore,
    receipt.reserve0After,
    receipt.reserve0Before,
    receipt.reserve1After,
    receipt.reserve1Before,
    receipt.tokensOwed0After,
    receipt.tokensOwed0Before,
    receipt.tokensOwed1After,
    receipt.tokensOwed1Before,
    receipt.walletToken0After,
    receipt.walletToken0Before,
    receipt.walletToken0Delta,
    receipt.walletToken1After,
    receipt.walletToken1Before,
    receipt.walletToken1Delta,
  ]) {
    optionalDecimal(value);
  }
  return JSON.stringify(receipt);
}

function consensus(observation: LocalPositionObservation): LocalPositionProviderObservation | null {
  if (observation.providers.length === 0) return null;
  const providers = new Set<string>();
  const identities = new Set<string>();
  for (const provider of observation.providers) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(provider.providerId) ||
      providers.has(provider.providerId)
    ) {
      throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_EVIDENCE_INVALID");
    }
    providers.add(provider.providerId);
    const latest = decimal(provider.latestNonce);
    const pending = decimal(provider.pendingNonce);
    if (pending < latest) {
      throw new LocalPositionWorkerError("NONCE_PENDING_BEHIND_LATEST");
    }
    identities.add(
      JSON.stringify([
        latest.toString(),
        pending.toString(),
        provider.transactionFound,
        receiptIdentity(provider.receipt),
      ]),
    );
  }
  if (identities.size !== 1) throw new LocalPositionWorkerError("PROVIDER_DIVERGENCE");
  return observation.providers[0]!;
}

interface PositionState {
  liquidity: string;
  owed0: string;
  owed1: string;
  reserve0: string;
  reserve1: string;
}

function beforeState(plan: LocalPositionExecutionPlan, step: LocalPositionPlanStep): PositionState {
  const snapshot = plan.snapshot.position;
  if (step.kind === "decrease" || plan.action.kind === "collect-fees") {
    return {
      liquidity: snapshot.liquidity,
      owed0: snapshot.tokensOwed0BaseUnit,
      owed1: snapshot.tokensOwed1BaseUnit,
      reserve0: snapshot.reserve0BaseUnit,
      reserve1: snapshot.reserve1BaseUnit,
    };
  }
  if (step.kind === "collect") {
    return {
      liquidity: plan.accounting.remainingLiquidity,
      owed0: plan.accounting.collectTotal0BaseUnit,
      owed1: plan.accounting.collectTotal1BaseUnit,
      reserve0: (
        BigInt(snapshot.reserve0BaseUnit) - BigInt(plan.accounting.principal0BaseUnit)
      ).toString(),
      reserve1: (
        BigInt(snapshot.reserve1BaseUnit) - BigInt(plan.accounting.principal1BaseUnit)
      ).toString(),
    };
  }
  return {
    liquidity: "0",
    owed0: "0",
    owed1: "0",
    reserve0: "0",
    reserve1: "0",
  };
}

function positionMatches(
  receipt: LocalPositionReceiptObservation,
  prefix: "Before" | "After",
  expected: PositionState,
): boolean {
  return (
    receipt[`liquidity${prefix}`] === expected.liquidity &&
    receipt[`reserve0${prefix}`] === expected.reserve0 &&
    receipt[`reserve1${prefix}`] === expected.reserve1 &&
    receipt[`tokensOwed0${prefix}`] === expected.owed0 &&
    receipt[`tokensOwed1${prefix}`] === expected.owed1
  );
}

function walletDeltaMatches(
  receipt: LocalPositionReceiptObservation,
  amount0: string,
  amount1: string,
) {
  if (
    receipt.walletToken0Before === null ||
    receipt.walletToken0After === null ||
    receipt.walletToken1Before === null ||
    receipt.walletToken1After === null
  ) {
    return false;
  }
  return (
    receipt.walletToken0Delta === amount0 &&
    receipt.walletToken1Delta === amount1 &&
    BigInt(receipt.walletToken0After) - BigInt(receipt.walletToken0Before) === BigInt(amount0) &&
    BigInt(receipt.walletToken1After) - BigInt(receipt.walletToken1Before) === BigInt(amount1)
  );
}

function postconditionFailure(
  plan: LocalPositionExecutionPlan,
  step: LocalPositionPlanStep,
  receipt: LocalPositionReceiptObservation,
): string | null {
  if (receipt.managerRuntimeCodeHash !== plan.manager.runtimeCodeHash) {
    return "MANAGER_CODE_HASH_MISMATCH";
  }
  if (
    receipt.ownerBefore !== plan.wallet.address ||
    !positionMatches(receipt, "Before", beforeState(plan, step))
  ) {
    return "POSITION_BEFORE_MISMATCH";
  }
  if (step.kind === "decrease") {
    const after: PositionState = {
      liquidity: plan.accounting.remainingLiquidity,
      owed0: (
        BigInt(plan.snapshot.position.tokensOwed0BaseUnit) +
        BigInt(plan.accounting.principal0BaseUnit)
      ).toString(),
      owed1: (
        BigInt(plan.snapshot.position.tokensOwed1BaseUnit) +
        BigInt(plan.accounting.principal1BaseUnit)
      ).toString(),
      reserve0: (
        BigInt(plan.snapshot.position.reserve0BaseUnit) - BigInt(plan.accounting.principal0BaseUnit)
      ).toString(),
      reserve1: (
        BigInt(plan.snapshot.position.reserve1BaseUnit) - BigInt(plan.accounting.principal1BaseUnit)
      ).toString(),
    };
    if (
      receipt.ownerAfter !== plan.wallet.address ||
      !positionMatches(receipt, "After", after) ||
      receipt.decreaseLiquidityDelta !== plan.accounting.liquidityDelta ||
      receipt.decreaseAmount0 !== plan.accounting.principal0BaseUnit ||
      receipt.decreaseAmount1 !== plan.accounting.principal1BaseUnit ||
      !walletDeltaMatches(receipt, "0", "0")
    ) {
      return "DECREASE_POSTCONDITION_MISMATCH";
    }
    return null;
  }
  if (step.kind === "collect") {
    const before = beforeState(plan, step);
    const after = { ...before, owed0: "0", owed1: "0" };
    if (
      receipt.ownerAfter !== plan.wallet.address ||
      !positionMatches(receipt, "After", after) ||
      receipt.collectRecipient !== plan.wallet.address ||
      receipt.collectAmount0 !== plan.accounting.collectTotal0BaseUnit ||
      receipt.collectAmount1 !== plan.accounting.collectTotal1BaseUnit ||
      !walletDeltaMatches(
        receipt,
        plan.accounting.collectTotal0BaseUnit,
        plan.accounting.collectTotal1BaseUnit,
      )
    ) {
      return "COLLECT_POSTCONDITION_MISMATCH";
    }
    return null;
  }
  if (
    receipt.ownerAfter !== null ||
    receipt.liquidityAfter !== null ||
    receipt.reserve0After !== null ||
    receipt.reserve1After !== null ||
    receipt.tokensOwed0After !== null ||
    receipt.tokensOwed1After !== null ||
    receipt.burnEvent !== true ||
    !walletDeltaMatches(receipt, "0", "0")
  ) {
    return "BURN_POSTCONDITION_MISMATCH";
  }
  return null;
}

export function decideLocalPositionObservation(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observation: LocalPositionObservation;
  operation: LocalPositionStepWorkOperation;
  requiredConfirmations: number;
  transaction?: LocalPositionTransactionReference;
}): LocalPositionObservationDecision {
  let provider: LocalPositionProviderObservation | null;
  try {
    provider = consensus(input.observation);
  } catch (error) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: error instanceof LocalPositionWorkerError ? error.code : "PROVIDER_DIVERGENCE",
      stepState: "reconciling",
    };
  }
  if (!provider) {
    return input.operation.stepState === "confirmed"
      ? {
          kind: "transition",
          operationState: "reconciling",
          reason: "REORG_PROVIDER_UNAVAILABLE",
          stepState: "reconciling",
        }
      : {
          kind: "defer",
          operationState: input.operation.stepState === "broadcast" ? "broadcast" : "pending",
          reason: "AWAITING_PROVIDER",
          stepState: input.operation.stepState === "broadcast" ? "broadcast" : "pending",
        };
  }
  const transaction = input.transaction ?? input.operation.activeTransaction;
  if (!transaction) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: "ACTIVE_TRANSACTION_MISSING",
      stepState: "reconciling",
    };
  }
  const receipt = provider.receipt;
  if (receipt) {
    if (!receipt.blockCanonical) {
      return {
        failureCode: null,
        kind: "receipt",
        next: "reconciling",
        operationState: "reconciling",
        reason: "REORG_BLOCK_NONCANONICAL",
        receipt,
        stepState: "reconciling",
        transactionId: transaction.transactionId,
      };
    }
    if (receipt.receiptStatus === "reverted") {
      return {
        failureCode: `${input.operation.step.kind.toUpperCase()}_REVERTED`,
        kind: "receipt",
        next: "complete-failed",
        operationState: "failed",
        reason: null,
        receipt,
        stepState: "failed",
        transactionId: transaction.transactionId,
      };
    }
    if (BigInt(receipt.confirmations) < BigInt(input.requiredConfirmations)) {
      return {
        failureCode: null,
        kind: "receipt",
        next: "advance",
        operationState: "pending",
        reason: "CONFIRMATIONS_PENDING",
        receipt,
        stepState: "confirmed",
        transactionId: transaction.transactionId,
      };
    }
    const failure = postconditionFailure(input.operation.plan, input.operation.step, receipt);
    if (failure) {
      return {
        failureCode: failure,
        kind: "receipt",
        next: "reconciling",
        operationState: "reconciling",
        reason: failure,
        receipt,
        stepState: "reconciling",
        transactionId: transaction.transactionId,
      };
    }
    const complete = input.operation.step.ordinal === input.operation.plan.steps.length - 1;
    return {
      failureCode: null,
      kind: "receipt",
      next: complete ? "complete-success" : "advance",
      operationState: complete ? "succeeded" : "pending",
      reason: null,
      receipt,
      stepState: "succeeded",
      transactionId: transaction.transactionId,
    };
  }
  if (input.operation.stepState === "confirmed") {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: "REORG_RECEIPT_REMOVED",
      stepState: "reconciling",
    };
  }
  if (provider.transactionFound) {
    return {
      kind: "transition",
      operationState: "pending",
      reason: null,
      stepState: "pending",
    };
  }
  if (input.now.getTime() - instant(transaction.updatedAt) < input.dropAfterMilliseconds) {
    return {
      kind: "defer",
      operationState: input.operation.stepState === "broadcast" ? "broadcast" : "pending",
      reason: "AWAITING_TRANSACTION",
      stepState: input.operation.stepState === "broadcast" ? "broadcast" : "pending",
    };
  }
  if (
    decimal(provider.latestNonce) > BigInt(input.operation.step.nonce) ||
    decimal(provider.pendingNonce) > BigInt(input.operation.step.nonce)
  ) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
      stepState: "reconciling",
    };
  }
  return {
    kind: "transition",
    operationState: "pending",
    reason: null,
    stepState: "dropped",
  };
}

function failure(error: unknown): { code: string; retryable: boolean } {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return {
      code: (error as { code: string }).code,
      retryable: "retryable" in error && (error as { retryable?: unknown }).retryable === true,
    };
  }
  return { code: "LOCAL_POSITION_WORKER_UNAVAILABLE", retryable: true };
}

export interface LocalPositionBatchResult {
  broadcast: number;
  claimed: number;
  failed: number;
  observed: number;
  retried: number;
}

export class LocalPositionRecoveryWorker {
  readonly #dropAfterMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #limit: number;
  readonly #now: () => Date;
  readonly #observer: LocalPositionObserver;
  readonly #repository: LocalPositionWorkRepository;
  readonly #requiredConfirmations: number;
  readonly #signer: LocalPositionStepSignerGateway;
  readonly #workerId: string;

  constructor(input: {
    dropAfterMilliseconds?: number;
    leaseMilliseconds?: number;
    limit?: number;
    now?: () => Date;
    observer: LocalPositionObserver;
    repository: LocalPositionWorkRepository;
    requiredConfirmations?: number;
    signer: LocalPositionStepSignerGateway;
    workerId: string;
  }) {
    this.#dropAfterMilliseconds = input.dropAfterMilliseconds ?? 15 * 60 * 1_000;
    this.#leaseMilliseconds = input.leaseMilliseconds ?? 60_000;
    this.#limit = input.limit ?? 20;
    this.#requiredConfirmations = input.requiredConfirmations ?? 1;
    if (
      this.#dropAfterMilliseconds < 1_000 ||
      this.#leaseMilliseconds < 1_000 ||
      this.#limit < 1 ||
      this.#limit > 100 ||
      this.#requiredConfirmations < 1 ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(input.workerId)
    ) {
      throw new RangeError("Local Position worker configuration is invalid");
    }
    this.#now = input.now ?? (() => new Date());
    this.#observer = input.observer;
    this.#repository = input.repository;
    this.#signer = input.signer;
    this.#workerId = input.workerId;
  }

  async processBatch(): Promise<LocalPositionBatchResult> {
    const claims = await this.#repository.claimDue({
      leaseMilliseconds: this.#leaseMilliseconds,
      limit: this.#limit,
      now: this.#now(),
      workerId: this.#workerId,
    });
    const result = { broadcast: 0, claimed: claims.length, failed: 0, observed: 0, retried: 0 };
    for (const claim of claims) {
      try {
        this.#assertClaim(claim);
        if (claim.operation.stepState === "queued") {
          const signed = await this.#signer.signAndDeliver({
            generation: 0,
            ...initialFee(claim.operation.step.feeLimit),
            plan: claim.operation.plan,
            planDigest: claim.operation.planDigest,
            ...(claim.operation.reauthenticatedSessionId
              ? { reauthenticatedSessionId: claim.operation.reauthenticatedSessionId }
              : {}),
            stepId: claim.operation.step.stepId,
            tenantId: claim.operation.tenantId,
            userId: claim.operation.userId,
          });
          this.#assertSignerResult(claim.operation, signed);
          await this.#repository.completeBroadcast({
            claim,
            deliveredAt: this.#now(),
            result: signed,
          });
          result.broadcast += 1;
          continue;
        }
        if (!claim.operation.activeTransaction || claim.operation.transactionLineage.length === 0) {
          throw new LocalPositionWorkerError("ACTIVE_TRANSACTION_MISSING");
        }
        const observations = await Promise.all(
          claim.operation.transactionLineage.map(async (transaction) => ({
            decision: decideLocalPositionObservation({
              dropAfterMilliseconds: this.#dropAfterMilliseconds,
              now: this.#now(),
              observation: await this.#observer.observe({
                plan: claim.operation.plan,
                step: claim.operation.step,
                transactionHash: transaction.transactionHash,
              }),
              operation: claim.operation,
              requiredConfirmations: this.#requiredConfirmations,
              transaction,
            }),
            transaction,
          })),
        );
        const receipts = observations.filter(({ decision }) => decision.kind === "receipt");
        const decision =
          receipts.length > 1
            ? ({
                kind: "transition",
                operationState: "reconciling",
                reason: "LINEAGE_RECEIPT_DIVERGENCE",
                stepState: "reconciling",
              } as const)
            : (receipts[0]?.decision ??
              observations.find(({ decision }) => decision.operationState === "reconciling")
                ?.decision ??
              observations.at(-1)!.decision);
        await this.#repository.applyObservation({ claim, decision, observedAt: this.#now() });
        result.observed += 1;
      } catch (error) {
        const failed = failure(error);
        await this.#repository.failClaim({ claim, failedAt: this.#now(), ...failed });
        if (failed.retryable) result.retried += 1;
        else result.failed += 1;
      }
    }
    return result;
  }

  async replace(input: {
    fee: Pick<LocalPositionFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
    operationId: string;
    reason: string;
    stepId: string;
  }): Promise<LocalPositionStepSignerResult> {
    const authorization = await this.#repository.prepareReplacement({ ...input, now: this.#now() });
    const step = authorization.plan.steps.find(({ stepId }) => stepId === authorization.stepId);
    if (!step) throw new LocalPositionWorkerError("LOCAL_POSITION_REPLACEMENT_INVALID");
    try {
      validateLocalPositionReplacement(
        step,
        authorization.previous,
        authorization.next,
        authorization.plan.planDigest,
      );
      const signed = await this.#signer.signAndDeliver({
        generation: authorization.generation,
        maxFeePerGasBaseUnit: authorization.next.fee.maxFeePerGasBaseUnit,
        maxPriorityFeePerGasBaseUnit: authorization.next.fee.maxPriorityFeePerGasBaseUnit,
        plan: authorization.plan,
        planDigest: authorization.plan.planDigest,
        ...(authorization.reauthenticatedSessionId
          ? { reauthenticatedSessionId: authorization.reauthenticatedSessionId }
          : {}),
        stepId: authorization.stepId,
        tenantId: authorization.tenantId,
        userId: authorization.userId,
      });
      if (
        signed.planDigest !== authorization.plan.planDigest ||
        signed.stepId !== authorization.stepId ||
        signed.generation !== authorization.generation ||
        !hashPattern.test(signed.transactionHash)
      ) {
        throw new LocalPositionWorkerError("LOCAL_POSITION_SIGNER_RESPONSE_INVALID", true);
      }
      await this.#repository.completeReplacement({
        authorization,
        deliveredAt: this.#now(),
        result: signed,
      });
      return signed;
    } catch (error) {
      const failed = failure(error);
      await this.#repository.rejectReplacement({ authorization, failedAt: this.#now(), ...failed });
      throw error;
    }
  }

  #assertClaim(claim: LocalPositionWorkClaim): void {
    validateLocalPositionWorkPlan(claim.operation);
    const ids = new Set<string>();
    const hashes = new Set<string>();
    const generations = new Set<number>();
    for (const transaction of claim.operation.transactionLineage) {
      instant(transaction.updatedAt);
      if (
        !hashPattern.test(transaction.transactionHash) ||
        ids.has(transaction.transactionId) ||
        hashes.has(transaction.transactionHash) ||
        generations.has(transaction.generation)
      ) {
        throw new LocalPositionWorkerError("LOCAL_POSITION_RECOVERY_LINEAGE_INVALID");
      }
      ids.add(transaction.transactionId);
      hashes.add(transaction.transactionHash);
      generations.add(transaction.generation);
    }
  }

  #assertSignerResult(
    operation: Pick<LocalPositionStepWorkOperation, "planDigest" | "step">,
    signed: LocalPositionStepSignerResult,
  ): void {
    if (
      signed.planDigest !== operation.planDigest ||
      signed.stepId !== operation.step.stepId ||
      signed.generation !== 0 ||
      !hashPattern.test(signed.transactionHash) ||
      (signed.status !== "accepted" && signed.status !== "already-known") ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(signed.deliveryId)
    ) {
      throw new LocalPositionWorkerError("LOCAL_POSITION_SIGNER_RESPONSE_INVALID", true);
    }
  }
}

function initialFee(
  limit: LocalPositionFeeLimit,
): Pick<LocalPositionFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit"> {
  const max = BigInt(limit.maxFeePerGasBaseUnit);
  const priority = BigInt(limit.maxPriorityFeePerGasBaseUnit);
  return {
    maxFeePerGasBaseUnit: (max > 1n ? max / 2n : max).toString(),
    maxPriorityFeePerGasBaseUnit: (priority > 1n ? priority / 2n : priority).toString(),
  };
}
