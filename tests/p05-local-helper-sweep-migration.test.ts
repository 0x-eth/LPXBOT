import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath = "infra/migrations/20260820000300_create_local_helper_sweep.sql";

const tables = [
  "local_helper_residual_snapshots",
  "local_helper_sweep_previews",
  "local_helper_sweep_batches",
  "local_helper_sweep_operations",
  "local_helper_sweep_transactions",
  "local_helper_sweep_replacement_authorizations",
  "local_helper_sweep_receipt_evidence",
  "local_helper_sweep_reconciliation_cases",
  "local_helper_sweep_outbox",
  "local_helper_sweep_audit_events",
] as const;

describe("P05-08 local Helper sweep migration", () => {
  it("creates tenant-scoped immutable evidence and one operation per bounded asset", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [, afterUp] = sql.split("-- migrate:up");
    const [up] = afterUp!.split("-- migrate:down");

    for (const table of tables) {
      expect(up).toContain(`CREATE TABLE ${table}`);
      expect(up).toContain(`REVOKE ALL ON ${table} FROM PUBLIC`);
    }
    expect(up).toContain("CHECK (chain_id = 31337)");
    expect(up).toContain("registry_version = 'p05-local-helper-sweep-v2'");
    expect(up).toContain("snapshot_version = 'p05-local-helper-residual-snapshot-v2'");
    expect(up).toContain("plan_payload ->> 'planVersion' = 'p05-local-helper-sweep-plan-v2'");
    expect(up).toContain("UNIQUE (batch_id, asset_id)");
    expect(up).toContain("UNIQUE (chain_id, wallet_id, nonce)");
    expect(up).toContain("transaction_selector IN ('0x3609afa9', '0x6971b189')");
    expect(up).toContain("recipient <> helper_address");
    expect(up).toContain("fee_cap_base_unit = gas_limit * max_fee_per_gas_base_unit");
    expect(up).toContain("local_helper_residual_snapshots_append_only");
    expect(up).toContain("local_helper_sweep_receipts_append_only");
    expect(up).toContain("local_helper_sweep_audit_append_only");
    expect(up).not.toMatch(/private_key|secret_key|raw_transaction|signed_transaction/iu);
  });

  it("drops dependants before batches, snapshots, and the trigger function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [, down] = sql.split("-- migrate:down");
    const audit = down!.indexOf("DROP TABLE local_helper_sweep_audit_events");
    const operations = down!.indexOf("DROP TABLE local_helper_sweep_operations");
    const batches = down!.indexOf("DROP TABLE local_helper_sweep_batches");
    const snapshots = down!.indexOf("DROP TABLE local_helper_residual_snapshots");
    const trigger = down!.indexOf("DROP FUNCTION reject_local_helper_sweep_evidence_mutation");
    expect(audit).toBeGreaterThanOrEqual(0);
    expect(operations).toBeGreaterThan(audit);
    expect(batches).toBeGreaterThan(operations);
    expect(snapshots).toBeGreaterThan(batches);
    expect(trigger).toBeGreaterThan(snapshots);
  });
});
