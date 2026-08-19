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
