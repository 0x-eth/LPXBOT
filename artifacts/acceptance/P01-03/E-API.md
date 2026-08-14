# E-API: Telegram authentication contracts

## Scope

- Feature IDs: `AUTH-01`, `AUTH-02`.
- Mini App route: `POST /api/auth/me` with an `initData` request body.
- Bot routes: `POST /api/auth/login-token`, `GET /api/auth/login-status/{token}`, and replica-internal `POST /api/auth/login-token/{token}/cancel`.
- Evidence level: `local-fixture-verified`.
- Live Telegram execution: not executed.

## Mini App verification

- `TelegramInitDataVerifier` delegates HMAC validation and parsing to `@tma.js/init-data-node` 2.0.8.
- A Telegram documentation HMAC vector independently verifies the library invocation and expected subject/authentication time.
- Tests reject signature tampering, stale `auth_date`, excessive future clock skew, missing required fields, and every repeated field before library validation.
- Replay digests are SHA-256 values over sorted, normalized parameters. Equivalent parameter order or encoding consumes the same replay record.
- A successful verification resolves the Telegram subject to a local account, atomically consumes the replay digest, and calls the existing `SessionIssuer`.
- Unknown Telegram subjects create one local `pending` account, including under concurrent resolution.
- API responses expose `SessionView` only. The opaque session credential is delivered solely as an HttpOnly, Secure, SameSite=Lax cookie.

## Bot one-time login

- Creation uses 32 bytes from `randomBytes`, returns a 43-character base64url token to the initiating browser, and passes only its SHA-256 hash to storage.
- State coverage is `pending`, `confirmed`, `consumed`, `cancelled`, and `expired`, plus a non-persisted `invalid` result.
- Confirmation is exposed to the Bot adapter only through `TelegramBotLoginConfirmationPort` in `@lpbot/api-contract`.
- First polling consumption updates the intent and inserts the hashed session in one PostgreSQL transaction. Concurrent polls produce one cookie-bearing success at most.
- Cancellation is explicit and marked `replicaInternal: true`. Cancellation and first consumption serialize on the intent row.
- Missing Bot application configuration or an invalid/missing username returns `503 TELEGRAM_BOT_UNAVAILABLE` on all three HTTP routes.
- There is no public development confirmation or authentication-bypass endpoint; `/api/auth/dev-confirm` returns 404.

## Abuse controls

- Authentication routes use `@fastify/rate-limit` with route-specific limits.
- The local fixed-window store returns immutable counter snapshots under concurrent requests and bounds each route cache at 5,000 keys.
- The focused concurrency test observes two successful token creations and one `429 RATE_LIMITED` response for a limit of two.

`pnpm test` passed 93 Vitest tests, including all Telegram API and application cases. No request contacted Telegram or the target site.
