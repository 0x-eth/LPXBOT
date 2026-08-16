# E-API

- `RecommendedPoolRow` replaces the former `string[]` recommendation field. The wire row contains stable pool identity, protocol, both token addresses and nullable symbols, fee pips, and the exact Decimal `feesUsd` string.
- Recommendations are requested only by `GET /api/stats/stream?chain=bsc&limit=N`. The default limit is 3 and the accepted range is 1 through 20. Omitting `chain` keeps the endpoint stats-only; unsupported chains and unknown query keys return `STATS_STREAM_QUERY_INVALID` rather than an empty recommendation set.
- A missing provider or failed initial canonical read returns a safe 503 `RECOMMENDATIONS_UNAVAILABLE` envelope before SSE headers are committed. Database details are not exposed.
- `Last-Event-ID` must parse as a recommendation cursor bound to the same chain and limit. Malformed and cross-limit cursors return `STATS_STREAM_CURSOR_INVALID`.
- The existing authenticated read boundary and per-session/IP rate limit remain active. A non-admin `user_id` filter returns 403. Recommendations are not partitioned by user.
- `/api/stats` still requires the system statistics provider and returns `STATS_UNAVAILABLE` when it is absent. A recommendation-only stream can operate without that provider.

Focused API coverage passed 16 tests, including chain/limit validation, stats-only behavior, safe 503 errors, RBAC, rate limiting, cursor validation, immediate snapshots, heartbeat, reconnect, reorg replacement, and disconnect cancellation.
