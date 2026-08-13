import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../infra/migrations/20260814000100_create_auth_sessions.sql",
);

describe("P01-02 auth migration", () => {
  it("adds only the minimal user, hashed-session and access-audit schema", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const createdTables = [...sql.matchAll(/CREATE TABLE ([a-z_]+)/g)].map((match) => match[1]);

    expect(createdTables).toEqual(["users", "sessions", "access_audit_events"]);
    expect(sql).toMatch(/token_hash bytea NOT NULL UNIQUE/);
    expect(sql).toMatch(/expires_at timestamptz NOT NULL/);
    expect(sql).toMatch(/revoked_at timestamptz/);
    expect(sql).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/CHECK \(role IN \('user', 'pro', 'admin'\)\)/);
    expect(sql).toMatch(/CHECK \(status IN \('active', 'pending', 'rejected', 'banned'\)\)/);
    expect(sql).not.toMatch(/\b(token|cookie|authorization|ip_address|user_agent)\s+(?:text|varchar|bytea)/i);
  });
});
