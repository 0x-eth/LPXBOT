import {
  localHelperSweepCalldata,
  localHelperSweepDataDigest,
  localHelperSweepPlanDigest,
  localHelperSweepSemanticDigest,
  validateLocalHelperSweepReplacement,
  type LocalHelperResidualSnapshot,
  type LocalHelperSweepFeeLimit,
  type LocalHelperSweepPlan,
  type LocalHelperSweepReplacementCandidate,
} from "@lpbot/domain/local-helper-sweep";

export interface LocalHelperSweepTransactionReference extends LocalHelperSweepReplacementCandidate {
  active: boolean;
  generation: number;
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface LocalHelperSweepWorkOperation {
  activeTransaction: LocalHelperSweepTransactionReference | null;
  batchId: string;
  operationId: string;
  plan: LocalHelperSweepPlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId: string | null;
  state: "broadcast" | "confirmed" | "dropped" | "pending" | "queued" | "reconciling";
  tenantId: string;
  transactionLineage: readonly LocalHelperSweepTransactionReference[];
  userId: string;
}

export interface LocalHelperSweepRescanWork {
  batchId: string;
  helperAddress: `0x${string}`;
  tenantId: string;
  userId: string;
  walletAddress: `0x${string}`;
  walletId: string;
}

export type LocalHelperSweepWorkClaim =
  | {
      kind: "operation";
      leaseToken: string;
      operation: LocalHelperSweepWorkOperation;
      outboxEventId: string;
    }
  | {
      batch: LocalHelperSweepRescanWork;
      kind: "rescan";
      leaseToken: string;
      outboxEventId: string;
    };

export interface LocalHelperSweepReceiptObservation {
  blockCanonical: boolean;
  blockHash: `0x${string}`;
  blockNumber: string;
  confirmations: string;
  effectiveGasPrice: string;
  gasUsed: string;
  helperBalanceAfter: string;
  helperBalanceBefore: string;
  helperRuntimeCodeHash: `0x${string}` | null;
  observedOwner: `0x${string}` | null;
  ownerBalanceAfter: string;
  ownerBalanceBefore: string;
  planExecutedEvent: boolean;
  receiptStatus: "reverted" | "success";
  sweptEvent: boolean;
  tokenAddress: `0x${string}` | null;
  transactionHash: `0x${string}`;
  transferAmountBaseUnit: string | null;
  transferFrom: `0x${string}` | null;
  transferTo: `0x${string}` | null;
}

export interface LocalHelperSweepProviderObservation {
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
  receipt: LocalHelperSweepReceiptObservation | null;
  transactionFound: boolean;
}

export interface LocalHelperSweepObservation {
  providers: readonly LocalHelperSweepProviderObservation[];
}

export type LocalHelperSweepObservationDecision =
  | {
      kind: "defer";
      operationState: "broadcast" | "confirmed" | "pending";
      reason: string;
    }
  | {
      kind: "transition";
      operationState: "dropped" | "pending" | "reconciling";
      reason: string | null;
    }
  | {
      failureCode: string | null;
      kind: "receipt";
      operationState: "confirmed" | "failed" | "reconciling" | "succeeded";
      reason: string | null;
      receipt: LocalHelperSweepReceiptObservation;
      transactionId: string;
    };

export interface LocalHelperSweepSignerResult {
  deliveryId: string;
  generation: number;
  operationId: string;
  planDigest: `sha256:${string}`;
  status: "accepted" | "already-known";
  transactionHash: `0x${string}`;
}

export interface LocalHelperSweepSignerGateway {
  signAndDeliver(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    operationId: string;
    plan: LocalHelperSweepPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalHelperSweepSignerResult>;
}

export interface LocalHelperSweepObserver {
  observe(input: {
    plan: LocalHelperSweepPlan;
    transactionHash: `0x${string}`;
  }): Promise<LocalHelperSweepObservation>;
}

export interface LocalHelperSweepRescanner {
  rescan(input: LocalHelperSweepRescanWork): Promise<Readonly<LocalHelperResidualSnapshot>>;
}

export interface LocalHelperSweepReplacementAuthorization {
  expiresAt: string;
  generation: number;
  next: LocalHelperSweepReplacementCandidate;
  operationId: string;
  plan: LocalHelperSweepPlan;
  previous: LocalHelperSweepReplacementCandidate;
  reauthenticatedSessionId: string | null;
  tenantId: string;
  userId: string;
}

export interface LocalHelperSweepWorkRepository {
  applyObservation(input: {
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>;
    decision: LocalHelperSweepObservationDecision;
    observedAt: Date;
  }): Promise<void>;
  claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalHelperSweepWorkClaim[]>;
  completeBroadcast(input: {
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>;
    deliveredAt: Date;
    result: LocalHelperSweepSignerResult;
  }): Promise<void>;
  completeReplacement(input: {
    authorization: LocalHelperSweepReplacementAuthorization;
    deliveredAt: Date;
    result: LocalHelperSweepSignerResult;
  }): Promise<void>;
  completeRescan(input: {
    claim: Extract<LocalHelperSweepWorkClaim, { kind: "rescan" }>;
    completedAt: Date;
    outcome: "active" | "degraded" | "manual-recovery-required";
    snapshot: Readonly<LocalHelperResidualSnapshot>;
  }): Promise<void>;
  failClaim(input: {
    claim: LocalHelperSweepWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
  prepareReplacement(input: {
    fee: Pick<LocalHelperSweepFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<LocalHelperSweepReplacementAuthorization>;
  rejectReplacement(input: {
    authorization: LocalHelperSweepReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
}

export class LocalHelperSweepWorkerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalHelperSweepWorkerError";
  }
}

const hashPattern = /^0x[0-9a-f]{64}$/u;
const addressPattern = /^0x[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function decimal(value: string, positive = false): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 78) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_EVIDENCE_INVALID");
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_EVIDENCE_INVALID");
  }
  return parsed;
}

function instant(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_EVIDENCE_INVALID");
  }
  return parsed.getTime();
}

function candidate(
  operation: LocalHelperSweepWorkOperation,
  fee: LocalHelperSweepReplacementCandidate["fee"],
): LocalHelperSweepReplacementCandidate {
  const plan = operation.plan;
  return {
    amountBaseUnit: plan.asset.amountBaseUnit,
    assetId: plan.asset.assetId,
    dataDigest: plan.transaction.dataDigest,
    fee,
    nonce: plan.nonce,
    planDigest: plan.planDigest,
    recipient: plan.recipient,
    semanticDigest: plan.semanticDigest,
    target: plan.transaction.to,
  };
}

export function validateLocalHelperSweepWorkPlan(operation: LocalHelperSweepWorkOperation): void {
  const plan = operation.plan;
  const calldata = localHelperSweepCalldata(plan.planDigest, plan.asset);
  if (
    !digestPattern.test(operation.planDigest) ||
    plan.planDigest !== operation.planDigest ||
    localHelperSweepPlanDigest(plan) !== operation.planDigest ||
    plan.operationId !== operation.operationId ||
    plan.batchId !== operation.batchId ||
    plan.chainId !== 31_337 ||
    plan.registry.version !== "p05-local-helper-sweep-v2" ||
    plan.registry.rollbackVersion !== "p05-local-helper-sweep-disabled-v1" ||
    plan.serviceFeeBps !== 0 ||
    plan.recipient !== plan.wallet.address ||
    plan.recipient !== plan.helper.ownerAddress ||
    plan.helper.walletId !== plan.wallet.walletId ||
    plan.transaction.to !== plan.helper.helperAddress ||
    plan.transaction.valueBaseUnit !== "0" ||
    plan.transaction.data !== calldata ||
    plan.transaction.dataDigest !== localHelperSweepDataDigest(calldata) ||
    plan.semanticDigest !== localHelperSweepSemanticDigest(plan) ||
    (plan.asset.kind === "native"
      ? plan.transaction.selector !== "0x6971b189" || plan.asset.tokenAddress !== null
      : plan.transaction.selector !== "0x3609afa9" ||
        !plan.asset.tokenAddress ||
        !plan.transaction.data.startsWith("0x3609afa9"))
  ) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_PLAN_INVALID");
  }
  decimal(plan.asset.amountBaseUnit, true);
  decimal(plan.asset.dustBaseUnit);
  decimal(plan.nonce);
  decimal(plan.fencingToken, true);
  if (BigInt(plan.asset.amountBaseUnit) <= BigInt(plan.asset.dustBaseUnit)) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_PLAN_INVALID");
  }
}

function receiptIdentity(receipt: LocalHelperSweepReceiptObservation | null): string {
  if (!receipt) return "none";
  for (const value of [
    receipt.blockNumber,
    receipt.confirmations,
    receipt.effectiveGasPrice,
    receipt.gasUsed,
    receipt.helperBalanceAfter,
    receipt.helperBalanceBefore,
    receipt.ownerBalanceAfter,
    receipt.ownerBalanceBefore,
  ]) {
    decimal(value);
  }
  if (
    !hashPattern.test(receipt.blockHash) ||
    !hashPattern.test(receipt.transactionHash) ||
    (receipt.helperRuntimeCodeHash !== null && !hashPattern.test(receipt.helperRuntimeCodeHash)) ||
    (receipt.observedOwner !== null && !addressPattern.test(receipt.observedOwner)) ||
    (receipt.tokenAddress !== null && !addressPattern.test(receipt.tokenAddress)) ||
    (receipt.transferFrom !== null && !addressPattern.test(receipt.transferFrom)) ||
    (receipt.transferTo !== null && !addressPattern.test(receipt.transferTo))
  ) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_EVIDENCE_INVALID");
  }
  if (receipt.transferAmountBaseUnit !== null) decimal(receipt.transferAmountBaseUnit);
  return JSON.stringify(receipt);
}

function consensus(
  observation: LocalHelperSweepObservation,
): LocalHelperSweepProviderObservation | null {
  if (observation.providers.length === 0) return null;
  const providers = new Set<string>();
  const identities = new Set<string>();
  for (const provider of observation.providers) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(provider.providerId) ||
      providers.has(provider.providerId)
    ) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_EVIDENCE_INVALID");
    }
    providers.add(provider.providerId);
    const latest = decimal(provider.latestNonce);
    const pending = decimal(provider.pendingNonce);
    if (pending < latest) {
      throw new LocalHelperSweepWorkerError("NONCE_PENDING_BEHIND_LATEST");
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
  if (identities.size !== 1) {
    throw new LocalHelperSweepWorkerError("PROVIDER_DIVERGENCE");
  }
  return observation.providers[0]!;
}

function postconditionFailure(
  plan: LocalHelperSweepPlan,
  receipt: LocalHelperSweepReceiptObservation,
): string | null {
  if (
    receipt.helperRuntimeCodeHash !== plan.helper.runtimeCodeHash ||
    receipt.observedOwner !== plan.recipient
  ) {
    return "HELPER_IDENTITY_MISMATCH";
  }
  if (!receipt.planExecutedEvent || !receipt.sweptEvent) return "SWEEP_EVENT_MISMATCH";
  const amount = BigInt(plan.asset.amountBaseUnit);
  const helperBefore = BigInt(receipt.helperBalanceBefore);
  const helperAfter = BigInt(receipt.helperBalanceAfter);
  const ownerBefore = BigInt(receipt.ownerBalanceBefore);
  const ownerAfter = BigInt(receipt.ownerBalanceAfter);
  if (helperBefore < helperAfter || helperBefore - helperAfter !== amount) {
    return "HELPER_BALANCE_DELTA_MISMATCH";
  }
  if (helperAfter > BigInt(plan.asset.dustBaseUnit)) return "HELPER_DUST_EXCEEDED";
  if (plan.asset.kind === "token") {
    if (
      receipt.tokenAddress !== plan.asset.tokenAddress ||
      receipt.transferFrom !== plan.helper.helperAddress ||
      receipt.transferTo !== plan.recipient ||
      receipt.transferAmountBaseUnit !== plan.asset.amountBaseUnit
    ) {
      return "TOKEN_TRANSFER_MISMATCH";
    }
    if (ownerAfter < ownerBefore || ownerAfter - ownerBefore !== amount) {
      return "TOKEN_OWNER_BALANCE_DELTA_MISMATCH";
    }
    return null;
  }
  if (
    receipt.tokenAddress !== null ||
    receipt.transferFrom !== null ||
    receipt.transferTo !== null ||
    receipt.transferAmountBaseUnit !== null
  ) {
    return "NATIVE_TRANSFER_EVIDENCE_INVALID";
  }
  const gasCost = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
  if (ownerAfter - ownerBefore !== amount - gasCost) {
    return "NATIVE_OWNER_GAS_RECONCILIATION_MISMATCH";
  }
  return null;
}

export function decideLocalHelperSweepObservation(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observation: LocalHelperSweepObservation;
  operation: LocalHelperSweepWorkOperation;
  requiredConfirmations: number;
  transaction?: LocalHelperSweepTransactionReference;
}): LocalHelperSweepObservationDecision {
  let provider: LocalHelperSweepProviderObservation | null;
  try {
    provider = consensus(input.observation);
  } catch (error) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: error instanceof LocalHelperSweepWorkerError ? error.code : "PROVIDER_DIVERGENCE",
    };
  }
  if (!provider) {
    return input.operation.state === "confirmed"
      ? {
          kind: "transition",
          operationState: "reconciling",
          reason: "REORG_PROVIDER_UNAVAILABLE",
        }
      : {
          kind: "defer",
          operationState: input.operation.state === "broadcast" ? "broadcast" : "pending",
          reason: "AWAITING_PROVIDER",
        };
  }
  const transaction = input.transaction ?? input.operation.activeTransaction;
  if (!transaction) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: "ACTIVE_TRANSACTION_MISSING",
    };
  }
  const receipt = provider.receipt;
  if (receipt) {
    if (!receipt.blockCanonical) {
      return {
        failureCode: null,
        kind: "receipt",
        operationState: "reconciling",
        reason: "REORG_BLOCK_NONCANONICAL",
        receipt,
        transactionId: transaction.transactionId,
      };
    }
    if (receipt.receiptStatus === "reverted") {
      return {
        failureCode: "SWEEP_REVERTED",
        kind: "receipt",
        operationState: "failed",
        reason: null,
        receipt,
        transactionId: transaction.transactionId,
      };
    }
    if (BigInt(receipt.confirmations) < BigInt(input.requiredConfirmations)) {
      return {
        failureCode: null,
        kind: "receipt",
        operationState: "confirmed",
        reason: "CONFIRMATIONS_PENDING",
        receipt,
        transactionId: transaction.transactionId,
      };
    }
    const failure = postconditionFailure(input.operation.plan, receipt);
    return failure
      ? {
          failureCode: failure,
          kind: "receipt",
          operationState: "reconciling",
          reason: failure,
          receipt,
          transactionId: transaction.transactionId,
        }
      : {
          failureCode: null,
          kind: "receipt",
          operationState: "succeeded",
          reason: null,
          receipt,
          transactionId: transaction.transactionId,
        };
  }
  if (input.operation.state === "confirmed") {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: "REORG_RECEIPT_REMOVED",
    };
  }
  if (provider.transactionFound) {
    return { kind: "transition", operationState: "pending", reason: null };
  }
  if (input.now.getTime() - instant(transaction.updatedAt) < input.dropAfterMilliseconds) {
    return {
      kind: "defer",
      operationState: input.operation.state === "broadcast" ? "broadcast" : "pending",
      reason: "AWAITING_TRANSACTION",
    };
  }
  if (
    decimal(provider.latestNonce) > BigInt(input.operation.plan.nonce) ||
    decimal(provider.pendingNonce) > BigInt(input.operation.plan.nonce)
  ) {
    return {
      kind: "transition",
      operationState: "reconciling",
      reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
    };
  }
  return { kind: "transition", operationState: "dropped", reason: null };
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
  return { code: "LOCAL_HELPER_SWEEP_WORKER_UNAVAILABLE", retryable: true };
}

function rescanOutcome(
  work: LocalHelperSweepRescanWork,
  snapshot: Readonly<LocalHelperResidualSnapshot>,
): "active" | "degraded" | "manual-recovery-required" {
  if (
    snapshot.chainId !== 31_337 ||
    snapshot.wallet.walletId !== work.walletId ||
    snapshot.wallet.address !== work.walletAddress ||
    snapshot.binding.helperAddress !== work.helperAddress ||
    snapshot.registry.version !== "p05-local-helper-sweep-v2"
  ) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RESCAN_INVALID");
  }
  if (snapshot.manualRecoveryRequired) {
    if (snapshot.binding.state !== "degraded") {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RESCAN_INVALID");
    }
    return "manual-recovery-required";
  }
  const identity = snapshot.identity;
  const clean =
    snapshot.coverage.complete &&
    identity.bindingMatches &&
    identity.componentsMatch &&
    identity.ownerMatches &&
    identity.registryMatches &&
    identity.runtimeMatches &&
    identity.tokensMatch &&
    snapshot.balances.every(
      ({ amountBaseUnit, dustBaseUnit }) => BigInt(amountBaseUnit) <= BigInt(dustBaseUnit),
    ) &&
    snapshot.allowances.every(({ amountBaseUnit }) => BigInt(amountBaseUnit) === 0n) &&
    snapshot.nftCustody.length === 0 &&
    snapshot.unknownTokens.length === 0;
  if (snapshot.binding.state !== (clean ? "active" : "degraded")) {
    throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_RESCAN_INVALID");
  }
  return clean ? "active" : "degraded";
}

export interface LocalHelperSweepBatchResult {
  broadcast: number;
  claimed: number;
  failed: number;
  observed: number;
  rescanned: number;
  retried: number;
}

export class LocalHelperSweepRecoveryWorker {
  readonly #dropAfterMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #limit: number;
  readonly #now: () => Date;
  readonly #observer: LocalHelperSweepObserver;
  readonly #repository: LocalHelperSweepWorkRepository;
  readonly #requiredConfirmations: number;
  readonly #rescanner: LocalHelperSweepRescanner;
  readonly #signer: LocalHelperSweepSignerGateway;
  readonly #workerId: string;

  constructor(input: {
    dropAfterMilliseconds?: number;
    leaseMilliseconds?: number;
    limit?: number;
    now?: () => Date;
    observer: LocalHelperSweepObserver;
    repository: LocalHelperSweepWorkRepository;
    requiredConfirmations?: number;
    rescanner: LocalHelperSweepRescanner;
    signer: LocalHelperSweepSignerGateway;
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
      throw new RangeError("Local Helper sweep worker configuration is invalid");
    }
    this.#now = input.now ?? (() => new Date());
    this.#observer = input.observer;
    this.#repository = input.repository;
    this.#rescanner = input.rescanner;
    this.#signer = input.signer;
    this.#workerId = input.workerId;
  }

  async processBatch(): Promise<LocalHelperSweepBatchResult> {
    const claims = await this.#repository.claimDue({
      leaseMilliseconds: this.#leaseMilliseconds,
      limit: this.#limit,
      now: this.#now(),
      workerId: this.#workerId,
    });
    const result = {
      broadcast: 0,
      claimed: claims.length,
      failed: 0,
      observed: 0,
      rescanned: 0,
      retried: 0,
    };
    for (const claim of claims) {
      try {
        if (claim.kind === "rescan") {
          const snapshot = await this.#rescanner.rescan(claim.batch);
          await this.#repository.completeRescan({
            claim,
            completedAt: this.#now(),
            outcome: rescanOutcome(claim.batch, snapshot),
            snapshot,
          });
          result.rescanned += 1;
          continue;
        }
        this.#assertClaim(claim);
        if (claim.operation.state === "queued") {
          const signed = await this.#signer.signAndDeliver({
            generation: 0,
            maxFeePerGasBaseUnit: claim.operation.plan.feeLimit.maxFeePerGasBaseUnit,
            maxPriorityFeePerGasBaseUnit:
              claim.operation.plan.feeLimit.maxPriorityFeePerGasBaseUnit,
            operationId: claim.operation.operationId,
            plan: claim.operation.plan,
            planDigest: claim.operation.planDigest,
            ...(claim.operation.reauthenticatedSessionId
              ? { reauthenticatedSessionId: claim.operation.reauthenticatedSessionId }
              : {}),
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
          throw new LocalHelperSweepWorkerError("ACTIVE_TRANSACTION_MISSING");
        }
        const observations = await Promise.all(
          claim.operation.transactionLineage.map(async (transaction) => ({
            decision: decideLocalHelperSweepObservation({
              dropAfterMilliseconds: this.#dropAfterMilliseconds,
              now: this.#now(),
              observation: await this.#observer.observe({
                plan: claim.operation.plan,
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
    fee: Pick<LocalHelperSweepFeeLimit, "maxFeePerGasBaseUnit" | "maxPriorityFeePerGasBaseUnit">;
    operationId: string;
    reason: string;
  }): Promise<LocalHelperSweepSignerResult> {
    const authorization = await this.#repository.prepareReplacement({ ...input, now: this.#now() });
    try {
      validateLocalHelperSweepReplacement(
        authorization.plan,
        authorization.previous,
        authorization.next,
      );
      const signed = await this.#signer.signAndDeliver({
        generation: authorization.generation,
        maxFeePerGasBaseUnit: authorization.next.fee.maxFeePerGasBaseUnit,
        maxPriorityFeePerGasBaseUnit: authorization.next.fee.maxPriorityFeePerGasBaseUnit,
        operationId: authorization.operationId,
        plan: authorization.plan,
        planDigest: authorization.plan.planDigest,
        ...(authorization.reauthenticatedSessionId
          ? { reauthenticatedSessionId: authorization.reauthenticatedSessionId }
          : {}),
        tenantId: authorization.tenantId,
        userId: authorization.userId,
      });
      if (
        signed.planDigest !== authorization.plan.planDigest ||
        signed.operationId !== authorization.operationId ||
        signed.generation !== authorization.generation ||
        !hashPattern.test(signed.transactionHash)
      ) {
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_SIGNER_RESPONSE_INVALID", true);
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

  #assertClaim(claim: Extract<LocalHelperSweepWorkClaim, { kind: "operation" }>): void {
    validateLocalHelperSweepWorkPlan(claim.operation);
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
        throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_LINEAGE_INVALID");
      }
      ids.add(transaction.transactionId);
      hashes.add(transaction.transactionHash);
      generations.add(transaction.generation);
    }
  }

  #assertSignerResult(
    operation: LocalHelperSweepWorkOperation,
    result: LocalHelperSweepSignerResult,
  ): void {
    if (
      result.generation !== 0 ||
      result.operationId !== operation.operationId ||
      result.planDigest !== operation.planDigest ||
      !hashPattern.test(result.transactionHash)
    ) {
      throw new LocalHelperSweepWorkerError("LOCAL_HELPER_SWEEP_SIGNER_RESPONSE_INVALID", true);
    }
  }
}

export function localHelperSweepReplacementCandidate(
  operation: LocalHelperSweepWorkOperation,
  fee: LocalHelperSweepReplacementCandidate["fee"],
): LocalHelperSweepReplacementCandidate {
  validateLocalHelperSweepWorkPlan(operation);
  return candidate(operation, fee);
}
