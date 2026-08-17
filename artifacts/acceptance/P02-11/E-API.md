# E-API

- `GET /api/user/pool-blocklist` and `PATCH /api/user/pool-blocklist` require an authenticated session, scope every store call to `session.userId`, and return `Cache-Control: no-store`.
- PATCH accepts exactly `expectedRevision` plus one `block` or `restore` operation. Entry validation rejects unknown fields, non-BSC chains, symbols, uppercase/non-canonical addresses, malformed V3/V4 pool keys, labels over 64 code points, and labels containing control characters.
- Token identity is exactly one canonical lowercase 20-byte EVM address. Pool identity is the stable BSC `poolKey`, with a 20-byte V3 address or 32-byte V4 pool ID after the `56:` prefix.
- Duplicate block and restore of an absent entry are successful no-ops and retain revision and `updatedAt`. A changed operation increments revision exactly once.
- A stale `expectedRevision` returns 409 `REVISION_CONFLICT` with the current authoritative snapshot. Capacity returns 422 without changing authority.
- PATCH body size is limited to 2048 bytes, the list is limited to 500 entries, and the default mutation limiter permits 30 operations per session per minute.
- Focused HTTP coverage verifies authentication, per-user isolation, no-store, idempotency, conflicts, capacity, body limits, mutation limits, error envelopes, and eligibility injection into top-fees, by-token, and market SSE reads.
