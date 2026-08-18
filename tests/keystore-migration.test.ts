import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath = "infra/migrations/20260818000400_create_user_keystores.sql";

describe("P04-03 user Keystore migration", () => {
  it("adds password custody, versioned wraps and persistent lifecycle state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [up] = sql.split("-- migrate:down");
    expect(up).toContain("mode IN ('server-kek', 'user-password')");
    expect(up).toContain("ADD COLUMN dek_wrap_version");
    expect(up).toContain("ADD COLUMN dek_wrap_nonce");
    expect(up).toContain("ADD COLUMN dek_wrap_authentication_tag");
    expect(up).toContain("ADD COLUMN secret_version");
    expect(up).toContain("CREATE TABLE user_keystores");
    expect(up).toContain("CREATE TABLE user_keystore_versions");
    expect(up).toContain("CREATE TABLE user_keystore_failures");
    expect(up).toContain("CREATE TABLE user_keystore_reset_previews");
    expect(up).toMatch(/memory_kib[^\n]*= 65536/u);
    expect(up).toMatch(/iterations[^\n]*= 3/u);
    expect(up).toMatch(/parallelism[^\n]*= 1/u);
    expect(up).toMatch(/octet_length\(salt\) = 16/u);
    expect(up).toMatch(/octet_length\(verifier\) = 32/u);
    expect(up).toContain("wallet.password-change");
    expect(up).toContain("wallet.mode-switch");
    expect(up).toContain("keystore.reset");
  });

  it("stores no password, derived KEK, bare DEK or private key columns and has a full down", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [up, down] = sql.split("-- migrate:down");
    for (const forbidden of [
      /\bpassword\s+(?:text|bytea)/iu,
      /\bderived_kek\b/iu,
      /\bbare_dek\b/iu,
      /\bprivate_key\b/iu,
    ]) {
      expect(up).not.toMatch(forbidden);
    }
    expect(down).toContain("DROP TABLE user_keystore_reset_previews");
    expect(down).toContain("DROP TABLE user_keystore_failures");
    expect(down).toContain("DROP TABLE user_keystore_versions");
    expect(down).toContain("DROP TABLE user_keystores");
    expect(down).toContain("DROP COLUMN dek_wrap_nonce");
    expect(down).toContain("CHECK (mode = 'server-kek')");
  });
});
