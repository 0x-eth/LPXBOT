import type {
  CustodyWallet,
  CustodyWalletPage,
  WalletDeletionReceipt,
  WalletEncryptionMode,
  WalletLockStatus,
} from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  KeystoreStore,
  SecurityPasswordStore,
  StoredCustodyWallet,
  StoredKeystore,
  StoredKeystoreFailure,
  StoredKeystoreResetPreview,
  StoredSecurityPassword,
  StoredWalletDeletePreview,
  WalletEnvelopeMaterial,
  WalletEnvelopeReplacement,
  WalletDeleteCommit,
} from "./custody-types.js";
import { publicWallet } from "./custody-types.js";
import { SignerError } from "./signer-error.js";

interface WalletRow extends QueryResultRow {
  address: `0x${string}`;
  address_lower: `0x${string}`;
  created_at: Date;
  current_envelope_version: number;
  lock_status: WalletLockStatus;
  mode: WalletEncryptionMode;
  name: string;
  revision: string;
  tenant_id: string;
  updated_at: Date;
  user_id: string;
  wallet_id: string;
}

interface EnvelopeRow extends QueryResultRow {
  aad_version: number;
  algorithm: "AES-256-GCM";
  authentication_tag: Buffer;
  ciphertext: Buffer;
  created_at: Date;
  dek_wrap_authentication_tag: Buffer | null;
  dek_wrap_nonce: Buffer | null;
  dek_wrap_version: number;
  envelope_version: number;
  kek_id: string;
  kek_version: string;
  nonce: Buffer;
  secret_version: string | null;
  wrapped_dek: Buffer;
}

interface KeystoreRow extends QueryResultRow {
  auto_lock_minutes: number;
  created_at: Date;
  current_secret_version: string;
  parameter_version: number;
  salt: Buffer;
  updated_at: Date;
  user_id: string;
  verifier: Buffer;
}

interface FailureRow extends QueryResultRow {
  backoff_until: Date;
  failure_count: number;
  locked_until: Date | null;
  window_started_at: Date;
}

interface ResetPreviewRow extends QueryResultRow {
  content_digest: string;
  expires_at: Date;
  preview_token_digest: Buffer;
  secret_version: string;
  user_id: string;
}

interface WalletDeletePreviewRow extends QueryResultRow {
  asset_ids: string[];
  asset_risk_digest: string;
  confirmation_phrase: string;
  expires_at: Date;
  force_eligible: boolean;
  policy_ids: string[];
  position_ids: string[];
  preview_token_digest: Buffer;
  task_ids: string[];
  user_id: string;
  wallet_id: string;
  wallet_revision: string;
}

interface SecurityPasswordRow extends QueryResultRow {
  current_version: string;
  failure_count: number;
  locked_until: Date | null;
  parameter_version: number;
  salt: Buffer;
  updated_at: Date;
  user_id: string;
  verifier: Buffer;
  version_created_at: Date;
}

const walletColumns = `
  wallet_id::text, tenant_id, user_id::text, name, address, address_lower, mode,
  lock_status, current_envelope_version, revision::text, created_at, updated_at`;

const envelopeColumns = `
  envelope_version, algorithm, ciphertext, nonce, authentication_tag, aad_version,
  wrapped_dek, kek_id, kek_version, dek_wrap_version, dek_wrap_nonce,
  dek_wrap_authentication_tag, secret_version::text, created_at`;

const securityPasswordColumns = `
  p.user_id::text, p.current_version::text, p.failure_count, p.locked_until, p.updated_at,
  v.parameter_version, v.salt, v.verifier, v.created_at AS version_created_at`;

function integer(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`Stored ${field} is invalid`);
  }
  return parsed;
}

function storedWallet(row: WalletRow): StoredCustodyWallet {
  return {
    address: row.address,
    addressLower: row.address_lower,
    createdAt: row.created_at,
    envelopeVersion: integer(row.current_envelope_version, "envelope version"),
    lockStatus: row.lock_status,
    mode: row.mode,
    name: row.name,
    revision: integer(row.revision, "wallet revision"),
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
    userId: row.user_id,
    walletId: row.wallet_id,
  };
}

function storedEnvelope(row: EnvelopeRow): CustodyEnvelope {
  return {
    aadVersion: row.aad_version as 1,
    algorithm: row.algorithm,
    ciphertext: row.ciphertext,
    createdAt: row.created_at,
    dekWrapNonce: row.dek_wrap_nonce,
    dekWrapTag: row.dek_wrap_authentication_tag,
    dekWrapVersion: row.dek_wrap_version as 1,
    envelopeVersion: integer(row.envelope_version, "envelope version"),
    kekId: row.kek_id,
    kekVersion: row.kek_version,
    nonce: row.nonce,
    secretVersion:
      row.secret_version === null ? null : integer(row.secret_version, "secret version"),
    tag: row.authentication_tag,
    wrappedDek: row.wrapped_dek,
  };
}

function storedKeystore(row: KeystoreRow): StoredKeystore {
  return {
    autoLockMinutes: row.auto_lock_minutes as 1 | 5 | 15 | 30 | 60,
    current: {
      createdAt: row.created_at,
      parameterVersion: row.parameter_version as 1,
      salt: row.salt,
      secretVersion: integer(row.current_secret_version, "secret version"),
      verifier: row.verifier,
    },
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function storedSecurityPassword(row: SecurityPasswordRow): StoredSecurityPassword {
  if (!Number.isSafeInteger(row.failure_count) || row.failure_count < 0 || row.failure_count > 5) {
    throw new RangeError("Stored security password failure count is invalid");
  }
  return {
    current: {
      createdAt: row.version_created_at,
      parameterVersion: row.parameter_version as 1,
      salt: row.salt,
      verifier: row.verifier,
      version: integer(row.current_version, "security password version"),
    },
    failureCount: row.failure_count,
    lockedUntil: row.locked_until,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function pgCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

export interface PostgresCustodyWalletStoreOptions {
  failAt?: "before-commit" | "before-lifecycle-commit";
}

export class PostgresCustodyWalletStore
  implements CustodyWalletStore, KeystoreStore, SecurityPasswordStore
{
  readonly #failAt: "before-commit" | "before-lifecycle-commit" | null;
  readonly #pool: Pool;

  constructor(pool: Pool, options: PostgresCustodyWalletStoreOptions = {}) {
    this.#pool = pool;
    this.#failAt = options.failAt ?? null;
  }

  async create(input: CustodyWalletCreate): Promise<CustodyWallet> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `custody-address:${input.wallet.userId}:${input.wallet.addressLower}`,
      ]);
      await client.query(
        `INSERT INTO custody_wallets (
           wallet_id, tenant_id, user_id, name, address, address_lower, mode, lock_status,
           lifecycle_status, current_envelope_version, revision, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12)`,
        [
          input.wallet.walletId,
          input.wallet.tenantId,
          input.wallet.userId,
          input.wallet.name,
          input.wallet.address,
          input.wallet.addressLower,
          input.wallet.mode,
          input.wallet.lockStatus,
          input.wallet.envelopeVersion,
          input.wallet.revision,
          input.wallet.createdAt,
          input.wallet.updatedAt,
        ],
      );
      await this.#insertEnvelope(client, input.wallet.walletId, input.envelope);
      await this.#insertAudit(client, {
        action: input.auditAction,
        envelopeVersion: input.wallet.envelopeVersion,
        revision: input.wallet.revision,
        updatedAt: input.wallet.createdAt,
        userId: input.wallet.userId,
        walletId: input.wallet.walletId,
      });
      if (this.#failAt === "before-commit") throw new Error("CUSTODY_STORE_FAULT");
      await client.query("COMMIT");
      return publicWallet(input.wallet);
    } catch (error) {
      await this.#rollback(client);
      if (pgCode(error) === "23505") throw new SignerError("WALLET_ADDRESS_EXISTS");
      throw error;
    } finally {
      client.release();
    }
  }

  async createWalletDeletePreview(preview: StoredWalletDeletePreview): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `custody-wallet:${preview.userId}:${preview.walletId}`,
      ]);
      const wallet = await client.query(
        `SELECT 1 FROM custody_wallets
          WHERE user_id = $1 AND wallet_id = $2 AND revision = $3
            AND lifecycle_status IN ('active', 'recoverable')
          FOR UPDATE`,
        [preview.userId, preview.walletId, preview.revision],
      );
      if (wallet.rowCount !== 1) throw new SignerError("REVISION_CONFLICT");
      await client.query(
        "DELETE FROM custody_wallet_delete_previews WHERE user_id = $1 AND wallet_id = $2",
        [preview.userId, preview.walletId],
      );
      await client.query(
        `INSERT INTO custody_wallet_delete_previews (
           user_id, wallet_id, preview_token_digest, wallet_revision, task_ids, policy_ids,
           position_ids, asset_ids, asset_risk_digest, force_eligible, confirmation_phrase,
           expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          preview.userId,
          preview.walletId,
          preview.previewTokenDigest,
          preview.revision,
          preview.taskIds,
          preview.policyIds,
          preview.positionIds,
          preview.assetIds,
          preview.assetRiskDigest,
          preview.forceEligible,
          preview.confirmationPhrase,
          preview.expiresAt,
          new Date(preview.expiresAt.getTime() - 300_000),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getWalletDeletePreview(
    userId: string,
    walletId: string,
    previewTokenDigest: Uint8Array,
  ): Promise<StoredWalletDeletePreview | null> {
    const result = await this.#pool.query<WalletDeletePreviewRow>(
      `SELECT user_id::text, wallet_id::text, preview_token_digest,
              wallet_revision::text, task_ids, policy_ids, position_ids, asset_ids,
              asset_risk_digest, force_eligible, confirmation_phrase, expires_at
         FROM custody_wallet_delete_previews
        WHERE user_id = $1 AND wallet_id = $2 AND preview_token_digest = $3`,
      [userId, walletId, previewTokenDigest],
    );
    const row = result.rows[0];
    return row
      ? {
          assetIds: [...row.asset_ids],
          assetRiskDigest: row.asset_risk_digest,
          complete: true,
          confirmationPhrase: row.confirmation_phrase,
          expiresAt: row.expires_at,
          forceEligible: row.force_eligible,
          policyIds: [...row.policy_ids],
          positionIds: [...row.position_ids],
          previewTokenDigest: Buffer.from(row.preview_token_digest),
          revision: integer(row.wallet_revision, "wallet revision"),
          taskIds: [...row.task_ids],
          userId: row.user_id,
          walletId: row.wallet_id,
        }
      : null;
  }

  async deleteWallet(input: WalletDeleteCommit): Promise<WalletDeletionReceipt> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `custody-wallet:${input.userId}:${input.walletId}`,
      ]);
      const current = await client.query<WalletRow>(
        `SELECT ${walletColumns} FROM custody_wallets
          WHERE user_id = $1 AND wallet_id = $2
            AND lifecycle_status IN ('active', 'recoverable')
          FOR UPDATE`,
        [input.userId, input.walletId],
      );
      const wallet = current.rows[0];
      if (!wallet) throw new SignerError("WALLET_NOT_FOUND");
      if (integer(wallet.revision, "wallet revision") !== input.expectedRevision) {
        throw new SignerError("REVISION_CONFLICT");
      }
      const previewResult = await client.query<WalletDeletePreviewRow>(
        `SELECT user_id::text, wallet_id::text, preview_token_digest,
                wallet_revision::text, task_ids, policy_ids, position_ids, asset_ids,
                asset_risk_digest, force_eligible, confirmation_phrase, expires_at
           FROM custody_wallet_delete_previews
          WHERE user_id = $1 AND wallet_id = $2 AND preview_token_digest = $3
          FOR UPDATE`,
        [input.userId, input.walletId, input.previewTokenDigest],
      );
      const preview = previewResult.rows[0];
      if (!preview || preview.expires_at <= input.now) throw new SignerError("PREVIEW_EXPIRED");
      if (
        integer(preview.wallet_revision, "wallet revision") !== input.expectedRevision ||
        preview.asset_risk_digest !== input.assetRiskDigest ||
        JSON.stringify(preview.asset_ids) !== JSON.stringify(input.assetIds) ||
        JSON.stringify(preview.policy_ids) !== JSON.stringify(input.policyIds) ||
        JSON.stringify(preview.position_ids) !== JSON.stringify(input.positionIds) ||
        JSON.stringify(preview.task_ids) !== JSON.stringify(input.taskIds)
      ) {
        throw new SignerError("PREVIEW_CHANGED");
      }
      const finalRevision = input.expectedRevision + 1;
      const audit = await client.query<{ audit_id: string }>(
        `INSERT INTO custody_wallet_audit_events (
           wallet_id, user_id, action, outcome, wallet_revision, envelope_version, created_at
         ) VALUES ($1, $2, $3, 'allowed', $4, $5, $6)
         RETURNING audit_id::text`,
        [
          input.walletId,
          input.userId,
          input.deletionType === "force" ? "wallet.force-delete" : "wallet.delete",
          finalRevision,
          wallet.current_envelope_version,
          input.now,
        ],
      );
      const auditId = audit.rows[0]!.audit_id;
      await client.query(
        `INSERT INTO custody_wallet_tombstones (
           wallet_id, user_id, address, final_revision, deletion_type, deletion_audit_id, deleted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.walletId,
          input.userId,
          wallet.address,
          finalRevision,
          input.deletionType,
          auditId,
          input.now,
        ],
      );
      if (wallet.mode === "user-password") {
        const locked = await client.query<WalletRow>(
          `UPDATE custody_wallets
              SET lock_status = 'locked', revision = revision + 1, updated_at = $2
            WHERE user_id = $1 AND wallet_id <> $3 AND mode = 'user-password'
              AND lifecycle_status IN ('active', 'recoverable') AND lock_status <> 'locked'
            RETURNING ${walletColumns}`,
          [input.userId, input.now, input.walletId],
        );
        for (const row of locked.rows) {
          await this.#insertAudit(client, {
            action: "wallet.lock",
            envelopeVersion: integer(row.current_envelope_version, "envelope version"),
            revision: integer(row.revision, "wallet revision"),
            updatedAt: input.now,
            userId: input.userId,
            walletId: row.wallet_id,
          });
        }
      }
      await client.query(
        "DELETE FROM custody_wallet_delete_previews WHERE user_id = $1 AND wallet_id = $2",
        [input.userId, input.walletId],
      );
      await client.query("DELETE FROM custody_wallets WHERE wallet_id = $1 AND user_id = $2", [
        input.walletId,
        input.userId,
      ]);
      this.#lifecycleFault();
      await client.query("COMMIT");
      return {
        address: wallet.address,
        auditId,
        deletedAt: input.now.toISOString(),
        deletionType: input.deletionType,
        finalRevision,
        walletId: input.walletId,
      };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async get(userId: string, walletId: string): Promise<StoredCustodyWallet | null> {
    const result = await this.#pool.query<WalletRow>(
      `SELECT ${walletColumns} FROM custody_wallets
        WHERE user_id = $1 AND wallet_id = $2 AND lifecycle_status IN ('active', 'recoverable')`,
      [userId, walletId],
    );
    return result.rows[0] ? storedWallet(result.rows[0]) : null;
  }

  async getCurrentEnvelope(
    walletId: string,
    envelopeVersion: number,
  ): Promise<CustodyEnvelope | null> {
    const result = await this.#pool.query<EnvelopeRow>(
      `SELECT ${envelopeColumns}
         FROM custody_wallet_envelopes
        WHERE wallet_id = $1 AND envelope_version = $2`,
      [walletId, envelopeVersion],
    );
    return result.rows[0] ? storedEnvelope(result.rows[0]) : null;
  }

  async list(userId: string): Promise<CustodyWalletPage> {
    const result = await this.#pool.query<WalletRow>(
      `SELECT ${walletColumns} FROM custody_wallets
        WHERE user_id = $1 AND lifecycle_status IN ('active', 'recoverable')
        ORDER BY created_at DESC, wallet_id DESC`,
      [userId],
    );
    return { items: result.rows.map((row) => publicWallet(storedWallet(row))) };
  }

  async rename(input: {
    expectedRevision: number;
    name: string;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `custody-wallet:${input.userId}:${input.walletId}`,
      ]);
      const current = await client.query<WalletRow>(
        `SELECT ${walletColumns} FROM custody_wallets
          WHERE user_id = $1 AND wallet_id = $2
            AND lifecycle_status IN ('active', 'recoverable')
          FOR UPDATE`,
        [input.userId, input.walletId],
      );
      const row = current.rows[0];
      if (!row) throw new SignerError("WALLET_NOT_FOUND");
      if (integer(row.revision, "wallet revision") !== input.expectedRevision) {
        throw new SignerError("REVISION_CONFLICT");
      }
      if (row.name === input.name) {
        await client.query("COMMIT");
        return publicWallet(storedWallet(row));
      }
      const renamed = await client.query<WalletRow>(
        `UPDATE custody_wallets
            SET name = $3, revision = revision + 1, updated_at = $4
          WHERE user_id = $1 AND wallet_id = $2 AND revision = $5
          RETURNING ${walletColumns}`,
        [input.userId, input.walletId, input.name, input.updatedAt, input.expectedRevision],
      );
      const updated = renamed.rows[0];
      if (!updated) throw new SignerError("REVISION_CONFLICT");
      await this.#insertAudit(client, {
        action: "wallet.rename",
        envelopeVersion: integer(updated.current_envelope_version, "envelope version"),
        revision: integer(updated.revision, "wallet revision"),
        updatedAt: input.updatedAt,
        userId: input.userId,
        walletId: input.walletId,
      });
      await client.query("COMMIT");
      return publicWallet(storedWallet(updated));
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async setLockStatus(
    userId: string,
    walletId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<WalletRow>(
        `UPDATE custody_wallets
            SET lock_status = $3, revision = revision + 1, updated_at = $4
          WHERE user_id = $1 AND wallet_id = $2 AND lifecycle_status IN ('active', 'recoverable')
          RETURNING ${walletColumns}`,
        [userId, walletId, status, updatedAt],
      );
      const row = result.rows[0];
      if (!row) throw new SignerError("WALLET_NOT_FOUND");
      await this.#insertAudit(client, {
        action:
          status === "quarantined"
            ? "wallet.quarantine"
            : status === "locked"
              ? "wallet.lock"
              : "wallet.recover",
        envelopeVersion: integer(row.current_envelope_version, "envelope version"),
        revision: integer(row.revision, "wallet revision"),
        updatedAt,
        userId,
        walletId,
      });
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async getSecurityPassword(userId: string): Promise<StoredSecurityPassword | null> {
    const result = await this.#pool.query<SecurityPasswordRow>(
      `SELECT ${securityPasswordColumns}
         FROM user_security_passwords p
         JOIN user_security_password_versions v
           ON v.user_id = p.user_id AND v.version = p.current_version
        WHERE p.user_id = $1`,
      [userId],
    );
    return result.rows[0] ? storedSecurityPassword(result.rows[0]) : null;
  }

  async createSecurityPassword(password: StoredSecurityPassword): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockSecurityPasswordUser(client, password.userId);
      await client.query(
        `INSERT INTO user_security_passwords (
           user_id, current_version, failure_count, locked_until, created_at, updated_at
         ) VALUES ($1, $2, 0, NULL, $3, $4)`,
        [
          password.userId,
          password.current.version,
          password.current.createdAt,
          password.updatedAt,
        ],
      );
      await this.#insertSecurityPasswordVersion(client, password);
      await this.#insertSecurityPasswordAudit(client, {
        action: "security-password.create",
        now: password.updatedAt,
        outcome: "allowed",
        userId: password.userId,
        version: password.current.version,
      });
      this.#lifecycleFault();
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      if (pgCode(error) === "23505") {
        throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async rotateSecurityPassword(input: {
    expectedVersion: number;
    next: StoredSecurityPassword;
  }): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockSecurityPasswordUser(client, input.next.userId);
      const current = await this.#lockedSecurityPassword(client, input.next.userId);
      if (!current || integer(current.current_version, "security password version") !== input.expectedVersion) {
        throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      }
      await this.#insertSecurityPasswordVersion(client, input.next);
      const updated = await client.query(
        `UPDATE user_security_passwords
            SET current_version = $3, failure_count = 0, locked_until = NULL, updated_at = $4
          WHERE user_id = $1 AND current_version = $2`,
        [
          input.next.userId,
          input.expectedVersion,
          input.next.current.version,
          input.next.updatedAt,
        ],
      );
      if (updated.rowCount !== 1) throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      await this.#insertSecurityPasswordAudit(client, {
        action: "security-password.change",
        now: input.next.updatedAt,
        outcome: "allowed",
        userId: input.next.userId,
        version: input.next.current.version,
      });
      this.#lifecycleFault();
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      if (pgCode(error) === "23505") {
        throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordSecurityPasswordFailure(input: {
    maxAttempts: number;
    now: Date;
    userId: string;
    version: number;
  }): Promise<StoredSecurityPassword> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockSecurityPasswordUser(client, input.userId);
      const current = await this.#lockedSecurityPassword(client, input.userId);
      if (!current || integer(current.current_version, "security password version") !== input.version) {
        throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      }
      const failureCount = Math.min(input.maxAttempts, current.failure_count + 1);
      const lockedUntil =
        failureCount >= input.maxAttempts ? new Date(input.now.getTime() + 15 * 60_000) : null;
      await client.query(
        `UPDATE user_security_passwords
            SET failure_count = $3, locked_until = $4, updated_at = $5
          WHERE user_id = $1 AND current_version = $2`,
        [input.userId, input.version, failureCount, lockedUntil, input.now],
      );
      await this.#insertSecurityPasswordAudit(client, {
        action: "security-password.verify",
        now: input.now,
        outcome: "denied",
        userId: input.userId,
        version: input.version,
      });
      await client.query("COMMIT");
      return {
        ...storedSecurityPassword(current),
        failureCount,
        lockedUntil,
        updatedAt: input.now,
      };
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async clearSecurityPasswordFailures(input: {
    now: Date;
    userId: string;
    version: number;
  }): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockSecurityPasswordUser(client, input.userId);
      const updated = await client.query(
        `UPDATE user_security_passwords
            SET failure_count = 0, locked_until = NULL, updated_at = $3
          WHERE user_id = $1 AND current_version = $2`,
        [input.userId, input.version, input.now],
      );
      if (updated.rowCount !== 1) throw new SignerError("SECURITY_PASSWORD_VERSION_CONFLICT");
      await this.#insertSecurityPasswordAudit(client, {
        action: "security-password.verify",
        now: input.now,
        outcome: "allowed",
        userId: input.userId,
        version: input.version,
      });
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async createKeystore(keystore: StoredKeystore): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockUser(client, keystore.userId);
      await client.query(
        `INSERT INTO user_keystores (
           user_id, current_secret_version, auto_lock_minutes, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          keystore.userId,
          keystore.current.secretVersion,
          keystore.autoLockMinutes,
          keystore.current.createdAt,
          keystore.updatedAt,
        ],
      );
      await this.#insertKeystoreVersion(client, keystore, "active");
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      if (pgCode(error) === "23505") throw new SignerError("PASSWORD_ALREADY_CONFIGURED");
      throw error;
    } finally {
      client.release();
    }
  }

  async getKeystore(userId: string): Promise<StoredKeystore | null> {
    const result = await this.#pool.query<KeystoreRow>(
      `SELECT k.user_id::text, k.current_secret_version::text, k.auto_lock_minutes,
              k.updated_at, v.created_at, v.parameter_version, v.salt, v.verifier
         FROM user_keystores k
         JOIN user_keystore_versions v
           ON v.user_id = k.user_id AND v.secret_version = k.current_secret_version
        WHERE k.user_id = $1`,
      [userId],
    );
    return result.rows[0] ? storedKeystore(result.rows[0]) : null;
  }

  async rotateKeystore(input: {
    expectedVersion: number;
    next: StoredKeystore;
    replacements?: WalletEnvelopeReplacement[];
  }): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockUser(client, input.next.userId);
      const current = await this.#lockedKeystore(client, input.next.userId);
      if (
        !current ||
        integer(current.current_secret_version, "secret version") !== input.expectedVersion
      ) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      await client.query(
        `UPDATE user_keystore_versions
            SET lifecycle_status = 'retired'
          WHERE user_id = $1 AND secret_version = $2 AND lifecycle_status = 'active'`,
        [input.next.userId, input.expectedVersion],
      );
      await this.#insertKeystoreVersion(client, input.next, "active");
      const keystoreUpdate = await client.query(
        `UPDATE user_keystores
            SET current_secret_version = $3, auto_lock_minutes = $4, updated_at = $5
          WHERE user_id = $1 AND current_secret_version = $2`,
        [
          input.next.userId,
          input.expectedVersion,
          input.next.current.secretVersion,
          input.next.autoLockMinutes,
          input.next.updatedAt,
        ],
      );
      if (keystoreUpdate.rowCount !== 1) throw new SignerError("SECRET_VERSION_CONFLICT");
      for (const replacement of input.replacements ?? []) {
        await this.#replaceEnvelope(client, replacement, "wallet.password-change", "locked");
      }
      this.#lifecycleFault();
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateKeystoreAutoLock(input: {
    expectedVersion: number;
    minutes: 1 | 5 | 15 | 30 | 60;
    updatedAt: Date;
    userId: string;
  }): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE user_keystores
          SET auto_lock_minutes = $3, updated_at = $4
        WHERE user_id = $1 AND current_secret_version = $2`,
      [input.userId, input.expectedVersion, input.minutes, input.updatedAt],
    );
    if (result.rowCount !== 1) throw new SignerError("SECRET_VERSION_CONFLICT");
  }

  async getKeystoreFailure(
    userId: string,
    sourceSessionId: string,
  ): Promise<StoredKeystoreFailure | null> {
    const result = await this.#pool.query<FailureRow>(
      `SELECT window_started_at, failure_count, backoff_until, locked_until
         FROM user_keystore_failures
        WHERE user_id = $1 AND source_session_id = $2`,
      [userId, sourceSessionId],
    );
    const row = result.rows[0];
    return row
      ? {
          backoffUntil: row.backoff_until,
          failureCount: row.failure_count,
          lockedUntil: row.locked_until,
          windowStartedAt: row.window_started_at,
        }
      : null;
  }

  async recordKeystoreFailure(input: {
    backoffMilliseconds: number;
    maxAttempts: number;
    now: Date;
    sourceSessionId: string;
    userId: string;
    windowMilliseconds: number;
  }): Promise<StoredKeystoreFailure> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockUser(client, input.userId);
      const existing = await client.query<FailureRow>(
        `SELECT window_started_at, failure_count, backoff_until, locked_until
           FROM user_keystore_failures
          WHERE user_id = $1 AND source_session_id = $2
          FOR UPDATE`,
        [input.userId, input.sourceSessionId],
      );
      const previous = existing.rows[0];
      const expired =
        !previous ||
        input.now.getTime() - previous.window_started_at.getTime() >= input.windowMilliseconds;
      const windowStartedAt = expired ? input.now : previous.window_started_at;
      const failureCount = expired ? 1 : Math.min(input.maxAttempts, previous.failure_count + 1);
      const failure: StoredKeystoreFailure = {
        backoffUntil: new Date(input.now.getTime() + input.backoffMilliseconds),
        failureCount,
        lockedUntil:
          failureCount >= input.maxAttempts
            ? new Date(windowStartedAt.getTime() + input.windowMilliseconds)
            : null,
        windowStartedAt,
      };
      await client.query(
        `INSERT INTO user_keystore_failures (
           user_id, source_session_id, window_started_at, failure_count,
           backoff_until, locked_until, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, source_session_id) DO UPDATE SET
           window_started_at = EXCLUDED.window_started_at,
           failure_count = EXCLUDED.failure_count,
           backoff_until = EXCLUDED.backoff_until,
           locked_until = EXCLUDED.locked_until,
           updated_at = EXCLUDED.updated_at`,
        [
          input.userId,
          input.sourceSessionId,
          failure.windowStartedAt,
          failure.failureCount,
          failure.backoffUntil,
          failure.lockedUntil,
          input.now,
        ],
      );
      await client.query("COMMIT");
      return failure;
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async clearKeystoreFailures(userId: string, sourceSessionId: string): Promise<void> {
    await this.#pool.query(
      `DELETE FROM user_keystore_failures WHERE user_id = $1 AND source_session_id = $2`,
      [userId, sourceSessionId],
    );
  }

  async setUserPasswordWalletLockStatus(
    userId: string,
    status: WalletLockStatus,
    updatedAt: Date,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const changed = await client.query<WalletRow>(
        `UPDATE custody_wallets
            SET lock_status = $2, revision = revision + 1, updated_at = $3
          WHERE user_id = $1 AND mode = 'user-password'
            AND lifecycle_status IN ('active', 'recoverable') AND lock_status <> $2
          RETURNING ${walletColumns}`,
        [userId, status, updatedAt],
      );
      for (const row of changed.rows) {
        await this.#insertAudit(client, {
          action: status === "locked" ? "wallet.lock" : "wallet.recover",
          envelopeVersion: integer(row.current_envelope_version, "envelope version"),
          revision: integer(row.revision, "wallet revision"),
          updatedAt,
          userId,
          walletId: row.wallet_id,
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listUserPasswordWalletMaterials(userId: string): Promise<WalletEnvelopeMaterial[]> {
    const wallets = await this.#pool.query<WalletRow>(
      `SELECT ${walletColumns} FROM custody_wallets
        WHERE user_id = $1 AND mode = 'user-password'
          AND lifecycle_status IN ('active', 'recoverable')
        ORDER BY wallet_id`,
      [userId],
    );
    const materials: WalletEnvelopeMaterial[] = [];
    for (const row of wallets.rows) {
      const wallet = storedWallet(row);
      const envelope = await this.getCurrentEnvelope(wallet.walletId, wallet.envelopeVersion);
      if (!envelope) throw new SignerError("INVALID_CREDENTIALS");
      materials.push({ envelope, wallet });
    }
    return materials;
  }

  async switchWalletEncryptionMode(input: {
    envelope: CustodyEnvelope;
    expectedRevision: number;
    expectedSecretVersion: number;
    lockStatus: WalletLockStatus;
    mode: WalletEncryptionMode;
    updatedAt: Date;
    userId: string;
    walletId: string;
  }): Promise<CustodyWallet> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockUser(client, input.userId);
      const keystore = await this.#lockedKeystore(client, input.userId);
      if (
        !keystore ||
        integer(keystore.current_secret_version, "secret version") !== input.expectedSecretVersion
      ) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      const walletResult = await client.query<WalletRow>(
        `SELECT ${walletColumns} FROM custody_wallets
          WHERE user_id = $1 AND wallet_id = $2
            AND lifecycle_status IN ('active', 'recoverable')
          FOR UPDATE`,
        [input.userId, input.walletId],
      );
      const wallet = walletResult.rows[0] ? storedWallet(walletResult.rows[0]) : null;
      if (!wallet) throw new SignerError("WALLET_NOT_FOUND");
      if (wallet.revision !== input.expectedRevision) throw new SignerError("REVISION_CONFLICT");
      if (wallet.mode === input.mode) throw new SignerError("INVALID_MODE");
      await this.#insertEnvelope(client, input.walletId, input.envelope);
      const updated = await client.query<WalletRow>(
        `UPDATE custody_wallets
            SET mode = $3, lock_status = $4, current_envelope_version = $5,
                revision = revision + 1, updated_at = $6
          WHERE user_id = $1 AND wallet_id = $2 AND revision = $7
          RETURNING ${walletColumns}`,
        [
          input.userId,
          input.walletId,
          input.mode,
          input.lockStatus,
          input.envelope.envelopeVersion,
          input.updatedAt,
          input.expectedRevision,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new SignerError("REVISION_CONFLICT");
      await this.#insertAudit(client, {
        action: "wallet.mode-switch",
        envelopeVersion: input.envelope.envelopeVersion,
        revision: integer(row.revision, "wallet revision"),
        updatedAt: input.updatedAt,
        userId: input.userId,
        walletId: input.walletId,
      });
      this.#lifecycleFault();
      await client.query("COMMIT");
      return publicWallet(storedWallet(row));
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async createKeystoreResetPreview(preview: StoredKeystoreResetPreview): Promise<void> {
    await this.#pool.query(
      `INSERT INTO user_keystore_reset_previews (
         user_id, preview_token_digest, secret_version, content_digest, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        preview.userId,
        preview.previewTokenDigest,
        preview.secretVersion,
        preview.contentDigest,
        preview.expiresAt,
        new Date(preview.expiresAt.getTime() - 300_000),
      ],
    );
  }

  async getKeystoreResetPreview(
    userId: string,
    previewTokenDigest: Uint8Array,
  ): Promise<StoredKeystoreResetPreview | null> {
    const result = await this.#pool.query<ResetPreviewRow>(
      `SELECT user_id::text, preview_token_digest, secret_version::text, content_digest, expires_at
         FROM user_keystore_reset_previews
        WHERE user_id = $1 AND preview_token_digest = $2`,
      [userId, Buffer.from(previewTokenDigest)],
    );
    const row = result.rows[0];
    return row
      ? {
          contentDigest: row.content_digest,
          expiresAt: row.expires_at,
          previewTokenDigest: row.preview_token_digest,
          secretVersion: integer(row.secret_version, "secret version"),
          userId: row.user_id,
        }
      : null;
  }

  async resetKeystore(input: {
    expectedVersion: number;
    now: Date;
    previewTokenDigest: Uint8Array;
    userId: string;
  }): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await this.#lockUser(client, input.userId);
      const keystore = await this.#lockedKeystore(client, input.userId);
      if (
        !keystore ||
        integer(keystore.current_secret_version, "secret version") !== input.expectedVersion
      ) {
        throw new SignerError("SECRET_VERSION_CONFLICT");
      }
      const preview = await client.query<ResetPreviewRow>(
        `SELECT user_id::text, preview_token_digest, secret_version::text, content_digest, expires_at
           FROM user_keystore_reset_previews
          WHERE user_id = $1 AND preview_token_digest = $2
          FOR UPDATE`,
        [input.userId, Buffer.from(input.previewTokenDigest)],
      );
      if (!preview.rows[0] || preview.rows[0].expires_at <= input.now) {
        throw new SignerError("PREVIEW_EXPIRED");
      }
      this.#lifecycleFault();
      await client.query(
        `DELETE FROM custody_wallets WHERE user_id = $1 AND mode = 'user-password'`,
        [input.userId],
      );
      await client.query("DELETE FROM user_keystores WHERE user_id = $1", [input.userId]);
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async #insertEnvelope(
    client: PoolClient,
    walletId: string,
    envelope: CustodyEnvelope,
  ): Promise<void> {
    await client.query(
      `INSERT INTO custody_wallet_envelopes (
         wallet_id, envelope_version, algorithm, ciphertext, nonce, authentication_tag,
         aad_version, wrapped_dek, kek_id, kek_version, dek_wrap_version, dek_wrap_nonce,
         dek_wrap_authentication_tag, secret_version, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        walletId,
        envelope.envelopeVersion,
        envelope.algorithm,
        envelope.ciphertext,
        envelope.nonce,
        envelope.tag,
        envelope.aadVersion,
        envelope.wrappedDek,
        envelope.kekId,
        envelope.kekVersion,
        envelope.dekWrapVersion ?? 1,
        envelope.dekWrapNonce ?? null,
        envelope.dekWrapTag ?? null,
        envelope.secretVersion ?? null,
        envelope.createdAt,
      ],
    );
  }

  async #replaceEnvelope(
    client: PoolClient,
    replacement: WalletEnvelopeReplacement,
    action: string,
    lockStatus: WalletLockStatus,
  ): Promise<void> {
    await this.#insertEnvelope(client, replacement.wallet.walletId, replacement.envelope);
    const updated = await client.query<WalletRow>(
      `UPDATE custody_wallets
          SET current_envelope_version = $4, lock_status = $5,
              revision = revision + 1, updated_at = $6
        WHERE user_id = $1 AND wallet_id = $2 AND revision = $3
          AND current_envelope_version = $7 AND mode = 'user-password'
        RETURNING ${walletColumns}`,
      [
        replacement.wallet.userId,
        replacement.wallet.walletId,
        replacement.expectedRevision,
        replacement.envelope.envelopeVersion,
        lockStatus,
        replacement.envelope.createdAt,
        replacement.expectedEnvelopeVersion,
      ],
    );
    const row = updated.rows[0];
    if (!row) throw new SignerError("REVISION_CONFLICT");
    await this.#insertAudit(client, {
      action,
      envelopeVersion: replacement.envelope.envelopeVersion,
      revision: integer(row.revision, "wallet revision"),
      updatedAt: replacement.envelope.createdAt,
      userId: replacement.wallet.userId,
      walletId: replacement.wallet.walletId,
    });
  }

  async #insertKeystoreVersion(
    client: PoolClient,
    keystore: StoredKeystore,
    lifecycleStatus: "active" | "retired",
  ): Promise<void> {
    await client.query(
      `INSERT INTO user_keystore_versions (
         user_id, secret_version, kdf_algorithm, parameter_version, argon_version,
         memory_kib, iterations, parallelism, output_bytes, salt, verifier,
         lifecycle_status, created_at
       ) VALUES ($1, $2, 'Argon2id', $3, 19, 65536, 3, 1, 32, $4, $5, $6, $7)`,
      [
        keystore.userId,
        keystore.current.secretVersion,
        keystore.current.parameterVersion,
        keystore.current.salt,
        keystore.current.verifier,
        lifecycleStatus,
        keystore.current.createdAt,
      ],
    );
  }

  async #insertSecurityPasswordVersion(
    client: PoolClient,
    password: StoredSecurityPassword,
  ): Promise<void> {
    await client.query(
      `INSERT INTO user_security_password_versions (
         user_id, version, kdf_algorithm, kdf_domain, parameter_version, argon_version,
         memory_kib, iterations, parallelism, output_bytes, salt, verifier, created_at
       ) VALUES ($1, $2, 'Argon2id', 'lpbot-security-password-kdf/v1', $3, 19,
                 65536, 3, 1, 32, $4, $5, $6)`,
      [
        password.userId,
        password.current.version,
        password.current.parameterVersion,
        password.current.salt,
        password.current.verifier,
        password.current.createdAt,
      ],
    );
  }

  async #insertSecurityPasswordAudit(
    client: PoolClient,
    input: {
      action: "security-password.change" | "security-password.create" | "security-password.verify";
      now: Date;
      outcome: "allowed" | "denied";
      userId: string;
      version: number;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO security_password_audit_events (
         user_id, action, outcome, password_version, created_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.action, input.outcome, input.version, input.now],
    );
  }

  async #insertAudit(
    client: PoolClient,
    input: {
      action: string;
      envelopeVersion: number;
      revision: number;
      updatedAt: Date;
      userId: string;
      walletId: string;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO custody_wallet_audit_events (
         wallet_id, user_id, action, outcome, wallet_revision, envelope_version, created_at
       ) VALUES ($1, $2, $3, 'allowed', $4, $5, $6)`,
      [
        input.walletId,
        input.userId,
        input.action,
        input.revision,
        input.envelopeVersion,
        input.updatedAt,
      ],
    );
  }

  async #lockedKeystore(client: PoolClient, userId: string): Promise<KeystoreRow | null> {
    const result = await client.query<KeystoreRow>(
      `SELECT user_id::text, current_secret_version::text, auto_lock_minutes,
              created_at, updated_at, 1 AS parameter_version,
              decode(repeat('00', 16), 'hex') AS salt,
              decode(repeat('00', 32), 'hex') AS verifier
         FROM user_keystores WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async #lockedSecurityPassword(
    client: PoolClient,
    userId: string,
  ): Promise<SecurityPasswordRow | null> {
    const result = await client.query<SecurityPasswordRow>(
      `SELECT ${securityPasswordColumns}
         FROM user_security_passwords p
         JOIN user_security_password_versions v
           ON v.user_id = p.user_id AND v.version = p.current_version
        WHERE p.user_id = $1
        FOR UPDATE OF p`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async #lockUser(client: PoolClient, userId: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `keystore:${userId}`,
    ]);
  }

  async #lockSecurityPasswordUser(client: PoolClient, userId: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `security-password:${userId}`,
    ]);
  }

  #lifecycleFault(): void {
    if (this.#failAt === "before-lifecycle-commit") {
      throw new SignerError("CUSTODY_STORE_UNAVAILABLE", true);
    }
  }

  async #rollback(client: PoolClient): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction error.
    }
  }
}
