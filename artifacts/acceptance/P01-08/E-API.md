# E-API: P01 endpoint and contract closeout

Evidence level: `local-fixture-verified`.

The machine-readable inventory is [endpoint-rbac-matrix.json](./endpoint-rbac-matrix.json). It records all 17 runtime P01 endpoints and three explicitly test-only guards. No P02 market, P04 signer/funds, P06 task-data or other later-phase business endpoint was added.

## Contract coverage

- `POST /api/auth/me` covers credential-free session restoration and Telegram Mini App login without returning session credentials.
- Telegram Bot creation, polling and cancellation cover one consumer, replay/consumed conflict, cancellation and expiry.
- Wallet login covers nonce, address, domain, URI, chain, purpose, signature, expiry, replay and one concurrent consumer. The claim remains EOA-only; EIP-1271 is not implemented.
- Login-wallet list/link/unlink operations derive ownership from the server session and remain separate from signer or transaction-wallet authority.
- Preference GET/PATCH uses server defaults, exact fields, session ownership and optimistic revision conflict.
- Stats snapshot/SSE authenticates before subscription, preserves null/unavailable values and rejects stale sequences.
- Chain GET exposes role-effective fields; chain POST is trusted-admin-only and uses the same validated path for update and rollback.

## Re-execution

The focused P01 Vitest run passed 27 files and 154 tests. It covered Telegram replay/expiry, Bot single-token transitions, wallet binding and signature boundaries, session restore/logout, ownership, preferences concurrency, stats SSE, chain access and safe errors.

Stable responses were observed for `401`, `403`, `409`, `410`, `429` and `503`. API errors use the versioned envelope and stable public messages; raw internal exceptions are mapped to `INTERNAL_ERROR`.

## Claim boundary

Real Telegram clients, the target site, external RPC, production APIs and production credentials were not used. Bundle-derived shapes remain `frozen-bundle-candidate`; local API execution does not promote them to current target parity.
