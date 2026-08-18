import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath = "infra/migrations/20260818000300_create_custody_wallets.sql";

describe("P04-02 custody wallet migration", () => {
  it("defines atomic metadata and append-only envelope storage", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const [up, down] = sql.split("-- migrate:down");
    expect(up).toContain("CREATE TABLE custody_wallets");
    expect(up).toContain("CREATE TABLE custody_wallet_envelopes");
    expect(up).toContain("CREATE TABLE custody_wallet_audit_events");
    expect(up).toMatch(
      /FOREIGN KEY \(wallet_id, current_envelope_version\)[\s\S]+DEFERRABLE INITIALLY DEFERRED/u,
    );
    expect(up).toMatch(
      /UNIQUE[\s\S]+user_id[\s\S]+address_lower[\s\S]+WHERE[\s\S]+active[\s\S]+recoverable/u,
    );
    expect(up).toContain("prevent_custody_append_only_mutation");
    expect(down).toContain("DROP TABLE custody_wallet_envelopes");
    expect(down).toContain("DROP TABLE custody_wallets");
  });

  it("stores envelope fields but has no plaintext key, raw DEK, or raw KEK columns", async () => {
    const sql = (await readFile(migrationPath, "utf8")).toLowerCase();
    for (const required of [
      "ciphertext",
      "nonce",
      "authentication_tag",
      "wrapped_dek",
      "kek_id",
      "kek_version",
      "envelope_version",
      "aad_version",
    ]) {
      expect(sql).toContain(required);
    }
    expect(sql).not.toMatch(/\bprivate_key\b|\bplaintext\b|\braw_dek\b|\braw_kek\b/u);
  });
});
