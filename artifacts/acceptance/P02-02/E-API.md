# E-API: Top-fees snapshot and stream endpoints

Evidence level: `local-fixture-verified` only.

## Contracts

- `GET /api/pools/top-fees/:minutes?chainId=56`
- `GET /api/pools/top-fees/:minutes/stream?chainId=56`

Both routes require an authenticated session. Minutes accept exactly `1`, `5`, `15`, `30`, or `60`; chain ID accepts exactly `56`. Invalid values return stable `MARKET_QUERY_INVALID` errors. An absent provider returns retryable `MARKET_DATA_UNAVAILABLE` without synthesizing market rows.

The snapshot route returns the shared `MarketPoolSnapshot` contract and `Cache-Control: no-store`. The stream route returns UTF-8 SSE with no buffering and delegates replay to `PostgresMarketPoolsProvider`.

Focused API tests verify the BSC/window allowlist, snapshot shape, authentication, SSE IDs, event names, and Last-Event-ID forwarding. Existing `/api/stats` and `/api/stats/stream` regression tests remain green; STATS-01 and STATS-02 receive no P02-02 implementation ownership and remain planned.

No external API, target host, or RPC is contacted.
