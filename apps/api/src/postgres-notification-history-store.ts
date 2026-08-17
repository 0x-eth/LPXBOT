import type {
  NotificationDeliveryStatus,
  NotificationHistoryDestinationSnapshot,
  NotificationHistoryItem,
  NotificationHistoryPage,
} from "@lpbot/api-contract";
import type { Pool, QueryResultRow } from "pg";

import {
  encodeNotificationHistoryCursor,
  type NotificationHistoryQuery,
  type NotificationHistoryStore,
} from "./notification-history.js";

interface HistoryRow extends QueryResultRow {
  attempt_count: number;
  condition_summary: string;
  created_at: Date;
  delivered_at: Date | null;
  delivery_id: string;
  destination_id: string;
  destination_name: string;
  destination_type: NotificationHistoryDestinationSnapshot["type"];
  error_code: string | null;
  monitor_id: string;
  monitor_name: string;
  next_retry_at: Date | null;
  pool_key: NotificationHistoryItem["poolKey"];
  status: NotificationDeliveryStatus;
  updated_at: Date;
  window_end: Date;
  window_minutes: NotificationHistoryItem["windowMinutes"];
}

function fromRow(row: HistoryRow): NotificationHistoryItem {
  return {
    attemptCount: row.attempt_count,
    conditionSummary: row.condition_summary,
    createdAt: row.created_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    deliveryId: row.delivery_id,
    destination: {
      destinationId: row.destination_id,
      name: row.destination_name,
      type: row.destination_type,
    },
    errorCode: row.error_code,
    monitorId: row.monitor_id,
    monitorName: row.monitor_name,
    nextRetryAt: row.next_retry_at?.toISOString() ?? null,
    poolKey: row.pool_key,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    windowEnd: row.window_end.toISOString(),
    windowMinutes: row.window_minutes,
  };
}

export class PostgresNotificationHistoryStore implements NotificationHistoryStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async list(userId: string, query: NotificationHistoryQuery): Promise<NotificationHistoryPage> {
    const values: unknown[] = [userId];
    const filters = ["user_id = $1"];
    const parameter = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (query.monitorId !== null) filters.push(`monitor_id = ${parameter(query.monitorId)}`);
    if (query.deliveryStatus !== null) filters.push(`status = ${parameter(query.deliveryStatus)}`);
    if (query.from !== null) filters.push(`created_at >= ${parameter(query.from)}::timestamptz`);
    if (query.to !== null) filters.push(`created_at <= ${parameter(query.to)}::timestamptz`);
    if (query.cursor !== null) {
      const created = parameter(query.cursor.createdAt);
      const delivery = parameter(query.cursor.deliveryId);
      filters.push(`(created_at, delivery_id) < (${created}::timestamptz, ${delivery}::uuid)`);
    }
    values.push(query.limit + 1);
    const result = await this.#pool.query<HistoryRow>(
      `SELECT
         delivery_id::text, monitor_id::text, monitor_name, pool_key,
         condition_summary, window_minutes, window_end, destination_id,
         destination_name, destination_type, status, attempt_count,
         next_retry_at, delivered_at, error_code, created_at, updated_at
       FROM notification_delivery_history
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC, delivery_id DESC
       LIMIT $${values.length}`,
      values,
    );
    const page = result.rows.slice(0, query.limit).map(fromRow);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        result.rows.length > query.limit && last
          ? encodeNotificationHistoryCursor({
              createdAt: last.createdAt,
              deliveryId: last.deliveryId,
            })
          : null,
    };
  }
}
