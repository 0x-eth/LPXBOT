import type { HelperDeploymentState } from "@lpbot/api-contract";
import {
  buildWalletHelperV1DeploymentMaterial,
  helperDeploymentComponent,
  P05_HELPER_DEPLOYMENT_REGISTRY,
} from "@lpbot/chain-registry";
import {
  helperDeploymentPlanDigest,
  validateHelperDeploymentPlan,
  type HelperDeploymentPlan,
} from "@lpbot/domain/helper-deployment";
import { getContractAddress } from "viem";

export interface HelperDeploymentTransactionHead {
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: "broadcast" | "confirmed" | "dropped" | "failed" | "pending" | "signed";
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface HelperDeploymentTransactionReference {
  generation: number;
  transactionHash: `0x${string}`;
  transactionId: string;
  updatedAt: string;
}

export interface HelperDeploymentWorkOperation {
  activeTransaction: HelperDeploymentTransactionHead | null;
  operationId: string;
  plan: HelperDeploymentPlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId?: string;
  state: Exclude<HelperDeploymentState, "signed" | "succeeded" | "failed">;
  tenantId: string;
  transactionLineage: readonly HelperDeploymentTransactionReference[];
  userId: string;
}

export interface HelperDeploymentWorkClaim {
  eventId: string;
  leaseToken: string;
  operation: HelperDeploymentWorkOperation;
}

export interface HelperDeploymentReceiptObservation {
  blockCanonical: boolean;
  blockHash: `0x${string}`;
  blockNumber: string;
  confirmations: string;
  constructorReconciled: boolean;
  contractAddress: `0x${string}` | null;
  contractAddressReconciled: boolean;
  observedAdapter: `0x${string}` | null;
  observedOwner: `0x${string}` | null;
  observedPermit2: `0x${string}` | null;
  ownerReconciled: boolean;
  receiptStatus: "reverted" | "success";
  runtimeCodeHash: `0x${string}` | null;
  runtimeCodeReconciled: boolean;
  transactionHash: `0x${string}`;
}

export interface HelperDeploymentProviderObservation {
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
  receipt: HelperDeploymentReceiptObservation | null;
  transactionFound: boolean;
}

export interface HelperDeploymentObservation {
  providers: readonly HelperDeploymentProviderObservation[];
}

export type HelperDeploymentObservationDecision =
  | {
      kind: "defer";
      reason: "AWAITING_PROVIDER" | "AWAITING_TRANSACTION" | "CONFIRMATIONS_PENDING";
      state: "broadcast" | "confirmed" | "pending";
    }
  | {
      kind: "receipt";
      reason: string | null;
      receipt: HelperDeploymentReceiptObservation;
      state: "confirmed" | "failed" | "reconciling" | "succeeded";
      transactionId: string;
    }
  | {
      kind: "transition";
      reason: string | null;
      state: "dropped" | "pending" | "reconciling";
    };

export interface HelperDeploymentSignerResult {
  deliveryId: string;
  planDigest: `sha256:${string}`;
  status: "accepted" | "already-known";
  transactionHash: `0x${string}`;
}

export interface HelperDeploymentSignerGateway {
  signAndDeliver(input: {
    plan: HelperDeploymentPlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId?: string;
    tenantId: string;
    userId: string;
  }): Promise<HelperDeploymentSignerResult>;
}

export interface HelperDeploymentObserver {
  observe(input: {
    plan: HelperDeploymentPlan;
    transactionHash: `0x${string}`;
  }): Promise<HelperDeploymentObservation>;
}

export interface HelperDeploymentReplacementAuthorization {
  generation: number;
  operationId: string;
  plan: HelperDeploymentPlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId?: string;
  replacedTransactionId: string;
  tenantId: string;
  userId: string;
}

export interface HelperDeploymentWorkRepository {
  applyObservation(input: {
    claim: HelperDeploymentWorkClaim;
    decision: HelperDeploymentObservationDecision;
    observedAt: Date;
  }): Promise<void>;
  claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<HelperDeploymentWorkClaim[]>;
  completeBroadcast(input: {
    claim: HelperDeploymentWorkClaim;
    deliveredAt: Date;
    result: HelperDeploymentSignerResult;
  }): Promise<void>;
  completeReplacement(input: {
    authorization: HelperDeploymentReplacementAuthorization;
    deliveredAt: Date;
    result: HelperDeploymentSignerResult;
  }): Promise<void>;
  failClaim(input: {
    claim: HelperDeploymentWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
  prepareReplacement(input: {
    feeLimit: HelperDeploymentPlan["feeLimit"];
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<HelperDeploymentReplacementAuthorization>;
  rejectReplacement(input: {
    authorization: HelperDeploymentReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
}

export class HelperDeploymentWorkerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "HelperDeploymentWorkerError";
  }
}

const hashPattern = /^0x[0-9a-f]{64}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

function decimal(value: string, positive = false): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 78) {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_EVIDENCE_INVALID");
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_EVIDENCE_INVALID");
  }
  return parsed;
}

function instant(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_EVIDENCE_INVALID");
  }
  return parsed.getTime();
}

function historicalPlanValidationTime(plan: HelperDeploymentPlan): Date {
  const deadline = instant(plan.deadline);
  return new Date(deadline - 1);
}

export function validateHelperDeploymentWorkPlan(
  plan: HelperDeploymentPlan,
  now: Date = new Date(),
): void {
  const registry = P05_HELPER_DEPLOYMENT_REGISTRY;
  const material = buildWalletHelperV1DeploymentMaterial(plan.wallet.address, registry);
  validateHelperDeploymentPlan(
    plan,
    {
      adapter: helperDeploymentComponent("adapter", registry).address,
      chainId: 31_337,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.helperTemplate.creationCodeHash,
      expectedAddress: getContractAddress({
        from: plan.wallet.address,
        nonce: BigInt(plan.nonce),
      }).toLowerCase() as `0x${string}`,
      expectedRuntimeCodeHash: plan.deployment.expectedRuntimeCodeHash,
      helperVersion: "WalletHelperV1",
      initCode: material.initCode,
      initCodeHash: material.initCodeHash,
      owner: plan.wallet.address,
      permit2: helperDeploymentComponent("permit2", registry).address,
      registryDigest: registry.registryDigest,
      registryRollbackVersion: registry.rollbackVersion,
      registryValidFromBlock: registry.validFromBlock,
      registryValidToBlock: registry.validToBlock,
      registryVersion: registry.registryVersion,
      tokenA: registry.tokens[0],
      tokenB: registry.tokens[1],
    },
    now,
  );
}

function receiptIdentity(receipt: HelperDeploymentReceiptObservation | null): string {
  if (!receipt) return "none";
  decimal(receipt.blockNumber);
  decimal(receipt.confirmations, true);
  if (
    !hashPattern.test(receipt.blockHash) ||
    !hashPattern.test(receipt.transactionHash) ||
    (receipt.runtimeCodeHash !== null && !hashPattern.test(receipt.runtimeCodeHash))
  ) {
    throw new HelperDeploymentWorkerError("HELPER_RECOVERY_EVIDENCE_INVALID");
  }
  return JSON.stringify(receipt);
}

function consensus(
  observation: HelperDeploymentObservation,
): HelperDeploymentProviderObservation | null {
  if (observation.providers.length === 0) return null;
  const providers = new Set<string>();
  const identities = new Set<string>();
  for (const provider of observation.providers) {
    if (
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(provider.providerId) ||
      providers.has(provider.providerId)
    ) {
      throw new HelperDeploymentWorkerError("HELPER_RECOVERY_EVIDENCE_INVALID");
    }
    providers.add(provider.providerId);
    const latest = decimal(provider.latestNonce);
    const pending = decimal(provider.pendingNonce);
    if (pending < latest) {
      throw new HelperDeploymentWorkerError("NONCE_PENDING_BEHIND_LATEST");
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
  if (identities.size !== 1) throw new HelperDeploymentWorkerError("PROVIDER_DIVERGENCE");
  return observation.providers[0]!;
}

export function decideHelperDeploymentObservation(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observation: HelperDeploymentObservation;
  operation: HelperDeploymentWorkOperation;
  requiredConfirmations: number;
  transaction?: HelperDeploymentTransactionReference;
}): HelperDeploymentObservationDecision {
  if (
    !Number.isSafeInteger(input.dropAfterMilliseconds) ||
    input.dropAfterMilliseconds < 1_000 ||
    !Number.isSafeInteger(input.requiredConfirmations) ||
    input.requiredConfirmations < 1
  ) {
    throw new RangeError("Helper deployment observation configuration is invalid");
  }
  let provider: HelperDeploymentProviderObservation | null;
  try {
    provider = consensus(input.observation);
  } catch (error) {
    return {
      kind: "transition",
      reason: error instanceof HelperDeploymentWorkerError ? error.code : "PROVIDER_DIVERGENCE",
      state: "reconciling",
    };
  }
  if (!provider) {
    return input.operation.state === "confirmed"
      ? { kind: "transition", reason: "REORG_PROVIDER_UNAVAILABLE", state: "reconciling" }
      : { kind: "defer", reason: "AWAITING_PROVIDER", state: "pending" };
  }
  const transaction = input.transaction ?? input.operation.activeTransaction;
  if (!transaction) {
    return { kind: "transition", reason: "ACTIVE_TRANSACTION_MISSING", state: "reconciling" };
  }
  const receipt = provider.receipt;
  if (receipt) {
    if (!receipt.blockCanonical) {
      return {
        kind: "receipt",
        reason: "REORG_BLOCK_NONCANONICAL",
        receipt,
        state: "reconciling",
        transactionId: transaction.transactionId,
      };
    }
    if (receipt.receiptStatus === "reverted") {
      return {
        kind: "receipt",
        reason: "HELPER_DEPLOYMENT_REVERTED",
        receipt,
        state: "failed",
        transactionId: transaction.transactionId,
      };
    }
    const reconciled =
      receipt.contractAddressReconciled &&
      receipt.runtimeCodeReconciled &&
      receipt.ownerReconciled &&
      receipt.constructorReconciled;
    if (!reconciled) {
      return {
        kind: "receipt",
        reason: "HELPER_RECEIPT_IDENTITY_MISMATCH",
        receipt,
        state: "failed",
        transactionId: transaction.transactionId,
      };
    }
    if (BigInt(receipt.confirmations) < BigInt(input.requiredConfirmations)) {
      return {
        kind: "receipt",
        reason: "CONFIRMATIONS_PENDING",
        receipt,
        state: "confirmed",
        transactionId: transaction.transactionId,
      };
    }
    return {
      kind: "receipt",
      reason: null,
      receipt,
      state: "succeeded",
      transactionId: transaction.transactionId,
    };
  }
  if (input.operation.state === "confirmed") {
    return { kind: "transition", reason: "REORG_RECEIPT_REMOVED", state: "reconciling" };
  }
  if (provider.transactionFound) {
    return { kind: "transition", reason: null, state: "pending" };
  }
  if (input.now.getTime() - instant(transaction.updatedAt) < input.dropAfterMilliseconds) {
    return {
      kind: "defer",
      reason: "AWAITING_TRANSACTION",
      state: input.operation.state === "broadcast" ? "broadcast" : "pending",
    };
  }
  const nonce = decimal(input.operation.plan.nonce);
  if (decimal(provider.latestNonce) > nonce || decimal(provider.pendingNonce) > nonce) {
    return {
      kind: "transition",
      reason: "NONCE_CONSUMED_BY_OTHER_TRANSACTION",
      state: "reconciling",
    };
  }
  return { kind: "transition", reason: null, state: "dropped" };
}

function decideLineage(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observations: ReadonlyArray<{
    observation: HelperDeploymentObservation;
    transaction: HelperDeploymentTransactionReference;
  }>;
  operation: HelperDeploymentWorkOperation;
  requiredConfirmations: number;
}): HelperDeploymentObservationDecision {
  const decisions = input.observations.map(({ observation, transaction }) =>
    decideHelperDeploymentObservation({
      dropAfterMilliseconds: input.dropAfterMilliseconds,
      now: input.now,
      observation,
      operation: input.operation,
      requiredConfirmations: input.requiredConfirmations,
      transaction,
    }),
  );
  const receipts = decisions.filter(
    (decision): decision is Extract<HelperDeploymentObservationDecision, { kind: "receipt" }> =>
      decision.kind === "receipt",
  );
  if (receipts.length > 1) {
    return { kind: "transition", reason: "LINEAGE_RECEIPT_DIVERGENCE", state: "reconciling" };
  }
  if (receipts[0]) return receipts[0];
  const reconciliation = decisions.find(({ state }) => state === "reconciling");
  if (reconciliation) return reconciliation;
  const pending = decisions.find(
    (decision) => decision.kind === "transition" && decision.state === "pending",
  );
  if (pending) return pending;
  const active = input.operation.activeTransaction;
  const activeIndex = input.observations.findIndex(
    ({ transaction }) => transaction.transactionId === active?.transactionId,
  );
  return decisions[activeIndex] ?? decisions[0]!;
}

export function replacementHelperDeploymentPlan(input: {
  feeLimit: HelperDeploymentPlan["feeLimit"];
  now: Date;
  plan: HelperDeploymentPlan;
}): HelperDeploymentPlan {
  const gas = decimal(input.feeLimit.gasLimit, true);
  const maxFee = decimal(input.feeLimit.maxFeePerGasBaseUnit, true);
  const priority = decimal(input.feeLimit.maxPriorityFeePerGasBaseUnit);
  const cap = decimal(input.feeLimit.feeCapBaseUnit, true);
  if (
    gas.toString() !== input.plan.feeLimit.gasLimit ||
    priority > maxFee ||
    gas * maxFee !== cap ||
    maxFee < BigInt(input.plan.feeLimit.maxFeePerGasBaseUnit) ||
    priority < BigInt(input.plan.feeLimit.maxPriorityFeePerGasBaseUnit) ||
    (maxFee.toString() === input.plan.feeLimit.maxFeePerGasBaseUnit &&
      priority.toString() === input.plan.feeLimit.maxPriorityFeePerGasBaseUnit)
  ) {
    throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_FEE_INVALID");
  }
  const replacement = structuredClone(input.plan);
  replacement.feeLimit = {
    feeCapBaseUnit: cap.toString(),
    gasLimit: gas.toString(),
    maxFeePerGasBaseUnit: maxFee.toString(),
    maxPriorityFeePerGasBaseUnit: priority.toString(),
  };
  replacement.planDigest = helperDeploymentPlanDigest(replacement);
  validateHelperDeploymentWorkPlan(replacement, input.now);
  return replacement;
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
  return { code: "HELPER_WORKER_UNAVAILABLE", retryable: true };
}

export interface HelperDeploymentBatchResult {
  broadcast: number;
  claimed: number;
  failed: number;
  observed: number;
  retried: number;
}

export class HelperDeploymentRecoveryWorker {
  readonly #dropAfterMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #limit: number;
  readonly #now: () => Date;
  readonly #observer: HelperDeploymentObserver;
  readonly #repository: HelperDeploymentWorkRepository;
  readonly #requiredConfirmations: number;
  readonly #signer: HelperDeploymentSignerGateway;
  readonly #workerId: string;

  constructor(input: {
    dropAfterMilliseconds?: number;
    leaseMilliseconds?: number;
    limit?: number;
    now?: () => Date;
    observer: HelperDeploymentObserver;
    repository: HelperDeploymentWorkRepository;
    requiredConfirmations?: number;
    signer: HelperDeploymentSignerGateway;
    workerId: string;
  }) {
    this.#dropAfterMilliseconds = input.dropAfterMilliseconds ?? 15 * 60 * 1_000;
    this.#leaseMilliseconds = input.leaseMilliseconds ?? 60_000;
    this.#limit = input.limit ?? 20;
    this.#requiredConfirmations = input.requiredConfirmations ?? 1;
    if (
      !Number.isSafeInteger(this.#dropAfterMilliseconds) ||
      this.#dropAfterMilliseconds < 1_000 ||
      !Number.isSafeInteger(this.#leaseMilliseconds) ||
      this.#leaseMilliseconds < 1_000 ||
      !Number.isSafeInteger(this.#limit) ||
      this.#limit < 1 ||
      this.#limit > 100 ||
      !Number.isSafeInteger(this.#requiredConfirmations) ||
      this.#requiredConfirmations < 1 ||
      this.#requiredConfirmations > 128 ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(input.workerId)
    ) {
      throw new RangeError("Helper deployment worker configuration is invalid");
    }
    this.#now = input.now ?? (() => new Date());
    this.#observer = input.observer;
    this.#repository = input.repository;
    this.#signer = input.signer;
    this.#workerId = input.workerId;
  }

  async processBatch(): Promise<HelperDeploymentBatchResult> {
    const claims = await this.#repository.claimDue({
      leaseMilliseconds: this.#leaseMilliseconds,
      limit: this.#limit,
      now: this.#now(),
      workerId: this.#workerId,
    });
    const result: HelperDeploymentBatchResult = {
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
        if (!claim.operation.activeTransaction || claim.operation.transactionLineage.length === 0) {
          throw new HelperDeploymentWorkerError("ACTIVE_TRANSACTION_MISSING");
        }
        const observations = await Promise.all(
          claim.operation.transactionLineage.map(async (transaction) => ({
            observation: await this.#observer.observe({
              plan: claim.operation.plan,
              transactionHash: transaction.transactionHash,
            }),
            transaction,
          })),
        );
        const decision = decideLineage({
          dropAfterMilliseconds: this.#dropAfterMilliseconds,
          now: this.#now(),
          observations,
          operation: claim.operation,
          requiredConfirmations: this.#requiredConfirmations,
        });
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
    feeLimit: HelperDeploymentPlan["feeLimit"];
    operationId: string;
    reason: string;
  }): Promise<HelperDeploymentSignerResult> {
    const authorization = await this.#repository.prepareReplacement({ ...input, now: this.#now() });
    try {
      validateHelperDeploymentWorkPlan(authorization.plan, this.#now());
      if (helperDeploymentPlanDigest(authorization.plan) !== authorization.planDigest) {
        throw new HelperDeploymentWorkerError("HELPER_REPLACEMENT_PLAN_INVALID");
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
      const failed = failure(error);
      await this.#repository.rejectReplacement({
        authorization,
        failedAt: this.#now(),
        ...failed,
      });
      throw error;
    }
  }

  #assertClaim(claim: HelperDeploymentWorkClaim): void {
    validateHelperDeploymentWorkPlan(
      claim.operation.plan,
      historicalPlanValidationTime(claim.operation.plan),
    );
    if (
      !digestPattern.test(claim.operation.planDigest) ||
      helperDeploymentPlanDigest(claim.operation.plan) !== claim.operation.planDigest ||
      claim.operation.plan.operationId !== claim.operation.operationId ||
      (claim.operation.state === "queued"
        ? claim.operation.activeTransaction !== null ||
          claim.operation.transactionLineage.length !== 0
        : claim.operation.activeTransaction === null ||
          !claim.operation.transactionLineage.some(
            ({ transactionId }) =>
              transactionId === claim.operation.activeTransaction?.transactionId,
          ))
    ) {
      throw new HelperDeploymentWorkerError("HELPER_RECOVERY_PLAN_INVALID");
    }
    const identities = new Set<string>();
    const hashes = new Set<string>();
    const generations = new Set<number>();
    for (const transaction of claim.operation.transactionLineage) {
      instant(transaction.updatedAt);
      if (
        !Number.isSafeInteger(transaction.generation) ||
        transaction.generation < 0 ||
        !hashPattern.test(transaction.transactionHash) ||
        identities.has(transaction.transactionId) ||
        hashes.has(transaction.transactionHash) ||
        generations.has(transaction.generation)
      ) {
        throw new HelperDeploymentWorkerError("HELPER_RECOVERY_LINEAGE_INVALID");
      }
      identities.add(transaction.transactionId);
      hashes.add(transaction.transactionHash);
      generations.add(transaction.generation);
    }
  }

  #assertSignerResult(planDigest: `sha256:${string}`, result: HelperDeploymentSignerResult): void {
    if (
      result.planDigest !== planDigest ||
      !hashPattern.test(result.transactionHash) ||
      (result.status !== "accepted" && result.status !== "already-known") ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(result.deliveryId)
    ) {
      throw new HelperDeploymentWorkerError("HELPER_SIGNER_RESPONSE_INVALID", true);
    }
  }
}
