# E-DATA

- Migration `20260816000400_create_market_pool_catalog.sql` adds one canonical BSC pool catalog keyed by `chainId:identity`. V3 rows require one 20-byte `pool_address`; V4 rows require one 32-byte `pool_id`.
- Every row records protocol and generation, token0/token1, fee pips, tick spacing, hooks, first observed block/time/transaction, and `created_event_id`. Address-like values are stored in lowercase canonical EVM form and constrained by PostgreSQL.
- The catalog is projected only from `normalized_pool_events WHERE canonical`. No RPC, metadata lookup, token-price lookup, creator lookup, or new chain sample participates in the projection.
- Event insertion, cursor update, affected catalog rebuild, market snapshot recomputation, liquidity-flow projection, and durable outbox writes run on one PostgreSQL client inside one serializable transaction under the existing chain advisory lock.
- Replay of the same raw delivery is a no-op. On an explicit removal or replacement branch, affected catalog keys are deleted and rebuilt from the remaining canonical normalized events; identities first observed only on the orphaned branch disappear.
- `MarketPoolRow`, top-fees snapshots, and top-fees diffs carry the same `poolKey`, V3/V4 identity, canonical token0/token1 addresses, fee pips, tick spacing, and hooks fields.
- Missing symbols, price-derived values, TVL, FDV, and absent metrics remain null. The implementation does not substitute an address for a symbol or fabricate numeric zero.

The PostgreSQL suite covers V3 address identity, V4 pool-ID identity, token0/token1 identity, replay, duplicate deliveries, explicit reorg removal, automatic replacement-branch detection, catalog reconstruction, atomic rollback, and the frozen P02-02 golden compatibility projection.
