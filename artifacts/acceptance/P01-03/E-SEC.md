# E-SEC: Telegram credential, replay, and privacy boundaries

## Verification and replay

- HMAC validation is provided by `@tma.js/init-data-node`; custom code is limited to request-shape, duplicate-field, required-field, time-window, and replay policy.
- `auth_date` is bounded by a 300-second maximum age and a 30-second future clock-skew allowance in local fixtures.
- Replay storage receives a canonical SHA-256 digest only. PostgreSQL uses `INSERT ... ON CONFLICT DO NOTHING` so concurrent consumption has one winner.
- The official documentation token used by the test vector is inactive public fixture data and is assembled from two documented components at runtime.

## Credential handling

- Bot login tokens and session tokens contain 32 random bytes and are persisted only as 32-byte SHA-256 values.
- The database schema has no columns for Mini App `initData`, Bot Token, Cookie, session plaintext, request body, or raw request.
- The API logger records only event, method, request ID, and response status. Tests assert that `initData`, Bot login tokens, and session hashes are absent from logs and response bodies.
- Access audit events store action, outcome, request ID, time, and nullable local user/session references. No Telegram profile, credential, IP, user-agent, or raw payload is recorded.
- Bot Token and username configuration fail closed. `.env.example` contains an empty token and username only.

## Browser handling

- Browser sessions use HttpOnly, Secure, SameSite=Lax cookies and are never returned as JSON credentials.
- Mini App `initData`, Bot login tokens, and session credentials are not written to `localStorage` or `sessionStorage`.
- BroadcastChannel carries only the credential-free completion signal.

## Scans and external boundary

- Dockerized Gitleaks 8.30.0 scanned 164 commits and approximately 17.81 MB with no leaks found.
- `pnpm audit:dependencies` reported no known vulnerabilities.
- CI run `31781761117` passed the pinned Security job, including repository history scanning and dependency audit.
- Telegram, the target site, and external RPC services were not contacted by application tests. No signature, chain transaction broadcast, funds action, or production write occurred.

Evidence level is `local-fixture-verified`. Live Telegram execution was not performed.
