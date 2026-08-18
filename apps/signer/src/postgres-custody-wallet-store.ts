import type {
  CustodyWallet,
  CustodyWalletPage,
  WalletEncryptionMode,
  WalletLockStatus,
} from "@lpbot/api-contract";
import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  CustodyEnvelope,
  CustodyWalletCreate,
  CustodyWalletStore,
  StoredCustodyWallet,
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
  envelope_version: number;
  kek_id: string;
  kek_version: string;
  nonce: Buffer;
  wrapped_dek: Buffer;
}

const walletColumns = `
  wallet_id::text, tenant_id, user_id::text, name, address, address_lower, mode,
  lock_status, current_envelope_version, revision::text, created_at, updated_at`;

function integer(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new RangeError(`Stored ${field} is invalid`);
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

function pgCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

export interface PostgresCustodyWalletStoreOptions {
  failAt?: "before-commit";
}

export class PostgresCustodyWalletStore implements CustodyWalletStore {
  readonly #failAt: "before-commit" | null;
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
      await client.query(
        `INSERT INTO custody_wallet_envelopes (
           wallet_id, envelope_version, algorithm, ciphertext, nonce, authentication_tag,
           aad_version, wrapped_dek, kek_id, kek_version, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.wallet.walletId,
          input.envelope.envelopeVersion,
          input.envelope.algorithm,
          input.envelope.ciphertext,
          input.envelope.nonce,
          input.envelope.tag,
          input.envelope.aadVersion,
          input.envelope.wrappedDek,
          input.envelope.kekId,
          input.envelope.kekVersion,
          input.envelope.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO custody_wallet_audit_events (
           wallet_id, user_id, action, outcome, wallet_revision, envelope_version, created_at
         ) VALUES ($1, $2, $3, 'allowed', $4, $5, $6)`,
        [
          input.wallet.walletId,
          input.wallet.userId,
          input.auditAction,
          input.wallet.revision,
          input.wallet.envelopeVersion,
          input.wallet.createdAt,
        ],
      );
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
      `SELECT envelope_version, algorithm, ciphertext, nonce, authentication_tag, aad_version,
              wrapped_dek, kek_id, kek_version, created_at
         FROM custody_wallet_envelopes
        WHERE wallet_id = $1 AND envelope_version = $2`,
      [walletId, envelopeVersion],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      aadVersion: row.aad_version as 1,
      algorithm: row.algorithm,
      ciphertext: row.ciphertext,
      createdAt: row.created_at,
      envelopeVersion: integer(row.envelope_version, "envelope version"),
      kekId: row.kek_id,
      kekVersion: row.kek_version,
      nonce: row.nonce,
      tag: row.authentication_tag,
      wrappedDek: row.wrapped_dek,
    };
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
      const action =
        status === "quarantined"
          ? "wallet.quarantine"
          : status === "locked"
            ? "wallet.lock"
            : "wallet.recover";
      await client.query(
        `INSERT INTO custody_wallet_audit_events (
           wallet_id, user_id, action, outcome, wallet_revision, envelope_version, created_at
         ) VALUES ($1, $2, $3, 'allowed', $4, $5, $6)`,
        [walletId, userId, action, row.revision, row.current_envelope_version, updatedAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await this.#rollback(client);
      throw error;
    } finally {
      client.release();
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
