import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath = "infra/migrations/20260814000300_create_login_wallet_auth.sql";

describe("P01-04 login wallet migration", () => {
  it("uses explicit auth identity names and hash-only challenge columns", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const up = sql.split("-- migrate:down")[0] ?? "";

    expect(up).toContain("CREATE TABLE auth_login_wallets");
    expect(up).toContain("CREATE TABLE auth_wallet_challenges");
    expect(up).toContain("id_hash bytea");
    expect(up).toContain("nonce_hash bytea");
    expect(up).toContain("message_hash bytea");
    expect(up).toContain("CHECK (octet_length(address) = 20)");
    expect(up).not.toMatch(/\b(?:nonce|message|signature)\s+(?:text|bytea|varchar)\b/iu);
    expect(up).not.toMatch(/CREATE TABLE\s+(?:wallets|signers|private_keys|mnemonics)\b/iu);
  });

  it("has a rollback that restores the prior audit constraint and drops only P01-04 tables", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const down = sql.split("-- migrate:down")[1] ?? "";

    expect(down).toContain("DROP TABLE auth_wallet_challenges");
    expect(down).toContain("DROP TABLE auth_login_wallets");
    expect(down).toContain("telegram.bot.intent.consume");
    expect(down).not.toContain("DROP TABLE users");
    expect(down).not.toContain("DROP TABLE telegram_identities");
  });
});
