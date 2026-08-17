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
export { PostgresMonitorEvaluationSource } from "./postgres-monitor-source.js";
export type {
  CandidateEvidenceAction,
  CommitMonitorCandidateInput,
  CommitMonitorCandidateResult,
  MonitorOutboxDestination,
  NotificationOutboxDelivery,
} from "./postgres-monitor-outbox.js";

export const workerApp = {
  domain: domainPackage.name,
  name: "@lpbot/worker",
  observability: observabilityPackage.name,
  registry: chainRegistryPackage.name,
} as const;
