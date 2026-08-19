import {
  localSwapExecutionPlanDigest,
  validateLocalSwapReplacement,
  type LocalSwapExecutionPlan,
  type LocalSwapFeeLimit,
  type LocalSwapPlanStep,
  type LocalSwapReplacementCandidate,
} from "@lpbot/domain/local-swap-execution";

export interface LocalSwapTransactionReference extends LocalSwapReplacementCandidate {
  active: boolean;
  generation: number;
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface LocalSwapStepWorkOperation {
  activeTransaction: LocalSwapTransactionReference | null;
  approvalSucceeded: boolean;
  operationId: string;
  operationState: "queued" | "signing" | "broadcast" | "pending" | "reconciling";
  plan: LocalSwapExecutionPlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId: string | null;
  step: LocalSwapPlanStep;
  stepState:
    "queued" | "signed" | "broadcast" | "pending" | "confirmed" | "dropped" | "reconciling";
  tenantId: string;
  transactionLineage: readonly LocalSwapTransactionReference[];
  userId: string;
}

export interface LocalSwapWorkClaim {
  leaseToken: string;
  operation: LocalSwapStepWorkOperation;
  outboxEventId: string;
}

export interface LocalSwapReceiptObservation {
  adapterToRouterAllowance: string | null;
  blockCanonical: boolean;
  blockHash: `0x${string}`;
  blockNumber: string;
  confirmations: string;
  helperInputDust: string | null;
  helperOutputDust: string | null;
  helperToAdapterAllowance: string | null;
  minOutBaseUnit: string | null;
  ownerOutputAfter: string | null;
  ownerOutputBefore: string | null;
  ownerToSpenderAllowance: string | null;
  planExecutedEvent: boolean | null;
  planReplayRecorded: boolean | null;
  receiptStatus: "reverted" | "success";
  swapExecutedEvent: boolean | null;
  transactionHash: `0x${string}`;
}

export interface LocalSwapProviderObservation {
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
  receipt: LocalSwapReceiptObservation | null;
  transactionFound: boolean;
}

export interface LocalSwapObservation {
  providers: readonly LocalSwapProviderObservation[];
}

export type LocalSwapObservationDecision =
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
      next: "advance" | "cleanup-required" | "complete-failed" | "complete-success" | "reconciling";
      operationState: "pending" | "reconciling" | "failed" | "succeeded";
      reason: string | null;
      receipt: LocalSwapReceiptObservation;
      stepState: "confirmed" | "failed" | "reconciling" | "succeeded";
      transactionId: string;
    };

export interface LocalSwapStepSignerResult {
  deliveryId: string;
  generation: number;
  planDigest: `sha256:${string}`;
  status: "accepted" | "already-known";
  stepId: string;
  transactionHash: `0x${string}`;
}

export interface LocalSwapStepSignerGateway {
  signAndDeliver(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    plan: LocalSwapExecutionPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    stepId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalSwapStepSignerResult>;
}

export interface LocalSwapObserver {
  observe(input: {
    plan: LocalSwapExecutionPlan;
    step: LocalSwapPlanStep;
    transactionHash: `0x${string}`;
  }): Promise<LocalSwapObservation>;
}

export interface LocalSwapReplacementAuthorization {
  expiresAt: string;
  generation: number;
  next: LocalSwapReplacementCandidate;
  operationId: string;
  plan: LocalSwapExecutionPlan;
  previous: LocalSwapReplacementCandidate;
  reauthenticatedSessionId: string | null;
  stepId: string;
  tenantId: string;
  userId: string;
}

export interface LocalSwapWorkRepository {
  applyObservation(input: {
    claim: LocalSwapWorkClaim;
    decision: LocalSwapObservationDecision;
    observedAt: Date;
  }): Promise<void>;
  claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalSwapWorkClaim[]>;
  completeBroadcast(input: {
    claim: LocalSwapWorkClaim;
    deliveredAt: Date;
    result: LocalSwapStepSignerResult;
  }): Promise<void>;
  completeReplacement(input: {
    authorization: LocalSwapReplacementAuthorization;
    deliveredAt: Date;
    result: LocalSwapStepSignerResult;
  }): Promise<void>;
  failClaim(input: {
    claim: LocalSwapWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
  prepareReplacement(input: {
    fee: Pick<LocalSwapFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
    now: Date;
    operationId: string;
    reason: string;
    stepId: string;
  }): Promise<LocalSwapReplacementAuthorization>;
  rejectReplacement(input: {
    authorization: LocalSwapReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
}

export class LocalSwapWorkerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalSwapWorkerError";
  }
}

const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function decimal(value: string, positive = false): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 78) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_EVIDENCE_INVALID");
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n)
    throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_EVIDENCE_INVALID");
  return parsed;
}

function instant(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_EVIDENCE_INVALID");
  }
  return parsed.getTime();
}

export function validateLocalSwapWorkPlan(operation: LocalSwapStepWorkOperation): void {
  const plan = operation.plan;
  const step = plan.steps.find(({ stepId }) => stepId === operation.step.stepId);
  if (
    !step ||
    step.semanticDigest !== operation.step.semanticDigest ||
    !digestPattern.test(operation.planDigest) ||
    plan.planDigest !== operation.planDigest ||
    localSwapExecutionPlanDigest(plan) !== operation.planDigest ||
    plan.operationId !== operation.operationId ||
    plan.chainId !== 31_337 ||
    plan.registry.version !== "p05-local-swap-execution-v2" ||
    plan.serviceFeeBps !== 0 ||
    plan.helper.owner !== plan.wallet.address ||
    (step.kind === "swap"
      ? step.transaction.to !== plan.helper.address ||
        !step.transaction.data.startsWith("0x5a547e89")
      : step.transaction.to !== plan.quote.tokenIn ||
        !step.transaction.data.startsWith("0x095ea7b3"))
  ) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_PLAN_INVALID");
  }
}

function receiptIdentity(receipt: LocalSwapReceiptObservation | null): string {
  if (!receipt) return "none";
  decimal(receipt.blockNumber);
  decimal(receipt.confirmations, true);
  if (!hashPattern.test(receipt.blockHash) || !hashPattern.test(receipt.transactionHash)) {
    throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_EVIDENCE_INVALID");
  }
  return JSON.stringify(receipt);
}

function consensus(observation: LocalSwapObservation): LocalSwapProviderObservation | null {
  if (observation.providers.length === 0) return null;
  const providers = new Set<string>();
  const identities = new Set<string>();
  for (const provider of observation.providers) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(provider.providerId) ||
      providers.has(provider.providerId)
    )
      throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_EVIDENCE_INVALID");
    providers.add(provider.providerId);
    const latest = decimal(provider.latestNonce);
    const pending = decimal(provider.pendingNonce);
    if (pending < latest) throw new LocalSwapWorkerError("NONCE_PENDING_BEHIND_LATEST");
    identities.add(
      JSON.stringify([
        latest.toString(),
        pending.toString(),
        provider.transactionFound,
        receiptIdentity(provider.receipt),
      ]),
    );
  }
  if (identities.size !== 1) throw new LocalSwapWorkerError("PROVIDER_DIVERGENCE");
  return observation.providers[0]!;
}

function postconditionFailure(
  plan: LocalSwapExecutionPlan,
  step: LocalSwapPlanStep,
  receipt: LocalSwapReceiptObservation,
): string | null {
  if (step.kind === "allowance-reset" || step.kind === "cleanup") {
    return receipt.ownerToSpenderAllowance === "0" ? null : "ALLOWANCE_NOT_ZERO";
  }
  if (step.kind === "approve") {
    return receipt.ownerToSpenderAllowance === plan.quote.amountInBaseUnit
      ? null
      : "APPROVAL_AMOUNT_MISMATCH";
  }
  const values = [
    receipt.ownerOutputBefore,
    receipt.ownerOutputAfter,
    receipt.minOutBaseUnit,
    receipt.ownerToSpenderAllowance,
    receipt.helperToAdapterAllowance,
    receipt.adapterToRouterAllowance,
    receipt.helperInputDust,
    receipt.helperOutputDust,
  ];
  if (values.some((value) => value === null)) return "SWAP_POSTCONDITION_INCOMPLETE";
  const delta = BigInt(receipt.ownerOutputAfter!) - BigInt(receipt.ownerOutputBefore!);
  if (delta < BigInt(receipt.minOutBaseUnit!)) return "SWAP_MIN_OUT_MISMATCH";
  if (
    receipt.planExecutedEvent !== true ||
    receipt.swapExecutedEvent !== true ||
    receipt.planReplayRecorded !== true
  ) {
    return "SWAP_EVENT_OR_REPLAY_MISMATCH";
  }
  if (
    receipt.ownerToSpenderAllowance !== "0" ||
    receipt.helperToAdapterAllowance !== "0" ||
    receipt.adapterToRouterAllowance !== "0"
  )
    return "SWAP_ALLOWANCE_NOT_ZERO";
  if (BigInt(receipt.helperInputDust!) > 1n || BigInt(receipt.helperOutputDust!) > 1n) {
    return "SWAP_HELPER_DUST_EXCEEDED";
  }
  return null;
}

export function decideLocalSwapObservation(input: {
  approvalSucceeded: boolean;
  dropAfterMilliseconds: number;
  now: Date;
  observation: LocalSwapObservation;
  operation: LocalSwapStepWorkOperation;
  requiredConfirmations: number;
  transaction?: LocalSwapTransactionReference;
}): LocalSwapObservationDecision {
  const cleanupPending = input.operation.step.kind === "cleanup";
  let provider: LocalSwapProviderObservation | null;
  try {
    provider = consensus(input.observation);
  } catch (error) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: error instanceof LocalSwapWorkerError ? error.code : "PROVIDER_DIVERGENCE",
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
          operationState: cleanupPending ? "reconciling" : "pending",
          reason: cleanupPending ? "ALLOWANCE_CLEANUP_REQUIRED" : "AWAITING_PROVIDER",
          stepState: "pending",
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
      const cleanup = input.operation.step.kind === "swap" && input.approvalSucceeded;
      return {
        failureCode:
          input.operation.step.kind === "swap"
            ? "SWAP_REVERTED"
            : `${input.operation.step.kind.toUpperCase().replaceAll("-", "_")}_REVERTED`,
        kind: "receipt",
        next: cleanup ? "cleanup-required" : "complete-failed",
        operationState: cleanup ? "reconciling" : "failed",
        reason: cleanup ? "ALLOWANCE_CLEANUP_REQUIRED" : null,
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
        operationState: cleanupPending ? "reconciling" : "pending",
        reason: cleanupPending ? "ALLOWANCE_CLEANUP_REQUIRED" : "CONFIRMATIONS_PENDING",
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
        next:
          input.operation.step.kind === "swap" && input.approvalSucceeded
            ? "cleanup-required"
            : "reconciling",
        operationState: "reconciling",
        reason: failure,
        receipt,
        stepState: "reconciling",
        transactionId: transaction.transactionId,
      };
    }
    const kind = input.operation.step.kind;
    return {
      failureCode: kind === "cleanup" ? "SWAP_REVERTED" : null,
      kind: "receipt",
      next:
        kind === "swap" ? "complete-success" : kind === "cleanup" ? "complete-failed" : "advance",
      operationState: kind === "swap" ? "succeeded" : kind === "cleanup" ? "failed" : "pending",
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
      operationState: cleanupPending ? "reconciling" : "pending",
      reason: cleanupPending ? "ALLOWANCE_CLEANUP_REQUIRED" : null,
      stepState: "pending",
    };
  }
  if (input.now.getTime() - instant(transaction.updatedAt) < input.dropAfterMilliseconds) {
    return {
      kind: "defer",
      operationState: cleanupPending
        ? "reconciling"
        : input.operation.stepState === "broadcast"
          ? "broadcast"
          : "pending",
      reason: cleanupPending ? "ALLOWANCE_CLEANUP_REQUIRED" : "AWAITING_TRANSACTION",
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
      reason: cleanupPending
        ? "ALLOWANCE_CLEANUP_REQUIRED"
        : "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
      stepState: "reconciling",
    };
  }
  return {
    kind: "transition",
    operationState: cleanupPending ? "reconciling" : "pending",
    reason: cleanupPending ? "ALLOWANCE_CLEANUP_REQUIRED" : null,
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
  return { code: "LOCAL_SWAP_WORKER_UNAVAILABLE", retryable: true };
}

export interface LocalSwapBatchResult {
  broadcast: number;
  claimed: number;
  failed: number;
  observed: number;
  retried: number;
}

export class LocalSwapRecoveryWorker {
  readonly #dropAfterMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #limit: number;
  readonly #now: () => Date;
  readonly #observer: LocalSwapObserver;
  readonly #repository: LocalSwapWorkRepository;
  readonly #requiredConfirmations: number;
  readonly #signer: LocalSwapStepSignerGateway;
  readonly #workerId: string;

  constructor(input: {
    dropAfterMilliseconds?: number;
    leaseMilliseconds?: number;
    limit?: number;
    now?: () => Date;
    observer: LocalSwapObserver;
    repository: LocalSwapWorkRepository;
    requiredConfirmations?: number;
    signer: LocalSwapStepSignerGateway;
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
    )
      throw new RangeError("Local Swap worker configuration is invalid");
    this.#now = input.now ?? (() => new Date());
    this.#observer = input.observer;
    this.#repository = input.repository;
    this.#signer = input.signer;
    this.#workerId = input.workerId;
  }

  async processBatch(): Promise<LocalSwapBatchResult> {
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
          const fee = initialFee(claim.operation.step.feeLimit);
          const signed = await this.#signer.signAndDeliver({
            generation: 0,
            ...fee,
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
          throw new LocalSwapWorkerError("ACTIVE_TRANSACTION_MISSING");
        }
        const observations = await Promise.all(
          claim.operation.transactionLineage.map(async (transaction) => ({
            decision: decideLocalSwapObservation({
              approvalSucceeded: claim.operation.approvalSucceeded,
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
    fee: Pick<LocalSwapFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
    operationId: string;
    reason: string;
    stepId: string;
  }): Promise<LocalSwapStepSignerResult> {
    const authorization = await this.#repository.prepareReplacement({ ...input, now: this.#now() });
    const step = authorization.plan.steps.find(({ stepId }) => stepId === authorization.stepId);
    if (!step) throw new LocalSwapWorkerError("LOCAL_SWAP_REPLACEMENT_INVALID");
    try {
      validateLocalSwapReplacement(
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
        throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
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

  #assertClaim(claim: LocalSwapWorkClaim): void {
    validateLocalSwapWorkPlan(claim.operation);
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
        throw new LocalSwapWorkerError("LOCAL_SWAP_RECOVERY_LINEAGE_INVALID");
      }
      ids.add(transaction.transactionId);
      hashes.add(transaction.transactionHash);
      generations.add(transaction.generation);
    }
  }

  #assertSignerResult(
    operation: Pick<LocalSwapStepWorkOperation, "planDigest" | "step">,
    signed: LocalSwapStepSignerResult,
  ): void {
    if (
      signed.planDigest !== operation.planDigest ||
      signed.stepId !== operation.step.stepId ||
      !hashPattern.test(signed.transactionHash) ||
      (signed.status !== "accepted" && signed.status !== "already-known") ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(signed.deliveryId)
    )
      throw new LocalSwapWorkerError("LOCAL_SWAP_SIGNER_RESPONSE_INVALID", true);
  }
}

function initialFee(
  limit: LocalSwapFeeLimit,
): Pick<LocalSwapFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit"> {
  const max = BigInt(limit.maxFeePerGasBaseUnit);
  const priority = BigInt(limit.maxPriorityFeePerGasBaseUnit);
  return {
    maxFeePerGasBaseUnit: (max > 1n ? max / 2n : max).toString(),
    maxPriorityFeePerGasBaseUnit: (priority > 1n ? priority / 2n : priority).toString(),
  };
}
