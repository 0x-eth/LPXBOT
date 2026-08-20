import type { PoolClient } from "pg";

export async function hasLiveLocalHelperUpgrade(
  client: Pick<PoolClient, "query">,
  input: { tenantId: string; userId: string; walletId: string },
): Promise<boolean> {
  const result = await client.query<{ live: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM local_helper_upgrade_operations
        WHERE tenant_id = $1 AND user_id = $2 AND wallet_id = $3 AND chain_id = 31337
          AND state IN ('queued', 'running', 'manual-recovery-required')
     ) AS live`,
    [input.tenantId, input.userId, input.walletId],
  );
  return result.rows[0]?.live === true;
}
