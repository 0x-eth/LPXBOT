import { createHash } from "node:crypto";

import type { MonitorEvaluationCondition, MonitorEvaluationDefinition } from "@lpbot/domain";
import type { Pool, QueryResultRow } from "pg";

import type {
  MonitorEvaluationBlocklistSource,
  MonitorEvaluationMonitorSource,
} from "./monitoring.js";

interface MonitorSourceRow extends QueryResultRow {
  conditions: unknown;
  exclude_han_token: boolean;
  exclude_hook: boolean;
  monitor_id: string;
  pool_key: string;
  revision: string;
  user_id: string;
  window_minutes: number;
}

interface BlocklistRow extends QueryResultRow {
  chain_id: string;
  identity: string;
  scope: "pool" | "token";
}

function revision(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError("Stored monitor revision is invalid");
  }
  return parsed;
}

export class PostgresMonitorEvaluationSource
  implements MonitorEvaluationMonitorSource, MonitorEvaluationBlocklistSource
{
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listEnabledForPool(poolKey: string): Promise<MonitorEvaluationDefinition[]> {
    const result = await this.#pool.query<MonitorSourceRow>(
      `SELECT monitor_id::text, user_id::text, revision::text, pool_key,
              window_minutes, conditions, exclude_han_token, exclude_hook
         FROM monitors
        WHERE status = 'enabled' AND pool_key = $1
        ORDER BY monitor_id`,
      [poolKey],
    );
    return result.rows.map((row) => {
      if (!Array.isArray(row.conditions)) throw new RangeError("Stored monitor conditions are invalid");
      return {
        conditions: structuredClone(row.conditions) as MonitorEvaluationCondition[],
        enabled: true,
        excludeHanToken: row.exclude_han_token,
        excludeHook: row.exclude_hook,
        monitorId: row.monitor_id,
        poolKey: row.pool_key,
        revision: revision(row.revision),
        userId: row.user_id,
        windowMinutes: row.window_minutes,
      };
    });
  }

  async get(userId: string): Promise<{
    blocklistHash: string;
    entries: Array<{ identity: string }>;
  }> {
    const result = await this.#pool.query<BlocklistRow>(
      `SELECT chain_id::text, scope, identity
         FROM user_pool_blocklist_entries
        WHERE user_id = $1
        ORDER BY chain_id, scope, identity`,
      [userId],
    );
    const canonical = result.rows.map((row) => ({
      chainId: Number(row.chain_id),
      scope: row.scope,
      identity: row.identity,
    }));
    const serialized = JSON.stringify({ schemaVersion: 1, entries: canonical });
    return {
      blocklistHash: `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`,
      entries: canonical.map(({ identity }) => ({ identity })),
    };
  }
}
