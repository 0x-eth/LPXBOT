# E-API: Session API and contract evidence

## Scope

- Feature IDs: `AUTH-05`, `AUTH-06`, `AUTH-07`, `AUTH-08`, `AUTH-09`.
- Production routes added: `POST /api/auth/me` and `POST /api/auth/logout`.
- Test-only guard routes are registered only when `testRoutes: true`; the production app returns the standard `NOT_FOUND` envelope for those paths.

## Verified behavior

- `SessionView` and the discriminated auth-state contract are shared through `@lpbot/api-contract`.
- Success and error responses use one stable envelope with a request ID.
- Missing credentials return `401 UNAUTHENTICATED`; invalid, expired, revoked, or logged-out credentials return `401 AUTH_EXPIRED`.
- Pending, rejected, banned, and region-blocked decisions return stable `403` codes.
- Maintenance returns `503 MAINTENANCE` for user/pro and permits the explicit admin bypass.
- Browser sessions are accepted from an HttpOnly cookie. Bearer compatibility accepts only the `Authorization` header and does not return the credential.
- Logout is idempotent, revokes only the presented session hash, and clears the browser cookie.
- Unknown routes and unexpected errors use the same safe error envelope.

## Test observations

- `pnpm test` passed with 49 Vitest tests and 19 governance tests while Docker services were stopped.
- The focused Fastify suite passed 26 tests after the final guard status-code matrix was added.
- `pnpm test:postgres` passed against PostgreSQL after deleting all generated workspace `dist` directories, proving the command is self-contained on a clean checkout.

All API observations are local fixture results. No target-site request was made.
