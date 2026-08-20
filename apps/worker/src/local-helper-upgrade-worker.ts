import type { LocalHelperUpgradeCursor } from "@lpbot/api-contract";
import {
  buildWalletHelperV2DeploymentMaterial,
  P05_HELPER_DEPLOYMENT_REGISTRY,
  P05_LOCAL_HELPER_UPGRADE_REGISTRY,
  validateLocalHelperUpgradeRegistry,
} from "@lpbot/chain-registry";
import {
  assertWalletHelperV2Verification,
  localHelperUpgradePlanDigest,
  localHelperUpgradeReplacementCandidate,
  localHelperUpgradeSelectorSetHash,
  validateLocalHelperUpgradePlan,
  validateLocalHelperUpgradeReplacement,
  type LocalHelperUpgradePlan,
  type LocalHelperUpgradeReplacementCandidate,
  type WalletHelperV2Verification,
} from "@lpbot/domain/local-helper-upgrade";
import type { LocalHelperResidualSnapshot } from "@lpbot/domain/local-helper-sweep";
import { getContractAddress } from "viem";

export interface LocalHelperUpgradeTransactionReference {
  active: boolean;
  generation: number;
  maxFeePerGasBaseUnit: string;
  maxPriorityFeePerGasBaseUnit: string;
  state: "signed" | "broadcast" | "pending" | "confirmed" | "failed" | "dropped" | "replaced";
  transactionHash: `0x${string}` | null;
  transactionId: string;
  updatedAt: string;
}

export interface LocalHelperUpgradeWorkOperation {
  cursor: Exclude<LocalHelperUpgradeCursor, "completed">;
  finalSnapshot: LocalHelperResidualSnapshot | null;
  operationId: string;
  plan: LocalHelperUpgradePlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId: string;
  state: "queued" | "running";
  sweepBatchId: string | null;
  tenantId: string;
  transactions: readonly LocalHelperUpgradeTransactionReference[];
  userId: string;
  verification: WalletHelperV2Verification | null;
}

export interface LocalHelperUpgradeWorkClaim {
  leaseToken: string;
  operation: LocalHelperUpgradeWorkOperation;
  outboxEventId: string;
}

export interface LocalHelperUpgradeSignerResult {
  deliveryId: string;
  generation: number;
  operationId: string;
  planDigest: `sha256:${string}`;
  status: "accepted" | "already-known";
  transactionHash: `0x${string}`;
}

export interface LocalHelperUpgradeSignerGateway {
  signAndDeliver(input: {
    generation: number;
    maxFeePerGasBaseUnit: string;
    maxPriorityFeePerGasBaseUnit: string;
    operationId: string;
    plan: LocalHelperUpgradePlan;
    planDigest: `sha256:${string}`;
    reauthenticatedSessionId: string;
    tenantId: string;
    userId: string;
  }): Promise<LocalHelperUpgradeSignerResult>;
}

export interface LocalHelperUpgradeReceiptObservation {
  blockCanonical: boolean;
  blockHash: `0x${string}`;
  blockNumber: string;
  confirmations: string;
  contractAddress: `0x${string}` | null;
  receiptStatus: "reverted" | "success";
  runtimeCodeHash: `0x${string}` | null;
  transactionHash: `0x${string}`;
  transactionReconciled: boolean;
}

export interface LocalHelperUpgradeProviderObservation {
  latestNonce: string;
  pendingNonce: string;
  providerId: string;
  receipt: LocalHelperUpgradeReceiptObservation | null;
  transactionFound: boolean;
}

export interface LocalHelperUpgradeObservation {
  providers: readonly LocalHelperUpgradeProviderObservation[];
}

export interface LocalHelperUpgradeObserver {
  observeDeployment(input: {
    plan: LocalHelperUpgradePlan;
    transactionHash: `0x${string}`;
  }): Promise<LocalHelperUpgradeObservation>;
  verifyV2(input: { plan: LocalHelperUpgradePlan }): Promise<WalletHelperV2Verification>;
}

export type LocalHelperUpgradeDeploymentDecision =
  | {
      kind: "defer";
      reason: "AWAITING_TRANSACTION" | "CONFIRMATIONS_PENDING";
      state: "pending" | "confirmed";
    }
  | {
      kind: "receipt";
      reason: string | null;
      receipt: LocalHelperUpgradeReceiptObservation;
      state: "confirmed" | "failed" | "reconciling";
      transactionId: string;
    }
  | {
      kind: "transition";
      reason: "NONCE_CONSUMED" | "PROVIDER_DIVERGENCE" | "TRANSACTION_DROPPED";
      state: "dropped" | "reconciling";
    };

export type LocalHelperUpgradeSweepResult =
  | { batchId: string | null; kind: "completed" }
  | { batchId: string; kind: "pending" }
  | { batchId: string | null; blockers: string[]; kind: "manual-recovery-required" };

export interface LocalHelperUpgradeSweepGateway {
  finalRescan(operation: LocalHelperUpgradeWorkOperation): Promise<LocalHelperResidualSnapshot>;
  sweep(operation: LocalHelperUpgradeWorkOperation): Promise<LocalHelperUpgradeSweepResult>;
}

export interface LocalHelperUpgradeReplacementAuthorization {
  fee: LocalHelperUpgradeReplacementCandidate["fee"];
  generation: number;
  operationId: string;
  plan: LocalHelperUpgradePlan;
  planDigest: `sha256:${string}`;
  reauthenticatedSessionId: string;
  replacedTransactionId: string;
  tenantId: string;
  userId: string;
}

export interface LocalHelperUpgradeWorkRepository {
  advance(input: {
    claim: LocalHelperUpgradeWorkClaim;
    completedAt: Date;
    next: Exclude<LocalHelperUpgradeCursor, "preflight" | "completed">;
  }): Promise<void>;
  applyDeploymentObservation(input: {
    claim: LocalHelperUpgradeWorkClaim;
    decision: LocalHelperUpgradeDeploymentDecision;
    observedAt: Date;
  }): Promise<void>;
  applySweepResult(input: {
    claim: LocalHelperUpgradeWorkClaim;
    observedAt: Date;
    result: LocalHelperUpgradeSweepResult;
  }): Promise<void>;
  claimDue(input: {
    leaseMilliseconds: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<LocalHelperUpgradeWorkClaim[]>;
  completeAtomicBindingSwitch(input: {
    claim: LocalHelperUpgradeWorkClaim;
    completedAt: Date;
  }): Promise<void>;
  completeBroadcast(input: {
    claim: LocalHelperUpgradeWorkClaim;
    deliveredAt: Date;
    result: LocalHelperUpgradeSignerResult;
  }): Promise<void>;
  completeFinalRescan(input: {
    claim: LocalHelperUpgradeWorkClaim;
    observedAt: Date;
    snapshot: LocalHelperResidualSnapshot;
  }): Promise<void>;
  completeReplacement(input: {
    authorization: LocalHelperUpgradeReplacementAuthorization;
    deliveredAt: Date;
    result: LocalHelperUpgradeSignerResult;
  }): Promise<void>;
  completeVerification(input: {
    claim: LocalHelperUpgradeWorkClaim;
    verifiedAt: Date;
    verification: WalletHelperV2Verification;
  }): Promise<void>;
  failClaim(input: {
    claim: LocalHelperUpgradeWorkClaim;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
  prepareReplacement(input: {
    fee: LocalHelperUpgradeReplacementCandidate["fee"];
    now: Date;
    operationId: string;
    reason: string;
  }): Promise<LocalHelperUpgradeReplacementAuthorization>;
  rejectReplacement(input: {
    authorization: LocalHelperUpgradeReplacementAuthorization;
    code: string;
    failedAt: Date;
    retryable: boolean;
  }): Promise<void>;
}

export class LocalHelperUpgradeWorkerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "LocalHelperUpgradeWorkerError";
  }
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const hashPattern = /^0x[0-9a-f]{64}$/u;

function decimal(value: string, positive = false): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 78) {
    throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_EVIDENCE_INVALID");
  }
  const parsed = BigInt(value);
  if (positive && parsed === 0n) {
    throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_EVIDENCE_INVALID");
  }
  return parsed;
}

function instant(value: string): number {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_EVIDENCE_INVALID");
  }
  return parsed.getTime();
}

function historicalValidationTime(plan: LocalHelperUpgradePlan): Date {
  return new Date(instant(plan.deadline) - 1);
}

export function validateLocalHelperUpgradeWorkPlan(
  plan: LocalHelperUpgradePlan,
  now: Date = new Date(),
): void {
  const registry = validateLocalHelperUpgradeRegistry(P05_LOCAL_HELPER_UPGRADE_REGISTRY);
  const material = buildWalletHelperV2DeploymentMaterial(plan.wallet.address, registry);
  const adapter = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "adapter")!;
  const permit2 = P05_HELPER_DEPLOYMENT_REGISTRY.components.find(({ role }) => role === "permit2")!;
  const expectedAddress = getContractAddress({
    from: plan.wallet.address,
    nonce: BigInt(plan.nonce),
  }).toLowerCase() as `0x${string}`;
  validateLocalHelperUpgradePlan(
    plan,
    {
      abiHash: registry.target.abiHash,
      adapter: adapter.address,
      constructorArgumentsHash: material.constructorArgumentsHash,
      creationCodeHash: registry.target.creationCodeHash,
      expectedAddress,
      expectedRuntimeCodeHash: plan.target.expectedRuntimeCodeHash,
      initCode: material.initCode,
      initCodeHash: material.initCodeHash,
      owner: plan.wallet.address,
      permit2: permit2.address,
      registryDigest: registry.registryDigest,
      selectorSetHash: localHelperUpgradeSelectorSetHash(registry.target.selectors),
      sourceBinding: {
        adapterAddress: adapter.address,
        bindingId: plan.source.bindingId,
        deploymentRegistryVersion: registry.source.bindingRegistryVersion,
        helperAddress: plan.source.helperAddress,
        helperVersion: "WalletHelperV1",
        ownerAddress: plan.wallet.address,
        permit2Address: permit2.address,
        runtimeCodeHash: plan.source.runtimeCodeHash,
        state: "active",
        verifiedBlockNumber: plan.snapshot.blockNumber,
        walletId: plan.wallet.walletId,
      },
      tokenA: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[0],
      tokenB: P05_HELPER_DEPLOYMENT_REGISTRY.tokens[1],
    },
    now,
  );
}

function receiptIdentity(receipt: LocalHelperUpgradeReceiptObservation | null): string {
  if (!receipt) return "none";
  decimal(receipt.blockNumber);
  decimal(receipt.confirmations, true);
  if (
    !hashPattern.test(receipt.blockHash) ||
    !hashPattern.test(receipt.transactionHash) ||
    (receipt.runtimeCodeHash !== null && !hashPattern.test(receipt.runtimeCodeHash))
  ) {
    throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_EVIDENCE_INVALID");
  }
  return JSON.stringify(receipt);
}

function consensus(
  observations: readonly LocalHelperUpgradeProviderObservation[],
): { latestNonce: bigint; pendingNonce: bigint; receipt: LocalHelperUpgradeReceiptObservation | null } | null {
  if (observations.length < 1 || observations.length > 4) return null;
  const ids = new Set<string>();
  const values = new Set<string>();
  let latestNonce = 0n;
  let pendingNonce = 0n;
  for (const observation of observations) {
    if (ids.has(observation.providerId)) return null;
    ids.add(observation.providerId);
    latestNonce = decimal(observation.latestNonce);
    pendingNonce = decimal(observation.pendingNonce);
    if (pendingNonce < latestNonce) return null;
    values.add(
      JSON.stringify({
        latestNonce: observation.latestNonce,
        pendingNonce: observation.pendingNonce,
        receipt: receiptIdentity(observation.receipt),
        transactionFound: observation.transactionFound,
      }),
    );
  }
  return values.size === 1
    ? { latestNonce, pendingNonce, receipt: observations[0]!.receipt }
    : null;
}

export function decideLocalHelperUpgradeDeploymentObservation(input: {
  dropAfterMilliseconds: number;
  now: Date;
  observations: readonly {
    observation: LocalHelperUpgradeObservation;
    transaction: LocalHelperUpgradeTransactionReference;
  }[];
  operation: LocalHelperUpgradeWorkOperation;
  requiredConfirmations: number;
}): LocalHelperUpgradeDeploymentDecision {
  const nonce = BigInt(input.operation.plan.nonce);
  let sawTransaction = false;
  let minimumAge = Number.POSITIVE_INFINITY;
  for (const entry of [...input.observations].sort(
    (left, right) => right.transaction.generation - left.transaction.generation,
  )) {
    const agreed = consensus(entry.observation.providers);
    if (!agreed) {
      return { kind: "transition", reason: "PROVIDER_DIVERGENCE", state: "reconciling" };
    }
    sawTransaction ||= entry.observation.providers[0]!.transactionFound;
    minimumAge = Math.min(minimumAge, input.now.getTime() - instant(entry.transaction.updatedAt));
    const receipt = agreed.receipt;
    if (!receipt) continue;
    if (!receipt.blockCanonical) {
      return {
        kind: "receipt",
        reason: "RECEIPT_REORGED",
        receipt,
        state: "reconciling",
        transactionId: entry.transaction.transactionId,
      };
    }
    if (receipt.receiptStatus === "reverted") {
      return {
        kind: "receipt",
        reason: "DEPLOYMENT_REVERTED",
        receipt,
        state: "failed",
        transactionId: entry.transaction.transactionId,
      };
    }
    if (
      !receipt.transactionReconciled ||
      receipt.contractAddress !== input.operation.plan.target.expectedAddress ||
      receipt.runtimeCodeHash !== input.operation.plan.target.expectedRuntimeCodeHash
    ) {
      return {
        kind: "receipt",
        reason: "DEPLOYMENT_IDENTITY_MISMATCH",
        receipt,
        state: "failed",
        transactionId: entry.transaction.transactionId,
      };
    }
    if (decimal(receipt.confirmations, true) < BigInt(input.requiredConfirmations)) {
      return { kind: "defer", reason: "CONFIRMATIONS_PENDING", state: "confirmed" };
    }
    return {
      kind: "receipt",
      reason: null,
      receipt,
      state: "confirmed",
      transactionId: entry.transaction.transactionId,
    };
  }
  const heads = input.observations.map(({ observation }) => consensus(observation.providers));
  if (heads.some((head) => head && (head.latestNonce > nonce || head.pendingNonce > nonce))) {
    return { kind: "transition", reason: "NONCE_CONSUMED", state: "reconciling" };
  }
  if (!sawTransaction && minimumAge >= input.dropAfterMilliseconds) {
    return { kind: "transition", reason: "TRANSACTION_DROPPED", state: "dropped" };
  }
  return { kind: "defer", reason: "AWAITING_TRANSACTION", state: "pending" };
}

function failure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof LocalHelperUpgradeWorkerError) {
    return { code: error.code, retryable: error.retryable };
  }
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
  return { code: "HELPER_UPGRADE_WORKER_UNAVAILABLE", retryable: true };
}

export interface LocalHelperUpgradeBatchResult {
  broadcast: number;
  claimed: number;
  completed: number;
  failed: number;
  manualRecovery: number;
  observed: number;
  retried: number;
}

export class LocalHelperUpgradeRecoveryWorker {
  readonly #dropAfterMilliseconds: number;
  readonly #leaseMilliseconds: number;
  readonly #limit: number;
  readonly #now: () => Date;
  readonly #observer: LocalHelperUpgradeObserver;
  readonly #repository: LocalHelperUpgradeWorkRepository;
  readonly #requiredConfirmations: number;
  readonly #signer: LocalHelperUpgradeSignerGateway;
  readonly #sweeper: LocalHelperUpgradeSweepGateway;
  readonly #workerId: string;

  constructor(input: {
    dropAfterMilliseconds?: number;
    leaseMilliseconds?: number;
    limit?: number;
    now?: () => Date;
    observer: LocalHelperUpgradeObserver;
    repository: LocalHelperUpgradeWorkRepository;
    requiredConfirmations?: number;
    signer: LocalHelperUpgradeSignerGateway;
    sweeper: LocalHelperUpgradeSweepGateway;
    workerId: string;
  }) {
    this.#dropAfterMilliseconds = input.dropAfterMilliseconds ?? 15 * 60_000;
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
      throw new RangeError("LOCAL_HELPER_UPGRADE_WORKER_CONFIG_INVALID");
    }
    this.#now = input.now ?? (() => new Date());
    this.#observer = input.observer;
    this.#repository = input.repository;
    this.#signer = input.signer;
    this.#sweeper = input.sweeper;
    this.#workerId = input.workerId;
  }

  async processBatch(): Promise<LocalHelperUpgradeBatchResult> {
    const claims = await this.#repository.claimDue({
      leaseMilliseconds: this.#leaseMilliseconds,
      limit: this.#limit,
      now: this.#now(),
      workerId: this.#workerId,
    });
    const result: LocalHelperUpgradeBatchResult = {
      broadcast: 0,
      claimed: claims.length,
      completed: 0,
      failed: 0,
      manualRecovery: 0,
      observed: 0,
      retried: 0,
    };
    for (const claim of claims) {
      try {
        this.#assertClaim(claim);
        const operation = claim.operation;
        if (operation.cursor === "preflight") {
          await this.#repository.advance({ claim, completedAt: this.#now(), next: "deploy-v2" });
          result.completed += 1;
          continue;
        }
        if (operation.cursor === "deploy-v2") {
          if (operation.transactions.length === 0) {
            const signed = await this.#signer.signAndDeliver({
              generation: 0,
              maxFeePerGasBaseUnit: operation.plan.feeLimit.maxFeePerGasBaseUnit,
              maxPriorityFeePerGasBaseUnit:
                operation.plan.feeLimit.maxPriorityFeePerGasBaseUnit,
              operationId: operation.operationId,
              plan: operation.plan,
              planDigest: operation.planDigest,
              reauthenticatedSessionId: operation.reauthenticatedSessionId,
              tenantId: operation.tenantId,
              userId: operation.userId,
            });
            this.#assertSignerResult(operation, signed, 0);
            await this.#repository.completeBroadcast({
              claim,
              deliveredAt: this.#now(),
              result: signed,
            });
            result.broadcast += 1;
            continue;
          }
          const lineage = operation.transactions.filter(
            (transaction) => transaction.transactionHash !== null,
          );
          if (lineage.length === 0) {
            throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_LINEAGE_INVALID");
          }
          const observations = await Promise.all(
            lineage.map(async (transaction) => ({
              observation: await this.#observer.observeDeployment({
                plan: operation.plan,
                transactionHash: transaction.transactionHash!,
              }),
              transaction,
            })),
          );
          const decision = decideLocalHelperUpgradeDeploymentObservation({
            dropAfterMilliseconds: this.#dropAfterMilliseconds,
            now: this.#now(),
            observations,
            operation,
            requiredConfirmations: this.#requiredConfirmations,
          });
          await this.#repository.applyDeploymentObservation({
            claim,
            decision,
            observedAt: this.#now(),
          });
          result.observed += 1;
          continue;
        }
        if (operation.cursor === "verify-v2") {
          const verification = await this.#observer.verifyV2({ plan: operation.plan });
          this.#assertVerification(operation.plan, verification);
          await this.#repository.completeVerification({
            claim,
            verification,
            verifiedAt: this.#now(),
          });
          result.completed += 1;
          continue;
        }
        if (operation.cursor === "sweep-v1") {
          const sweep = await this.#sweeper.sweep(operation);
          await this.#repository.applySweepResult({ claim, observedAt: this.#now(), result: sweep });
          if (sweep.kind === "manual-recovery-required") result.manualRecovery += 1;
          else if (sweep.kind === "completed") result.completed += 1;
          else result.observed += 1;
          continue;
        }
        if (operation.cursor === "final-rescan-v1") {
          const snapshot = await this.#sweeper.finalRescan(operation);
          await this.#repository.completeFinalRescan({ claim, observedAt: this.#now(), snapshot });
          result.completed += 1;
          continue;
        }
        await this.#repository.completeAtomicBindingSwitch({
          claim,
          completedAt: this.#now(),
        });
        result.completed += 1;
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
    fee: LocalHelperUpgradeReplacementCandidate["fee"];
    operationId: string;
    reason: string;
  }): Promise<LocalHelperUpgradeSignerResult> {
    const authorization = await this.#repository.prepareReplacement({ ...input, now: this.#now() });
    try {
      validateLocalHelperUpgradeWorkPlan(
        authorization.plan,
        historicalValidationTime(authorization.plan),
      );
      const previous = authorization.plan;
      const previousFee = this.#activeReplacementFee(authorization);
      validateLocalHelperUpgradeReplacement(
        previous,
        localHelperUpgradeReplacementCandidate(previous, previousFee),
        localHelperUpgradeReplacementCandidate(previous, authorization.fee),
      );
      const signed = await this.#signer.signAndDeliver({
        fee: authorization.fee,
        generation: authorization.generation,
        maxFeePerGasBaseUnit: authorization.fee.maxFeePerGasBaseUnit,
        maxPriorityFeePerGasBaseUnit: authorization.fee.maxPriorityFeePerGasBaseUnit,
        operationId: authorization.operationId,
        plan: authorization.plan,
        planDigest: authorization.planDigest,
        reauthenticatedSessionId: authorization.reauthenticatedSessionId,
        tenantId: authorization.tenantId,
        userId: authorization.userId,
      } as Parameters<LocalHelperUpgradeSignerGateway["signAndDeliver"]>[0]);
      this.#assertSignerResult(
        {
          operationId: authorization.operationId,
          plan: authorization.plan,
          planDigest: authorization.planDigest,
        },
        signed,
        authorization.generation,
      );
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

  #activeReplacementFee(
    authorization: LocalHelperUpgradeReplacementAuthorization,
  ): LocalHelperUpgradeReplacementCandidate["fee"] {
    const operation = authorization.plan;
    return {
      maxFeePerGasBaseUnit: operation.feeLimit.maxFeePerGasBaseUnit,
      maxPriorityFeePerGasBaseUnit: operation.feeLimit.maxPriorityFeePerGasBaseUnit,
    };
  }

  #assertClaim(claim: LocalHelperUpgradeWorkClaim): void {
    const operation = claim.operation;
    validateLocalHelperUpgradeWorkPlan(operation.plan, historicalValidationTime(operation.plan));
    if (
      operation.plan.operationId !== operation.operationId ||
      operation.plan.planDigest !== operation.planDigest ||
      localHelperUpgradePlanDigest(operation.plan) !== operation.planDigest ||
      !digestPattern.test(operation.planDigest) ||
      (operation.cursor === "preflight" && operation.state !== "queued") ||
      (operation.cursor !== "preflight" && operation.state !== "running")
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_RECOVERY_PLAN_INVALID");
    }
    const ids = new Set<string>();
    const generations = new Set<number>();
    const hashes = new Set<string>();
    let active = 0;
    for (const transaction of operation.transactions) {
      instant(transaction.updatedAt);
      if (
        !Number.isSafeInteger(transaction.generation) ||
        transaction.generation < 0 ||
        ids.has(transaction.transactionId) ||
        generations.has(transaction.generation) ||
        (transaction.transactionHash !== null &&
          (!hashPattern.test(transaction.transactionHash) || hashes.has(transaction.transactionHash)))
      ) {
        throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_LINEAGE_INVALID");
      }
      ids.add(transaction.transactionId);
      generations.add(transaction.generation);
      if (transaction.transactionHash) hashes.add(transaction.transactionHash);
      if (transaction.active) active += 1;
    }
    if (active > 1 || (operation.transactions.length > 0 && active !== 1)) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_LINEAGE_INVALID");
    }
  }

  #assertSignerResult(
    operation: Pick<LocalHelperUpgradeWorkOperation, "operationId" | "plan" | "planDigest">,
    result: LocalHelperUpgradeSignerResult,
    generation: number,
  ): void {
    if (
      result.operationId !== operation.operationId ||
      result.planDigest !== operation.planDigest ||
      result.generation !== generation ||
      !hashPattern.test(result.transactionHash) ||
      (result.status !== "accepted" && result.status !== "already-known") ||
      !/^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u.test(result.deliveryId)
    ) {
      throw new LocalHelperUpgradeWorkerError("HELPER_UPGRADE_SIGNER_RESPONSE_INVALID", true);
    }
  }

  #assertVerification(plan: LocalHelperUpgradePlan, verification: WalletHelperV2Verification): void {
    assertWalletHelperV2Verification(verification, {
      abiHash: plan.target.abiHash,
      adapter: plan.target.adapter,
      expectedAddress: plan.target.expectedAddress,
      expectedRuntimeCodeHash: plan.target.expectedRuntimeCodeHash,
      owner: plan.target.owner,
      permit2: plan.target.permit2,
      selectorSetHash: plan.target.selectorSetHash,
      tokenA: plan.target.tokenA,
      tokenB: plan.target.tokenB,
    });
  }
}
