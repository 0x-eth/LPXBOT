import { randomUUID } from "node:crypto";

import {
  notificationCategories,
  type DestinationDraft,
  type NotificationCategory,
  type NotificationDestination,
  type NotificationDestinationPatch,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import {
  defaultNotificationPreferences,
  notificationDestinationPayloadHash,
  parseDestinationDraft,
  parseNotificationDestinationPatch,
  type NotificationConfigurationStore,
  type NotificationDestinationCreateResult,
  type NotificationDestinationDeleteResult,
  type NotificationDestinationMutationResult,
  type NotificationPreferenceMutationResult,
  type NotificationSecretStore,
} from "./notifications.js";

interface Queryable {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface PreferenceRow extends QueryResultRow {
  categories: unknown;
  revision: string;
  updated_at: Date;
}

interface DestinationRow extends QueryResultRow {
  categories: string[];
  config: unknown;
  created_at: Date;
  destination_id: string;
  enabled: boolean;
  name: string;
  revision: string;
  secret_ref: string | null;
  type: "telegram" | "webhook";
  updated_at: Date;
  user_id: string;
}

interface IdempotencyRow extends QueryResultRow {
  destination_id: string;
  payload_hash: string;
}

export interface PostgresNotificationConfigurationStoreOptions {
  capacity?: number;
  idFactory?: () => string;
  secrets?: NotificationSecretStore;
}

const destinationColumns = `
  destination.destination_id::text,
  destination.user_id::text,
  version.revision::text,
  version.type,
  version.name,
  version.enabled,
  version.categories,
  version.config,
  version.secret_ref,
  destination.created_at,
  destination.updated_at`;

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`Stored ${field} is invalid`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function categoriesFrom(value: unknown): Record<NotificationCategory, boolean> {
  if (!isRecord(value)) throw new RangeError("Stored notification preferences are invalid");
  const categories = {} as Record<NotificationCategory, boolean>;
  for (const category of notificationCategories) {
    if (typeof value[category] !== "boolean") {
      throw new RangeError("Stored notification preferences are invalid");
    }
    categories[category] = value[category];
  }
  return categories;
}

function preferenceFromRow(row: PreferenceRow): NotificationPreferences {
  return {
    categories: categoriesFrom(row.categories),
    revision: safeInteger(row.revision, "notification preference revision"),
    updatedAt: row.updated_at.toISOString(),
  };
}

function destinationFromRow(row: DestinationRow): NotificationDestination {
  if (!isRecord(row.config)) throw new RangeError("Stored destination config is invalid");
  const base = {
    categories: row.categories as NotificationCategory[],
    createdAt: row.created_at.toISOString(),
    destinationId: row.destination_id,
    enabled: row.enabled,
    name: row.name,
    revision: safeInteger(row.revision, "destination revision"),
    updatedAt: row.updated_at.toISOString(),
    userId: row.user_id,
  };
  if (row.type === "telegram") {
    if (
      typeof row.config.telegramIdentityId !== "string" ||
      typeof row.config.template !== "string"
    ) {
      throw new RangeError("Stored Telegram destination config is invalid");
    }
    return {
      ...base,
      config: {
        secretConfigured: row.secret_ref !== null,
        secretRef: row.secret_ref,
        telegramIdentityId: row.config.telegramIdentityId,
        template: row.config.template,
      },
      type: "telegram",
    };
  }
  if (
    (row.config.method !== "GET" && row.config.method !== "POST") ||
    typeof row.config.url !== "string" ||
    !Object.hasOwn(row.config, "template")
  ) {
    throw new RangeError("Stored Webhook destination config is invalid");
  }
  return {
    ...base,
    config: {
      method: row.config.method,
      secretConfigured: row.secret_ref !== null,
      secretRef: row.secret_ref,
      template: structuredClone(row.config.template),
      url: row.config.url,
    },
    type: "webhook",
  };
}

function credentialFreeConfig(draft: DestinationDraft): Record<string, unknown> {
  return draft.type === "telegram"
    ? {
        telegramIdentityId: draft.config.telegramIdentityId,
        template: draft.config.template,
      }
    : {
        method: draft.config.method,
        template: structuredClone(draft.config.template),
        url: draft.config.url,
      };
}

function secretValue(draft: DestinationDraft): string | undefined {
  return draft.type === "telegram" ? draft.config.botToken : draft.config.signingSecret;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableValue(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class PostgresNotificationConfigurationStore implements NotificationConfigurationStore {
  readonly #capacity: number;
  readonly #idFactory: () => string;
  readonly #pool: Pool;
  readonly #secrets: NotificationSecretStore | null;

  constructor(pool: Pool, options: PostgresNotificationConfigurationStoreOptions = {}) {
    this.#pool = pool;
    this.#capacity = options.capacity ?? 20;
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#secrets = options.secrets ?? null;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity < 1 || this.#capacity > 1_000) {
      throw new RangeError("Notification destination capacity is invalid");
    }
  }

  async getPreferences(userId: string): Promise<NotificationPreferences> {
    const result = await this.#pool.query<PreferenceRow>(
      `SELECT revision::text, categories, updated_at
         FROM notification_preferences
        WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ? preferenceFromRow(result.rows[0]) : defaultNotificationPreferences();
  }

  async updatePreferences(input: {
    patch: NotificationPreferencesPatch;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationPreferenceMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `notification-preferences:${input.userId}`,
      ]);
      const row = await client.query<PreferenceRow>(
        `SELECT revision::text, categories, updated_at
           FROM notification_preferences
          WHERE user_id = $1
          FOR UPDATE`,
        [input.userId],
      );
      const current = row.rows[0]
        ? preferenceFromRow(row.rows[0])
        : defaultNotificationPreferences();
      if (current.revision !== input.patch.expectedRevision) {
        return await this.#finish(client, { current, status: "conflict" });
      }
      const categories = { ...current.categories, ...input.patch.categories };
      if (stableValue(categories) === stableValue(current.categories)) {
        return await this.#finish(client, { status: "unchanged", value: current });
      }
      const nextRevision = current.revision + 1;
      const updated = await client.query<PreferenceRow>(
        `INSERT INTO notification_preferences (user_id, revision, categories, updated_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (user_id) DO UPDATE
           SET revision = EXCLUDED.revision,
               categories = EXCLUDED.categories,
               updated_at = EXCLUDED.updated_at
         RETURNING revision::text, categories, updated_at`,
        [input.userId, nextRevision, JSON.stringify(categories), input.updatedAt],
      );
      return await this.#finish(client, {
        status: "updated",
        value: preferenceFromRow(updated.rows[0]!),
      });
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async ownsTelegramIdentity(userId: string, telegramIdentityId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1
         FROM telegram_identities
        WHERE user_id = $1 AND telegram_user_id = $2::bigint`,
      [userId, telegramIdentityId],
    );
    return result.rowCount === 1;
  }

  async getTelegramIdentity(userId: string): Promise<string | null> {
    const result = await this.#pool.query<{ telegram_identity_id: string }>(
      `SELECT telegram_user_id::text AS telegram_identity_id
         FROM telegram_identities
        WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0]?.telegram_identity_id ?? null;
  }

  async listDestinations(userId: string): Promise<NotificationDestination[]> {
    const result = await this.#pool.query<DestinationRow>(
      `SELECT ${destinationColumns}
         FROM notification_destinations AS destination
         JOIN notification_destination_versions AS version
           ON version.destination_id = destination.destination_id
          AND version.user_id = destination.user_id
          AND version.revision = destination.current_revision
        WHERE destination.user_id = $1
          AND destination.deleted_at IS NULL
          AND NOT version.tombstone
        ORDER BY destination.created_at DESC, destination.destination_id DESC`,
      [userId],
    );
    return result.rows.map(destinationFromRow);
  }

  async createDestination(input: {
    createdAt: Date;
    draft: DestinationDraft;
    idempotencyKey: string;
    userId: string;
  }): Promise<NotificationDestinationCreateResult> {
    if (!this.#secrets) return { status: "service-unavailable" };
    let draft: DestinationDraft;
    try {
      draft = parseDestinationDraft(input.draft);
    } catch {
      return { status: "invalid" };
    }
    const client = await this.#pool.connect();
    let newSecretRef: string | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `notification-destinations:${input.userId}`,
      ]);
      const payloadHash = notificationDestinationPayloadHash(draft);
      const prior = await client.query<IdempotencyRow>(
        `SELECT payload_hash, destination_id::text
           FROM notification_destination_create_idempotency
          WHERE user_id = $1 AND idempotency_key = $2`,
        [input.userId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].payload_hash !== payloadHash) {
          return await this.#finish(client, { status: "idempotency-conflict" });
        }
        const existing = await this.#getCurrent(
          client,
          input.userId,
          prior.rows[0].destination_id,
          false,
        );
        if (!existing) throw new Error("Destination idempotency record is inconsistent");
        return await this.#finish(client, { status: "replayed", value: existing });
      }
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM notification_destinations
          WHERE user_id = $1 AND deleted_at IS NULL`,
        [input.userId],
      );
      if (safeInteger(count.rows[0]?.count ?? "0", "destination count") >= this.#capacity) {
        return await this.#finish(client, { status: "capacity" });
      }
      if (
        draft.type === "telegram" &&
        !(await this.#ownsTelegramIdentity(client, input.userId, draft.config.telegramIdentityId))
      ) {
        return await this.#finish(client, { status: "invalid" });
      }
      const secret = secretValue(draft);
      if (secret !== undefined) {
        newSecretRef = (
          await this.#secrets.put({
            kind: draft.type === "telegram" ? "telegram-bot-token" : "webhook-hmac",
            secret,
            userId: input.userId,
          })
        ).secretRef;
      }
      const destinationId = this.#idFactory();
      await client.query(
        `INSERT INTO notification_destinations (
           destination_id, user_id, current_revision, created_at, updated_at, deleted_at
         ) VALUES ($1, $2, 1, $3, $3, NULL)`,
        [destinationId, input.userId, input.createdAt],
      );
      await this.#insertVersion(client, {
        createdAt: input.createdAt,
        destinationId,
        draft,
        revision: 1,
        secretRef: newSecretRef,
        tombstone: false,
        userId: input.userId,
      });
      await client.query(
        `INSERT INTO notification_destination_create_idempotency (
           user_id, idempotency_key, payload_hash, destination_id, created_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.idempotencyKey, payloadHash, destinationId, input.createdAt],
      );
      await client.query("COMMIT");
      const created = await this.#getCurrent(this.#pool, input.userId, destinationId, false);
      if (!created) throw new Error("Created destination was not found");
      return { status: "created", value: created };
    } catch {
      await this.#rollback(client);
      if (newSecretRef) await this.#deleteCompensatingSecret(newSecretRef);
      return { status: "service-unavailable" };
    } finally {
      client.release();
    }
  }

  async patchDestination(input: {
    destinationId: string;
    patch: NotificationDestinationPatch;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationDestinationMutationResult> {
    if (!this.#secrets) return { status: "service-unavailable" };
    let patch: NotificationDestinationPatch;
    try {
      patch = parseNotificationDestinationPatch(input.patch);
    } catch {
      return { status: "invalid" };
    }
    const client = await this.#pool.connect();
    let newSecretRef: string | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `notification-destination:${input.destinationId}`,
      ]);
      const current = await this.#getCurrent(client, input.userId, input.destinationId, true);
      if (!current) return await this.#finish(client, { status: "not-found" });
      if (current.revision !== patch.expectedRevision) {
        return await this.#finish(client, { current, status: "conflict" });
      }
      const changes = patch.changes;
      const configChanges = changes.config ?? {};
      let merged: unknown;
      let incomingSecret: string | undefined;
      if (current.type === "telegram") {
        if (["method", "signingSecret", "url"].some((key) => Object.hasOwn(configChanges, key))) {
          return await this.#finish(client, { status: "invalid" });
        }
        incomingSecret = configChanges.botToken;
        merged = {
          categories: changes.categories ?? current.categories,
          config: {
            ...(incomingSecret === undefined ? {} : { botToken: incomingSecret }),
            telegramIdentityId:
              configChanges.telegramIdentityId ?? current.config.telegramIdentityId,
            template: configChanges.template ?? current.config.template,
          },
          enabled: changes.enabled ?? current.enabled,
          name: changes.name ?? current.name,
          type: "telegram",
        };
      } else {
        if (["botToken", "telegramIdentityId"].some((key) => Object.hasOwn(configChanges, key))) {
          return await this.#finish(client, { status: "invalid" });
        }
        incomingSecret = configChanges.signingSecret;
        merged = {
          categories: changes.categories ?? current.categories,
          config: {
            method: configChanges.method ?? current.config.method,
            ...(incomingSecret === undefined ? {} : { signingSecret: incomingSecret }),
            template: configChanges.template ?? current.config.template,
            url: configChanges.url ?? current.config.url,
          },
          enabled: changes.enabled ?? current.enabled,
          name: changes.name ?? current.name,
          type: "webhook",
        };
      }
      let draft: DestinationDraft;
      try {
        draft = parseDestinationDraft(merged, { telegramSecretRequired: false });
      } catch {
        return await this.#finish(client, { status: "invalid" });
      }
      if (
        draft.type === "telegram" &&
        !(await this.#ownsTelegramIdentity(client, input.userId, draft.config.telegramIdentityId))
      ) {
        return await this.#finish(client, { status: "invalid" });
      }
      const comparableCurrent = {
        categories: current.categories,
        config:
          current.type === "telegram"
            ? {
                telegramIdentityId: current.config.telegramIdentityId,
                template: current.config.template,
              }
            : {
                method: current.config.method,
                template: current.config.template,
                url: current.config.url,
              },
        enabled: current.enabled,
        name: current.name,
        type: current.type,
      };
      const comparableDraft = {
        categories: draft.categories,
        config: credentialFreeConfig(draft),
        enabled: draft.enabled,
        name: draft.name,
        type: draft.type,
      };
      if (
        incomingSecret === undefined &&
        stableValue(comparableCurrent) === stableValue(comparableDraft)
      ) {
        return await this.#finish(client, { status: "unchanged", value: current });
      }
      let nextSecretRef = current.config.secretRef;
      if (incomingSecret !== undefined) {
        newSecretRef = (
          await this.#secrets.put({
            kind: draft.type === "telegram" ? "telegram-bot-token" : "webhook-hmac",
            secret: incomingSecret,
            userId: input.userId,
          })
        ).secretRef;
        nextSecretRef = newSecretRef;
      }
      const nextRevision = current.revision + 1;
      await this.#insertVersion(client, {
        createdAt: input.updatedAt,
        destinationId: input.destinationId,
        draft,
        revision: nextRevision,
        secretRef: nextSecretRef,
        tombstone: false,
        userId: input.userId,
      });
      await client.query(
        `UPDATE notification_destinations
            SET current_revision = $3, updated_at = $4
          WHERE destination_id = $1 AND user_id = $2`,
        [input.destinationId, input.userId, nextRevision, input.updatedAt],
      );
      await client.query("COMMIT");
      const updated = await this.#getCurrent(this.#pool, input.userId, input.destinationId, false);
      if (!updated) throw new Error("Updated destination was not found");
      return { status: "updated", value: updated };
    } catch {
      await this.#rollback(client);
      if (newSecretRef) await this.#deleteCompensatingSecret(newSecretRef);
      return { status: "service-unavailable" };
    } finally {
      client.release();
    }
  }

  async deleteDestination(input: {
    destinationId: string;
    expectedRevision: number;
    updatedAt: Date;
    userId: string;
  }): Promise<NotificationDestinationDeleteResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `notification-destination:${input.destinationId}`,
      ]);
      const current = await this.#getCurrent(client, input.userId, input.destinationId, true);
      if (!current) return await this.#finish(client, { status: "not-found" });
      if (current.revision !== input.expectedRevision) {
        return await this.#finish(client, { current, status: "conflict" });
      }
      const nextRevision = current.revision + 1;
      await client.query(
        `INSERT INTO notification_destination_versions (
           destination_id, user_id, revision, type, name, enabled, categories,
           config, secret_ref, tombstone, created_at
         ) VALUES ($1, $2, $3, $4, $5, false, $6::text[], '{}'::jsonb, NULL, true, $7)`,
        [
          input.destinationId,
          input.userId,
          nextRevision,
          current.type,
          current.name,
          current.categories,
          input.updatedAt,
        ],
      );
      await client.query(
        `UPDATE notification_destinations
            SET current_revision = $3,
                updated_at = $4,
                deleted_at = $4
          WHERE destination_id = $1 AND user_id = $2`,
        [input.destinationId, input.userId, nextRevision, input.updatedAt],
      );
      await client.query(
        `DELETE FROM monitor_notification_destination_bindings
          WHERE destination_id = $1 AND user_id = $2`,
        [input.destinationId, input.userId],
      );
      return await this.#finish(client, { status: "deleted" });
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #getCurrent(
    queryable: Queryable,
    userId: string,
    destinationId: string,
    lock: boolean,
  ): Promise<NotificationDestination | null> {
    const result = await queryable.query<DestinationRow>(
      `SELECT ${destinationColumns}
         FROM notification_destinations AS destination
         JOIN notification_destination_versions AS version
           ON version.destination_id = destination.destination_id
          AND version.user_id = destination.user_id
          AND version.revision = destination.current_revision
        WHERE destination.user_id = $1
          AND destination.destination_id = $2
          AND destination.deleted_at IS NULL
          AND NOT version.tombstone
        ${lock ? "FOR UPDATE OF destination" : ""}`,
      [userId, destinationId],
    );
    return result.rows[0] ? destinationFromRow(result.rows[0]) : null;
  }

  async #ownsTelegramIdentity(
    queryable: Queryable,
    userId: string,
    telegramIdentityId: string,
  ): Promise<boolean> {
    const result = await queryable.query(
      `SELECT 1
         FROM telegram_identities
        WHERE user_id = $1 AND telegram_user_id = $2::bigint`,
      [userId, telegramIdentityId],
    );
    return result.rowCount === 1;
  }

  async #insertVersion(
    client: PoolClient,
    input: {
      createdAt: Date;
      destinationId: string;
      draft: DestinationDraft;
      revision: number;
      secretRef: string | null;
      tombstone: false;
      userId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO notification_destination_versions (
         destination_id, user_id, revision, type, name, enabled, categories,
         config, secret_ref, tombstone, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::jsonb, $9, $10, $11)`,
      [
        input.destinationId,
        input.userId,
        input.revision,
        input.draft.type,
        input.draft.name,
        input.draft.enabled,
        input.draft.categories,
        JSON.stringify(credentialFreeConfig(input.draft)),
        input.secretRef,
        input.tombstone,
        input.createdAt,
      ],
    );
  }

  async #deleteCompensatingSecret(secretRef: string): Promise<void> {
    try {
      await this.#secrets?.delete(secretRef);
    } catch {
      // The database remains fail-closed; the secret backend owns orphan cleanup.
    }
  }

  async #finish<T>(client: PoolClient, value: T): Promise<T> {
    await client.query("COMMIT");
    return value;
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the transaction failure.
    }
  }
}
