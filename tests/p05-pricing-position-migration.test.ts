import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "infra/migrations/20260819000300_create_swap_quotes_pricing_positions.sql";

describe("P05-03 swap quote and pricing position migration", () => {
  it("creates tenant-scoped quote snapshots, immutable ledger history, and durable outbox", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [, afterUp] = sql.split("-- migrate:up");
    const [up] = afterUp!.split("-- migrate:down");
    for (const table of [
      "swap_quote_snapshots",
      "pricing_positions",
      "pricing_position_observations",
      "pricing_position_state_events",
      "pricing_position_withdrawn_tombstones",
      "pricing_position_stream_heads",
      "pricing_position_outbox",
    ]) {
      expect(up).toContain(`CREATE TABLE ${table}`);
      expect(up).toContain(`REVOKE ALL ON ${table} FROM PUBLIC`);
    }
    expect(up).toMatch(
      /FOREIGN KEY \(tenant_id, user_id, wallet_id\)[\s\S]+REFERENCES custody_wallets\(tenant_id, user_id, wallet_id\)/u,
    );
    expect(up).toContain("UNIQUE (tenant_id, user_id, wallet_id, chain_id, platform_id");
    expect(up).toContain("UNIQUE (tenant_id, user_id, sequence)");
    expect(up).toContain("UNIQUE (pricing_id, snapshot_digest)");
    expect(up).toContain("status IN ('active', 'hidden', 'withdrawn')");
    expect(up).toContain("event_type IN ('diff', 'tombstone')");
    expect(up).toContain("pricing_position_observations_append_only");
    expect(up).toContain("pricing_position_withdrawn_tombstones_append_only");
    expect(up).toContain("pricing_position_outbox_append_only");
    expect(up).not.toMatch(/raw_calldata|okx_api|secret_key|private_key/iu);
  });

  it("drops outbox and dependants before positions and restores the custody constraint", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [, down] = sql.split("-- migrate:down");
    const outbox = down!.indexOf("DROP TABLE pricing_position_outbox");
    const observations = down!.indexOf("DROP TABLE pricing_position_observations");
    const positions = down!.indexOf("DROP TABLE pricing_positions");
    const custodyConstraint = down!.indexOf(
      "DROP CONSTRAINT custody_wallets_tenant_user_wallet_unique",
    );
    expect(outbox).toBeGreaterThanOrEqual(0);
    expect(observations).toBeGreaterThan(outbox);
    expect(positions).toBeGreaterThan(observations);
    expect(custodyConstraint).toBeGreaterThan(positions);
  });
});
