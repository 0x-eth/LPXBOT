import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "infra/migrations/20260819000200_create_wallet_helper_read_models.sql";

describe("P05-02 wallet Helper read-model migration", () => {
  it("creates user-scoped bindings and append-only verification and residual snapshots", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [, afterUp] = sql.split("-- migrate:up");
    const [up] = afterUp!.split("-- migrate:down");

    expect(up).toContain("CREATE TABLE wallet_helper_bindings");
    expect(up).toContain("CREATE TABLE wallet_helper_verification_snapshots");
    expect(up).toContain("CREATE TABLE wallet_helper_residual_snapshots");
    expect(up).toMatch(
      /FOREIGN KEY \(user_id, wallet_id\)[\s\S]+REFERENCES custody_wallets\(user_id, wallet_id\)/u,
    );
    expect(up).toContain("CHECK (chain_id = 56)");
    expect(up).toContain("source IN ('deployment-result', 'trusted-migration')");
    expect(up).toContain("registry_version = 'p05-bsc-execution-v1'");
    expect(up).toContain("UNIQUE (chain_id, helper_address)");
    expect(up).toContain("UNIQUE (user_id, wallet_id, chain_id, idempotency_key)");
    expect(up).toContain("wallet_helper_bindings_append_only");
    expect(up).toContain("wallet_helper_verification_snapshots_append_only");
    expect(up).toContain("wallet_helper_residual_snapshots_append_only");
    expect(up).toContain("REVOKE ALL ON wallet_helper_bindings FROM PUBLIC");
    expect(up).toContain("REVOKE ALL ON wallet_helper_verification_snapshots FROM PUBLIC");
    expect(up).toContain("REVOKE ALL ON wallet_helper_residual_snapshots FROM PUBLIC");
  });

  it("drops dependent snapshots before bindings and removes its trigger function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [, down] = sql.split("-- migrate:down");
    const residual = down!.indexOf("DROP TABLE wallet_helper_residual_snapshots");
    const verification = down!.indexOf("DROP TABLE wallet_helper_verification_snapshots");
    const bindings = down!.indexOf("DROP TABLE wallet_helper_bindings");
    const trigger = down!.indexOf("DROP FUNCTION prevent_wallet_helper_read_model_mutation");
    expect(residual).toBeGreaterThanOrEqual(0);
    expect(verification).toBeGreaterThanOrEqual(0);
    expect(bindings).toBeGreaterThan(residual);
    expect(bindings).toBeGreaterThan(verification);
    expect(trigger).toBeGreaterThan(bindings);
  });
});
