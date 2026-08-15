# E-SEC: P01 security closeout

Evidence level: `local-fixture-verified`. AUTH-10 remains reviewed at R2.

## Authentication and request boundaries

- Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`; logout clears the same attributes.
- Bearer credentials remain memory-only and are cleared after `401`.
- Telegram initData is time/HMAC/replay checked and never persisted in plaintext.
- Bot tokens, session tokens, wallet nonce IDs and SIWE messages are persisted only as hashes where persistence is needed.
- Wallet signatures are verified but not stored or returned. AUTH-03 is explicitly EOA-only.
- AUTH-10 writes require trusted admin RBAC, same origin, a 4096-byte body limit, exact whitelists, optimistic revision and per-session rate limiting.

## Safe output and logs

Tests prove Cookie, Bearer, initData, nonce, signature, request body, private configuration values and raw internal error details do not enter HTTP logs or rendered UI. The HTTP logger emits only event, method, request ID and status code. Stable safe response envelopes cover `401/403/409/410/429/503`.

## PWA cache boundary

The Service Worker keeps `/api` and `/api/**`, Authorization-bearing requests, SSE requests, every non-GET/HEAD request, cross-origin traffic and runtime navigation network-only. Cache tests verify that API, auth, SSE, writes and runtime navigation responses do not enter Cache Storage.

The final security gate includes a full-history Gitleaks scan and dependency audit; exact command results are recorded in [command-output.md](./command-output.md).
