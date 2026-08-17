import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../infra/migrations/20260818000100_create_notification_configuration.sql",
);

describe("P03-03 notification configuration migration", () => {
  it("creates preferences, immutable destination revisions, idempotency, and monitor bindings", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const createdTables = [...sql.matchAll(/CREATE TABLE ([a-z_]+)/gu)].map((match) => match[1]);

    expect(createdTables).toEqual([
      "notification_preferences",
      "notification_destinations",
      "notification_destination_versions",
      "notification_destination_create_idempotency",
      "monitor_notification_destination_bindings",
    ]);
    expect(sql).toContain("notification_destination_versions_immutable");
    expect(sql).toMatch(/current_revision[\s\S]+REFERENCES notification_destination_versions/iu);
    expect(sql).toMatch(/tombstone boolean NOT NULL/iu);
    expect(sql).toMatch(/secret_ref text/iu);
    expect(sql).toMatch(/FOREIGN KEY \(destination_id, user_id\)/u);
    expect(sql).toMatch(/FOREIGN KEY \(monitor_id, user_id\)/u);
    expect(sql).not.toMatch(/(?:bot_token|hmac_secret|signing_secret|telegram_token)\s+(?:text|bytea)/iu);
    expect(sql).not.toMatch(/ALTER TABLE notification_outbox/iu);
  });

  it("drops only P03-03 objects in dependency order", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const down = sql.split("-- migrate:down")[1]!;
    expect(down).toContain("DROP TABLE monitor_notification_destination_bindings;");
    expect(down).toContain("DROP TABLE notification_destination_versions;");
    expect(down).toContain("DROP TABLE notification_destinations;");
    expect(down).not.toContain("DROP TABLE notification_outbox");
    expect(down).not.toContain("DROP TABLE monitors");
  });
});
