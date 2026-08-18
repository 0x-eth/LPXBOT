import type { AddressBookCategory, AddressBookEntry, EvmAddress } from "@lpbot/api-contract";
import type { Pool, PoolClient } from "pg";

import {
  AddressBookError,
  type AddressBookAuditInput,
  type AddressBookCreateInput,
  type AddressBookDeleteInput,
  type AddressBookPatchInput,
  type AddressBookStore,
} from "./address-book.js";

interface AddressBookRow {
  canonical_address: EvmAddress;
  category: AddressBookCategory;
  chain_id: string;
  created_at: Date;
  entry_id: string;
  label: string;
  note: string;
  revision: string;
  updated_at: Date;
}

const columns = `entry_id::text, chain_id::text, canonical_address, label, note,
  category, revision::text, created_at, updated_at`;
const insertAuditSql = `INSERT INTO wallet_address_book_audit_events (
  actor_user_id, session_id, entry_id, chain_id, canonical_address,
  action, outcome, result_code, request_id, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

function entry(row: AddressBookRow): AddressBookEntry {
  const revision = Number(row.revision);
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(chainId)) {
    throw new RangeError("Stored address-book numeric value is invalid");
  }
  return {
    address: row.canonical_address,
    category: row.category,
    chainId,
    createdAt: row.created_at.toISOString(),
    entryId: row.entry_id,
    label: row.label,
    note: row.note,
    revision,
    updatedAt: row.updated_at.toISOString(),
  };
}

function auditValues(input: AddressBookAuditInput): unknown[] {
  return [
    input.actorUserId,
    input.sessionId,
    input.entryId,
    input.chainId,
    input.address,
    input.action,
    input.outcome,
    input.resultCode,
    input.requestId,
    input.createdAt,
  ];
}

function uniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

export class PostgresAddressBookStore implements AddressBookStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async create(input: AddressBookCreateInput): Promise<AddressBookEntry> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<AddressBookRow>(
        `INSERT INTO wallet_address_book_entries (
           user_id, chain_id, canonical_address, label, note, category, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         RETURNING ${columns}`,
        [
          input.userId,
          input.chainId,
          input.address,
          input.label,
          input.note,
          input.category,
          input.createdAt,
        ],
      );
      const value = entry(result.rows[0]!);
      await this.#allowed(client, { ...input.audit, entryId: value.entryId }, "CREATED");
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (uniqueViolation(error)) throw new AddressBookError("ADDRESS_BOOK_DUPLICATE");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(input: AddressBookDeleteInput): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "DELETE FROM wallet_address_book_entries WHERE user_id = $1 AND entry_id = $2",
        [input.userId, input.entryId],
      );
      const deleted = result.rowCount === 1;
      await this.#allowed(client, input.audit, deleted ? "DELETED" : "ALREADY_ABSENT");
      await client.query("COMMIT");
      return deleted;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async get(input: { entryId: string; userId: string }): Promise<AddressBookEntry | null> {
    const result = await this.#pool.query<AddressBookRow>(
      `SELECT ${columns}
         FROM wallet_address_book_entries
        WHERE user_id = $1 AND entry_id = $2`,
      [input.userId, input.entryId],
    );
    return result.rows[0] ? entry(result.rows[0]) : null;
  }

  async list(input: { chainId: number; userId: string }): Promise<AddressBookEntry[]> {
    const result = await this.#pool.query<AddressBookRow>(
      `SELECT ${columns}
         FROM wallet_address_book_entries
        WHERE user_id = $1 AND chain_id = $2
        ORDER BY label COLLATE "C", entry_id`,
      [input.userId, input.chainId],
    );
    return result.rows.map(entry);
  }

  async patch(input: AddressBookPatchInput): Promise<AddressBookEntry> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<AddressBookRow>(
        `UPDATE wallet_address_book_entries
            SET label = COALESCE($4, label),
                note = COALESCE($5, note),
                category = COALESCE($6, category),
                revision = revision + 1,
                updated_at = $7
          WHERE user_id = $1 AND entry_id = $2 AND revision = $3
          RETURNING ${columns}`,
        [
          input.userId,
          input.entryId,
          input.expectedRevision,
          input.changes.label ?? null,
          input.changes.note ?? null,
          input.changes.category ?? null,
          input.updatedAt,
        ],
      );
      if (!result.rows[0]) {
        const current = await client.query(
          "SELECT 1 FROM wallet_address_book_entries WHERE user_id = $1 AND entry_id = $2",
          [input.userId, input.entryId],
        );
        throw new AddressBookError(
          current.rowCount === 1
            ? "ADDRESS_BOOK_REVISION_CONFLICT"
            : "ADDRESS_BOOK_ENTRY_NOT_FOUND",
        );
      }
      const value = entry(result.rows[0]);
      await this.#allowed(client, input.audit, "UPDATED");
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDenied(input: AddressBookAuditInput): Promise<void> {
    await this.#pool.query(insertAuditSql, auditValues(input));
  }

  async #allowed(
    client: PoolClient,
    input: Omit<AddressBookAuditInput, "outcome" | "resultCode">,
    resultCode: string,
  ): Promise<void> {
    await client.query(insertAuditSql, auditValues({ ...input, outcome: "allowed", resultCode }));
  }
}
