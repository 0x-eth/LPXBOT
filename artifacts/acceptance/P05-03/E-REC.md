# E-REC

Quote validity has three independent boundaries: `expiresAt`, `deadline`, and `maxBlockNumber`. Equality at any boundary is expired. Provider timeout, oversized or malformed response, stale source snapshot, Registry mismatch, and runtime code-hash mismatch all fail closed with no snapshot promoted to execution.

Pricing import is concurrency-safe and idempotent by full owned-position identity. A repeated snapshot adds no duplicate observation. Cross-user, quarantined, stale, or mismatched source snapshots are rejected. Cost basis remains frozen while later chain snapshots append fee/liquidity observations.

State changes use optimistic revision. Nonzero on-chain liquidity produces `hidden` rather than claiming withdrawal; zero liquidity produces append-only `withdrawn` plus a tombstone. Restart reconstructs current state from PostgreSQL state events, observations, stream head, and Outbox. SSE replay uses finite backfill and returns an explicit expired-cursor error outside retention.

Evidence: `tests/p05-pricing-position-ledger.test.ts`, `tests/p05-pricing-position-sse.test.ts`, and `tests/integration/postgres-pricing-position-store.integration.ts`.
