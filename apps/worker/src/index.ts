import { chainRegistryPackage } from "@lpbot/chain-registry";
import { domainPackage } from "@lpbot/domain";
import { observabilityPackage } from "@lpbot/observability";

export {
  EmptyMonitorDestinationSelector,
  MonitorEvaluationWorker,
  candidateEvidenceDecision,
  isOutboxClaimable,
  notificationDedupeKey,
  orderCanonicalMarketInputs,
  outboxRetryDelaySeconds,
} from "./monitoring.js";
export type {
  CanonicalMarketInputIdentity,
  CanonicalMonitorMetricInput,
  MonitorCandidateCommitPort,
  MonitorDestinationSelection,
  MonitorDestinationSelector,
  MonitorEvaluationBatchResult,
  MonitorEvaluationBlocklistSource,
  MonitorEvaluationMonitorSource,
  MonitorEvaluationWorkerOptions,
  NotificationOutboxState,
} from "./monitoring.js";
export { PostgresMonitorCandidateOutboxRepository } from "./postgres-monitor-outbox.js";
export { PostgresMonitorDestinationSelector } from "./postgres-monitor-destination-selector.js";
export { PostgresMonitorEvaluationSource } from "./postgres-monitor-source.js";
export type {
  CandidateEvidenceAction,
  CommitMonitorCandidateInput,
  CommitMonitorCandidateResult,
  MonitorOutboxDestination,
  NotificationOutboxDelivery,
} from "./postgres-monitor-outbox.js";
export {
  WalletTransferRecoveryWorker,
  WalletTransferWorkerError,
  decideWalletTransferObservation,
  replacementTransferPlan,
} from "./wallet-transfer-worker.js";
export { PostgresWalletTransferRecoveryRepository } from "./postgres-wallet-transfer-recovery.js";
export { ViemLocalWalletTransferObserver } from "./viem-local-wallet-transfer-observer.js";
export { LoopbackWalletTransferSignerGateway } from "./loopback-wallet-transfer-signer-gateway.js";
export {
  HelperDeploymentRecoveryWorker,
  HelperDeploymentWorkerError,
  decideHelperDeploymentObservation,
  replacementHelperDeploymentPlan,
  validateHelperDeploymentWorkPlan,
} from "./helper-deployment-worker.js";
export {
  decideLocalSwapObservation,
  LocalSwapRecoveryWorker,
  LocalSwapWorkerError,
  validateLocalSwapWorkPlan,
} from "./local-swap-worker.js";
export { LoopbackLocalSwapSignerGateway } from "./loopback-local-swap-signer-gateway.js";
export { ViemLocalSwapObserver } from "./viem-local-swap-observer.js";
export type { ViemLocalSwapObserverOptions } from "./viem-local-swap-observer.js";
export { PostgresLocalSwapRecoveryRepository } from "./postgres-local-swap-recovery.js";
export type {
  LocalSwapBatchResult,
  LocalSwapObservation,
  LocalSwapObservationDecision,
  LocalSwapObserver,
  LocalSwapProviderObservation,
  LocalSwapReceiptObservation,
  LocalSwapReplacementAuthorization,
  LocalSwapStepSignerGateway,
  LocalSwapStepSignerResult,
  LocalSwapStepWorkOperation,
  LocalSwapTransactionReference,
  LocalSwapWorkClaim,
  LocalSwapWorkRepository,
} from "./local-swap-worker.js";
export {
  decideLocalPositionObservation,
  LocalPositionRecoveryWorker,
  LocalPositionWorkerError,
  validateLocalPositionWorkPlan,
} from "./local-position-worker.js";
export {
  decideLocalHelperSweepObservation,
  localHelperSweepReplacementCandidate,
  LocalHelperSweepRecoveryWorker,
  LocalHelperSweepWorkerError,
  validateLocalHelperSweepWorkPlan,
} from "./local-helper-sweep-worker.js";
export { ViemLocalHelperSweepObserver } from "./viem-local-helper-sweep-observer.js";
export type { ViemLocalHelperSweepObserverOptions } from "./viem-local-helper-sweep-observer.js";
export { PostgresLocalHelperSweepRecoveryRepository } from "./postgres-local-helper-sweep-recovery.js";
export type {
  LocalHelperSweepBatchResult,
  LocalHelperSweepObservation,
  LocalHelperSweepObservationDecision,
  LocalHelperSweepObserver,
  LocalHelperSweepProviderObservation,
  LocalHelperSweepReceiptObservation,
  LocalHelperSweepReplacementAuthorization,
  LocalHelperSweepRescanner,
  LocalHelperSweepRescanWork,
  LocalHelperSweepSignerGateway,
  LocalHelperSweepSignerResult,
  LocalHelperSweepTransactionReference,
  LocalHelperSweepWorkClaim,
  LocalHelperSweepWorkOperation,
  LocalHelperSweepWorkRepository,
} from "./local-helper-sweep-worker.js";
export { LoopbackLocalPositionSignerGateway } from "./loopback-local-position-signer-gateway.js";
export { ViemLocalPositionObserver } from "./viem-local-position-observer.js";
export type { ViemLocalPositionObserverOptions } from "./viem-local-position-observer.js";
export { PostgresLocalPositionRecoveryRepository } from "./postgres-local-position-recovery.js";
export type {
  LocalPositionBatchResult,
  LocalPositionObservation,
  LocalPositionObservationDecision,
  LocalPositionObserver,
  LocalPositionProviderObservation,
  LocalPositionReceiptObservation,
  LocalPositionReplacementAuthorization,
  LocalPositionStepSignerGateway,
  LocalPositionStepSignerResult,
  LocalPositionStepWorkOperation,
  LocalPositionTransactionReference,
  LocalPositionWorkClaim,
  LocalPositionWorkRepository,
} from "./local-position-worker.js";
export { PostgresHelperDeploymentRecoveryRepository } from "./postgres-helper-deployment-recovery.js";
export { ViemLocalHelperDeploymentObserver } from "./viem-local-helper-deployment-observer.js";
export type { ViemLocalHelperDeploymentObserverOptions } from "./viem-local-helper-deployment-observer.js";
export { LoopbackHelperDeploymentSignerGateway } from "./loopback-helper-deployment-signer-gateway.js";
export type {
  HelperDeploymentBatchResult,
  HelperDeploymentObservation,
  HelperDeploymentObservationDecision,
  HelperDeploymentObserver,
  HelperDeploymentProviderObservation,
  HelperDeploymentReceiptObservation,
  HelperDeploymentReplacementAuthorization,
  HelperDeploymentSignerGateway,
  HelperDeploymentSignerResult,
  HelperDeploymentTransactionHead,
  HelperDeploymentTransactionReference,
  HelperDeploymentWorkClaim,
  HelperDeploymentWorkOperation,
  HelperDeploymentWorkRepository,
} from "./helper-deployment-worker.js";
export type { ViemLocalWalletTransferObserverOptions } from "./viem-local-wallet-transfer-observer.js";
export type {
  WalletTransferBatchResult,
  WalletTransferObservation,
  WalletTransferObservationDecision,
  WalletTransferObserver,
  WalletTransferProviderObservation,
  WalletTransferReceiptObservation,
  WalletTransferReplacementAuthorization,
  WalletTransferSignerGateway,
  WalletTransferSignerResult,
  WalletTransferTransactionHead,
  WalletTransferTransactionReference,
  WalletTransferWorkClaim,
  WalletTransferWorkOperation,
  WalletTransferWorkRepository,
} from "./wallet-transfer-worker.js";

export const workerApp = {
  domain: domainPackage.name,
  name: "@lpbot/worker",
  observability: observabilityPackage.name,
  registry: chainRegistryPackage.name,
} as const;
