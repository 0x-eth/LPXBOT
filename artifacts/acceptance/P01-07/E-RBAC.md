# E-RBAC: Session propagation and authorization review

Evidence level: `local-fixture-verified`.

## Single authorization source

The legacy `users.allowed_chain_ids` column and `StoredAccount.allowedChainIds` field were removed. `SessionView.allowedChainIds` is calculated from the current server policy on every session read or restoration:

- user: `all` chains only;
- pro: `all` and `pro` chains;
- admin: `all` and `pro` chains;
- every role: no `off` chains.

After an in-memory policy change, the next `/api/auth/me` response changed the existing user's chain IDs without a new login. A chain-store read failure returns an empty list.

## Fail-closed review

- `user + pro tier`, `pro + normal tier`, unknown roles, and unknown tiers fail closed in domain tests.
- A runtime `admin + unknown tier` fixture receives an empty safe GET view and a 403 management write; it does not receive management fields.
- user, pro, and admin are covered across every access mode and all four operation categories.
- `off` denies new exposure for admin as well as user/pro, while monitor and unwind continue through session and ownership checks.
- Cross-user resource access is denied for user and admin in the test-only guard because no admin resource scope is granted.
- Unknown chain and unknown action requests are denied.

## Management audit decisions

API tests assert audit records for anonymous, user, pro, CSRF, invalid-field, allowed, rate-limited, body-too-large, conflict, unchanged, and rollback attempts. Events contain actor, session, request ID, outcome/result, and time as applicable.

Successful PostgreSQL writes atomically store reason and minimal before/after arrays containing only chain ID, access, and revision. Cookies, bearer credentials, full headers, IP/user-agent data, and profile fields are absent.

Client state uses no chain-access `localStorage`, URL parameter, or hidden-button elevation path. UI state is feedback only; the server guard remains authoritative.
