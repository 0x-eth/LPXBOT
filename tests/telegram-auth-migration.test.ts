import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migrationPath =
  "infra/migrations/20260814000200_create_telegram_auth.sql";

function migration(): string {
  return readFileSync(new URL(`../${migrationPath}`, import.meta.url), "utf8");
}

describe("P01-03 Telegram authentication migration", () => {
  it("adds only identity, replay and bot login intent tables", () => {
    const sql = migration();
    const tables = [...sql.matchAll(/^CREATE TABLE ([a-z_]+) \(/gmu)].map((match) => match[1]);

    expect(tables).toEqual([
      "telegram_identities",
      "telegram_init_data_replays",
      "telegram_bot_login_intents",
    ]);
    expect(sql).not.toMatch(
      /^\s*(init_data|bot_token|cookie|session_token|request_body|raw_request)\s+/gimu,
    );
  });

  it("stores only 32-byte credential digests and constrains all five intent states", () => {
    const sql = migration();

    expect(sql).toMatch(/token_hash bytea NOT NULL UNIQUE CHECK \(octet_length\(token_hash\) = 32\)/u);
    expect(sql).toMatch(/digest bytea PRIMARY KEY CHECK \(octet_length\(digest\) = 32\)/u);
    for (const state of ["pending", "confirmed", "consumed", "cancelled", "expired"]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).toContain("CHECK (expires_at > created_at)");
  });

  it("extends credential-free authentication audit actions and has a complete rollback", () => {
    const sql = migration();

    for (const action of [
      "telegram.mini_app.login",
      "telegram.bot.intent.create",
      "telegram.bot.intent.confirm",
      "telegram.bot.intent.cancel",
      "telegram.bot.intent.consume",
    ]) {
      expect(sql).toContain(`'${action}'`);
    }
    expect(sql).toContain("-- migrate:down");
    expect(sql).toContain("DROP TABLE telegram_bot_login_intents;");
    expect(sql).toContain("DROP TABLE telegram_init_data_replays;");
    expect(sql).toContain("DROP TABLE telegram_identities;");
  });
});
