# E-REC: Expiry, revocation, maintenance, and rollback evidence

## Session recovery behavior

- Expired and revoked sessions fail closed with 401.
- Logout revokes only the presented session and remains idempotent.
- A second user's valid session remains active after the first user logs out.
- Concurrent client restore calls coalesce into one request, preventing duplicate boot-time state races.
- A later 401 removes both `SessionView` and the in-memory bearer before navigating to `/login`.

## Service-state recovery behavior

- Maintenance is represented by a retryable stable 503 state.
- Admin maintenance bypass is explicit in the server decision and returned `SessionView`.
- Account and region denials remain non-retryable stable states.
- Generic 403 removes protected route content and displays a safe permission state.

## Database and baseline recovery

- The auth migration is repeatable under dbmate and has a complete down order: access audit, sessions, then users.
- `pnpm test:infra` passed all 8 service/migration tests.
- `pnpm test:postgres` passed against the real local PostgreSQL service.
- `pnpm check:baseline` passed: 248 checksums and 247 frozen manifest records.
- `pnpm check:p01-reference` passed: 33 P01-01 manifest records, 34 checksums, and 9 routes.
- `artifacts/acceptance/P01-01/sha256sums.txt` remained byte-identical with SHA-256 `d06301e91ba96b53de63e56f61b2f6ed76ae70f01fe7980e405876ad35b2b2cb`.

P01-01 gaps remain unchanged. Pro/admin and blocked/maintenance/region results in this work item are `local-fixture-verified`; they are not upgraded to `live-observed`.
