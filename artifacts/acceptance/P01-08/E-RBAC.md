# E-RBAC: P01 role, state and ownership review

Evidence level: `local-fixture-verified`.

## Account decision order

1. Missing or expired session returns `401`.
2. Pending, rejected or banned account returns a dedicated `403` for every role.
3. Region policy returns `403 REGION_BLOCKED` for every role.
4. Maintenance returns `503 MAINTENANCE` for user/Pro; an active admin explicitly bypasses it.
5. Endpoint-specific RBAC and ownership run only after the account decision.

## Role matrix

- Authenticated shell, preferences, stats, login-wallet identities and chain reads are available to user, Pro and admin.
- Admin status does not imply cross-user ownership. The tested ownership guard requires an explicit admin scope, which P01 does not grant.
- `/users` and the chain-management settings entry render only for admin.
- Chain writes require a trusted admin role/tier pair. Inconsistent role/tier values fail closed.
- Chain new exposure follows `all` = all roles, `pro` = Pro/admin, `off` = nobody. Read, monitor and unwind remain subject to session and ownership but are not blocked by the access mode.

The endpoint-specific anonymous/user/Pro/admin outcomes and state handling are in [endpoint-rbac-matrix.json](./endpoint-rbac-matrix.json). Existing exhaustive domain/API tests and PostgreSQL operation tests were re-run.

Pro/admin and blocked-state observations remain local fixtures. They are not live target evidence and therefore do not raise any feature above `implemented-assumed`.
