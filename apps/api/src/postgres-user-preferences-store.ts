import { userPreferenceSchemaVersion, type VersionedUserPreferences } from "@lpbot/api-contract";
import type { Pool } from "pg";

import {
  defaultVersionedUserPreferences,
  normalizeStoredUserPreferences,
  type UpdateUserPreferencesInput,
  type UserPreferencesStore,
  type UserPreferencesUpdateResult,
} from "./user-preferences.js";

interface PreferenceRow {
  preferences: unknown;
  revision: string;
  schema_version: number;
  updated_at: Date;
}

export class PostgresUserPreferencesStore implements UserPreferencesStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async get(userId: string): Promise<VersionedUserPreferences | null> {
    const result = await this.#pool.query<PreferenceRow>(
      `SELECT schema_version, revision::text, preferences, updated_at
         FROM user_preferences
        WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const normalized = normalizeStoredUserPreferences(row.preferences);
    const revision = this.#revision(row.revision);

    if (
      row.schema_version !== userPreferenceSchemaVersion ||
      JSON.stringify(row.preferences) !== JSON.stringify(normalized)
    ) {
      const migrated = await this.#pool.query<PreferenceRow>(
        `UPDATE user_preferences
            SET schema_version = $3,
                preferences = $4::jsonb
          WHERE user_id = $1
            AND revision = $2
        RETURNING schema_version, revision::text, preferences, updated_at`,
        [userId, revision, userPreferenceSchemaVersion, JSON.stringify(normalized)],
      );
      if (!migrated.rows[0]) return this.get(userId);
      return this.#view(migrated.rows[0]);
    }
    return this.#view(row);
  }

  async update(input: UpdateUserPreferencesInput): Promise<UserPreferencesUpdateResult> {
    const preferences = JSON.stringify(input.preferences);
    let result;
    if (input.expectedRevision === 0) {
      result = await this.#pool.query<PreferenceRow>(
        `INSERT INTO user_preferences (
           user_id, schema_version, revision, preferences, created_at, updated_at
         ) VALUES ($1, $2, 1, $3::jsonb, $4, $4)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING schema_version, revision::text, preferences, updated_at`,
        [input.userId, userPreferenceSchemaVersion, preferences, input.updatedAt],
      );
    } else {
      result = await this.#pool.query<PreferenceRow>(
        `UPDATE user_preferences
            SET schema_version = $3,
                revision = revision + 1,
                preferences = $4::jsonb,
                updated_at = $5
          WHERE user_id = $1
            AND revision = $2
        RETURNING schema_version, revision::text, preferences, updated_at`,
        [
          input.userId,
          input.expectedRevision,
          userPreferenceSchemaVersion,
          preferences,
          input.updatedAt,
        ],
      );
    }
    const saved = result.rows[0];
    if (saved) return { status: "updated", value: this.#view(saved) };
    return {
      current: (await this.get(input.userId)) ?? defaultVersionedUserPreferences(),
      status: "conflict",
    };
  }

  #revision(value: string): number {
    const revision = Number(value);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new RangeError("Stored preference revision is invalid");
    }
    return revision;
  }

  #view(row: PreferenceRow): VersionedUserPreferences {
    return {
      preferences: normalizeStoredUserPreferences(row.preferences),
      revision: this.#revision(row.revision),
      schemaVersion: userPreferenceSchemaVersion,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
