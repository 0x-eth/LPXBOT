import type { Pool, QueryResultRow } from "pg";

import type {
  DispatchDestination,
  DispatchDestinationResult,
  DispatchDestinationStore,
  DispatchOutboxDelivery,
} from "./dispatcher.js";
import type { TelegramIdentityOwnershipStore } from "./telegram-adapter.js";

interface CurrentDestinationRow extends QueryResultRow {
  deleted_at: Date | null;
  enabled: boolean;
  tombstone: boolean;
}

interface DestinationVersionRow extends QueryResultRow {
  config: unknown;
  enabled: boolean;
  name: string;
  secret_ref: string | null;
  tombstone: boolean;
  type: "telegram" | "webhook";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function destinationFromRow(
  delivery: DispatchOutboxDelivery,
  row: DestinationVersionRow,
): DispatchDestination | null {
  if (row.tombstone || !row.enabled || row.type !== delivery.channel || !isRecord(row.config)) {
    return null;
  }
  const base = {
    destinationId: delivery.destinationId,
    name: row.name,
    revision: delivery.destinationRevision,
    userId: delivery.userId,
  };
  if (row.type === "webhook") {
    if (
      (row.config.method !== "GET" && row.config.method !== "POST") ||
      typeof row.config.url !== "string" ||
      !row.config.url.startsWith("https://") ||
      !Object.hasOwn(row.config, "template")
    ) {
      return null;
    }
    return {
      ...base,
      config: {
        method: row.config.method,
        secretRef: row.secret_ref,
        template: structuredClone(row.config.template),
        url: row.config.url,
      },
      type: "webhook",
    };
  }
  if (
    typeof row.config.telegramIdentityId !== "string" ||
    !/^[1-9][0-9]{0,18}$/u.test(row.config.telegramIdentityId) ||
    typeof row.config.template !== "string"
  ) {
    return null;
  }
  return {
    ...base,
    config: {
      secretRef: row.secret_ref,
      telegramIdentityId: row.config.telegramIdentityId,
      template: row.config.template,
    },
    type: "telegram",
  };
}

export class PostgresDispatchDestinationStore
  implements DispatchDestinationStore, TelegramIdentityOwnershipStore
{
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async resolve(delivery: DispatchOutboxDelivery): Promise<DispatchDestinationResult> {
    const current = await this.#pool.query<CurrentDestinationRow>(
      `SELECT destination.deleted_at, version.enabled, version.tombstone
         FROM notification_destinations AS destination
         JOIN notification_destination_versions AS version
           ON version.destination_id = destination.destination_id
          AND version.user_id = destination.user_id
          AND version.revision = destination.current_revision
        WHERE destination.destination_id::text = $1
          AND destination.user_id = $2`,
      [delivery.destinationId, delivery.userId],
    );
    const currentRow = current.rows[0];
    if (!currentRow || currentRow.deleted_at !== null || currentRow.tombstone) {
      return { status: "not-found" };
    }
    if (!currentRow.enabled) return { status: "disabled" };

    const version = await this.#pool.query<DestinationVersionRow>(
      `SELECT type, name, enabled, config, secret_ref, tombstone
         FROM notification_destination_versions
        WHERE destination_id::text = $1
          AND user_id = $2
          AND revision = $3`,
      [delivery.destinationId, delivery.userId, delivery.destinationRevision],
    );
    const row = version.rows[0];
    if (!row) return { status: "revision-not-found" };
    if (!row.enabled) return { status: "disabled" };
    const destination = destinationFromRow(delivery, row);
    return destination ? { destination, status: "ready" } : { status: "revision-not-found" };
  }

  async owns(userId: string, telegramIdentityId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1
         FROM telegram_identities
        WHERE user_id = $1 AND telegram_user_id = $2::bigint`,
      [userId, telegramIdentityId],
    );
    return result.rowCount === 1;
  }
}
