# E-SEC: R2 security verification

Evidence level: `local-fixture-verified`.

## Management write controls

- Authentication precedes authorization; anonymous writes return 401 and user/pro return 403.
- Admin authorization also requires a trusted role/tier combination.
- Same-origin validation rejects cross-origin POST requests.
- The JSON body limit is 4096 bytes.
- Exact top-level and per-chain field validation rejects actor/user ID injection, unknown access modes, mismatched key sets, empty reasons, invalid revisions, and extra fields.
- A bounded per-session rate limiter rejects excess writes.
- PostgreSQL validates registered chain, default-chain availability, readiness, unique batch members, and optimistic revision inside one transaction.
- Batch validation and transaction rollback prevent partial updates.

## Data and logging boundaries

The HTTP logger emits only event, method, request ID, and response status. Tests prove that Cookie values, bearer tokens, full headers, private configuration markers, and reasons do not enter logs or safe error responses.

Management audit tables intentionally retain local actor/session references, result, request ID, time, reason, and minimal policy before/after state. They contain no credentials, network identifiers, profile data, or internal chain configuration values. History and management audit tables reject UPDATE and DELETE.

All API requests and all writes remain Service Worker `NetworkOnly`. `pnpm test:pwa` passed 4/4 and proved API, auth, SSE, write, and runtime navigation responses are not cached.

## Security gates

- Dockerized Gitleaks 8.30.0 scanned 317 commits and approximately 18.64 MB with no leaks.
- `pnpm audit:dependencies` reported no known vulnerabilities.
- Foundry formatting/build and 3/3 local contract tests passed.
- The R2 manual review found and fixed an inconsistent `admin + unknown tier` management elevation before final verification.

No external RPC, target site, Telegram service, production API, signature, transaction, broadcast, or funds action was used.
