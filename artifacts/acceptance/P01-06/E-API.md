# E-API: Versioned user preferences

## Scope and evidence level

- Work item: `P01-06`.
- Feature IDs: `SHELL-04`, `SET-01`, `SET-02`.
- Evidence level: `local-fixture-verified`.
- The P01-01 frozen bundle only supplied a `GET /api/user/preferences` candidate shape. The versioned response, PATCH contract, validation, concurrency behavior and PostgreSQL schema below are local implementation evidence, not live observations.

## HTTP contract

- `GET /api/user/preferences` and `PATCH /api/user/preferences` both resolve identity through the existing server session path and set `Cache-Control: no-store`.
- Anonymous requests return `401` before the preference store is called. The request body has no accepted `userId`; the PATCH top level is restricted to exactly `changes` and `expectedRevision`.
- The response is a `VersionedUserPreferences` value with `schemaVersion: 2`, `revision`, `updatedAt` and the complete normalized preference object.
- Server defaults are authoritative: `system` theme, `neutral` accent, no custom color, grid task view, expanded pool panel, hot pools off, scan tab on and all six ordinary navigation keys visible.
- PATCH accepts only `theme`, `colorTheme`, `customColor`, `taskViewMode`, `poolsPanelCollapsed`, `showHotPools`, `showScanTab` and `navConfig`. Unknown fields, malformed bodies and invalid enum/boolean values return safe `400 PREFERENCES_INVALID` envelopes.
- Custom colors normalize to uppercase six-digit hex. A `custom` preset requires a color. Navigation must contain every known key exactly once, may not contain unknown or duplicate keys, and must keep `tasks` visible.
- A stale `expectedRevision` returns `409 PREFERENCES_CONFLICT`; it does not overwrite the current row.

## PostgreSQL persistence

- Migration `20260814000400_create_user_preferences.sql` creates one row per `user_id`, references `users(id)` with cascade deletion, stores schema version and JSONB, and constrains revision/timestamps.
- The first update uses `INSERT ... ON CONFLICT DO NOTHING`; later updates use `WHERE user_id = $1 AND revision = $2` and atomically increment the revision. A losing insert/update reads the current value and reports conflict.
- Reads normalize stored data on the server. A version-one fixture row is upgraded to schema version two without changing its revision; legacy navigation arrays are completed in deterministic order and `tasks` is forced visible.
- Real PostgreSQL tests verify the table columns, defaults, persistence after a new app instance, one winner under simultaneous revision-zero writes, legacy migration and isolation between two users.

## Browser synchronization

- The UI applies valid changes optimistically and serializes PATCH requests. Success updates the confirmed server view; failure restores the last confirmed view and exposes a P01-05 global Toast retry action.
- Only `theme`, `colorTheme` and `customColor` are cached for the pre-paint theme bootstrap. The server response remains authoritative for all fields.
- Playwright verifies save, rollback, retry, validation, refresh and a second browser context reading the same server fixture state.

## Results

- `tests/user-preferences-api.test.ts`: 4/4 passed for defaults/401, normalization/conflict, whitelist/navigation validation and cross-user isolation.
- `tests/integration/postgres-user-preferences.integration.ts`: 2/2 passed against real PostgreSQL as part of `pnpm test:postgres` (4 files / 8 tests total).
- The focused API/SSE/theme command passed 4 files / 13 tests; the complete unit gate passed 25 files / 145 tests plus 19 governance tests.

No target site, production API, external RPC, credential, transaction, signature, broadcast or funds operation was used.
