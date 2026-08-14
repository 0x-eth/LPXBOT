import { chainRegistry, findRegisteredChain } from "@lpbot/chain-registry";
import type { ChainAccessMode } from "@lpbot/domain";
import type { Pool, PoolClient } from "pg";

import {
  ChainPolicyStoreError,
  type ChainAccessPolicyChange,
  type ChainAccessPolicyStore,
  type ChainAccessPolicyUpdateInput,
  type ChainAccessPolicyUpdateResult,
  type ChainAccessPolicyView,
  type ChainManagementAuditInput,
} from "./chain-access-policies.js";

interface ChainPolicyRow {
  access: ChainAccessMode;
  chain_id: string;
  previous_access: ChainAccessMode | null;
  reason: string;
  revision: string;
  updated_at: Date;
  updated_by: string;
}

const chainPolicyTransactionLock = 50_107;

function isChainAccessMode(value: string): value is ChainAccessMode {
  return value === "off" || value === "pro" || value === "all";
}

function validateChanges(input: ChainAccessPolicyUpdateInput): void {
  if (
    input.changes.length === 0 ||
    input.reason.trim() === "" ||
    input.reason.length > 500 ||
    input.actorUserId === "" ||
    input.sessionId === "" ||
    input.requestId === ""
  ) {
    throw new ChainPolicyStoreError("CONFIG_INVALID");
  }

  const seen = new Set<number>();
  for (const change of input.changes) {
    const chain = findRegisteredChain(change.chainId);
    if (!chain) throw new ChainPolicyStoreError("CHAIN_UNKNOWN");
    if (
      seen.has(change.chainId) ||
      !isChainAccessMode(change.access) ||
      !Number.isSafeInteger(change.expectedRevision) ||
      change.expectedRevision < 0
    ) {
      throw new ChainPolicyStoreError("CONFIG_INVALID");
    }
    seen.add(change.chainId);
    if (chain.isDefault && change.access === "off") {
      throw new ChainPolicyStoreError("DEFAULT_CHAIN_REQUIRED");
    }
    if (!chain.configurationComplete && change.access !== "off") {
      throw new ChainPolicyStoreError("CHAIN_NOT_READY");
    }
  }
}

function auditState(policies: readonly ChainAccessPolicyView[]) {
  return policies.map(({ access, chainId, revision }) => ({ access, chainId, revision }));
}

export class PostgresChainAccessPolicyStore implements ChainAccessPolicyStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async list(): Promise<ChainAccessPolicyView[]> {
    return this.#list(this.#pool);
  }

  async recordManagementAudit(input: ChainManagementAuditInput): Promise<void> {
    await this.#pool.query(
      `INSERT INTO chain_access_management_audit_events (
         actor_user_id,
         session_id,
         request_id,
         outcome,
         result_code,
         reason,
         before_state,
         after_state,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7)`,
      [
        input.actorUserId,
        input.sessionId,
        input.requestId,
        input.outcome,
        input.resultCode,
        input.reason,
        input.createdAt,
      ],
    );
  }

  async update(input: ChainAccessPolicyUpdateInput): Promise<ChainAccessPolicyUpdateResult> {
    validateChanges(input);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [chainPolicyTransactionLock]);
      const currentPolicies = await this.#list(client);
      const currentById = new Map(currentPolicies.map((policy) => [policy.chainId, policy]));
      const changed: Array<{
        change: ChainAccessPolicyChange;
        current: ChainAccessPolicyView;
      }> = [];

      for (const change of input.changes) {
        const current = currentById.get(change.chainId);
        if (!current) throw new ChainPolicyStoreError("CHAIN_UNKNOWN");
        if (change.access === current.access) continue;
        if (change.expectedRevision !== current.revision) {
          throw new ChainPolicyStoreError("CONFIG_CONFLICT");
        }
        changed.push({ change, current });
      }

      for (const { change, current } of changed) {
        const revision = current.revision + 1;
        if (current.revision === 0) {
          await client.query(
            `INSERT INTO chain_access_policies (
               chain_id, access, revision, updated_by, updated_at, reason
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              change.chainId,
              change.access,
              revision,
              input.actorUserId,
              input.updatedAt,
              input.reason.trim(),
            ],
          );
        } else {
          const updated = await client.query(
            `UPDATE chain_access_policies
                SET access = $2,
                    revision = $3,
                    updated_by = $4,
                    updated_at = $5,
                    reason = $6
              WHERE chain_id = $1
                AND revision = $7`,
            [
              change.chainId,
              change.access,
              revision,
              input.actorUserId,
              input.updatedAt,
              input.reason.trim(),
              current.revision,
            ],
          );
          if (updated.rowCount !== 1) throw new ChainPolicyStoreError("CONFIG_CONFLICT");
        }
        await client.query(
          `INSERT INTO chain_access_policy_history (
             chain_id,
             revision,
             before_access,
             after_access,
             updated_by,
             updated_at,
             reason
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            change.chainId,
            revision,
            current.access,
            change.access,
            input.actorUserId,
            input.updatedAt,
            input.reason.trim(),
          ],
        );
      }

      const policies = changed.length === 0 ? currentPolicies : await this.#list(client);
      await client.query(
        `INSERT INTO chain_access_management_audit_events (
           actor_user_id,
           session_id,
           request_id,
           outcome,
           result_code,
           reason,
           before_state,
           after_state,
           created_at
         ) VALUES ($1, $2, $3, 'allowed', $4, $5, $6, $7, $8)`,
        [
          input.actorUserId,
          input.sessionId,
          input.requestId,
          changed.length === 0 ? "UNCHANGED" : "UPDATED",
          input.reason.trim(),
          JSON.stringify(auditState(changed.map(({ current }) => current))),
          JSON.stringify(
            auditState(
              changed.map(({ change }) =>
                policies.find(({ chainId }) => chainId === change.chainId),
              ) as ChainAccessPolicyView[],
            ),
          ),
          input.updatedAt,
        ],
      );
      await client.query("COMMIT");
      return { policies, status: changed.length === 0 ? "unchanged" : "updated" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #list(
    queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  ): Promise<ChainAccessPolicyView[]> {
    const result = await queryable.query<ChainPolicyRow>(
      `SELECT p.chain_id::text,
              p.access,
              p.revision::text,
              p.updated_by,
              p.updated_at,
              p.reason,
              h.before_access AS previous_access
         FROM chain_access_policies p
         LEFT JOIN chain_access_policy_history h
           ON h.chain_id = p.chain_id
          AND h.revision = p.revision`,
    );
    const rows = new Map(result.rows.map((row) => [Number(row.chain_id), row]));

    return chainRegistry.map((chain) => {
      const row = rows.get(chain.chainId);
      return {
        access: row?.access ?? "off",
        chainId: chain.chainId,
        configurationComplete: chain.configurationComplete,
        displayName: chain.displayName,
        isDefault: chain.isDefault,
        missingConfiguration: [...chain.missingConfiguration],
        previousAccess: row?.previous_access ?? null,
        reason: row?.reason ?? null,
        revision: row ? Number(row.revision) : 0,
        updatedAt: row?.updated_at.toISOString() ?? null,
        updatedBy: row?.updated_by ?? null,
      };
    });
  }
}
