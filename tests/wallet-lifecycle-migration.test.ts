import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath =
  "infra/migrations/20260818000500_create_wallet_lifecycle_security_password.sql";

describe("P04-04 wallet lifecycle and security password migration", () => {
  it("stores one-time wallet previews, durable tombstones, and deletion audit correlation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [up, down] = sql.split("-- migrate:down");
    expect(up).toContain("LOCAL-DECISION");
    expect(up).toContain("CREATE TABLE custody_wallet_delete_previews");
    expect(up).toContain("CREATE TABLE custody_wallet_tombstones");
    expect(up).toMatch(/preview_token_digest bytea[^\n]+octet_length\(preview_token_digest\) = 32/u);
    expect(up).toMatch(/expires_at = created_at \+ interval '300 seconds'/u);
    expect(up).toContain("asset_risk_digest");
    expect(up).toContain("force_eligible");
    expect(up).toContain("task_count integer GENERATED ALWAYS AS");
    expect(up).toContain("policy_count integer GENERATED ALWAYS AS");
    expect(up).toContain("position_count integer GENERATED ALWAYS AS");
    expect(up).toContain("asset_count integer GENERATED ALWAYS AS");
    expect(up).toContain("deletion_audit_id");
    expect(up).toContain("wallet.force-delete");
    expect(up).toContain("wallet.delete");
    expect(up).toContain("wallet.rename");
    expect(up).toContain("DROP CONSTRAINT custody_wallet_audit_events_wallet_id_fkey");
    expect(up).toContain("DROP CONSTRAINT custody_wallet_audit_events_user_id_fkey");
    expect(down).toContain("DROP TABLE custody_wallet_tombstones");
    expect(down).toContain("DROP TABLE custody_wallet_delete_previews");
    expect(down).toContain("ADD CONSTRAINT custody_wallet_audit_events_wallet_id_fkey");
    expect(down).toContain("ADD CONSTRAINT custody_wallet_audit_events_user_id_fkey");
  });

  it("stores immutable domain-separated security-password versions without secret material", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [up, down] = sql.split("-- migrate:down");
    expect(up).toContain("CREATE TABLE user_security_passwords");
    expect(up).toContain("CREATE TABLE user_security_password_versions");
    expect(up).toContain("CREATE TABLE security_password_audit_events");
    expect(up).toContain("lpbot-security-password-kdf/v1");
    expect(up).toMatch(/kdf_algorithm text[^\n]+Argon2id/u);
    expect(up).toMatch(/octet_length\(salt\) = 16/u);
    expect(up).toMatch(/octet_length\(verifier\) = 32/u);
    expect(up).toContain("prevent_security_password_version_mutation");
    expect(up).toContain("security_password_versions_immutable");
    for (const forbidden of [
      /\bpassword\s+(?:text|bytea)/iu,
      /\bderived_(?:key|kek)\b/iu,
      /\bplaintext\b/iu,
      /\bprivate_key\b/iu,
    ]) {
      expect(up).not.toMatch(forbidden);
    }
    expect(down).toContain("DROP TABLE security_password_audit_events");
    expect(down).toContain("DROP TABLE user_security_password_versions");
    expect(down).toContain("DROP TABLE user_security_passwords");
    expect(down).toContain("DROP FUNCTION prevent_security_password_version_mutation");
  });

  it("persists only the SHA-256 digest, never the plaintext preview token", async () => {
    const sql = (await readFile(migrationPath, "utf8")).toLowerCase();
    expect(sql).not.toMatch(/\bpreview_token\s+(?:text|bytea)/u);
    expect(sql).toContain("preview_token_digest bytea");
  });
});
