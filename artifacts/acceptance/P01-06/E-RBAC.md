# E-RBAC: Preference ownership and navigation authority

## Server authority

- Evidence level: `local-fixture-verified`.
- Both preference endpoints and both stats endpoints derive `userId` from the authenticated server session. Anonymous requests return `401` before store/provider access.
- The preference contract does not accept an object identifier. A payload containing `userId` is rejected as invalid, and safe error bodies do not echo the attempted identifier.
- The PostgreSQL primary key is the session user ID. API and real-database tests save for user A, read defaults for user B, and verify that a migrated legacy row for user B is not visible to user A.
- Optimistic concurrency is scoped by both `user_id` and `revision`; a stale writer receives `409` and cannot replace the winning value.

## Navigation authority

- `navConfig` contains only the six ordinary keys: tasks, pools, strategies, activity, wallets and chat. There is no management key that a preference can add.
- `tasks` must appear exactly once and stay visible. Duplicate, unknown, missing and hidden-task configurations are rejected by the server.
- Desktop and mobile render the same normalized preference order and hidden set.
- Management remains derived from the authenticated role. Ordinary and Pro users cannot reveal it through preferences and are denied `/users`; the existing admin fixture continues to receive the role-gated entry and route.
- `AUTH-10` chain access policy is outside P01-06 and was not changed.

## Verification

- `tests/user-preferences-api.test.ts` covers anonymous access, session-derived ownership, cross-user isolation and identifier injection.
- `tests/integration/postgres-user-preferences.integration.ts` covers row ownership and legacy migration isolation against real PostgreSQL.
- `tests/e2e/preferences-shell.spec.ts` verifies the locked task switch, hidden/reordered ordinary navigation on both surfaces, absence of management for an ordinary user, refresh and second-context consistency.
- The existing auth/RBAC Playwright matrix remains part of the 65-passed full browser run.

No production user, account, session, admin endpoint or external identity service was used.
