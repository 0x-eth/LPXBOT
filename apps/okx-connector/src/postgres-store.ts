import type { Pool, PoolClient } from "pg";

import { OkxConnectorError } from "./errors.js";
import type {
  OkxCredentialAuditEvent,
  OkxCredentialEnvelope,
  OkxCredentialHead,
  OkxCredentialMutationContext,
  OkxCredentialRepository,
} from "./types.js";

interface HeadRow {
  active_version: string;
  capability_epoch: string;
  configured: boolean;
  credential_id: string;
  rotation_due_at: Date | null;
  status: OkxCredentialHead["status"];
  updated_at: Date;
  user_id: string;
}

interface EnvelopeRow extends HeadRow {
  aad_version: number;
  algorithm: "AES-256-GCM";
  authentication_tag: Buffer;
  ciphertext: Buffer;
  created_at: Date;
  environment: string;
  kek_id: string;
  kek_version: string;
  nonce: Buffer;
  version: string;
  wrapped_dek: Buffer;
}

export type OkxPostgresFailurePoint = "before-activate" | "before-complete-delete";

function headFromRow(row: HeadRow): OkxCredentialHead {
  return {
    capabilityEpoch: Number(row.capability_epoch),
    configured: row.configured,
    credentialId: row.credential_id,
    rotationDueAt: row.rotation_due_at,
    status: row.status,
    updatedAt: row.updated_at,
    userId: row.user_id,
    version: Number(row.active_version),
  };
}

function envelopeFromRow(row: EnvelopeRow): OkxCredentialEnvelope {
  return {
    aadVersion: row.aad_version as 1,
    algorithm: row.algorithm,
    ciphertext: row.ciphertext,
    createdAt: row.created_at,
    credentialId: row.credential_id,
    environment: row.environment,
    kekId: row.kek_id,
    kekVersion: row.kek_version,
    nonce: row.nonce,
    tag: row.authentication_tag,
    userId: row.user_id,
    version: Number(row.version),
    wrappedDek: row.wrapped_dek,
  };
}

function unconfigured(userId: string, now: Date): OkxCredentialHead {
  return {
    capabilityEpoch: 0,
    configured: false,
    credentialId: "00000000-0000-0000-0000-000000000000",
    rotationDueAt: null,
    status: "unconfigured",
    updatedAt: now,
    userId,
    version: 0,
  };
}

export class PostgresOkxCredentialRepository implements OkxCredentialRepository {
  readonly #failAt: OkxPostgresFailurePoint | null;
  readonly #pool: Pool;

  constructor(pool: Pool, options?: { failAt?: OkxPostgresFailurePoint }) {
    this.#pool = pool;
    this.#failAt = options?.failAt ?? null;
  }

  async #transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (error instanceof OkxConnectorError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505"
      ) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
    } finally {
      client.release();
    }
  }

  async getHead(userId: string): Promise<OkxCredentialHead | null> {
    try {
      const result = await this.#pool.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads
          WHERE user_id = $1`,
        [userId],
      );
      return result.rows[0] ? headFromRow(result.rows[0]) : null;
    } catch {
      throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
    }
  }

  async getActiveEnvelope(
    userId: string,
    expectedVersion: number,
  ): Promise<OkxCredentialEnvelope | null> {
    try {
      const result = await this.#pool.query<EnvelopeRow>(
        `SELECT h.user_id, h.credential_id, h.active_version, h.configured, h.status,
                h.capability_epoch, h.rotation_due_at, h.updated_at,
                v.version, v.algorithm, v.ciphertext, v.nonce,
                v.authentication_tag, v.wrapped_dek, v.aad_version,
                v.environment, v.kek_id, v.kek_version, v.created_at
           FROM okx_credential_heads h
           JOIN okx_credential_versions v
             ON v.user_id = h.user_id AND v.version = h.active_version
          WHERE h.user_id = $1 AND h.configured AND h.active_version = $2
            AND v.active AND v.destroyed_at IS NULL AND v.wrapped_dek IS NOT NULL`,
        [userId, expectedVersion],
      );
      return result.rows[0] ? envelopeFromRow(result.rows[0]) : null;
    } catch {
      throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
    }
  }

  async createStaged(input: {
    context: OkxCredentialMutationContext;
    envelope: OkxCredentialEnvelope;
    expectedActiveVersion: number;
  }): Promise<OkxCredentialHead> {
    return this.#transaction(async (client) => {
      const selected = await client.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads WHERE user_id = $1 FOR UPDATE`,
        [input.context.userId],
      );
      let head = selected.rows[0];
      if (!head) {
        if (input.expectedActiveVersion !== 0 || input.envelope.version !== 1) {
          throw new OkxConnectorError("VERSION_CONFLICT");
        }
        const inserted = await client.query<HeadRow>(
          `INSERT INTO okx_credential_heads (
             user_id, credential_id, active_version, configured, status,
             capability_epoch, rotation_due_at, created_at, updated_at
           ) VALUES ($1, $2, 1, false, 'staged', 1, NULL, $3, $3)
           RETURNING user_id, credential_id, active_version, configured, status,
                     capability_epoch, rotation_due_at, updated_at`,
          [input.context.userId, input.envelope.credentialId, input.context.now],
        );
        head = inserted.rows[0]!;
      } else if (
        !head.configured &&
        head.status === "unconfigured" &&
        input.expectedActiveVersion === 0 &&
        input.envelope.version === 1
      ) {
        await client.query("DELETE FROM okx_credential_versions WHERE user_id = $1", [
          input.context.userId,
        ]);
        const reset = await client.query<HeadRow>(
          `UPDATE okx_credential_heads
              SET credential_id = $2, active_version = 1, status = 'staged',
                  capability_epoch = capability_epoch + 1, updated_at = $3
            WHERE user_id = $1
            RETURNING user_id, credential_id, active_version, configured, status,
                      capability_epoch, rotation_due_at, updated_at`,
          [input.context.userId, input.envelope.credentialId, input.context.now],
        );
        head = reset.rows[0]!;
      } else if (
        !head.configured ||
        head.status === "deleting" ||
        Number(head.active_version) !== input.expectedActiveVersion ||
        head.credential_id !== input.envelope.credentialId ||
        input.envelope.version !== input.expectedActiveVersion + 1
      ) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      await client.query(
        `INSERT INTO okx_credential_versions (
           user_id, credential_id, version, active, status, algorithm,
           ciphertext, nonce, authentication_tag, wrapped_dek, aad_version,
           environment, kek_id, kek_version, created_at, activated_at, destroyed_at
         ) VALUES ($1, $2, $3, false, 'staged', 'AES-256-GCM',
                   $4, $5, $6, $7, 1, $8, $9, $10, $11, NULL, NULL)`,
        [
          input.context.userId,
          input.envelope.credentialId,
          input.envelope.version,
          input.envelope.ciphertext,
          input.envelope.nonce,
          input.envelope.tag,
          input.envelope.wrappedDek,
          input.envelope.environment,
          input.envelope.kekId,
          input.envelope.kekVersion,
          input.envelope.createdAt,
        ],
      );
      return headFromRow(head);
    });
  }

  async destroyStaged(input: {
    context: OkxCredentialMutationContext;
    version: number;
  }): Promise<void> {
    await this.#transaction(async (client) => {
      const head = await client.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads WHERE user_id = $1 FOR UPDATE`,
        [input.context.userId],
      );
      await client.query(
        `UPDATE okx_credential_versions
            SET wrapped_dek = NULL, destroyed_at = $3, status = 'revoked'
          WHERE user_id = $1 AND version = $2 AND NOT active AND destroyed_at IS NULL`,
        [input.context.userId, input.version, input.context.now],
      );
      await client.query(
        `DELETE FROM okx_credential_versions
          WHERE user_id = $1 AND version = $2 AND NOT active`,
        [input.context.userId, input.version],
      );
      if (
        head.rows[0] &&
        !head.rows[0].configured &&
        Number(head.rows[0].active_version) === input.version
      ) {
        await client.query("DELETE FROM okx_credential_heads WHERE user_id = $1", [
          input.context.userId,
        ]);
      }
    });
  }

  async activateStaged(input: {
    context: OkxCredentialMutationContext;
    expectedActiveVersion: number;
    rotationDueAt: Date;
    version: number;
  }): Promise<OkxCredentialHead> {
    return this.#transaction(async (client) => {
      const selected = await client.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads WHERE user_id = $1 FOR UPDATE`,
        [input.context.userId],
      );
      const head = selected.rows[0];
      const activeVersion = head?.configured ? Number(head.active_version) : 0;
      if (
        !head ||
        activeVersion !== input.expectedActiveVersion ||
        head.status === "deleting" ||
        input.version !== input.expectedActiveVersion + 1
      ) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      const staged = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM okx_credential_versions
          WHERE user_id = $1 AND version = $2 AND status = 'staged'
            AND NOT active AND destroyed_at IS NULL AND wrapped_dek IS NOT NULL`,
        [input.context.userId, input.version],
      );
      if (staged.rows[0]?.count !== "1") throw new OkxConnectorError("VERSION_CONFLICT");
      if (this.#failAt === "before-activate") {
        throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
      }
      if (input.expectedActiveVersion > 0) {
        await client.query(
          `UPDATE okx_credential_versions
              SET active = false, status = 'revoked', wrapped_dek = NULL, destroyed_at = $3
            WHERE user_id = $1 AND version = $2 AND active`,
          [input.context.userId, input.expectedActiveVersion, input.context.now],
        );
      }
      await client.query(
        `UPDATE okx_credential_versions
            SET active = true, status = 'usable', activated_at = $3
          WHERE user_id = $1 AND version = $2`,
        [input.context.userId, input.version, input.context.now],
      );
      const updated = await client.query<HeadRow>(
        `UPDATE okx_credential_heads
            SET active_version = $2, configured = true, status = 'usable',
                capability_epoch = capability_epoch + 1,
                rotation_due_at = $3, updated_at = $4
          WHERE user_id = $1
          RETURNING user_id, credential_id, active_version, configured, status,
                    capability_epoch, rotation_due_at, updated_at`,
        [input.context.userId, input.version, input.rotationDueAt, input.context.now],
      );
      return headFromRow(updated.rows[0]!);
    });
  }

  async setStatus(input: {
    context: OkxCredentialMutationContext;
    expectedCapabilityEpoch?: number;
    expectedVersion: number;
    status: OkxCredentialHead["status"];
  }): Promise<OkxCredentialHead> {
    return this.#transaction(async (client) => {
      const selected = await client.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads WHERE user_id = $1 FOR UPDATE`,
        [input.context.userId],
      );
      const head = selected.rows[0];
      if (
        !head?.configured ||
        Number(head.active_version) !== input.expectedVersion ||
        head.status === "deleting" ||
        (input.expectedCapabilityEpoch !== undefined &&
          Number(head.capability_epoch) !== input.expectedCapabilityEpoch)
      ) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      const updated = await client.query<HeadRow>(
        `UPDATE okx_credential_heads
            SET status = $3,
                capability_epoch = capability_epoch + CASE WHEN $3 = 'testing' THEN 1 ELSE 0 END,
                updated_at = $4
          WHERE user_id = $1 AND active_version = $2
          RETURNING user_id, credential_id, active_version, configured, status,
                    capability_epoch, rotation_due_at, updated_at`,
        [input.context.userId, input.expectedVersion, input.status, input.context.now],
      );
      await client.query(
        `UPDATE okx_credential_versions SET status = $3
          WHERE user_id = $1 AND version = $2 AND active`,
        [input.context.userId, input.expectedVersion, input.status],
      );
      return headFromRow(updated.rows[0]!);
    });
  }

  async beginDelete(input: {
    context: OkxCredentialMutationContext;
    expectedVersion: number;
  }): Promise<OkxCredentialHead> {
    return this.#transaction(async (client) => {
      const selected = await client.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads WHERE user_id = $1 FOR UPDATE`,
        [input.context.userId],
      );
      const head = selected.rows[0];
      if (!head || !head.configured)
        return head ? headFromRow(head) : unconfigured(input.context.userId, input.context.now);
      if (Number(head.active_version) !== input.expectedVersion) {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      if (head.status === "deleting") return headFromRow(head);
      const updated = await client.query<HeadRow>(
        `UPDATE okx_credential_heads
            SET status = 'deleting', capability_epoch = capability_epoch + 1, updated_at = $2
          WHERE user_id = $1
          RETURNING user_id, credential_id, active_version, configured, status,
                    capability_epoch, rotation_due_at, updated_at`,
        [input.context.userId, input.context.now],
      );
      await client.query(
        `UPDATE okx_credential_versions SET status = 'deleting'
          WHERE user_id = $1 AND version = $2 AND active`,
        [input.context.userId, input.expectedVersion],
      );
      return headFromRow(updated.rows[0]!);
    });
  }

  async completeDelete(input: {
    context: OkxCredentialMutationContext;
    expectedVersion: number;
  }): Promise<OkxCredentialHead> {
    return this.#transaction(async (client) => {
      const selected = await client.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads WHERE user_id = $1 FOR UPDATE`,
        [input.context.userId],
      );
      const head = selected.rows[0];
      if (!head || !head.configured)
        return head ? headFromRow(head) : unconfigured(input.context.userId, input.context.now);
      if (Number(head.active_version) !== input.expectedVersion || head.status !== "deleting") {
        throw new OkxConnectorError("VERSION_CONFLICT");
      }
      if (this.#failAt === "before-complete-delete") {
        throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
      }
      await client.query(
        `UPDATE okx_credential_versions
            SET active = false, status = 'revoked', wrapped_dek = NULL, destroyed_at = $3
          WHERE user_id = $1 AND version = $2 AND active`,
        [input.context.userId, input.expectedVersion, input.context.now],
      );
      await client.query(
        `INSERT INTO okx_credential_tombstones (
           credential_id, user_id, final_version, final_status, deleted_at
         ) VALUES ($1, $2, $3, 'revoked', $4)
         ON CONFLICT (credential_id) DO NOTHING`,
        [head.credential_id, input.context.userId, input.expectedVersion, input.context.now],
      );
      const updated = await client.query<HeadRow>(
        `UPDATE okx_credential_heads
            SET configured = false, status = 'unconfigured', rotation_due_at = NULL, updated_at = $2
          WHERE user_id = $1
          RETURNING user_id, credential_id, active_version, configured, status,
                    capability_epoch, rotation_due_at, updated_at`,
        [input.context.userId, input.context.now],
      );
      return headFromRow(updated.rows[0]!);
    });
  }

  async appendAudit(event: OkxCredentialAuditEvent): Promise<void> {
    try {
      await this.#pool.query(
        `INSERT INTO okx_credential_audit_events (
           user_id, version, action, status, changed, request_id, actor, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          event.userId,
          event.version,
          event.action,
          event.status,
          event.changed,
          event.requestId,
          event.actor,
          event.createdAt,
        ],
      );
    } catch {
      throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
    }
  }

  async listRecoverable(now: Date, stagedBefore: Date): Promise<OkxCredentialHead[]> {
    try {
      const result = await this.#pool.query<HeadRow>(
        `SELECT user_id, credential_id, active_version, configured, status,
                capability_epoch, rotation_due_at, updated_at
           FROM okx_credential_heads
          WHERE status = 'deleting'
             OR (configured AND rotation_due_at <= $1 AND status <> 'revoked')
         UNION ALL
         SELECT h.user_id, h.credential_id, v.version AS active_version,
                false AS configured, 'staged' AS status,
                h.capability_epoch, NULL AS rotation_due_at, v.created_at AS updated_at
           FROM okx_credential_versions v
           JOIN okx_credential_heads h ON h.user_id = v.user_id
          WHERE v.status = 'staged' AND NOT v.active AND v.destroyed_at IS NULL
            AND v.created_at <= $2
          ORDER BY updated_at, user_id`,
        [now, stagedBefore],
      );
      return result.rows.map(headFromRow);
    } catch {
      throw new OkxConnectorError("CONNECTOR_UNAVAILABLE", true);
    }
  }
}
