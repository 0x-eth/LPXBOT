import type { WalletTransferState } from "@lpbot/api-contract";
import {
  canonicalBaseUnit,
  reconcileWalletTransferReceipt,
  transferDigestPattern,
  transferHashPattern,
  validateWalletTransferPlan,
  walletTransferPlanDigest,
  type WalletTransferPlan,
  type WalletTransferReceiptEvidence,
} from "@lpbot/domain/wallet-transfer";

export interface WalletTransferTransactionHead {
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: "broadcast" | "confirmed" | "dropped" | "failed" | "pending" | "signed";
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface WalletTransferTransactionReference {
  generation: number;
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface WalletTransferWorkOperation {
  activeTransaction: WalletTransferTransactionHead | null;
  assetKind: "erc20" | "native";
  operationId: string;
  plan: WalletTransferPlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId?: string;
  state: Exclude<WalletTransferState, "ready-for-approval" | "replaced">;
  tenantId: string;
  transactionLineage: readonly WalletTransferTransactionReference[];
  userId: string;
}

export interface WalletTransferWorkClaim {
  eventId: string;
  leaseToken: string;
  operation: WalletTransferWorkOperation;
}

export interface WalletTransferReceiptObservation extends WalletTransferReceiptEvidence {
  blockHash: `0x${string}`;
  blockNumber: string;
}

export interface WalletTransferProviderObservation {
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
  receipt: WalletTransferReceiptObservation | null;
  transactionFound: boolean;
}

export interface WalletTransferObservation {
  providers: readonly WalletTransferProviderObservation[];
}

export type WalletTransferObservationDecision =
  | {
      kind: "defer";
      reason: "AWAITING_PROVIDER" | "AWAITING_TRANSACTION" | "CONFIRMED_STABLE";
      state: "broadcast" | "confirmed" | "pending";
    }
  | {
      kind: "receipt";
      reason: string | null;
      receipt: WalletTransferReceiptObservation;
      state: "confirmed" | "failed" | "reconciling";
      transactionId: string;
    }
  | {
      kind: "transition";
      reason: string | null;
      state: "dropped" | "pending" | "reconciling";
    };

export interface WalletTransferSignerResult {
  deliveryId: string;
  planDigest: `sha256:${string}`;
  status: "accepted" | "already-known";
  transactionHash: `0x${string}`;
}

export interface WalletTransferSignerGateway {
  signAndDeliver(input: {
    plan: WalletTransferPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
  }): Promise<WalletTransferSignerResult>;
}

export interface WalletTransferObserver {
  observe(input: {
    plan: WalletTransferPlan;
    transactionHash: `0x${string}`;
  }): Promise<WalletTransferObservation>;
}

export interface WalletTransferReplacementAuthorization {
  generation: number;
  operationId: string;
  plan: WalletTransferPlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId?: string;
  replacedTransactionId: string;
  tenantId: string;
  userId: string;
}

export interface WalletTransferWorkRepository {
  applyObservation(input: {
    claim: WalletTransferWorkClaim;
    decision: WalletTransferObservationDecision;
    observedAt: Date;
  }): Promise<void>;
  claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<WalletTransferWorkClaim[]>;
  completeBroadcast(input: {
    claim: WalletTransferWorkClaim;
    deliveredAt: Date;
    result: WalletTransferSignerResult;
  }): Promise<void>;
  completeReplacement(input: {
    authorization: WalletTransferReplacementAuthorization;
    deliveredAt: Date;
    result: WalletTransferSignerResult;
  }): Promise<void>;
  failClaim(input: {
    claim: WalletTransferWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
  prepareReplacement(input: {
    feeLimit: WalletTransferPlan["feeLimit"];
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<WalletTransferReplacementAuthorization>;
  rejectReplacement(input: {
    authorization: WalletTransferReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
}

export class WalletTransferWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable = false, options?: ErrorOptions) {
    super(code, options);
    this.name = "WalletTransferWorkerError";
    this.code = code;
    this.retryable = retryable;
  }
}

function canonicalInstant(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new WalletTransferWorkerError("TRANSFER_RECOVERY_EVIDENCE_INVALID");
  }
  return parsed.getTime();
}

function canonicalProviderId(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(value)) {
    throw new WalletTransferWorkerError("TRANSFER_RECOVERY_EVIDENCE_INVALID");
  }
  return value;
}

function receiptIdentity(receipt: WalletTransferReceiptObservation | null): string {
  if (!receipt) return "none";
  canonicalBaseUnit(receipt.blockNumber);
  if (!transferHashPattern.test(receipt.blockHash)) {
    throw new WalletTransferWorkerError("TRANSFER_RECOVERY_EVIDENCE_INVALID");
  }
  return JSON.stringify([
    receipt.transactionHash,
    receipt.blockHash,
    receipt.blockNumber,
    receipt.blockCanonical,
    receipt.receiptStatus,
    receipt.from,
    receipt.nonce,
    receipt.transactionTarget,
    receipt.balanceReconciled,
    receipt.tokenTransferLogReconciled,
  ]);
}

function consensusObservation(
  observation: WalletTransferObservation,
): WalletTransferProviderObservation | null {
  if (observation.providers.length === 0) return null;
  const identities = new Set<string>();
  const providerIds = new Set<string>();
  for (const provider of observation.providers) {
    const providerId = canonicalProviderId(provider.providerId);
    if (providerIds.has(providerId)) {
      throw new WalletTransferWorkerError("TRANSFER_RECOVERY_EVIDENCE_INVALID");
    }
    providerIds.add(providerId);
    const latestNonce = canonicalBaseUnit(provider.latestNonce);
    const pendingNonce = canonicalBaseUnit(provider.pendingNonce);
    if (BigInt(pendingNonce) < BigInt(latestNonce)) {
      throw new WalletTransferWorkerError("NONCE_PENDING_BEHIND_LATEST");
    }
    identities.add(
      JSON.stringify([
        latestNonce,
        pendingNonce,
        provider.transactionFound,
        receiptIdentity(provider.receipt),
      ]),
    );
  }
  if (identities.size !== 1) {
    throw new WalletTransferWorkerError("NONCE_PROVIDER_DIVERGENCE");
  }
  return observation.providers[0]!;
}

export function decideWalletTransferObservation(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observation: WalletTransferObservation;
  operation: WalletTransferWorkOperation;
  transaction?: WalletTransferTransactionReference;
}): WalletTransferObservationDecision {
  if (!Number.isSafeInteger(input.dropAfterMilliseconds) || input.dropAfterMilliseconds < 1_000) {
    throw new RangeError("dropAfterMilliseconds must be at least one second");
  }
  let provider: WalletTransferProviderObservation | null;
  try {
    provider = consensusObservation(input.observation);
  } catch (error) {
    return {
      kind: "transition",
      reason:
        error instanceof WalletTransferWorkerError
          ? error.code
          : "TRANSFER_RECOVERY_EVIDENCE_INVALID",
      state: "reconciling",
    };
  }
  if (!provider) {
    return input.operation.state === "confirmed"
      ? { kind: "transition", reason: "REORG_PROVIDER_UNAVAILABLE", state: "reconciling" }
      : { kind: "defer", reason: "AWAITING_PROVIDER", state: "pending" };
  }
  const head = input.transaction ?? input.operation.activeTransaction;
  if (!head) {
    return { kind: "transition", reason: "ACTIVE_TRANSACTION_MISSING", state: "reconciling" };
  }
  if (provider.receipt) {
    const reconciled = reconcileWalletTransferReceipt({
      assetKind: input.operation.assetKind,
      expectedHash: head.transactionHash,
      plan: input.operation.plan,
      receipt: provider.receipt,
    });
    if (input.operation.state === "confirmed" && reconciled.state === "confirmed") {
      return { kind: "defer", reason: "CONFIRMED_STABLE", state: "confirmed" };
    }
    return {
      kind: "receipt",
      receipt: provider.receipt,
      transactionId: head.transactionId,
      ...reconciled,
    };
  }
  if (input.operation.state === "confirmed") {
    return { kind: "transition", reason: "REORG_RECEIPT_REMOVED", state: "reconciling" };
  }
  if (provider.transactionFound) {
    return { kind: "transition", reason: null, state: "pending" };
  }
  const age = input.now.getTime() - canonicalInstant(head.updatedAt);
  if (age < input.dropAfterMilliseconds) {
    return {
      kind: "defer",
      reason: "AWAITING_TRANSACTION",
      state: input.operation.state === "broadcast" ? "broadcast" : "pending",
    };
  }
  const nonce = BigInt(canonicalBaseUnit(input.operation.plan.nonce));
  const latest = BigInt(canonicalBaseUnit(provider.latestNonce));
  const pending = BigInt(canonicalBaseUnit(provider.pendingNonce));
  return {
    kind: "transition",
    reason: latest > nonce || pending > nonce ? "NONCE_CONSUMED_BY_OTHER_TRANSACTION" : null,
    state: "dropped",
  };
}

function decideWalletTransferLineageObservation(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observations: ReadonlyArray<{
    observation: WalletTransferObservation;
    transaction: WalletTransferTransactionReference;
  }>;
  operation: WalletTransferWorkOperation;
}): WalletTransferObservationDecision {
  const decisions = input.observations.map(({ observation, transaction }) =>
    decideWalletTransferObservation({
      dropAfterMilliseconds: input.dropAfterMilliseconds,
      now: input.now,
      observation,
      operation: input.operation,
      transaction,
    }),
  );
  const receipts = decisions.filter(
    (decision): decision is Extract<WalletTransferObservationDecision, { kind: "receipt" }> =>
      decision.kind === "receipt",
  );
  if (receipts.length > 1) {
    return {
      kind: "transition",
      reason: "LINEAGE_RECEIPT_DIVERGENCE",
      state: "reconciling",
    };
  }
  if (receipts[0]) return receipts[0];
  const reconciliation = decisions.find(({ state }) => state === "reconciling");
  if (reconciliation) return reconciliation;
  const pending = decisions.find(
    (decision) => decision.kind === "transition" && decision.state === "pending",
  );
  if (pending) return pending;
  const activeIndex = input.observations.findIndex(
    ({ transaction }) =>
      transaction.transactionId === input.operation.activeTransaction?.transactionId,
  );
  return decisions[activeIndex] ?? decisions[0]!;
}

export function replacementTransferPlan(input: {
  feeLimit: WalletTransferPlan["feeLimit"];
  now: Date;
  plan: WalletTransferPlan;
}): WalletTransferPlan {
  const gasLimit = canonicalBaseUnit(input.feeLimit.gasLimit, { positive: true });
  const maxFee = canonicalBaseUnit(input.feeLimit.maxFeePerGasBaseUnit, { positive: true });
  const priorityFee = canonicalBaseUnit(input.feeLimit.maxPriorityFeePerGasBaseUnit);
  const feeCap = canonicalBaseUnit(input.feeLimit.feeCapBaseUnit, { positive: true });
  if (
    gasLimit !== input.plan.feeLimit.gasLimit ||
    BigInt(priorityFee) > BigInt(maxFee) ||
    BigInt(gasLimit) * BigInt(maxFee) !== BigInt(feeCap) ||
    BigInt(maxFee) < BigInt(input.plan.feeLimit.maxFeePerGasBaseUnit) ||
    BigInt(priorityFee) < BigInt(input.plan.feeLimit.maxPriorityFeePerGasBaseUnit) ||
    (maxFee === input.plan.feeLimit.maxFeePerGasBaseUnit &&
      priorityFee === input.plan.feeLimit.maxPriorityFeePerGasBaseUnit)
  ) {
    throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_FEE_INVALID");
  }
  const replacement = structuredClone(input.plan);
  replacement.feeLimit = {
    feeCapBaseUnit: feeCap,
    gasLimit,
    maxFeePerGasBaseUnit: maxFee,
    maxPriorityFeePerGasBaseUnit: priorityFee,
  };
  validateWalletTransferPlan(replacement, input.now);
  return replacement;
}

function workerFailure(error: unknown): { code: string; retryable: boolean } {
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
  return { code: "TRANSFER_WORKER_UNAVAILABLE", retryable: true };
}

export interface WalletTransferBatchResult {
  broadcast: number;
  claimed: number;
  failed: number;
  observed: number;
  retried: number;
}

export class WalletTransferRecoveryWorker {
  readonly #dropAfterMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #limit: number;
  readonly #now: () => Date;
  readonly #observer: WalletTransferObserver;
  readonly #repository: WalletTransferWorkRepository;
  readonly #signer: WalletTransferSignerGateway;
  readonly #workerId: string;

  constructor(input: {
    dropAfterMilliseconds?: number;
    leaseMilliseconds?: number;
    limit?: number;
    now?: () => Date;
    observer: WalletTransferObserver;
    repository: WalletTransferWorkRepository;
    signer: WalletTransferSignerGateway;
    workerId: string;
  }) {
    this.#dropAfterMilliseconds = input.dropAfterMilliseconds ?? 15 * 60 * 1_000;
    this.#leaseMilliseconds = input.leaseMilliseconds ?? 60_000;
    this.#limit = input.limit ?? 20;
    if (
      !Number.isSafeInteger(this.#dropAfterMilliseconds) ||
      this.#dropAfterMilliseconds < 1_000 ||
      !Number.isSafeInteger(this.#leaseMilliseconds) ||
      this.#leaseMilliseconds < 1_000 ||
      !Number.isSafeInteger(this.#limit) ||
      this.#limit < 1 ||
      this.#limit > 100 ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(input.workerId)
    ) {
      throw new RangeError("wallet transfer worker configuration is invalid");
    }
    this.#now = input.now ?? (() => new Date());
    this.#observer = input.observer;
    this.#repository = input.repository;
    this.#signer = input.signer;
    this.#workerId = input.workerId;
  }

  async processBatch(): Promise<WalletTransferBatchResult> {
    const claims = await this.#repository.claimDue({
      leaseMilliseconds: this.#leaseMilliseconds,
      limit: this.#limit,
      now: this.#now(),
      workerId: this.#workerId,
    });
    const result: WalletTransferBatchResult = {
      broadcast: 0,
      claimed: claims.length,
      failed: 0,
      observed: 0,
      retried: 0,
    };
    for (const claim of claims) {
      try {
        this.#assertClaim(claim);
        if (claim.operation.state === "queued") {
          const signed = await this.#signer.signAndDeliver({
            plan: claim.operation.plan,
            planDigest: claim.operation.planDigest,
            ...(claim.operation.reauthenticatedSessionId
              ? { reauthenticatedSessionId: claim.operation.reauthenticatedSessionId }
              : {}),
            tenantId: claim.operation.tenantId,
            userId: claim.operation.userId,
          });
          this.#assertSignerResult(claim.operation.planDigest, signed);
          await this.#repository.completeBroadcast({
            claim,
            deliveredAt: this.#now(),
            result: signed,
          });
          result.broadcast += 1;
          continue;
        }
        const active = claim.operation.activeTransaction;
        if (!active) {
          throw new WalletTransferWorkerError("ACTIVE_TRANSACTION_MISSING");
        }
        const transactionLineage =
          claim.operation.state === "confirmed" ? [active] : claim.operation.transactionLineage;
        const observations = await Promise.all(
          transactionLineage.map(async (transaction) => ({
            observation: await this.#observer.observe({
              plan: claim.operation.plan,
              transactionHash: transaction.transactionHash,
            }),
            transaction,
          })),
        );
        const decision = decideWalletTransferLineageObservation({
          dropAfterMilliseconds: this.#dropAfterMilliseconds,
          now: this.#now(),
          observations,
          operation: claim.operation,
        });
        await this.#repository.applyObservation({ claim, decision, observedAt: this.#now() });
        result.observed += 1;
      } catch (error) {
        const failure = workerFailure(error);
        await this.#repository.failClaim({
          claim,
          failedAt: this.#now(),
          ...failure,
        });
        if (failure.retryable) result.retried += 1;
        else result.failed += 1;
      }
    }
    return result;
  }

  async replace(input: {
    feeLimit: WalletTransferPlan["feeLimit"];
    operationId: string;
    reason: string;
  }): Promise<WalletTransferSignerResult> {
    const authorization = await this.#repository.prepareReplacement({ ...input, now: this.#now() });
    try {
      validateWalletTransferPlan(authorization.plan, this.#now());
      if (walletTransferPlanDigest(authorization.plan) !== authorization.planDigest) {
        throw new WalletTransferWorkerError("TRANSFER_REPLACEMENT_PLAN_INVALID");
      }
      const signed = await this.#signer.signAndDeliver({
        plan: authorization.plan,
        planDigest: authorization.planDigest,
        ...(authorization.reauthenticatedSessionId
          ? { reauthenticatedSessionId: authorization.reauthenticatedSessionId }
          : {}),
        tenantId: authorization.tenantId,
        userId: authorization.userId,
      });
      this.#assertSignerResult(authorization.planDigest, signed);
      await this.#repository.completeReplacement({
        authorization,
        deliveredAt: this.#now(),
        result: signed,
      });
      return signed;
    } catch (error) {
      const failure = workerFailure(error);
      await this.#repository.rejectReplacement({
        authorization,
        failedAt: this.#now(),
        ...failure,
      });
      throw error;
    }
  }

  #assertClaim(claim: WalletTransferWorkClaim): void {
    validateWalletTransferPlan(claim.operation.plan, new Date(0));
    const lineageIds = new Set<string>();
    const lineageHashes = new Set<string>();
    const lineageGenerations = new Set<number>();
    for (const transaction of claim.operation.transactionLineage) {
      canonicalInstant(transaction.updatedAt);
      if (
        !Number.isSafeInteger(transaction.generation) ||
        transaction.generation < 0 ||
        !transferHashPattern.test(transaction.transactionHash) ||
        transaction.transactionId.length === 0 ||
        lineageIds.has(transaction.transactionId) ||
        lineageHashes.has(transaction.transactionHash) ||
        lineageGenerations.has(transaction.generation)
      ) {
        throw new WalletTransferWorkerError("TRANSFER_RECOVERY_LINEAGE_INVALID");
      }
      lineageIds.add(transaction.transactionId);
      lineageHashes.add(transaction.transactionHash);
      lineageGenerations.add(transaction.generation);
    }
    if (
      !transferDigestPattern.test(claim.operation.planDigest) ||
      walletTransferPlanDigest(claim.operation.plan) !== claim.operation.planDigest ||
      claim.operation.plan.operationId !== claim.operation.operationId ||
      (claim.operation.state === "queued"
        ? claim.operation.activeTransaction !== null ||
          claim.operation.transactionLineage.length > 0
        : claim.operation.activeTransaction === null ||
          !lineageIds.has(claim.operation.activeTransaction.transactionId))
    ) {
      throw new WalletTransferWorkerError("TRANSFER_RECOVERY_PLAN_INVALID");
    }
  }

  #assertSignerResult(
    expectedPlanDigest: `sha256:${string}`,
    result: WalletTransferSignerResult,
  ): void {
    if (
      result.planDigest !== expectedPlanDigest ||
      !transferHashPattern.test(result.transactionHash) ||
      (result.status !== "accepted" && result.status !== "already-known") ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(result.deliveryId)
    ) {
      throw new WalletTransferWorkerError("TRANSFER_SIGNER_RESPONSE_INVALID");
    }
  }
}
