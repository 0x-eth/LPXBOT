import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migration = new URL(
  "../infra/migrations/20260821000100_create_local_helper_upgrade.sql",
  import.meta.url,
);

describe("P05-09 local Helper upgrade migration", () => {
  it("persists the cursor, evidence, lineage, and cross-version active binding invariant", async () => {
    const sql = await readFile(migration, "utf8");
    for (const cursor of [
      "preflight",
      "deploy-v2",
      "verify-v2",
      "sweep-v1",
      "final-rescan-v1",
      "atomic-binding-switch",
      "completed",
    ]) {
      expect(sql).toContain(`'${cursor}'`);
    }
    expect(sql).toContain("local_helper_upgrade_transactions");
    expect(sql).toContain("local_helper_upgrade_replacement_authorizations");
    expect(sql).toContain("local_helper_upgrade_v2_verification_evidence");
    expect(sql).toContain("local_helper_upgrade_final_rescan_evidence");
    expect(sql).toContain("local_helper_sweep_batches_upgrade_operation_unique");
    expect(sql).toContain("ADD COLUMN upgrade_operation_id uuid");
    expect(sql).toContain("wallet_helper_deployment_bindings_active_unique");
    expect(sql).toContain("WHERE state = 'active'");
    expect(sql).toContain("state IN ('deploying', 'active', 'degraded', 'superseded')");
    expect(sql).toContain("helper_version IN ('WalletHelperV1', 'WalletHelperV2')");
    expect(sql).toContain("p05-local-helper-upgrade-plan-v3");
    expect(sql).not.toContain("private_key");
    expect(sql).not.toContain("raw_transaction");
  });
});
