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
