import type { AddressRemark, AddressRemarksResponse, EvmAddress } from "@lpbot/api-contract";
import type { Pool, PoolClient } from "pg";

import type {
  AddressRemarkAuditInput,
  AddressRemarkDeleteInput,
  AddressRemarkPutInput,
  AddressRemarkStore,
} from "./address-remarks.js";

interface PersonalRemarkRow {
  canonical_address: EvmAddress;
  label: string;
  watched: boolean;
}

interface SharedRemarkRow {
  canonical_address: EvmAddress;
  label: string;
  votes: string;
}

const insertAuditSql = `INSERT INTO address_remark_audit_events (
  actor_user_id, session_id, chain_id, canonical_address, action,
  outcome, result_code, request_id, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

function auditValues(input: AddressRemarkAuditInput): unknown[] {
  return [
    input.actorUserId,
    input.sessionId,
    input.chainId,
    input.address,
    input.action,
    input.outcome,
    input.resultCode,
    input.requestId,
    input.createdAt,
  ];
}

export class PostgresAddressRemarkStore implements AddressRemarkStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async list(input: { chainId: 56; userId: string }): Promise<AddressRemarksResponse> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const personal = await client.query<PersonalRemarkRow>(
        `SELECT canonical_address, label, watched
           FROM address_remarks
          WHERE user_id = $1 AND chain_id = $2
          ORDER BY canonical_address`,
        [input.userId, input.chainId],
      );
      const shared = await client.query<SharedRemarkRow>(
        `WITH label_votes AS (
           SELECT canonical_address, label, count(*) AS votes
             FROM address_remarks
            WHERE chain_id = $1 AND label <> ''
            GROUP BY canonical_address, label
         ), ranked AS (
           SELECT canonical_address, label, votes,
                  row_number() OVER (
                    PARTITION BY canonical_address
                    ORDER BY votes DESC, label COLLATE "C" ASC
                  ) AS rank
             FROM label_votes
         )
         SELECT canonical_address, label, votes::text
           FROM ranked
          WHERE rank = 1
          ORDER BY canonical_address`,
        [input.chainId],
      );
      await client.query("COMMIT");
      return {
        remarks: personal.rows.map(({ canonical_address, label, watched }) => ({
          address: canonical_address,
          label,
          watched,
        })),
        shared: shared.rows.map(({ canonical_address, label, votes }) => {
          const parsedVotes = Number(votes);
          if (!Number.isSafeInteger(parsedVotes) || parsedVotes < 1) {
            throw new RangeError("Stored shared remark vote count is invalid");
          }
          return { address: canonical_address, label, votes: parsedVotes };
        }),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async put(input: AddressRemarkPutInput): Promise<AddressRemark | null> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      let remark: AddressRemark | null;
      let resultCode: string;
      if (!input.label && !input.watched) {
        const deleted = await client.query(
          `DELETE FROM address_remarks
            WHERE user_id = $1 AND chain_id = $2 AND canonical_address = $3`,
          [input.userId, input.chainId, input.address],
        );
        remark = null;
        resultCode = deleted.rowCount === 1 ? "DELETED" : "ALREADY_ABSENT";
      } else {
        const saved = await client.query<PersonalRemarkRow>(
          `INSERT INTO address_remarks (
             user_id, chain_id, canonical_address, label, watched, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT ON CONSTRAINT address_remarks_user_chain_address_key
           DO UPDATE SET
             label = EXCLUDED.label,
             watched = EXCLUDED.watched,
             updated_at = EXCLUDED.updated_at
           RETURNING canonical_address, label, watched`,
          [input.userId, input.chainId, input.address, input.label, input.watched, input.updatedAt],
        );
        const row = saved.rows[0]!;
        remark = { address: row.canonical_address, label: row.label, watched: row.watched };
        resultCode = "UPDATED";
      }
      await this.#insertAllowedAudit(client, input.audit, resultCode);
      await client.query("COMMIT");
      return remark;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(input: AddressRemarkDeleteInput): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `DELETE FROM address_remarks
          WHERE user_id = $1 AND chain_id = $2 AND canonical_address = $3`,
        [input.userId, input.chainId, input.address],
      );
      const deleted = result.rowCount === 1;
      await this.#insertAllowedAudit(client, input.audit, deleted ? "DELETED" : "ALREADY_ABSENT");
      await client.query("COMMIT");
      return deleted;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordDenied(input: AddressRemarkAuditInput): Promise<void> {
    await this.#pool.query(insertAuditSql, auditValues(input));
  }

  async #insertAllowedAudit(
    client: PoolClient,
    input: AddressRemarkPutInput["audit"] | AddressRemarkDeleteInput["audit"],
    resultCode: string,
  ): Promise<void> {
    await client.query(insertAuditSql, auditValues({ ...input, outcome: "allowed", resultCode }));
  }
}
