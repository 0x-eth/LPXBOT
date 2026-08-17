import type { NotificationCategory } from "@lpbot/api-contract";
import type { MonitorCandidate, MonitorEvaluationDefinition } from "@lpbot/domain/monitor-evaluator";
import type { Pool, QueryResultRow } from "pg";

import type {
  MonitorDestinationSelection,
  MonitorDestinationSelector,
} from "./monitoring.js";

interface DestinationSelectionRow extends QueryResultRow {
  destination_id: string;
  destination_revision: string;
  type: "telegram" | "webhook";
}

function safeRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new RangeError("Stored destination revision is invalid");
  }
  return revision;
}

function conditionSummary(candidate: MonitorCandidate): string {
  return candidate.matchedConditions
    .map(({ id, operator, value }) => `${id} ${operator} ${value}`)
    .join(" AND ");
}

export class PostgresMonitorDestinationSelector implements MonitorDestinationSelector {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async select(input: {
    candidate: MonitorCandidate;
    category: NotificationCategory;
    monitor: MonitorEvaluationDefinition;
  }): Promise<MonitorDestinationSelection[]> {
    if (
      input.candidate.monitorId !== input.monitor.monitorId ||
      input.candidate.userId !== input.monitor.userId ||
      input.candidate.monitorRevision !== input.monitor.revision ||
      input.candidate.poolKey !== input.monitor.poolKey
    ) {
      throw new RangeError("MONITOR_DESTINATION_SELECTION_IDENTITY_INVALID");
    }
    const result = await this.#pool.query<DestinationSelectionRow>(
      `SELECT destination.destination_id::text,
              destination.current_revision::text AS destination_revision,
              version.type
         FROM notification_preferences AS preference
         JOIN monitor_notification_destination_bindings AS binding
           ON binding.user_id = preference.user_id
          AND binding.monitor_id = $2
          AND binding.monitor_revision = $3
         JOIN notification_destinations AS destination
           ON destination.destination_id = binding.destination_id
          AND destination.user_id = binding.user_id
         JOIN notification_destination_versions AS version
           ON version.destination_id = destination.destination_id
          AND version.user_id = destination.user_id
          AND version.revision = destination.current_revision
        WHERE preference.user_id = $1
          AND COALESCE((preference.categories ->> $4)::boolean, false)
          AND destination.deleted_at IS NULL
          AND NOT version.tombstone
          AND version.enabled
          AND $4 = ANY(version.categories)
        ORDER BY destination.destination_id`,
      [input.monitor.userId, input.monitor.monitorId, input.monitor.revision, input.category],
    );
    return result.rows.map((row) => ({
      channel: row.type,
      destinationId: row.destination_id,
      destinationRevision: safeRevision(row.destination_revision),
      payload: {
        category: input.category,
        conditionSummary: conditionSummary(input.candidate),
        metricVersion: input.candidate.metricVersion,
        monitorId: input.monitor.monitorId,
        monitorName: input.monitor.name,
        monitorRevision: input.monitor.revision,
        poolKey: input.candidate.poolKey,
        windowEnd: input.candidate.windowEnd,
      },
    }));
  }
}
